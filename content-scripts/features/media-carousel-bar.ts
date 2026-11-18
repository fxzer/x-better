/**
 * 多图轮播底部进度控制条（UI 与零卡顿拖动定位逻辑）。
 * 提供轨道点击跳图、滑块 60fps 实时拖动、条上惯性滚轮横翻与差异化 DOM 更新。
 */

import {
  CAROUSEL_BAR_CLASS,
  CAROUSEL_BOUND_ATTR,
  CAROUSEL_SWIPING_ATTR,
  CAROUSEL_SWIPING_BODY_CLASS,
  clampUnit,
  computeCarouselProgress,
  scrollLeftFromRatio,
} from '../../shared/media-carousel'
import addStyles, { removeStyles, stylesExist } from '../utilities/addStyles'

const STYLE_ID = 'mediaCarouselSwipe'

export function ensureCarouselStyles() {
  if (stylesExist(STYLE_ID)) return
  addStyles(
    STYLE_ID,
    `
    [${CAROUSEL_BOUND_ATTR}="1"] {
      cursor: grab;
      scroll-snap-type: none !important;
      overscroll-behavior-x: contain;
      will-change: scroll-position;
      user-select: none;
      -webkit-user-select: none;
    }
    [${CAROUSEL_BOUND_ATTR}="1"] img,
    [${CAROUSEL_BOUND_ATTR}="1"] a {
      -webkit-user-drag: none !important;
      user-drag: none !important;
    }
    [${CAROUSEL_BOUND_ATTR}="1"][${CAROUSEL_SWIPING_ATTR}="1"] {
      scroll-snap-type: none !important;
      scroll-behavior: auto !important;
      cursor: grabbing !important;
    }
    [${CAROUSEL_BOUND_ATTR}="1"][${CAROUSEL_SWIPING_ATTR}="1"] > * {
      pointer-events: none !important;
    }
    html.${CAROUSEL_SWIPING_BODY_CLASS},
    html.${CAROUSEL_SWIPING_BODY_CLASS} * {
      cursor: grabbing !important;
      user-select: none !important;
      -webkit-user-select: none !important;
    }
    .${CAROUSEL_BAR_CLASS} {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      margin-top: 6px;
      padding: 2px;
      box-sizing: border-box;
      user-select: none;
      -webkit-user-select: none;
    }
    .${CAROUSEL_BAR_CLASS}[hidden] {
      display: none !important;
    }
    .xf-carousel-track {
      position: relative;
      flex: 1;
      height: 18px;
      display: flex;
      align-items: center;
      cursor: pointer;
      touch-action: none;
      outline: none;
    }
    .xf-carousel-rail {
      position: relative;
      width: 100%;
      height: 4px;
      border-radius: 1px;
      background: rgba(128, 128, 128, 0.28);
      overflow: hidden;
      transition: height 0.15s ease, border-radius 0.15s ease;
    }
    .xf-carousel-rail[data-segmented="1"] {
      -webkit-mask-image: repeating-linear-gradient(
        to right,
        #000 0,
        #000 calc((100% / var(--xf-segs, 1)) - 3px),
        transparent calc((100% / var(--xf-segs, 1)) - 3px),
        transparent calc(100% / var(--xf-segs, 1))
      );
      mask-image: repeating-linear-gradient(
        to right,
        #000 0,
        #000 calc((100% / var(--xf-segs, 1)) - 3px),
        transparent calc((100% / var(--xf-segs, 1)) - 3px),
        transparent calc(100% / var(--xf-segs, 1))
      );
      -webkit-mask-size: calc(100% + 3px) 100%;
      mask-size: calc(100% + 3px) 100%;
      -webkit-mask-position: left top;
      mask-position: left top;
      -webkit-mask-repeat: no-repeat;
      mask-repeat: no-repeat;
    }
    .xf-carousel-track:hover .xf-carousel-rail,
    .xf-carousel-track[data-scrubbing="1"] .xf-carousel-rail {
      height: 6px;
      border-radius: 1.5px;
    }
    .xf-carousel-fill {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 0%;
      border-radius: 0;
      background: rgb(29, 155, 240);
      pointer-events: none;
    }
    .xf-carousel-thumb {
      position: absolute;
      top: 50%;
      left: 0%;
      width: 12px;
      height: 12px;
      border-radius: 9999px;
      background: rgb(29, 155, 240);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
      transform: translate(-50%, -50%) scale(0.85);
      transition: transform 0.15s ease;
      pointer-events: none;
    }
    .xf-carousel-track:hover .xf-carousel-thumb,
    .xf-carousel-track[data-scrubbing="1"] .xf-carousel-thumb {
      transform: translate(-50%, -50%) scale(1.1);
    }
    .xf-carousel-counter {
      flex-shrink: 0;
      min-width: 42px;
      text-align: right;
      font: 600 11px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-variant-numeric: tabular-nums;
      color: rgb(113, 118, 123);
      letter-spacing: 0.02em;
    }
  `,
  )
}

export function removeCarouselStyles() {
  removeStyles(STYLE_ID)
}

export interface CarouselBinding {
  list: HTMLElement
  bar: HTMLElement
  rail: HTMLElement
  fill: HTMLElement
  thumb: HTMLElement
  counter: HTMLElement
  track: HTMLElement
  resizeObserver: ResizeObserver
  rafId: number | null
  dragRafId: number | null
  snapRestoreTimer: ReturnType<typeof setTimeout> | null
  lastCounterText: string
  lastIndexText: string
  lastSegments: number
}

export function cancelCarouselInertia(binding: CarouselBinding) {
  if (binding.rafId !== null) {
    cancelAnimationFrame(binding.rafId)
    binding.rafId = null
  }
  if (binding.dragRafId !== null) {
    cancelAnimationFrame(binding.dragRafId)
    binding.dragRafId = null
  }
  if (binding.snapRestoreTimer !== null) {
    clearTimeout(binding.snapRestoreTimer)
    binding.snapRestoreTimer = null
  }
}

function hasAspectSpacerChild(el: HTMLElement): boolean {
  return Array.from(el.children).some(
    (c) => c instanceof HTMLElement && c.children.length === 0 && /%/.test(c.style.paddingBottom || ''),
  )
}

/** 向上跳过 horizontal flex、绝对定位覆盖层和 padding-bottom 占位容器，把进度条准确挂到图片盒子正下方 */
export function findBarAnchor(list: HTMLElement): HTMLElement | null {
  const article = list.closest('article[data-testid="tweet"]')
  const initial = list.closest<HTMLElement>('[data-testid="ScrollSnap-SwipeableList"]') ?? list.parentElement
  if (!initial || !article?.contains(initial)) return null

  let anchor: HTMLElement = initial
  for (let i = 0; i < 6; i++) {
    const parent: HTMLElement | null = anchor.parentElement
    if (!parent || parent === article || !article.contains(parent)) break

    const anchorPos = window.getComputedStyle(anchor).position
    const parentCs = window.getComputedStyle(parent)
    const isRowFlex = parentCs.display === 'flex' && parentCs.flexDirection === 'row'
    const isAspectBox =
      anchorPos === 'absolute' || parentCs.position === 'absolute' || hasAspectSpacerChild(parent)

    if (isRowFlex || isAspectBox) {
      anchor = parent
    } else {
      break
    }
  }

  return anchor
}

/** 直接按已计算指标更新进度条（热循环中零布局重排读取） */
export function renderCarouselBarMetrics(
  binding: CarouselBinding,
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
  itemCount: number,
) {
  const { bar, rail, fill, thumb, counter, track } = binding
  const progress = computeCarouselProgress(scrollLeft, scrollWidth, clientWidth, itemCount)

  if (!progress.scrollable) {
    if (!bar.hidden) bar.hidden = true
    return
  }

  if (bar.hidden) bar.hidden = false
  if (binding.lastSegments !== progress.total) {
    binding.lastSegments = progress.total
    rail.style.setProperty('--xf-segs', String(progress.total))
    if (progress.total > 1) {
      rail.setAttribute('data-segmented', '1')
    } else {
      rail.removeAttribute('data-segmented')
    }
  }
  const pct = (progress.ratio * 100).toFixed(2)
  fill.style.width = `${pct}%`
  thumb.style.left = `${pct}%`

  const nextCounter = `${progress.currentIndex} / ${progress.total}`
  if (binding.lastCounterText !== nextCounter) {
    binding.lastCounterText = nextCounter
    counter.textContent = nextCounter
    track.setAttribute('aria-valuemax', String(progress.total))
  }

  const nextIdxStr = String(progress.currentIndex)
  if (binding.lastIndexText !== nextIdxStr) {
    binding.lastIndexText = nextIdxStr
    track.setAttribute('aria-valuenow', nextIdxStr)
  }
}

/** 根据容器当前滚动偏移刷新底部进度条及 `N / Total` 计数 */
export function syncCarouselBar(binding: CarouselBinding) {
  const { list } = binding
  if (!list.isConnected) return
  renderCarouselBarMetrics(
    binding,
    list.scrollLeft,
    list.scrollWidth,
    list.clientWidth,
    list.children.length,
  )
}

export function createCarouselBar(
  list: HTMLElement,
): Omit<CarouselBinding, 'resizeObserver' | 'rafId' | 'dragRafId' | 'snapRestoreTimer'> {
  const bar = document.createElement('div')
  bar.className = CAROUSEL_BAR_CLASS

  const track = document.createElement('div')
  track.className = 'xf-carousel-track'
  track.setAttribute('role', 'slider')
  track.setAttribute('aria-label', '拖动切换多图位置')
  track.setAttribute('aria-valuemin', '1')
  track.setAttribute('tabindex', '0')

  const rail = document.createElement('div')
  rail.className = 'xf-carousel-rail'

  const fill = document.createElement('div')
  fill.className = 'xf-carousel-fill'
  const thumb = document.createElement('div')
  thumb.className = 'xf-carousel-thumb'

  rail.appendChild(fill)
  track.append(rail, thumb)

  const counter = document.createElement('span')
  counter.className = 'xf-carousel-counter'
  counter.textContent = '1 / 1'

  bar.append(track, counter)

  // 阻止进度条内部点击冒泡到推文 article 引发跳转详情页
  bar.addEventListener('click', (e) => {
    e.stopPropagation()
  })

  return {
    list,
    bar,
    rail,
    fill,
    thumb,
    counter,
    track,
    lastCounterText: '',
    lastIndexText: '',
    lastSegments: 0,
  }
}

export function bindScrubberEvents(
  binding: CarouselBinding,
  scheduleSnapRestore: (binding: CarouselBinding, delayMs?: number) => void,
  applyWheelDelta: (binding: CarouselBinding, delta: number) => void,
) {
  const { track, bar, list } = binding
  let scrubbingPointerId: number | null = null
  let cachedRect: DOMRect | null = null
  let cachedMaxScroll = 0

  const seekByClientX = (clientX: number) => {
    const rect = cachedRect ?? track.getBoundingClientRect()
    if (rect.width <= 0) return
    let ratio = clampUnit((clientX - rect.left) / rect.width)
    if (clientX <= rect.left + 3) ratio = 0
    else if (clientX >= rect.right - 3) ratio = 1
    const maxScroll = cachedMaxScroll || Math.max(0, list.scrollWidth - list.clientWidth)
    const nextLeft = scrollLeftFromRatio(ratio, maxScroll)
    list.scrollLeft = nextLeft
    renderCarouselBarMetrics(binding, nextLeft, maxScroll + 100, 100, list.children.length)
  }

  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    cancelCarouselInertia(binding)
    scrubbingPointerId = e.pointerId
    cachedRect = track.getBoundingClientRect()
    cachedMaxScroll = Math.max(0, list.scrollWidth - list.clientWidth)
    list.setAttribute(CAROUSEL_SWIPING_ATTR, '1')
    track.setAttribute('data-scrubbing', '1')
    try {
      track.setPointerCapture(e.pointerId)
    } catch {}
    seekByClientX(e.clientX)
  })

  track.addEventListener('pointermove', (e) => {
    if (scrubbingPointerId !== e.pointerId) return
    e.preventDefault()
    e.stopPropagation()
    seekByClientX(e.clientX)
  })

  const endScrub = (e: PointerEvent) => {
    if (scrubbingPointerId !== e.pointerId) return
    e.stopPropagation()
    scrubbingPointerId = null
    cachedRect = null
    cachedMaxScroll = 0
    track.removeAttribute('data-scrubbing')
    try {
      if (track.hasPointerCapture(e.pointerId)) {
        track.releasePointerCapture(e.pointerId)
      }
    } catch {}
    scheduleSnapRestore(binding, 60)
  }

  track.addEventListener('pointerup', endScrub)
  track.addEventListener('pointercancel', endScrub)

  track.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const maxScroll = Math.max(0, list.scrollWidth - list.clientWidth)
    if (maxScroll <= 0) return
    e.preventDefault()
    e.stopPropagation()
    const step = Math.max(200, Math.round(list.clientWidth * 0.6))
    applyWheelDelta(binding, e.key === 'ArrowRight' ? step : -step)
  })

  // 在底部控制条上滚轮通过惯性平滑横滑
  bar.addEventListener(
    'wheel',
    (e) => {
      if (list.scrollWidth - list.clientWidth <= 8) return
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      if (!delta) return
      e.preventDefault()
      e.stopPropagation()
      applyWheelDelta(binding, delta)
    },
    { passive: false },
  )
}
