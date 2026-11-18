import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { JSDOM } from 'jsdom'
import { changeTimelineWidth, syncAccountAnalyticsPageMarker } from '../../content-scripts/options/timeline'

describe('changeTimelineWidth', () => {
  let dom: JSDOM

  beforeEach(() => {
    dom = new JSDOM(
      `<!DOCTYPE html><html><head>
        <style>
          .r-1mdsvnl { width: 95%; }
          .r-1ye8kvj { max-width: 600px; }
        </style>
      </head><body>
        <div data-testid="primaryColumn" style="width:800px">
          <div>
            <div>
              <div class="r-1mdsvnl" id="search">搜索书签</div>
              <div class="r-1ye8kvj" id="feed-wrap">
                <section role="region" id="feed">timeline</section>
              </div>
            </div>
          </div>
        </div>
      </body></html>`,
      { pretendToBeVisual: true, url: 'https://x.com/i/bookmarks' },
    )
    globalThis.document = dom.window.document
    // @ts-expect-error jsdom window 与浏览器 Window 类型不完全兼容
    globalThis.window = dom.window
    globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
  })

  afterEach(() => {
    dom.window.close()
  })

  it('expands section parent past 600px without stretching bookmarks search to 100%', () => {
    const search = document.getElementById('search')!
    expect(getComputedStyle(search).width).toBe('95%')

    changeTimelineWidth(800)

    const css = document.getElementById('xf-style-timelineWidth')!.textContent!

    // Timeline feed: override the 600px wrapper (X .r-1ye8kvj) via :has(> section) and profile state selectors
    expect(css).toContain('div:has(> section[role="region"])')
    expect(css).toContain('div.r-13qz1uu.r-1ye8kvj')
    expect(css).toContain('section[role="region"]')
    expect(css).toContain('div[role="group"].r-1ye8kvj')
    expect(css).toContain('[data-testid="twitterArticleReadView"] div[role="group"]')
    expect(css).toMatch(
      /div:has\(> section\[role="region"\]\)[\s\S]*?\{[^}]*max-width:\s*800px\s*!important/,
    )
    expect(css).toMatch(
      /div:has\(> section\[role="region"\]\)[\s\S]*?\{[^}]*width:\s*100%\s*!important/,
    )

    // Must not revive the old blanket depth-4 rule that broke search
    expect(css).not.toContain('> div > div > div > div')

    // Search keeps its own 95% (no matching width:100% override)
    expect(getComputedStyle(search).width).toBe('95%')
  })

  it('overrides 600px cap on article top interaction bar and action groups when timeline width is expanded', () => {
    changeTimelineWidth(800)

    const css = document.getElementById('xf-style-timelineWidth')!.textContent!

    expect(css).toMatch(
      /div\[role="group"\]\.r-1ye8kvj[\s\S]*?\{[^}]*max-width:\s*800px\s*!important/,
    )
    expect(css).toMatch(
      /div\[role="group"\]\.r-1ye8kvj[\s\S]*?\{[^}]*width:\s*100%\s*!important/,
    )
    expect(css).toMatch(
      /\[data-testid="twitterArticleReadView"\] div\[role="group"\][\s\S]*?\{[^}]*max-width:\s*800px\s*!important/,
    )
  })

  it('skips left-sidebar width compensation when navigation labels are never', () => {
    changeTimelineWidth(700, 'never')
    const neverCss = document.getElementById('xf-style-timelineWidth')!.textContent!
    expect(neverCss).not.toMatch(/header\[role="banner"\]\s*\{\s*width:/)

    changeTimelineWidth(700, 'always')
    const alwaysCss = document.getElementById('xf-style-timelineWidth')!.textContent!
    // 700 → 200 + (800-700)/50*25 = 250
    expect(alwaysCss).toContain('header[role="banner"] { width: 250px !important; }')
  })

  it('gates the primaryColumn width rules behind the account-analytics marker', () => {
    changeTimelineWidth(800)

    const css = document.getElementById('xf-style-timelineWidth')!.textContent!

    // 所有主列宽度规则都必须被 body 标记排除，账号分析页（/i/account_analytics）不受限
    expect(css).toContain('body:not([data-xf-account-analytics]) [data-testid="primaryColumn"]')
    expect(css).toContain(
      'body:not([data-xf-account-analytics]) [data-testid="primaryColumn"] div:has(> section[role="region"])',
    )
    expect(css).toContain(
      'body:not([data-xf-account-analytics]) [data-testid="primaryColumn"] section[role="region"]',
    )
    // 左侧栏补偿规则不属于主列宽度，保持不受标记影响
    changeTimelineWidth(700, 'always')
    const alwaysCss = document.getElementById('xf-style-timelineWidth')!.textContent!
    expect(alwaysCss).toContain('header[role="banner"] { width: 250px !important; }')
  })

  it('syncs the account-analytics marker based on the current path', () => {
    const marker = 'data-xf-account-analytics'

    // 非分析页：标记不存在
    syncAccountAnalyticsPageMarker()
    expect(document.body.hasAttribute(marker)).toBe(false)

    // 进入账号分析页：标记存在
    dom.window.history.pushState({}, '', '/i/account_analytics')
    syncAccountAnalyticsPageMarker()
    expect(document.body.hasAttribute(marker)).toBe(true)

    // 离开分析页：标记移除，宽度规则恢复
    dom.window.history.pushState({}, '', '/home')
    syncAccountAnalyticsPageMarker()
    expect(document.body.hasAttribute(marker)).toBe(false)
  })

  it('skips left-sidebar width compensation and resets primary margin-right when right sidebar is hidden', () => {
    changeTimelineWidth(700, 'always', 'on')
    const css = document.getElementById('xf-style-timelineWidth')!.textContent!
    expect(css).not.toMatch(/header\[role="banner"\]\s*\{\s*width:/)
    expect(css).toContain('margin-right: 0px;')

    changeTimelineWidth(700, 'always', 'off')
    const cssWithSidebar = document.getElementById('xf-style-timelineWidth')!.textContent!
    expect(cssWithSidebar).toContain('header[role="banner"] { width: 250px !important; }')
    expect(cssWithSidebar).toContain('margin-right: 20px;')
  })
})

describe('changeSidebarColumn & changeSidebarElements', () => {
  let dom: JSDOM

  beforeEach(() => {
    dom = new JSDOM(
      `<!DOCTYPE html><html><head></head><body>
        <header role="banner"><div><div><div>Nav</div></div></div></header>
        <main role="main">
          <div>
            <div>
              <div data-testid="primaryColumn">Timeline</div>
              <div data-testid="sidebarColumn">Sidebar</div>
            </div>
          </div>
        </main>
      </body></html>`,
      { pretendToBeVisual: true, url: 'https://x.com/home' },
    )
    globalThis.document = dom.window.document
    // @ts-expect-error jsdom window
    globalThis.window = dom.window
  })

  afterEach(() => {
    dom.window.close()
  })

  it('changeSidebarColumn removes full hide styles so search and scheduled panorama remain accessible', async () => {
    const { changeSidebarColumn } = await import('../../content-scripts/options/interface')
    const style = document.createElement('style')
    style.id = 'xf-style-hideSidebarColumn'
    document.head.appendChild(style)

    changeSidebarColumn('on')
    expect(document.getElementById('xf-style-hideSidebarColumn')).toBeNull()

    changeSidebarColumn('off')
    expect(document.getElementById('xf-style-hideSidebarColumn')).toBeNull()
  })

  it('changeSidebarElements granularly injects and removes hide styles for live, trends, and whoToFollow', async () => {
    const { changeSidebarElements } = await import('../../content-scripts/options/interface')

    // 默认全开：不注入隐藏样式（但底部条款始终彻底隐藏）
    changeSidebarElements('live,trends,whoToFollow')
    expect(document.getElementById('xf-style-hideSidebarAllThree')).toBeNull()
    expect(document.getElementById('xf-style-hideSidebarFooter')).not.toBeNull()
    expect(document.getElementById('xf-style-hideSidebarLive')).toBeNull()
    expect(document.getElementById('xf-style-hideSidebarTrends')).toBeNull()
    expect(document.getElementById('xf-style-hideSidebarWhoToFollow')).toBeNull()

    // 仅展示直播（隐藏新鲜事和推荐关注，移除全隐藏样式）
    changeSidebarElements('live')
    expect(document.getElementById('xf-style-hideSidebarAllThree')).toBeNull()
    expect(document.getElementById('xf-style-hideSidebarFooter')).not.toBeNull()
    expect(document.getElementById('xf-style-hideSidebarLive')).toBeNull()
    expect(document.getElementById('xf-style-hideSidebarTrends')).not.toBeNull()
    expect(document.getElementById('xf-style-hideSidebarWhoToFollow')).not.toBeNull()

    // 全隐藏（全部未勾选：注入全隐藏样式彻底无痕）
    changeSidebarElements('')
    expect(document.getElementById('xf-style-hideSidebarAllThree')).not.toBeNull()
    expect(document.getElementById('xf-style-hideSidebarFooter')).not.toBeNull()
    expect(document.getElementById('xf-style-hideSidebarLive')).not.toBeNull()
    expect(document.getElementById('xf-style-hideSidebarTrends')).not.toBeNull()
    expect(document.getElementById('xf-style-hideSidebarWhoToFollow')).not.toBeNull()

    // 重新全开
    changeSidebarElements('live,trends,whoToFollow')
    expect(document.getElementById('xf-style-hideSidebarAllThree')).toBeNull()
    expect(document.getElementById('xf-style-hideSidebarFooter')).not.toBeNull()
    expect(document.getElementById('xf-style-hideSidebarLive')).toBeNull()
    expect(document.getElementById('xf-style-hideSidebarTrends')).toBeNull()
    expect(document.getElementById('xf-style-hideSidebarWhoToFollow')).toBeNull()
  })

  it('staticFeatures.timeline triggers changeSidebarElements and applies hide rules', async () => {
    const { staticFeatures } = await import('../../content-scripts/features/static')
    const { KeySidebarElements, KeyTimelineWidth, KeyNavigationButtonsLabels, KeySidebarColumn, KeyTweetButton, KeyHighlightNonFollowers, KeyArticleToc, KeyScheduledPanorama } = await import('../../storage-keys')

    staticFeatures.timeline({
      [KeyTimelineWidth]: 600,
      [KeyNavigationButtonsLabels]: 'always',
      [KeySidebarColumn]: 'off',
      [KeySidebarElements]: '',
      [KeyTweetButton]: 'on',
      [KeyHighlightNonFollowers]: 'off',
      [KeyArticleToc]: 'off',
      [KeyScheduledPanorama]: 'off',
    } as any)

    expect(document.getElementById('xf-style-hideSidebarAllThree')).not.toBeNull()
    expect(document.getElementById('xf-style-hideSidebarLive')).not.toBeNull()
  })

  it('hideSidebarAllThree CSS 包含 display: none !important 并且严格排除搜索表单、输入框、下拉框与建议浮层', async () => {
    const { changeSidebarElements } = await import('../../content-scripts/options/interface')

    changeSidebarElements('')
    const allThreeStyle = document.getElementById('xf-style-hideSidebarAllThree')
    expect(allThreeStyle).not.toBeNull()
    const css = allThreeStyle!.textContent!

    expect(css).toContain('display: none !important;')
    expect(css).toContain(':not(:has(form))')
    expect(css).toContain(':not(:has(input))')
    expect(css).toContain(':not([role="listbox"])')
    expect(css).toContain(':not(:has([role="listbox"]))')
    expect(css).toContain(':not([data-testid*="typeahead"])')
    expect(css).toContain(':not(:has([data-testid*="typeahead"]))')
    expect(css).toContain(':not(.xf-sidebar-scheduled-panorama)')
    expect(css).toContain(':not(:has(.xf-sidebar-scheduled-panorama))')
  })
})

describe('changeTweetButton', () => {
  let dom: JSDOM

  beforeEach(() => {
    dom = new JSDOM(
      `<!DOCTYPE html><html><head></head><body>
        <header role="banner">
          <nav role="navigation">
            <a data-testid="SideNav_NewTweet_Button" href="/compose/post"><span>Tweet</span></a>
          </nav>
        </header>
      </body></html>`,
      { pretendToBeVisual: true, url: 'https://x.com/home' },
    )
    globalThis.document = dom.window.document
    // @ts-expect-error jsdom window
    globalThis.window = dom.window
  })

  afterEach(() => {
    dom.window.close()
  })

  it('hides both native and custom tweet buttons with hover-overriding specificity when off', async () => {
    const { changeTweetButton } = await import('../../content-scripts/options/interface')
    changeTweetButton('off')

    const css = document.getElementById('xf-style-hideTweetButton')!.textContent!
    expect(css).toContain('.xf-custom-tweet-button')
    expect(css).toContain('a[data-testid="SideNav_NewTweet_Button"]')
    expect(css).toContain('header[role="banner"]:hover')
    expect(css).toContain('display: none !important;')

    changeTweetButton('on')
    expect(document.getElementById('xf-style-hideTweetButton')).toBeNull()
  })

  it('restores and ensures custom tweet button when navigation labels are never or hover', async () => {
    const { changeTweetButton } = await import('../../content-scripts/options/interface')
    changeTweetButton('off')
    expect(document.querySelector('.xf-custom-tweet-button')).toBeNull()

    changeTweetButton('on', 'never')
    expect(document.getElementById('xf-style-hideTweetButton')).toBeNull()
    expect(document.querySelector('.xf-custom-tweet-button')).not.toBeNull()
  })
})
