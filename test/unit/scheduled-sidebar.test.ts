import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  attachSidebarScheduledPanorama,
  removeScheduledPanorama,
  findSidebarInsertionPoint,
  findSearchFiltersContainer,
  persistScheduledPosts,
  buildScheduleOverviewHtml,
  upsertScheduledPost,
  deleteScheduledPost,
  parseScheduledTimeString,
  bindScheduleGotoButtons,
  listenForScheduledTweetsApi,
  getPersistedScheduledPosts,
  isScheduledPanoramaExcludedPath,
  isComposeOrUnsentModalOpen,
  getEffectiveBasePagePath,
  setLastNonComposePathForTest,
  autoOpenScheduledTweetFromSession,
} from '../../content-scripts/options/scheduled-time'
import { KeySidebarColumn, KeyScheduledPanorama } from '../../storage-keys'
import {
  XF_BRIDGE_MARKER,
  SCHEDULED_TWEET_CREATED_TYPE,
  SCHEDULED_TWEET_DELETED_TYPE,
} from '../../shared/bridge'
import { setStorage } from '../../content-scripts/utilities/storage'

function makeStorageSpy() {
  const store: Record<string, unknown> = {}
  const writes: Array<Record<string, unknown>> = []
  return {
    store,
    writes,
    get: async (keys: string | string[]) => {
      const arr = Array.isArray(keys) ? keys : [keys]
      return arr.reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = store[k]
        return acc
      }, {})
    },
    set: async (data: Record<string, unknown>) => {
      writes.push(data)
      Object.assign(store, data)
    },
    remove: async () => {},
  }
}

describe('排期全景侧边栏展示与预排期直达测试', () => {
  beforeEach(async () => {
    const storage = makeStorageSpy()
    ;(globalThis as any).browser = {
      runtime: { id: 'test-runtime', onMessage: { addListener: () => {} } },
      storage: { local: storage },
    }
    localStorage.clear()
    document.body.innerHTML = ''
    // 默认开启排期全景，右侧栏默认显示（off）
    await setStorage({
      [KeyScheduledPanorama]: 'on',
      [KeySidebarColumn]: 'off',
    })
    removeScheduledPanorama()
  })

  it('buildScheduleOverviewHtml 能生成带有“预排期”直达按钮和排期列表的 HTML', () => {
    const futureTime = Date.now() + 3600 * 1000 // 1小时后
    const html = buildScheduleOverviewHtml(
      [
        {
          timestamp: futureTime,
          formattedTime: '2026-09-19 18:00',
          text: '这是一条未来的排期推文测试文案',
        },
      ],
      { showGotoBtn: true }
    )

    expect(html).toContain('排期全景')
    expect(html).toContain('预排期')
    expect(html).toContain('/compose/post/unsent/scheduled')
    expect(html).toContain('这是一条未来的排期推文测试文案')
    expect(html).toContain('共 1 条')
    // 外部侧边栏不渲染智能排期控制栏（仅弹窗中开启）
    expect(html).not.toContain('xf-smart-scheduler-bar')
  })

  it('暂无排期时 buildScheduleOverviewHtml 友好展示空状态与预排期引导', () => {
    const html = buildScheduleOverviewHtml([], { showGotoBtn: true })
    expect(html).toContain('排期全景')
    expect(html).toContain('预排期')
    expect(html).toContain('暂无待发排期推文')
    expect(html).toContain('共 0 条')
  })

  it('暗黑模式下 buildScheduleOverviewHtml 输出高对比度正文文字颜色 #e7e9ea', () => {
    document.body.style.backgroundColor = 'rgb(0, 0, 0)'
    const html = buildScheduleOverviewHtml([
      {
        restId: 'dark-test-1',
        text: '暗黑模式下的清晰文本测试',
        timestamp: Date.now() + 3600000,
        formattedTime: '2026-09-19 17:45',
      },
    ])
    expect(html).toContain('#e7e9ea')
    expect(html).toContain('xf-schedule-item-text')
    document.body.style.backgroundColor = ''
  })

  it('模式 A：右侧边栏正常显示时，在 [data-testid="sidebarColumn"] 内渲染排期卡片', async () => {
    window.history.pushState({}, '', '/home')
    document.body.innerHTML = `
      <div data-testid="sidebarColumn" style="display: block; width: 350px;">
        <div>
          <form role="search"><input data-testid="SearchBox_Search_Input" /></form>
          <div class="existing-section">Trends</div>
        </div>
      </div>
    `

    const futureTime = Date.now() + 45 * 60 * 1000 // 45分钟后
    await persistScheduledPosts([
      {
        restId: '123',
        timestamp: futureTime,
        formattedTime: '2026-09-19 17:45',
        text: '准备发布的精彩推文',
      },
    ])

    await attachSidebarScheduledPanorama()

    const sidebarCol = document.querySelector('[data-testid="sidebarColumn"]')!
    const card = sidebarCol.querySelector('.xf-sidebar-scheduled-panorama')
    expect(card).not.toBeNull()
    expect(card?.textContent).toContain('排期全景')
    expect(card?.textContent).toContain('预排期')
    expect(card?.textContent).toContain('准备发布的精彩推文')

    // 验证预排期按钮存在且有跳转链接
    const gotoBtn = card?.querySelector('.xf-scheduled-goto-btn') as HTMLAnchorElement
    expect(gotoBtn).not.toBeNull()
    expect(gotoBtn.getAttribute('href')).toBe('/compose/post/unsent/scheduled')

    // 验证结构规范：包含固定标题头和独立滚动区域
    expect(card?.querySelector('.xf-scheduled-header')).not.toBeNull()
    const scrollBody = card?.querySelector('.xf-scheduled-body') as HTMLElement
    expect(scrollBody).not.toBeNull()

    // 模式 A 时不应出现独立侧边栏
    expect(document.querySelector('.xf-standalone-scheduled-sidebar')).toBeNull()
  })

  it('模式 A：外部排期全景结合搜索栏动态测算安全边距，并阻断边界滚动击穿全局页面', async () => {
    window.history.pushState({}, '', '/home')
    document.body.innerHTML = `
      <div data-testid="sidebarColumn" style="display: block; width: 350px;">
        <div>
          <form role="search" style="height: 53px;"><input data-testid="SearchBox_Search_Input" /></form>
          <div class="existing-section">Trends</div>
        </div>
      </div>
    `

    // 模拟搜索框具有底部位置 53px
    const searchForm = document.querySelector('form[role="search"]') as HTMLElement
    searchForm.getBoundingClientRect = () => ({
      top: 0,
      bottom: 53,
      left: 0,
      right: 350,
      width: 350,
      height: 53,
      x: 0,
      y: 0,
      toJSON: () => {},
    })

    await persistScheduledPosts([
      {
        restId: '1',
        timestamp: Date.now() + 3600000,
        formattedTime: '2026-09-19 18:00',
        text: '长文本测试1',
      },
      {
        restId: '2',
        timestamp: Date.now() + 7200000,
        formattedTime: '2026-09-19 19:00',
        text: '长文本测试2',
      },
    ])

    await attachSidebarScheduledPanorama()

    const card = document.querySelector('.xf-sidebar-scheduled-panorama') as HTMLElement
    expect(card).not.toBeNull()
    // 搜索栏底部 53px，最小保底为 60px（间隙再缩减 6px）
    expect(card.style.getPropertyValue('--xf-search-offset')).toBe('60px')

    const scrollBody = card.querySelector('.xf-scheduled-body') as HTMLElement
    expect(scrollBody).not.toBeNull()

    // 模拟内部滚动区域溢出（可滚动状态）
    Object.defineProperty(scrollBody, 'scrollHeight', { value: 600, configurable: true })
    Object.defineProperty(scrollBody, 'clientHeight', { value: 300, configurable: true })
    Object.defineProperty(scrollBody, 'scrollTop', { value: 0, writable: true, configurable: true })

    // 测试 1：在最顶部向上滚动，触发边界阻断（preventDefault）
    const wheelUpAtTop = new MouseEvent('wheel', { bubbles: true, cancelable: true }) as any
    wheelUpAtTop.deltaY = -100
    let prevented = false
    let stopped = false
    wheelUpAtTop.preventDefault = () => { prevented = true }
    wheelUpAtTop.stopPropagation = () => { stopped = true }
    scrollBody.dispatchEvent(wheelUpAtTop)

    expect(prevented).toBe(true)
    expect(stopped).toBe(true)

    // 测试 2：在最底部向下滚动，同样触发边界阻断
    scrollBody.scrollTop = 300 // scrollTop + clientHeight == scrollHeight
    const wheelDownAtBottom = new MouseEvent('wheel', { bubbles: true, cancelable: true }) as any
    wheelDownAtBottom.deltaY = 100
    let preventedBottom = false
    wheelDownAtBottom.preventDefault = () => { preventedBottom = true }
    wheelDownAtBottom.stopPropagation = () => {}
    scrollBody.dispatchEvent(wheelDownAtBottom)

    expect(preventedBottom).toBe(true)
  })

  it('模式 A (explore/无搜索框)：当右侧栏无搜索框与筛选卡片时，排期全景顶格贴顶 (topOffset: 12px) 且占满全部高度', async () => {
    window.history.pushState({}, '', '/explore')
    document.body.innerHTML = `
      <div data-testid="sidebarColumn" style="display: block; width: 350px;">
        <div class="existing-section">
          <div>Trends</div>
        </div>
      </div>
      <div data-testid="primaryColumn" style="width: 600px;"></div>
    `

    await persistScheduledPosts([
      {
        restId: '1',
        timestamp: Date.now() + 3600000,
        formattedTime: '2026-09-19 18:00',
        text: 'explore页面测试推文',
      },
    ])

    await attachSidebarScheduledPanorama()

    const card = document.querySelector('.xf-sidebar-scheduled-panorama') as HTMLElement
    expect(card).not.toBeNull()
    // 侧边栏无搜索框，--xf-search-offset 应当顶格为 12px，消除顶部多余空隙
    expect(card.style.getPropertyValue('--xf-search-offset')).toBe('12px')
    // 高度为 viewportHeight - 12 - 12 (上下留白对称，完全占满视口)
    const expectedHeight = `${window.innerHeight - 24}px`
    expect(card.style.getPropertyValue('--xf-panorama-height')).toBe(expectedHeight)
  })

  it('模式 B：当右侧边栏被用户隐藏时，在 primaryColumn 旁边挂载独立侧边栏展示与收起/展开开关', async () => {
    window.history.pushState({}, '', '/home')
    // 用户设置了隐藏右侧栏
    await setStorage({
      [KeySidebarColumn]: 'on',
    })

    document.body.innerHTML = `
      <div class="layout-parent">
        <div data-testid="primaryColumn" style="width: 600px;"></div>
        <div data-testid="sidebarColumn" style="display: none; width: 0px;"></div>
      </div>
    `

    const futureTime = Date.now() + 2 * 3600 * 1000 // 2小时后
    await persistScheduledPosts([
      {
        restId: '456',
        timestamp: futureTime,
        formattedTime: '2026-09-19 19:00',
        text: '侧边栏隐藏时的独立排期内容',
      },
    ])

    await attachSidebarScheduledPanorama()

    // 模式 B 不在 [data-testid="sidebarColumn"] 内寄生挂载，而是在页面独立挂载 .xf-standalone-scheduled-sidebar
    expect(document.querySelector('[data-testid="sidebarColumn"] .xf-sidebar-scheduled-panorama')).toBeNull()
    const standalone = document.querySelector('.xf-standalone-scheduled-sidebar') as HTMLElement
    expect(standalone).not.toBeNull()
    expect(standalone.parentElement?.classList.contains('layout-parent')).toBe(true)

    const card = standalone.querySelector('.xf-sidebar-scheduled-panorama') as HTMLElement
    expect(card).not.toBeNull()
    expect(card.textContent).toContain('排期全景')
    expect(card.textContent).toContain('预排期')
    expect(card.textContent).toContain('共 1 条')
    expect(card.textContent).toContain('侧边栏隐藏时的独立排期内容')

    // 验证带有“收起”开关
    const toggleSwitch = card.querySelector('.xf-scheduled-toggle-switch') as HTMLButtonElement
    expect(toggleSwitch).not.toBeNull()
    expect(toggleSwitch.textContent).toContain('收起')

    // 点击收起开关，折叠排期详情
    toggleSwitch.click()
    expect(localStorage.getItem('xf_scheduled_sidebar_collapsed')).toBe('1')

    await attachSidebarScheduledPanorama()
    const cardCollapsed = document.querySelector('.xf-standalone-scheduled-sidebar .xf-sidebar-scheduled-panorama')
    expect(cardCollapsed?.querySelector('.xf-scheduled-toggle-switch')?.textContent).toContain('展开')
    const body = cardCollapsed?.querySelector('.xf-scheduled-body') as HTMLElement
    expect(body.style.display).toContain('none')
  })

  it('当排期全景被用户关闭时，清除所有侧边栏卡片与独立展示容器', async () => {
    window.history.pushState({}, '', '/home')
    await setStorage({
      [KeyScheduledPanorama]: 'off',
    })

    document.body.innerHTML = `
      <div data-testid="sidebarColumn" style="display: block; width: 350px;">
        <div class="xf-sidebar-scheduled-panorama">旧卡片</div>
      </div>
      <div class="xf-standalone-scheduled-sidebar">旧独立容器</div>
    `

    await attachSidebarScheduledPanorama()

    expect(document.querySelector('.xf-sidebar-scheduled-panorama')).toBeNull()
    expect(document.querySelector('.xf-standalone-scheduled-sidebar')).toBeNull()
  })

  it('findSidebarInsertionPoint 正确识别搜索框后的插入位置', () => {
    const sidebar = document.createElement('div')
    sidebar.setAttribute('data-testid', 'sidebarColumn')
    sidebar.innerHTML = `
      <div>
        <div class="search-box-wrapper">
          <form role="search"><input data-testid="SearchBox_Search_Input" /></form>
        </div>
        <div class="widget-1">Widget 1</div>
      </div>
    `

    const { parent, referenceNode } = findSidebarInsertionPoint(sidebar)
    expect(parent).toBe(sidebar.querySelector('.search-box-wrapper')?.parentElement)
    expect(referenceNode).toBe(sidebar.querySelector('.widget-1'))
  })

  it('findSidebarInsertionPoint 能自动跳过搜索框的粘性占位垫高层（如 r-1h3ijdo 空 div），精准插在搜索框下方', () => {
    const sidebar = document.createElement('div')
    sidebar.setAttribute('data-testid', 'sidebarColumn')
    sidebar.innerHTML = `
      <div>
        <div class="search-sticky-header">
          <form role="search"><input data-testid="SearchBox_Search_Input" /></form>
        </div>
        <div class="css-g5y9jx r-1h3ijdo"></div>
        <div class="widget-trends">Trends Card</div>
      </div>
    `

    const { parent, referenceNode } = findSidebarInsertionPoint(sidebar)
    expect(parent).toBe(sidebar.querySelector('.search-sticky-header')?.parentElement)
    expect(referenceNode).toBe(sidebar.querySelector('.widget-trends'))
  })

  it('搜索页场景：findSidebarInsertionPoint 正确识别“搜索筛选/高级搜索”面板，将排期全景放置在其下方', () => {
    const sidebar = document.createElement('div')
    sidebar.setAttribute('data-testid', 'sidebarColumn')
    sidebar.innerHTML = `
      <div class="r-vacyoi r-ttdzmv" id="container">
        <!-- 顶部搜索栏与垫高层 -->
        <div class="sticky-search"><form role="search"><input data-testid="SearchBox_Search_Input" /></form></div>
        <div class="r-1h3ijdo spacer"></div>
        <!-- 搜索页专有的搜索筛选与高级搜索卡片 -->
        <div class="r-1867qdf" data-testid="searchFilters" id="filters-card">
          <h2>搜索筛选</h2>
          <a href="/search-advanced">高级搜索</a>
        </div>
        <!-- 后续模块，如趋势 -->
        <div class="r-1867qdf" id="trends-card">Trends Card</div>
      </div>
    `
    const { parent, referenceNode } = findSidebarInsertionPoint(sidebar)
    const container = sidebar.querySelector('#container')
    const trendsCard = sidebar.querySelector('#trends-card')
    const filtersCard = sidebar.querySelector('#filters-card')

    expect(parent).toBe(container)
    // referenceNode 必须是搜索筛选之后的下一个兄弟节点，确保排期全景插在搜索筛选下方
    expect(referenceNode).toBe(trendsCard)
  })

  it('搜索页场景：attachSidebarScheduledPanorama 插入在搜索筛选下方，并自动调整安全高度偏移行内变量避免出现滚动条', async () => {
    window.history.pushState({}, '', '/search?q=from%3Astar_flow_ai%20Plus&src=typed_query')
    document.body.innerHTML = `
      <div data-testid="sidebarColumn" style="display: block; width: 350px;">
        <div class="r-vacyoi r-ttdzmv" id="container">
          <div class="sticky-search"><form role="search"><input data-testid="SearchBox_Search_Input" /></form></div>
          <div class="r-1h3ijdo"></div>
          <div class="r-1867qdf" data-testid="searchFilters" id="filters-card">
            <h2>搜索筛选</h2>
            <a href="/search-advanced">高级搜索</a>
          </div>
          <div class="r-1867qdf" id="trends-card">Trends</div>
        </div>
      </div>
    `
    await attachSidebarScheduledPanorama()

    const card = document.querySelector('.xf-sidebar-scheduled-panorama') as HTMLElement
    expect(card).not.toBeNull()

    const filtersCard = document.querySelector('#filters-card')!
    const trendsCard = document.querySelector('#trends-card')!

    // 验证位置：排期全景在搜索筛选下方、在趋势卡片上方
    expect(filtersCard.nextElementSibling).toBe(card)
    expect(card.nextElementSibling).toBe(trendsCard)

    // 验证 --xf-search-offset 动态自适应高度，避免溢出可视区产生滚动条（兜底或实测 >= 320px）
    const searchOffset = card.style.getPropertyValue('--xf-search-offset')
    expect(parseInt(searchOffset, 10)).toBeGreaterThanOrEqual(320)

    // 验证搜索页专有类名，且高度在原有基础上减小 4px 填满可视区同时杜绝纵向滚动条
    expect(card.classList.contains('xf-is-search-page')).toBe(true)
    const maxHeightVal = parseInt(card.style.getPropertyValue('--xf-panorama-max-height'), 10)
    expect(maxHeightVal).toBe(window.innerHeight - parseInt(searchOffset, 10) - 4)
  })

  it('upsertScheduledPost 能够新增并智能去重更新排期，并立即自动触发看板渲染', async () => {
    window.history.pushState({}, '', '/home')
    document.body.innerHTML = `
      <div data-testid="sidebarColumn" style="display: block; width: 350px;">
        <div>
          <div class="search-box-wrapper">
            <form role="search"><input data-testid="SearchBox_Search_Input" /></form>
          </div>
          <div class="existing-section">Trends</div>
        </div>
      </div>
    `
    const futureTime = Date.now() + 7200 * 1000 // 2小时后

    // 首次插入
    await upsertScheduledPost({
      restId: 'scheduled_1',
      timestamp: futureTime,
      text: '测试自动新增推文',
    })

    const itemsAfterInsert = await getPersistedScheduledPosts()
    expect(itemsAfterInsert).toHaveLength(1)
    expect(itemsAfterInsert[0].text).toBe('测试自动新增推文')

    const card = document.querySelector('.xf-sidebar-scheduled-panorama')
    expect(card).not.toBeNull()
    expect(card?.textContent).toContain('测试自动新增推文')
    expect(card?.textContent).toContain('共 1 条')

    // 再次以相同 restId 插入更新内容（防重与内容更新）
    await upsertScheduledPost({
      restId: 'scheduled_1',
      timestamp: futureTime + 60000,
      text: '测试自动新增推文（已更新）',
    })

    const itemsAfterUpdate = await getPersistedScheduledPosts()
    expect(itemsAfterUpdate).toHaveLength(1)
    expect(itemsAfterUpdate[0].text).toBe('测试自动新增推文（已更新）')
    expect(card?.textContent).toContain('测试自动新增推文（已更新）')
  })

  it('deleteScheduledPost 能够根据 ID 删除排期并立即更新看板', async () => {
    window.history.pushState({}, '', '/home')
    document.body.innerHTML = `
      <div data-testid="sidebarColumn" style="display: block; width: 350px;">
        <div>
          <div class="search-box-wrapper">
            <form role="search"><input data-testid="SearchBox_Search_Input" /></form>
          </div>
          <div class="existing-section">Trends</div>
        </div>
      </div>
    `
    const futureTime = Date.now() + 3600 * 1000
    await persistScheduledPosts([
      {
        restId: 'del_target',
        timestamp: futureTime,
        formattedTime: '2026-09-20 12:00',
        text: '待删除推文',
      },
    ])
    await attachSidebarScheduledPanorama()

    const card = document.querySelector('.xf-sidebar-scheduled-panorama')
    expect(card?.textContent).toContain('待删除推文')

    await deleteScheduledPost('del_target')

    const itemsAfterDel = await getPersistedScheduledPosts()
    expect(itemsAfterDel).toHaveLength(0)
    expect(card?.textContent).toContain('暂无待发排期推文')
  })

  it('listenForScheduledTweetsApi 收到新建和删除事件消息时能正确处理', async () => {
    listenForScheduledTweetsApi()

    const futureTime = Date.now() + 1800 * 1000 // 30分钟后

    // 发送 SCHEDULED_TWEET_CREATED_TYPE
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          __xf: XF_BRIDGE_MARKER,
          type: SCHEDULED_TWEET_CREATED_TYPE,
          payload: {
            restId: 'created_via_msg',
            timestamp: futureTime,
            text: '来自消息广播的新排期',
          },
        },
      })
    )

    // 等待微任务完成
    await new Promise((r) => setTimeout(r, 50))
    const items = await getPersistedScheduledPosts()
    expect(items.some((it) => it.restId === 'created_via_msg')).toBe(true)

    // 发送 SCHEDULED_TWEET_DELETED_TYPE
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          __xf: XF_BRIDGE_MARKER,
          type: SCHEDULED_TWEET_DELETED_TYPE,
          payload: {
            scheduledTweetId: 'created_via_msg',
          },
        },
      })
    )

    await new Promise((r) => setTimeout(r, 50))
    const itemsAfterDel = await getPersistedScheduledPosts()
    expect(itemsAfterDel.some((it) => it.restId === 'created_via_msg')).toBe(false)
  })

  it('parseScheduledTimeString 能精准解析各种中文与英文格式', () => {
    // 中文标准
    const d1 = parseScheduledTimeString('将于 2026年9月20日周日 上午12:47 发布')
    expect(d1).not.toBeNull()
    expect(d1?.getFullYear()).toBe(2026)
    expect(d1?.getMonth()).toBe(8) // 9月为索引8
    expect(d1?.getDate()).toBe(20)
    expect(d1?.getHours()).toBe(0) // 12:47 AM = 00:47
    expect(d1?.getMinutes()).toBe(47)

    // 英文 Month Day, Year
    const d2 = parseScheduledTimeString('Will send on Sun, Sep 20, 2026 at 12:47 AM')
    expect(d2).not.toBeNull()
    expect(d2?.getFullYear()).toBe(2026)
    expect(d2?.getMonth()).toBe(8)
    expect(d2?.getDate()).toBe(20)
    expect(d2?.getHours()).toBe(0)
    expect(d2?.getMinutes()).toBe(47)

    // 英文 Day Month Year
    const d3 = parseScheduledTimeString('Will send on 20 Sep 2026 at 14:30')
    expect(d3).not.toBeNull()
    expect(d3?.getFullYear()).toBe(2026)
    expect(d3?.getMonth()).toBe(8)
    expect(d3?.getDate()).toBe(20)
    expect(d3?.getHours()).toBe(14)
    expect(d3?.getMinutes()).toBe(30)
  })

  it('buildScheduleOverviewHtml 包含刷新按钮且 bindScheduleGotoButtons 能触发刷新', async () => {
    const html = buildScheduleOverviewHtml([], { showGotoBtn: true })
    expect(html).toContain('xf-scheduled-refresh-btn')

    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)

    bindScheduleGotoButtons(container)

    const refreshBtn = container.querySelector<HTMLButtonElement>('.xf-scheduled-refresh-btn')
    expect(refreshBtn).not.toBeNull()

    // 点击刷新按钮
    refreshBtn?.click()
    expect(refreshBtn?.style.transform).toBe('rotate(360deg)')
  })

  it('findSidebarInsertionPoint 绝不插入到搜索框 SearchBox_Search_Input_label 内部，而是稳定挂载在模块列表容器中', async () => {
    // 模拟 Twitter 真实深层 DOM 结构
    const sidebarCol = document.createElement('div')
    sidebarCol.setAttribute('data-testid', 'sidebarColumn')
    sidebarCol.innerHTML = `
      <div class="r-1pi2tsx">
        <div class="r-hycxz">
          <div class="r-vacyoi r-ttdzmv" id="module-container">
            <!-- 顶部粘性搜索栏容器 -->
            <div class="r-1h3ijdo sticky-search" style="height: 53px;">
              <form role="search">
                <div data-testid="SearchBox_Search_Input_label" id="search-label">
                  <div class="search-icon"><svg></svg></div>
                  <div class="input-wrapper">
                    <input data-testid="SearchBox_Search_Input" id="search-input" />
                  </div>
                  <div class="clear-btn"><button>x</button></div>
                </div>
              </form>
            </div>
            <!-- 53px 垫高占位层 -->
            <div class="r-1h3ijdo" style="height: 53px;" id="spacer"></div>
            <!-- 侧边栏内容模块 -->
            <div class="r-1867qdf" id="trends-module">Trends</div>
          </div>
        </div>
      </div>
    `
    document.body.appendChild(sidebarCol)

    const result = findSidebarInsertionPoint(sidebarCol)
    const moduleContainer = sidebarCol.querySelector('#module-container')!
    const searchLabel = sidebarCol.querySelector('#search-label')!
    const trendsModule = sidebarCol.querySelector('#trends-module')!

    // 严禁以 SearchBox_Search_Input_label 作为挂载父节点！
    expect(result.parent).not.toBe(searchLabel)
    expect(result.parent).toBe(moduleContainer)
    // 必须跳过搜索栏与 53px 垫高层，插在第一个内容模块之前
    expect(result.referenceNode).toBe(trendsModule)

    // 模拟 attachSidebarScheduledPanorama
    await attachSidebarScheduledPanorama()
    const card = sidebarCol.querySelector('.xf-sidebar-scheduled-panorama')
    expect(card).not.toBeNull()
    expect(card?.parentElement).toBe(moduleContainer)
    expect(searchLabel.contains(card)).toBe(false)
  })

  it('isScheduledPanoramaExcludedPath 准确识别会员购买与非内容流排除路径', () => {
    expect(isScheduledPanoramaExcludedPath('/i/premium')).toBe(true)
    expect(isScheduledPanoramaExcludedPath('/i/premium_sign_up')).toBe(true)
    expect(isScheduledPanoramaExcludedPath('/i/premium_tiers')).toBe(true)
    expect(isScheduledPanoramaExcludedPath('/settings')).toBe(true)
    expect(isScheduledPanoramaExcludedPath('/settings/monetization')).toBe(true)
    expect(isScheduledPanoramaExcludedPath('/i/flow/login')).toBe(true)
    expect(isScheduledPanoramaExcludedPath('/i/verified-orgs-signup')).toBe(true)
    expect(isScheduledPanoramaExcludedPath('/compose/post')).toBe(true)
    expect(isScheduledPanoramaExcludedPath('/compose/post/unsent/scheduled')).toBe(true)
    expect(isScheduledPanoramaExcludedPath('/compose/tweet')).toBe(true)
    expect(isScheduledPanoramaExcludedPath('/intent/tweet')).toBe(true)
    expect(isScheduledPanoramaExcludedPath('/i/monetization')).toBe(true)
    expect(isScheduledPanoramaExcludedPath('/i/creator')).toBe(true)
    expect(isScheduledPanoramaExcludedPath('/i/jf')).toBe(true)
    expect(isScheduledPanoramaExcludedPath('/i/account_analytics')).toBe(true)
    expect(isScheduledPanoramaExcludedPath('/i/analytics')).toBe(true)

    expect(isScheduledPanoramaExcludedPath('/home')).toBe(false)
    expect(isScheduledPanoramaExcludedPath('/')).toBe(false)
    expect(isScheduledPanoramaExcludedPath('/explore')).toBe(false)
    expect(isScheduledPanoramaExcludedPath('/notifications')).toBe(false)
    expect(isScheduledPanoramaExcludedPath('/elonmusk')).toBe(false)
  })

  it('isComposeOrUnsentModalOpen 能够识别发帖弹窗或排期未发送列表', () => {
    document.body.innerHTML = `<div>首页内容</div>`
    expect(isComposeOrUnsentModalOpen()).toBe(false)

    document.body.innerHTML = `<div data-testid="unsentTweet">排期推文</div>`
    expect(isComposeOrUnsentModalOpen()).toBe(true)

    document.body.innerHTML = `
      <div role="dialog">
        <div data-testid="tweetTextarea_0">输入文字</div>
      </div>
    `
    expect(isComposeOrUnsentModalOpen()).toBe(true)
  })

  it('在 /i/premium 页面禁止插入排期全景，并清理旧残留看板', async () => {
    window.history.pushState({}, '', '/i/premium')
    document.body.innerHTML = `
      <div class="layout-parent">
        <div data-testid="primaryColumn"></div>
        <div data-testid="sidebarColumn">
          <!-- 预先存在上一页残留看板 -->
          <div class="xf-sidebar-scheduled-panorama">旧看板</div>
          <div class="help-center">帮助中心</div>
        </div>
      </div>
    `

    await attachSidebarScheduledPanorama()

    // 确认排期全景被清除，并未插入新看板
    expect(document.querySelector('.xf-sidebar-scheduled-panorama')).toBeNull()
    expect(document.querySelector('.xf-standalone-scheduled-sidebar')).toBeNull()
  })

  it('在 /compose/post 与 /compose/post/unsent/scheduled 页面及发帖弹窗打开时禁止插入并清除排期看板', async () => {
    // 模拟从 /i/premium 打开 /compose/post 弹窗（底层为 /i/premium 排除页面）
    setLastNonComposePathForTest('/i/premium')
    window.history.pushState({}, '', '/compose/post')
    document.body.innerHTML = `
      <div class="layout-parent">
        <div data-testid="primaryColumn"></div>
        <div class="xf-standalone-scheduled-sidebar">残留独立侧边栏</div>
        <div role="dialog">
          <div data-testid="tweetTextarea_0">发帖编辑中</div>
        </div>
      </div>
    `

    await attachSidebarScheduledPanorama()
    expect(document.querySelector('.xf-sidebar-scheduled-panorama')).toBeNull()
    expect(document.querySelector('.xf-standalone-scheduled-sidebar')).toBeNull()

    // 模拟进入 /compose/post/unsent/scheduled（原生排期管理列表页始终排除）
    window.history.pushState({}, '', '/compose/post/unsent/scheduled')
    document.body.innerHTML = `
      <div class="layout-parent">
        <div data-testid="primaryColumn"></div>
        <div data-testid="unsentTweet">原生排期列表</div>
      </div>
    `

    await attachSidebarScheduledPanorama()
    expect(document.querySelector('.xf-sidebar-scheduled-panorama')).toBeNull()
    expect(document.querySelector('.xf-standalone-scheduled-sidebar')).toBeNull()
  })

  it('在 /home, /explore, /star_flow_ai 打开发帖弹窗时，底层背景侧边栏排期看板保持显示不变', async () => {
    // 1. 模拟在 /home 正常浏览
    window.history.pushState({}, '', '/home')
    setLastNonComposePathForTest('/home')

    document.body.innerHTML = `
      <div class="layout-parent">
        <div data-testid="primaryColumn"></div>
        <div data-testid="sidebarColumn">
          <div class="xf-sidebar-scheduled-panorama" data-xf-overview-sig="initial">已有看板</div>
        </div>
      </div>
    `

    expect(getEffectiveBasePagePath()).toBe('/home')
    expect(isScheduledPanoramaExcludedPath(getEffectiveBasePagePath())).toBe(false)

    // 2. 点击发帖按钮打开居中弹窗，URL 跳到 /compose/post
    window.history.pushState({}, '', '/compose/post')
    document.body.innerHTML = `
      <div class="layout-parent">
        <div data-testid="primaryColumn"></div>
        <div data-testid="sidebarColumn">
          <div class="xf-sidebar-scheduled-panorama" data-xf-overview-sig="initial">已有看板</div>
        </div>
      </div>
      <div id="layers">
        <div role="dialog">
          <div data-testid="tweetTextarea_0">写推文中...</div>
        </div>
      </div>
    `

    // 底层有效路由依然能正确识别为 /home
    expect(getEffectiveBasePagePath()).toBe('/home')
    expect(isScheduledPanoramaExcludedPath(getEffectiveBasePagePath())).toBe(false)

    await attachSidebarScheduledPanorama()

    // 确认：背景侧边栏里的排期看板并未被误删，保持原样显示！
    expect(document.querySelector('.xf-sidebar-scheduled-panorama')).not.toBeNull()
    expect(document.querySelector('.xf-sidebar-scheduled-panorama')?.textContent).toContain('已有看板')

    // 3. 模拟在个人主页 /star_flow_ai 同样保持背景不变
    setLastNonComposePathForTest('/star_flow_ai')
    window.history.pushState({}, '', '/compose/post')
    expect(getEffectiveBasePagePath()).toBe('/star_flow_ai')
    expect(isScheduledPanoramaExcludedPath(getEffectiveBasePagePath())).toBe(false)

    await attachSidebarScheduledPanorama()
    expect(document.querySelector('.xf-sidebar-scheduled-panorama')).not.toBeNull()
  })

  it('点击具体的排期推文行时，将元信息写入 sessionStorage 并跳转至排期列表', async () => {
    sessionStorage.clear()
    const container = document.createElement('div')
    container.innerHTML = `
      <div class="xf-scheduled-item-row" data-rest-id="test-123" data-timestamp="1760688000000" data-text-snippet="测试自动直达编辑">
        <span>将于 10月17日 16:00 发布</span>
      </div>
    `
    document.body.appendChild(container)

    bindScheduleGotoButtons(container)

    const row = container.querySelector<HTMLElement>('.xf-scheduled-item-row')!
    let navigatedUrl = ''
    // 监听或拦截 window.location.href 赋值
    const originalLocation = window.location
    delete (window as any).location
    ;(window as any).location = {
      href: '',
      pathname: '/home',
      search: '',
    }

    row.click()

    const raw = sessionStorage.getItem('xf_auto_open_scheduled_target')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.restId).toBe('test-123')
    expect(parsed.timestamp).toBe(1760688000000)
    expect(parsed.textSnippet).toBe('测试自动直达编辑')
    expect(window.location.href).toBe('https://x.com/compose/post/unsent/scheduled')

    ;(window as any).location = originalLocation
  })

  it('autoOpenScheduledTweetFromSession 读取 sessionStorage 并自动模拟点击匹配的排期推文卡片', async () => {
    vi.useFakeTimers()
    sessionStorage.setItem(
      'xf_auto_open_scheduled_target',
      JSON.stringify({
        restId: 'scheduled_999',
        timestamp: new Date('2026-10-17T15:30:00+08:00').getTime(),
        textSnippet: '核心业务测试文案',
      })
    )

    let clicked = false
    const card = document.createElement('div')
    card.setAttribute('data-testid', 'unsentTweet')
    card.textContent = '将于 10月17日 15:30 发布 核心业务测试文案...'
    card.addEventListener('click', () => {
      clicked = true
    })
    document.body.appendChild(card)

    autoOpenScheduledTweetFromSession()

    // 快进定时器
    vi.advanceTimersByTime(150)

    expect(clicked).toBe(true)
    expect(sessionStorage.getItem('xf_auto_open_scheduled_target')).toBeNull()

    vi.useRealTimers()
  })

})
