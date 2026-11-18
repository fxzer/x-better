/**
 * MAIN world 数据拦截器（唯一入口）。
 *
 * 在 document_start 只安装一次 window.fetch / XMLHttpRequest 钩子，按 URL 分流：
 *   - FetchScheduledTweets / CreateScheduledTweet / DeleteScheduledTweet → 排期数据同步
 *   - CreateTweet → 即时推文发送时间戳同步（供智能排期参考）
 *   - TweetDetail / TweetResultByRestId → 书签指标 & 媒体缓存
 *   - SEARCH_NAVIGATE_TYPE / composer media bridge → 搜索导航与发帖多图拖拽排序
 *
 * 安全/隐蔽原则：
 * - 只读不改：clone 响应后再解析，绝不修改原始 Response / XHR 结果
 * - 零日志：默认静默；仅当 window.__XF_DEBUG_SCHEDULED__ = true 时输出排查信息
 * - 最小开销：先做 URL 字符串判断，命中且 response.ok 才 clone + 解析
 * - 静默失败：所有异常吞掉，绝不影响 X 页面自身逻辑
 *
 * 注意：MAIN world 无法直接访问 browser.storage，数据走 window.postMessage，
 * 由 isolated world 的监听器（initialize.ts 注册）落库。
 */
import {
  XF_BRIDGE_MARKER,
  SCHEDULED_TWEETS_TYPE,
  SCHEDULED_TWEET_CREATED_TYPE,
  SCHEDULED_TWEET_DELETED_TYPE,
  BOOKMARK_METRICS_TYPE,
  FETCH_SCHEDULED_REQ_TYPE,
  TWEET_CREATED_TYPE,
  SEARCH_NAVIGATE_TYPE,
} from '../shared/bridge'
import { installComposerMediaBridge } from '../shared/composer-media-bridge'
import { navigateSearchPage } from '../shared/search-tools'
import { isTweetOrArticleUrl, extractBookmarkMetrics } from '../shared/bookmark-interceptor'
import { harvestAllTweetMediaFromGraphql } from '../shared/tweet-media'

function getNormalizedUrl(input: unknown): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (input && typeof input === 'object' && 'url' in input) {
    return String((input as { url: unknown }).url || '')
  }
  return ''
}

function isCreateTweetUrl(url: string): boolean {
  if (typeof url !== 'string') return false
  const lower = url.toLowerCase()
  return (
    lower.includes('createtweet') ||
    lower.includes('createnotetweet') ||
    lower.includes('create_tweet') ||
    lower.includes('create_note_tweet')
  )
}

function extractInReplyToId(requestBody: unknown, responseData?: unknown): string | null {
  try {
    if (requestBody) {
      const body = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody
      const reply = (body as any)?.variables?.reply
      const id = reply?.in_reply_to_tweet_id || reply?.in_reply_to_status_id
      if (typeof id === 'string' && id.trim()) return id.trim()
    }
  } catch {}
  try {
    if (responseData && typeof responseData === 'object') {
      const data = responseData as any
      const createTweet = data?.data?.create_tweet || data?.create_tweet
      const legacy = (createTweet?.tweet_results?.result || createTweet?.result)?.legacy
      if (typeof legacy?.in_reply_to_status_id_str === 'string' && legacy.in_reply_to_status_id_str.trim()) {
        return legacy.in_reply_to_status_id_str.trim()
      }
    }
  } catch {}
  return null
}

function extractQueryIdFromScript(scriptText: string, operationName: string): string | null {
  if (!scriptText || !operationName) return null
  const tokens =
    /["']?(queryId|operationName)["']?\s*:\s*["']([A-Za-z0-9_-]+)["']|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{}]/g
  const scopes: Array<{ queryId?: string; operationName?: string }> = [{}]
  for (const token of scriptText.matchAll(tokens)) {
    if (token[0] === '{') {
      scopes.push({})
    } else if (token[0] === '}') {
      if (scopes.length > 1) scopes.pop()
    } else if (token[1]) {
      const scope = scopes[scopes.length - 1]
      scope[token[1] as 'queryId' | 'operationName'] = token[2]
      if (scope.operationName === operationName && /^[A-Za-z0-9_-]{20,45}$/.test(scope.queryId || '')) {
        return scope.queryId!
      }
    }
  }
  return null
}

export default defineContentScript({
  matches: ['https://twitter.com/*', 'https://mobile.twitter.com/*', 'https://x.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    // 扩展总开关：MAIN world 无法读 storage，由 isolated world 通过 postMessage 通知。
    // 默认 true 兼容现有行为（document_start 时还不知道开关状态）；收到关闭通知后停用拦截。
    let interceptEnabled = true

    installComposerMediaBridge(() => interceptEnabled)

    // 全局防崩溃兜底：防止 Twitter 内部非核心接口（如 429 限流）
    // 抛出未捕获的 ApiError 导致整个 React 视图崩溃白屏
    window.addEventListener('unhandledrejection', (event) => {
      try {
        const reason = event.reason
        const msg = String(reason?.message || reason || '')
        const isApi429 = msg.includes('429') || reason?.status === 429 || (reason?.name === 'ApiError' && String(reason).includes('429'))
        if (isApi429) {
          event.preventDefault()
          debug('已拦截并抑制未捕获 ApiError 429 限流错误，保障页面视图正常展示')
        }
      } catch {}
    })

    const SCHEDULED_ITEMS_KEY = 'xf_scheduled_items_last'
    const DEBUG_FLAG = '__XF_DEBUG_SCHEDULED__'

    // 上次已广播的排期 payload，内容没变就不重复广播，减少 postMessage 与 storage 写入
    let lastScheduledPosted = ''

    function debug(...args: unknown[]) {
      try {
        if ((window as unknown as Record<string, unknown>)[DEBUG_FLAG]) {
          console.log('[X Focus 拦截器]', ...args)
        }
      } catch {
        // ignore
      }
    }

    // ---------- URL 命中判断（大小写不敏感，避免漏接 X 改动 operation 名大小写） ----------
    const isFetchScheduledUrl = (url: string) => {
      const lower = url.toLowerCase()
      return (
        lower.includes('fetchscheduledtweets') ||
        lower.includes('scheduledtweets') ||
        (lower.includes('/graphql/') &&
          lower.includes('scheduled') &&
          !lower.includes('createscheduledtweet') &&
          !lower.includes('deletescheduledtweet'))
      )
    }

    const isCreateScheduledUrl = (url: string) => url.toLowerCase().includes('createscheduledtweet')
    const isDeleteScheduledUrl = (url: string) => url.toLowerCase().includes('deletescheduledtweet')
    const isScheduledUrl = (url: string) =>
      isFetchScheduledUrl(url) || isCreateScheduledUrl(url) || isDeleteScheduledUrl(url)

    // ---------- 排期提取 ----------
    type RawScheduledItem = {
      rest_id?: string
      restId?: string
      scheduling_info?: { execute_at?: number; state?: string }
      schedulingInfo?: { execute_at?: number; state?: string }
      execute_at?: number
      tweet_create_request?: { status?: string }
      tweetCreateRequest?: { status?: string }
      status?: string
    }

    function extractScheduledItems(data: unknown) {
      if (!data || typeof data !== 'object') return null

      const obj = data as Record<string, any>
      let list: unknown =
        obj?.data?.viewer?.scheduled_tweet_list ??
        obj?.data?.viewer?.user_results?.result?.scheduled_tweet_list ??
        obj?.viewer?.scheduled_tweet_list ??
        obj?.data?.scheduled_tweet_list ??
        obj?.scheduled_tweet_list ??
        null

      // 结构路径变化时有限递归兜底，只采集 scheduled_tweet_list
      if (!Array.isArray(list)) {
        const found: unknown[] = []
        const seen = new WeakSet<object>()
        let budget = 5000
        const walk = (node: unknown) => {
          if (budget <= 0 || !node || typeof node !== 'object' || seen.has(node)) return
          seen.add(node)
          budget--
          if (Array.isArray(node)) {
            node.forEach(walk)
            return
          }
          const rec = node as Record<string, unknown>
          for (const [k, v] of Object.entries(rec)) {
            if ((k === 'scheduled_tweet_list' || k === 'scheduledTweetList') && Array.isArray(v)) {
              found.push(...v)
            }
            walk(v)
          }
        }
        walk(data)
        list = found.length > 0 ? found : null
      }

      if (!Array.isArray(list)) return null

      return (list as RawScheduledItem[])
        .filter(
          (item) =>
            item?.scheduling_info?.state === 'Scheduled' || item?.schedulingInfo?.state === 'Scheduled',
        )
        .map((item) => ({
          restId: item.rest_id ?? item.restId ?? '',
          timestamp:
            item.scheduling_info?.execute_at ?? item.schedulingInfo?.execute_at ?? item.execute_at ?? 0,
          text: item.tweet_create_request?.status ?? item.tweetCreateRequest?.status ?? item.status ?? '',
        }))
        .filter(
          (item) => typeof item.timestamp === 'number' && !isNaN(item.timestamp) && item.timestamp > 0,
        )
    }

    function handleScheduled(data: unknown) {
      try {
        const items = extractScheduledItems(data)
        if (!items) return

        const payload = JSON.stringify(items)
        if (payload === lastScheduledPosted) {
          debug('排期数据未变化，跳过广播（当前', items.length, '条）')
          return
        }
        lastScheduledPosted = payload

        // 条目快照供 isolated world 链路丢失时回退
        try {
          sessionStorage.setItem(SCHEDULED_ITEMS_KEY, payload)
        } catch {}
        try {
          localStorage.setItem(SCHEDULED_ITEMS_KEY, payload)
        } catch {}

        // 携带桥接标记，isolated world 监听端校验 source + type + 标记后才会落库
        window.postMessage(
          { type: SCHEDULED_TWEETS_TYPE, payload: items, __xf: XF_BRIDGE_MARKER },
          '*',
        )
        debug('已广播排期数据', items.length, '条', items)
      } catch (e) {
        debug('排期解析/发送失败', e)
      }
    }

    /** 从 CreateScheduledTweet 请求体中解析待定发布时间与正文 */
    function extractCreateScheduledVars(body: unknown): { timestamp: number; text: string } | null {
      if (!body) return null
      try {
        const raw = typeof body === 'string' ? JSON.parse(body) : body
        const vars = raw?.variables || raw
        if (!vars || typeof vars !== 'object') return null

        let executeAt =
          vars.execute_at ??
          vars.scheduling_info?.execute_at ??
          vars.scheduled_at ??
          vars.schedulingInfo?.execute_at ??
          0
        if (typeof executeAt === 'string') executeAt = parseInt(executeAt, 10)
        if (typeof executeAt === 'number' && !isNaN(executeAt) && executeAt > 0) {
          if (executeAt < 1e11) executeAt *= 1000
        } else {
          executeAt = 0
        }

        const text =
          vars.post_tweet_request?.status ??
          vars.tweet_create_request?.status ??
          vars.tweet_text ??
          vars.text ??
          vars.status ??
          ''

        return { timestamp: executeAt, text }
      } catch {
        return null
      }
    }

    /** 从 GraphQL 响应中提取排期 ID */
    function extractScheduledTweetId(data: unknown): string {
      if (!data || typeof data !== 'object') return ''
      try {
        const root = data as Record<string, any>
        const candidates = [
          root?.data?.tweet_schedule?.rest_id,
          root?.data?.create_scheduled_tweet?.rest_id,
          root?.data?.create_scheduled_tweet?.scheduled_tweet_id,
          root?.data?.scheduled_tweet?.rest_id,
          root?.data?.scheduled_tweet_id,
          root?.rest_id,
        ]
        for (const c of candidates) {
          if (typeof c === 'string' && c) return c
        }

        let found = ''
        const walk = (node: unknown, depth: number) => {
          if (!node || typeof node !== 'object' || depth > 4 || found) return
          const obj = node as Record<string, unknown>
          for (const [k, v] of Object.entries(obj)) {
            if ((k === 'rest_id' || k === 'restId' || k === 'scheduled_tweet_id') && typeof v === 'string' && v) {
              found = v
              return
            }
            walk(v, depth + 1)
          }
        }
        walk(data, 0)
        return found
      } catch {
        return ''
      }
    }

    /** 从 CreateScheduledTweet 响应中提取执行时间戳 */
    function extractExecuteAtFromResponse(data: unknown): number {
      if (!data || typeof data !== 'object') return 0
      try {
        const root = data as Record<string, any>
        let raw =
          root?.data?.tweet_schedule?.scheduling_info?.execute_at ??
          root?.data?.create_scheduled_tweet?.scheduling_info?.execute_at ??
          root?.data?.create_scheduled_tweet?.execute_at ??
          0
        if (typeof raw === 'string') raw = parseInt(raw, 10)
        if (typeof raw === 'number' && !isNaN(raw) && raw > 0) {
          return raw < 1e11 ? raw * 1000 : raw
        }
        return 0
      } catch {
        return 0
      }
    }

    /** 处理创建定时推文响应并广播更新 */
    function handleCreateScheduled(reqBody: unknown, resData: unknown) {
      try {
        const reqVars = extractCreateScheduledVars(reqBody)
        const resTimestamp = extractExecuteAtFromResponse(resData)
        const timestamp = resTimestamp || reqVars?.timestamp || 0
        const text = reqVars?.text || ''
        const restId = extractScheduledTweetId(resData)

        if (!timestamp || isNaN(timestamp) || timestamp <= Date.now()) return

        const newItem = { restId, timestamp, text }

        // 同步合并至本地快照
        try {
          const snapshot = sessionStorage.getItem(SCHEDULED_ITEMS_KEY)
          const items: Array<{ restId?: string; timestamp: number; text: string }> = snapshot ? JSON.parse(snapshot) : []
          if (Array.isArray(items)) {
            const idx = items.findIndex((it) =>
              (restId && it.restId === restId) || Math.abs(it.timestamp - timestamp) < 60000
            )
            if (idx >= 0) {
              items[idx] = { ...items[idx], restId: restId || items[idx].restId, timestamp, text }
            } else {
              items.push(newItem)
            }
            items.sort((a, b) => a.timestamp - b.timestamp)
            const payload = JSON.stringify(items)
            sessionStorage.setItem(SCHEDULED_ITEMS_KEY, payload)
            localStorage.setItem(SCHEDULED_ITEMS_KEY, payload)
          }
        } catch {}

        window.postMessage(
          {
            type: SCHEDULED_TWEET_CREATED_TYPE,
            payload: newItem,
            __xf: XF_BRIDGE_MARKER,
          },
          '*',
        )
        debug('已广播新创建的排期推文', newItem)
      } catch (e) {
        debug('创建排期解析/发送失败', e)
      }
    }

    /** 从 DeleteScheduledTweet 请求/响应中提取待删除 ID */
    function extractDeleteScheduledId(body: unknown, data?: unknown): string {
      try {
        if (body) {
          const raw = typeof body === 'string' ? JSON.parse(body) : body
          const vars = raw?.variables || raw
          const id = vars?.scheduled_tweet_id ?? vars?.tweet_id ?? vars?.rest_id
          if (typeof id === 'string' && id) return id
        }
      } catch {}
      return extractScheduledTweetId(data)
    }

    /** 处理删除定时推文响应并广播更新 */
    function handleDeleteScheduled(reqBody: unknown, resData: unknown) {
      try {
        const id = extractDeleteScheduledId(reqBody, resData)
        if (!id) return

        try {
          const snapshot = sessionStorage.getItem(SCHEDULED_ITEMS_KEY)
          if (snapshot) {
            const items = JSON.parse(snapshot)
            if (Array.isArray(items)) {
              const filtered = items.filter((it: any) => it.restId !== id)
              const payload = JSON.stringify(filtered)
              sessionStorage.setItem(SCHEDULED_ITEMS_KEY, payload)
              localStorage.setItem(SCHEDULED_ITEMS_KEY, payload)
            }
          }
        } catch {}

        window.postMessage(
          {
            type: SCHEDULED_TWEET_DELETED_TYPE,
            payload: { scheduledTweetId: id },
            __xf: XF_BRIDGE_MARKER,
          },
          '*',
        )
        debug('已广播删除排期推文', id)
      } catch (e) {
        debug('删除排期广播失败', e)
      }
    }

    const BOOKMARK_METRICS_KEY = 'xf_bookmark_metrics_last'
    const bookmarkMetricsCache: Record<string, number> = {}

    function handleBookmarks(data: unknown) {
      try {
        const metrics = extractBookmarkMetrics(data)
        const entries = Object.entries(metrics)
        if (entries.length === 0) return

        let updated = false
        for (const [id, count] of entries) {
          if (bookmarkMetricsCache[id] !== count) {
            bookmarkMetricsCache[id] = count
            updated = true
          }
        }

        if (!updated) return

        try {
          sessionStorage.setItem(BOOKMARK_METRICS_KEY, JSON.stringify(bookmarkMetricsCache))
        } catch {}

        window.postMessage(
          { type: BOOKMARK_METRICS_TYPE, payload: metrics, __xf: XF_BRIDGE_MARKER },
          '*',
        )
        debug('已广播书签指标', entries.length, '条', metrics)
      } catch (e) {
        debug('书签解析/发送失败', e)
      }
    }

    function handleTweetCreated(reqBody?: unknown, resData?: unknown) {
      try {
        const inReplyTo = extractInReplyToId(reqBody, resData)
        const isReply = Boolean(inReplyTo)
        const sentAt = Date.now()
        try {
          localStorage.setItem('xf_last_tweet_sent_at', String(sentAt))
        } catch {}
        window.postMessage(
          {
            type: TWEET_CREATED_TYPE,
            payload: { sentAt, isReply },
            __xf: XF_BRIDGE_MARKER,
          },
          '*',
        )
        debug('已广播推文发布事件', { sentAt, isReply })
      } catch (e) {
        debug('推文发布广播失败', e)
      }
    }

    // ---------- 推文媒体拦截与缓存 ----------
    const MAX_SESSION_MEDIA = 50
    const sessionMediaKeys: string[] = []

    function handleMediaInterception(data: unknown, url?: string) {
      try {
        if (url) {
          const match = url.match(/\/graphql\/([a-zA-Z0-9_-]+)\/(TweetResultByRestId|TweetDetail)/)
          if (match) {
            const [, qId, op] = match
            try {
              sessionStorage.setItem(`xf_active_query_id_${op}`, qId)
              localStorage.setItem(`xf_active_query_id_${op}`, qId)
            } catch {}
          }
        }

        const mediaList = harvestAllTweetMediaFromGraphql(data)
        if (mediaList && mediaList.length > 0) {
          for (const item of mediaList) {
            if (item.tweetId) {
              const k = `xf_media_${item.tweetId}`
              try {
                sessionStorage.setItem(k, JSON.stringify(item))
                sessionMediaKeys.push(k)
                while (sessionMediaKeys.length > MAX_SESSION_MEDIA) {
                  const oldKey = sessionMediaKeys.shift()
                  if (oldKey) {
                    try {
                      sessionStorage.removeItem(oldKey)
                    } catch {}
                  }
                }
              } catch {}
            }
          }
        }
      } catch {}
    }

    function route(url: string, data: unknown, reqBody?: unknown) {
      if (!data) return
      if (isCreateScheduledUrl(url)) {
        handleCreateScheduled(reqBody, data)
      } else if (isDeleteScheduledUrl(url)) {
        handleDeleteScheduled(reqBody, data)
      } else if (isFetchScheduledUrl(url)) {
        handleScheduled(data)
      }
    }

    // ---------- Hook window.fetch & 主动拉取排期 ----------
    const originalFetch = window.fetch.bind(window)
    const capturedHeaders: Record<string, string> = {}

    function captureGraphQLRequest(url: string, headers?: HeadersInit) {
      if (!url.includes('/graphql/')) return
      const hdrs: Record<string, string> = {}
      if (headers) {
        if (headers instanceof Headers) {
          headers.forEach((v, k) => {
            hdrs[k.toLowerCase()] = v
          })
        } else if (Array.isArray(headers)) {
          headers.forEach(([k, v]) => {
            hdrs[k.toLowerCase()] = v
          })
        } else if (typeof headers === 'object') {
          Object.entries(headers).forEach(([k, v]) => {
            hdrs[k.toLowerCase()] = String(v)
          })
        }
      }
      Object.assign(capturedHeaders, hdrs)
    }

    function findQueryIdFromWindow(operationName: string): string | null {
      try {
        const chunkArray = (window as unknown as { webpackChunk_twitter_responsive_web?: unknown[] })
          ?.webpackChunk_twitter_responsive_web
        if (Array.isArray(chunkArray)) {
          for (const chunk of chunkArray) {
            if (!Array.isArray(chunk)) continue
            const modules = chunk[1]
            if (!modules || typeof modules !== 'object') continue
            for (const modId of Object.keys(modules as Record<string, unknown>)) {
              const mod = (modules as Record<string, unknown>)[modId]
              const modStr = typeof mod === 'function' ? mod.toString() : ''
              if (modStr.includes(operationName)) {
                const qid = extractQueryIdFromScript(modStr, operationName)
                if (qid) return qid
              }
            }
          }
        }
      } catch {}
      return null
    }

    function findQueryIdFromDom(operationName: string): string | null {
      try {
        const scripts = Array.from(document.querySelectorAll('script'))
        for (const script of scripts) {
          const text = script.textContent
          if (text && text.includes(operationName)) {
            const qid = extractQueryIdFromScript(text, operationName)
            if (qid) return qid
          }
        }
      } catch {}
      return null
    }

    async function findQueryIdFromCdnScripts(operationName: string): Promise<string | null> {
      try {
        const sessionKey = `xf_qid_v2_${operationName}`
        const cached = sessionStorage.getItem(sessionKey)
        if (cached) return cached

        const elements = Array.from(
          document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(
            'script[src], link[rel="modulepreload"], link[rel="preload"][as="script"]',
          ),
        )
        const urls = elements
          .map((el) => (el.tagName.toLowerCase() === 'script' ? (el as HTMLScriptElement).src : (el as HTMLLinkElement).href))
          .filter((src): src is string => Boolean(src && (src.includes('responsive-web') || src.includes('x-web') || src.includes('twimg.com'))))

        const uniqueUrls = Array.from(new Set(urls))
        const BATCH_SIZE = 5
        for (let i = 0; i < uniqueUrls.length; i += BATCH_SIZE) {
          const batch = uniqueUrls.slice(i, i + BATCH_SIZE)
          const results = await Promise.all(
            batch.map(async (src) => {
              try {
                const res = await originalFetch(src)
                if (res.ok) {
                  const text = await res.text()
                  if (text.includes(operationName)) {
                    return extractQueryIdFromScript(text, operationName)
                  }
                }
              } catch {}
              return null
            }),
          )
          for (const qid of results) {
            if (qid) {
              sessionStorage.setItem(sessionKey, qid)
              return qid
            }
          }
        }
      } catch {}
      return null
    }

    async function resolveQueryId(operationName: string): Promise<string | null> {
      const sessionKey = `xf_qid_v2_${operationName}`
      const fromWin = findQueryIdFromWindow(operationName)
      if (fromWin) {
        sessionStorage.setItem(sessionKey, fromWin)
        return fromWin
      }
      const fromDom = findQueryIdFromDom(operationName)
      if (fromDom) {
        sessionStorage.setItem(sessionKey, fromDom)
        return fromDom
      }
      const cached = sessionStorage.getItem(sessionKey)
      if (cached) return cached

      const fromCdn = await findQueryIdFromCdnScripts(operationName)
      if (fromCdn) {
        sessionStorage.setItem(sessionKey, fromCdn)
        return fromCdn
      }
      return null
    }

    let activeFetchScheduledBusy = false
    async function triggerActiveScheduledFetch() {
      if (activeFetchScheduledBusy) return
      activeFetchScheduledBusy = true
      try {
        const queryId = await resolveQueryId('FetchScheduledTweets')
        if (!queryId) {
          debug('主动拉取排期：无法解析 FetchScheduledTweets queryId')
          return
        }

        const ct0Match = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)
        const ct0 = ct0Match ? decodeURIComponent(ct0Match[1]) : ''
        const bearer =
          capturedHeaders['authorization'] ||
          'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

        const headers: Record<string, string> = {
          authorization: bearer,
          'x-twitter-active-user': 'yes',
          'x-twitter-auth-type': 'OAuth2Session',
          'x-twitter-client-language': 'zh-cn',
          ...(ct0 ? { 'x-csrf-token': ct0 } : {}),
          ...capturedHeaders,
        }

        const url = `https://x.com/i/api/graphql/${queryId}/FetchScheduledTweets?variables=%7B%22ascending%22%3Atrue%7D`
        const res = await originalFetch(url, {
          method: 'GET',
          headers,
          credentials: 'include',
        })
        if (res.ok) {
          const json = await res.json()
          handleScheduled(json)
        }
      } catch (err) {
        debug('主动拉取排期失败', err)
      } finally {
        activeFetchScheduledBusy = false
      }
    }

    // 扩展控制与请求消息 listener（带 XF_BRIDGE_MARKER 校验）
    window.addEventListener('message', (event) => {
      if (event.source !== window) return
      const data = event.data
      if (data && typeof data === 'object' && data.__xf === XF_BRIDGE_MARKER) {
        if (data.type === 'XF_EXTENSION_STATUS') {
          interceptEnabled = data.enabled === true
          debug('拦截器状态:', interceptEnabled ? '启用' : '停用')
        } else if (data.type === SEARCH_NAVIGATE_TYPE && interceptEnabled) {
          if (typeof data.href === 'string') {
            navigateSearchPage(data.href, Boolean(data.replace))
          }
        } else if (data.type === FETCH_SCHEDULED_REQ_TYPE && interceptEnabled) {
          void triggerActiveScheduledFetch()
        }
      }
    })

    window.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
      const url = getNormalizedUrl(args[0])
      try {
        const reqHeaders = args[1]?.headers || (args[0] instanceof Request ? args[0].headers : undefined)
        captureGraphQLRequest(url, reqHeaders)
      } catch {}

      const response = await originalFetch(...args)
      // 扩展关闭后不再拦截解析，直接透传响应
      if (!interceptEnabled) return response
      try {
        // 非 2xx 响应不含业务数据，直接跳过，避免无谓的 clone + 解析开销
        if (!response.ok) return response
        // 命中才 clone，绝不盲目解析所有响应
        if (isScheduledUrl(url)) {
          const reqBody = args[1]?.body
          const cloned = response.clone()
          cloned
            .json()
            .then((data) => route(url, data, reqBody))
            .catch(() => {})
        } else if (isTweetOrArticleUrl(url)) {
          const cloned = response.clone()
          cloned
            .json()
            .then((data) => {
              handleBookmarks(data)
              handleMediaInterception(data, url)
            })
            .catch(() => {})
        } else if (isCreateTweetUrl(url)) {
          const cloned = response.clone()
          cloned
            .json()
            .then((data) => {
              handleTweetCreated(args[1]?.body, data)
            })
            .catch(() => {})
        }
      } catch {
        // 拦截出错静默忽略，不影响原始请求
      }
      return response
    }

    // ---------- Hook XMLHttpRequest（备用通道） ----------
    const originalOpen = XMLHttpRequest.prototype.open
    const originalSend = XMLHttpRequest.prototype.send

    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest,
      ...args: any[]
    ): void {
      try {
        ;(this as XMLHttpRequest & { __xfUrl?: string }).__xfUrl = String(args[1] || '')
      } catch {}
      // 保持原始参数完全透传，绝不强加默认值或多余 undefined，防止底层请求库异常
      return originalOpen.apply(this, args as any)
    }

    XMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest,
      ...args: Parameters<XMLHttpRequest['send']>
    ): void {
      const xhr = this as XMLHttpRequest & { __xfUrl?: string; __xfHooked?: boolean; __xfBody?: unknown }
      xhr.__xfBody = args[0]
      // 防止同一个 XHR 对象被复用 send 多次时重复挂载 load 监听
      if (!xhr.__xfHooked) {
        xhr.__xfHooked = true
        this.addEventListener('load', function (this: XMLHttpRequest) {
          if (!interceptEnabled) return
          if (this.status < 200 || this.status >= 300) return
          try {
            const url = (this as XMLHttpRequest & { __xfUrl?: string }).__xfUrl || ''
            if (isTweetOrArticleUrl(url) && this.responseText) {
              try {
                const parsed = JSON.parse(this.responseText)
                handleBookmarks(parsed)
                handleMediaInterception(parsed, url)
              } catch {}
            }
            if (isCreateTweetUrl(url) && this.responseText) {
              try {
                const reqBody = (this as XMLHttpRequest & { __xfBody?: unknown }).__xfBody
                let parsed: unknown = null
                try {
                  parsed = JSON.parse(this.responseText)
                } catch {}
                handleTweetCreated(reqBody, parsed)
              } catch {}
            }
            if (!isScheduledUrl(url) || !this.responseText) return
            const reqBody = (this as XMLHttpRequest & { __xfBody?: unknown }).__xfBody
            route(url, JSON.parse(this.responseText), reqBody)
          } catch {
            // 静默忽略
          }
        })
      }
      return originalSend.apply(this, args)
    }
  },
})
