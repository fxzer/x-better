import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import { KeyScheduledPostsCache, KeyScheduledPanorama, KeySidebarColumn, KeyLastTweetSentAt } from '../../storage-keys'
import {
  XF_BRIDGE_MARKER,
  SCHEDULED_TWEETS_TYPE,
  SCHEDULED_TWEET_CREATED_TYPE,
  SCHEDULED_TWEET_DELETED_TYPE,
  FETCH_SCHEDULED_REQ_TYPE,
  TWEET_CREATED_TYPE,
} from '../../shared/bridge'
import { getStorage, setStorage } from '../utilities/storage'
import addStyles, { removeStyles } from '../utilities/addStyles'
import { buildThinScrollbarCss } from '../utilities/scrollbarStyles'
import {
  extractSelectsFromModal,
  buildSmartSchedulerBarHtml,
  bindSmartSchedulerControls,
  getStoredSmartInterval,
} from './smart-scheduler'
import { captureFlipPositions, playFlipAnimation } from './flip-animator'

export { extractSelectsFromModal }

dayjs.extend(relativeTime)

export type DateInput = string | number | Date | dayjs.Dayjs

export interface IntervalTheme {
  category: 'first_soon' | 'first_normal' | 'tight' | 'normal' | 'moderate' | 'long'
  label: string
  bg: string
  accentColor: string
  borderColor: string
  badgeBg: string
}

export interface PersistedScheduledItem {
  restId?: string
  timestamp: number
  formattedTime: string
  text: string
}

/**
 * 格式化相对发布时间
 * 例：43分钟后、1小时后、1小时15分钟后、1天12小时后
 */
export function formatRelativePublishTime(targetDate: Date, now: Date = new Date()): string {
  const diffMs = targetDate.getTime() - now.getTime()
  if (diffMs <= 0) return '即将发布'

  const totalMinutes = Math.floor(diffMs / (60 * 1000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const mins = totalMinutes % 60

  if (days > 0) {
    return hours > 0 ? `${days}天${hours}小时后` : `${days}天后`
  }
  if (hours > 0) {
    return mins > 0 ? `${hours}小时${mins}分钟后` : `${hours}小时后`
  }
  if (mins > 0) {
    return `${mins}分钟后`
  }
  return '1分钟内'
}

/**
 * 兼容导出：格式化相对时间
 */
export function formatTimeAgo(inputTime: DateInput | null | undefined): string {
  if (inputTime === null || inputTime === undefined || inputTime === '')
    return ''

  const formattedTime = dayjs(inputTime)
  if (!formattedTime.isValid())
    return ''

  return formatRelativePublishTime(formattedTime.toDate())
}

/**
 * 将毫秒时间间隔转为易读中文（如：30分钟、1小时15分、1天2小时）
 */
export function formatDurationGap(ms: number): string {
  if (ms < 0) ms = 0
  const totalMinutes = Math.floor(ms / (60 * 1000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const mins = totalMinutes % 60

  if (days > 0) {
    return hours > 0 ? `${days}天${hours}小时` : `${days}天`
  }
  if (hours > 0) {
    return mins > 0 ? `${hours}小时${mins}分` : `${hours}小时`
  }
  return `${mins}分钟`
}

export interface SmartScheduleTime {
  dateTag: string | null
  timeStr: string
  isToday: boolean
}

/**
 * 智能精炼排期时间显示（剥离冗余年份噪音，聚焦当日时间与相对日期）
 */
export function formatSmartScheduleTime(targetDate: Date, now: Date = new Date()): SmartScheduleTime {
  const targetDay = dayjs(targetDate)
  const nowDay = dayjs(now)
  const timeStr = targetDay.format('HH:mm')

  if (targetDay.isSame(nowDay, 'day')) {
    return { dateTag: null, timeStr, isToday: true }
  }

  if (targetDay.isSame(nowDay.add(1, 'day'), 'day')) {
    return { dateTag: '明天', timeStr, isToday: false }
  }

  if (targetDay.isSame(nowDay.add(2, 'day'), 'day')) {
    return { dateTag: '后天', timeStr, isToday: false }
  }

  const isSameYear = targetDay.isSame(nowDay, 'year')
  const dateTag = isSameYear ? targetDay.format('MM-DD') : targetDay.format('YYYY-MM-DD')
  return { dateTag, timeStr, isToday: false }
}

/**
 * 格式化日期分组标签（无 emoji，极简清晰）
 */
export function formatDateGroupLabel(targetDate: Date, now: Date = new Date()): string {
  const targetDay = dayjs(targetDate)
  const nowDay = dayjs(now)

  if (targetDay.isSame(nowDay, 'day')) {
    return `今天 · ${targetDay.format('MM-DD')}`
  }
  if (targetDay.isSame(nowDay.add(1, 'day'), 'day')) {
    return `明天 · ${targetDay.format('MM-DD')}`
  }
  if (targetDay.isSame(nowDay.add(2, 'day'), 'day')) {
    return `后天 · ${targetDay.format('MM-DD')}`
  }

  const isSameYear = targetDay.isSame(nowDay, 'year')
  return isSameYear ? targetDay.format('MM-DD') : targetDay.format('YYYY-MM-DD')
}

/**
 * 根据是否为首条及时间间隔获取视觉配色主题
 */
export function getIntervalTheme(isFirst: boolean, gapMs: number, userIntervalMins: number = getStoredSmartInterval()): IntervalTheme {
  if (isFirst) {
    const hoursFromNow = gapMs / (3600 * 1000)
    if (hoursFromNow <= 2) {
      return {
        category: 'first_soon',
        label: '即将发布',
        bg: 'rgba(16, 185, 129, 0.08)',
        accentColor: 'rgb(16, 185, 129)',
        borderColor: '#10b981',
        badgeBg: 'rgba(16, 185, 129, 0.15)',
      }
    }
    return {
      category: 'first_normal',
      label: '首条排期',
      bg: 'rgba(14, 165, 233, 0.07)',
      accentColor: 'rgb(14, 165, 233)',
      borderColor: '#0ea5e9',
      badgeBg: 'rgba(14, 165, 233, 0.15)',
    }
  }

  const tightThresholdMs = Math.max(20 * 60 * 1000, (userIntervalMins - 10) * 60 * 1000)

  if (gapMs < tightThresholdMs) {
    // 间隔过密（参考用户设置的发帖间隔容差） -> 警示琥珀橙
    return {
      category: 'tight',
      label: '间隔过密',
      bg: 'rgba(245, 158, 11, 0.09)',
      accentColor: 'rgb(245, 158, 11)',
      borderColor: '#f59e0b',
      badgeBg: 'rgba(245, 158, 11, 0.18)',
    }
  }

  const gapHours = gapMs / (3600 * 1000)

  if (gapHours < 8) {
    // 正常间隔 (2 - 8 小时) -> 清新蓝
    return {
      category: 'normal',
      label: '正常间隔',
      bg: 'rgba(59, 130, 246, 0.07)',
      accentColor: 'rgb(59, 130, 246)',
      borderColor: '#3b82f6',
      badgeBg: 'rgba(59, 130, 246, 0.15)',
    }
  }

  if (gapHours < 24) {
    // 半天/跨夜 (8 - 24 小时) -> 靛蓝
    return {
      category: 'moderate',
      label: '跨夜间隔',
      bg: 'rgba(99, 102, 241, 0.07)',
      accentColor: 'rgb(99, 102, 241)',
      borderColor: '#6366f1',
      badgeBg: 'rgba(99, 102, 241, 0.15)',
    }
  }

  // 跨日/长间隔 (≥ 24 小时) -> 优雅紫
  return {
    category: 'long',
    label: '跨日排期',
    bg: 'rgba(168, 85, 247, 0.07)',
    accentColor: 'rgb(168, 85, 247)',
    borderColor: '#a855f7',
    badgeBg: 'rgba(168, 85, 247, 0.15)',
  }
}

/**
 * 解析排期推文文本中的发布时间
 */
export function parseScheduledTimeString(text: string): Date | null {
  if (!text) return null

  // 1. 中文格式（支持年月日、星期、上下午、时分）
  const cnMatch = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?(?:\s*周[一二三四五六日])?\s*(上午|下午|凌晨|中午|晚上|AM|PM)?\s*(\d{1,2}):(\d{2})/i)
  if (cnMatch) {
    const year = parseInt(cnMatch[1], 10)
    const month = parseInt(cnMatch[2], 10) - 1
    const day = parseInt(cnMatch[3], 10)
    const period = cnMatch[4] ? cnMatch[4].toUpperCase() : ''
    let hour = parseInt(cnMatch[5], 10)
    const minute = parseInt(cnMatch[6], 10)

    if (period === '下午' || period === '晚上' || period === 'PM') {
      if (hour < 12) hour += 12
    } else if (period === '上午' || period === '凌晨' || period === 'AM') {
      if (hour === 12) hour = 0
    } else if (period === '中午') {
      if (hour < 12 && hour !== 12) hour += 12
    }

    const date = new Date(year, month, day, hour, minute, 0)
    if (!isNaN(date.getTime())) return date
  }

  // 2. 英文格式
  const months: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

  // 2a. Month Day, Year (如: Sep 20, 2026 at 12:47 AM)
  const enMatch1 = text.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?/i)
  if (enMatch1) {
    const month = months[enMatch1[1].toLowerCase()]
    const day = parseInt(enMatch1[2], 10)
    const year = parseInt(enMatch1[3], 10)
    let hour = parseInt(enMatch1[4], 10)
    const minute = parseInt(enMatch1[5], 10)
    const period = enMatch1[6] ? enMatch1[6].toUpperCase() : ''

    if (period === 'PM' && hour < 12) hour += 12
    if (period === 'AM' && hour === 12) hour = 0

    const date = new Date(year, month, day, hour, minute, 0)
    if (!isNaN(date.getTime())) return date
  }

  // 2b. Day Month Year (如: 20 Sep 2026, 12:47)
  const enMatch2 = text.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*,?\s+(\d{4})\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?/i)
  if (enMatch2) {
    const day = parseInt(enMatch2[1], 10)
    const month = months[enMatch2[2].toLowerCase()]
    const year = parseInt(enMatch2[3], 10)
    let hour = parseInt(enMatch2[4], 10)
    const minute = parseInt(enMatch2[5], 10)
    const period = enMatch2[6] ? enMatch2[6].toUpperCase() : ''

    if (period === 'PM' && hour < 12) hour += 12
    if (period === 'AM' && hour === 12) hour = 0

    const date = new Date(year, month, day, hour, minute, 0)
    if (!isNaN(date.getTime())) return date
  }

  // 3. 标准 ISO / YYYY-MM-DD HH:mm 格式
  const isoMatch = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})/)
  if (isoMatch) {
    const date = new Date(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10), parseInt(isoMatch[4], 10), parseInt(isoMatch[5], 10))
    if (!isNaN(date.getTime())) return date
  }

  return null
}

/**
 * 标准化推文文本（剥离不可见零宽字符、空白及换行，并转小写），用于跨编辑器与 API 间精准比对与前缀查重
 */
export function normalizeTweetSnippet(text: string): string {
  if (!text) return ''
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/**
 * 比较两段推文正文或片段是否匹配（前缀比较、公共前缀匹配或相互包含）
 */
export function isTweetSnippetMatching(a: string, b: string, minChars = 3): boolean {
  const normA = normalizeTweetSnippet(a)
  const normB = normalizeTweetSnippet(b)
  if (!normA || !normB) return false

  // 1. 包含关系（一方被另一方完整包含）
  if (normA.length >= minChars && normB.includes(normA)) return true
  if (normB.length >= minChars && normA.includes(normB)) return true

  // 2. 公共前缀特征匹配（通过内容的前一部分识别同一推文）
  const checkLengths = [15, 12, 10, 8, 6]
  for (const len of checkLengths) {
    if (len >= minChars && normA.length >= len && normB.length >= len) {
      if (normA.slice(0, len) === normB.slice(0, len)) {
        return true
      }
    }
  }

  // 3. 前缀片段包含（一方的前 15 个字被另一方包含）
  const subA = normA.slice(0, 15)
  const subB = normB.slice(0, 15)
  if (subA.length >= minChars && normB.includes(subA)) return true
  if (subB.length >= minChars && normA.includes(subB)) return true

  return false
}

/**
 * 判断文本是否属于 Twitter 发帖编辑器的原生占位符（如“有什么新鲜事？”）
 */
export function isPlaceholderText(text?: string | null): boolean {
  if (!text) return true
  const clean = text.trim()
  if (!clean) return true
  const placeholders = [
    '有什么新鲜事',
    '有什么新鲜事？',
    '有什么新鲜事?',
    '发帖',
    'what is happening',
    'what is happening?!',
    'whats happening',
    "what's happening",
    "what's happening?",
    "what's happening?!",
    '发布你的回复',
    'post your reply',
    '添加另一篇推文',
    'add another post',
    'いまどうしてる',
  ]
  const lower = clean.toLowerCase().replace(/[\s?!？！\r\n]+/g, '')
  return placeholders.some((p) => p.replace(/[\s?!？！\r\n]+/g, '') === lower)
}

/**
 * 从发帖输入框提取真实正文（剥离 DraftJS / Lexical 的 Placeholder 占位符节点）
 */
export function extractTextWithoutPlaceholder(el: HTMLElement): string {
  if (!el) return ''
  try {
    // 1. 若为原生 input/textarea 控件，直接读取 value
    if ('value' in el && typeof (el as any).value === 'string') {
      const val = ((el as any).value as string).trim()
      if (val && !isPlaceholderText(val)) return val
    }

    // 2. 优先提取真实可视文本 innerText（浏览器原生计算的可视区真实输入正文）
    let directText = (el.innerText || el.textContent || '').trim()
    const commonPrefixes = [
      '有什么新鲜事？',
      '有什么新鲜事?',
      '有什么新鲜事',
      "what's happening?",
      "what's happening?!",
      "what's happening",
      'whats happening',
      '发布你的回复',
      'post your reply',
      '添加另一篇推文',
      'add another post',
      'いまどうしてる',
    ]
    for (const prefix of commonPrefixes) {
      if (directText.toLowerCase().startsWith(prefix.toLowerCase())) {
        directText = directText.slice(prefix.length).trim()
        break
      }
    }
    if (directText && !isPlaceholderText(directText)) {
      return directText
    }

    // 3. Draft.js / Lexical 特征提取：真实文字节点通常被标记为 [data-text="true"]
    const dataTextNodes = Array.from(el.querySelectorAll<HTMLElement>('[data-text="true"]'))
    if (dataTextNodes.length > 0) {
      const combined = dataTextNodes
        .map((n) => n.textContent || '')
        .join('')
        .trim()
      if (combined && !isPlaceholderText(combined)) {
        return combined
      }
    }

    // 4. 克隆并剥离明确的占位符元素（避免宽泛的 class*="placeholder" 误删包含真实文字的父容器）
    const clone = el.cloneNode(true) as HTMLElement
    clone
      .querySelectorAll(
        '.public-DraftEditorPlaceholder-root, [data-placeholder], [data-testid="emptyComposerPlaceholder"], [aria-label*="新鲜事"], [aria-label*="happening"]'
      )
      .forEach((p) => p.remove())

    let txt = clone.textContent?.trim() || ''

    for (const prefix of commonPrefixes) {
      if (txt.toLowerCase().startsWith(prefix.toLowerCase())) {
        txt = txt.slice(prefix.length).trim()
        break
      }
    }

    if (isPlaceholderText(txt)) return ''
    return txt
  } catch {
    const raw = el.textContent?.trim() || ''
    return isPlaceholderText(raw) ? '' : raw
  }
}

/**
 * 从页面发帖编辑框实时提取当前正文（彻底过滤“有什么新鲜事？”等占位符干扰）
 */
export function getCurrentComposerText(): string {
  if (typeof document === 'undefined') return ''

  // 优先级选择器列表：覆盖弹窗内与页面内的所有推文输入框变体（支持 querySelectorAll 全量遍历）
  const selectors = [
    // 优先：弹窗内的可编辑真实推文输入框
    '[role="dialog"] [data-testid^="tweetTextarea"][contenteditable="true"]',
    '[role="dialog"] [data-testid="tweetTextarea_0"]',
    '[role="dialog"] [data-testid^="tweetTextarea"]',
    '[role="dialog"] [role="textbox"][contenteditable="true"]',
    '[role="dialog"] .public-DraftEditor-content',
    '[role="dialog"] .DraftEditor-editorContainer [contenteditable="true"]',
    // 其次：主页面内的推文输入框
    '[data-testid^="tweetTextarea"][contenteditable="true"]',
    '[data-testid="tweetTextarea_0"]',
    '[data-testid^="tweetTextarea"]',
    '[role="textbox"][contenteditable="true"]',
    '.public-DraftEditor-content',
    '.DraftEditor-editorContainer [contenteditable="true"]',
  ]

  for (const sel of selectors) {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(sel))
    for (const el of elements) {
      // 排除排期看板或控件自身的输入框/按钮
      if (el.closest('.xf-schedule-picker-overview, .xf-smart-scheduler-bar, .xf-sidebar-scheduled-panorama')) {
        continue
      }
      const txt = extractTextWithoutPlaceholder(el)
      if (txt && !isPlaceholderText(txt)) {
        try {
          sessionStorage.setItem('xf_last_composer_text', txt)
        } catch {}
        return txt
      }
    }
  }

  // 若当前 DOM 节点因选时间安排表遮罩层叠而被临时隐藏或卸载，回退读取会话中即时保存的最后正文
  try {
    const cached = sessionStorage.getItem('xf_last_composer_text') || ''
    if (cached && !isPlaceholderText(cached)) {
      return cached.trim()
    }
  } catch {}

  return ''
}

/**
 * 清除当前会话中记录的被编辑排期推文目标
 */
export function clearCurrentEditingScheduledTarget(): void {
  try {
    sessionStorage.removeItem('xf_current_editing_target')
  } catch {}
}

/**
 * 智能解析当前选时间弹窗正在修改的排期推文对象：
 * 多重策略识别：0. modal 自身锁定 -> 1. 全景点击直达记录 -> 2. 发帖编辑框内容前缀匹配 -> 3. 原生 indicator 排期时间匹配 -> 4. 弹窗挂载初始时间戳匹配
 */
export function resolveCurrentEditingItem(
  items: PersistedScheduledItem[],
  modal?: HTMLElement | null
): PersistedScheduledItem | null {
  if (!items || items.length === 0) return null

  // 1. 优先提取当前发帖框中的真实文本
  const composerText = getCurrentComposerText()
  const validComposerText = isPlaceholderText(composerText) ? '' : composerText.trim()

  // 核心反向校验铁律：
  // 若用户在发帖编辑框中敲下了非占位文字（长度 >= 3），且该文本与列表中所有的已有排期推文正文没有任何重叠匹配，
  // 这 100% 是用户新建的一条全新推文！
  // 坚决返回 null，彻底杜绝因默认时间相近或残留目标而误判为修改已有排期推文！
  if (validComposerText && validComposerText.length >= 3) {
    const matchesAny = items.some((it) => isTweetSnippetMatching(it.text, validComposerText, 3))
    if (!matchesAny) {
      if (modal) {
        delete modal.dataset.xfEditingRestId
        delete modal.dataset.xfEditingTimestamp
        delete modal.dataset.xfEditingTextSnippet
      }
      return null
    }
  }

  // 策略 0：优先读取 modal 自身已锁定的编辑目标（用户在弹窗内无论怎么调年、月、日、时、分，目标绝不丢失）
  if (modal?.dataset?.xfEditingRestId) {
    const found = items.find((it) => it.restId && it.restId === modal.dataset.xfEditingRestId)
    if (found) return found
  }
  if (modal?.dataset?.xfEditingTimestamp) {
    const ts = Number(modal.dataset.xfEditingTimestamp)
    if (!isNaN(ts) && ts > 0) {
      const found = items.find((it) => Math.abs(it.timestamp - ts) < 60000)
      if (found) return found
    }
  }
  if (modal?.dataset?.xfEditingTextSnippet && modal.dataset.xfEditingTextSnippet.length >= 3) {
    const found = items.find((it) => isTweetSnippetMatching(it.text, modal.dataset.xfEditingTextSnippet!, 3))
    if (found) return found
  }

  let foundItem: PersistedScheduledItem | null = null

  // 策略 1：读取排期全景点击或自动直达时写入的明确编辑目标
  try {
    const rawTarget =
      sessionStorage.getItem('xf_current_editing_target') ||
      sessionStorage.getItem('xf_auto_open_scheduled_target')
    if (rawTarget) {
      const target = JSON.parse(rawTarget) as {
        restId?: string
        timestamp?: number
        textSnippet?: string
      }
      if (target) {
        if (target.restId) {
          foundItem = items.find((it) => it.restId && it.restId === target.restId) || null
        }
        if (!foundItem && target.textSnippet && target.textSnippet.length >= 3) {
          foundItem = items.find((it) => isTweetSnippetMatching(it.text, target.textSnippet!, 3)) || null
        }
        if (!foundItem && target.timestamp && (!validComposerText || (target.textSnippet && isTweetSnippetMatching(validComposerText, target.textSnippet, 3)))) {
          foundItem = items.find((it) => {
            const timeDiff = Math.abs(it.timestamp - target.timestamp!)
            if (timeDiff >= 60000) return false
            if (target.textSnippet && target.textSnippet.length >= 3) {
              return isTweetSnippetMatching(it.text, target.textSnippet, 3)
            }
            return true
          }) || null
        }
      }
    }
  } catch {}

  // 策略 2：通过页面发帖编辑框真实文本匹配（过滤占位符）
  if (!foundItem && validComposerText && validComposerText.length >= 3) {
    foundItem = items.find((it) => isTweetSnippetMatching(it.text, validComposerText, 3)) || null
  }

  // 策略 3：通过发帖弹窗或页面的 scheduledTweetIndicator 获取原始排期时间匹配（仅在发帖框没有输入新文本时生效）
  if (!foundItem && !validComposerText) {
    try {
      const indicator = document.querySelector<HTMLElement>('[data-testid="scheduledTweetIndicator"]')
      if (indicator?.textContent) {
        const origDate = parseScheduledTimeString(indicator.textContent)
        if (origDate && !isNaN(origDate.getTime())) {
          const origTs = origDate.getTime()
          foundItem = items.find((it) => Math.abs(it.timestamp - origTs) < 60000) || null
        }
      }
    } catch {}
  }

  // 彻底移除依据安排表初始时间戳粗暴匹配已有条目的策略 4，杜绝发帖默认时间碰巧相近时的恶性误判

  // 将识别到的被编辑条目锁定到 modal 上，后续变更日期（月、日、时、分）时稳定识别
  if (foundItem && modal) {
    if (foundItem.restId) modal.dataset.xfEditingRestId = foundItem.restId
    modal.dataset.xfEditingTimestamp = String(foundItem.timestamp)
    if (foundItem.text) modal.dataset.xfEditingTextSnippet = foundItem.text.slice(0, 40)
  }

  return foundItem
}

/**
 * 读取持久化保存的排期列表缓存。
 * 优先读 chrome.storage.local；为空时回退读 MAIN world 拦截器写入的
 * sessionStorage 条目快照（postMessage → storage 链路丢失/晚注册时兜底）。
 */
export async function getPersistedScheduledPosts(): Promise<PersistedScheduledItem[]> {
  // 1. chrome.storage.local 缓存
  try {
    const raw = await getStorage(KeyScheduledPostsCache)
    if (Array.isArray(raw)) return raw as PersistedScheduledItem[]
    if (typeof raw === 'string' && raw) {
      const items = JSON.parse(raw) as PersistedScheduledItem[]
      if (Array.isArray(items)) return items
    }
  } catch {}

  // 2. sessionStorage 快照回退
  try {
    const snapshot = sessionStorage.getItem('xf_scheduled_items_last')
    if (snapshot) {
      const raw = JSON.parse(snapshot) as Array<{ restId: string; timestamp: number; text: string }>
      if (Array.isArray(raw)) {
        const minValidTime = Date.now() - 24 * 3600 * 1000
        return raw
          .filter((item) => typeof item.timestamp === 'number' && !isNaN(item.timestamp) && item.timestamp > minValidTime)
          .map((item) => ({
            restId: item.restId,
            timestamp: item.timestamp,
            formattedTime: dayjs(new Date(item.timestamp)).format('YYYY-MM-DD HH:mm'),
            text: item.text,
          }))
          .sort((a, b) => a.timestamp - b.timestamp)
      }
    }
  } catch {}

  // 3. localStorage 快照回退
  try {
    const lsRaw = localStorage.getItem('xf_scheduled_items_last') || localStorage.getItem(KeyScheduledPostsCache)
    if (lsRaw) {
      const raw = JSON.parse(lsRaw)
      if (Array.isArray(raw)) {
        const minValidTime = Date.now() - 24 * 3600 * 1000
        return raw
          .filter((item: any) => typeof item.timestamp === 'number' && !isNaN(item.timestamp) && item.timestamp > minValidTime)
          .map((item: any) => ({
            restId: item.restId,
            timestamp: item.timestamp,
            formattedTime: dayjs(new Date(item.timestamp)).format('YYYY-MM-DD HH:mm'),
            text: item.text || '',
          }))
          .sort((a: any, b: any) => a.timestamp - b.timestamp)
      }
    }
  } catch {}

  return []
}

/**
 * 持久化保存排期列表缓存
 */
export async function persistScheduledPosts(items: PersistedScheduledItem[]) {
  try {
    await setStorage({ [KeyScheduledPostsCache]: JSON.stringify(items) })
  } catch {}
  try {
    localStorage.setItem(KeyScheduledPostsCache, JSON.stringify(items))
    localStorage.removeItem('xf_scheduled_posts_cache')
  } catch {}
}

/**
 * 自动清理已到期/过去的时间戳项
 */
export async function prunePastScheduledPosts() {
  try {
    const raw = await getStorage(KeyScheduledPostsCache)
    if (typeof raw === 'string' && raw) {
      const items = JSON.parse(raw) as PersistedScheduledItem[]
      if (Array.isArray(items) && items.length) {
        const now = Date.now()
        const valid = items.filter((item) => item.timestamp > now)
        if (valid.length !== items.length) {
          await persistScheduledPosts(valid)
        }
      }
    }
  } catch {}
}

let lastScheduledPruneAt = 0
const SCHEDULED_PRUNE_INTERVAL_MS = 60 * 1000

export function maintainScheduledPostsCache(): void {
  const now = Date.now()
  if (now - lastScheduledPruneAt < SCHEDULED_PRUNE_INTERVAL_MS) return
  lastScheduledPruneAt = now
  void prunePastScheduledPosts()
}

/**
 * 串行互斥锁：确保并发的 upsertScheduledPost 调用不会同时读写 storage，
 * 防止"安排表"DOM 监听器与 API postMessage 监听器同时触发时写入重复条目。
 */
let _upsertMutex: Promise<void> = Promise.resolve()

/**
 * 插入或更新单条排期数据（去重防重复并自动重绘排期全景）
 * 内部通过 mutex 串行化，避免并发竞争导致重复写入。
 */
export function upsertScheduledPost(newItem: {
  restId?: string
  timestamp: number
  text: string
  formattedTime?: string
}): Promise<void> {
  _upsertMutex = _upsertMutex.then(() => _doUpsertScheduledPost(newItem))
  return _upsertMutex
}

async function _doUpsertScheduledPost(newItem: {
  restId?: string
  timestamp: number
  text: string
  formattedTime?: string
}) {
  const now = Date.now()
  if (!newItem.timestamp || isNaN(newItem.timestamp) || newItem.timestamp <= now) return

  const items = await getPersistedScheduledPosts()
  const formattedTime =
    newItem.formattedTime || dayjs(new Date(newItem.timestamp)).format('YYYY-MM-DD HH:mm')

  // 查重：优先匹配 restId；若无 restId，仅按时间戳接近度（60s 内）去重。
  // 注意：不依赖文本比较——X 的 DraftJS 编辑器会在 textarea.textContent 中插入
  // 零宽空格等不可见 Unicode 字符，导致 DOM 捕获的文本与 API 请求体文本不相等，
  // 进而使 it.text === newItem.text 即使视觉完全相同也会返回 false，造成重复写入。
  const existingIdx = items.findIndex((it) => {
    if (newItem.restId && it.restId && newItem.restId === it.restId) return true
    const diff = Math.abs(it.timestamp - newItem.timestamp)
    if (diff < 60000) return true
    return false
  })

  if (existingIdx >= 0) {
    items[existingIdx] = {
      ...items[existingIdx],
      restId: newItem.restId || items[existingIdx].restId,
      timestamp: newItem.timestamp,
      formattedTime,
      text: newItem.text || items[existingIdx].text,
    }
  } else {
    items.push({
      restId: newItem.restId,
      timestamp: newItem.timestamp,
      formattedTime,
      text: newItem.text || '',
    })
  }

  items.sort((a, b) => a.timestamp - b.timestamp)
  await persistScheduledPosts(items)
  clearCurrentEditingScheduledTarget()
  await attachSidebarScheduledPanorama()
}

/**
 * 根据 ID 删除单条排期推文缓存并自动重绘
 */
export async function deleteScheduledPost(restId: string) {
  if (!restId) return
  const items = await getPersistedScheduledPosts()
  const filtered = items.filter((it) => it.restId !== restId)
  if (filtered.length !== items.length) {
    await persistScheduledPosts(filtered)
    await attachSidebarScheduledPanorama()
  }
}

/**
 * 监听来自 MAIN world fetch 拦截器的 postMessage，
 * 接收全量、新增或删除的排期数据并持久化到 storage，同时即时重绘排期看板。
 * 应在插件初始化时调用一次。
 */
export function listenForScheduledTweetsApi() {
  // 与主世界拦截器共用同一个调试开关：window.__XF_DEBUG_SCHEDULED__
  const debug = () =>
    !!(window as unknown as { __XF_DEBUG_SCHEDULED__?: boolean }).__XF_DEBUG_SCHEDULED__

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    if (!event.data || typeof event.data !== 'object') return
    if (event.data.__xf !== XF_BRIDGE_MARKER) return

    const { type, payload } = event.data

    try {
      if (type === SCHEDULED_TWEETS_TYPE) {
        // 全量同步（来自 FetchScheduledTweets）
        const raw = payload as Array<{
          restId: string
          timestamp: number
          text: string
        }>
        if (!Array.isArray(raw)) return

        if (debug()) console.log('[X Focus 排期持久化] 收到全量广播', raw.length, '条', raw)

        // 允许空数组：接口返回空列表时同样持久化，清掉已删除排期的旧缓存
        const items: PersistedScheduledItem[] = raw
          .filter((item) => typeof item.timestamp === 'number' && !isNaN(item.timestamp))
          .map((item) => ({
            restId: item.restId,
            timestamp: item.timestamp,
            formattedTime: dayjs(new Date(item.timestamp)).format('YYYY-MM-DD HH:mm'),
            text: item.text,
          }))
          .sort((a, b) => a.timestamp - b.timestamp)

        void persistScheduledPosts(items).then(() => {
          if (debug()) console.log('[X Focus 排期持久化] 已写入 storage 并即时重绘', items.length, '条')
          void attachSidebarScheduledPanorama()
        })
      } else if (type === SCHEDULED_TWEET_CREATED_TYPE) {
        // 单条新建（来自 CreateScheduledTweet）
        const item = payload as { restId?: string; timestamp: number; text: string }
        if (item && typeof item.timestamp === 'number') {
          if (debug()) console.log('[X Focus 排期持久化] 收到新建排期广播', item)
          void upsertScheduledPost(item)
        }
      } else if (type === SCHEDULED_TWEET_DELETED_TYPE) {
        // 单条删除（来自 DeleteScheduledTweet）
        const { scheduledTweetId } = (payload as { scheduledTweetId?: string }) || {}
        if (scheduledTweetId) {
          if (debug()) console.log('[X Focus 排期持久化] 收到删除排期广播', scheduledTweetId)
          void deleteScheduledPost(scheduledTweetId)
        }
      } else if (type === TWEET_CREATED_TYPE) {
        // 推文发布事件（来自 CreateTweet / CreateNoteTweet）
        const { sentAt, isReply } = (payload as { sentAt?: number; isReply?: boolean }) || {}
        if (typeof sentAt === 'number' && sentAt > 0 && !isReply) {
          if (debug()) console.log('[X Focus 排期持久化] 收到即时推文发布事件', sentAt)
          void setStorage({ [KeyLastTweetSentAt]: sentAt })
          try {
            localStorage.setItem(KeyLastTweetSentAt, String(sentAt))
            localStorage.setItem('xf_last_tweet_sent_at', String(sentAt))
          } catch {}
          notifyScheduledPostsChanged()
        }
      }
    } catch (e) {
      if (debug()) console.warn('[X Focus 排期持久化] 处理失败', e)
    }
  })
}

/**
 * 同步从 localStorage 获取最近一次即时推文发布时间戳
 */
export function getLastTweetSentAtSync(): number {
  if (typeof localStorage !== 'undefined') {
    try {
      const ls = localStorage.getItem(KeyLastTweetSentAt) || localStorage.getItem('xf_last_tweet_sent_at')
      if (ls) {
        const num = parseInt(ls, 10)
        if (!isNaN(num) && num > 0) return num
      }
    } catch {}
  }
  return 0
}

/**
 * 异步从 storage / localStorage 获取最近一次即时推文发布时间戳
 */
export async function getLastTweetSentAt(): Promise<number> {
  const syncVal = getLastTweetSentAtSync()
  if (syncVal > 0) return syncVal
  try {
    const raw = await getStorage(KeyLastTweetSentAt)
    if (typeof raw === 'number' && !isNaN(raw) && raw > 0) return raw
    if (typeof raw === 'string' && raw) {
      const num = parseInt(raw, 10)
      if (!isNaN(num) && num > 0) return num
    }
  } catch {}
  return 0
}

let lastActiveSyncTime = 0
export function resetActiveSyncCooldownForTest(): void {
  lastActiveSyncTime = 0
}

/**
 * 呼出排期弹窗时静默向 X 接口发起最新排期同步（带冷却防抖，避免重复高频请求）
 */
export function silentSyncScheduledPostsWithCooldown(cooldownMs: number = 5000): void {
  const now = Date.now()
  if (now - lastActiveSyncTime < cooldownMs) return
  lastActiveSyncTime = now
  requestActiveScheduledSync()
}

/**
 * 当排期缓存或发帖时间戳变更时，跨标签页通知当前页面已挂载的排期浮动面板与侧边栏看板刷新
 */
export function notifyScheduledPostsChanged(): void {
  // 1. 若当前页面存在浮动排期面板，重置其插槽缓存并重绘
  const floatingPanel = document.querySelector<HTMLElement>('.xf-schedule-modal-floating-panel')
  if (floatingPanel) {
    ;(floatingPanel as any).__xf_cached_slots = null
    ;(floatingPanel as any).__xf_cached_day_slots = null
    const scheduleModal = (
      Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).find((m) =>
        isSchedulePickerModal(m)
      )
    )
    if (scheduleModal) {
      void renderSchedulePickerOverview(scheduleModal, floatingPanel)
    }
  }

  // 2. 若存在侧边栏排期看板，自动重绘
  void attachSidebarScheduledPanorama()

  // 3. 若处于已排期推文列表，更新相对时间
  void addScheduledRelativeTimes()
}

/**
 * 向主世界拦截器发送主动全量拉取排期数据的请求（GraphQL FetchScheduledTweets）
 */
export function requestActiveScheduledSync(): void {
  if (typeof window === 'undefined') return
  try {
    window.postMessage(
      {
        type: FETCH_SCHEDULED_REQ_TYPE,
        __xf: XF_BRIDGE_MARKER,
      },
      '*',
    )
  } catch {}
}

let isComposerSubmitWatcherAttached = false

/**
 * 监听发帖弹窗或内联编辑器的“安排表”提交操作，
 * 在用户点击发送定时推文且弹窗顺利关闭后，即时乐观更新排期看板。
 */
export function attachComposerScheduleSubmitWatcher(): void {
  if (isComposerSubmitWatcherAttached) return
  if (typeof document === 'undefined') return
  isComposerSubmitWatcherAttached = true

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement | null
      if (!target) return

      const tweetBtn = target.closest<HTMLElement>(
        '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'
      )
      if (!tweetBtn) return

      // 检查当前提交是否为定时排期推文（存在排期提示指示器或按钮文案为“安排表”/“Schedule”）
      const dialog = tweetBtn.closest('[role="dialog"]')
      const composerScope = dialog || tweetBtn.closest('[data-testid="composer"]') || document

      const indicator =
        composerScope.querySelector<HTMLElement>('[data-testid="scheduledTweetIndicator"]') ||
        document.querySelector<HTMLElement>('[data-testid="scheduledTweetIndicator"]')

      const btnText = tweetBtn.textContent?.trim() || ''
      const isScheduleBtn =
        btnText.includes('安排表') ||
        btnText.includes('Schedule') ||
        Boolean(indicator)

      if (!isScheduleBtn || !indicator) return

      const indicatorText = indicator.textContent?.trim() || ''
      const targetDate = parseScheduledTimeString(indicatorText)
      if (!targetDate || isNaN(targetDate.getTime()) || targetDate.getTime() <= Date.now()) return

      const textarea = composerScope.querySelector<HTMLElement>(
        '[data-testid^="tweetTextarea"], [role="textbox"], .public-DraftEditor-content'
      )
      const tweetText = textarea?.textContent?.trim() || ''
      const targetTimestamp = targetDate.getTime()

      if (dialog) {
        // 弹窗模式：轮询检测 dialog 是否被顺利关闭（关闭代表成功提交）
        let checks = 0
        const pollTimer = setInterval(() => {
          checks++
          if (!document.contains(dialog)) {
            clearInterval(pollTimer)
            void upsertScheduledPost({
              timestamp: targetTimestamp,
              text: tweetText,
            })
          } else if (checks > 30) {
            clearInterval(pollTimer)
          }
        }, 150)
      } else {
        // 内联模式：发推成功后 indicator 会消失
        setTimeout(() => {
          const stillActive = document.querySelector('[data-testid="scheduledTweetIndicator"]')
          if (!stillActive) {
            void upsertScheduledPost({
              timestamp: targetTimestamp,
              text: tweetText,
            })
          }
        }, 500)
      }
    },
    true // 捕获阶段，确保先于 X 的 DOM 销毁拦截到原始数据
  )
}

/**
 * 根据排期文本计算相对时间字符串
 */
export function getScheduledRelativeTime(text: string): string | null {
  const date = parseScheduledTimeString(text)
  if (!date) return null
  return formatRelativePublishTime(date)
}

/**
 * 清除页面上由排期全景功能注入的所有 DOM 元素与样式
 */
export function removeScheduledPanorama() {
  document.querySelectorAll('.xf-schedule-picker-overview').forEach((el) => el.remove())
  document.querySelectorAll('.xf-schedule-modal-floating-panel').forEach((el) => el.remove())
  document.querySelectorAll('.xf-modal-header-right-badge').forEach((el) => el.remove())
  document.querySelectorAll('.xf-scheduled-right-box').forEach((el) => el.remove())
  removeSidebarScheduledPanorama()
  removeStyles('scheduledPanoramaStyles')
  document.querySelectorAll('[data-testid="unsentTweet"]').forEach((card) => {
    const cardEl = card as HTMLElement
    cardEl.style.backgroundColor = ''
    cardEl.style.borderTop = ''
    cardEl.style.borderBottom = ''
    delete cardEl.dataset.xfLayoutStyled
  })
}

/**
 * 在每个排期帖子右上角（同一行，两端对齐）展示相对时间
 * 持久化数据由 listenForScheduledTweetsApi() 通过 API 拦截完成，此处不再重复写入
 */
export async function addScheduledRelativeTimes(state?: string | number | boolean) {
  try {
    if (state === 'off' || state === 'hide') {
      removeScheduledPanorama()
      return
    }
    if (state === undefined) {
      const stored = await getStorage(KeyScheduledPanorama)
      if (stored === 'off' || stored === 'hide') {
        removeScheduledPanorama()
        return
      }
    }
    const unsentTweets = document.querySelectorAll('[data-testid="unsentTweet"]')
    if (unsentTweets.length) {
      const scheduledItems: Array<{ card: HTMLElement, date: Date, textSpan: Element }> = []

      unsentTweets.forEach((card) => {
        const cardEl = card as HTMLElement
        const textSpan = Array.from(cardEl.querySelectorAll('span, div')).find(el => {
          return el.children.length === 0 && (el.textContent?.includes('将于') || el.textContent?.includes('Will send on'))
        })

        if (!textSpan) return

        const textContent = textSpan.textContent || ''
        const date = parseScheduledTimeString(textContent)
        if (date) {
          scheduledItems.push({ card: cardEl, date, textSpan })
        }
      })

      if (scheduledItems.length) {
        // 按发布时间从早到晚排序
        scheduledItems.sort((a, b) => a.date.getTime() - b.date.getTime())

        const now = new Date()

        scheduledItems.forEach((item, index) => {
          const { card, date, textSpan } = item
          // eslint-disable-next-line @typescript-eslint/no-unused-vars

          const isFirst = index === 0
          const prevDate = isFirst ? null : scheduledItems[index - 1].date
          const gapMs = isFirst ? Math.max(0, date.getTime() - now.getTime()) : Math.max(0, date.getTime() - (prevDate?.getTime() ?? now.getTime()))

          const theme = getIntervalTheme(isFirst, gapMs)
          const relTimeStr = formatRelativePublishTime(date, now)
          const gapStr = isFirst ? '' : formatDurationGap(gapMs)

          card.style.position = 'relative'
          card.style.backgroundColor = theme.bg
          card.style.borderTop = `1px solid ${theme.borderColor}55`
          card.style.borderBottom = ''
          card.style.transition = 'background-color 0.2s ease, border-color 0.2s ease'

          if (card.parentElement && card.parentElement.tagName === 'BUTTON') {
            const btn = card.parentElement as HTMLElement
            btn.style.backgroundColor = 'transparent'
          }

          const dirEl = (textSpan.closest('div[dir="ltr"]') || textSpan.parentElement) as HTMLElement
          const leftBox = (dirEl.parentElement as HTMLElement) || dirEl
          const topRow = (leftBox.parentElement as HTMLElement) || leftBox

          // 布局样式每 tick 相同，只在首次设置一次，避免 cssText += 无限增长
          if (!card.dataset.xfLayoutStyled) {
            card.dataset.xfLayoutStyled = '1'
            topRow.style.cssText += 'display: flex !important; flex-direction: row !important; justify-content: space-between !important; align-items: center !important; width: 100% !important;'
            leftBox.style.cssText += 'display: inline-flex !important; align-items: center !important; flex-shrink: 1 !important; overflow: hidden !important;'
            dirEl.style.cssText += 'display: inline-flex !important; align-items: center !important; gap: 4px !important;'
          }

          if (topRow.parentElement && topRow.parentElement !== card) {
            (topRow.parentElement as HTMLElement).style.width = '100%'
          }

          let rightBox = topRow.querySelector('.xf-scheduled-right-box') as HTMLElement | null
          if (!rightBox) {
            rightBox = document.createElement('div')
            rightBox.className = 'xf-scheduled-right-box'
            topRow.appendChild(rightBox)
          }

          rightBox.style.cssText = `
            display: inline-flex !important;
            align-items: center !important;
            gap: 6px !important;
            margin-left: auto !important;
            flex-shrink: 0 !important;
            white-space: nowrap !important;
          `

          let relBadge = rightBox.querySelector('.xf-scheduled-relative-text') as HTMLElement | null
          if (!relBadge) {
            relBadge = document.createElement('span')
            relBadge.className = 'xf-scheduled-relative-text'
            rightBox.appendChild(relBadge)
          }

          relBadge.style.cssText = `
            display: inline-block !important;
            font-size: 13px !important;
            font-weight: 600 !important;
            color: ${theme.accentColor} !important;
            background-color: ${theme.badgeBg} !important;
            border: 1px solid ${theme.borderColor}44 !important;
            padding: 2px 8px !important;
            border-radius: 12px !important;
            line-height: 16px !important;
            white-space: nowrap !important;
          `
          relBadge.textContent = relTimeStr

          // 清理旧版本可能残留在 rightBox 内的 gapBadge
          rightBox.querySelector('.xf-scheduled-gap-badge')?.remove()

          let gapBadge = card.querySelector('.xf-scheduled-gap-badge') as HTMLElement | null
          if (isFirst) {
            if (gapBadge) gapBadge.remove()
          } else {
            if (!gapBadge) {
              gapBadge = document.createElement('span')
              gapBadge.className = 'xf-scheduled-gap-badge'
              card.appendChild(gapBadge)
            }
            const gapText = theme.category === 'tight' ? `⚠️ 间隔 ${gapStr}` : `间隔 ${gapStr}`

            // 检测主题底色（兼容纯黑 Lights Out、暗蓝 Dim 与白色高亮）
            const isLightsOut = typeof document !== 'undefined' && document.body?.style?.backgroundColor?.includes('rgb(0, 0, 0)')
            const isDim = typeof document !== 'undefined' && document.body?.style?.backgroundColor?.includes('rgb(21, 32, 43)')
            const isDark = isLightsOut || isDim || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)')?.matches && !document.body?.style?.backgroundColor?.includes('rgb(255, 255, 255)'))
            const badgeBgColor = isLightsOut ? '#000000' : isDim ? 'rgb(21, 32, 43)' : '#ffffff'

            gapBadge.style.cssText = `
              position: absolute !important;
              top: 0 !important;
              left: 50% !important;
              transform: translate(-50%, -50%) !important;
              z-index: 2 !important;
              display: inline-flex !important;
              align-items: center !important;
              justify-content: center !important;
              font-size: 11px !important;
              font-weight: 600 !important;
              color: ${theme.accentColor} !important;
              background-color: ${badgeBgColor} !important;
              border: 1px solid ${theme.borderColor}66 !important;
              padding: 1px 10px !important;
              border-radius: 9999px !important;
              line-height: 16px !important;
              white-space: nowrap !important;
              box-shadow: 0 1px 4px rgba(0, 0, 0, ${isDark ? '0.35' : '0.08'}) !important;
              pointer-events: none !important;
            `
            gapBadge.textContent = gapText
          }
        })
      }
    }

    // 同时尝试检测并装载“安排表”选时间弹窗看板
    void attachSchedulePickerOverview()
    // 仅在非排除页面装载右侧栏或悬浮侧边排期看板（发帖弹窗下若底层为常规页面则保留展示）
    const effectivePath = getEffectiveBasePagePath()
    const currentPath = window.location.pathname.toLowerCase()
    if (
      !isScheduledPanoramaExcludedPath(effectivePath) &&
      !currentPath.includes('/unsent') &&
      !document.querySelector('[data-testid="unsentTweet"]')
    ) {
      void attachSidebarScheduledPanorama()
    } else {
      removeSidebarScheduledPanorama()
    }
  } catch {}
}



/**
 * 解析“安排表”弹窗中当前选中的 Date
 */
export function getPickedTimeFromModal(modal: Element): Date | null {
  try {
    // 1. 优先从原生 select 获取当前值（用户直接操作的交互源头，实时无延迟）
    const { selYear, selMonth, selDay, selHour, selMinute } = extractSelectsFromModal(modal)

    if (
      selYear?.value &&
      selMonth?.value &&
      selDay?.value &&
      selHour?.value !== undefined &&
      selHour?.value !== '' &&
      selMinute?.value !== undefined &&
      selMinute?.value !== ''
    ) {
      const y = parseInt(selYear.value, 10)
      const m = parseInt(selMonth.value, 10) - 1
      const d = parseInt(selDay.value, 10)
      const h = parseInt(selHour.value, 10)
      const min = parseInt(selMinute.value, 10)
      const dt = new Date(y, m, d, h, min, 0)
      if (!isNaN(dt.getTime())) return dt
    }

    // 2. 备选：从原生 input[type="date"] 与 input[type="time"] 获取
    const dateInput = modal.querySelector('input[type="date"]') as HTMLInputElement | null
    const timeInput = modal.querySelector('input[type="time"]') as HTMLInputElement | null
    if (dateInput?.value && timeInput?.value) {
      const [y, m, d] = dateInput.value.split('-').map(Number)
      const [h, min] = timeInput.value.split(':').map(Number)
      const dt = new Date(y, m - 1, d, h, min, 0)
      if (!isNaN(dt.getTime())) return dt
    }

    // 3. 兜底：从弹窗顶部“将于 ... 发布”文案中解析
    const headerEl = Array.from(modal.querySelectorAll('div[dir="ltr"], span, div')).find((el) => {
      const text = el.textContent || ''
      return (
        (text.includes('将于') || text.includes('Will send on')) &&
        (!el.firstElementChild || el.firstElementChild.tagName === 'SPAN')
      )
    })
    if (headerEl?.textContent) {
      const parsed = parseScheduledTimeString(headerEl.textContent)
      if (parsed && !isNaN(parsed.getTime())) return parsed
    }

    return null
  } catch {
    return null
  }
}

/**
 * 严格判断某个弹窗是否为真正的 Twitter 发帖“安排表”弹窗
 * 严防误判：
 * 1. 绝对一票否决：高级搜索、搜索筛选等弹窗（含年月日范围与语言选择，极易被多 select 规则误命中）；
 * 2. 必须具备发帖安排表独有的“时、分”选择器或排期语义（高级搜索绝无时分控件）；
 * 3. 杜绝单纯根据 select 数量推断，杜绝乱插入非排期弹窗。
 */
export function isSchedulePickerModal(modal: Element | null): boolean {
  if (!modal) return false

  const headerText = (
    modal.querySelector('#modal-header')?.textContent ||
    modal.querySelector('h2')?.textContent ||
    ''
  ).trim()

  const fullText = (modal.textContent || '').slice(0, 1500)

  // 1. 一票否决：高级搜索与搜索筛选弹窗
  const isSearchModal =
    headerText.includes('高级搜索') ||
    headerText.includes('進階搜尋') ||
    headerText.includes('Advanced search') ||
    headerText.includes('高度な検索') ||
    headerText.includes('搜索筛选') ||
    headerText.includes('Search filters') ||
    fullText.includes('排除这些词语') ||
    fullText.includes('包含所有这些词语') ||
    fullText.includes('这些话题标签') ||
    fullText.includes('None of these words') ||
    fullText.includes('All of these words') ||
    fullText.includes('These hashtags') ||
    fullText.includes('从这些账号') ||
    fullText.includes('From these accounts') ||
    modal.querySelector('[data-testid="searchButton"]') !== null ||
    modal.querySelector('input[name*="Search"]') !== null ||
    Boolean(
      modal.querySelector('input[type="text"]') &&
      Array.from(modal.querySelectorAll('button, [role="button"]')).some((btn) => {
        const t = btn.textContent?.trim() || ''
        return t === '搜索' || t === 'Search' || t === '検索'
      })
    )

  if (isSearchModal) {
    return false
  }

  // 2. 其它非排期弹窗一票否决（如注销确认、账号切换、封禁屏蔽确认等）
  if (
    headerText.includes('注销') ||
    headerText.includes('Log out') ||
    headerText.includes('屏蔽') ||
    headerText.includes('Block')
  ) {
    return false
  }

  // 3. 提取表单时间与时分选择控件（发帖安排表必须具备时、分输入能力）
  const { selHour, selMinute } = extractSelectsFromModal(modal)
  const hasTimeInput = (Boolean(selHour) && Boolean(selMinute)) || Boolean(modal.querySelector('input[type="time"]'))

  // 4. 标题与语义特征判定
  const hasScheduleTitle =
    headerText.includes('安排表') ||
    headerText.includes('安排推文') ||
    headerText.includes('排期') ||
    headerText.includes('排程') ||
    headerText.includes('Schedule') ||
    headerText.includes('schedule') ||
    headerText.includes('予約') ||
    headerText.includes('예약') ||
    headerText.includes('Programar') ||
    headerText.includes('Programmer') ||
    headerText.includes('Planen')

  const hasScheduleLeadText =
    fullText.includes('将于') ||
    fullText.includes('Will send on') ||
    fullText.includes('に送信されます')

  const hasTimezoneText =
    fullText.includes('中国标准时间') ||
    fullText.includes('Standard Time') ||
    fullText.includes('时区') ||
    fullText.includes('Time zone')

  const hasInputs = !!modal.querySelector('select, input[type="date"], input[type="time"]')

  // 规则 A：明确包含排期标题，并且具备表单控件
  if (hasScheduleTitle && (hasTimeInput || hasTimezoneText || hasScheduleLeadText || hasInputs)) {
    return true
  }

  // 规则 B：标题未命中（国际化未知语言），但具备“将于发布”前导文案且具备时分或时间控件
  if (hasScheduleLeadText && (hasTimeInput || hasInputs)) {
    return true
  }

  // 规则 C：国际化纯表单兜底（必须同时具备时、分选择器和至少 3 个 select 控件）
  if (hasTimeInput && modal.querySelectorAll('select').length >= 3) {
    return true
  }

  return false
}

/**
 * 动态计算并定位弹窗右侧独立排期全景悬浮面板（穿透遮罩层，开阔全屏视野）
 */
export function positionFloatingSchedulePanel(modal: HTMLElement, panel: HTMLElement) {
  if (!modal || !panel) return

  const modalRect = modal.getBoundingClientRect()
  const viewportWidth = (typeof window !== 'undefined' && window.innerWidth) || 1200
  const viewportHeight = (typeof window !== 'undefined' && window.innerHeight) || 800

  const targetWidth = 500

  // 弹窗右侧可用宽度：从 modalRect.right 到视口右边缘扣除 20px 安全间隙
  const spaceOnRight = viewportWidth - modalRect.right - 20
  const canFitRight = spaceOnRight >= 300

  if (canFitRight) {
    // 弹窗右侧空间充裕：紧随弹窗右侧，宽度固定/自适应为 500px
    panel.style.left = `${Math.round(modalRect.right + 12)}px`
    panel.style.right = 'auto'
    panel.style.width = `${Math.min(targetWidth, Math.round(spaceOnRight))}px`
  } else {
    // 屏幕宽度较窄时：贴屏幕右侧悬浮展示
    panel.style.left = 'auto'
    panel.style.right = '12px'
    panel.style.width = `${Math.min(targetWidth, Math.round(viewportWidth - 24))}px`
  }

  // 垂直位置与最大高度：对齐弹窗顶部，向下充分利用全屏视口空间（填满至视口底边以上 20px）
  const topPos = Math.max(16, Math.min(modalRect.top, 64))
  panel.style.top = `${Math.round(topPos)}px`
  panel.style.maxHeight = `calc(100vh - ${Math.round(topPos + 20)}px)`
}

/**
 * 在“安排表”选时间弹窗下装载“排期全景 (全景分布看板)”
 * 交互架构：不在弹窗内部挤占狭小空间，而是作为独立浮动大面板展示在遮罩之上的右侧开阔区域，且控制器 Sticky 吸顶
 */
export async function attachSchedulePickerOverview() {
  try {
    const stored = await getStorage(KeyScheduledPanorama)
    if (stored === 'off' || stored === 'hide') {
      removeScheduledPanorama()
      return
    }

    const modals = Array.from(document.querySelectorAll('div[role="dialog"], div[aria-modal="true"]'))

    // 清理所有非排期弹窗中误插的历史残留看板
    modals.forEach((m) => {
      if (!isSchedulePickerModal(m)) {
        m.querySelectorAll('.xf-schedule-picker-overview').forEach((el) => el.remove())
      }
    })

    // 优先匹配最内层真正的排期弹窗（避开外层包裹的发帖编辑对话框）
    const scheduleModal = (
      modals.filter((m) => !m.querySelector('[data-testid^="tweetTextarea"][contenteditable="true"], .DraftEditor-editorContainer [contenteditable="true"]')).find((modal) => isSchedulePickerModal(modal)) ||
      modals.find((modal) => isSchedulePickerModal(modal))
    ) as HTMLElement | null
    if (!scheduleModal) {
      document.querySelectorAll('.xf-schedule-modal-floating-panel').forEach((el) => el.remove())
      document.querySelectorAll('.xf-modal-header-right-badge').forEach((el) => el.remove())
      return
    }

    addStyles('scheduledPanoramaStyles', SCHEDULED_PANORAMA_STYLES)

    // 打开排期弹窗时静默向 X 发起全量最新排期数据同步（5 秒防抖，保障排期全景与智能排期插槽绝对最新）
    silentSyncScheduledPostsWithCooldown()

    // 清理弹窗内部遗留的长看板（不再挤占弹窗内部空间，全面移至右侧悬浮面板）
    scheduleModal.querySelectorAll('.xf-schedule-picker-overview:not(.xf-schedule-modal-floating-panel)').forEach((el) => el.remove())

    // 记录弹窗首次挂载时的初始排期时间
    if (!scheduleModal.dataset.xfInitialTimestamp) {
      const initialDate = getPickedTimeFromModal(scheduleModal)
      if (initialDate && !isNaN(initialDate.getTime())) {
        scheduleModal.dataset.xfInitialTimestamp = String(initialDate.getTime())
      }
    }

    // 在遮罩顶部挂载或复用右侧独立悬浮面板
    let floatingPanel = document.querySelector('.xf-schedule-modal-floating-panel') as HTMLElement | null
    if (!floatingPanel) {
      floatingPanel = document.createElement('div')
      floatingPanel.className = 'xf-schedule-modal-floating-panel xf-schedule-picker-overview'
      document.body.appendChild(floatingPanel)
    }

    positionFloatingSchedulePanel(scheduleModal, floatingPanel)

    // 绑定窗口尺寸变动监听，保持吸附在弹窗右侧
    if (!(scheduleModal as any).__xf_resize_listener_installed) {
      ;(scheduleModal as any).__xf_resize_listener_installed = true
      window.addEventListener('resize', () => {
        const curPanel = document.querySelector('.xf-schedule-modal-floating-panel') as HTMLElement | null
        if (curPanel && document.body.contains(scheduleModal)) {
          positionFloatingSchedulePanel(scheduleModal, curPanel)
        }
      })
    }

    // 绑定事件监听与双重调度
    if (!(scheduleModal as any).__xf_schedule_listeners_installed) {
      ;(scheduleModal as any).__xf_schedule_listeners_installed = true

      const triggerRefresh = () => {
        const panel = document.querySelector('.xf-schedule-modal-floating-panel') as HTMLElement | null
        if (panel && document.body.contains(scheduleModal)) {
          positionFloatingSchedulePanel(scheduleModal, panel)
          void renderSchedulePickerOverview(scheduleModal, panel)
        } else if (!document.body.contains(scheduleModal)) {
          panel?.remove()
        }
      }

      let refreshDebounceTimer: any = null
      const handleModalChange = (e?: Event) => {
        if (e?.target && (e.target as HTMLElement).closest('.xf-schedule-modal-floating-panel')) {
          return
        }
        triggerRefresh()
        if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer)
        refreshDebounceTimer = setTimeout(triggerRefresh, 80)
      }

      scheduleModal.addEventListener('change', handleModalChange, true)
      scheduleModal.addEventListener('input', handleModalChange, true)

      let mutationDebounceTimer: any = null
      const observer = new MutationObserver((mutations) => {
        if (!document.body.contains(scheduleModal)) {
          document.querySelectorAll('.xf-schedule-modal-floating-panel').forEach((el) => el.remove())
          document.querySelectorAll('.xf-modal-header-right-badge').forEach((el) => el.remove())
          observer.disconnect()
          return
        }

        let hasRelevantChange = false
        for (const mut of mutations) {
          const target = mut.target as HTMLElement | null
          if (target?.closest?.('.xf-schedule-modal-floating-panel, .xf-modal-header-right-badge, .xf-smart-scheduler-bar')) {
            continue
          }

          // 过滤仅由于插件自身节点增删引起的 mutation，防止 observer 递归循环
          const isPluginNode = (n: Node) =>
            n instanceof HTMLElement &&
            (n.matches('.xf-schedule-modal-floating-panel, .xf-modal-header-right-badge, .xf-smart-scheduler-bar') ||
             n.closest('.xf-schedule-modal-floating-panel, .xf-modal-header-right-badge, .xf-smart-scheduler-bar') !== null)

          if (
            (mut.addedNodes.length > 0 && Array.from(mut.addedNodes).every(isPluginNode)) ||
            (mut.removedNodes.length > 0 && Array.from(mut.removedNodes).every(isPluginNode))
          ) {
            continue
          }

          hasRelevantChange = true
          break
        }
        if (hasRelevantChange) {
          if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer)
          mutationDebounceTimer = setTimeout(triggerRefresh, 40)
        }
      })

      observer.observe(scheduleModal, {
        childList: true,
        subtree: true,
        characterData: true,
      })
    }

    await renderSchedulePickerOverview(scheduleModal, floatingPanel)
  } catch {}
}

/**
 * 渲染“安排表”看板的核心逻辑
 */
export interface ScheduleOverviewOptions {
  pickedDate?: Date | null
  showGotoBtn?: boolean
  showToggleSwitch?: boolean
  isCollapsed?: boolean
  maxHeight?: string
  minHeight?: string
  isDrawer?: boolean
  showWarningNotice?: boolean
  showSmartScheduler?: boolean
  smartIntervalMinutes?: number
  appliedStatusText?: string
  editingItem?: PersistedScheduledItem | null
  currentComposerText?: string
  isFloatingPanel?: boolean
}

export function escapeHtml(str: string): string {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * 统一构建“排期全景”看板内容 HTML（发帖弹窗、右侧栏嵌入卡片、侧边独立展示共享）
 */
export function buildScheduleOverviewHtml(
  items: PersistedScheduledItem[],
  options: ScheduleOverviewOptions = {}
): string {
  const {
    pickedDate = null,
    showGotoBtn = true,
    showToggleSwitch = false,
    isCollapsed = false,
    maxHeight,
    minHeight,
    isDrawer = false,
    showWarningNotice = false,
    showSmartScheduler = false,
    smartIntervalMinutes,
    appliedStatusText,
    editingItem = null,
    currentComposerText = '',
    isFloatingPanel = false,
  } = options

  const now = new Date()

  // 暗黑模式检测与文本色彩自适应（兼容纯黑 Lights Out 与暗蓝 Dim）
  const isDark =
    typeof document !== 'undefined' &&
    (document.body?.style?.backgroundColor?.includes('rgb(0, 0, 0)') ||
      document.body?.style?.backgroundColor?.includes('rgb(21, 32, 43)') ||
      (!document.body?.style?.backgroundColor?.includes('rgb(255, 255, 255)') &&
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-color-scheme: dark)')?.matches))

  const primaryTextColor = isDark ? '#e7e9ea' : '#0f1419'
  const secondaryTextColor = isDark ? '#8b98a5' : '#536471'
  const groupDividerColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(128, 128, 128, 0.25)'


  // 按自然日分组（消除单条内堆叠日期的挤压问题，零 emoji 极简呈现）
  type NodeItem = {
    date: Date
    isNewPicked: boolean
    text?: string
    globalIdx: number
    restId?: string
  }

  // 查找被编辑条目在 items 中的索引：优先 restId 匹配，其次时间接近，兜底正文前缀片段匹配
  let editingIdx = -1
  if (editingItem) {
    editingIdx = items.findIndex((it) => {
      if (editingItem.restId && it.restId && editingItem.restId === it.restId) return true
      if (editingItem.timestamp && Math.abs(it.timestamp - editingItem.timestamp) < 60000) return true
      if (editingItem.text && it.text && isTweetSnippetMatching(editingItem.text, it.text, 3)) return true
      return false
    })
  }

  // 严格杜绝 placeholder 占位符（如“有什么新鲜事？”）覆盖推文自身真实文案
  const validComposerText = isPlaceholderText(currentComposerText) ? '' : currentComposerText.trim()

  // 若处于修改排期状态，直接将该条推文的时间就地更新为当前选定的 pickedDate，文案优先使用发帖编辑框中的最新输入，兜底保留推文自身的原正文；
  // 杜绝旧时间点遗留原条目且新时间点只显示匿名或被占位符篡改的双重重复问题。
  const nodes: NodeItem[] = items.map((item, idx) => {
    if (idx === editingIdx) {
      return {
        date: pickedDate || new Date(item.timestamp),
        isNewPicked: true,
        text: validComposerText || item.text, // 若用户在发帖编辑框输入了新文案，优先展现新文案；兜底保留推文自身原正文
        globalIdx: idx,
        restId: item.restId,
      }
    }
    return {
      date: new Date(item.timestamp),
      isNewPicked: false,
      text: item.text,
      globalIdx: idx,
      restId: item.restId,
    }
  })

  // 仅在新建排期（非修改已有条目）时，若存在 pickedDate，才单独追加一个新选节点
  if (editingIdx === -1 && pickedDate) {
    nodes.push({
      date: pickedDate,
      isNewPicked: true,
      text: validComposerText,
      globalIdx: -1,
    })
  }

  nodes.sort((a, b) => a.date.getTime() - b.date.getTime())
  let pickedIndex = -1
  if (pickedDate) {
    pickedIndex = nodes.findIndex((n) => n.isNewPicked)
  }
  nodes.forEach((n, i) => {
    n.globalIdx = i
  })

  interface DateGroup {
    dateKey: string
    dateLabel: string
    items: NodeItem[]
  }

  const groups: DateGroup[] = []
  nodes.forEach((n) => {
    const key = dayjs(n.date).format('YYYY-MM-DD')
    let g = groups.find((grp) => grp.dateKey === key)
    if (!g) {
      g = {
        dateKey: key,
        dateLabel: formatDateGroupLabel(n.date, now),
        items: [],
      }
      groups.push(g)
    }
    g.items.push(n)
  })

  let timelineItemsHtml = ''

  if (nodes.length === 0) {
    timelineItemsHtml = `
      <div style="text-align: center; padding: 24px 16px; color: #8b98a5;">
        <div style="font-size: 13px; font-weight: 600;">暂无待发排期推文</div>
        <div style="font-size: 11px; margin-top: 4px; opacity: 0.75;">点击“预排期”可新建并安排推文</div>
      </div>
    `
  } else {
    groups.forEach((group, gIdx) => {
      // 跨天间隔计算
      let crossDayGapStr = ''
      if (gIdx > 0) {
        const prevGroup = groups[gIdx - 1]
        const lastNodeOfPrevGroup = prevGroup.items[prevGroup.items.length - 1]
        const firstNodeOfCurrGroup = group.items[0]
        const crossGapMs = firstNodeOfCurrGroup.date.getTime() - lastNodeOfPrevGroup.date.getTime()
        crossDayGapStr = `跨夜 ${formatDurationGap(crossGapMs)}`
      }

      // 日期分组 Header（无 emoji，极简线条，天与天之间留出充足间距）
      timelineItemsHtml += `
        <div class="xf-schedule-group-header" data-sort-key="group-${group.dateKey}" style="display: flex; align-items: center; gap: 8px; margin: ${gIdx === 0 ? '4px 0 8px 0' : '8px 0 4px 0'}; font-size: 12px; font-weight: 700; color: ${secondaryTextColor};">
          <span style="white-space: nowrap;">${group.dateLabel}</span>
          <span style="font-size: 11px; font-weight: 500; opacity: 0.65;">(${group.items.length}条)</span>
          <span style="flex: 1; border-top: 1px dashed ${groupDividerColor};"></span>
          ${crossDayGapStr ? `<span style="font-size: 11px; font-weight: 500; opacity: 0.75; white-space: nowrap;">${crossDayGapStr}</span>` : ''}
        </div>
      `

      // 组内各排期节点
      group.items.forEach((node) => {
        const gIdx = node.globalIdx
        const prevNode = gIdx === 0 ? null : nodes[gIdx - 1]

        // 组内节点间连线与间隔指示
        if (gIdx > 0 && prevNode && dayjs(node.date).isSame(dayjs(prevNode.date), 'day')) {
          const gapMs = Math.max(0, node.date.getTime() - prevNode.date.getTime())
          const userIntervalMins = getStoredSmartInterval()
          const tightThresholdMs = Math.max(20 * 60 * 1000, (userIntervalMins - 10) * 60 * 1000)
          const isTight = gapMs < tightThresholdMs
          const gapStr = formatDurationGap(gapMs)
          const lineCol = isTight ? '#f59e0b' : 'rgba(128, 128, 128, 0.28)'

          timelineItemsHtml += `
            <div style="display: flex; align-items: center; margin: 2px 0 2px 65px; font-size: 11px; line-height: 1;">
              <svg width="2" height="14" viewBox="0 0 2 14" style="margin-right: 8px; flex-shrink: 0; display: inline-block;">
                <line x1="1" y1="0" x2="1" y2="14" stroke="${lineCol}" stroke-width="2" stroke-dasharray="2.5 2.5" />
              </svg>
              <span style="color: ${isTight ? '#d97706' : '#8b98a5'}; ${isTight ? 'font-weight: 600;' : 'opacity: 0.8;'} white-space: nowrap;">
                ${isTight ? '过密' : '间隔'} ${gapStr}
              </span>
            </div>
          `
        }

        const isFirst = gIdx === 0
        const gapFromPrevOrNow = isFirst
          ? Math.max(0, node.date.getTime() - now.getTime())
          : Math.max(0, node.date.getTime() - (prevNode?.date.getTime() ?? now.getTime()))
        const theme = getIntervalTheme(isFirst, gapFromPrevOrNow)
        const timeStr = dayjs(node.date).format('HH:mm')
        const fullDateStr = dayjs(node.date).format('YYYY-MM-DD HH:mm')

        if (node.isNewPicked) {
          const displayText = (node.text || '').trim()
          const isEditing = Boolean(editingItem)

          // 仅在有文案时展示正文；若无文案且为新建排期，仅保留清晰的“当前排期”徽章，彻底杜绝“(无正文或媒体推文)”噪音
          const textHtml = displayText
            ? `<span class="xf-schedule-item-text" style="flex: 1; min-width: 0; font-size: 12px; line-height: 1.4; color: ${primaryTextColor}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(displayText)}">
                ${escapeHtml(displayText)}
              </span>`
            : isEditing
            ? `<span class="xf-schedule-item-text" style="flex: 1; min-width: 0; font-size: 12px; line-height: 1.4; color: ${secondaryTextColor}; opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                (无正文或媒体推文)
              </span>`
            : ''

          timelineItemsHtml += `
            <div class="xf-scheduled-item-current" data-sort-key="__xf_current_picked__" data-rest-id="${escapeHtml(node.restId || '')}" data-timestamp="${node.date.getTime()}" data-text-snippet="${escapeHtml(displayText.slice(0, 40))}" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 10px; border-radius: 6px; min-height: 32px; box-sizing: border-box;">
              <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
                <span style="width: 44px; flex-shrink: 0; font-family: monospace, sans-serif; font-size: 13px; font-weight: 700; color: rgb(29, 155, 240); text-align: right;">${timeStr}</span>
                <span style="width: 2px; height: 14px; border-radius: 1px; background: rgb(29, 155, 240); flex-shrink: 0;"></span>
                <span style="font-size: 10px; font-weight: 700; color: #fff; background: rgb(29, 155, 240); padding: 1px 5px; border-radius: 4px; flex-shrink: 0; line-height: 1.3;">当前排期</span>
                ${textHtml}
              </div>
              <span style="font-size: 11px; font-family: monospace, sans-serif; color: rgb(29, 155, 240); opacity: 0.8; white-space: nowrap; margin-left: 6px; flex-shrink: 0;">${fullDateStr}</span>
            </div>
          `
        } else {
          timelineItemsHtml += `
            <div class="xf-scheduled-item-row" data-sort-key="row-${escapeHtml(node.restId || String(node.date.getTime()))}" data-rest-id="${escapeHtml(node.restId || '')}" data-timestamp="${node.date.getTime()}" data-text-snippet="${escapeHtml((node.text || '').slice(0, 40))}" style="display: flex; align-items: center; gap: 10px; padding: 5px 10px; border-radius: 6px; background: ${theme.bg}; border: 1px solid ${theme.borderColor}33; min-height: 32px; box-sizing: border-box; cursor: pointer !important; transition: all 0.15s ease;" title="点击直接打开编辑此推文排期：${escapeHtml(node.text || '')}">
              <span style="width: 44px; flex-shrink: 0; font-family: monospace, sans-serif; font-size: 13px; font-weight: 700; color: ${theme.accentColor}; text-align: right;">${timeStr}</span>
              <span style="width: 2px; height: 14px; border-radius: 1px; background: ${theme.accentColor}; flex-shrink: 0; opacity: 0.6;"></span>
              <span class="xf-schedule-item-text" style="flex: 1; min-width: 0; font-size: 12px; line-height: 1.4; color: ${primaryTextColor}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${escapeHtml(node.text || '(无正文或媒体推文)')}
              </span>
            </div>
          `
        }
      })
    })
  }

  // “预排期”直达链接
  const gotoBtnHtml = showGotoBtn
    ? `
      <a href="/compose/post/unsent/scheduled" class="xf-scheduled-goto-btn" title="直达预排期管理 (https://x.com/compose/post/unsent/scheduled)" style="display: inline-flex !important; align-items: center !important; gap: 3px !important; font-size: 13px !important; font-weight: 500 !important; color: rgb(29, 155, 240) !important; text-decoration: none !important; cursor: pointer !important; margin-left: 2px !important; transition: opacity 0.15s ease !important; user-select: none !important;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
        </svg>
        <span>预排期</span>
      </a>
    `
    : ''

  // “刷新”按钮
  const refreshBtnHtml = `
    <button class="xf-scheduled-refresh-btn" aria-label="刷新排期" title="刷新排期列表并清理已过期推文" style="background: transparent !important; border: none !important; cursor: pointer !important; color: rgb(29, 155, 240) !important; padding: 2px !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; transition: transform 0.3s ease, opacity 0.15s ease !important; user-select: none !important; margin-left: 2px !important;">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
      </svg>
    </button>
  `

  // “展开 / 收起”切换开关按钮
  const toggleSwitchHtml = showToggleSwitch
    ? `
      <button class="xf-scheduled-toggle-switch" aria-label="${isCollapsed ? '展开排期全景' : '收起排期全景'}" title="${isCollapsed ? '展开排期全景' : '收起排期全景'}" style="display: inline-flex !important; align-items: center !important; gap: 4px !important; padding: 2px 8px !important; border-radius: 9999px !important; font-size: 12px !important; font-weight: 600 !important; color: rgb(29, 155, 240) !important; background: rgba(29, 155, 240, 0.12) !important; border: 1px solid rgba(29, 155, 240, 0.3) !important; cursor: pointer !important; user-select: none !important; transition: all 0.15s ease !important;">
        <span>${isCollapsed ? '展开' : '收起'}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          ${isCollapsed
            ? '<path d="M12 16l-6-6 1.41-1.41L12 13.17l4.59-4.58L18 10z"/>'
            : '<path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"/>'
          }
        </svg>
      </button>
    `
    : ''

  const closeBtnHtml = isDrawer
    ? `
      <button class="xf-scheduled-drawer-close" aria-label="关闭排期全景" style="background: transparent !important; border: none !important; cursor: pointer !important; color: var(--color-text-secondary, #536471) !important; padding: 4px !important; border-radius: 50% !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; margin-left: 8px !important;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10.59 12L5 6.41 6.41 5 12 10.59 17.59 5 19 6.41 13.41 12 19 17.59 17.59 19 12 13.41 6.41 19 5 17.59 10.59 12z"/>
        </svg>
      </button>
    `
    : ''

  const warningNoticeHtml = showWarningNotice
    ? '<span style="font-size: 11px; font-weight: 600; color: #d97706; white-space: nowrap;">过密警示 &lt;2h</span>'
    : ''

  const smartSchedulerBarHtml = showSmartScheduler
    ? buildSmartSchedulerBarHtml({
        intervalMinutes: smartIntervalMinutes,
        secondaryTextColor,
        appliedStatusText,
      })
    : ''

  if (isFloatingPanel) {
    return `
      <div class="xf-floating-sticky-header">
        <div class="xf-scheduled-header" style="display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; flex-wrap: nowrap; overflow: hidden; margin-bottom: 6px;">
          <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; color: rgb(29, 155, 240); white-space: nowrap; flex-shrink: 0;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 4V3h2v1h6V3h2v1h1.5C19.89 4 21 5.12 21 6.5v12c0 1.38-1.11 2.5-2.5 2.5h-13C4.12 21 3 19.88 3 18.5v-12C3 5.12 4.12 4 5.5 4H7zm0 2H5.5c-.27 0-.5.22-.5.5v12c0 .28.23.5.5.5h13c.28 0 .5-.22.5-.5v-12c0-.28-.22-.5-.5-.5H17v1h-2V6H9v1H7V6z"/>
            </svg>
            <span>排期全景</span>
            ${gotoBtnHtml}
            ${refreshBtnHtml}
          </div>
          <div style="display: flex; align-items: center; gap: 6px; white-space: nowrap; flex-shrink: 0;">
            ${warningNoticeHtml}
            <span style="font-size: 12px; font-weight: 600; color: #8b98a5; background: rgba(128, 128, 128, 0.12); padding: 3px 10px; border-radius: 12px; white-space: nowrap;">
              共 ${items.length}${pickedDate ? ' <span style="color: rgb(29, 155, 240); font-weight: 700; background: rgba(29, 155, 240, 0.18); padding: 1px 6px; border-radius: 8px; margin: 0 2px;">+1</span>' : ''} 条
            </span>
          </div>
        </div>
        ${smartSchedulerBarHtml}
      </div>

      <div class="xf-floating-scroll-body">
        <div class="xf-scheduled-timeline-list" style="display: flex; flex-direction: column; gap: 4px; padding-bottom: 6px;">
          ${timelineItemsHtml}
        </div>
      </div>
    `
  }

  return `
    <div class="xf-scheduled-header" style="display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; flex-wrap: nowrap; overflow: hidden; margin-bottom: ${isCollapsed ? '0' : '4px'}; padding-bottom: ${isCollapsed ? '0' : '4px'}; ${isCollapsed ? '' : 'border-bottom: 1px solid rgba(255, 255, 255, 0.12);'}">
      <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; color: rgb(29, 155, 240); white-space: nowrap; flex-shrink: 0;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 4V3h2v1h6V3h2v1h1.5C19.89 4 21 5.12 21 6.5v12c0 1.38-1.11 2.5-2.5 2.5h-13C4.12 21 3 19.88 3 18.5v-12C3 5.12 4.12 4 5.5 4H7zm0 2H5.5c-.27 0-.5.22-.5.5v12c0 .28.23.5.5.5h13c.28 0 .5-.22.5-.5v-12c0-.28-.22-.5-.5-.5H17v1h-2V6H9v1H7V6z"/>
        </svg>
        <span>排期全景</span>
        ${gotoBtnHtml}
        ${refreshBtnHtml}
      </div>
      <div style="display: flex; align-items: center; gap: 6px; white-space: nowrap; flex-shrink: 0;">
        ${warningNoticeHtml}
        <span style="font-size: 12px; font-weight: 600; color: #8b98a5; background: rgba(255, 255, 255, 0.08); padding: 3px 10px; border-radius: 12px; white-space: nowrap;">
          共 ${items.length}${pickedDate ? ' <span style="color: rgb(29, 155, 240); font-weight: 700; background: rgba(29, 155, 240, 0.18); padding: 1px 6px; border-radius: 8px; margin: 0 2px;">+1</span>' : ''} 条
        </span>
        ${toggleSwitchHtml}
        ${closeBtnHtml}
      </div>
    </div>

    <div class="xf-scheduled-body" style="${isCollapsed ? 'display: none !important;' : ''}">
      ${smartSchedulerBarHtml}
      <div class="xf-scheduled-timeline-list" style="display: flex; flex-direction: column; gap: 4px; padding-bottom: 6px;${maxHeight ? ` max-height: ${maxHeight}; overflow-y: auto;` : ''}${minHeight ? ` min-height: ${minHeight};` : ''}">
        ${timelineItemsHtml}
      </div>
    </div>
  `
}

export function bindScheduleGotoButtons(container: HTMLElement) {
  container.querySelectorAll<HTMLAnchorElement>('.xf-scheduled-goto-btn').forEach((btn) => {
    if ((btn as any).__xf_bound) return
    ;(btn as any).__xf_bound = true
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      window.location.href = 'https://x.com/compose/post/unsent/scheduled'
    })
  })

  container.querySelectorAll<HTMLButtonElement>('.xf-scheduled-refresh-btn').forEach((btn) => {
    if ((btn as any).__xf_bound) return
    ;(btn as any).__xf_bound = true
    btn.addEventListener('click', async (e) => {
      e.preventDefault()
      e.stopPropagation()
      btn.style.transform = 'rotate(360deg)'
      requestActiveScheduledSync()
      await prunePastScheduledPosts()
      await attachSidebarScheduledPanorama()
      setTimeout(() => {
        btn.style.transform = 'rotate(0deg)'
      }, 350)
    })
  })

  container.querySelectorAll<HTMLButtonElement>('.xf-scheduled-toggle-switch').forEach((btn) => {
    if ((btn as any).__xf_bound) return
    ;(btn as any).__xf_bound = true
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const current = localStorage.getItem('xf_scheduled_sidebar_collapsed') === '1'
      localStorage.setItem('xf_scheduled_sidebar_collapsed', current ? '0' : '1')
      void attachSidebarScheduledPanorama()
    })
  })

  // 阻断滚动事件冒泡与击穿，防止排期全景滚动时带着整个页面联动滚动
  container.querySelectorAll<HTMLElement>('.xf-scheduled-body, .xf-floating-scroll-body').forEach((scrollBody) => {
    if ((scrollBody as any).__xf_scroll_bound) return
    ;(scrollBody as any).__xf_scroll_bound = true

    scrollBody.addEventListener(
      'wheel',
      (e) => {
        const { scrollTop, scrollHeight, clientHeight } = scrollBody
        if (scrollHeight <= clientHeight) return

        const isScrollingDown = e.deltaY > 0
        const isScrollingUp = e.deltaY < 0

        // 当向上滚动到达顶部，或者向下滚动到达底部时，阻止事件穿透到全局页面
        if (
          (isScrollingDown && scrollTop + clientHeight >= scrollHeight - 1) ||
          (isScrollingUp && scrollTop <= 0)
        ) {
          e.preventDefault()
        }
        e.stopPropagation()
      },
      { passive: false }
    )
  })

  // 点击某条具体排期推文，自动直达并唤起该推文的原生编辑弹窗
  container.querySelectorAll<HTMLElement>('.xf-scheduled-item-row').forEach((row) => {
    if ((row as any).__xf_row_bound) return
    ;(row as any).__xf_row_bound = true

    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement)?.closest('a, button')) return
      e.preventDefault()
      e.stopPropagation()

      const restId = row.dataset.restId || ''
      const timestamp = Number(row.dataset.timestamp || 0)
      const textSnippet = row.dataset.textSnippet || ''

      try {
        const payload = {
          restId,
          timestamp,
          textSnippet,
        }
        sessionStorage.setItem('xf_auto_open_scheduled_target', JSON.stringify(payload))
        sessionStorage.setItem('xf_current_editing_target', JSON.stringify(payload))
      } catch {}

      window.location.href = 'https://x.com/compose/post/unsent/scheduled'
    })
  })
}

/**
 * 渲染“安排表”弹窗看板的核心逻辑
 */
async function renderSchedulePickerOverview(modal: HTMLElement, container: HTMLElement) {
  const pickedDate = getPickedTimeFromModal(modal)
  const cachedItems = await getPersistedScheduledPosts()
  const editingItem = resolveCurrentEditingItem(cachedItems, modal)
  const currentComposerText = getCurrentComposerText()
  const now = new Date()

  // 清理历史遗留的弹窗头部徽标与嵌套层，不再侵入修改宿主原生时间文案行
  modal.querySelectorAll('.xf-modal-header-right-badge').forEach((el) => el.remove())
  modal.querySelectorAll('.xf-modal-header-left').forEach((legacyWrapper) => {
    while (legacyWrapper.firstChild) {
      legacyWrapper.parentNode?.insertBefore(legacyWrapper.firstChild, legacyWrapper)
    }
    legacyWrapper.remove()
  })

  const isFloating = container.classList.contains('xf-schedule-modal-floating-panel')
  if (!isFloating) {
    container.style.cssText = `
      padding: 10px 12px !important;
      background-color: transparent !important;
      border: 1px solid rgba(29, 155, 240, 0.25) !important;
      border-radius: 12px !important;
      box-sizing: border-box !important;
      width: 100% !important;
    `
  }

  const appliedStatus = (container as any).__xf_applied_status
  const appliedStatusText = appliedStatus && appliedStatus.expire > Date.now() ? appliedStatus.text : undefined

  const html = buildScheduleOverviewHtml(cachedItems, {
    pickedDate,
    showGotoBtn: false,
    showWarningNotice: true,
    showSmartScheduler: true,
    smartIntervalMinutes: getStoredSmartInterval(),
    appliedStatusText,
    editingItem,
    currentComposerText,
    isFloatingPanel: isFloating,
  })

  // 计算智能排期可用插槽时，若当前处于编辑排期模式，从占用轴中剔除被编辑条目的旧时间占用
  const itemsForScheduler = editingItem
    ? cachedItems.filter((it) => (editingItem.restId ? it.restId !== editingItem.restId : Math.abs(it.timestamp - editingItem.timestamp) >= 60000))
    : cachedItems

  ;(container as any).__xf_items_for_scheduler = itemsForScheduler
  ;(container as any).__xf_get_fresh_items = getPersistedScheduledPosts

  // 1. 记录更新前现有的滚动位置与元素物理位置快照 (FLIP - First 阶段)
  const existingScrollBody =
    container.querySelector<HTMLElement>('.xf-floating-scroll-body') ||
    container.querySelector<HTMLElement>('.xf-scheduled-timeline-list') ||
    container.querySelector<HTMLElement>('.xf-scheduled-body')
  const prevScrollTop = existingScrollBody ? existingScrollBody.scrollTop : 0
  const firstPositions = captureFlipPositions(container)

  if (container.dataset.xfOverviewSig !== html) {
    container.innerHTML = html
    container.dataset.xfOverviewSig = html
    bindScheduleGotoButtons(container)
    bindSmartSchedulerControls(modal, container, itemsForScheduler)

    // 2. 立即无缝恢复原滚动位置（在浏览器首帧绘制前同步还原，杜绝瞬间归零闪烁）
    const newScrollBody =
      container.querySelector<HTMLElement>('.xf-floating-scroll-body') ||
      container.querySelector<HTMLElement>('.xf-scheduled-timeline-list') ||
      container.querySelector<HTMLElement>('.xf-scheduled-body')
    if (newScrollBody && prevScrollTop > 0) {
      newScrollBody.scrollTop = prevScrollTop
    }

    // 3. 触发原生 FLIP 排序丝滑过渡动画 (FLIP - Last, Invert, Play 阶段)
    playFlipAnimation(container, firstPositions)
  } else {
    bindSmartSchedulerControls(modal, container, itemsForScheduler)
  }
}

const SCHEDULED_PANORAMA_STYLES = `
/* 当前排期卡片清晰加粗边框（去除周围光晕扩散，保持极简显眼） */
.xf-scheduled-item-current {
  position: relative !important;
  z-index: 2 !important;
  border: 2px solid rgb(29, 155, 240) !important;
  background: rgba(29, 155, 240, 0.12) !important;
  box-shadow: none !important;
  transition: border-color 0.15s ease, background-color 0.15s ease !important;
}

body[style*="background-color: rgb(0, 0, 0)"] .xf-scheduled-item-current,
body[style*="background-color: rgb(21, 32, 43)"] .xf-scheduled-item-current {
  background: rgba(29, 155, 240, 0.18) !important;
  border-color: rgb(29, 155, 240) !important;
  box-shadow: none !important;
}

/* 遮罩顶部独立悬浮面板（白底高质感，深色模式自适应） */
.xf-schedule-modal-floating-panel {
  position: fixed !important;
  z-index: 10001 !important;
  background-color: #ffffff !important;
  border: 1px solid rgba(0, 0, 0, 0.08) !important;
  border-radius: 16px !important;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.16), 0 2px 8px rgba(0, 0, 0, 0.06) !important;
  box-sizing: border-box !important;
  display: flex !important;
  flex-direction: column !important;
  overflow: hidden !important;
  overscroll-behavior: contain !important;
  animation: xf-floating-appear 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
  transition: border-color 0.2s ease, box-shadow 0.2s ease !important;
}

@keyframes xf-floating-appear {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 悬浮面板深度深色模式适配 */
body[style*="background-color: rgb(0, 0, 0)"] .xf-schedule-modal-floating-panel {
  background-color: rgb(22, 24, 28) !important;
  border-color: rgba(255, 255, 255, 0.15) !important;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.1) !important;
}

body[style*="background-color: rgb(21, 32, 43)"] .xf-schedule-modal-floating-panel {
  background-color: rgb(30, 39, 50) !important;
  border-color: rgba(255, 255, 255, 0.15) !important;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1) !important;
}

@media (prefers-color-scheme: dark) {
  body:not([style*="background-color: rgb(255, 255, 255)"]) .xf-schedule-modal-floating-panel {
    background-color: rgb(22, 24, 28) !important;
    border-color: rgba(255, 255, 255, 0.15) !important;
  }
}

/* 顶部控制器 Sticky 吸顶容器（背景纯色不透明，防止下方推文列表滚动时透叠） */
.xf-floating-sticky-header {
  position: sticky !important;
  top: 0 !important;
  z-index: 10 !important;
  padding: 12px 14px 10px 14px !important;
  background-color: #ffffff !important;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06) !important;
  box-sizing: border-box !important;
  flex-shrink: 0 !important;
}

body[style*="background-color: rgb(0, 0, 0)"] .xf-floating-sticky-header {
  background-color: rgb(22, 24, 28) !important;
  border-bottom-color: rgba(255, 255, 255, 0.1) !important;
}

body[style*="background-color: rgb(21, 32, 43)"] .xf-floating-sticky-header {
  background-color: rgb(30, 39, 50) !important;
  border-bottom-color: rgba(255, 255, 255, 0.1) !important;
}

@media (prefers-color-scheme: dark) {
  body:not([style*="background-color: rgb(255, 255, 255)"]) .xf-floating-sticky-header {
    background-color: rgb(22, 24, 28) !important;
    border-bottom-color: rgba(255, 255, 255, 0.1) !important;
  }
}

/* 滚动主体区 */
.xf-floating-scroll-body {
  flex: 1 1 auto !important;
  min-height: 0 !important;
  overflow-y: auto !important;
  overflow-x: hidden !important;
  overscroll-behavior: contain !important;
  padding: 8px 14px 12px 14px !important;
}

/* 当遮罩浮动大面板激活时，背景底层的侧边栏排期看板隐退，避免视觉重叠干扰 */
body:has(.xf-schedule-modal-floating-panel) .xf-sidebar-scheduled-panorama,
body:has(.xf-schedule-modal-floating-panel) .xf-standalone-scheduled-sidebar {
  opacity: 0.08 !important;
  pointer-events: none !important;
  transition: opacity 0.2s ease !important;
}

/* 排期看板推文正文文本与分组标题 - 深度暗黑模式适配 */
.xf-schedule-item-text {
  color: #0f1419 !important;
}

body[style*="background-color: rgb(0, 0, 0)"] .xf-schedule-item-text,
body[style*="background-color: rgb(21, 32, 43)"] .xf-schedule-item-text {
  color: #e7e9ea !important;
}

@media (prefers-color-scheme: dark) {
  body:not([style*="background-color: rgb(255, 255, 255)"]) .xf-schedule-item-text {
    color: #e7e9ea !important;
  }
}

.xf-schedule-group-header {
  color: #536471 !important;
}

body[style*="background-color: rgb(0, 0, 0)"] .xf-schedule-group-header,
body[style*="background-color: rgb(21, 32, 43)"] .xf-schedule-group-header {
  color: #8b98a5 !important;
}

@media (prefers-color-scheme: dark) {
  body:not([style*="background-color: rgb(255, 255, 255)"]) .xf-schedule-group-header {
    color: #8b98a5 !important;
  }
}

.xf-sidebar-scheduled-panorama {
  display: flex !important;
  flex-direction: column !important;
  margin-top: 0 !important;
  margin-bottom: 12px !important;
  padding: 10px 0 6px 0 !important;
  background-color: transparent !important;
  border: 1px solid rgba(29, 155, 240, 0.28) !important;
  border-radius: 16px !important;
  box-sizing: border-box !important;
  width: 100% !important;
  position: relative !important;
  max-height: var(--xf-panorama-max-height, calc(100vh - var(--xf-search-offset, 80px) - 20px)) !important;
  overflow: hidden !important;
  overscroll-behavior: contain !important;
  transition: border-color 0.2s ease, box-shadow 0.2s ease !important;
}

/* 原生右侧边栏内的排期全景卡片：采用固定定位，彻底不跟随主内容区滚动，占满视口除搜索控件外的剩余高度，宽度严格与搜索框等宽 */
[data-testid="sidebarColumn"] .xf-sidebar-scheduled-panorama {
  position: fixed !important;
  top: var(--xf-search-offset, 50px) !important;
  left: var(--xf-sidebar-left, auto) !important;
  width: var(--xf-sidebar-width, 350px) !important;
  max-width: var(--xf-sidebar-width, 350px) !important;
  height: var(--xf-panorama-height, calc(100vh - var(--xf-search-offset, 50px) - 6px)) !important;
  max-height: var(--xf-panorama-height, calc(100vh - var(--xf-search-offset, 50px) - 6px)) !important;
  margin: 0 !important;
  z-index: 1 !important;
}

[data-testid="sidebarColumn"] .xf-sidebar-scheduled-panorama.xf-is-collapsed {
  height: auto !important;
  max-height: 52px !important;
}

/* 填充满可视区同时在原本基础上减小 20px，杜绝页面纵向滚动条 */
.xf-sidebar-scheduled-panorama.xf-is-search-page {
  max-height: var(--xf-panorama-max-height, calc(100vh - var(--xf-search-offset, 80px) - 20px)) !important;
}

.xf-sidebar-scheduled-panorama .xf-scheduled-header {
  flex-shrink: 0 !important;
  padding-left: 14px !important;
  padding-right: 14px !important;
}

.xf-sidebar-scheduled-panorama .xf-scheduled-body {
  flex: 1 1 auto !important;
  min-height: 0 !important;
  overflow-y: auto !important;
  overflow-x: hidden !important;
  overscroll-behavior: contain !important;
  padding-left: 14px !important;
  padding-right: 14px !important;
  padding-top: 4px !important;
  padding-bottom: 4px !important;
}

.xf-scheduled-drawer,
.xf-scheduled-timeline-list {
  overscroll-behavior: contain !important;
}

/* 自定义优雅细滚动条（淡灰半透明原生质感，不抢页面主视觉） */
${buildThinScrollbarCss([
  '.xf-floating-scroll-body',
  '.xf-sidebar-scheduled-panorama .xf-scheduled-body',
  '.xf-standalone-scheduled-sidebar',
  '.xf-scheduled-drawer',
  '.xf-scheduled-timeline-list',
])}

body[style*="background-color: rgb(255, 255, 255)"] .xf-sidebar-scheduled-panorama,
body:not([style*="background-color: rgb(0, 0, 0)"]):not([style*="background-color: rgb(21, 32, 43)"]) .xf-sidebar-scheduled-panorama {
  background: rgb(247, 249, 249) !important;
  border-color: rgba(29, 155, 240, 0.22) !important;
}

body[style*="background-color: rgb(0, 0, 0)"] .xf-sidebar-scheduled-panorama {
  background: rgb(22, 24, 28) !important;
  border-color: rgba(29, 155, 240, 0.3) !important;
}

body[style*="background-color: rgb(21, 32, 43)"] .xf-sidebar-scheduled-panorama {
  background: rgb(30, 39, 50) !important;
  border-color: rgba(29, 155, 240, 0.3) !important;
}

.xf-sidebar-scheduled-panorama:hover {
  border-color: rgba(29, 155, 240, 0.5) !important;
}

.xf-scheduled-goto-btn:hover {
  text-decoration: underline !important;
  opacity: 0.8 !important;
}

.xf-scheduled-toggle-switch:hover {
  background: rgba(29, 155, 240, 0.24) !important;
  border-color: rgb(29, 155, 240) !important;
}

.xf-scheduled-item-row:hover {
  background: rgba(29, 155, 240, 0.12) !important;
  border-color: rgba(29, 155, 240, 0.45) !important;
  transform: translateX(2px) !important;
}

.xf-standalone-scheduled-sidebar {
  width: var(--xf-sidebar-width, 350px) !important;
  max-width: var(--xf-sidebar-width, 350px) !important;
  min-width: 280px !important;
  height: var(--xf-panorama-height, calc(100vh - 32px)) !important;
  max-height: var(--xf-panorama-height, calc(100vh - 32px)) !important;
  margin: 0 !important;
  flex-shrink: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  box-sizing: border-box !important;
  position: fixed !important;
  top: var(--xf-search-offset, 16px) !important;
  left: var(--xf-sidebar-left, auto) !important;
  overflow: hidden !important;
  z-index: 1 !important;
}

.xf-standalone-scheduled-sidebar .xf-sidebar-scheduled-panorama {
  width: 100% !important;
  height: 100% !important;
  max-height: 100% !important;
  margin: 0 !important;
}

.xf-standalone-scheduled-sidebar.xf-is-collapsed,
.xf-standalone-scheduled-sidebar .xf-sidebar-scheduled-panorama.xf-is-collapsed {
  height: auto !important;
  max-height: 52px !important;
}

/* 原生未发送/排期管理列表打开时，静默隐匿右侧栏或侧边排期看板（发帖弹窗居中浮层下背景看板保持原样显示） */
body:has([data-testid="unsentTweet"]) .xf-sidebar-scheduled-panorama,
body:has([data-testid="unsentTweet"]) .xf-standalone-scheduled-sidebar {
  display: none !important;
}

.xf-scheduled-drawer-toggle {
  position: fixed !important;
  right: 0 !important;
  top: 180px !important;
  z-index: 9999 !important;
  display: flex !important;
  align-items: center !important;
  gap: 6px !important;
  padding: 8px 12px 8px 10px !important;
  border-radius: 20px 0 0 20px !important;
  background: rgba(29, 155, 240, 0.92) !important;
  color: #ffffff !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  cursor: pointer !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25) !important;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), background 0.2s !important;
  user-select: none !important;
}

.xf-scheduled-drawer-toggle:hover {
  transform: translateX(-4px) !important;
  background: rgb(29, 155, 240) !important;
}

.xf-scheduled-drawer-backdrop {
  position: fixed !important;
  inset: 0 !important;
  background: rgba(0, 0, 0, 0.45) !important;
  z-index: 10000 !important;
  backdrop-filter: blur(2px) !important;
  -webkit-backdrop-filter: blur(2px) !important;
  animation: xf-fade-in 0.2s ease !important;
}

.xf-scheduled-drawer {
  position: fixed !important;
  right: 0 !important;
  top: 0 !important;
  bottom: 0 !important;
  width: 380px !important;
  max-width: 90vw !important;
  background: rgba(0, 0, 0, 0.9) !important;
  backdrop-filter: blur(20px) !important;
  -webkit-backdrop-filter: blur(20px) !important;
  border-left: 1px solid rgba(255, 255, 255, 0.15) !important;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.4) !important;
  z-index: 10001 !important;
  display: flex !important;
  flex-direction: column !important;
  padding: 16px 14px !important;
  box-sizing: border-box !important;
  animation: xf-slide-in-right 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
}

body[style*="background-color: rgb(255, 255, 255)"] .xf-scheduled-drawer,
body:not([style*="background-color: rgb(0, 0, 0)"]):not([style*="background-color: rgb(21, 32, 43)"]) .xf-scheduled-drawer {
  background: rgba(255, 255, 255, 0.95) !important;
  border-left: 1px solid rgba(0, 0, 0, 0.12) !important;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.15) !important;
}

@keyframes xf-slide-in-right {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes xf-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 智能排期控制栏滑块样式（对齐 Popup 质感，淡蓝色轨道与品牌蓝圆点把手） */
.xf-smart-interval-slider {
  -webkit-appearance: none !important;
  appearance: none !important;
  width: 100% !important;
  height: 6px !important;
  border-radius: 9999px !important;
  outline: none !important;
  cursor: pointer !important;
  padding: 0 !important;
  margin: 0 !important;
  border: none !important;
  box-sizing: border-box !important;
  transition: background 0.1s ease !important;
}

.xf-smart-interval-slider::-webkit-slider-runnable-track {
  -webkit-appearance: none !important;
  height: 6px !important;
  border-radius: 9999px !important;
  background: transparent !important;
  border: none !important;
}

.xf-smart-interval-slider::-webkit-slider-thumb {
  -webkit-appearance: none !important;
  appearance: none !important;
  width: 14px !important;
  height: 14px !important;
  border-radius: 50% !important;
  background: rgb(29, 155, 240) !important;
  cursor: pointer !important;
  margin-top: -4px !important;
  border: none !important;
  box-shadow: rgb(101 119 134 / 25%) 0px 0px 7px, rgb(101 119 134 / 20%) 0px 1px 3px 1px !important;
  transition: transform 0.15s ease, box-shadow 0.15s ease !important;
}

.xf-smart-interval-slider:hover::-webkit-slider-thumb,
.xf-smart-interval-slider:focus::-webkit-slider-thumb {
  transform: scale(1.18) !important;
  box-shadow: 0 0 0 4px rgba(29, 155, 240, 0.25), rgb(101 119 134 / 25%) 0px 0px 7px, rgb(101 119 134 / 20%) 0px 1px 3px 1px !important;
}

.xf-smart-interval-slider::-moz-range-track {
  height: 6px !important;
  border-radius: 9999px !important;
  background: rgba(29, 155, 240, 0.22) !important;
  border: none !important;
}

.xf-smart-interval-slider::-moz-range-progress {
  height: 6px !important;
  border-radius: 9999px !important;
  background: rgb(29, 155, 240) !important;
  border: none !important;
}

.xf-smart-interval-slider::-moz-range-thumb {
  width: 14px !important;
  height: 14px !important;
  border-radius: 50% !important;
  background: rgb(29, 155, 240) !important;
  cursor: pointer !important;
  border: none !important;
  box-shadow: rgb(101 119 134 / 25%) 0px 0px 7px, rgb(101 119 134 / 20%) 0px 1px 3px 1px !important;
}
`

/**
 * 判断是否为需要跳过的侧边栏占位或已插入节点（如排期全景、搜索垫高层 r-1h3ijdo 或空占位 div）
 */
function isSkippableSidebarNode(node: HTMLElement | null): boolean {
  if (!node) return false
  return (
    node.classList.contains('xf-sidebar-scheduled-panorama') ||
    node.classList.contains('r-1h3ijdo') ||
    (node.textContent?.trim() === '' && !node.querySelector('input, img, svg, a, button, iframe'))
  )
}

/**
 * 定位侧边栏中的“搜索筛选 / 高级搜索”模块卡片（若存在）
 * 特征：在搜索结果页（/search?q=...），右侧边栏包含搜索筛选与高级搜索入口面板
 */
export function findSearchFiltersContainer(container: HTMLElement | null): HTMLElement | null {
  if (!container) return null

  // 1. 查找包含明确测试标记或属性的关键节点
  let match = container.querySelector<HTMLElement>(
    '[data-testid="searchFilters"], a[href*="/search-advanced"], [aria-label*="搜索筛选"], [aria-label*="Search filters"], [aria-label*="搜尋篩選"]'
  )

  // 2. 文本特征匹配（深度支持 h2, span, button 等）
  if (!match) {
    const candidates = Array.from(
      container.querySelectorAll<HTMLElement>('h2, [role="heading"], span, a, [role="button"], button')
    )
    for (const el of candidates) {
      if (el.closest('.xf-sidebar-scheduled-panorama, .xf-schedule-picker-overview')) continue
      const text = el.textContent?.trim() || ''
      if (
        text === '搜索筛选' ||
        text === '搜尋篩選' ||
        text === 'Search filters' ||
        text === '検索フィルター' ||
        text === '高级搜索' ||
        text === '進階搜尋' ||
        text === 'Advanced search' ||
        text === '高度な検索'
      ) {
        match = el
        break
      }
    }
  }

  if (!match) return null

  // 3. 从 match 向上追溯到模块卡片根节点：
  // 必须是独立模块卡片，不能包含兄弟节点容器中的顶层 searchBox，也不能是 container 本身
  let curr: HTMLElement | null = match
  let bestCard: HTMLElement | null = null

  while (curr && curr !== container) {
    const parent: HTMLElement | null = curr.parentElement
    if (!parent) break

    // 如果 curr 本身包含了 searchForm，说明已经走过了头（把包含搜索栏和卡片的更外层当成了卡片）
    if (curr.querySelector('form[role="search"]')) {
      break
    }

    bestCard = curr

    if (parent === container) {
      break
    }
    curr = parent
  }

  return bestCard
}

/**
 * 寻找右侧边栏的最佳卡片挂载点。
 * 策略：在搜索框（SearchBox）存在时，优先定位侧边栏模块列表主容器（.r-vacyoi.r-ttdzmv），
 * 避开顶部 sticky 悬浮层与其下方的 53px 垫高层，将排期全景卡片插入在搜索栏垫高层下方、第一个卡片模块之前。
 * 搜索页特殊处理：若右侧边栏存在“搜索筛选 / 高级搜索”面板，排期全景优先插入在其下方，保证搜索筛选处于置顶黄金位置！
 * 严禁在搜索框内部（如 SearchBox_Search_Input_label、form[role="search"]）截断插入，防止破坏搜索框焦点状态！
 */
export function findSidebarInsertionPoint(sidebarCol: HTMLElement): { parent: HTMLElement; referenceNode: HTMLElement | null } {
  // 0. 优先定位搜索页专有的“搜索筛选 / 高级搜索”卡片（无论位于哪一层容器）
  // 保证排期全景必定紧贴在搜索筛选卡片正下方！
  const directFiltersCard = findSearchFiltersContainer(sidebarCol)
  if (directFiltersCard && directFiltersCard.parentElement) {
    return {
      parent: directFiltersCard.parentElement,
      referenceNode: directFiltersCard.nextElementSibling as HTMLElement | null,
    }
  }

  // 1. 优先定位 Twitter 原生侧边栏模块列表容器（.r-vacyoi.r-ttdzmv 或其直接宿主）
  const sectionContainer = sidebarCol.querySelector<HTMLElement>('.r-vacyoi.r-ttdzmv, .r-vacyoi')
  if (sectionContainer) {
    // 搜索页：若存在“搜索筛选 / 高级搜索”卡片，排期全景置于其下方（保持搜索筛选在最上方）
    const filtersCard = findSearchFiltersContainer(sectionContainer)
    if (filtersCard) {
      return { parent: sectionContainer, referenceNode: filtersCard.nextElementSibling as HTMLElement | null }
    }

    let refNode = sectionContainer.firstElementChild as HTMLElement | null
    // 跳过顶部搜索栏悬浮容器（包含 form[role="search"] 或 input）以及 53px 垫高占位层（r-1h3ijdo）
    while (refNode && (refNode.querySelector('form[role="search"], input') || isSkippableSidebarNode(refNode))) {
      refNode = refNode.nextElementSibling as HTMLElement | null
    }
    return { parent: sectionContainer, referenceNode: refNode }
  }

  // 2. 通用回退逻辑：从 searchForm 向上回溯（绝不从 input 内部开始，严防命中 SearchBox_Search_Input_label）
  const searchForm = sidebarCol.querySelector('form[role="search"]') ||
    sidebarCol.querySelector('input[data-testid="SearchBox_Search_Input"]')?.closest('form') ||
    sidebarCol.querySelector('input[data-testid="SearchBox_Search_Input"]')

  if (searchForm) {
    let curr: HTMLElement | null = searchForm as HTMLElement
    while (curr && curr.parentElement && curr.parentElement !== sidebarCol) {
      const p: HTMLElement = curr.parentElement
      // 必须确保 parent 绝非 searchForm 自身或其内部标签（如 SearchBox_Search_Input_label）
      const isInsideSearch =
        p.tagName === 'FORM' ||
        p.closest('form[role="search"]') !== null ||
        (typeof p.getAttribute === 'function' && Boolean(p.getAttribute('data-testid')?.includes('SearchBox')))

      if (!isInsideSearch && p.children.length > 1) {
        const filtersCard = findSearchFiltersContainer(p)
        if (filtersCard) {
          return { parent: p, referenceNode: filtersCard.nextElementSibling as HTMLElement | null }
        }

        let targetRef: HTMLElement | null = curr.nextElementSibling as HTMLElement | null

        // 跳过顶部搜索栏悬浮容器、垫高占位层以及已有排期全景
        while (targetRef && (targetRef.querySelector('form[role="search"], input') || isSkippableSidebarNode(targetRef))) {
          targetRef = targetRef.nextElementSibling as HTMLElement | null
        }

        return { parent: p, referenceNode: targetRef }
      }
      curr = p
    }
  }

  // 3. 兜底回退：深入单个 DIV 容器树寻找第一有效位置
  let container: HTMLElement = sidebarCol
  while (container.firstElementChild && container.children.length === 1 && container.firstElementChild.tagName === 'DIV') {
    container = container.firstElementChild as HTMLElement
  }

  const filtersCard = findSearchFiltersContainer(container)
  if (filtersCard) {
    return { parent: container, referenceNode: filtersCard.nextElementSibling as HTMLElement | null }
  }

  let refNode: HTMLElement | null = container.firstElementChild as HTMLElement | null
  while (refNode && (refNode.querySelector('form[role="search"], input') || isSkippableSidebarNode(refNode))) {
    refNode = refNode.nextElementSibling as HTMLElement | null
  }

  return { parent: container, referenceNode: refNode }
}

/**
 * 关闭侧边排期抽屉
 */
export function closeScheduledDrawer() {
  document.querySelectorAll('.xf-scheduled-drawer, .xf-scheduled-drawer-backdrop').forEach((el) => el.remove())
}

/**
 * 切换侧边排期抽屉显示
 */
export function toggleScheduledDrawer() {
  const existing = document.querySelector('.xf-scheduled-drawer')
  if (existing) {
    closeScheduledDrawer()
    return
  }

  const backdrop = document.createElement('div')
  backdrop.className = 'xf-scheduled-drawer-backdrop'
  backdrop.addEventListener('click', () => closeScheduledDrawer())
  document.body.appendChild(backdrop)

  const drawer = document.createElement('div')
  drawer.className = 'xf-scheduled-drawer'
  document.body.appendChild(drawer)

  void getPersistedScheduledPosts().then((all) => {
    const now = Date.now()
    const valid = all.filter((i) => i.timestamp > now).sort((a, b) => a.timestamp - b.timestamp)
    updateDrawerContent(drawer, valid)
  })
}

function updateDrawerContent(drawer: HTMLElement, items: PersistedScheduledItem[]) {
  const html = buildScheduleOverviewHtml(items, {
    showGotoBtn: true,
    isDrawer: true,
    maxHeight: 'calc(100vh - 110px)',
    minHeight: '160px',
  })
  drawer.innerHTML = html
  bindScheduleGotoButtons(drawer)

  const closeBtn = drawer.querySelector('.xf-scheduled-drawer-close')
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeScheduledDrawer())
  }
}

/**
 * 清除右侧栏卡片与侧边独立排期展示容器
 */
export function removeSidebarScheduledPanorama() {
  document.querySelectorAll('.xf-sidebar-scheduled-panorama').forEach((el) => el.remove())
  document.querySelectorAll('.xf-standalone-scheduled-sidebar').forEach((el) => el.remove())
  document.querySelectorAll('.xf-scheduled-drawer-toggle, .xf-scheduled-drawer, .xf-scheduled-drawer-backdrop').forEach((el) => el.remove())
}

let lastNonComposePath = ''

export function setLastNonComposePathForTest(path: string) {
  lastNonComposePath = path
}

/**
 * 获取当前依附的底层基准页面路由
 * 核心机制：
 * - 当用户在首页（/home）、探索（/explore）或个人主页（/username）打开发帖弹窗时，URL 变为 /compose/post，
 *   但底层页面依然是原页面，弹窗居中且背后带有半透明遮罩，底层的排期全景看板应保持展示不变；
 * - 当用户在排除页面（如 /i/premium、/settings）打开发帖弹窗时，底层页面本就不展示排期，发帖弹窗打开后也绝不突兀出现排期看板；
 * - 当用户进入原生未发送/排期管理页面（/compose/post/unsent/scheduled）时，一律视为独立排期管理界面，绝对排除展示排期看板。
 */
export function getEffectiveBasePagePath(): string {
  const currentPath = typeof window !== 'undefined' && window.location ? window.location.pathname.toLowerCase() : ''

  // 1. 原生未发送推文与排期管理页面始终排除
  if (currentPath.includes('/unsent')) {
    return currentPath
  }

  // 2. 处于发帖弹窗或 intent 路由时，读取打开弹窗前的底层页面路由
  if (currentPath.startsWith('/compose') || currentPath.startsWith('/intent')) {
    if (lastNonComposePath) {
      return lastNonComposePath
    }
    try {
      const saved = sessionStorage.getItem('xf.lastNonComposePath')
      if (saved) return saved
    } catch {}
    // 若没有历史底层路由（如直接在全新标签页输入 /compose/post 打开），直接以当前路由为准（排除）
    return currentPath
  }

  // 3. 常规页面持续同步更新底层页面路由
  lastNonComposePath = currentPath
  try {
    sessionStorage.setItem('xf.lastNonComposePath', currentPath)
  } catch {}
  return currentPath
}

/**
 * 判断当前页面路径是否排除展示侧边栏“排期全景”看板
 * 排除场景：
 * 1. 原生未发送/排期管理页面（如 /compose/post/unsent/scheduled 等）
 * 2. 独立发帖路由与意图页（如全新标签页访问 /compose, /intent 等且无常规底层页面时）
 * 3. /i/premium (会员购买/权益页，侧栏为帮助中心/管理订阅，无需排期管理)
 * 4. /settings (账号设置页)
 * 5. /i/flow (登录/注册/验证流流程页)
 * 6. /i/verified-orgs (认证机构购买页)
 * 7. /i/monetization /i/creator /i/jf (创作者后台相关页面)
 */
export function isScheduledPanoramaExcludedPath(pathname: string): boolean {
  const p = pathname.toLowerCase()
  return (
    p.includes('/unsent') ||
    p.startsWith('/compose') ||
    p.startsWith('/intent') ||
    p.startsWith('/i/premium') ||
    p.startsWith('/settings') ||
    p.startsWith('/i/flow') ||
    p.startsWith('/i/verified-orgs') ||
    p.startsWith('/i/monetization') ||
    p.startsWith('/i/creator') ||
    p.startsWith('/i/jf') ||
    p.startsWith('/i/account_analytics') ||
    p.startsWith('/i/analytics')
  )
}

/**
 * 判断当前是否处于发帖/排期弹窗状态（即使 URL 尚未变更也能即时响应）
 */
export function isComposeOrUnsentModalOpen(): boolean {
  if (typeof document === 'undefined') return false
  return Boolean(
    // 处于未发送/排期管理列表中
    document.querySelector('[data-testid="unsentTweet"]') ||
    // 处于发帖弹窗或全屏草稿中
    document.querySelector('[role="dialog"] [data-testid^="tweetTextarea"]') ||
    document.querySelector('[role="dialog"] .DraftEditor-editorContainer') ||
    document.querySelector('[role="dialog"] [data-testid="ScrollSnap-List"]') ||
    document.querySelector('[role="dialog"] [data-testid="sheetDialog"]') ||
    document.querySelector('[role="dialog"] [aria-label*="未发送"], [role="dialog"] [aria-label*="Unsent"]')
  )
}

/**
 * 在右侧栏或屏幕侧边挂载“排期全景”看板（支持主页及侧边栏关闭时在侧边独立展示并提供开关）
 */
export async function attachSidebarScheduledPanorama() {
  try {
    const stored = await getStorage(KeyScheduledPanorama)
    if (stored === 'off' || stored === 'hide') {
      removeSidebarScheduledPanorama()
      return
    }

    const effectivePath = getEffectiveBasePagePath()
    const currentPath = window.location.pathname.toLowerCase()

    // 1. 原生未发送/排期管理页（/unsent）绝对禁止挂载并立即清理
    if (currentPath.includes('/unsent') || document.querySelector('[data-testid="unsentTweet"]')) {
      removeSidebarScheduledPanorama()
      return
    }

    // 2. 底层有效页面处于排除路由（如 /i/premium, /settings 等）时禁止挂载并清理
    if (isScheduledPanoramaExcludedPath(effectivePath)) {
      removeSidebarScheduledPanorama()
      return
    }

    addStyles('scheduledPanoramaStyles', SCHEDULED_PANORAMA_STYLES)

    const isHome = effectivePath === '/home' || effectivePath === '/'
    const sidebarCol = document.querySelector<HTMLElement>('[data-testid="sidebarColumn"]')
    const primaryCol = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]')

    // 仅在主页或存在侧边栏/主时间线元素的页面展示
    if (!isHome && !sidebarCol && !primaryCol) {
      removeSidebarScheduledPanorama()
      return
    }

    const allCached = await getPersistedScheduledPosts()
    const now = Date.now()
    const validItems = allCached
      .filter((item) => item.timestamp > now)
      .sort((a, b) => a.timestamp - b.timestamp)

    const sidebarSetting = await getStorage(KeySidebarColumn)
    const isSidebarHiddenBySetting = sidebarSetting === 'on' || sidebarSetting === 'hide'
    const isSidebarElementVisible = !!(
      sidebarCol &&
      window.getComputedStyle(sidebarCol).display !== 'none'
    )

    const isCollapsed = localStorage.getItem('xf_scheduled_sidebar_collapsed') === '1'
    const showInSidebar = !isSidebarHiddenBySetting && isSidebarElementVisible

    if (showInSidebar && sidebarCol) {
      // 模式 A：原生右侧边栏开启且可见，嵌入卡片至搜索框占位层下方
      document.querySelectorAll('.xf-standalone-scheduled-sidebar').forEach((el) => el.remove())

      let card = sidebarCol.querySelector('.xf-sidebar-scheduled-panorama') as HTMLElement | null
      const { parent, referenceNode } = findSidebarInsertionPoint(sidebarCol)
      if (!card) {
        card = document.createElement('div')
        card.className = 'xf-sidebar-scheduled-panorama'
        if (referenceNode) {
          parent.insertBefore(card, referenceNode)
        } else {
          parent.appendChild(card)
        }
      } else if (card.parentElement !== parent || (referenceNode && card.nextElementSibling !== referenceNode)) {
        if (referenceNode) {
          parent.insertBefore(card, referenceNode)
        } else {
          parent.appendChild(card)
        }
      }

      // 测量搜索框与搜索筛选等上方元素的实际占据高度，动态自适应最大高度，杜绝外部滚动条
      const searchBox = sidebarCol.querySelector('form[role="search"]') || sidebarCol.querySelector('input[data-testid="SearchBox_Search_Input"]')?.closest('div')
      const filtersCard = findSearchFiltersContainer(sidebarCol)

      // 判断是否处于搜索页环境（URL 匹配或侧边栏命中搜索筛选卡片）
      const isSearchPage =
        (typeof window !== 'undefined' && window.location.pathname.toLowerCase().startsWith('/search')) ||
        getEffectiveBasePagePath().startsWith('/search') ||
        Boolean(filtersCard)

      card.classList.toggle('xf-is-search-page', isSearchPage)
      card.classList.toggle('xf-is-collapsed', isCollapsed)

      const syncSidebarPanoramaPosition = () => {
        if (!document.body.contains(card)) return
        const sidebarRect = sidebarCol.getBoundingClientRect()

        const curSearchBox =
          sidebarCol.querySelector('form[role="search"]') ||
          sidebarCol.querySelector('input[data-testid="SearchBox_Search_Input"]')?.closest('form') ||
          sidebarCol.querySelector('input[data-testid="SearchBox_Search_Input"]')?.closest('div')
        const curFiltersCard = findSearchFiltersContainer(sidebarCol)

        // 严格与上方搜索框对齐并保持完全相同的宽度，绝不向右超出搜索框，彻底杜绝与右下角悬浮按钮发生重叠
        const searchBoxRect = curSearchBox ? curSearchBox.getBoundingClientRect() : null
        const targetLeft = searchBoxRect && searchBoxRect.left > 0 ? searchBoxRect.left : sidebarRect.left
        const targetWidth = searchBoxRect && searchBoxRect.width > 0 ? searchBoxRect.width : (sidebarRect.width || 350)

        card.style.setProperty('--xf-sidebar-left', `${Math.round(targetLeft)}px`)
        card.style.setProperty('--xf-sidebar-width', `${Math.round(targetWidth)}px`)

        let topOffset = 12
        let bottomGap = 12
        if (curFiltersCard) {
          const filterRect = curFiltersCard.getBoundingClientRect()
          if (filterRect.bottom > 0) {
            topOffset = Math.max(60, Math.round(filterRect.bottom + 12))
          } else {
            topOffset = Math.max(60, 320)
          }
          bottomGap = 4
        } else if (curSearchBox) {
          const rect = curSearchBox.getBoundingClientRect()
          if (rect.bottom > 0) {
            topOffset = Math.max(60, Math.round(rect.bottom))
          } else {
            topOffset = 60
          }
          bottomGap = 4
        }
        card.style.setProperty('--xf-search-offset', `${topOffset}px`)

        const viewportHeight = (typeof window !== 'undefined' && window.innerHeight) || 800
        const fullHeight = Math.max(160, viewportHeight - topOffset - bottomGap)
        card.style.setProperty('--xf-panorama-height', `${fullHeight}px`)
        card.style.setProperty('--xf-panorama-max-height', `${fullHeight}px`)
      }

      syncSidebarPanoramaPosition()

      if (!(sidebarCol as any).__xf_panorama_resize_installed) {
        ;(sidebarCol as any).__xf_panorama_resize_installed = true
        window.addEventListener('resize', () => {
          const curCard = sidebarCol.querySelector('.xf-sidebar-scheduled-panorama') as HTMLElement | null
          if (curCard) {
            syncSidebarPanoramaPosition()
          }
        })
      }

      const html = buildScheduleOverviewHtml(validItems, {
        showGotoBtn: true,
        showToggleSwitch: true,
        isCollapsed,
        showWarningNotice: false,
      })
      if (card.dataset.xfOverviewSig !== html) {
        card.innerHTML = html
        card.dataset.xfOverviewSig = html
        bindScheduleGotoButtons(card)
      }
    } else {
      // 模式 B：原生右侧边栏关闭/隐藏，在侧边位置（primaryColumn 旁）挂载独立的“排期全景”容器与开关
      document.querySelectorAll('[data-testid="sidebarColumn"] .xf-sidebar-scheduled-panorama').forEach((el) => el.remove())

      const layoutParent = primaryCol?.parentElement
      if (!layoutParent) return

      let standalone = document.querySelector('.xf-standalone-scheduled-sidebar') as HTMLElement | null
      if (!standalone) {
        standalone = document.createElement('div')
        standalone.className = 'xf-standalone-scheduled-sidebar'
        if (primaryCol && primaryCol.nextElementSibling) {
          layoutParent.insertBefore(standalone, primaryCol.nextElementSibling)
        } else {
          layoutParent.appendChild(standalone)
        }
      } else if (standalone.parentElement !== layoutParent) {
        layoutParent.appendChild(standalone)
      }

      let card = standalone.querySelector('.xf-sidebar-scheduled-panorama') as HTMLElement | null
      if (!card) {
        card = document.createElement('div')
        card.className = 'xf-sidebar-scheduled-panorama'
        standalone.appendChild(card)
      }

      const syncStandalonePosition = () => {
        if (!document.body.contains(standalone)) return
        const primaryRect = primaryCol.getBoundingClientRect()
        const leftPos = Math.round(primaryRect.right + 20)
        const targetWidth = 350
        standalone.style.setProperty('--xf-sidebar-left', `${leftPos}px`)
        standalone.style.setProperty('--xf-sidebar-width', `${targetWidth}px`)
        standalone.style.setProperty('--xf-search-offset', '16px')
        const viewportHeight = (typeof window !== 'undefined' && window.innerHeight) || 800
        const fullHeight = Math.max(200, viewportHeight - 32)
        standalone.style.setProperty('--xf-panorama-height', `${fullHeight}px`)
        standalone.style.setProperty('--xf-panorama-max-height', `${fullHeight}px`)
      }

      syncStandalonePosition()

      if (!(standalone as any).__xf_standalone_resize_installed) {
        ;(standalone as any).__xf_standalone_resize_installed = true
        window.addEventListener('resize', () => {
          syncStandalonePosition()
        })
      }

      const html = buildScheduleOverviewHtml(validItems, {
        showGotoBtn: true,
        showToggleSwitch: true,
        isCollapsed,
        showWarningNotice: false,
      })
      if (card.dataset.xfOverviewSig !== html) {
        card.innerHTML = html
        card.dataset.xfOverviewSig = html
        bindScheduleGotoButtons(card)
      }
    }
  } catch {}
}

let autoOpenTimer: any = null

/**
 * 检查 sessionStorage 中是否有待编辑的目标排期推文；
 * 若有，且当前页面处于未发送排期推文列表（/compose/post/unsent/scheduled），
 * 自动定位对应的 [data-testid="unsentTweet"] 节点并触发点击，实现“1步直达推文编辑弹窗”。
 */
export function autoOpenScheduledTweetFromSession() {
  if (typeof window === 'undefined' || !window.sessionStorage) return
  const raw = sessionStorage.getItem('xf_auto_open_scheduled_target')
  if (!raw) return

  let target: { restId?: string; timestamp?: number; textSnippet?: string } | null = null
  try {
    target = JSON.parse(raw)
  } catch {
    sessionStorage.removeItem('xf_auto_open_scheduled_target')
    return
  }
  if (!target) return

  if (autoOpenTimer) {
    clearInterval(autoOpenTimer)
    autoOpenTimer = null
  }

  const startTime = Date.now()
  autoOpenTimer = setInterval(() => {
    // 超过 4 秒未匹配到元素，自动终止避免死循环
    if (Date.now() - startTime > 4000) {
      if (autoOpenTimer) clearInterval(autoOpenTimer)
      autoOpenTimer = null
      sessionStorage.removeItem('xf_auto_open_scheduled_target')
      return
    }

    const unsentTweets = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="unsentTweet"]'))
    if (!unsentTweets.length) return

    let matched: HTMLElement | null = null

    // 策略 1：结合 timestamp 的精确日期与时间特征匹配
    if (target.timestamp) {
      const d = dayjs(target.timestamp)
      const datePart = d.format('M月D日')       // 例：10月17日
      const timePart = d.format('HH:mm')        // 例：13:17
      const shortTimePart = d.format('h:mm')    // 例：1:17

      matched = unsentTweets.find((el) => {
        const text = el.textContent || ''
        const dateMatch = text.includes(datePart)
        const timeMatch = text.includes(timePart) || text.includes(shortTimePart)
        const snippetMatch = target.textSnippet ? text.includes(target.textSnippet.slice(0, 15)) : true
        return dateMatch && (timeMatch || snippetMatch)
      }) || null
    }

    // 策略 2：通过推文正文文本片段兜底匹配
    if (!matched && target.textSnippet && target.textSnippet.length >= 3) {
      matched = unsentTweets.find((el) => {
        const text = el.textContent || ''
        return text.includes(target.textSnippet!.slice(0, 15))
      }) || null
    }

    if (matched) {
      if (autoOpenTimer) clearInterval(autoOpenTimer)
      autoOpenTimer = null
      sessionStorage.removeItem('xf_auto_open_scheduled_target')
      // 保持 xf_current_editing_target，供排期弹窗精确识别被编辑目标
      try {
        sessionStorage.setItem('xf_current_editing_target', JSON.stringify(target))
      } catch {}
      matched.click()
    }
  }, 100)
}

