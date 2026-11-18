import {
  KeyArticlesButton,
  KeyBookmarksButton,
  KeyCallsButton,
  KeyCommunitiesButton,
  KeyCreatorStudioButton,
  KeyExploreButton,
  KeyExtensionStatus,
  KeyGrokButton,
  KeyHomeButton,
  KeyJobsButton,
  KeyListsButton,
  KeyMessagesButton,
  KeyMoreMenuButton,
  KeyNavigationButtonsLabels,
  KeyNotificationsButton,
  KeyProfileButton,
  KeySidebarColumn,
  KeySidebarElements,
  KeySpamBlacklist,
  KeySpamDebugMode,
  KeySpamFilterEnabled,
  KeySpamKeywordList,
  KeySpamRulesEnabled,
  KeySpamThreshold,
  KeySpamWhitelist,
  KeyTimelineWidth,
  KeyTopicsButton,
  KeyTweetButton,
  KeyVerifiedOrgsButton,
  KeyXPremiumButton,
  KeyStatRatioTargetHandle,
  KeyStatRatioEnabled,
  KeyHighlightNonFollowers,
  KeyViralRadarEnabled,
  KeyViralPotentialThreshold,
  KeyViralViralThreshold,
  KeyViralShowNormalBadge,
  KeyViralEnableHighlight,
  KeyViralHighlightStyle,
  KeyViralShowLevels,
  KeyViralShowBadge,
  KeyArticleToc,
  KeyScheduledPanorama,
  KeyJumpToComments,
  KeyBookmarkCount,
  KeyMediaDownloadEnabled,
  KeySearchDefaultLatest,
  KeySearchFilterBar,
  KeyComposerMediaGrid,
  KeyMediaCarouselSwipe,
  allSettingsKeys,
  defaultPreferences,
} from '../storage-keys'

export type ToggleValue = 'on' | 'off'
export type NavigationLabelMode = 'never' | 'hover' | 'always'
export type ViralHighlightStyle = 'border' | 'background' | 'both' | 'none'
export type ViralLevels = { normal: boolean; potential: boolean; viral: boolean }

export interface ExtensionSettings {
  [KeyExtensionStatus]: ToggleValue
  [KeyTimelineWidth]: number
  [KeyNavigationButtonsLabels]: NavigationLabelMode
  [KeyTweetButton]: ToggleValue
  [KeyHomeButton]: ToggleValue
  [KeyExploreButton]: ToggleValue
  [KeyNotificationsButton]: ToggleValue
  [KeyMessagesButton]: ToggleValue
  [KeyGrokButton]: ToggleValue
  [KeyXPremiumButton]: ToggleValue
  [KeyListsButton]: ToggleValue
  [KeyBookmarksButton]: ToggleValue
  [KeyJobsButton]: ToggleValue
  [KeyCommunitiesButton]: ToggleValue
  [KeyArticlesButton]: ToggleValue
  [KeyTopicsButton]: ToggleValue
  [KeyVerifiedOrgsButton]: ToggleValue
  [KeyProfileButton]: ToggleValue
  [KeyCallsButton]: ToggleValue
  [KeyCreatorStudioButton]: ToggleValue
  [KeyMoreMenuButton]: ToggleValue
  [KeySpamFilterEnabled]: ToggleValue
  [KeySpamThreshold]: number
  [KeySpamDebugMode]: ToggleValue
  [KeySpamRulesEnabled]: string
  [KeySpamKeywordList]: string
  [KeySpamWhitelist]: string
  [KeySpamBlacklist]: string
  [KeySidebarColumn]: ToggleValue
  [KeySidebarElements]: string
  [KeyStatRatioTargetHandle]: string
  [KeyStatRatioEnabled]: ToggleValue
  [KeyHighlightNonFollowers]: ToggleValue
  [KeyViralRadarEnabled]: ToggleValue
  [KeyViralPotentialThreshold]: number
  [KeyViralViralThreshold]: number
  [KeyViralShowNormalBadge]: ToggleValue
  [KeyViralEnableHighlight]: ToggleValue
  [KeyViralHighlightStyle]: ViralHighlightStyle
  [KeyViralShowLevels]: string
  [KeyViralShowBadge]: ToggleValue
  [KeyArticleToc]: ToggleValue
  [KeyScheduledPanorama]: ToggleValue
  [KeyJumpToComments]: ToggleValue
  [KeyBookmarkCount]: ToggleValue
  [KeyMediaDownloadEnabled]: ToggleValue
  [KeySearchDefaultLatest]: ToggleValue
  [KeySearchFilterBar]: ToggleValue
  [KeyComposerMediaGrid]: ToggleValue
  [KeyMediaCarouselSwipe]: ToggleValue
}

export type SettingsPatch = Partial<Record<keyof ExtensionSettings, unknown>>

const TOGGLE_KEYS = new Set<string>([
  KeyExtensionStatus,
  KeyTweetButton,
  KeyHomeButton,
  KeyExploreButton,
  KeyNotificationsButton,
  KeyMessagesButton,
  KeyGrokButton,
  KeyXPremiumButton,
  KeyListsButton,
  KeyBookmarksButton,
  KeyJobsButton,
  KeyCommunitiesButton,
  KeyArticlesButton,
  KeyTopicsButton,
  KeyVerifiedOrgsButton,
  KeyProfileButton,
  KeyCallsButton,
  KeyCreatorStudioButton,
  KeyMoreMenuButton,
  KeySpamFilterEnabled,
  KeySpamDebugMode,
  KeySidebarColumn,
  KeySidebarElements,
  KeyStatRatioEnabled,
  KeyHighlightNonFollowers,
  KeyViralRadarEnabled,
  KeyViralShowNormalBadge,
  KeyViralEnableHighlight,
  KeyViralShowBadge,
  KeyArticleToc,
  KeyScheduledPanorama,
  KeyJumpToComments,
  KeyBookmarkCount,
  KeyMediaDownloadEnabled,
  KeySearchDefaultLatest,
  KeySearchFilterBar,
  KeyComposerMediaGrid,
  KeyMediaCarouselSwipe,
])

function normalizeToggle(value: unknown, fallback: ToggleValue): ToggleValue {
  if (value === 'on' || value === true || value === 'show') return 'on'
  if (value === 'off' || value === false || value === 'hide') return 'off'
  return fallback
}

/** 数值类设置的业务范围，用于 clamp 损坏/越界的 storage 值（对齐各 UI 滑块边界） */
const NUMERIC_RANGES: Partial<Record<string, { min: number; max: number }>> = {
  [KeyTimelineWidth]: { min: 600, max: 800 },
  [KeySpamThreshold]: { min: 0, max: 100 },
  [KeyViralPotentialThreshold]: { min: 0, max: 50000 },
  [KeyViralViralThreshold]: { min: 0, max: 50000 },
}

function normalizeNumber(
  value: unknown,
  fallback: number,
  range?: { min: number; max: number },
): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  if (!range) return n
  return Math.min(range.max, Math.max(range.min, n))
}

function normalizeNavLabels(value: unknown, fallback: NavigationLabelMode): NavigationLabelMode {
  return value === 'hover' || value === 'always' || value === 'never' ? value : fallback
}

function normalizeViralHighlightStyle(value: unknown, fallback: ViralHighlightStyle): ViralHighlightStyle {
  return value === 'border' || value === 'background' || value === 'both' || value === 'none'
    ? value
    : fallback
}

const VIRAL_LEVELS = ['normal', 'potential', 'viral']

/**
 * 归一化展示级别列表：只保留合法级别、去重、保持 fixed 顺序，非法/空则回退默认。
 */
function normalizeViralLevels(value: unknown, fallback: string): string {
  const tokens = typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : []
  const set = new Set(tokens.filter((t) => (VIRAL_LEVELS as string[]).includes(t)))
  if (set.size === 0) return fallback
  return VIRAL_LEVELS.filter((l) => set.has(l)).join(',')
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/**
 * 爆款雷达「展示标签级别」解析（单一事实源，content script 与 popup 共用）。
 * 优先读新键 viralShowLevels（逗号分隔）；缺失时按旧键迁移：
 *   normal        ← viralShowNormalBadge === 'on'
 *   potential/viral ← viralEnableHighlight !== 'off'
 */
export function parseViralShowLevels(data: Record<string, unknown> | undefined): ViralLevels {
  // 仅当新键真正缺失时才走旧键迁移；新键存在（含空串）则尊重用户选择，
  // 避免用户清空全部级别后，空串被当作「缺失」而重新启用旧配置。
  if (data && typeof data[KeyViralShowLevels] !== 'undefined') {
    const normalized = normalizeViralLevels(data[KeyViralShowLevels], '')
    const set = new Set(normalized.split(','))
    return {
      normal: set.has('normal'),
      potential: set.has('potential'),
      viral: set.has('viral'),
    }
  }
  return {
    normal: data?.[KeyViralShowNormalBadge] === 'on',
    potential: data?.[KeyViralEnableHighlight] !== 'off',
    viral: data?.[KeyViralEnableHighlight] !== 'off',
  }
}

/**
 * 爆款雷达「高亮样式」解析（单一事实源）。
 * 新键存在则归一化；缺失时按旧键迁移：viralEnableHighlight === 'off' → 'none'，否则 'both'。
 */
export function parseViralHighlightStyle(data: Record<string, unknown> | undefined): ViralHighlightStyle {
  if (data && typeof data[KeyViralHighlightStyle] !== 'undefined') {
    return normalizeViralHighlightStyle(data[KeyViralHighlightStyle], 'both')
  }
  return data?.[KeyViralEnableHighlight] === 'off' ? 'none' : 'both'
}

/**
 * 爆款雷达「是否展示标签」解析（默认开）。'off' 视为关闭，其余（含缺失）为开。
 */
export function parseViralShowBadge(data: Record<string, unknown> | undefined): boolean {
  return data?.[KeyViralShowBadge] !== 'off'
}

/**
 * 侧边栏可定制显隐的元素键
 */
export type SidebarElementKey = 'live' | 'trends' | 'whoToFollow'
export const SIDEBAR_ELEMENTS: SidebarElementKey[] = ['live', 'trends', 'whoToFollow']

/**
 * 归一化侧边栏展示元素：只保留合法选项、保持 fixed 顺序。若未提供则使用默认值。
 */
export function normalizeSidebarElements(value: unknown, fallback: string = ''): string {
  if (typeof value !== 'string') return fallback
  const tokens = value.split(',').map((s) => s.trim()).filter(Boolean)
  const set = new Set(tokens.filter((t) => (SIDEBAR_ELEMENTS as string[]).includes(t)))
  return SIDEBAR_ELEMENTS.filter((e) => set.has(e)).join(',')
}

export function parseSidebarElements(data: unknown): Record<SidebarElementKey, boolean> {
  let str: string | undefined
  if (typeof data === 'string') {
    str = data
  } else if (data && typeof (data as Record<string, unknown>)[KeySidebarElements] !== 'undefined') {
    str = String((data as Record<string, unknown>)[KeySidebarElements])
  }
  if (typeof str === 'undefined') {
    str = ''
  }
  const set = new Set(str.split(',').map((s) => s.trim()).filter(Boolean))
  return {
    live: set.has('live'),
    trends: set.has('trends'),
    whoToFollow: set.has('whoToFollow'),
  }
}

export function serializeSidebarElements(elements: Record<SidebarElementKey, boolean>): string {
  const selected: SidebarElementKey[] = []
  if (elements.live) selected.push('live')
  if (elements.trends) selected.push('trends')
  if (elements.whoToFollow) selected.push('whoToFollow')
  return selected.join(',')
}

export function normalizeSettings(raw: Partial<Record<string, unknown>> = {}): ExtensionSettings {
  const result: Record<string, unknown> = {}

  for (const key of allSettingsKeys) {
    const fallback = defaultPreferences[key]
    const value = raw[key] ?? fallback

    if (TOGGLE_KEYS.has(key)) {
      result[key] = normalizeToggle(value, fallback as ToggleValue)
    } else if (
      key === KeyTimelineWidth ||
      key === KeySpamThreshold ||
      key === KeyViralPotentialThreshold ||
      key === KeyViralViralThreshold
    ) {
      result[key] = normalizeNumber(value, fallback as number, NUMERIC_RANGES[key])
    } else if (key === KeyNavigationButtonsLabels) {
      result[key] = normalizeNavLabels(value, fallback as NavigationLabelMode)
    } else if (key === KeyViralHighlightStyle) {
      result[key] = normalizeViralHighlightStyle(value, fallback as ViralHighlightStyle)
    } else if (key === KeyViralShowLevels) {
      result[key] = normalizeViralLevels(value, fallback as string)
    } else if (key === KeySidebarElements) {
      result[key] = normalizeSidebarElements(value, fallback as string)
    } else {
      result[key] = normalizeString(value, String(fallback ?? ''))
    }
  }

  // 跨字段约束：potential 阈值必须严格小于 viral 阈值；
  // 旧版本/手动修改/损坏的 storage 可能产生非法组合，此时整体回退默认。
  if ((result[KeyViralPotentialThreshold] as number) >= (result[KeyViralViralThreshold] as number)) {
    result[KeyViralPotentialThreshold] = defaultPreferences[KeyViralPotentialThreshold]
    result[KeyViralViralThreshold] = defaultPreferences[KeyViralViralThreshold]
  }

  return result as unknown as ExtensionSettings
}

export function mergeSettings(base: ExtensionSettings, patch: SettingsPatch): ExtensionSettings {
  return normalizeSettings({ ...base, ...patch })
}
