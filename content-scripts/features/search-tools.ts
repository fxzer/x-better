/**
 * 搜索增强功能：
 * 1. 搜索默认「最新」标签（searchDefaultLatest）：新搜索停留在「热门」标签时自动无刷新切换至「最新」（f=live）；
 *    若用户在结果页主动切回「热门」或在「热门」下更改筛选条件，则保持停留在「热门」不再抢切；
 * 2. 搜索结果页筛选工具条（searchFilterBar）：在搜索标签栏下方提供时间范围、最低点赞数、媒体类型、仅原创、仅长文、只看关注筛选条；
 * 3. 筛选变更后通过 postMessage 桥接 MAIN world 的 history API 实现平滑切换；
 * 4. 使用 href 变更守卫，避免滚动刷新 DOM 时重建条带导致下拉菜单闪烁或关闭。
 */

import {
  SEARCH_NAVIGATE_TYPE,
  XF_BRIDGE_MARKER,
} from '../../shared/bridge'
import {
  SEARCH_LIKES_OPTIONS,
  SEARCH_MEDIA_OPTIONS,
  SEARCH_TIME_OPTIONS,
  buildSearchQuery,
  createSearchLatestTracker,
  filteredSearchHref,
  hasSearchFilters,
  parseSearchLocation,
  splitSearchQuery,
  type SearchFilters,
} from '../../shared/search-tools'
import {
  KeySearchDefaultLatest,
  KeySearchFilterBar,
} from '../../storage-keys'
import addStyles, { removeStyles, stylesExist } from '../utilities/addStyles'
import { getStorage } from '../utilities/storage'

const BAR_CLASS = 'xf-search-filter-bar'
const STYLE_ID = 'searchFilterBar'
const FILTERABLE_TABS = new Set<string | null>([null, 'live', 'media'])

const TIME_LABELS: Record<string, string> = {
  '24h': '24小时内',
  '7d': '7天内',
  '30d': '30天内',
}

const MEDIA_LABELS: Record<string, string> = {
  images: '图片',
  videos: '视频',
  media: '包含媒体',
}

const tracker = createSearchLatestTracker()
let lastHandledHref: string | null = null
let tabClickBound = false
let configCache: { defaultLatest: boolean; filterBar: boolean } | null = null

export function invalidateSearchToolsCache() {
  configCache = null
}

async function getSearchToolsConfig(): Promise<{ defaultLatest: boolean; filterBar: boolean }> {
  if (!configCache) {
    const settings = await getStorage([KeySearchDefaultLatest, KeySearchFilterBar])
    configCache = {
      defaultLatest: settings[KeySearchDefaultLatest] !== 'off',
      filterBar: settings[KeySearchFilterBar] !== 'off',
    }
  }
  return configCache
}

function isDarkBackground(): boolean {
  try {
    const bg = window.getComputedStyle(document.body).backgroundColor
    const m = bg.match(/\d+/g)
    if (!m || m.length < 3) return false
    const luminance = Number(m[0]) * 0.299 + Number(m[1]) * 0.587 + Number(m[2]) * 0.114
    return luminance < 128
  } catch {
    return false
  }
}

/**
 * 请求 MAIN world 拦截器在 X 页面内平滑跳转路由
 */
export function navigateInPage(href: string, replace = false) {
  window.postMessage(
    {
      type: SEARCH_NAVIGATE_TYPE,
      href,
      replace,
      __xf: XF_BRIDGE_MARKER,
    },
    location.origin,
  )
}

function handleTabClick(event: MouseEvent) {
  const tab = (event.target instanceof Element ? event.target : null)?.closest('a[role="tab"][href]')
  if (!tab) return
  const href = tab.getAttribute('href')
  if (!href) return
  const page = parseSearchLocation(href)
  // 用户主动点回「热门」标签时记住该搜索词，避免立即切回「最新」
  if (page && !page.tab) {
    tracker.keepTop(page.query)
  }
}

/**
 * 初始化搜索页标签点击追踪（由 initializeExtension 调用一次）
 */
export function initSearchTools() {
  if (tabClickBound) return
  tabClickBound = true
  document.addEventListener('click', handleTabClick, true)
}

function ensureStyles() {
  if (stylesExist(STYLE_ID)) return
  addStyles(
    STYLE_ID,
    `
    .${BAR_CLASS} {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-bottom: 1px solid rgba(128, 128, 128, 0.2);
      font-size: 13px;
      line-height: 1.4;
      color: inherit;
      box-sizing: border-box;
      background: transparent;
    }
    .${BAR_CLASS} select, .${BAR_CLASS} button {
      box-sizing: border-box;
      height: 28px;
      margin: 0;
      border: 1px solid rgba(128, 128, 128, 0.35);
      border-radius: 9999px;
      background: transparent;
      color: inherit;
      font: inherit;
      white-space: nowrap;
      cursor: pointer;
      padding: 0 10px;
      transition: all 0.15s ease;
      outline: none;
    }
    .${BAR_CLASS} select {
      appearance: none;
      -webkit-appearance: none;
      padding-right: 22px;
      background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="6" viewBox="0 0 10 6"><path fill="%23888888" d="M0 0l5 6 5-6z"/></svg>');
      background-repeat: no-repeat;
      background-position: right 8px center;
    }
    .${BAR_CLASS} select:hover, .${BAR_CLASS} button:hover {
      background-color: rgba(128, 128, 128, 0.1);
    }
    .${BAR_CLASS} button[aria-pressed="true"], .${BAR_CLASS} select[data-active="true"] {
      border-color: rgb(29, 155, 240);
      color: rgb(29, 155, 240);
      background-color: rgba(29, 155, 240, 0.1);
      font-weight: 600;
    }
    .${BAR_CLASS} .xf-search-clear {
      border-color: transparent;
      color: rgb(239, 68, 68);
      font-size: 12px;
      padding: 0 6px;
    }
    .${BAR_CLASS} .xf-search-clear:hover {
      background-color: rgba(239, 68, 68, 0.1);
    }
  `,
  )
}

function findSearchTabsNav(): HTMLElement | null {
  const tab = document.querySelector<HTMLElement>(
    '[data-testid="primaryColumn"] nav [role="tab"][href^="/search?"], [data-testid="primaryColumn"] nav [role="tab"][href^="/hashtag/"]',
  )
  return tab?.closest<HTMLElement>('nav') ?? null
}

function buildSelect(
  anyLabel: string,
  options: readonly { value: string; label: string }[],
  currentValue: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const select = document.createElement('select')
  select.appendChild(new Option(anyLabel, ''))
  for (const opt of options) {
    select.appendChild(new Option(opt.label, opt.value))
  }
  if (currentValue && !options.some((opt) => opt.value === currentValue)) {
    const custom = new Option(currentValue, currentValue)
    custom.dataset.custom = '1'
    select.appendChild(custom)
  }
  select.value = currentValue
  if (currentValue) select.dataset.active = 'true'
  select.addEventListener('change', () => onChange(select.value))
  return select
}

function applyNewFilters(terms: string, filters: SearchFilters, following: boolean) {
  const page = parseSearchLocation(location.href)
  const query = buildSearchQuery(terms, filters)
  const nextHref = filteredSearchHref(location.href, query, following)
  if (!nextHref) return
  if (page && !page.tab) {
    tracker.keepTop(query)
  }
  navigateInPage(nextHref, false)
}

function renderFilterBar(nav: HTMLElement, currentHref: string) {
  const page = parseSearchLocation(currentHref)
  if (!page || !FILTERABLE_TABS.has(page.tab)) {
    document.querySelectorAll(`.${BAR_CLASS}`).forEach((el) => el.remove())
    return
  }

  let bar = nav.nextElementSibling?.classList.contains(BAR_CLASS)
    ? (nav.nextElementSibling as HTMLElement)
    : null

  // 同一 URL 且紧跟在 nav 后，跳过重绘以防打断用户的下拉菜单选择
  if (bar && bar.dataset.href === currentHref) {
    return
  }

  ensureStyles()

  if (!bar) {
    document.querySelectorAll(`.${BAR_CLASS}`).forEach((el) => el.remove())
    bar = document.createElement('div')
    bar.className = BAR_CLASS
    bar.setAttribute('role', 'group')
    bar.setAttribute('aria-label', '搜索条件筛选')
    nav.insertAdjacentElement('afterend', bar)
  }

  bar.dataset.href = currentHref
  bar.style.colorScheme = isDarkBackground() ? 'dark' : 'light'

  const { terms, filters } = splitSearchQuery(page.query)
  const isFiltered = hasSearchFilters(filters) || page.following

  bar.innerHTML = ''

  // 1. 时间范围
  bar.appendChild(
    buildSelect(
      '时间不限',
      SEARCH_TIME_OPTIONS.map((v) => ({ value: v, label: TIME_LABELS[v] ?? v })),
      filters.time ?? '',
      (val) => applyNewFilters(terms, { ...filters, time: val || null }, page.following),
    ),
  )

  // 2. 最低点赞数
  bar.appendChild(
    buildSelect(
      '点赞不限',
      SEARCH_LIKES_OPTIONS.map((v) => ({ value: String(v), label: `${v}+ 赞` })),
      filters.minLikes !== null ? String(filters.minLikes) : '',
      (val) => applyNewFilters(terms, { ...filters, minLikes: val ? Number(val) : null }, page.following),
    ),
  )

  // 3. 媒体格式
  bar.appendChild(
    buildSelect(
      '全部格式',
      SEARCH_MEDIA_OPTIONS.map((v) => ({ value: v, label: MEDIA_LABELS[v] ?? v })),
      filters.media ?? '',
      (val) => applyNewFilters(terms, { ...filters, media: val || null }, page.following),
    ),
  )

  // 4. 仅原创 / 仅长文 / 只看关注
  const toggles: Array<{ label: string; active: boolean; next: () => void }> = [
    {
      label: '仅原创',
      active: filters.originalOnly,
      next: () => applyNewFilters(terms, { ...filters, originalOnly: !filters.originalOnly }, page.following),
    },
    {
      label: '仅长文',
      active: filters.articlesOnly,
      next: () => applyNewFilters(terms, { ...filters, articlesOnly: !filters.articlesOnly }, page.following),
    },
    {
      label: '只看关注',
      active: page.following,
      next: () => applyNewFilters(terms, filters, !page.following),
    },
  ]

  for (const item of toggles) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = item.label
    btn.setAttribute('aria-pressed', String(item.active))
    btn.addEventListener('click', item.next)
    bar.appendChild(btn)
  }

  // 5. 清除筛选
  if (isFiltered) {
    const clearBtn = document.createElement('button')
    clearBtn.type = 'button'
    clearBtn.className = 'xf-search-clear'
    clearBtn.textContent = '清除'
    clearBtn.addEventListener('click', () => {
      applyNewFilters(terms, { time: null, minLikes: null, originalOnly: false, articlesOnly: false, media: null }, false)
    })
    bar.appendChild(clearBtn)
  }
}

function cleanupSearchBar() {
  document.querySelectorAll(`.${BAR_CLASS}`).forEach((el) => el.remove())
  removeStyles(STYLE_ID)
}

/**
 * 调度与更新搜索增强组件
 */
export async function updateSearchTools() {
  const currentHref = location.href
  const page = parseSearchLocation(currentHref)

  if (!page) {
    if (document.querySelector(`.${BAR_CLASS}`)) {
      cleanupSearchBar()
    }
    lastHandledHref = null
    return
  }

  const { defaultLatest, filterBar } = await getSearchToolsConfig()

  // 1. 处理默认「最新」标签跳转
  if (defaultLatest && currentHref !== lastHandledHref) {
    const nextHref = tracker.next(currentHref)
    if (nextHref && nextHref !== currentHref) {
      lastHandledHref = nextHref
      navigateInPage(nextHref, true)
      return
    }
  }
  lastHandledHref = currentHref

  // 2. 处理结果页筛选条注入
  if (!filterBar || !FILTERABLE_TABS.has(page.tab)) {
    cleanupSearchBar()
    return
  }

  const nav = findSearchTabsNav()
  if (nav) {
    renderFilterBar(nav, currentHref)
  }
}
