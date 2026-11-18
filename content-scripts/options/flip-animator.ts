/**
 * 原生 FLIP (First, Last, Invert, Play) 动画引擎
 * 用于列表在重新排序、插入、移动时提供原生级丝滑物理过渡效果
 */

export interface FlipAnimatorOptions {
  /** 排序过渡曲线，默认采用 Apple/Material 惯性减速曲线 */
  easing?: string
  /** 移动动画时长 (毫秒)，默认 320ms */
  moveDuration?: number
  /** 新入场元素淡入时长 (毫秒)，默认 260ms */
  enterDuration?: number
}

const DEFAULT_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)'
const DEFAULT_MOVE_DURATION = 320
const DEFAULT_ENTER_DURATION = 260

function nextFrame(cb: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(cb)
  } else if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(cb)
  } else {
    setTimeout(cb, 16)
  }
}

/**
 * First 阶段：在 DOM 结构更新前，捕获容器内所有带 data-sort-key 元素的物理纵向坐标
 */
export function captureFlipPositions(container: HTMLElement): Map<string, number> {
  const positions = new Map<string, number>()
  if (!container) return positions

  const items = container.querySelectorAll<HTMLElement>('[data-sort-key]')
  items.forEach((el) => {
    const key = el.dataset.sortKey
    if (key) {
      positions.set(key, el.getBoundingClientRect().top)
    }
  })
  return positions
}

/**
 * Last, Invert, Play 阶段：
 * 计算差值并以硬件加速 transform 平滑滑动归位
 */
export function playFlipAnimation(
  container: HTMLElement,
  firstPositions: Map<string, number>,
  options: FlipAnimatorOptions = {}
): void {
  if (!container || !firstPositions || firstPositions.size === 0) return

  const easing = options.easing || DEFAULT_EASING
  const moveDuration = options.moveDuration || DEFAULT_MOVE_DURATION
  const enterDuration = options.enterDuration || DEFAULT_ENTER_DURATION

  const items = container.querySelectorAll<HTMLElement>('[data-sort-key]')
  const movedElements: Array<{ el: HTMLElement; deltaY: number }> = []
  const enteredElements: HTMLElement[] = []

  items.forEach((el) => {
    const key = el.dataset.sortKey
    if (!key) return

    if (firstPositions.has(key)) {
      const firstTop = firstPositions.get(key)!
      const lastTop = el.getBoundingClientRect().top
      const deltaY = firstTop - lastTop

      // 消除亚像素渲染引起的极微小舍入抖动 (>= 1px 才视为实质位移)
      if (Math.abs(deltaY) >= 1) {
        // Invert: 瞬时偏移回旧位置，禁用过渡
        el.style.setProperty('transform', `translate3d(0, ${deltaY}px, 0)`, 'important')
        el.style.setProperty('transition', 'none', 'important')
        el.style.willChange = 'transform'
        movedElements.push({ el, deltaY })
      }
    } else {
      // 仅在已有列表中新插入的节点，给予微缩放和轻淡入入场动效
      el.style.setProperty('opacity', '0', 'important')
      el.style.setProperty('transform', 'scale(0.97) translate3d(0, -6px, 0)', 'important')
      el.style.setProperty('transition', 'none', 'important')
      el.style.willChange = 'transform, opacity'
      enteredElements.push(el)
    }
  })

  if (movedElements.length === 0 && enteredElements.length === 0) return

  // 强制触发重排 (Layout Reflow)，确保 Invert 状态被浏览器渲染引擎确认
  void container.offsetHeight

  // Play: 下一帧启用精修贝塞尔缓动，平滑滑向目标物理位置
  nextFrame(() => {
    movedElements.forEach(({ el }) => {
      el.style.setProperty('transition', `transform ${moveDuration}ms ${easing}`, 'important')
      el.style.setProperty('transform', 'translate3d(0, 0, 0)', 'important')

      const cleanup = () => {
        el.style.removeProperty('transform')
        el.style.removeProperty('transition')
        el.style.willChange = ''
        el.removeEventListener('transitionend', cleanup)
      }
      el.addEventListener('transitionend', cleanup, { once: true })
      setTimeout(cleanup, moveDuration + 60)
    })

    enteredElements.forEach((el) => {
      el.style.setProperty('transition', `transform ${enterDuration}ms ${easing}, opacity ${enterDuration}ms ease`, 'important')
      el.style.setProperty('transform', 'translate3d(0, 0, 0) scale(1)', 'important')
      el.style.setProperty('opacity', '1', 'important')

      const cleanup = () => {
        el.style.removeProperty('transform')
        el.style.removeProperty('transition')
        el.style.removeProperty('opacity')
        el.style.willChange = ''
        el.removeEventListener('transitionend', cleanup)
      }
      el.addEventListener('transitionend', cleanup, { once: true })
      setTimeout(cleanup, enterDuration + 60)
    })
  })
}
