import {
  KeyNavigationButtonsLabels,
  KeyTweetButton,
  KeyStatRatioTargetHandle,
  KeyStatRatioEnabled,
  KeyHighlightNonFollowers,
  KeyScheduledPanorama,
} from '../../storage-keys'
import {
  changeNavigationButtonsLabels,
} from '../options/navigation'
import { syncNavItemsToStorage } from '../utilities/navIcons'
import {
  addMediaDownloadButtons,
  syncAccountAnalyticsPageMarker,
} from '../options/timeline'
import { addComposerInsertLinkButton } from '../options/composer'
import { addScheduledRelativeTimes, maintainScheduledPostsCache, removeScheduledPanorama } from '../options/scheduled-time'
import { addStatRatioBadges } from '../options/stat-ratio'
import { updateProfileActivityStats } from '../options/profile-activity'
import { changeTweetButton, changeHighlightNonFollowers } from '../options/interface'
import { getStorage } from '../utilities/storage'
import throttle from '../utilities/throttle'
import type { ExtensionSettings } from '../../shared/settings'

import { runViralRadar } from './viral-radar'
import { injectKeywordButton } from '../spam/keyword-picker'
import { updateArticleToc } from './article-toc'
import { updateJumpToComments } from './jump-to-comments'
import { renderArticleImagePreviewButtons } from './article-image-preview'
import { updateBookmarkCounters } from './bookmark-counter'
import { updateComposerMediaGrids } from '../options/composer-media'
import { updateSearchTools } from './search-tools'
import { updateMediaCarousels } from './media-carousel'

export type DynamicFeatureScope = 'tweet' | 'composer' | 'scheduled' | 'navigation' | 'all'

// 单飞期间到达的新任务会合并到 pendingScopes，并在本轮结束后补跑，避免遗漏最后一次变更。
let generalInFlight = false
const pendingScopes = new Set<DynamicFeatureScope>()

function includesScope(scopes: ReadonlySet<DynamicFeatureScope>, scope: DynamicFeatureScope) {
  return scopes.has('all') || scopes.has(scope)
}

let cachedTweetSettings: {
  targetHandle: string
  ratioEnabled: boolean
  highlightNonFollowers: string
} | null = null

export function invalidateDynamicSettingsCache() {
  cachedTweetSettings = null
}

async function getCachedTweetSettings() {
  if (!cachedTweetSettings) {
    const data = await getStorage([
      KeyStatRatioTargetHandle,
      KeyStatRatioEnabled,
      KeyHighlightNonFollowers,
    ])
    const ratioEnabled = !data || data[KeyStatRatioEnabled] !== 'off'
    const targetHandle = (data && typeof data[KeyStatRatioTargetHandle] === 'string' && (data[KeyStatRatioTargetHandle] as string).trim())
      ? (data[KeyStatRatioTargetHandle] as string).trim()
      : '*'
    const highlightNonFollowers = String(data?.[KeyHighlightNonFollowers] ?? 'on')
    cachedTweetSettings = { targetHandle, ratioEnabled, highlightNonFollowers }
  }
  return cachedTweetSettings
}

export const dynamicFeatures = {
  general: async (requestedScopes: Iterable<DynamicFeatureScope> = ['all']) => {
    for (const scope of requestedScopes) pendingScopes.add(scope)
    if (generalInFlight) return
    generalInFlight = true

    try {
      while (pendingScopes.size > 0) {
        const scopes = new Set(pendingScopes)
        pendingScopes.clear()

        if (includesScope(scopes, 'tweet')) {
          try {
            addMediaDownloadButtons()
            updateBookmarkCounters()
            // 推文操作按钮（选词/名单）独立于 spam 过滤器生命周期注入：
            // dynamic observer 总是运行，即使用户关闭净化，新推文上仍会出现这些按钮。
            // injectKeywordButton 自身幂等（KW_BTN_ATTR 标记），与 scanner 内的调用不冲突。
            document
              .querySelectorAll<HTMLElement>('article[data-testid="tweet"]')
              .forEach(injectKeywordButton)
            updateProfileActivityStats()
            void runViralRadar()
            updateArticleToc()
            void updateJumpToComments()
            const s = await getCachedTweetSettings()
            if (s.ratioEnabled) {
              addStatRatioBadges(s.targetHandle)
            } else {
              document.querySelectorAll('.xf-stat-ratio-badge').forEach((el) => el.remove())
            }
            changeHighlightNonFollowers(s.highlightNonFollowers)
            void updateMediaCarousels()
          } catch (e) {
            console.warn('[X Focus] tweet scope execution error:', e)
          }
        }

        if (includesScope(scopes, 'composer')) {
          try {
            addComposerInsertLinkButton()
            updateArticleToc()
            void updateComposerMediaGrids()
          } catch (e) {
            console.warn('[X Focus] composer scope execution error:', e)
          }
        }

        // 排期全景只依赖 /unsent 卡片与侧边栏（scheduled scope），
        // 不随时间线推文（tweet scope）滚动重跑。
        if (includesScope(scopes, 'scheduled')) {
          try {
            const schedState = await getStorage(KeyScheduledPanorama)
            if (schedState !== 'off') {
              await addScheduledRelativeTimes('on')
            } else {
              removeScheduledPanorama()
            }
            maintainScheduledPostsCache()
          } catch (e) {
            console.warn('[X Focus] scheduled scope execution error:', e)
          }
        }

        if (includesScope(scopes, 'navigation')) {
          syncAccountAnalyticsPageMarker()
        }

        renderArticleImagePreviewButtons()
        void updateSearchTools()
      }
    } finally {
      generalInFlight = false
    }
  },
  navigation: (data: Record<string, string | number | boolean | undefined>) => {
    changeNavigationButtonsLabels(data[KeyNavigationButtonsLabels] ?? 'always')
  },
}

async function loadDynamicSettings(): Promise<Pick<ExtensionSettings,
  typeof KeyNavigationButtonsLabels |
  typeof KeyTweetButton
>> {
  return await getStorage([
    KeyNavigationButtonsLabels,
    KeyTweetButton,
  ]) as Pick<ExtensionSettings,
    typeof KeyNavigationButtonsLabels |
    typeof KeyTweetButton
  >
}

const queuedRunScopes = new Set<DynamicFeatureScope>()
let queuedSettings: Partial<ExtensionSettings> | undefined

const flushDynamicFeatures = throttle(async () => {
  const scopeSet = new Set(queuedRunScopes)
  queuedRunScopes.clear()
  const settings = queuedSettings
  queuedSettings = undefined

  void dynamicFeatures.general(scopeSet)

  const shouldUpdateNavigation = Boolean(settings) || includesScope(scopeSet, 'navigation')
  if (!shouldUpdateNavigation) return

  const data = settings ?? await loadDynamicSettings()

  if (data) {
    changeTweetButton(data[KeyTweetButton] ?? 'off', data[KeyNavigationButtonsLabels])
    dynamicFeatures.navigation(data)

    // 页面空闲时静默嗅探并同步最新侧栏导航项至 storage 缓存（供 Popup 0ms 秒开使用）
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(() => void syncNavItemsToStorage())
    } else {
      setTimeout(() => void syncNavItemsToStorage(), 500)
    }
  }
}, 50)

export function runDynamicFeatures(
  settings?: Partial<ExtensionSettings>,
  scopes: Iterable<DynamicFeatureScope> = ['all'],
) {
  for (const scope of scopes) queuedRunScopes.add(scope)
  if (settings) queuedSettings = { ...queuedSettings, ...settings }
  flushDynamicFeatures()
}
