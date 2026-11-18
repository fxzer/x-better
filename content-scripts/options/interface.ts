import selectors from '../selectors'
import addStyles, { removeStyles } from '../utilities/addStyles'
import { updateArticleToc, destroyArticleToc } from '../features/article-toc'
import { updateJumpToComments, destroyJumpToComments } from '../features/jump-to-comments'
import { addScheduledRelativeTimes, removeScheduledPanorama, attachSidebarScheduledPanorama } from './scheduled-time'
import { ensureCustomTweetButton } from './navigation'
import { parseSidebarElements } from '../../shared/settings'

export const changeTweetButton = (
  state: string | number | boolean,
  navigationLabels?: string | number | boolean,
) => {
  if (state === 'off' || state === 'hide') {
    addStyles(
      'hideTweetButton',
      `html body ${selectors.tweetButton},
      html body .xf-custom-tweet-button,
      html body header[role="banner"] ${selectors.tweetButton},
      html body header[role="banner"] .xf-custom-tweet-button,
      html body header[role="banner"]:hover ${selectors.tweetButton},
      html body header[role="banner"]:hover .xf-custom-tweet-button,
      html body header[role="banner"] nav[role="navigation"]:hover ${selectors.tweetButton},
      html body header[role="banner"] nav[role="navigation"]:hover .xf-custom-tweet-button {
        display: none !important;
      }`
    )
  } else {
    removeStyles('hideTweetButton')
    const isNeverOrHover =
      navigationLabels === 'never' ||
      navigationLabels === 'hover' ||
      (!navigationLabels && (
        Boolean(document.getElementById('xf-style-removeLabels')) ||
        Boolean(document.getElementById('xf-style-hideLabels'))
      ))
    if (isNeverOrHover) {
      ensureCustomTweetButton()
    }
  }
}

export const changeSidebarColumn = (_state?: string | number | boolean) => {
  // 侧边栏不再全局隐藏（保留搜索框与排期全景），移除全栏隐藏样式
  removeStyles('hideSidebarColumn')
  void attachSidebarScheduledPanorama()
}

export const HIDE_SIDEBAR_FOOTER_CSS = `[data-testid="sidebarColumn"] div.r-1867qdf:has(nav[role="navigation"]),
  [data-testid="sidebarColumn"] .r-vacyoi.r-ttdzmv > div:has(nav[role="navigation"]),
  [data-testid="sidebarColumn"] div:has(> nav[aria-label*="页脚"]),
  [data-testid="sidebarColumn"] div:has(> nav[aria-label*="Footer"]),
  [data-testid="sidebarColumn"] nav[aria-label*="页脚"],
  [data-testid="sidebarColumn"] nav[aria-label*="Footer"],
  [data-testid="sidebarColumn"] nav[role="navigation"]:has(a[href*="/tos"]),
  [data-testid="sidebarColumn"] nav[role="navigation"]:has(a[href*="/privacy"]) {
    display: none !important;
  }`

export const changeSidebarElements = (elements: unknown) => {
  const parsed = parseSidebarElements(elements)

  // 默认无条件彻底隐藏侧边栏底部条款与版权信息
  addStyles('hideSidebarFooter', HIDE_SIDEBAR_FOOTER_CSS)

  // 当 3 个元素全部未勾选时（默认纯净模式）：
  // 直接隐藏除搜索栏、搜索筛选与排期全景外的全部卡片容器及加载占位 Spinner，实现 0 毫秒无痕纯净体验；
  // 严格排除搜索表单、输入框、下拉框、搜索建议浮层、搜索筛选及高级搜索面板与排期看板，防止误伤。
  if (!parsed.live && !parsed.trends && !parsed.whoToFollow) {
    addStyles(
      'hideSidebarAllThree',
      `[data-testid="sidebarColumn"] div.r-1867qdf:not(:has(form)):not(:has(input)):not([role="listbox"]):not(:has([role="listbox"])):not([data-testid*="typeahead"]):not(:has([data-testid*="typeahead"])):not(.xf-sidebar-scheduled-panorama):not(:has(.xf-sidebar-scheduled-panorama)):not([data-testid="searchFilters"]):not(:has([data-testid="searchFilters"])):not(:has(a[href*="/search-advanced"])),
      [data-testid="sidebarColumn"] section:not(:has(form)):not(:has(input)):not([role="listbox"]):not(:has([role="listbox"])):not([data-testid*="typeahead"]):not(:has([data-testid*="typeahead"])):not(.xf-sidebar-scheduled-panorama):not(:has(.xf-sidebar-scheduled-panorama)):not([data-testid="searchFilters"]):not(:has([data-testid="searchFilters"])):not(:has(a[href*="/search-advanced"])),
      [data-testid="sidebarColumn"] aside:not(:has(form)):not(:has(input)):not([role="listbox"]):not(:has([role="listbox"])):not([data-testid*="typeahead"]):not(:has([data-testid*="typeahead"])):not(.xf-sidebar-scheduled-panorama):not(:has(.xf-sidebar-scheduled-panorama)):not([data-testid="searchFilters"]):not(:has([data-testid="searchFilters"])):not(:has(a[href*="/search-advanced"])),
      [data-testid="sidebarColumn"] .r-vacyoi.r-ttdzmv > div:not(:has(form)):not(:has(input)):not(.r-1h3ijdo):not([role="listbox"]):not(:has([role="listbox"])):not([data-testid*="typeahead"]):not(:has([data-testid*="typeahead"])):not(.xf-sidebar-scheduled-panorama):not(:has(.xf-sidebar-scheduled-panorama)):not([data-testid="searchFilters"]):not(:has([data-testid="searchFilters"])):not(:has(a[href*="/search-advanced"])) {
        display: none !important;
      }`
    )
  } else {
    removeStyles('hideSidebarAllThree')
  }

  // 1. X直播
  if (!parsed.live) {
    addStyles(
      'hideSidebarLive',
      `[data-testid="sidebarColumn"] div.r-1867qdf:has([data-testid="placementTracking"]):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] div.r-1867qdf:has(a[href*="/broadcasts/"]):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] .r-vacyoi.r-ttdzmv > div:has([data-testid="placementTracking"]):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] .r-vacyoi.r-ttdzmv > div:has(a[href*="/broadcasts/"]):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] div:has(> * [data-testid="placementTracking"]):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama):not(:has(section)):not(:has(aside)):not(:has(nav)),
      [data-testid="sidebarColumn"] div:has(a[href*="/broadcasts/"]):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama) {
        display: none !important;
      }`
    )
  } else {
    removeStyles('hideSidebarLive')
  }

  // 2. X新鲜事
  if (!parsed.trends) {
    addStyles(
      'hideSidebarTrends',
      `[data-testid="sidebarColumn"] div.r-1867qdf:has([data-testid="trend"]):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] div.r-1867qdf:has(a[href*="/explore/tabs/"]):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] div.r-1867qdf:has(section):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] .r-vacyoi.r-ttdzmv > div:has([data-testid="trend"]):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] .r-vacyoi.r-ttdzmv > div:has(a[href*="/explore/tabs/"]):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] .r-vacyoi.r-ttdzmv > div:has(section):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] section:has([data-testid="trend"]):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] section:has(a[href*="/explore/tabs/"]):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] section:not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama) {
        display: none !important;
      }`
    )
  } else {
    removeStyles('hideSidebarTrends')
  }

  // 3. 推荐关注
  if (!parsed.whoToFollow) {
    addStyles(
      'hideSidebarWhoToFollow',
      `[data-testid="sidebarColumn"] div.r-1867qdf:has([data-testid="UserCell"]):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] div.r-1867qdf:has(aside):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] div.r-1867qdf:has(a[href*="/connect_people"]):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] .r-vacyoi.r-ttdzmv > div:has([data-testid="UserCell"]):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] .r-vacyoi.r-ttdzmv > div:has(aside):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] .r-vacyoi.r-ttdzmv > div:has(a[href*="/connect_people"]):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] aside:has([data-testid="UserCell"]):not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] aside[aria-label*="关注"]:not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] aside[aria-label*="Follow"]:not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] aside[aria-label*="Who to follow"]:not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama),
      [data-testid="sidebarColumn"] aside:not(:has(form)):not(:has(input)):not([role="listbox"]):not([data-testid*="typeahead"]):not(.xf-sidebar-scheduled-panorama) {
        display: none !important;
      }`
    )
  } else {
    removeStyles('hideSidebarWhoToFollow')
  }

  void attachSidebarScheduledPanorama()
}

export const changeArticleToc = (state: string | number | boolean) => {
  if (state === 'off' || state === 'hide') {
    destroyArticleToc()
  } else {
    updateArticleToc(true)
  }
}

export const changeScheduledPanorama = (state: string | number | boolean) => {
  if (state === 'off' || state === 'hide') {
    removeScheduledPanorama()
  } else {
    void addScheduledRelativeTimes('on')
  }
}

export const changeJumpToComments = (state: string | number | boolean) => {
  if (state === 'off' || state === 'hide') {
    destroyJumpToComments()
  } else {
    void updateJumpToComments(true)
  }
}

export const changeHighlightNonFollowers = (state: string | number | boolean) => {
  const isFollowingPage = /\/following(\/|$)/.test(window.location.pathname)

  if (state === 'off' || !isFollowingPage) {
    if (document.getElementById('xf-style-highlightNonFollowers')) {
      removeStyles('highlightNonFollowers')
    }
    const btns = document.querySelectorAll('.xf-non-follower-btn')
    if (btns.length > 0) {
      btns.forEach((el) => {
        el.classList.remove('xf-non-follower-btn')
      })
    }
    return
  }

  // 通过 CSS :has() 结构性选择器确保即使在 React 重新渲染（例如 hover 触发状态变化、移开鼠标重置 className）
  // 导致 classList 中的 xf-non-follower-btn 被覆盖抹除时，仍能保持红框红字标记不丢失；
  // 同时保留 button.xf-non-follower-btn 保证向后兼容与测试环境正常工作。
  addStyles(
    'highlightNonFollowers',
    `[data-testid="UserCell"]:not(:has([data-testid="userFollowIndicator"])) button[data-testid*="-unfollow"],
    [data-testid="UserCell"]:not(:has([data-testid="userFollowIndicator"])) button[aria-label*="正在关注"],
    [data-testid="UserCell"]:not(:has([data-testid="userFollowIndicator"])) button[aria-label*="Following"],
    button.xf-non-follower-btn {
      border-color: rgb(244, 33, 46) !important;
      background-color: transparent !important;
    }
    [data-testid="UserCell"]:not(:has([data-testid="userFollowIndicator"])) button[data-testid*="-unfollow"] span,
    [data-testid="UserCell"]:not(:has([data-testid="userFollowIndicator"])) button[data-testid*="-unfollow"] div,
    [data-testid="UserCell"]:not(:has([data-testid="userFollowIndicator"])) button[aria-label*="正在关注"] span,
    [data-testid="UserCell"]:not(:has([data-testid="userFollowIndicator"])) button[aria-label*="正在关注"] div,
    [data-testid="UserCell"]:not(:has([data-testid="userFollowIndicator"])) button[aria-label*="Following"] span,
    [data-testid="UserCell"]:not(:has([data-testid="userFollowIndicator"])) button[aria-label*="Following"] div,
    button.xf-non-follower-btn span,
    button.xf-non-follower-btn div {
      color: rgb(244, 33, 46) !important;
    }
    [data-testid="UserCell"]:not(:has([data-testid="userFollowIndicator"])) button[data-testid*="-unfollow"]:hover,
    [data-testid="UserCell"]:not(:has([data-testid="userFollowIndicator"])) button[aria-label*="正在关注"]:hover,
    [data-testid="UserCell"]:not(:has([data-testid="userFollowIndicator"])) button[aria-label*="Following"]:hover,
    button.xf-non-follower-btn:hover {
      background-color: rgba(244, 33, 46, 0.1) !important;
      border-color: rgb(244, 33, 46) !important;
    }`
  )

  const userCells = document.querySelectorAll('[data-testid="UserCell"]')
  userCells.forEach((cell) => {
    const unfollowBtn =
      cell.querySelector('button[data-testid*="-unfollow"]') ||
      cell.querySelector('button[aria-label*="正在关注"]') ||
      cell.querySelector('button[aria-label*="Following"]')

    if (!unfollowBtn) return

    const hasFollowsYouIndicator = !!cell.querySelector('[data-testid="userFollowIndicator"]')
    if (!hasFollowsYouIndicator) {
      unfollowBtn.classList.add('xf-non-follower-btn')
    } else {
      unfollowBtn.classList.remove('xf-non-follower-btn')
    }
  })
}

