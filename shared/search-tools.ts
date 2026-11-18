/**
 * 搜索工具与语法解析器：
 * 提供搜索语法拆解（时间、点赞数、原创推文、长文链接、媒体类型）、
 * 搜索 URL 转换、默认「最新」标签跟踪器，以及 MAIN world 内的无刷新路由跳转能力。
 */

export const SEARCH_TIME_OPTIONS = ['24h', '7d', '30d'] as const
export const SEARCH_LIKES_OPTIONS = [10, 100, 1000] as const
export const SEARCH_MEDIA_OPTIONS = ['images', 'videos', 'media'] as const

export interface SearchFilters {
  /** within_time 的值，如 24h, 7d, 30d */
  time: string | null
  /** min_faves 的值，如 10, 100, 1000 */
  minLikes: number | null
  /** -filter:replies 仅看原创 */
  originalOnly: boolean
  /** url:"x.com/i/article" 仅看长文 */
  articlesOnly: boolean
  /** filter: 后面的 images / videos / media */
  media: string | null
}

export const EMPTY_SEARCH_FILTERS: Readonly<SearchFilters> = Object.freeze({
  time: null,
  minLikes: null,
  originalOnly: false,
  articlesOnly: false,
  media: null,
})

export interface SearchLocation {
  /** 搜索关键词；话题标签页为 #标签 */
  query: string
  /** 结果标签：null 为「热门」，live 为「最新」，media / user / list */
  tab: string | null
  /** pf=on：仅看关注的人 */
  following: boolean
  /** 是否为话题页（/hashtag/...） */
  hashtag: boolean
}

const TIME_TOKEN = /^within_time:(\d+[smhd])$/i
const LIKES_TOKEN = /^min_faves:(\d+)$/i
const ORIGINAL_TOKEN = /^-filter:replies$/i
const ARTICLE_QUERY = 'url:"x.com/i/article"'
const ARTICLE_TOKEN = /^url:(?:"x\.com\/i\/article"|x\.com\/i\/article)$/i
const MEDIA_TOKEN = /^filter:(images|videos|media)$/i
const QUERY_TOKEN = /"[^"]*"?|\S+/g

/**
 * 将完整的搜索语句拆分为「筛选器管辖的语法糖」与「其余文本词」
 */
export function splitSearchQuery(query: string): { terms: string; filters: SearchFilters } {
  const filters: SearchFilters = { ...EMPTY_SEARCH_FILTERS }
  const rest: string[] = []

  for (const token of query.match(QUERY_TOKEN) ?? []) {
    let match: RegExpExecArray | null
    if ((match = TIME_TOKEN.exec(token))) {
      filters.time = match[1].toLowerCase()
    } else if ((match = LIKES_TOKEN.exec(token))) {
      filters.minLikes = Number(match[1])
    } else if (ORIGINAL_TOKEN.test(token)) {
      filters.originalOnly = true
    } else if (ARTICLE_TOKEN.test(token)) {
      filters.articlesOnly = true
    } else if ((match = MEDIA_TOKEN.exec(token))) {
      filters.media = match[1].toLowerCase()
    } else {
      rest.push(token)
    }
  }

  return { terms: rest.join(' '), filters }
}

/**
 * 将文本词与筛选器语法糖组合为规范的搜索词
 */
export function buildSearchQuery(terms: string, filters: SearchFilters): string {
  const parts = [terms.trim()]
  if (filters.time) parts.push(`within_time:${filters.time}`)
  if (filters.minLikes) parts.push(`min_faves:${filters.minLikes}`)
  if (filters.originalOnly) parts.push('-filter:replies')
  if (filters.media) parts.push(`filter:${filters.media}`)
  if (filters.articlesOnly) parts.push(ARTICLE_QUERY)
  return parts.filter(Boolean).join(' ')
}

export function hasSearchFilters(filters: SearchFilters): boolean {
  return Boolean(filters.time || filters.minLikes || filters.originalOnly || filters.articlesOnly || filters.media)
}

function toUrl(href: string): URL | null {
  try {
    return new URL(href, 'https://x.com')
  } catch {
    return null
  }
}

/**
 * 解析搜索页或话题页的定位信息，非目标页面返回 null
 */
export function parseSearchLocation(href: string): SearchLocation | null {
  const url = toUrl(href)
  if (!url) return null

  let query: string
  let hashtag = false

  if (url.pathname === '/search') {
    query = url.searchParams.get('q')?.trim() ?? ''
  } else {
    const match = /^\/hashtag\/([^/]+)\/?$/.exec(url.pathname)
    if (!match) return null
    try {
      query = `#${decodeURIComponent(match[1])}`
    } catch {
      return null
    }
    hashtag = true
  }

  if (!query) return null
  return {
    query,
    tab: url.searchParams.get('f') || null,
    following: url.searchParams.get('pf') === 'on',
    hashtag,
  }
}

function formatParams(params: URLSearchParams): string {
  return [...params].map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
}

/**
 * 将默认停在「热门」的搜索地址改写为「最新」（f=live）
 */
export function latestSearchHref(href: string): string | null {
  const page = parseSearchLocation(href)
  const url = toUrl(href)
  if (!page || page.tab || !url) return null
  url.searchParams.set('f', 'live')
  return `${url.pathname}?${formatParams(url.searchParams)}`
}

/**
 * 根据新筛选条件生成新的搜索 URL，保留当前 tab 与 pf 参数
 */
export function filteredSearchHref(href: string, query: string, following: boolean): string | null {
  const page = parseSearchLocation(href)
  const url = toUrl(href)
  if (!page || !url || !query.trim()) return null
  const params = page.hashtag ? new URLSearchParams() : new URLSearchParams(url.searchParams)
  params.set('q', query.trim())
  if (page.hashtag && page.tab) params.set('f', page.tab)
  if (following) params.set('pf', 'on')
  else params.delete('pf')
  return `/search?${formatParams(params)}`
}

/**
 * 搜索页自动切换为「最新」状态跟踪器
 */
export function createSearchLatestTracker() {
  const keptTop = new Set<string>()
  return {
    keepTop(query: string) {
      keptTop.add(query)
    },
    next(href: string): string | null {
      const page = parseSearchLocation(href)
      if (!page || page.tab || keptTop.has(page.query)) return null
      return latestSearchHref(href)
    },
  }
}

/**
 * 生成搜索查询 URL
 */
export function searchHref(query: string): string | null {
  const q = query.trim()
  return q ? `/search?q=${encodeURIComponent(q)}&src=typed_query` : null
}

function isGrokPage(url: URL): boolean {
  return url.pathname === '/i/grok'
}

/**
 * 在 MAIN world 中执行平滑页面路由跳转（不重载页面，触发 React 路由响应）
 */
export function navigateSearchPage(href: unknown, replace: boolean): boolean {
  if (typeof href !== 'string' || href.length > 4096) return false
  let url: URL
  try {
    url = new URL(href, window.location.origin)
  } catch {
    return false
  }
  if (url.origin !== window.location.origin || !(parseSearchLocation(url.href) || isGrokPage(url))) return false
  const state = replace
    ? window.history.state
    : { key: Math.random().toString(36).slice(2, 8), state: undefined }
  if (replace) window.history.replaceState(state, '', url.pathname + url.search)
  else window.history.pushState(state, '', url.pathname + url.search)
  window.dispatchEvent(new PopStateEvent('popstate', { state }))
  return true
}
