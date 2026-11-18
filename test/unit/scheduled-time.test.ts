import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  parseScheduledTimeString,
  formatTimeAgo,
  formatRelativePublishTime,
  formatDurationGap,
  formatSmartScheduleTime,
  getIntervalTheme,
  getPickedTimeFromModal,
  isSchedulePickerModal,
  attachSchedulePickerOverview,
  addScheduledRelativeTimes,
  removeScheduledPanorama,
  listenForScheduledTweetsApi,
  getPersistedScheduledPosts,
  normalizeTweetSnippet,
  isTweetSnippetMatching,
  isPlaceholderText,
  resolveCurrentEditingItem,
  buildScheduleOverviewHtml,
  clearCurrentEditingScheduledTarget,
  getCurrentComposerText,
  extractTextWithoutPlaceholder,
} from '../../content-scripts/options/scheduled-time'
import { KeyScheduledPostsCache } from '../../storage-keys'
import { XF_BRIDGE_MARKER } from '../../shared/bridge'

// 记录 storage 写入的内存模拟
export function makeStorageSpy() {
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

describe('scheduled-time utility & Schedule Picker Overview', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    sessionStorage.clear()
    localStorage.clear()
    vi.useFakeTimers()
    // 固定测试时间为 2026-08-12 15:50:00 (本地时间)
    vi.setSystemTime(new Date(2026, 7, 12, 15, 50, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('formatRelativePublishTime', () => {
    it('正确计算相对发布时间格式 (例: 41分钟后, 1小时58分钟后, 1天12小时后)', () => {
      const now = new Date(2026, 7, 12, 15, 50, 0)
      expect(formatRelativePublishTime(new Date(2026, 7, 12, 16, 31, 0), now)).toBe('41分钟后')
      expect(formatRelativePublishTime(new Date(2026, 7, 12, 17, 48, 0), now)).toBe('1小时58分钟后')
      expect(formatRelativePublishTime(new Date(2026, 7, 13, 15, 50, 0), now)).toBe('1天后')
      expect(formatRelativePublishTime(new Date(2026, 7, 14, 3, 50, 0), now)).toBe('1天12小时后')
    })
  })

  describe('formatSmartScheduleTime', () => {
    it('对当天、明天、后天及跨月跨年日期进行智能精炼剥离', () => {
      const now = new Date(2026, 7, 12, 15, 50, 0) // 2026-08-12

      // 当天：无 dateTag，只有时间
      const todayResult = formatSmartScheduleTime(new Date(2026, 7, 12, 18, 30, 0), now)
      expect(todayResult).toEqual({
        dateTag: null,
        timeStr: '18:30',
        isToday: true,
      })

      // 明天
      const tomorrowResult = formatSmartScheduleTime(new Date(2026, 7, 13, 9, 15, 0), now)
      expect(tomorrowResult).toEqual({
        dateTag: '明天',
        timeStr: '09:15',
        isToday: false,
      })

      // 后天
      const afterTomorrowResult = formatSmartScheduleTime(new Date(2026, 7, 14, 10, 0, 0), now)
      expect(afterTomorrowResult).toEqual({
        dateTag: '后天',
        timeStr: '10:00',
        isToday: false,
      })

      // 同年跨多日：显示 MM-DD
      const futureResult = formatSmartScheduleTime(new Date(2026, 8, 20, 14, 20, 0), now)
      expect(futureResult).toEqual({
        dateTag: '09-20',
        timeStr: '14:20',
        isToday: false,
      })

      // 跨年：显示完整 YYYY-MM-DD
      const nextYearResult = formatSmartScheduleTime(new Date(2027, 0, 5, 8, 0, 0), now)
      expect(nextYearResult).toEqual({
        dateTag: '2027-01-05',
        timeStr: '08:00',
        isToday: false,
      })
    })
  })

  describe('getPickedTimeFromModal', () => {
    it('正确解析“安排表”弹窗中下拉菜单选中的年月日時分', () => {
      const modal = document.createElement('div')
      modal.innerHTML = `
        <select id="SELECTOR_1"><option value="8" selected>8 月</option></select>
        <select id="SELECTOR_2"><option value="12" selected>12</option></select>
        <select id="SELECTOR_3"><option value="2026" selected>2026</option></select>
        <select id="SELECTOR_4"><option value="17" selected>17</option></select>
        <select id="SELECTOR_5"><option value="04" selected>04</option></select>
      `

      const picked = getPickedTimeFromModal(modal)
      expect(picked).not.toBeNull()
      expect(parsedDateString(picked!)).toBe('2026-8-12 17:4')
    })

    it('正确解析动态 SELECTOR_11..15 编号（带 label）并立即读取最新时间，消除滞后性', () => {
      const modal = document.createElement('div')
      modal.innerHTML = `
        <label id="SELECTOR_11_LABEL">月</label>
        <select id="SELECTOR_11" aria-labelledby="SELECTOR_11_LABEL"><option value="9" selected>9 月</option></select>
        <label id="SELECTOR_12_LABEL">日</label>
        <select id="SELECTOR_12" aria-labelledby="SELECTOR_12_LABEL"><option value="14" selected>14</option></select>
        <label id="SELECTOR_13_LABEL">年</label>
        <select id="SELECTOR_13" aria-labelledby="SELECTOR_13_LABEL"><option value="2026" selected>2026</option></select>
        <label id="SELECTOR_14_LABEL">时</label>
        <select id="SELECTOR_14" aria-labelledby="SELECTOR_14_LABEL"><option value="15" selected>15</option></select>
        <label id="SELECTOR_15_LABEL">分</label>
        <select id="SELECTOR_15" aria-labelledby="SELECTOR_15_LABEL"><option value="24" selected>24</option></select>
        <input type="time" value="14:24" name="时间选择器">
      `

      // 即使隐藏的 input[type="time"] 滞后停留在旧值 14:24，也必须优先准确读取 select 的最新原生值 15:24
      const picked = getPickedTimeFromModal(modal)
      expect(picked).not.toBeNull()
      expect(parsedDateString(picked!)).toBe('2026-9-14 15:24')
    })

    function parsedDateString(date: Date): string {
      return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}`
    }
  })

  describe('getIntervalTheme 视觉配色规则', () => {
    it('正确计算首条排期的配色', () => {
      // 1 小时内即将发布
      const soonTheme = getIntervalTheme(true, 1 * 3600 * 1000)
      expect(soonTheme.category).toBe('first_soon')
      expect(soonTheme.label).toBe('即将发布')

      // 5 小时后首条排期
      const normalTheme = getIntervalTheme(true, 5 * 3600 * 1000)
      expect(normalTheme.category).toBe('first_normal')
      expect(normalTheme.label).toBe('首条排期')
    })

    it('正确计算非首条排期的过密、正常、跨夜、跨日配色 (不抛出 gapHours 未定义错误)', () => {
      // 间隔 30 分钟 (< tightThresholdMs 110分钟，默认120分钟间隔) -> 间隔过密
      const tightTheme = getIntervalTheme(false, 30 * 60 * 1000, 120)
      expect(tightTheme.category).toBe('tight')
      expect(tightTheme.label).toBe('间隔过密')

      // 间隔 3 小时 (gapHours = 3 < 8) -> 正常间隔
      const normalTheme = getIntervalTheme(false, 3 * 3600 * 1000, 120)
      expect(normalTheme.category).toBe('normal')
      expect(normalTheme.label).toBe('正常间隔')

      // 间隔 12 小时 (gapHours = 12 < 24) -> 跨夜间隔
      const moderateTheme = getIntervalTheme(false, 12 * 3600 * 1000, 120)
      expect(moderateTheme.category).toBe('moderate')
      expect(moderateTheme.label).toBe('跨夜间隔')

      // 间隔 30 小时 (gapHours = 30 >= 24) -> 跨日排期
      const longTheme = getIntervalTheme(false, 30 * 3600 * 1000, 120)
      expect(longTheme.category).toBe('long')
      expect(longTheme.label).toBe('跨日排期')
    })
  })

  describe('attachSchedulePickerOverview 可以在“中国标准时间”下方渲染排期全景面板', () => {
    it('装载 xf-schedule-picker-overview 看板', async () => {
      document.body.innerHTML = `
        <div role="dialog" aria-modal="true">
          <h2 id="modal-header">安排表</h2>
          <div dir="ltr">
            <svg viewBox="0 0 24 24"></svg>
            <span>将于 2026年8月12日周三 下午5:04 发布</span>
          </div>
          <select id="SELECTOR_1"><option value="8" selected>8 月</option></select>
          <select id="SELECTOR_2"><option value="12" selected>12</option></select>
          <select id="SELECTOR_3"><option value="2026" selected>2026</option></select>
          <select id="SELECTOR_4"><option value="17" selected>17</option></select>
          <select id="SELECTOR_5"><option value="4" selected>04</option></select>
          <div class="css-random-container-hash">
            <div>时区</div>
            <div>中国标准时间</div>
          </div>
        </div>
      `

      await attachSchedulePickerOverview()

      const overview = document.querySelector('.xf-schedule-picker-overview')
      expect(overview).not.toBeNull()
      expect(overview?.textContent).toContain('排期全景')
      expect(overview?.textContent).toContain('当前排期')

      // 验证排期全景面板完整加载，且弹窗头部保持纯粹、不强插冗余的相对时间 tag
      expect(document.querySelector('.xf-modal-header-right-badge')).toBeNull()

      // 验证 removeScheduledPanorama 能够清除看板
      removeScheduledPanorama()
      expect(document.querySelector('.xf-schedule-picker-overview')).toBeNull()
      expect(document.querySelector('.xf-modal-header-right-badge')).toBeNull()
    })

    it('严格隔离高级搜索面板：isSchedulePickerModal 拒绝高级搜索弹窗且绝不注入排期全景', async () => {
      // 模拟完整的 Twitter 高级搜索弹窗 DOM
      document.body.innerHTML = `
        <div role="dialog" aria-modal="true" data-testid="SheetDialog">
          <div id="modal-header">
            <h2>高级搜索</h2>
            <button data-testid="searchButton" type="submit">搜索</button>
          </div>
          <div>
            <label>包含所有这些词语</label>
            <input type="text" name="allWords" />
            <label>排除这些词语</label>
            <input type="text" name="noneWords" />
            <label>这些话题标签</label>
            <input type="text" name="hashtags" />
            <label>语言</label>
            <select id="LANGUAGE_SELECT"><option value="zh">中文</option><option value="en">英语</option></select>
            <div>
              <span>从</span>
              <select id="FROM_MONTH"><option value="1">1月</option></select>
              <select id="FROM_DAY"><option value="1">1</option></select>
              <select id="FROM_YEAR"><option value="2026">2026</option></select>
            </div>
            <div>
              <span>到</span>
              <select id="TO_MONTH"><option value="12">12月</option></select>
              <select id="TO_DAY"><option value="31">31</option></select>
              <select id="TO_YEAR"><option value="2026">2026</option></select>
            </div>
          </div>
        </div>
      `
      const advancedSearchModal = document.querySelector('[role="dialog"]')!
      expect(isSchedulePickerModal(advancedSearchModal)).toBe(false)

      await attachSchedulePickerOverview()

      // 绝不注入排期全景
      expect(document.querySelector('.xf-schedule-picker-overview')).toBeNull()
      expect(advancedSearchModal.querySelector('.xf-schedule-picker-overview')).toBeNull()
    })

    it('若高级搜索弹窗中存在误插的遗留看板，attachSchedulePickerOverview 能够主动将其清理剔除', async () => {
      document.body.innerHTML = `
        <div role="dialog" aria-modal="true">
          <h2>高级搜索</h2>
          <input type="text" />
          <button data-testid="searchButton">搜索</button>
          <div class="xf-schedule-picker-overview">意外残留的排期看板</div>
        </div>
      `
      const modal = document.querySelector('[role="dialog"]')!
      expect(modal.querySelector('.xf-schedule-picker-overview')).not.toBeNull()

      await attachSchedulePickerOverview()

      expect(document.querySelector('.xf-schedule-picker-overview')).toBeNull()
    })

    it('当用户在弹窗中修改时间下拉框时，排期全景面板立即响应更新，无滞后（不受任意动态哈希类名影响）', async () => {
      document.body.innerHTML = `
        <div role="dialog" aria-modal="true">
          <h2 id="modal-header">安排表</h2>
          <div class="arbitrary-dynamic-hash-1">
            <div dir="ltr">
              <span>将于 2026年9月14日周一 下午2:24 发布</span>
            </div>
          </div>
          <label id="SELECTOR_11_LABEL">月</label>
          <select id="SELECTOR_11" aria-labelledby="SELECTOR_11_LABEL"><option value="9" selected>9 月</option></select>
          <label id="SELECTOR_12_LABEL">日</label>
          <select id="SELECTOR_12" aria-labelledby="SELECTOR_12_LABEL"><option value="14" selected>14</option></select>
          <label id="SELECTOR_13_LABEL">年</label>
          <select id="SELECTOR_13" aria-labelledby="SELECTOR_13_LABEL"><option value="2026" selected>2026</option></select>
          <label id="SELECTOR_14_LABEL">时</label>
          <select id="SELECTOR_14" aria-labelledby="SELECTOR_14_LABEL"><option value="14" selected>14</option><option value="15">15</option></select>
          <label id="SELECTOR_15_LABEL">分</label>
          <select id="SELECTOR_15" aria-labelledby="SELECTOR_15_LABEL"><option value="24" selected>24</option></select>
          <input type="time" value="14:24" name="时间选择器">
          <div class="arbitrary-dynamic-hash-2">
            <div>时区</div>
            <div>中国标准时间</div>
          </div>
        </div>
      `

      await attachSchedulePickerOverview()

      const overview = document.querySelector('.xf-schedule-picker-overview')!
      expect(overview.textContent).toContain('2026-09-14 14:24')

      // 用户修改时钟 select 为 15
      const hourSelect = document.querySelector<HTMLSelectElement>('#SELECTOR_14')!
      hourSelect.value = '15'
      hourSelect.dispatchEvent(new Event('change', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(0)

      // 验证排期全景面板立即更新为 15:24，无需等待第二次选择
      expect(overview.textContent).toContain('2026-09-14 15:24')
      expect(overview.textContent).not.toContain('2026-09-14 14:24')

      // 验证弹窗内排期全景包含智能排期控制栏（滑块与智能排期按钮）
      expect(overview.querySelector('.xf-smart-scheduler-bar')).not.toBeNull()
      expect(overview.querySelector('.xf-smart-interval-slider')).not.toBeNull()
      expect(overview.querySelector('.xf-smart-schedule-apply-btn')).not.toBeNull()
    })

    it('连续多次点击智能排期或修改时间时，排期全景正常更新且弹窗内不注入冗余的时间 tag', async () => {
      document.body.innerHTML = `
        <div role="dialog" aria-modal="true">
          <h2 id="modal-header">安排表</h2>
          <div class="header-box">
            <span>将于 2026年9月14日周一 下午2:24 发布</span>
          </div>
          <select id="SELECTOR_11"><option value="9" selected>9 月</option></select>
          <select id="SELECTOR_12"><option value="14" selected>14</option></select>
          <select id="SELECTOR_13"><option value="2026" selected>2026</option></select>
          <select id="SELECTOR_14"><option value="14" selected>14</option><option value="15">15</option></select>
          <select id="SELECTOR_15"><option value="24" selected>24</option></select>
        </div>
      `
      await attachSchedulePickerOverview()

      const hourSelect = document.querySelector<HTMLSelectElement>('#SELECTOR_14')!
      for (let i = 0; i < 4; i++) {
        hourSelect.value = i % 2 === 0 ? '15' : '14'
        hourSelect.dispatchEvent(new Event('change', { bubbles: true }))
        await vi.advanceTimersByTimeAsync(100)
      }

      // 弹窗头部不被强插 tag，完全由右侧排期全景面板承载完整信息
      const badges = document.querySelectorAll('.xf-modal-header-right-badge')
      expect(badges.length).toBe(0)

      // 验证原生 span 文本完好无损，未被破坏性嵌套移位
      const headerSpan = document.querySelector('.header-box > span')
      expect(headerSpan?.textContent).toContain('将于 2026年9月14日')
    })

    it('自动解构并彻底清理历史遗留的 xf-modal-header-left 嵌套与旧版本残留 badge', async () => {
      // 模拟之前旧版本因 bug 产生的深层套娃结构与 4 个重复 badge
      document.body.innerHTML = `
        <div role="dialog" aria-modal="true">
          <h2 id="modal-header">安排表</h2>
          <div class="header-box">
            <span class="xf-modal-header-left">
              <span class="xf-modal-header-left">
                <span>将于 2026年9月14日周一 下午2:24 发布</span>
              </span>
              <span class="xf-modal-header-right-badge">旧tag1</span>
            </span>
            <span class="xf-modal-header-right-badge">旧tag2</span>
            <span class="xf-modal-header-right-badge">旧tag3</span>
          </div>
          <select id="SELECTOR_11"><option value="9" selected>9 月</option></select>
          <select id="SELECTOR_12"><option value="14" selected>14</option></select>
          <select id="SELECTOR_13"><option value="2026" selected>2026</option></select>
          <select id="SELECTOR_14"><option value="14" selected>14</option></select>
          <select id="SELECTOR_15"><option value="24" selected>24</option></select>
        </div>
      `
      expect(document.querySelectorAll('.xf-modal-header-right-badge').length).toBe(3)
      expect(document.querySelectorAll('.xf-modal-header-left').length).toBe(2)

      await attachSchedulePickerOverview()

      // 验证遗留套娃已被全部解构且旧 badge 被彻底清理，恢复纯净的原生 DOM
      expect(document.querySelectorAll('.xf-modal-header-left').length).toBe(0)
      expect(document.querySelectorAll('.xf-modal-header-right-badge').length).toBe(0)
      expect(document.querySelector('.header-box > span')?.textContent).toContain('将于 2026年9月14日')
    })

    it('当排期弹窗嵌套在包含推文编辑器的发帖弹窗内时，精准绑定内层排期弹窗', async () => {
      document.body.innerHTML = `
        <!-- 外层发帖弹窗 -->
        <div role="dialog" aria-modal="true" class="outer-composer">
          <div contenteditable="true" data-testid="tweetTextarea_0">这是一条正在编辑的排期推文</div>
          <!-- 内层原生排期设置弹窗 -->
          <div role="dialog" aria-modal="true" class="inner-scheduler">
            <h2 id="modal-header">安排表</h2>
            <div dir="ltr">
              <span>将于 2026年9月14日周一 下午2:24 发布</span>
            </div>
            <select id="SELECTOR_11"><option value="9" selected>9 月</option></select>
            <select id="SELECTOR_12"><option value="14" selected>14</option></select>
            <select id="SELECTOR_13"><option value="2026" selected>2026</option></select>
            <select id="SELECTOR_14"><option value="14" selected>14</option></select>
            <select id="SELECTOR_15"><option value="24" selected>24</option></select>
          </div>
        </div>
      `

      await attachSchedulePickerOverview()

      // 验证外层发帖编辑弹窗未被误插任何看板
      expect(document.querySelector('.outer-composer > .xf-schedule-picker-overview')).toBeNull()
      expect(document.querySelector('.xf-schedule-modal-floating-panel')).not.toBeNull()
    })

    it('当存在多条历史排期（跨日、正常、过密）时，排期全景面板完整渲染且不发生空白或 gapHours 报错', async () => {
      const now = new Date(2026, 7, 12, 15, 50, 0)
      const fakePosts = [
        { restId: '1', timestamp: now.getTime() + 1 * 3600 * 1000, formattedTime: '2026-08-12 16:50', text: '第一条排期推文' },
        { restId: '2', timestamp: now.getTime() + 3 * 3600 * 1000, formattedTime: '2026-08-12 18:50', text: '第二条正常间隔' },
        { restId: '3', timestamp: now.getTime() + 18 * 3600 * 1000, formattedTime: '2026-08-13 09:50', text: '第三条跨夜间隔' },
        { restId: '4', timestamp: now.getTime() + 48 * 3600 * 1000, formattedTime: '2026-08-14 15:50', text: '第四条跨日排期' },
      ]
      const storage = makeStorageSpy()
      storage.store[KeyScheduledPostsCache] = JSON.stringify(fakePosts)
      ;(globalThis as any).browser = {
        runtime: { id: 'test-id' },
        storage: { local: storage, sync: storage },
      }
      localStorage.setItem(KeyScheduledPostsCache, JSON.stringify(fakePosts))

      document.body.innerHTML = `
        <div role="dialog" aria-modal="true">
          <h2 id="modal-header">安排表</h2>
          <div dir="ltr">
            <span>将于 2026年8月12日周三 下午5:04 发布</span>
          </div>
          <select id="SELECTOR_1"><option value="8" selected>8 月</option></select>
          <select id="SELECTOR_2"><option value="12" selected>12</option></select>
          <select id="SELECTOR_3"><option value="2026" selected>2026</option></select>
          <select id="SELECTOR_4"><option value="17" selected>17</option></select>
          <select id="SELECTOR_5"><option value="4" selected>04</option></select>
          <div>
            <div>时区</div>
            <div>中国标准时间</div>
          </div>
        </div>
      `

      await attachSchedulePickerOverview()

      const overview = document.querySelector('.xf-schedule-picker-overview')
      expect(overview).not.toBeNull()
      expect(overview?.innerHTML).not.toBe('')
      expect(overview?.textContent).toContain('第一条排期推文')
      expect(overview?.textContent).toContain('第二条正常间隔')
      expect(overview?.textContent).toContain('第三条跨夜间隔')
      expect(overview?.textContent).toContain('第四条跨日排期')
      expect(overview?.textContent).toContain('当前排期')
      
      const rows = document.querySelectorAll('.xf-scheduled-item-row')
      expect(rows.length).toBe(4)
    })

    it('修改已有排期推文时，推文时间随下拉框选择实时更新，文案保留且旧时间点不再显示重复条目', async () => {
      const now = new Date(2026, 7, 12, 14, 0, 0)
      const fakePosts = [
        { restId: 'post-1', timestamp: now.getTime() + 1 * 3600 * 1000, formattedTime: '2026-08-12 15:00', text: '这是正在被修改的优质长文' },
        { restId: 'post-2', timestamp: now.getTime() + 4 * 3600 * 1000, formattedTime: '2026-08-12 18:00', text: '第二条保留推文' },
      ]
      const storage = makeStorageSpy()
      storage.store[KeyScheduledPostsCache] = JSON.stringify(fakePosts)
      ;(globalThis as any).browser = {
        runtime: { id: 'test-id' },
        storage: { local: storage, sync: storage },
      }
      localStorage.setItem(KeyScheduledPostsCache, JSON.stringify(fakePosts))

      // 模拟点击全景直达时记录的 sessionStorage 编辑目标
      sessionStorage.setItem(
        'xf_current_editing_target',
        JSON.stringify({
          restId: 'post-1',
          timestamp: fakePosts[0].timestamp,
          textSnippet: '这是正在被修改的优质长文',
        })
      )

      document.body.innerHTML = `
        <div role="dialog" aria-modal="true">
          <h2 id="modal-header">安排表</h2>
          <div dir="ltr">
            <span>将于 2026年8月12日周三 下午3:00 发布</span>
          </div>
          <select id="SELECTOR_1"><option value="8" selected>8 月</option></select>
          <select id="SELECTOR_2"><option value="12" selected>12</option></select>
          <select id="SELECTOR_3"><option value="2026" selected>2026</option></select>
          <select id="SELECTOR_4"><option value="15" selected>15</option><option value="16">16</option></select>
          <select id="SELECTOR_5"><option value="0" selected>00</option></select>
          <div>
            <div>时区</div>
            <div>中国标准时间</div>
          </div>
        </div>
      `

      await attachSchedulePickerOverview()

      const overview = document.querySelector('.xf-schedule-picker-overview')!
      expect(overview).not.toBeNull()

      // 验证当前排期条目携带自身的真实正文与加粗边框样式类
      const currentItem = overview.querySelector('.xf-scheduled-item-current')
      expect(currentItem).not.toBeNull()
      expect(currentItem?.textContent).toContain('这是正在被修改的优质长文')
      expect(currentItem?.textContent).toContain('15:00')

      // 用户在下拉框调整时间为 16:00
      const hourSelect = document.querySelector<HTMLSelectElement>('#SELECTOR_4')!
      hourSelect.value = '16'
      hourSelect.dispatchEvent(new Event('change', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(0)

      // 验证时间变为 16:00，但文案依然完好保留，且旧时间 15:00 消失
      expect(overview.textContent).toContain('16:00')
      expect(overview.textContent).toContain('这是正在被修改的优质长文')
      expect(overview.textContent).not.toContain('15:00')

      // 验证不会出现旧条目残留重复（总共依然只有 1 条历史行 + 1 条当前排期行）
      const rows = overview.querySelectorAll('.xf-scheduled-item-row')
      expect(rows.length).toBe(1)
      expect(rows[0].textContent).toContain('第二条保留推文')

      clearCurrentEditingScheduledTarget()
    })

    it('normalizeTweetSnippet 与 isTweetSnippetMatching 能够准确去除零宽字符并稳定比对正文前缀', () => {
      // 包含零宽空格 \u200B 与多余空白
      const rawA = '今天\u200B开源了一个\uFEFF超实用的工具\n大家快来看看！'
      const rawB = '今天开源了一个超实用的工具，支持全景排期'

      expect(normalizeTweetSnippet(rawA)).toBe('今天开源了一个超实用的工具大家快来看看！')
      expect(isTweetSnippetMatching(rawA, rawB)).toBe(true)

      const unrelated = '完全不相关的推文正文内容'
      expect(isTweetSnippetMatching(rawA, unrelated)).toBe(false)
    })

    it('resolveCurrentEditingItem 能够通过发帖框文本精准匹配对应的排期推文', () => {
      const items = [
        { restId: 'a1', timestamp: Date.now() + 100000, formattedTime: '2026-08-12 15:00', text: '深入探讨前端架构设计模式' },
        { restId: 'a2', timestamp: Date.now() + 200000, formattedTime: '2026-08-12 18:00', text: '这是一篇关于AI编码助手的实测' },
      ]

      document.body.innerHTML = `
        <div role="dialog">
          <div data-testid="tweetTextarea_0" contenteditable="true">
            深入探讨前端架构设计模式与工程实践...
          </div>
        </div>
      `

      const resolved = resolveCurrentEditingItem(items)
      expect(resolved).not.toBeNull()
      expect(resolved?.restId).toBe('a1')
      expect(resolved?.text).toBe('深入探讨前端架构设计模式')
    })

    it('isPlaceholderText 能够准确识别常见发帖占位符', () => {
      expect(isPlaceholderText('有什么新鲜事？')).toBe(true)
      expect(isPlaceholderText('有什么新鲜事?')).toBe(true)
      expect(isPlaceholderText('有什么新鲜事')).toBe(true)
      expect(isPlaceholderText("What's happening?")).toBe(true)
      expect(isPlaceholderText('What is happening?!')).toBe(true)
      expect(isPlaceholderText('ChatGPT 更新了 5小时、周额度进度条')).toBe(false)
    })

    it('修改排期日期（某一天）时，即使发帖框包含“有什么新鲜事？”占位符，排期全景依然稳定保持推文本人真实文案', async () => {
      const now = new Date(2026, 7, 12, 10, 0, 0)
      const targetText = 'ChatGPT 更新了 5小时、周额度进度条，这个大家能打几分？'
      const fakePosts = [
        { restId: 'chatgpt-post', timestamp: new Date(2026, 7, 13, 14, 0, 0).getTime(), formattedTime: '2026-08-13 14:00', text: targetText },
        { restId: 'other-post', timestamp: new Date(2026, 7, 15, 10, 0, 0).getTime(), formattedTime: '2026-08-15 10:00', text: '其他推文' },
      ]
      const storage = makeStorageSpy()
      storage.store[KeyScheduledPostsCache] = JSON.stringify(fakePosts)
      ;(globalThis as any).browser = {
        runtime: { id: 'test-id' },
        storage: { local: storage, sync: storage },
      }
      localStorage.setItem(KeyScheduledPostsCache, JSON.stringify(fakePosts))

      // 模拟页面上包含 X 原生输入框，且当前内容为 placeholder “有什么新鲜事？”
      const composer = document.createElement('div')
      composer.setAttribute('data-testid', 'tweetTextarea_0')
      composer.innerHTML = '<div class="public-DraftEditorPlaceholder-root">有什么新鲜事？</div>'
      document.body.appendChild(composer)

      // 模拟弹窗刚打开，初始时间为 8月13日 14:00（匹配 fakePosts[0]）
      const modal = document.createElement('div')
      modal.setAttribute('role', 'dialog')
      modal.setAttribute('aria-modal', 'true')
      modal.innerHTML = `
        <h2 id="modal-header">安排表</h2>
        <div dir="ltr">
          <span>将于 2026年8月13日周四 下午2:00 发布</span>
        </div>
        <select id="SELECTOR_1"><option value="8" selected>8 月</option></select>
        <select id="SELECTOR_2"><option value="13" selected>13</option><option value="14">14</option></select>
        <select id="SELECTOR_3"><option value="2026" selected>2026</option></select>
        <select id="SELECTOR_4"><option value="14" selected>14</option></select>
        <select id="SELECTOR_5"><option value="0" selected>00</option></select>
        <div>
          <div>时区</div>
          <div>中国标准时间</div>
        </div>
      `
      document.body.appendChild(modal)

      await attachSchedulePickerOverview()

      const overview = document.querySelector('.xf-schedule-picker-overview')!
      expect(overview).not.toBeNull()

      // 验证未被占位符篡改，文案正确显示目标推文正文
      expect(overview.textContent).toContain(targetText)
      expect(overview.textContent).not.toContain('有什么新鲜事？')

      // 用户修改日期：将“日”从 13 改为 14
      const daySelect = modal.querySelector<HTMLSelectElement>('#SELECTOR_2')!
      daySelect.value = '14'
      daySelect.dispatchEvent(new Event('change', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(0)

      // 验证修改某一天后：
      // 1. 文案依然是 targetText，绝对不会变成“有什么新鲜事？”
      expect(overview.textContent).toContain(targetText)
      expect(overview.textContent).not.toContain('有什么新鲜事？')
      // 2. 日期移动到了 2026-08-14
      expect(overview.textContent).toContain('2026-08-14 14:00')
      // 3. 不会在 13 日保留重复条目
      expect(overview.textContent).not.toContain('2026-08-13 14:00')

      composer.remove()
      modal.remove()
    })

    it('排期全景面板以独立悬浮大面板形式挂载于弹窗外部（遮罩层之上），并包含 sticky 头部与独立滚动区', async () => {
      document.body.innerHTML = `
        <div role="dialog" aria-modal="true">
          <h2 id="modal-header">安排表</h2>
          <div dir="ltr">
            <span>将于 2026年9月14日周一 下午2:24 发布</span>
          </div>
          <select id="SELECTOR_11"><option value="9" selected>9 月</option></select>
          <select id="SELECTOR_12"><option value="14" selected>14</option></select>
          <select id="SELECTOR_13"><option value="2026" selected>2026</option></select>
          <select id="SELECTOR_14"><option value="14" selected>14</option></select>
          <select id="SELECTOR_15"><option value="24" selected>24</option></select>
          <div>时区</div>
        </div>
      `
      const modal = document.querySelector<HTMLElement>('[role="dialog"]')!

      await attachSchedulePickerOverview()

      // 验证原生弹窗内部不再包含长排期全景列表
      expect(modal.querySelector('.xf-schedule-picker-overview')).toBeNull()

      // 验证独立悬浮面板成功挂载在 document.body 顶层
      const floatingPanel = document.querySelector<HTMLElement>('.xf-schedule-modal-floating-panel')
      expect(floatingPanel).not.toBeNull()
      expect(floatingPanel!.parentElement).toBe(document.body)

      // 验证包含 sticky 头部与滚动主体结构
      const stickyHeader = floatingPanel!.querySelector('.xf-floating-sticky-header')
      const scrollBody = floatingPanel!.querySelector('.xf-floating-scroll-body')
      expect(stickyHeader).not.toBeNull()
      expect(scrollBody).not.toBeNull()

      // 验证大屏下悬浮面板宽度为 600px
      expect(floatingPanel!.style.width).toMatch(/^(600px|\d+px)$/)

      // 弹窗关闭移除时，悬浮面板同步自动清理销毁
      modal.remove()
      await attachSchedulePickerOverview()
      expect(document.querySelector('.xf-schedule-modal-floating-panel')).toBeNull()
    })

    it('getCurrentComposerText 能够穿透多个候选元素，准确提取弹窗内编辑框的真实文案', () => {
      document.body.innerHTML = `
        <!-- 页面顶部空白输入框 -->
        <div data-testid="tweetTextarea_0_label">
          <div data-testid="emptyComposerPlaceholder">有什么新鲜事？</div>
          <div data-testid="tweetTextarea_0" role="textbox" contenteditable="true"></div>
        </div>
        <!-- 发帖弹窗内的真实编辑框 -->
        <div role="dialog" aria-modal="true">
          <div data-testid="tweetTextarea_0_label">
            <div data-testid="tweetTextarea_0" role="textbox" contenteditable="true">
              <span data-text="true">腾讯的 Hy4 也快来了！</span>
            </div>
          </div>
        </div>
      `
      const txt = getCurrentComposerText()
      expect(txt).toBe('腾讯的 Hy4 也快来了！')
    })

    it('新建排期时若无正文，buildScheduleOverviewHtml 仅展示当前排期徽章，绝不展示“(无正文或媒体推文)”', () => {
      const futureDate = new Date(2026, 7, 12, 15, 0)
      const html = buildScheduleOverviewHtml([], {
        pickedDate: futureDate,
        currentComposerText: '',
        editingItem: null,
      })
      expect(html).toContain('当前排期')
      expect(html).not.toContain('(无正文或媒体推文)')
    })

    it('新建排期且发帖框有正文时，buildScheduleOverviewHtml 正确展示用户填写的真实正文', () => {
      const futureDate = new Date(2026, 7, 12, 15, 0)
      const html = buildScheduleOverviewHtml([], {
        pickedDate: futureDate,
        currentComposerText: '腾讯的 Hy4 也快来了！',
        editingItem: null,
      })
      expect(html).toContain('当前排期')
      expect(html).toContain('腾讯的 Hy4 也快来了！')
      expect(html).not.toContain('(无正文或媒体推文)')
    })
  })

  describe('addScheduledRelativeTimes (原生预排期管理页面增强)', () => {
    it('为排期卡片注入相对时间和背景色，且每个卡片仅保留顶部边框、不写入底部边框（避免相邻卡片双层线）', async () => {
      document.body.innerHTML = `
        <div data-testid="unsentTweet">
          <div class="card-inner">
            <div class="top-row">
              <div class="left-box">
                <div dir="ltr">
                  <span>将于 2026年8月12日周三 下午4:31 发布</span>
                </div>
              </div>
            </div>
            <div>第 1 条推文正文</div>
          </div>
        </div>
        <div data-testid="unsentTweet">
          <div class="card-inner">
            <div class="top-row">
              <div class="left-box">
                <div dir="ltr">
                  <span>将于 2026年8月12日周三 下午5:48 发布</span>
                </div>
              </div>
            </div>
            <div>第 2 条推文正文</div>
          </div>
        </div>
      `

      ;(globalThis as any).browser = { storage: { local: makeStorageSpy() } }

      await addScheduledRelativeTimes(true)

      const cards = document.querySelectorAll<HTMLElement>('[data-testid="unsentTweet"]')
      expect(cards).toHaveLength(2)

      // 验证每个排期只保留顶部边框，不写入底部边框，消除卡片相邻处的双层边框
      expect(cards[0].style.borderTop).toContain('1px solid')
      expect(cards[0].style.borderBottom).toBe('')
      expect(cards[1].style.borderTop).toContain('1px solid')
      expect(cards[1].style.borderBottom).toBe('')

      // 验证背景色与徽章注入成功
      expect(cards[0].style.backgroundColor).toBeTruthy()
      expect(cards[1].style.backgroundColor).toBeTruthy()
      expect(cards[0].querySelector('.xf-scheduled-relative-text')?.textContent).toBe('41分钟后')
      expect(cards[1].querySelector('.xf-scheduled-relative-text')?.textContent).toBe('1小时58分钟后')

      const gapBadge = cards[1].querySelector<HTMLElement>('.xf-scheduled-gap-badge')!
      expect(gapBadge).not.toBeNull()
      expect(gapBadge.textContent).toContain('间隔 1小时17分')
      expect(gapBadge.style.position).toBe('absolute')
      expect(gapBadge.style.top).toBe('0px')
      expect(gapBadge.style.left).toBe('50%')

      // 测试清理
      removeScheduledPanorama()
      expect(cards[0].style.backgroundColor).toBe('')
      expect(cards[0].style.borderTop).toBe('')
      expect(cards[0].style.borderBottom).toBe('')
      expect(document.querySelector('.xf-scheduled-right-box')).toBeNull()
    })
  })

  describe('listenForScheduledTweetsApi (FetchScheduledTweets 拦截持久化)', () => {
    beforeEach(() => {
      const storage = makeStorageSpy()
      ;(globalThis as any).browser = { storage: { local: storage } }
      listenForScheduledTweetsApi()
    })

    function dispatchScheduledPayload(payload: unknown) {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: { type: 'XF_SCHEDULED_TWEETS', payload, __xf: XF_BRIDGE_MARKER },
        }),
      )
    }

    it('将 API 完整数据持久化（按时间升序 + 格式化时间）', async () => {
      dispatchScheduledPayload([
        {
          restId: 'b',
          timestamp: 1786549440000,
          text: 'Antigravity 升到 2.7.1',
        },
        {
          restId: 'a',
          timestamp: 1786533060000,
          text: '这几个网站让我找回了小时候的感觉',
        },
      ])

      await vi.advanceTimersByTimeAsync(0)

      const lastWrite = (globalThis as any).browser.storage.local.writes.at(-1)
      const raw = lastWrite?.[KeyScheduledPostsCache]
      expect(typeof raw).toBe('string')

      const items = JSON.parse(raw)
      expect(items).toHaveLength(2)
      // 按 timestamp 升序
      expect(items[0].restId).toBe('a')
      expect(items[1].restId).toBe('b')
      // 完整正文不再截断
      expect(items[0].text).toContain('小时候的感觉')
      // 格式化时间为 YYYY-MM-DD HH:mm
      expect(items[0].formattedTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    })

    it('接口返回空列表时清空缓存（允许空数组持久化）', async () => {
      dispatchScheduledPayload([])
      await vi.advanceTimersByTimeAsync(0)

      const lastWrite = (globalThis as any).browser.storage.local.writes.at(-1)
      expect(lastWrite?.[KeyScheduledPostsCache]).toBe('[]')
    })

    it('非数组 payload 被忽略，不写入 storage', async () => {
      dispatchScheduledPayload({ data: { viewer: {} } })
      await vi.advanceTimersByTimeAsync(0)

      expect((globalThis as any).browser.storage.local.writes).toHaveLength(0)
    })

    it('未携带桥接标记的广播被忽略（防止其他脚本伪造）', async () => {
      // 与拦截器同 type，但缺少 __xf 标记 → 监听端必须拒绝
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: {
            type: 'XF_SCHEDULED_TWEETS',
            payload: [{ restId: 'x', timestamp: Date.now() + 10000, text: '伪造' }],
          },
        }),
      )
      await vi.advanceTimersByTimeAsync(0)

      expect((globalThis as any).browser.storage.local.writes).toHaveLength(0)
    })
  })

  describe('排期全景面板不执行自动聚焦滚动（保持用户当前滚动视野不动）', () => {
    it('当切换排期插槽或重新渲染时，容器保持原本的 scrollTop，绝不触发自动聚焦滚动', () => {
      const container = document.createElement('div')
      container.className = 'xf-schedule-modal-floating-panel'
      container.innerHTML = `
        <div class="xf-floating-scroll-body" style="height: 400px; overflow-y: auto;">
          <div class="xf-scheduled-item-current" data-timestamp="1786500000000">当前排期</div>
        </div>
      `
      const scrollBody = container.querySelector<HTMLElement>('.xf-floating-scroll-body')!
      scrollBody.scrollTop = 240

      const scrollToSpy = vi.fn()
      const scrollIntoViewSpy = vi.fn()
      scrollBody.scrollTo = scrollToSpy
      ;(container.querySelector('.xf-scheduled-item-current') as any).scrollIntoView = scrollIntoViewSpy

      // 验证没有调用任何滚动方法，scrollTop 原位保留
      expect(scrollToSpy).not.toHaveBeenCalled()
      expect(scrollIntoViewSpy).not.toHaveBeenCalled()
      expect(scrollBody.scrollTop).toBe(240)
    })
  })

  describe('getPersistedScheduledPosts sessionStorage 回退', () => {
    it('storage 为空时回退读取拦截器写入的条目快照', async () => {
      ;(globalThis as any).browser = { storage: { local: makeStorageSpy() } }
      sessionStorage.setItem(
        'xf_scheduled_items_last',
        JSON.stringify([
          { restId: 'x', timestamp: 1786533060000, text: '快照正文' },
          { restId: 'y', timestamp: 1786549440000, text: '第二条' },
        ]),
      )

      const items = await getPersistedScheduledPosts()
      expect(items).toHaveLength(2)
      expect(items[0].restId).toBe('x')
      expect(items[0].text).toBe('快照正文')
      expect(items[0].formattedTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
      // 按时间升序
      expect(items[0].timestamp).toBeLessThan(items[1].timestamp)

      sessionStorage.removeItem('xf_scheduled_items_last')
    })
  })

  describe('跨 Tab 排期闭环与即时发帖监听', () => {
    it('接收到 TWEET_CREATED_TYPE 即时发帖广播后，持久化更新 KeyLastTweetSentAt', async () => {
      const storage = makeStorageSpy()
      ;(globalThis as any).browser = { storage: { local: storage } }
      const { listenForScheduledTweetsApi, getLastTweetSentAtSync } = await import(
        '../../content-scripts/options/scheduled-time'
      )
      const { TWEET_CREATED_TYPE, XF_BRIDGE_MARKER } = await import('../../shared/bridge')
      const { KeyLastTweetSentAt } = await import('../../storage-keys')

      listenForScheduledTweetsApi()

      const nowTs = Date.now()
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: {
            type: TWEET_CREATED_TYPE,
            payload: { sentAt: nowTs, isReply: false },
            __xf: XF_BRIDGE_MARKER,
          },
        }),
      )
      await vi.advanceTimersByTimeAsync(0)

      expect(getLastTweetSentAtSync()).toBe(nowTs)
      const lastWrite = storage.writes.at(-1)
      expect(lastWrite?.[KeyLastTweetSentAt]).toBe(nowTs)
    })

    it('silentSyncScheduledPostsWithCooldown 在冷却时间内不重复发送同步请求', async () => {
      const { silentSyncScheduledPostsWithCooldown, resetActiveSyncCooldownForTest } = await import(
        '../../content-scripts/options/scheduled-time'
      )
      resetActiveSyncCooldownForTest()
      const postMessageSpy = vi.spyOn(window, 'postMessage')

      // 首次触发
      silentSyncScheduledPostsWithCooldown(5000)
      expect(postMessageSpy).toHaveBeenCalledTimes(1)

      // 1 秒后再次触发（在 5 秒冷却内），被抑制
      await vi.advanceTimersByTimeAsync(1000)
      silentSyncScheduledPostsWithCooldown(5000)
      expect(postMessageSpy).toHaveBeenCalledTimes(1)

      // 5 秒冷却过后再次触发，正常发送
      await vi.advanceTimersByTimeAsync(4100)
      silentSyncScheduledPostsWithCooldown(5000)
      expect(postMessageSpy).toHaveBeenCalledTimes(2)

      postMessageSpy.mockRestore()
    })
  })
})
