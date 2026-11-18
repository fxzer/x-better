import dayjs from 'dayjs'
import { getStorage, setStorage } from '../utilities/storage'
import { KeyLastTweetSentAt } from '../../storage-keys'

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

export const KeySmartScheduleInterval = 'xf_smart_schedule_interval_mins'
export const DEFAULT_SMART_SCHEDULE_INTERVAL = 120 // 2 小时

export function getStoredSmartInterval(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_SMART_SCHEDULE_INTERVAL
  try {
    const saved = localStorage.getItem(KeySmartScheduleInterval)
    const num = saved ? parseInt(saved, 10) : NaN
    if (!isNaN(num) && num >= 30 && num <= 240) {
      return num
    }
  } catch {}
  return DEFAULT_SMART_SCHEDULE_INTERVAL
}

export function saveStoredSmartInterval(mins: number): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KeySmartScheduleInterval, String(mins))
  } catch {}
  void setStorage({ [KeySmartScheduleInterval]: mins }).catch(() => {})
}

export function formatSmartIntervalLabel(minutes: number): string {
  if (minutes % 30 === 0) {
    return `${(minutes / 60).toFixed(1)}h`
  }
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}m`
  return `${hours}h ${mins}m`
}

export function formatShortSlotLabel(targetDate: Date, now: Date = new Date()): string {
  const isToday = dayjs(targetDate).isSame(now, 'day')
  const isTomorrow = dayjs(targetDate).isSame(dayjs(now).add(1, 'day'), 'day')
  const timeStr = dayjs(targetDate).format('HH:mm')
  if (isToday) return `已安排至 ${timeStr}`
  if (isTomorrow) return `已安排至 明天 ${timeStr}`
  return `已安排至 ${dayjs(targetDate).format('MM-DD HH:mm')}`
}

/**
 * 判断指定时间是否落在深夜静默区 (00:30 至 07:30)
 */
export function isQuietHour(date: Date): boolean {
  const h = date.getHours()
  const m = date.getMinutes()
  if (h === 0 && m >= 30) return true
  if (h >= 1 && h < 7) return true
  if (h === 7 && m < 30) return true
  return false
}

/**
 * 智能贪心计算多档可用排期插槽列表 (Gap-Filling Slots)
 *
 * 核心规则：
 * 1. 优先按时间顺序扫描，寻找已有推文之间的空档（Gap >= interval + jitter）。
 * 2. 大空档连续填充：当一个大空隙（如 7.5 小时）能容纳多个发帖间隔时，连续填满该空隙内的所有可用位点，杜绝单空隙仅排一条即草率跳到下一天。
 * 3. 严格避开 00:30 至 07:30 深夜静默区，自动顺延至早晨首档 (07:30 + 防人机微扰)。
 * 4. 返回排序后的有序插槽列表，供操场跑道一体化胶囊步进器前翻/后翻自由选择。
 */
export function computeSmartScheduleSlots(
  cachedItems: { timestamp: number }[],
  intervalMinutes: number = DEFAULT_SMART_SCHEDULE_INTERVAL,
  now: Date = new Date(),
  jitterMinutes?: number,
  maxSlots: number = 30,
  lastTweetSentAt?: number
): Date[] {
  const intervalMs = intervalMinutes * 60 * 1000
  const minBufferMs = 2 * 60 * 1000 // 至少领先当前时间 2 分钟
  const nowMs = now.getTime()

  // 若存在最近发帖时间（且在合理范围内），起步时间必须至少间隔 intervalMs，避免与刚发的推文撞车
  const safeLastTweetSentAt =
    typeof lastTweetSentAt === 'number' && !isNaN(lastTweetSentAt) && lastTweetSentAt > 0 && lastTweetSentAt <= nowMs + 24 * 3600 * 1000
      ? lastTweetSentAt
      : 0
  const earliestAllowedMs = Math.max(
    nowMs + minBufferMs,
    safeLastTweetSentAt > 0 ? safeLastTweetSentAt + intervalMs : nowMs + minBufferMs
  )

  // 辅助函数：根据 jitterMinutes 或随机值生成抖动毫秒数 (3 到 10 分钟)
  const getJitterMs = () => {
    const jitter = jitterMinutes !== undefined
      ? jitterMinutes
      : Math.floor(Math.random() * 8) + 3
    return jitter * 60 * 1000
  }

  // 辅助函数：将落在深夜静默区 (00:30 至 07:30) 的时间戳顺延至当日（或次日）早晨 07:30 + jitter
  const advanceQuietHours = (ts: number, jMs: number): number => {
    const d = new Date(ts)
    if (isQuietHour(d)) {
      d.setHours(7, 30, 0, 0)
      d.setTime(d.getTime() + jMs)
      if (d.getTime() <= ts) {
        d.setDate(d.getDate() + 1)
        d.setHours(7, 30, 0, 0)
        d.setTime(d.getTime() + jMs)
      }
      return d.getTime()
    }
    return ts
  }

  const validItems = (cachedItems || [])
    .filter((item) => item && typeof item.timestamp === 'number' && !isNaN(item.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)

  const confirmedSlots: number[] = []
  // 维护合并时间轴：包含已有排期推文与本次逐步确认的智能插槽（动态增量填补）
  const mergedTimeline: number[] = validItems.map((item) => item.timestamp)

  let safetyLoop = 0
  const maxIterations = maxSlots * 15 // 防御无限循环

  while (confirmedSlots.length < maxSlots && safetyLoop++ < maxIterations) {
    const jMs = getJitterMs()
    const candidates: number[] = []

    // 候选源 1：从起步有效时间起步
    // 若时间轴为空，直接从 max(earliestAllowedMs, now + interval + jitter) 起步
    // 若时间轴不为空，尝试从当前安全时间 earliestAllowedMs 插空
    if (mergedTimeline.length === 0) {
      candidates.push(advanceQuietHours(Math.max(earliestAllowedMs, nowMs + intervalMs + jMs), jMs))
    } else {
      candidates.push(advanceQuietHours(earliestAllowedMs + jMs, jMs))
    }

    // 候选源 2：在 mergedTimeline 中每个排期节点之后 (+ interval + jitter)
    for (const ts of mergedTimeline) {
      candidates.push(advanceQuietHours(ts + intervalMs + jMs, jMs))
    }

    // 候选源 3：各相关日期的早晨首档 (07:30 + jitter)
    // 覆盖未来 30 天，确保无论跨越多少天，每天早晨的 07:30 黄金首档都在候选池中
    const datesToCheck = new Set<string>()
    for (let i = 0; i <= 30; i++) {
      datesToCheck.add(dayjs(now).add(i, 'day').format('YYYY-MM-DD'))
    }
    for (const ts of mergedTimeline) {
      datesToCheck.add(dayjs(ts).format('YYYY-MM-DD'))
      datesToCheck.add(dayjs(ts).add(1, 'day').format('YYYY-MM-DD'))
      datesToCheck.add(dayjs(ts).add(2, 'day').format('YYYY-MM-DD'))
    }

    for (const dateStr of datesToCheck) {
      const d = dayjs(dateStr).toDate()
      d.setHours(7, 30, 0, 0)
      d.setTime(d.getTime() + jMs)
      if (d.getTime() >= nowMs + minBufferMs) {
        candidates.push(d.getTime())
      }
    }

    // 过滤与排序候选时间
    const sortedCandidates = Array.from(new Set(candidates))
      .filter((ts) => ts >= earliestAllowedMs && !isQuietHour(new Date(ts)))
      .sort((a, b) => a - b)

    // 寻找满足时间轴前后不冲突的最早候选插槽
    let pickedSlot: number | null = null

    for (const candTs of sortedCandidates) {
      let prevTs: number | null = null
      let nextTs: number | null = null

      for (const t of mergedTimeline) {
        if (t < candTs) {
          prevTs = t
        } else if (t > candTs) {
          nextTs = t
          break
        } else {
          // 与已有节点时间完全一致
          prevTs = t
          nextTs = t
          break
        }
      }

      if (prevTs === candTs || nextTs === candTs) {
        continue
      }

      // 校验前距：距离前一条推文必须 >= intervalMs
      if (prevTs !== null && candTs - prevTs < intervalMs) {
        continue
      }

      // 校验与最近已发推文的前距：距离最近发帖必须 >= intervalMs
      if (safeLastTweetSentAt > 0 && candTs > safeLastTweetSentAt && candTs - safeLastTweetSentAt < intervalMs) {
        continue
      }

      // 校验后距：距离后一条推文必须 >= intervalMs
      if (nextTs !== null && nextTs - candTs < intervalMs) {
        continue
      }

      // 校验与最近已确认槽位的间隔
      const lastConfirmed = confirmedSlots[confirmedSlots.length - 1]
      if (lastConfirmed !== undefined && candTs - lastConfirmed < intervalMs) {
        continue
      }

      pickedSlot = candTs
      break
    }

    if (pickedSlot !== null) {
      confirmedSlots.push(pickedSlot)
      mergedTimeline.push(pickedSlot)
      mergedTimeline.sort((a, b) => a - b)
    } else {
      // 兜底：若在已有节点间实在找不到空档，在时间轴最末尾追加
      const lastTs = mergedTimeline.length > 0
        ? mergedTimeline[mergedTimeline.length - 1]
        : nowMs
      const fallbackTs = advanceQuietHours(lastTs + intervalMs + jMs, jMs)
      confirmedSlots.push(fallbackTs)
      mergedTimeline.push(fallbackTs)
      mergedTimeline.sort((a, b) => a - b)
    }
  }

  return confirmedSlots.map((ts) => new Date(ts))
}

/**
 * 获取最早的一个可用排期时间（兼容旧调用接口）
 */
export function computeSmartScheduleTime(
  cachedItems: { timestamp: number }[],
  intervalMinutes: number = DEFAULT_SMART_SCHEDULE_INTERVAL,
  now: Date = new Date(),
  jitterMinutes?: number
): Date {
  const slots = computeSmartScheduleSlots(cachedItems, intervalMinutes, now, jitterMinutes, 1)
  return slots[0]
}

/**
 * 针对用户选定的目标日期（某一天），计算该日内符合间隔与避开冲突的可用排期插槽列表
 *
 * 核心规则：
 * 1. 严格限定在 targetDay 当天范围 (07:30 至 23:30)，坚决不跨越到次日或前日；
 * 2. 若 targetDay 为今天，起始点不得早于当前时间 + 2 分钟；若当前已过 23:30，返回空列表；
 * 3. 提取 targetDay 当天已有的所有排期推文时间戳；
 * 4. 贪心插空：按 intervalMinutes（发帖间隔）寻找已有推文之间的空档，或在首尾顺延；
 * 5. 若全天空闲，按发帖间隔依次生成该日内的黄金档位；
 * 6. 返回当天按时间升序排列的插槽数组。
 */
export function computeDayScheduleSlots(
  cachedItems: { timestamp: number }[],
  targetDay: Date,
  intervalMinutes: number = DEFAULT_SMART_SCHEDULE_INTERVAL,
  now: Date = new Date(),
  jitterMinutes?: number,
  maxSlots: number = 8,
  lastTweetSentAt?: number
): Date[] {
  const intervalMs = intervalMinutes * 60 * 1000
  const minBufferMs = 2 * 60 * 1000
  const nowMs = now.getTime()

  const safeLastTweetSentAt =
    typeof lastTweetSentAt === 'number' && !isNaN(lastTweetSentAt) && lastTweetSentAt > 0 && lastTweetSentAt <= nowMs + 24 * 3600 * 1000
      ? lastTweetSentAt
      : 0
  const earliestAllowedMs = safeLastTweetSentAt > 0 ? safeLastTweetSentAt + intervalMs : 0

  const year = targetDay.getFullYear()
  const month = targetDay.getMonth()
  const day = targetDay.getDate()

  // 当日排期合法窗口：07:30 到 23:30
  const dayStart = new Date(year, month, day, 7, 30, 0, 0).getTime()
  const dayEnd = new Date(year, month, day, 23, 30, 0, 0).getTime()

  const isToday =
    now.getFullYear() === year &&
    now.getMonth() === month &&
    now.getDate() === day

  // 如果 targetDay 比今天还要早（过去的日期），直接返回空
  const todayZero = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const targetZero = new Date(year, month, day).getTime()
  if (targetZero < todayZero) {
    return []
  }

  // 如果是今天，起始有效时间不能早于当前时间 + 2分钟，且不能早于最近发帖时间 + 间隔
  const effectiveDayStart = isToday
    ? Math.max(dayStart, nowMs + minBufferMs, earliestAllowedMs)
    : dayStart

  // 如果有效起始时间已经超过了当天的 23:30，当天无法再排期
  if (effectiveDayStart >= dayEnd) {
    return []
  }

  // 辅助防人机微扰 (3 到 8 分钟)
  const getJitterMs = () => {
    const jitter = jitterMinutes !== undefined
      ? jitterMinutes
      : Math.floor(Math.random() * 6) + 3
    return jitter * 60 * 1000
  }

  // 筛选出落在目标日内的已有推文时间点
  const dayItems = (cachedItems || [])
    .filter((it) => {
      if (!it || typeof it.timestamp !== 'number' || isNaN(it.timestamp)) return false
      const d = new Date(it.timestamp)
      return (
        d.getFullYear() === year &&
        d.getMonth() === month &&
        d.getDate() === day
      )
    })
    .map((it) => it.timestamp)
    .sort((a, b) => a - b)

  const confirmedSlots: number[] = []
  const mergedDayTimeline: number[] = [...dayItems]

  let safetyLoop = 0
  const maxIterations = maxSlots * 10

  while (confirmedSlots.length < maxSlots && safetyLoop++ < maxIterations) {
    const jMs = getJitterMs()
    const candidates: number[] = []

    // 候选 1：当天起始点 (07:30 + 微扰，或者有效起点)
    if (mergedDayTimeline.length === 0) {
      candidates.push(effectiveDayStart + jMs)
    } else {
      candidates.push(effectiveDayStart)
      candidates.push(effectiveDayStart + jMs)
    }

    // 候选 2：在当天各已有节点之后 (+ interval + jitter)
    for (const ts of mergedDayTimeline) {
      const nextTime = ts + intervalMs + jMs
      if (nextTime <= dayEnd) {
        candidates.push(nextTime)
      }
    }

    // 候选 3：在当天各已有节点之前 (- interval - jitter)
    for (const ts of mergedDayTimeline) {
      const prevTime = ts - intervalMs - jMs
      if (prevTime >= effectiveDayStart) {
        candidates.push(prevTime)
      }
    }

    // 过滤落在合法窗口内，且 >= effectiveDayStart 且 <= dayEnd 的候选
    const sortedCandidates = Array.from(new Set(candidates))
      .filter((ts) => ts >= effectiveDayStart && ts <= dayEnd && !isQuietHour(new Date(ts)))
      .sort((a, b) => a - b)

    let pickedSlot: number | null = null

    for (const candTs of sortedCandidates) {
      let prevTs: number | null = null
      let nextTs: number | null = null

      for (const t of mergedDayTimeline) {
        if (t < candTs) {
          prevTs = t
        } else if (t > candTs) {
          nextTs = t
          break
        } else {
          prevTs = t
          nextTs = t
          break
        }
      }

      if (prevTs === candTs || nextTs === candTs) continue

      // 前后间隔校验
      if (prevTs !== null && candTs - prevTs < intervalMs) continue
      if (nextTs !== null && nextTs - candTs < intervalMs) continue

      // 与最近即时发帖校验
      if (isToday && safeLastTweetSentAt > 0 && candTs > safeLastTweetSentAt && candTs - safeLastTweetSentAt < intervalMs) continue

      // 与已确认插槽间隔校验
      const lastConfirmed = confirmedSlots[confirmedSlots.length - 1]
      if (lastConfirmed !== undefined && Math.abs(candTs - lastConfirmed) < intervalMs) continue

      pickedSlot = candTs
      break
    }

    if (pickedSlot !== null) {
      confirmedSlots.push(pickedSlot)
      mergedDayTimeline.push(pickedSlot)
      mergedDayTimeline.sort((a, b) => a - b)
    } else {
      // 若已有候选都插不进去了，检查最后一条之后是否还能按步长继续追加
      const lastTs = mergedDayTimeline.length > 0
        ? mergedDayTimeline[mergedDayTimeline.length - 1]
        : effectiveDayStart
      const nextTs = lastTs + intervalMs + jMs
      if (nextTs <= dayEnd && !isQuietHour(new Date(nextTs))) {
        confirmedSlots.push(nextTs)
        mergedDayTimeline.push(nextTs)
        mergedDayTimeline.sort((a, b) => a - b)
      } else {
        break
      }
    }
  }

  return confirmedSlots.sort((a, b) => a - b).map((ts) => new Date(ts))
}

/**
 * 从发帖安排表弹窗中获取当前选定的目标日期（年、月、日）
 */
export function getSelectedDateFromModal(modal: Element): Date {
  const { selYear, selMonth, selDay } = extractSelectsFromModal(modal)
  if (selYear?.value && selMonth?.value && selDay?.value) {
    const y = parseInt(selYear.value, 10)
    const m = parseInt(selMonth.value, 10) - 1
    const d = parseInt(selDay.value, 10)
    const dt = new Date(y, m, d, 0, 0, 0, 0)
    if (!isNaN(dt.getTime())) return dt
  }
  const dateInput = modal.querySelector('input[type="date"]') as HTMLInputElement | null
  if (dateInput?.value) {
    const [y, m, d] = dateInput.value.split('-').map(Number)
    const dt = new Date(y, m - 1, d, 0, 0, 0, 0)
    if (!isNaN(dt.getTime())) return dt
  }
  return new Date()
}

/**
 * 智能提取“安排表”弹窗中的年月日時分 5 个原生 select 元素（以及可选的 AM/PM）
 */
export function extractSelectsFromModal(modal: Element): {
  selYear: HTMLSelectElement | null
  selMonth: HTMLSelectElement | null
  selDay: HTMLSelectElement | null
  selHour: HTMLSelectElement | null
  selMinute: HTMLSelectElement | null
  selAmPm: HTMLSelectElement | null
} {
  const selects = Array.from(modal.querySelectorAll<HTMLSelectElement>('select'))

  let selYear: HTMLSelectElement | null = null
  let selMonth: HTMLSelectElement | null = null
  let selDay: HTMLSelectElement | null = null
  let selHour: HTMLSelectElement | null = null
  let selMinute: HTMLSelectElement | null = null
  let selAmPm: HTMLSelectElement | null = null

  for (const sel of selects) {
    const labelId = sel.getAttribute('aria-labelledby')
    const labelEl = labelId ? modal.querySelector(`#${labelId}`) : null
    const text = (
      labelEl?.textContent ||
      sel.getAttribute('aria-label') ||
      sel.closest('div')?.querySelector('label')?.textContent ||
      sel.parentElement?.querySelector('label')?.textContent ||
      ''
    ).trim().toLowerCase()

    if (text.includes('年') || text.includes('year')) {
      selYear = sel
    } else if (text.includes('月') || text.includes('month')) {
      selMonth = sel
    } else if (text.includes('日') || text.includes('day')) {
      selDay = sel
    } else if (text.includes('时') || text.includes('hour')) {
      selHour = sel
    } else if (text.includes('分') || text.includes('minute') || text.includes('min')) {
      selMinute = sel
    } else if (text.includes('am') || text.includes('pm') || text.includes('上午') || text.includes('下午')) {
      selAmPm = sel
    }
  }

  // 兜底推断：通过 role="group" 或 aria-label 分组推断
  if (!selYear || !selMonth || !selDay) {
    const dateGroup = modal.querySelector('[aria-label*="日期"], [aria-label*="Date"], [aria-label*="date"]')
    if (dateGroup) {
      const dateSelects = Array.from(dateGroup.querySelectorAll<HTMLSelectElement>('select'))
      if (dateSelects.length === 3) {
        if (!selMonth) selMonth = dateSelects[0]
        if (!selDay) selDay = dateSelects[1]
        if (!selYear) selYear = dateSelects[2]
      }
    }
  }

  if (!selHour || !selMinute) {
    const timeGroup = modal.querySelector('[aria-label*="时间"], [aria-label*="Time"], [aria-label*="time"]')
    if (timeGroup) {
      const timeSelects = Array.from(timeGroup.querySelectorAll<HTMLSelectElement>('select'))
      if (timeSelects.length >= 2) {
        if (!selHour) selHour = timeSelects[0]
        if (!selMinute) selMinute = timeSelects[1]
        if (timeSelects.length >= 3 && !selAmPm) selAmPm = timeSelects[2]
      }
    }
  }

  // 3. 兼容历史硬编码 ID（如部分轻量单元测试环境）
  if (!selYear) selYear = modal.querySelector<HTMLSelectElement>('#SELECTOR_3')
  if (!selMonth) selMonth = modal.querySelector<HTMLSelectElement>('#SELECTOR_1')
  if (!selDay) selDay = modal.querySelector<HTMLSelectElement>('#SELECTOR_2')
  if (!selHour) selHour = modal.querySelector<HTMLSelectElement>('#SELECTOR_4')
  if (!selMinute) selMinute = modal.querySelector<HTMLSelectElement>('#SELECTOR_5')

  // 若正好有 5 个 select 且依然缺失，按标准 DOM 顺序兜底 [月, 日, 年, 时, 分]
  if (selects.length === 5) {
    if (!selMonth) selMonth = selects[0]
    if (!selDay) selDay = selects[1]
    if (!selYear) selYear = selects[2]
    if (!selHour) selHour = selects[3]
    if (!selMinute) selMinute = selects[4]
  }

  return { selYear, selMonth, selDay, selHour, selMinute, selAmPm }
}

export function setSelectValueSafely(select: HTMLSelectElement, targetValue: number | string): boolean {
  if (!select) return false
  const strVal = String(targetValue)
  const numVal = typeof targetValue === 'number' ? targetValue : parseInt(targetValue, 10)
  const padStrVal = !isNaN(numVal) && numVal < 10 ? `0${numVal}` : strVal

  let matched = Array.from(select.options).find((opt) => {
    if (opt.value === strVal || opt.value === padStrVal) return true
    if (!isNaN(numVal) && parseInt(opt.value, 10) === numVal) return true
    return false
  })

  if (!matched) {
    matched = Array.from(select.options).find((opt) => {
      const text = opt.text.trim().toLowerCase()
      if (text === strVal || text === padStrVal) return true
      if (!isNaN(numVal) && parseInt(text, 10) === numVal) return true
      if (text.startsWith(strVal)) return true
      return false
    })
  }

  if (matched) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
    if (nativeSetter) {
      nativeSetter.call(select, matched.value)
    } else {
      select.value = matched.value
    }
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  return false
}

export function setInputValueSafely(input: HTMLInputElement, value: string): void {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  if (nativeSetter) {
    nativeSetter.call(input, value)
  } else {
    input.value = value
  }
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

export function applySmartScheduleTimeToModal(modal: Element, targetDate: Date): boolean {
  const { selYear, selMonth, selDay, selHour, selMinute, selAmPm } = extractSelectsFromModal(modal)
  let updated = false

  const y = targetDate.getFullYear()
  const m = targetDate.getMonth() + 1
  const d = targetDate.getDate()
  const h24 = targetDate.getHours()
  const min = targetDate.getMinutes()

  if (selYear && setSelectValueSafely(selYear, y)) updated = true
  if (selMonth && setSelectValueSafely(selMonth, m)) updated = true
  if (selDay && setSelectValueSafely(selDay, d)) updated = true

  if (selHour) {
    if (selAmPm) {
      const h12 = h24 % 12 || 12
      const isPm = h24 >= 12
      if (setSelectValueSafely(selHour, h12)) updated = true
      if (setSelectValueSafely(selAmPm, isPm ? 'pm' : 'am')) updated = true
    } else {
      if (setSelectValueSafely(selHour, h24)) updated = true
    }
  }

  if (selMinute && setSelectValueSafely(selMinute, min)) updated = true

  const dateInput = modal.querySelector<HTMLInputElement>('input[type="date"]')
  const timeInput = modal.querySelector<HTMLInputElement>('input[type="time"]')
  if (dateInput) {
    const yStr = String(y)
    const mStr = String(m).padStart(2, '0')
    const dStr = String(d).padStart(2, '0')
    setInputValueSafely(dateInput, `${yStr}-${mStr}-${dStr}`)
    updated = true
  }
  if (timeInput) {
    const hStr = String(h24).padStart(2, '0')
    const minStr = String(min).padStart(2, '0')
    setInputValueSafely(timeInput, `${hStr}:${minStr}`)
    updated = true
  }

  return updated
}

/**
 * 构建排期全景智能控制栏 HTML（轻量半透明椭圆胶囊风格，内嵌左半圆上一个、中间智能排期、右半圆下一个）
 */
export function buildSmartSchedulerBarHtml(options: {
  intervalMinutes?: number
  secondaryTextColor?: string
  appliedStatusText?: string
} = {}): string {
  const intervalMinutes = options.intervalMinutes ?? getStoredSmartInterval()
  const secondaryTextColor = options.secondaryTextColor || '#536471'
  const intervalLabel = formatSmartIntervalLabel(intervalMinutes)
  const isApplied = !!options.appliedStatusText
  const btnText = '智能排期'
  const capsuleBg = isApplied ? 'rgba(16, 185, 129, 0.16)' : 'rgba(29, 155, 240, 0.12)'
  const capsuleBorder = isApplied ? 'rgba(16, 185, 129, 0.38)' : 'rgba(29, 155, 240, 0.32)'
  const activeColor = isApplied ? '#10b981' : 'rgb(29, 155, 240)'
  const sliderPct = (((intervalMinutes - 30) / (240 - 30)) * 100).toFixed(1)

  return `
    <div class="xf-smart-scheduler-bar" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; margin-bottom: 8px; border-radius: 8px; background: rgba(29, 155, 240, 0.08); border: 1px solid rgba(29, 155, 240, 0.22); box-sizing: border-box;">
      <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;">
        <span style="font-size: 11px; font-weight: 600; color: ${secondaryTextColor}; white-space: nowrap; flex-shrink: 0;">间隔</span>
        <input type="range" class="xf-smart-interval-slider" min="30" max="240" step="15" value="${intervalMinutes}" style="--slider-pct: ${sliderPct}%; flex: 1; min-width: 50px; max-width: 105px; height: 6px; cursor: pointer; accent-color: rgb(29, 155, 240); background: linear-gradient(to right, rgb(29, 155, 240) 0%, rgb(29, 155, 240) ${sliderPct}%, rgba(29, 155, 240, 0.22) ${sliderPct}%, rgba(29, 155, 240, 0.22) 100%); border-radius: 9999px;" title="调节发帖间隔 (0.5h 至 4h)">
        <span class="xf-smart-interval-badge" style="font-size: 11px; font-weight: 700; color: rgb(29, 155, 240); background: rgba(29, 155, 240, 0.16); padding: 1px 5px; border-radius: 4px; min-width: 42px; text-align: center; font-variant-numeric: tabular-nums; flex-shrink: 0;">${intervalLabel}</span>
      </div>

      <!-- 操场跑道形（Stadium Pill）轻量半透明一体化全局智能排期按钮 -->
      <div style="display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;">
        <div class="xf-smart-capsule-group" style="display: inline-flex; align-items: center; height: 26px; line-height: 26px; border-radius: 9999px; background: ${capsuleBg}; border: 1px solid ${capsuleBorder}; box-sizing: border-box; user-select: none; transition: all 0.2s ease;">
          <button class="xf-smart-slot-prev-btn" aria-label="上一个空档" title="定位到全局上一个可排期空档" style="border: none; background: transparent; cursor: pointer; height: 100%; padding: 0 4px 0 6px; border-top-left-radius: 9999px; border-bottom-left-radius: 9999px; color: ${activeColor}; display: inline-flex; align-items: center; justify-content: center; transition: background-color 0.15s ease, opacity 0.15s ease;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display: block; pointer-events: none;">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <span style="width: 1px; height: 11px; background: rgba(29, 155, 240, 0.22); flex-shrink: 0;"></span>
          <button class="xf-smart-schedule-apply-btn" aria-label="智能排期" title="全局自动寻找最近可用空档（每次点击自动设定为下一个契合时间点）" style="border: none; background: transparent; cursor: pointer; height: 100%; padding: 0 4px; color: ${activeColor}; font-size: 12px; font-weight: 600; white-space: nowrap; transition: color 0.15s ease;">
            <span class="xf-smart-btn-text">${btnText}</span>
          </button>
          <span style="width: 1px; height: 11px; background: rgba(29, 155, 240, 0.22); flex-shrink: 0;"></span>
          <button class="xf-smart-slot-next-btn" aria-label="下一个空档" title="定位到全局下一个可排期空档" style="border: none; background: transparent; cursor: pointer; height: 100%; padding: 0 6px 0 4px; border-top-right-radius: 9999px; border-bottom-right-radius: 9999px; color: ${activeColor}; display: inline-flex; align-items: center; justify-content: center; transition: background-color 0.15s ease, opacity 0.15s ease;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display: block; pointer-events: none;">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        </div>

        <!-- 操场跑道形（Stadium Pill）轻量半透明一体化当日排期按钮组 -->
        <div class="xf-day-capsule-group" style="display: inline-flex; align-items: center; height: 26px; line-height: 26px; border-radius: 9999px; background: rgba(29, 155, 240, 0.12); border: 1px solid rgba(29, 155, 240, 0.32); box-sizing: border-box; user-select: none; transition: all 0.2s ease;">
          <button class="xf-day-slot-prev-btn" aria-label="当日上一个空档" title="定位到当天的上一个可用空档" style="border: none; background: transparent; cursor: pointer; height: 100%; padding: 0 4px 0 6px; border-top-left-radius: 9999px; border-bottom-left-radius: 9999px; color: rgb(29, 155, 240); display: inline-flex; align-items: center; justify-content: center; transition: background-color 0.15s ease, opacity 0.15s ease;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display: block; pointer-events: none;">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <span style="width: 1px; height: 11px; background: rgba(29, 155, 240, 0.22); flex-shrink: 0;"></span>
          <button class="xf-day-schedule-apply-btn" aria-label="当日排期" title="仅在上方选定的日期内智能寻找空档（每次点击自动切换当天下一个契合时间点）" style="border: none; background: transparent; cursor: pointer; height: 100%; padding: 0 4px; color: rgb(29, 155, 240); font-size: 12px; font-weight: 600; white-space: nowrap; transition: color 0.15s ease;">
            <span class="xf-day-btn-text">当日排期</span>
          </button>
          <span style="width: 1px; height: 11px; background: rgba(29, 155, 240, 0.22); flex-shrink: 0;"></span>
          <button class="xf-day-slot-next-btn" aria-label="当日下一个空档" title="定位到当天的下一个可用空档" style="border: none; background: transparent; cursor: pointer; height: 100%; padding: 0 6px 0 4px; border-top-right-radius: 9999px; border-bottom-right-radius: 9999px; color: rgb(29, 155, 240); display: inline-flex; align-items: center; justify-content: center; transition: background-color 0.15s ease, opacity 0.15s ease;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display: block; pointer-events: none;">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `
}

export function bindSmartSchedulerControls(
  modal: HTMLElement,
  container: HTMLElement,
  cachedItems: any[]
): void {
  const bar = container.querySelector<HTMLElement>('.xf-smart-scheduler-bar')
  if (!bar) return

  const slider = bar.querySelector<HTMLInputElement>('.xf-smart-interval-slider')
  const badge = bar.querySelector<HTMLElement>('.xf-smart-interval-badge')
  const capsuleGroup = bar.querySelector<HTMLElement>('.xf-smart-capsule-group')
  const applyBtn = bar.querySelector<HTMLButtonElement>('.xf-smart-schedule-apply-btn')
  const prevBtn = bar.querySelector<HTMLButtonElement>('.xf-smart-slot-prev-btn')
  const nextBtn = bar.querySelector<HTMLButtonElement>('.xf-smart-slot-next-btn')

  // 滑块事件监听
  if (slider && badge && !(slider as any).__xf_bound) {
    ;(slider as any).__xf_bound = true

    const updateSliderVisual = (val: number) => {
      const pct = (((val - 30) / (240 - 30)) * 100).toFixed(1)
      slider.style.setProperty('--slider-pct', `${pct}%`)
      slider.style.background = `linear-gradient(to right, rgb(29, 155, 240) 0%, rgb(29, 155, 240) ${pct}%, rgba(29, 155, 240, 0.22) ${pct}%, rgba(29, 155, 240, 0.22) 100%)`
    }

    const initVal = parseInt(slider.value, 10)
    if (!isNaN(initVal)) {
      updateSliderVisual(initVal)
    }

    const updateLabelAndStore = (val: number) => {
      updateSliderVisual(val)
      badge.textContent = formatSmartIntervalLabel(val)
      saveStoredSmartInterval(val)
      ;(container as any).__xf_smart_interval = val
      // 重置计算的插槽缓存，重新生成
      ;(container as any).__xf_cached_slots = null
      ;(container as any).__xf_slot_index = 0
      ;(container as any).__xf_has_applied = false
      ;(container as any).__xf_cached_day_slots = null
      ;(container as any).__xf_day_slot_index = 0
      ;(container as any).__xf_day_has_applied = false
    }

    slider.addEventListener('input', (e) => {
      e.stopPropagation()
      const val = parseInt(slider.value, 10)
      if (!isNaN(val)) updateLabelAndStore(val)
    })

    slider.addEventListener('change', (e) => {
      e.stopPropagation()
      const val = parseInt(slider.value, 10)
      if (!isNaN(val)) updateLabelAndStore(val)
    })
  }

  // 胶囊组件核心调度
  if (capsuleGroup && !(capsuleGroup as any).__xf_bound) {
    ;(capsuleGroup as any).__xf_bound = true

    const getSlots = (minRequiredCount: number = 30) => {
      const currentInterval = slider
        ? parseInt(slider.value, 10)
        : getStoredSmartInterval()
      const lastTweetSentAt = getLastTweetSentAtSync()
      let cached = (container as any).__xf_cached_slots as Date[] | null
      const cachedInterval = (container as any).__xf_cached_interval
      const cachedLastSent = (container as any).__xf_cached_last_sent_at
      if (
        !cached ||
        cachedInterval !== currentInterval ||
        cachedLastSent !== lastTweetSentAt ||
        cached.length < minRequiredCount
      ) {
        const targetCount = Math.max(30, minRequiredCount)
        const items = (container as any).__xf_items_for_scheduler || cachedItems
        cached = computeSmartScheduleSlots(items, currentInterval, new Date(), undefined, targetCount, lastTweetSentAt)
        ;(container as any).__xf_cached_slots = cached
        ;(container as any).__xf_cached_interval = currentInterval
        ;(container as any).__xf_cached_last_sent_at = lastTweetSentAt
      }
      return cached
    }

    const updateNavArrows = (idx: number, total: number) => {
      if (prevBtn) {
        prevBtn.style.opacity = idx <= 0 ? '0.35' : '1'
        prevBtn.style.cursor = idx <= 0 ? 'not-allowed' : 'pointer'
      }
      if (nextBtn) {
        // 支持无缝动态增量扩容，只要未来时间线有效，右箭头保持可用高亮
        const hasNext = total > 0
        nextBtn.style.opacity = hasNext ? '1' : '0.35'
        nextBtn.style.cursor = hasNext ? 'pointer' : 'not-allowed'
      }
    }

    let revertTimer: any = null
    const applySlotAtIndex = (idx: number) => {
      let slots = getSlots(idx + 5)
      if (!slots || slots.length === 0) return

      if (idx >= slots.length) {
        slots = getSlots(idx + 20)
      }
      const safeIdx = Math.max(0, Math.min(idx, slots.length - 1))
      ;(container as any).__xf_slot_index = safeIdx
      const targetDate = slots[safeIdx]
      const successText = formatShortSlotLabel(targetDate)

      updateNavArrows(safeIdx, slots.length)

      ;(container as any).__xf_applied_status = {
        text: successText,
        expire: Date.now() + 1500,
        idx: safeIdx,
      }

      if (capsuleGroup) {
        capsuleGroup.style.background = 'rgba(16, 185, 129, 0.16)'
        capsuleGroup.style.borderColor = 'rgba(16, 185, 129, 0.38)'
      }
      if (applyBtn) applyBtn.style.color = '#10b981'
      if (prevBtn) prevBtn.style.color = '#10b981'
      if (nextBtn) nextBtn.style.color = '#10b981'

      applySmartScheduleTimeToModal(modal, targetDate)

      if (revertTimer) clearTimeout(revertTimer)
      revertTimer = setTimeout(() => {
        ;(container as any).__xf_applied_status = null
        if (capsuleGroup) {
          capsuleGroup.style.background = 'rgba(29, 155, 240, 0.12)'
          capsuleGroup.style.borderColor = 'rgba(29, 155, 240, 0.32)'
        }
        if (applyBtn) applyBtn.style.color = 'rgb(29, 155, 240)'
        if (prevBtn) prevBtn.style.color = 'rgb(29, 155, 240)'
        if (nextBtn) nextBtn.style.color = 'rgb(29, 155, 240)'
      }, 1500)
    }

    // 初始化时同步箭头状态
    const initIdx = typeof (container as any).__xf_slot_index === 'number' ? (container as any).__xf_slot_index : 0
    updateNavArrows(initIdx, getSlots().length)

    // 中间主按钮点击：初次填充首个推荐空档；后续每次点击与右侧箭头一致，自动设定为下一次契合时间点（增量扩容）
    applyBtn?.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const hasApplied = Boolean((container as any).__xf_has_applied)
      const currentIdx = typeof (container as any).__xf_slot_index === 'number' ? (container as any).__xf_slot_index : 0
      if (!hasApplied) {
        ;(container as any).__xf_has_applied = true
        applySlotAtIndex(currentIdx)
      } else {
        applySlotAtIndex(currentIdx + 1)
      }
    })

    // 左半圆：切换到上一个空档
    prevBtn?.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const currentIdx = typeof (container as any).__xf_slot_index === 'number' ? (container as any).__xf_slot_index : 0
      if (currentIdx > 0) {
        ;(container as any).__xf_has_applied = true
        applySlotAtIndex(currentIdx - 1)
      }
    })

    // 右半圆：切换到下一个空档（支持动态增量扩容，绝不被截断）
    nextBtn?.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      ;(container as any).__xf_has_applied = true
      const currentIdx = typeof (container as any).__xf_slot_index === 'number' ? (container as any).__xf_slot_index : 0
      applySlotAtIndex(currentIdx + 1)
    })
  }

  // 独立【当日排期】操场跑道胶囊组件调度（支持前调/后调箭头的完整双向步进）
  const dayCapsuleGroup = container.querySelector<HTMLElement>('.xf-day-capsule-group')
  const dayBtn = container.querySelector<HTMLButtonElement>('.xf-day-schedule-apply-btn')
  const dayPrevBtn = container.querySelector<HTMLButtonElement>('.xf-day-slot-prev-btn')
  const dayNextBtn = container.querySelector<HTMLButtonElement>('.xf-day-slot-next-btn')

  if (dayCapsuleGroup && !(dayCapsuleGroup as any).__xf_bound) {
    ;(dayCapsuleGroup as any).__xf_bound = true

    const getDaySlots = () => {
      const currentInterval = slider
        ? parseInt(slider.value, 10)
        : getStoredSmartInterval()
      const targetDay = getSelectedDateFromModal(modal)
      const dayKey = `${targetDay.getFullYear()}-${targetDay.getMonth() + 1}-${targetDay.getDate()}`
      const lastTweetSentAt = getLastTweetSentAtSync()

      let cachedSlots: Date[] = (container as any).__xf_cached_day_slots
      let cachedDayKey: string = (container as any).__xf_cached_day_key
      let cachedInterval: number = (container as any).__xf_cached_day_interval
      let cachedLastSent: number = (container as any).__xf_cached_day_last_sent_at

      if (
        !cachedSlots ||
        cachedDayKey !== dayKey ||
        cachedInterval !== currentInterval ||
        cachedLastSent !== lastTweetSentAt
      ) {
        const items = (container as any).__xf_items_for_scheduler || cachedItems
        cachedSlots = computeDayScheduleSlots(items, targetDay, currentInterval, new Date(), undefined, 8, lastTweetSentAt)
        ;(container as any).__xf_cached_day_slots = cachedSlots
        ;(container as any).__xf_cached_day_key = dayKey
        ;(container as any).__xf_cached_day_interval = currentInterval
        ;(container as any).__xf_cached_day_last_sent_at = lastTweetSentAt
        ;(container as any).__xf_day_slot_index = -1
      }
      return cachedSlots
    }

    const updateDayNavArrows = (idx: number, total: number) => {
      if (dayPrevBtn) {
        const canPrev = total > 0 && idx > 0
        dayPrevBtn.style.opacity = canPrev ? '1' : '0.35'
        dayPrevBtn.style.cursor = canPrev ? 'pointer' : 'not-allowed'
      }
      if (dayNextBtn) {
        const canNext = total > 0 && idx < total - 1
        dayNextBtn.style.opacity = canNext ? '1' : '0.35'
        dayNextBtn.style.cursor = canNext ? 'pointer' : 'not-allowed'
      }
    }

    let revertTimer: any = null
    const applyDaySlotAtIndex = (targetIdx: number) => {
      const slots = getDaySlots()
      const textEl = dayBtn?.querySelector('.xf-day-btn-text')

      if (!slots || slots.length === 0) {
        if (dayCapsuleGroup) {
          dayCapsuleGroup.style.background = 'rgba(245, 158, 11, 0.16)'
          dayCapsuleGroup.style.borderColor = 'rgba(245, 158, 11, 0.38)'
        }
        if (dayBtn) dayBtn.style.color = '#f59e0b'
        if (dayPrevBtn) dayPrevBtn.style.color = '#f59e0b'
        if (dayNextBtn) dayNextBtn.style.color = '#f59e0b'
        updateDayNavArrows(-1, 0)

        if (revertTimer) clearTimeout(revertTimer)
        revertTimer = setTimeout(() => {
          if (dayCapsuleGroup) {
            dayCapsuleGroup.style.background = 'rgba(29, 155, 240, 0.12)'
            dayCapsuleGroup.style.borderColor = 'rgba(29, 155, 240, 0.32)'
          }
          if (dayBtn) dayBtn.style.color = 'rgb(29, 155, 240)'
          if (dayPrevBtn) dayPrevBtn.style.color = 'rgb(29, 155, 240)'
          if (dayNextBtn) dayNextBtn.style.color = 'rgb(29, 155, 240)'
        }, 1500)
        return
      }

      const safeIdx = Math.max(0, Math.min(targetIdx, slots.length - 1))
      ;(container as any).__xf_day_slot_index = safeIdx

      const safeSlot = slots[safeIdx]
      applySmartScheduleTimeToModal(modal, safeSlot)

      updateDayNavArrows(safeIdx, slots.length)

      const timeStr = dayjs(safeSlot).format('HH:mm')
      const successText = `已排 ${timeStr}`

      if (dayCapsuleGroup) {
        dayCapsuleGroup.style.background = 'rgba(16, 185, 129, 0.16)'
        dayCapsuleGroup.style.borderColor = 'rgba(16, 185, 129, 0.38)'
      }
      if (dayBtn) dayBtn.style.color = '#10b981'
      if (dayPrevBtn) dayPrevBtn.style.color = '#10b981'
      if (dayNextBtn) dayNextBtn.style.color = '#10b981'

      ;(container as any).__xf_applied_day_status = {
        text: successText,
        expire: Date.now() + 1500,
        idx: safeIdx,
      }

      if (revertTimer) clearTimeout(revertTimer)
      revertTimer = setTimeout(() => {
        ;(container as any).__xf_applied_day_status = null
        if (dayCapsuleGroup) {
          dayCapsuleGroup.style.background = 'rgba(29, 155, 240, 0.12)'
          dayCapsuleGroup.style.borderColor = 'rgba(29, 155, 240, 0.32)'
        }
        if (dayBtn) dayBtn.style.color = 'rgb(29, 155, 240)'
        if (dayPrevBtn) dayPrevBtn.style.color = 'rgb(29, 155, 240)'
        if (dayNextBtn) dayNextBtn.style.color = 'rgb(29, 155, 240)'
      }, 1500)
    }

    // 初始化同步箭头可用状态
    const initIdx = typeof (container as any).__xf_day_slot_index === 'number'
      ? (container as any).__xf_day_slot_index
      : 0
    updateDayNavArrows(initIdx, getDaySlots().length)

    // 左箭头：切换到当日上一个空档
    dayPrevBtn?.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const slots = getDaySlots()
      if (!slots || slots.length === 0) return
      const currentIdx = typeof (container as any).__xf_day_slot_index === 'number'
        ? (container as any).__xf_day_slot_index
        : 0
      if (currentIdx > 0) {
        ;(container as any).__xf_day_has_applied = true
        applyDaySlotAtIndex(currentIdx - 1)
      }
    })

    // 右箭头：切换到当日下一个空档
    dayNextBtn?.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const slots = getDaySlots()
      if (!slots || slots.length === 0) return
      ;(container as any).__xf_day_has_applied = true
      const currentIdx = typeof (container as any).__xf_day_slot_index === 'number'
        ? (container as any).__xf_day_slot_index
        : 0
      if (currentIdx < slots.length - 1) {
        applyDaySlotAtIndex(currentIdx + 1)
      }
    })

    // 中间主按钮点击：初次填充当天首个推荐空档；后续每次点击与右侧箭头一致，自动设定为当天下一个契合时间点
    dayBtn?.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const slots = getDaySlots()
      if (!slots || slots.length === 0) {
        applyDaySlotAtIndex(0)
        return
      }
      const hasApplied = Boolean((container as any).__xf_day_has_applied)
      const currentIdx = typeof (container as any).__xf_day_slot_index === 'number'
        ? (container as any).__xf_day_slot_index
        : 0
      if (!hasApplied) {
        ;(container as any).__xf_day_has_applied = true
        applyDaySlotAtIndex(currentIdx)
      } else {
        const nextIdx = (currentIdx + 1) % slots.length
        applyDaySlotAtIndex(nextIdx)
      }
    })
  }
}
