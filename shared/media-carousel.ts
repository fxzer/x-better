/**
 * 推文多图轮播（ScrollSnap-List）纯计算与惯性物理模块：
 * 模拟移动端/Mac 触摸板的指数减速曲线（0.998/ms）与释放速度估算，提供无子像素丢精度的进度计算。
 */

export const CAROUSEL_BOUND_ATTR = 'data-xf-carousel-bound'
export const CAROUSEL_SWIPING_ATTR = 'data-xf-carousel-swiping'
export const CAROUSEL_BAR_CLASS = 'xf-carousel-bar'
export const CAROUSEL_SWIPING_BODY_CLASS = 'xf-carousel-swiping'

/** 触发横向滑动的最小水平位移（px）；小于该值视为正常点击看大图 */
export const CAROUSEL_DRAG_THRESHOLD = 4
/** 超过此闲置时间再松手时不赋予初速度（防止明确停住后再松开意外滑跑） */
export const CAROUSEL_STALE_RELEASE_MS = 155
/** 滚动速度采样的回溯窗口（ms） */
export const CAROUSEL_VELOCITY_WINDOW_MS = 120
/** 最高初始滚动初速度上限（px/ms） */
export const CAROUSEL_MAX_VELOCITY = 8.0
/** 启动惯性滑行的最小速度阈值（px/ms） */
export const CAROUSEL_MIN_INERTIA_VELOCITY = 0.05
/** 惯性停止的速度阈值（px/ms） */
export const CAROUSEL_STOP_VELOCITY = 0.025
/** 甩手惯性增益系数（补偿桌面鼠标相对触屏较短的挥动行程） */
export const CAROUSEL_FLING_GAIN = 1.85
/** 每 16.67ms 参考帧下的指数摩擦系数（贴近 macOS 触摸板丝滑长滑行阻尼） */
export const CAROUSEL_FRICTION_PER_FRAME = 0.972

export interface PointerSample {
  x: number
  time: number
}

export interface CarouselProgress {
  scrollable: boolean
  maxScroll: number
  ratio: number
  currentIndex: number
  total: number
}

/** 将滚动比例夹紧到 [0, 1] */
export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** 计算当前多图轮播进度与等价页码（1..total） */
export function computeCarouselProgress(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
  itemCount: number,
): CarouselProgress {
  const maxScroll = Math.max(0, scrollWidth - clientWidth)
  const total = Math.max(1, Math.floor(itemCount))
  if (maxScroll <= 8 || total <= 1) {
    return {
      scrollable: false,
      maxScroll: 0,
      ratio: 0,
      currentIndex: 1,
      total,
    }
  }

  const ratio = clampUnit(scrollLeft / maxScroll)
  let currentIndex: number
  if (scrollLeft <= 2) {
    currentIndex = 1
  } else if (scrollLeft >= maxScroll - 2) {
    currentIndex = total
  } else {
    currentIndex = Math.min(total, Math.max(1, Math.round(ratio * (total - 1)) + 1))
  }

  return {
    scrollable: true,
    maxScroll,
    ratio,
    currentIndex,
    total,
  }
}

/** 将底部滑条比例 [0, 1] 转换为容器 scrollLeft */
export function scrollLeftFromRatio(ratio: number, maxScroll: number): number {
  if (maxScroll <= 0) return 0
  return clampUnit(ratio) * maxScroll
}

/**
 * 根据滑动结束前的指针采样计算 scrollLeft 方向上的惯性初速度（px/ms）：
 * 回溯最新移动点前 110ms 窗口计算平均速度，并按松手前的短暂闲置衰减，
 * 避免物理鼠标抬指瞬间的几十毫秒停顿把惯性归零。
 */
export function computeScrollVelocity(
  samples: readonly PointerSample[],
  releaseTime: number,
): number {
  if (samples.length < 2) return 0

  // 剔除抬指瞬间 <= 1.5px 的微抖尾点，防止物理鼠标停顿微颤吞掉甩手初速度
  let endIdx = samples.length - 1
  while (
    endIdx >= 2 &&
    Math.abs(samples[endIdx].x - samples[endIdx - 1].x) <= 1.5 &&
    samples[endIdx].time - samples[endIdx - 1].time <= 35
  ) {
    endIdx--
  }

  const latest = samples[endIdx]
  const idleMs = Math.max(0, releaseTime - latest.time)
  if (idleMs > CAROUSEL_STALE_RELEASE_MS) {
    return 0
  }

  const cutoff = latest.time - CAROUSEL_VELOCITY_WINDOW_MS
  let anchor = samples[0]
  for (let i = endIdx - 1; i >= 0; i--) {
    anchor = samples[i]
    if (samples[i].time <= cutoff) break
  }

  const dt = latest.time - anchor.time
  if (dt < 4) return 0

  // 指针往左划（latest.x < anchor.x）时内容应向右滚动（scrollLeft 增大）
  // 35ms 内视为物理抬指固有延迟，不扣减初速度；之后平滑衰减
  const baseVelocity = -(latest.x - anchor.x) / dt
  const effectiveIdle = Math.max(0, idleMs - 35)
  const attenuation = Math.exp(-effectiveIdle / 180)
  const raw = baseVelocity * CAROUSEL_FLING_GAIN * attenuation
  if (!Number.isFinite(raw)) return 0
  return Math.max(-CAROUSEL_MAX_VELOCITY, Math.min(CAROUSEL_MAX_VELOCITY, raw))
}

/** 计算惯性动画单帧后的新位置与新速度（保持浮点累计，碰壁立即停止） */
export function stepCarouselInertia(
  virtualScrollLeft: number,
  velocity: number,
  maxScroll: number,
  dtMs: number,
): { nextScrollLeft: number; nextVelocity: number; done: boolean } {
  const clampedLeft = Math.min(maxScroll, Math.max(0, virtualScrollLeft))
  if (maxScroll <= 0 || Math.abs(velocity) < CAROUSEL_STOP_VELOCITY) {
    return {
      nextScrollLeft: clampedLeft,
      nextVelocity: 0,
      done: true,
    }
  }
  if (dtMs <= 0) {
    return {
      nextScrollLeft: clampedLeft,
      nextVelocity: velocity,
      done: false,
    }
  }

  const clampedDt = Math.min(48, Math.max(1, dtMs))
  const decay = Math.pow(CAROUSEL_FRICTION_PER_FRAME, clampedDt / 16.67)
  const avgVelocity = velocity * (0.5 + 0.5 * decay)
  const rawNext = virtualScrollLeft + avgVelocity * clampedDt
  const nextScrollLeft = Math.min(maxScroll, Math.max(0, rawNext))
  const hitBoundary = nextScrollLeft <= 0 || nextScrollLeft >= maxScroll
  const nextVelocity = hitBoundary ? 0 : velocity * decay
  const done = hitBoundary || Math.abs(nextVelocity) < CAROUSEL_STOP_VELOCITY

  return {
    nextScrollLeft,
    nextVelocity: done ? 0 : nextVelocity,
    done,
  }
}
