/**
 * 多图推文轮播横滑增强（Media Carousel Swipe）：
 * 针对 X 上包含多图轮播（3 到 20 张图片）的 `[data-testid="ScrollSnap-List"]` 容器：
 * 1. 禁用图片/链接原生拖拽与静态选中，消除卡顿障碍；
 * 2. 热路径优化：pointerdown 一次性缓存尺寸，pointermove 通过 rAF 帧合并零回流写入；
 * 3. 松手后使用浮点累计虚拟坐标 + Mac 级指数阻尼（0.967/帧），顺滑接力跨多图滑行；
 * 4. 滚轮/Shift+滚轮也接入惯性脉冲引擎，消除鼠标滚轮卡顿跳帧。
 */

import {
  CAROUSEL_BAR_CLASS,
  CAROUSEL_BOUND_ATTR,
  CAROUSEL_DRAG_THRESHOLD,
  CAROUSEL_MIN_INERTIA_VELOCITY,
  CAROUSEL_SWIPING_ATTR,
  CAROUSEL_SWIPING_BODY_CLASS,
  computeScrollVelocity,
  stepCarouselInertia,
  type PointerSample,
} from '../../shared/media-carousel'
import { KeyMediaCarouselSwipe } from '../../storage-keys'
import { getStorage } from '../utilities/storage'
import {
  bindScrubberEvents,
  cancelCarouselInertia,
  createCarouselBar,
  ensureCarouselStyles,
  findBarAnchor,
  removeCarouselStyles,
  renderCarouselBarMetrics,
  syncCarouselBar,
  type CarouselBinding,
} from './media-carousel-bar'

const CAROUSEL_SELECTOR = 'article[data-testid="tweet"] [data-testid="ScrollSnap-List"]'
const INTERACTIVE_EXCLUDE_SELECTOR = 'button, [role="button"], input, textarea, select, [role="slider"]'

interface ActiveSwipe {
  binding: CarouselBinding
  pointerId: number
  startX: number
  startY: number
  startScrollLeft: number
  cachedScrollWidth: number
  cachedClientWidth: number
  cachedMaxScroll: number
  cachedItemCount: number
  pendingX: number
  started: boolean
  samples: PointerSample[]
}

const bindings = new WeakMap<HTMLElement, CarouselBinding>()
const boundLists = new Set<HTMLElement>()
const activeVelocities = new WeakMap<CarouselBinding, number>()
let activeSwipe: ActiveSwipe | null = null
let enabledCache: boolean | null = null

export function invalidateMediaCarouselCache() {
  enabledCache = null
}

async function isMediaCarouselEnabled(): Promise<boolean> {
  if (enabledCache === null) {
    enabledCache = (await getStorage(KeyMediaCarouselSwipe)) !== 'off'
  }
  return enabledCache
}

function suppressTrailingClick() {
  const stopClick = (e: MouseEvent) => {
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  window.addEventListener('click', stopClick, true)
  setTimeout(() => {
    window.removeEventListener('click', stopClick, true)
  }, 100)
}

function scheduleSnapRestore(binding: CarouselBinding, delayMs = 80) {
  if (binding.snapRestoreTimer !== null) {
    clearTimeout(binding.snapRestoreTimer)
  }
  binding.snapRestoreTimer = setTimeout(() => {
    binding.snapRestoreTimer = null
    if (activeSwipe?.binding !== binding && binding.rafId === null) {
      binding.list.removeAttribute(CAROUSEL_SWIPING_ATTR)
    }
  }, delayMs)
}

function startInertia(
  binding: CarouselBinding,
  initialVelocity: number,
  initialVirtualLeft?: number,
) {
  cancelCarouselInertia(binding)
  binding.list.setAttribute(CAROUSEL_SWIPING_ATTR, '1')
  activeVelocities.set(binding, initialVelocity)

  const cachedScrollWidth = binding.list.scrollWidth
  const cachedClientWidth = binding.list.clientWidth
  const maxScroll = Math.max(0, cachedScrollWidth - cachedClientWidth)
  const itemCount = binding.list.children.length
  let virtualLeft = initialVirtualLeft ?? binding.list.scrollLeft
  // 不使用 performance.now() 初始化：Chromium rAF 回调入参 now 为帧起始时间，
  // 可能略早于事件处理时的 performance.now()，若直接相减会导致首帧 dt <= 0
  let lastTime: number | null = null

  const tick = (now: number) => {
    if (!binding.list.isConnected || activeSwipe?.binding === binding) {
      binding.rafId = null
      activeVelocities.delete(binding)
      return
    }

    const currentVel = activeVelocities.get(binding) ?? 0
    const dt = lastTime === null ? 16.67 : Math.max(1, now - lastTime)
    lastTime = now

    const step = stepCarouselInertia(virtualLeft, currentVel, maxScroll, dt)
    virtualLeft = step.nextScrollLeft
    binding.list.scrollLeft = virtualLeft
    activeVelocities.set(binding, step.nextVelocity)

    renderCarouselBarMetrics(binding, virtualLeft, cachedScrollWidth, cachedClientWidth, itemCount)

    if (step.done) {
      binding.rafId = null
      activeVelocities.delete(binding)
      scheduleSnapRestore(binding, 40)
      return
    }
    binding.rafId = requestAnimationFrame(tick)
  }

  binding.rafId = requestAnimationFrame(tick)
}

/** 鼠标滚轮/键盘操作接入同一条惯性滑行引擎，避免刻度跳跃 */
function applyWheelImpulse(binding: CarouselBinding, deltaPx: number) {
  const impulseVelocity = Math.max(-5.5, Math.min(5.5, deltaPx * 0.014))
  if (binding.rafId !== null) {
    const cur = activeVelocities.get(binding) ?? 0
    activeVelocities.set(binding, Math.max(-7.5, Math.min(7.5, cur + impulseVelocity)))
  } else {
    startInertia(binding, impulseVelocity, binding.list.scrollLeft)
  }
}

function cleanupWindowSwipeListeners() {
  window.removeEventListener('pointermove', onWindowPointerMove, true)
  window.removeEventListener('pointerup', onWindowPointerUp, true)
  window.removeEventListener('pointercancel', onWindowPointerCancel, true)
  window.removeEventListener('blur', onWindowSwipeCancel)
}

function flushDragFrame(state: ActiveSwipe) {
  state.binding.dragRafId = null
  if (!state.started || !state.binding.list.isConnected) return
  const nextLeft = Math.min(
    state.cachedMaxScroll,
    Math.max(0, state.startScrollLeft - (state.pendingX - state.startX)),
  )
  state.binding.list.scrollLeft = nextLeft
  renderCarouselBarMetrics(
    state.binding,
    nextLeft,
    state.cachedScrollWidth,
    state.cachedClientWidth,
    state.cachedItemCount,
  )
}

function finishActiveSwipe(shouldStartInertia: boolean) {
  cleanupWindowSwipeListeners()
  const state = activeSwipe
  if (!state) return
  activeSwipe = null
  document.documentElement.classList.remove(CAROUSEL_SWIPING_BODY_CLASS)

  if (state.binding.dragRafId !== null) {
    cancelAnimationFrame(state.binding.dragRafId)
    state.binding.dragRafId = null
    if (state.started && state.binding.list.isConnected) {
      flushDragFrame(state)
    }
  }

  if (!state.started) {
    state.binding.list.removeAttribute(CAROUSEL_SWIPING_ATTR)
    return
  }

  suppressTrailingClick()
  if (shouldStartInertia) {
    const velocity = computeScrollVelocity(state.samples, performance.now())
    if (Math.abs(velocity) >= CAROUSEL_MIN_INERTIA_VELOCITY) {
      const currentVirtual = Math.min(
        state.cachedMaxScroll,
        Math.max(0, state.startScrollLeft - (state.pendingX - state.startX)),
      )
      startInertia(state.binding, velocity, currentVirtual)
      return
    }
  }
  scheduleSnapRestore(state.binding, 40)
}

function onWindowPointerMove(event: PointerEvent) {
  const state = activeSwipe
  if (!state || event.pointerId !== state.pointerId) return

  const { binding } = state
  if (!binding.list.isConnected) {
    finishActiveSwipe(false)
    return
  }

  const dx = event.clientX - state.startX
  const dy = event.clientY - state.startY

  if (!state.started) {
    if (Math.abs(dx) < CAROUSEL_DRAG_THRESHOLD) return
    if (Math.abs(dy) > Math.abs(dx) * 2.5) {
      finishActiveSwipe(false)
      return
    }
    state.started = true
    binding.list.setAttribute(CAROUSEL_SWIPING_ATTR, '1')
    document.documentElement.classList.add(CAROUSEL_SWIPING_BODY_CLASS)
  }

  event.preventDefault()
  state.pendingX = event.clientX

  state.samples.push({ x: event.clientX, time: performance.now() })
  if (state.samples.length > 24) {
    state.samples.shift()
  }

  // rAF 帧合并：无论鼠标采样率 125Hz 还是 1000Hz，每刷新周期只写一次 DOM
  if (binding.dragRafId === null) {
    binding.dragRafId = requestAnimationFrame(() => flushDragFrame(state))
  }
}

function onWindowPointerUp(event: PointerEvent) {
  if (!activeSwipe || event.pointerId !== activeSwipe.pointerId) return
  finishActiveSwipe(true)
}

function onWindowPointerCancel(event: PointerEvent) {
  if (!activeSwipe || event.pointerId !== activeSwipe.pointerId) return
  finishActiveSwipe(false)
}

function onWindowSwipeCancel() {
  finishActiveSwipe(false)
}

function attachCarousel(list: HTMLElement) {
  if (bindings.has(list)) {
    const existing = bindings.get(list)!
    const anchor = findBarAnchor(list)
    if (anchor && existing.bar.previousElementSibling !== anchor) {
      anchor.insertAdjacentElement('afterend', existing.bar)
    }
    syncCarouselBar(existing)
    return
  }

  const anchor = findBarAnchor(list)
  if (!anchor) return

  ensureCarouselStyles()
  list.setAttribute(CAROUSEL_BOUND_ATTR, '1')

  const base = createCarouselBar(list)
  if (anchor.nextElementSibling?.classList.contains(CAROUSEL_BAR_CLASS)) {
    anchor.nextElementSibling.remove()
  }
  anchor.insertAdjacentElement('afterend', base.bar)

  const resizeObserver = new ResizeObserver(() => {
    syncCarouselBar(binding)
  })
  resizeObserver.observe(list)

  const binding: CarouselBinding = {
    ...base,
    resizeObserver,
    rafId: null,
    dragRafId: null,
    snapRestoreTimer: null,
  }
  bindings.set(list, binding)
  boundLists.add(list)

  bindScrubberEvents(binding, scheduleSnapRestore, applyWheelImpulse)
  syncCarouselBar(binding)

  list.addEventListener('dragstart', (e) => e.preventDefault(), true)

  list.addEventListener('pointerdown', (e) => {
    if (activeSwipe || e.button !== 0) return
    const target = e.target instanceof Element ? e.target : null
    if (!target || target.closest(INTERACTIVE_EXCLUDE_SELECTOR)) return

    const scrollWidth = list.scrollWidth
    const clientWidth = list.clientWidth
    const maxScroll = scrollWidth - clientWidth
    if (maxScroll <= 8) return

    cancelCarouselInertia(binding)
    activeVelocities.delete(binding)

    activeSwipe = {
      binding,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: list.scrollLeft,
      cachedScrollWidth: scrollWidth,
      cachedClientWidth: clientWidth,
      cachedMaxScroll: maxScroll,
      cachedItemCount: list.children.length,
      pendingX: e.clientX,
      started: false,
      samples: [{ x: e.clientX, time: performance.now() }],
    }

    window.addEventListener('pointermove', onWindowPointerMove, true)
    window.addEventListener('pointerup', onWindowPointerUp, true)
    window.addEventListener('pointercancel', onWindowPointerCancel, true)
    window.addEventListener('blur', onWindowSwipeCancel)
  })

  // Shift + 滚轮采用与触摸一致的平滑惯性滚轮脉冲
  list.addEventListener(
    'wheel',
    (e) => {
      if (!e.shiftKey) return
      if (list.scrollWidth - list.clientWidth <= 8) return
      const delta = e.deltaY || e.deltaX
      if (!delta) return
      e.preventDefault()
      e.stopPropagation()
      applyWheelImpulse(binding, delta)
    },
    { passive: false },
  )

  list.addEventListener(
    'scroll',
    () => {
      if (activeSwipe?.binding === binding || binding.rafId !== null) return
      syncCarouselBar(binding)
    },
    { passive: true },
  )
  list.addEventListener('load', () => syncCarouselBar(binding), true)
}

function detachCarousel(list: HTMLElement) {
  const binding = bindings.get(list)
  if (binding) {
    cancelCarouselInertia(binding)
    activeVelocities.delete(binding)
    binding.resizeObserver.disconnect()
    binding.bar.remove()
    bindings.delete(list)
  }
  boundLists.delete(list)
  list.removeAttribute(CAROUSEL_BOUND_ATTR)
  list.removeAttribute(CAROUSEL_SWIPING_ATTR)
}

export function cleanupMediaCarousels() {
  if (activeSwipe) {
    finishActiveSwipe(false)
  }
  for (const list of Array.from(boundLists)) {
    detachCarousel(list)
  }
  document.querySelectorAll<HTMLElement>(`.${CAROUSEL_BAR_CLASS}`).forEach((el) => el.remove())
  removeCarouselStyles()
}

/**
 * 扫描并挂载/同步时间线与详情页的多图轮播横滑增强
 */
export async function updateMediaCarousels() {
  const enabled = await isMediaCarouselEnabled()
  if (!enabled) {
    cleanupMediaCarousels()
    return
  }

  for (const list of Array.from(boundLists)) {
    if (!list.isConnected) {
      detachCarousel(list)
    }
  }

  const lists = document.querySelectorAll<HTMLElement>(CAROUSEL_SELECTOR)
  lists.forEach((list) => {
    if (list.closest('[data-testid="attachments"]')) return
    attachCarousel(list)
  })
}
