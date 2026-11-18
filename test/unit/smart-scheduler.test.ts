import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  formatSmartIntervalLabel,
  isQuietHour,
  computeSmartScheduleTime,
  computeSmartScheduleSlots,
  computeDayScheduleSlots,
  getSelectedDateFromModal,
  getStoredSmartInterval,
  saveStoredSmartInterval,
  extractSelectsFromModal,
  setSelectValueSafely,
  applySmartScheduleTimeToModal,
  buildSmartSchedulerBarHtml,
  bindSmartSchedulerControls,
  KeySmartScheduleInterval,
  DEFAULT_SMART_SCHEDULE_INTERVAL,
} from '../../content-scripts/options/smart-scheduler'

describe('smart-scheduler', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  describe('formatSmartIntervalLabel', () => {
    it('正确格式化各种分钟间隔为人类可读标签', () => {
      expect(formatSmartIntervalLabel(30)).toBe('0.5h')
      expect(formatSmartIntervalLabel(45)).toBe('45m')
      expect(formatSmartIntervalLabel(60)).toBe('1.0h')
      expect(formatSmartIntervalLabel(75)).toBe('1h 15m')
      expect(formatSmartIntervalLabel(90)).toBe('1.5h')
      expect(formatSmartIntervalLabel(105)).toBe('1h 45m')
      expect(formatSmartIntervalLabel(120)).toBe('2.0h')
      expect(formatSmartIntervalLabel(150)).toBe('2.5h')
      expect(formatSmartIntervalLabel(180)).toBe('3.0h')
      expect(formatSmartIntervalLabel(210)).toBe('3.5h')
      expect(formatSmartIntervalLabel(240)).toBe('4.0h')
    })
  })

  describe('isQuietHour (深夜静默区检测：00:30 至 07:30)', () => {
    it('在静默区边界外的时间返回 false', () => {
      expect(isQuietHour(new Date(2026, 9, 24, 0, 29, 0))).toBe(false)
      expect(isQuietHour(new Date(2026, 9, 24, 7, 30, 0))).toBe(false)
      expect(isQuietHour(new Date(2026, 9, 24, 12, 0, 0))).toBe(false)
      expect(isQuietHour(new Date(2026, 9, 24, 23, 59, 0))).toBe(false)
    })

    it('在静默区内部的时间返回 true', () => {
      expect(isQuietHour(new Date(2026, 9, 24, 0, 30, 0))).toBe(true)
      expect(isQuietHour(new Date(2026, 9, 24, 1, 0, 0))).toBe(true)
      expect(isQuietHour(new Date(2026, 9, 24, 4, 15, 0))).toBe(true)
      expect(isQuietHour(new Date(2026, 9, 24, 7, 29, 0))).toBe(true)
    })
  })

  describe('computeSmartScheduleTime (贪心插空算法)', () => {
    it('无未来排期时以当前时间为基准，加上间隔与随机防人机微扰', () => {
      const now = new Date(2026, 9, 24, 10, 0, 0)
      const res = computeSmartScheduleTime([], 120, now, 6)
      // 10:00 + 126m = 12:06
      expect(res.getFullYear()).toBe(2026)
      expect(res.getMonth()).toBe(9)
      expect(res.getDate()).toBe(24)
      expect(res.getHours()).toBe(12)
      expect(res.getMinutes()).toBe(6)
    })

    it('当有多天排期时，优先在今天（第一天）的空隙中插入，而不是排到最后一天', () => {
      // 模拟用户真实场景：
      // 今天 10-24：10:49, 11:59, 14:04, 15:58, 17:02, 21:58 (17:02 与 21:58 之间有 4h56m 大空档)
      // 明天 10-25：10:47, 13:17, 15:33, 23:11
      // 后天 10-26：10:36, 12:44
      const now = new Date(2026, 9, 24, 17, 10, 0)
      const cached = [
        { timestamp: new Date(2026, 9, 24, 10, 49).getTime() },
        { timestamp: new Date(2026, 9, 24, 11, 59).getTime() },
        { timestamp: new Date(2026, 9, 24, 14, 4).getTime() },
        { timestamp: new Date(2026, 9, 24, 15, 58).getTime() },
        { timestamp: new Date(2026, 9, 24, 17, 2).getTime() },
        { timestamp: new Date(2026, 9, 24, 21, 58).getTime() },
        { timestamp: new Date(2026, 9, 25, 10, 47).getTime() },
        { timestamp: new Date(2026, 9, 25, 13, 17).getTime() },
        { timestamp: new Date(2026, 9, 25, 15, 33).getTime() },
        { timestamp: new Date(2026, 9, 25, 23, 11).getTime() },
        { timestamp: new Date(2026, 9, 26, 10, 36).getTime() },
        { timestamp: new Date(2026, 9, 26, 12, 44).getTime() },
      ]

      const res = computeSmartScheduleTime(cached, 120, now, 5)

      // 应当插入到 10-24 的 17:02 到 21:58 之间 (17:02 + 125m = 19:07)
      expect(res.getFullYear()).toBe(2026)
      expect(res.getMonth()).toBe(9)
      expect(res.getDate()).toBe(24) // 依然是 10-24 今天！
      expect(res.getHours()).toBe(19)
      expect(res.getMinutes()).toBe(7)
    })

    it('当第一天已满且第二天早晨有空档时，优先插入第二天早晨首档', () => {
      const now = new Date(2026, 9, 24, 22, 0, 0)
      const cached = [
        // 今天已排满到晚上（22:30，加2h后到凌晨00:35，进入静默区）
        { timestamp: new Date(2026, 9, 24, 22, 30).getTime() },
        // 明天首推在 10:47，早晨 07:35 到 10:47 有 3h12m 空隙
        { timestamp: new Date(2026, 9, 25, 10, 47).getTime() },
      ]

      const res = computeSmartScheduleTime(cached, 120, now, 5)

      // 应当顺延至明天早晨首档 07:35
      expect(res.getDate()).toBe(25)
      expect(res.getHours()).toBe(7)
      expect(res.getMinutes()).toBe(35)
    })

    it('当第一天已满且第二天早晨已满时，自动到下一天下午空隙插入', () => {
      const now = new Date(2026, 9, 24, 22, 0, 0)
      const cached = [
        // 今天已排满到晚上（22:30，加2h后到凌晨00:35，进入静默区）
        { timestamp: new Date(2026, 9, 24, 22, 30).getTime() },
        // 明天早晨 08:30 已有排期（导致 07:35 插不进去，距 08:30 只有 55 分钟）
        { timestamp: new Date(2026, 9, 25, 8, 30).getTime() },
        { timestamp: new Date(2026, 9, 25, 10, 47).getTime() },
        { timestamp: new Date(2026, 9, 25, 13, 17).getTime() },
        { timestamp: new Date(2026, 9, 25, 15, 33).getTime() },
        // 15:33 到 23:11 之间有 7h38m 大空档
        { timestamp: new Date(2026, 9, 25, 23, 11).getTime() },
      ]

      const res = computeSmartScheduleTime(cached, 120, now, 5)

      // 应当插在明天 15:33 之后 (15:33 + 125m = 17:38)
      expect(res.getDate()).toBe(25) // 明天！
      expect(res.getHours()).toBe(17)
      expect(res.getMinutes()).toBe(38)
    })

    it('当所有已有日期的中间空档都已填满时，排在最后一条之后', () => {
      const now = new Date(2026, 9, 26, 11, 0, 0)
      const cached = [
        { timestamp: new Date(2026, 9, 26, 10, 36).getTime() },
        { timestamp: new Date(2026, 9, 26, 12, 44).getTime() },
      ]

      const res = computeSmartScheduleTime(cached, 120, now, 5)

      // 应当排在最后一条 12:44 + 125m = 14:49
      expect(res.getDate()).toBe(26)
      expect(res.getHours()).toBe(14)
      expect(res.getMinutes()).toBe(49)
    })

    it('计算结果撞上深夜静默区时，自动顺延至早晨首档 (07:30 + 微扰)', () => {
      const now = new Date(2026, 9, 24, 22, 0, 0)
      const cached = [
        { timestamp: new Date(2026, 9, 24, 23, 15, 0).getTime() },
      ]
      const res = computeSmartScheduleTime(cached, 120, now, 7)
      // 23:15 + 127m = 次日 01:22 (落在 00:30 至 07:30 之间)
      // 顺延至次日早晨 07:30 + 7m = 07:37
      expect(res.getDate()).toBe(25)
      expect(res.getHours()).toBe(7)
      expect(res.getMinutes()).toBe(37)
    })

    it('单个大空档内部能连续容纳多个排期点（增量时间轴填充，绝不单档跳出跨天）', () => {
      // 用户真实场景：10-25 当天在 15:33 到 23:11 之间有长达 7小时38分 的大空档
      const now = new Date(2026, 9, 25, 15, 20, 0)
      const cached = [
        { timestamp: new Date(2026, 9, 25, 7, 33).getTime() },
        { timestamp: new Date(2026, 9, 25, 10, 47).getTime() },
        { timestamp: new Date(2026, 9, 25, 13, 17).getTime() },
        { timestamp: new Date(2026, 9, 25, 15, 33).getTime() },
        { timestamp: new Date(2026, 9, 25, 23, 11).getTime() },
      ]

      // 以 2 小时 (120 分钟) 间隔，固定微扰 5 分钟计算插槽
      const slots2h = computeSmartScheduleSlots(cached, 120, now, 5, 4)

      // 槽位 0：15:33 + 125m = 17:38 (在 15:33 到 23:11 空档内)
      expect(slots2h[0].getDate()).toBe(25)
      expect(slots2h[0].getHours()).toBe(17)
      expect(slots2h[0].getMinutes()).toBe(38)

      // 槽位 1：17:38 + 125m = 19:43 (继续在同一个大空档内填充，不跨天跳到 10-26！)
      expect(slots2h[1].getDate()).toBe(25)
      expect(slots2h[1].getHours()).toBe(19)
      expect(slots2h[1].getMinutes()).toBe(43)

      // 槽位 2：19:43 + 125m = 21:48 (距 23:11 仅 83m < 120m，因此无法再塞入此空档)
      // 推进到 23:11 之后 (+125m 为 01:16 静默区)，顺延至后天 10-26 早晨首档 07:35
      expect(slots2h[2].getDate()).toBe(26)
      expect(slots2h[2].getHours()).toBe(7)
      expect(slots2h[2].getMinutes()).toBe(35)

      // 槽位 3：后天 10-26 07:35 + 125m = 09:40
      expect(slots2h[3].getDate()).toBe(26)
      expect(slots2h[3].getHours()).toBe(9)
      expect(slots2h[3].getMinutes()).toBe(40)
    })

    it('当用户调小间隔为 1.5 小时 (90 分钟) 时，同一大空隙内可容纳更多连续插槽', () => {
      const now = new Date(2026, 9, 25, 15, 20, 0)
      const cached = [
        { timestamp: new Date(2026, 9, 25, 15, 33).getTime() },
        { timestamp: new Date(2026, 9, 25, 23, 11).getTime() },
      ]

      // 90 分钟间隔 + 5 分钟微扰 = 95 分钟每档
      const slots90m = computeSmartScheduleSlots(cached, 90, now, 5, 5)

      // 槽位 0: 15:33 + 95m = 17:08
      expect(slots90m[0].getDate()).toBe(25)
      expect(slots90m[0].getHours()).toBe(17)
      expect(slots90m[0].getMinutes()).toBe(8)

      // 槽位 1: 17:08 + 95m = 18:43 (同空档)
      expect(slots90m[1].getDate()).toBe(25)
      expect(slots90m[1].getHours()).toBe(18)
      expect(slots90m[1].getMinutes()).toBe(43)

      // 槽位 2: 18:43 + 95m = 20:18 (同空档)
      expect(slots90m[2].getDate()).toBe(25)
      expect(slots90m[2].getHours()).toBe(20)
      expect(slots90m[2].getMinutes()).toBe(18)

      // 槽位 3: 20:18 + 95m = 21:53 (距 23:11 仅 78m < 90m，填满并推进到次日早晨 07:35)
      expect(slots90m[3].getDate()).toBe(26)
      expect(slots90m[3].getHours()).toBe(7)
      expect(slots90m[3].getMinutes()).toBe(35)
    })

    it('真实用户多天排期场景：今天排到 21:49 后，后续插槽必须顺畅跨越深夜静默区顺延至次日早晨与更远日期', () => {
      // 模拟用户截图中的数据：
      // 今天 11-01：11:00, 11:52, 13:00
      // 明天 11-02：09:53, 13:03
      // 后天 11-03：09:00, 17:08
      const now = new Date(2026, 10, 1, 13, 0, 0) // 2026-11-01 13:00
      const cached = [
        { timestamp: new Date(2026, 10, 1, 11, 0).getTime() },
        { timestamp: new Date(2026, 10, 1, 11, 52).getTime() },
        { timestamp: new Date(2026, 10, 1, 13, 0).getTime() },
        { timestamp: new Date(2026, 10, 2, 9, 53).getTime() },
        { timestamp: new Date(2026, 10, 2, 13, 3).getTime() },
        { timestamp: new Date(2026, 10, 3, 9, 0).getTime() },
        { timestamp: new Date(2026, 10, 3, 17, 8).getTime() },
      ]

      // 1.0 小时间隔 (60 分钟)，固定微扰 5 分钟 (每次步进 65 分钟)
      // 生成 30 个插槽（足够填满今天下午与明天全天，并延展至后天 11-03）
      const slots = computeSmartScheduleSlots(cached, 60, now, 5, 30)

      expect(slots.length).toBe(30)

      // 验证今天 11-01 填充的各个空档（从 13:00 之后开始）
      // 槽位 0: 13:00 + 65m = 14:05
      expect(slots[0].getDate()).toBe(1)
      expect(slots[0].getHours()).toBe(14)
      expect(slots[0].getMinutes()).toBe(5)

      // 遍历所有 slots，验证必有跨越到明天 11-02 的 slot，且避开了 00:30 至 07:30 深夜静默区
      const tomorrowSlots = slots.filter((d) => d.getDate() === 2)
      expect(tomorrowSlots.length).toBeGreaterThan(0)

      // 验证明天的槽位均不在深夜静默区 (00:30 至 07:30)
      for (const slot of tomorrowSlots) {
        expect(isQuietHour(slot)).toBe(false)
      }

      // 明天早晨首档应当在 07:30 以后 (07:30 + 5m = 07:35)
      expect(tomorrowSlots[0].getHours()).toBe(7)
      expect(tomorrowSlots[0].getMinutes()).toBe(35)

      // 验证后续还能顺延到后天 11-03
      const afterTomorrowSlots = slots.filter((d) => d.getDate() === 3)
      expect(afterTomorrowSlots.length).toBeGreaterThan(0)
    })
  })

  describe('本地存储记忆 (localStorage)', () => {
    it('默认返回 120 分钟', () => {
      expect(getStoredSmartInterval()).toBe(DEFAULT_SMART_SCHEDULE_INTERVAL)
    })

    it('能正确存储与读取合法范围内的间隔', () => {
      saveStoredSmartInterval(30)
      expect(getStoredSmartInterval()).toBe(30)
      expect(localStorage.getItem(KeySmartScheduleInterval)).toBe('30')

      saveStoredSmartInterval(150)
      expect(getStoredSmartInterval()).toBe(150)
      expect(localStorage.getItem(KeySmartScheduleInterval)).toBe('150')
    })

    it('非法值自动兜底回退为默认 120 分钟', () => {
      localStorage.setItem(KeySmartScheduleInterval, 'invalid')
      expect(getStoredSmartInterval()).toBe(120)

      localStorage.setItem(KeySmartScheduleInterval, '500')
      expect(getStoredSmartInterval()).toBe(120)

      localStorage.setItem(KeySmartScheduleInterval, '20')
      expect(getStoredSmartInterval()).toBe(120)
    })
  })

  describe('applySmartScheduleTimeToModal', () => {
    it('正确填充 24 小时制的原生下拉框并触发 input 与 change 事件', () => {
      const modal = document.createElement('div')
      modal.innerHTML = `
        <label id="Y_L">年</label>
        <select id="Y" aria-labelledby="Y_L"><option value="2026">2026</option></select>
        <label id="M_L">月</label>
        <select id="M" aria-labelledby="M_L"><option value="10">10月</option></select>
        <label id="D_L">日</label>
        <select id="D" aria-labelledby="D_L"><option value="25">25</option></select>
        <label id="H_L">时</label>
        <select id="H" aria-labelledby="H_L"><option value="15">15</option></select>
        <label id="MIN_L">分</label>
        <select id="MIN" aria-labelledby="MIN_L"><option value="42">42</option></select>
      `

      const targetDate = new Date(2026, 9, 25, 15, 42, 0)
      const res = applySmartScheduleTimeToModal(modal, targetDate)

      expect(res).toBe(true)
      expect((modal.querySelector('#Y') as HTMLSelectElement).value).toBe('2026')
      expect((modal.querySelector('#M') as HTMLSelectElement).value).toBe('10')
      expect((modal.querySelector('#D') as HTMLSelectElement).value).toBe('25')
      expect((modal.querySelector('#H') as HTMLSelectElement).value).toBe('15')
      expect((modal.querySelector('#MIN') as HTMLSelectElement).value).toBe('42')
    })

    it('正确支持 12 小时制带 AM/PM 的下拉框', () => {
      const modal = document.createElement('div')
      modal.innerHTML = `
        <select aria-label="Year"><option value="2026">2026</option></select>
        <select aria-label="Month"><option value="10">October</option></select>
        <select aria-label="Day"><option value="25">25</option></select>
        <select aria-label="Hour"><option value="3">3</option><option value="4">4</option></select>
        <select aria-label="Minute"><option value="18">18</option></select>
        <select aria-label="AM/PM"><option value="am">AM</option><option value="pm">PM</option></select>
      `

      // 15:18 => 3:18 PM
      const targetDate = new Date(2026, 9, 25, 15, 18, 0)
      const res = applySmartScheduleTimeToModal(modal, targetDate)

      expect(res).toBe(true)
      const selects = modal.querySelectorAll('select')
      expect(selects[3].value).toBe('3')
      expect(selects[5].value).toBe('pm')
    })
  })

  describe('buildSmartSchedulerBarHtml & bindSmartSchedulerControls', () => {
    it('生成包含滑块与简洁跑道胶囊「智能排期」一体化控制栏（无图标，左右内嵌切档按钮）', () => {
      const html = buildSmartSchedulerBarHtml({ intervalMinutes: 120 })
      expect(html).toContain('xf-smart-scheduler-bar')
      expect(html).toContain('xf-smart-interval-slider')
      expect(html).toContain('height: 6px')
      expect(html).toContain('rgba(29, 155, 240, 0.22)')
      expect(html).toContain('xf-smart-capsule-group')
      expect(html).toContain('xf-smart-slot-prev-btn')
      expect(html).toContain('xf-smart-schedule-apply-btn')
      expect(html).toContain('xf-smart-slot-next-btn')
      expect(html).toContain('2.0h')
      expect(html).toContain('智能排期')
    })

    it('滑动滑块时实时更新徽标并持久化保存，且动态更新滑块淡蓝色进度填充', () => {
      const modal = document.createElement('div')
      const container = document.createElement('div')
      container.innerHTML = buildSmartSchedulerBarHtml({ intervalMinutes: 120 })

      bindSmartSchedulerControls(modal, container, [])

      const slider = container.querySelector<HTMLInputElement>('.xf-smart-interval-slider')!
      const badge = container.querySelector<HTMLElement>('.xf-smart-interval-badge')!

      slider.value = '90'
      slider.dispatchEvent(new Event('input'))

      expect(badge.textContent).toBe('1.5h')
      expect(slider.style.getPropertyValue('--slider-pct')).toBe('28.6%')
      expect(slider.style.background).toContain('linear-gradient')
      expect(localStorage.getItem(KeySmartScheduleInterval)).toBe('90')

      // 测试半小时最小值 30m
      slider.value = '30'
      slider.dispatchEvent(new Event('input'))
      expect(badge.textContent).toBe('0.5h')
      expect(slider.style.getPropertyValue('--slider-pct')).toBe('0.0%')
      expect(localStorage.getItem(KeySmartScheduleInterval)).toBe('30')
    })

    it('点击智能排期按钮计算并自动填充，且提供瞬时反馈', () => {
      const modal = document.createElement('div')
      modal.innerHTML = `
        <select id="SELECTOR_1"><option value="10">10</option></select>
        <select id="SELECTOR_2"><option value="24">24</option></select>
        <select id="SELECTOR_3"><option value="2026">2026</option></select>
        <select id="SELECTOR_4"><option value="14">14</option><option value="16">16</option></select>
        <select id="SELECTOR_5"><option value="20">20</option><option value="25">25</option></select>
      `
      const container = document.createElement('div')
      container.innerHTML = buildSmartSchedulerBarHtml({ intervalMinutes: 120 })

      bindSmartSchedulerControls(modal, container, [])

      const btn = container.querySelector<HTMLButtonElement>('.xf-smart-schedule-apply-btn')!
      btn.click()

      const textEl = btn.querySelector('.xf-smart-btn-text')!
      expect(textEl.textContent).toBe('智能排期')
      expect(btn.style.color).toBe('rgb(16, 185, 129)')
      expect(container.querySelector('.xf-scheduler-toast')).toBeNull()
    })

    it('跑道胶囊左右半圆支持在下一个与上一个可用空档间来回切换', () => {
      const modal = document.createElement('div')
      modal.innerHTML = `
        <select id="SELECTOR_1"><option value="10">10</option></select>
        <select id="SELECTOR_2"><option value="24">24</option><option value="25">25</option></select>
        <select id="SELECTOR_3"><option value="2026">2026</option></select>
        <select id="SELECTOR_4"><option value="7">7</option><option value="9">9</option><option value="19">19</option></select>
        <select id="SELECTOR_5"><option value="7">7</option><option value="35">35</option></select>
      `
      const container = document.createElement('div')
      container.innerHTML = buildSmartSchedulerBarHtml({ intervalMinutes: 120 })

      const cached = [
        { timestamp: new Date(2026, 9, 24, 17, 2).getTime() },
        { timestamp: new Date(2026, 9, 24, 21, 58).getTime() },
        { timestamp: new Date(2026, 9, 25, 10, 47).getTime() },
      ]

      bindSmartSchedulerControls(modal, container, cached)

      const prevBtn = container.querySelector<HTMLButtonElement>('.xf-smart-slot-prev-btn')!
      const nextBtn = container.querySelector<HTMLButtonElement>('.xf-smart-slot-next-btn')!
      const textEl = container.querySelector<HTMLElement>('.xf-smart-btn-text')!

      // 默认在第 0 档 (上一个不可点)
      expect(prevBtn.style.opacity).toBe('0.35')

      // 点击右半圆切换到下一个可用插槽
      nextBtn.click()
      expect(textEl.textContent).toBe('智能排期')
      expect(container.querySelector('.xf-scheduler-toast')).toBeNull()
      expect(prevBtn.style.opacity).toBe('1')

      // 点击左半圆切回上一个插槽
      prevBtn.click()
      expect(textEl.textContent).toBe('智能排期')
      expect(container.querySelector('.xf-scheduler-toast')).toBeNull()
      expect(prevBtn.style.opacity).toBe('0.35')
    })

    it('连续点击智能排期中间主按钮时自动向后步进到下一个可用空档', () => {
      const modal = document.createElement('div')
      modal.innerHTML = `
        <select id="SELECTOR_1"><option value="10">10</option></select>
        <select id="SELECTOR_2"><option value="24">24</option><option value="25">25</option></select>
        <select id="SELECTOR_3"><option value="2026">2026</option></select>
        <select id="SELECTOR_4"><option value="7">7</option><option value="9">9</option><option value="19">19</option></select>
        <select id="SELECTOR_5"><option value="7">7</option><option value="35">35</option></select>
      `
      const container = document.createElement('div')
      container.innerHTML = buildSmartSchedulerBarHtml({ intervalMinutes: 120 })

      const cached = [
        { timestamp: new Date(2026, 9, 24, 17, 2).getTime() },
        { timestamp: new Date(2026, 9, 24, 21, 58).getTime() },
        { timestamp: new Date(2026, 9, 25, 10, 47).getTime() },
      ]

      bindSmartSchedulerControls(modal, container, cached)

      const applyBtn = container.querySelector<HTMLButtonElement>('.xf-smart-schedule-apply-btn')!
      const textEl = container.querySelector<HTMLElement>('.xf-smart-btn-text')!
      const selHour = modal.querySelector<HTMLSelectElement>('#SELECTOR_4')!

      // 第一次点击：应用当前槽位 (slot 0)
      applyBtn.click()
      expect(textEl.textContent).toBe('智能排期')
      expect((container as any).__xf_slot_index).toBe(0)

      // 连续第二次点击：在已安排状态下，自动步进至下一个槽位 (slot 1)
      applyBtn.click()
      expect(textEl.textContent).toBe('智能排期')
      expect((container as any).__xf_slot_index).toBe(1)
      expect(container.querySelector('.xf-scheduler-toast')).toBeNull()
    })

    it('右箭头在连续向后切档时支持自动增量扩容，始终保持可用不卡死', () => {
      const modal = document.createElement('div')
      modal.innerHTML = `
        <select id="SELECTOR_1"><option value="10">10</option></select>
        <select id="SELECTOR_2"><option value="24">24</option></select>
        <select id="SELECTOR_3"><option value="2026">2026</option></select>
        <select id="SELECTOR_4"><option value="7">7</option></select>
        <select id="SELECTOR_5"><option value="7">7</option></select>
      `
      const container = document.createElement('div')
      container.innerHTML = buildSmartSchedulerBarHtml({ intervalMinutes: 60 })

      bindSmartSchedulerControls(modal, container, [])

      const nextBtn = container.querySelector<HTMLButtonElement>('.xf-smart-slot-next-btn')!

      // 连续点击 35 次，超过默认的 30 个初始插槽
      for (let i = 0; i < 35; i++) {
        nextBtn.click()
        // 验证右箭头始终保持可用，不会被锁定为 0.35 opacity
        expect(nextBtn.style.opacity).toBe('1')
        expect(nextBtn.style.cursor).toBe('pointer')
      }
    })
  })

  describe('computeDayScheduleSlots (针对用户选定特定某天的智能寻隙排期)', () => {
    it('目标日期全天空闲时，生成当天从 07:30 开始的多个间隔插槽，且年月日严格等于目标日期', () => {
      const now = new Date(2026, 9, 24, 10, 0, 0)
      const targetDay = new Date(2026, 9, 28) // 选定 10月28日
      const slots = computeDayScheduleSlots([], targetDay, 120, now, 5, 5)

      expect(slots.length).toBeGreaterThan(0)
      for (const slot of slots) {
        expect(slot.getFullYear()).toBe(2026)
        expect(slot.getMonth()).toBe(9)
        expect(slot.getDate()).toBe(28) // 100% 落在选定日，绝不跳到其他日期！
      }
      // 首档为 07:30 + 5m = 07:35
      expect(slots[0].getHours()).toBe(7)
      expect(slots[0].getMinutes()).toBe(35)
      // 第二档为 07:35 + 125m = 09:40
      expect(slots[1].getHours()).toBe(9)
      expect(slots[1].getMinutes()).toBe(40)
    })

    it('选定日期内已有排期时，精准在已有推文空隙间插空，绝不越界到前一天或后一天', () => {
      const now = new Date(2026, 9, 24, 10, 0, 0)
      const targetDay = new Date(2026, 9, 25) // 目标是 10-25
      const cached = [
        // 10-24 前一天的推文
        { timestamp: new Date(2026, 9, 24, 21, 0).getTime() },
        // 10-25 当天有两条推文：08:00 与 16:00 (之间空闲 8 小时)
        { timestamp: new Date(2026, 9, 25, 8, 0).getTime() },
        { timestamp: new Date(2026, 9, 25, 16, 0).getTime() },
        // 10-26 后一天的推文
        { timestamp: new Date(2026, 9, 26, 9, 0).getTime() },
      ]

      const slots = computeDayScheduleSlots(cached, targetDay, 120, now, 5, 4)

      expect(slots.length).toBeGreaterThan(0)
      for (const slot of slots) {
        expect(slot.getFullYear()).toBe(2026)
        expect(slot.getMonth()).toBe(9)
        expect(slot.getDate()).toBe(25) // 严格锁定在 10-25！
        // 校验不与 08:00 冲突 (必须在 08:00 之前或 10:00 之后)
        const ts = slot.getTime()
        const t1 = new Date(2026, 9, 25, 8, 0).getTime()
        const t2 = new Date(2026, 9, 25, 16, 0).getTime()
        expect(Math.abs(ts - t1)).toBeGreaterThanOrEqual(120 * 60 * 1000)
        expect(Math.abs(ts - t2)).toBeGreaterThanOrEqual(120 * 60 * 1000)
      }
    })

    it('当选定日全部时段已被排满无可用间隙时，返回空数组', () => {
      const now = new Date(2026, 9, 24, 10, 0, 0)
      const targetDay = new Date(2026, 9, 25)
      // 在 10-25 从早到晚密密麻麻排满（每隔 1 小时排一条，而要求间隔为 2 小时）
      const cached = []
      for (let h = 7; h <= 23; h++) {
        cached.push({ timestamp: new Date(2026, 9, 25, h, 30).getTime() })
      }

      const slots = computeDayScheduleSlots(cached, targetDay, 120, now, 5)
      expect(slots).toEqual([])
    })

    it('当选定日为过去的日期时，返回空数组', () => {
      const now = new Date(2026, 9, 24, 10, 0, 0)
      const targetDay = new Date(2026, 9, 20) // 过去的日期
      const slots = computeDayScheduleSlots([], targetDay, 120, now)
      expect(slots).toEqual([])
    })
  })

  describe('getSelectedDateFromModal', () => {
    it('能够从 modal 原生 select 中准确读取年月日', () => {
      const modal = document.createElement('div')
      modal.innerHTML = `
        <select id="SELECTOR_1"><option value="11" selected>11</option></select>
        <select id="SELECTOR_2"><option value="5" selected>5</option></select>
        <select id="SELECTOR_3"><option value="2026" selected>2026</option></select>
      `
      const dt = getSelectedDateFromModal(modal)
      expect(dt.getFullYear()).toBe(2026)
      expect(dt.getMonth()).toBe(10) // 11 月对应 month 10
      expect(dt.getDate()).toBe(5)
    })

    it('能够从 modal input[type="date"] 中准确读取年月日', () => {
      const modal = document.createElement('div')
      modal.innerHTML = `<input type="date" value="2026-12-08" />`
      const dt = getSelectedDateFromModal(modal)
      expect(dt.getFullYear()).toBe(2026)
      expect(dt.getMonth()).toBe(11) // 12 月
      expect(dt.getDate()).toBe(8)
    })
  })

  describe('独立【当日排期】按钮交互', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 10, 15, 6, 0, 0))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('控制栏包含独立的【当日排期】按钮，点击只在用户选中的当天寻找空位并填充', () => {
      const modal = document.createElement('div')
      modal.innerHTML = `
        <select id="SELECTOR_1"><option value="11" selected>11</option></select>
        <select id="SELECTOR_2"><option value="15" selected>15</option></select>
        <select id="SELECTOR_3"><option value="2026" selected>2026</option></select>
        <select id="SELECTOR_4"><option value="7">7</option><option value="9">9</option></select>
        <select id="SELECTOR_5"><option value="35">35</option><option value="40">40</option></select>
      `
      const container = document.createElement('div')
      container.innerHTML = buildSmartSchedulerBarHtml({ intervalMinutes: 120 })

      bindSmartSchedulerControls(modal, container, [])

      const dayBtn = container.querySelector<HTMLButtonElement>('.xf-day-schedule-apply-btn')!
      expect(dayBtn).not.toBeNull()
      const textEl = dayBtn.querySelector('.xf-day-btn-text')!
      expect(textEl.textContent).toBe('当日排期')

      // 点击当日排期按钮
      dayBtn.click()

      // 验证按钮变为绿色反馈，文案保持固定为“当日排期”，绝无多余 Toast 干扰页面布局
      expect(textEl.textContent).toBe('当日排期')
      expect(dayBtn.style.color).toBe('rgb(16, 185, 129)')
      expect(container.querySelector('.xf-scheduler-toast')).toBeNull()

      // 验证填入 modal 的年月日依然是用户选中的 2026-11-15
      const selYear = modal.querySelector<HTMLSelectElement>('#SELECTOR_3')!
      const selMonth = modal.querySelector<HTMLSelectElement>('#SELECTOR_1')!
      const selDay = modal.querySelector<HTMLSelectElement>('#SELECTOR_2')!
      expect(selYear.value).toBe('2026')
      expect(selMonth.value).toBe('11')
      expect(selDay.value).toBe('15')
    })

    it('连续点击【当日排期】按钮可循环切换当天的下一个空档', () => {
      const modal = document.createElement('div')
      modal.innerHTML = `
        <select id="SELECTOR_1"><option value="11" selected>11</option></select>
        <select id="SELECTOR_2"><option value="15" selected>15</option></select>
        <select id="SELECTOR_3"><option value="2026" selected>2026</option></select>
        <select id="SELECTOR_4"><option value="7">7</option><option value="9">9</option><option value="11">11</option></select>
        <select id="SELECTOR_5"><option value="35">35</option><option value="40">40</option></select>
      `
      const container = document.createElement('div')
      container.innerHTML = buildSmartSchedulerBarHtml({ intervalMinutes: 120 })

      bindSmartSchedulerControls(modal, container, [])

      const dayBtn = container.querySelector<HTMLButtonElement>('.xf-day-schedule-apply-btn')!
      const textEl = dayBtn.querySelector('.xf-day-btn-text')!
      const selHour = modal.querySelector<HTMLSelectElement>('#SELECTOR_4')!

      // 第一次点击
      dayBtn.click()
      expect(textEl.textContent).toBe('当日排期')
      const firstHour = selHour.value

      // 第二次点击（切换当天下一个空档）
      dayBtn.click()
      expect(textEl.textContent).toBe('当日排期')
      const secondHour = selHour.value

      // 两档时间应当不同且无 Toast 插入
      expect(secondHour).not.toBe(firstHour)
      expect(container.querySelector('.xf-scheduler-toast')).toBeNull()
    })

    it('当日排期胶囊组包含左右切档箭头，支持向前向后在当天的多个空档间自由切换', () => {
      const modal = document.createElement('div')
      modal.innerHTML = `
        <select id="SELECTOR_1"><option value="11" selected>11</option></select>
        <select id="SELECTOR_2"><option value="15" selected>15</option></select>
        <select id="SELECTOR_3"><option value="2026" selected>2026</option></select>
        <select id="SELECTOR_4"><option value="7">7</option><option value="9">9</option><option value="11">11</option></select>
        <select id="SELECTOR_5"><option value="35">35</option><option value="40">40</option></select>
      `
      const container = document.createElement('div')
      container.innerHTML = buildSmartSchedulerBarHtml({ intervalMinutes: 120 })

      bindSmartSchedulerControls(modal, container, [])

      const dayPrevBtn = container.querySelector<HTMLButtonElement>('.xf-day-slot-prev-btn')!
      const dayNextBtn = container.querySelector<HTMLButtonElement>('.xf-day-slot-next-btn')!
      const dayBtn = container.querySelector<HTMLButtonElement>('.xf-day-schedule-apply-btn')!
      const textEl = dayBtn.querySelector('.xf-day-btn-text')!
      const selHour = modal.querySelector<HTMLSelectElement>('#SELECTOR_4')!

      expect(dayPrevBtn).not.toBeNull()
      expect(dayNextBtn).not.toBeNull()

      // 初次点击右箭头，步进到第 0 档
      dayNextBtn.click()
      expect(textEl.textContent).toBe('当日排期')
      const slot0Hour = selHour.value
      // 此时已在第 0 档，左箭头禁用
      expect(dayPrevBtn.style.opacity).toBe('0.35')

      // 点击右箭头，前进到第 1 档
      dayNextBtn.click()
      expect(textEl.textContent).toBe('当日排期')
      const slot1Hour = selHour.value
      expect(slot1Hour).not.toBe(slot0Hour)
      // 此时左箭头恢复可用
      expect(dayPrevBtn.style.opacity).toBe('1')

      // 点击左箭头，退回第 0 档
      dayPrevBtn.click()
      expect(textEl.textContent).toBe('当日排期')
      expect(selHour.value).toBe(slot0Hour)
      expect(dayPrevBtn.style.opacity).toBe('0.35')
      expect(container.querySelector('.xf-scheduler-toast')).toBeNull()
    })

    it('若所选日期已被排满无空档，当日排期按钮文案保持固定，展示琥珀色警示且无 Toast 挤占布局', () => {
      const modal = document.createElement('div')
      modal.innerHTML = `
        <select id="SELECTOR_1"><option value="10" selected>10</option></select>
        <select id="SELECTOR_2"><option value="28" selected>28</option></select>
        <select id="SELECTOR_3"><option value="2026" selected>2026</option></select>
        <select id="SELECTOR_4"><option value="7">7</option></select>
        <select id="SELECTOR_5"><option value="35">35</option></select>
      `
      const container = document.createElement('div')
      container.innerHTML = buildSmartSchedulerBarHtml({ intervalMinutes: 120 })

      // 10-28 密密麻麻排满
      const cached = []
      for (let h = 7; h <= 23; h++) {
        cached.push({ timestamp: new Date(2026, 9, 28, h, 30).getTime() })
      }

      bindSmartSchedulerControls(modal, container, cached)

      const dayBtn = container.querySelector<HTMLButtonElement>('.xf-day-schedule-apply-btn')!
      const textEl = dayBtn.querySelector('.xf-day-btn-text')!

      dayBtn.click()

      expect(textEl.textContent).toBe('当日排期')
      expect(dayBtn.style.color).toBe('rgb(245, 158, 11)')
      expect(container.querySelector('.xf-scheduler-toast')).toBeNull()
    })

    it('当存在最近即时发帖时间戳时，智能排期与当日排期起步时间强制避开，不得早于 lastTweetSentAt + interval', () => {
      // 假设当前时间 14:05，用户在 14:00 (5分钟前) 刚刚发了一条推文，发帖间隔设定为 60 分钟
      const now = new Date(2026, 9, 28, 14, 5)
      const lastTweetSentAt = new Date(2026, 9, 28, 14, 0).getTime()
      const intervalMinutes = 60

      const slots = computeSmartScheduleSlots([], intervalMinutes, now, 0, 5, lastTweetSentAt)
      expect(slots.length).toBeGreaterThan(0)
      // 首个插槽必须 >= 14:00 + 60m = 15:00
      expect(slots[0].getTime()).toBeGreaterThanOrEqual(lastTweetSentAt + intervalMinutes * 60 * 1000)

      // 测试当日排期：在当天选择中同样避开最近发帖
      const targetDay = new Date(2026, 9, 28)
      const daySlots = computeDayScheduleSlots([], targetDay, intervalMinutes, now, 0, 5, lastTweetSentAt)
      expect(daySlots.length).toBeGreaterThan(0)
      expect(daySlots[0].getTime()).toBeGreaterThanOrEqual(lastTweetSentAt + intervalMinutes * 60 * 1000)
    })
  })
})
