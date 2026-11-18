/**
 * 发帖框多图排序（isolated world）。
 *
 * 核心机制：
 * 1. 监测发帖框的附件区（[data-testid="attachments"]）；
 * 2. 派发 COMPOSER_MEDIA_SYNC_EVENT，由 MAIN world 遍历 React Fiber 读取每张图的媒体编号（media ID）并写回 DOM；
 * 3. 严格去重映射图片格子，杜绝嵌套容器导致的重复角标（如两个 3）；
 * 4. 增强视觉交互：右下角标注当前发帖顺序编号（1, 2, 3, 4...），启用 grab 抓取手势；
 * 5. Pointer Events 拖拽与 Ghost 浮层跟随，阻断原生 dragstart 冲突；
 * 6. 松手时向 MAIN world 发送 COMPOSER_MEDIA_REORDER_EVENT 事件，触发 Redux 原子重排；
 * 7. 零内存泄漏：事件与状态全部使用 WeakMap/WeakSet 管理，组件销毁自动随 DOM 释放。
 */

import {
  COMPOSER_MEDIA_REORDER_EVENT,
  COMPOSER_MEDIA_SYNC_EVENT,
  MAX_COMPOSER_MEDIA,
  MEDIA_DRAGGING_ATTR,
  MEDIA_GRID_ATTR,
  MEDIA_IDS_ATTR,
  MEDIA_ID_ATTR,
  MEDIA_IMAGE_ATTR,
  MEDIA_INDEX_ATTR,
  MEDIA_REORDER_ATTR,
  MEDIA_REORDER_RESULT_ATTR,
  moveItem,
  parseMediaIds,
  slotFromPoint,
  type SlotRect,
} from '../../shared/composer-media'
import { KeyComposerMediaGrid } from '../../storage-keys'
import addStyles, { removeStyles, stylesExist } from '../utilities/addStyles'
import { getStorage } from '../utilities/storage'

const ROOT_SELECTOR = '[data-testid="attachments"]'
const STYLE_ID = 'composerMediaGrid'
const DRAG_THRESHOLD = 5

export const SLOT_ATTR = 'data-xf-media-slot'
export const ORDER_ATTR = 'data-xf-media-order'

interface DragState {
  root: HTMLElement
  group: HTMLElement
  groups: HTMLElement[]
  ids: string[]
  fromIndex: number
  targetIndex: number
  rects: SlotRect[]
  pointerId: number
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  started: boolean
  ghost: HTMLElement | null
}

let activeDrag: DragState | null = null
const boundRoots = new WeakSet<HTMLElement>()
const observers = new WeakMap<HTMLElement, MutationObserver>()

function ensureStyles() {
  if (stylesExist(STYLE_ID)) return
  addStyles(
    STYLE_ID,
    `
    [${MEDIA_GRID_ATTR}] [${SLOT_ATTR}] {
      position: relative !important;
      touch-action: none;
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
    }
    [${MEDIA_GRID_ATTR}] [${SLOT_ATTR}]:active {
      cursor: grabbing;
    }
    [${MEDIA_GRID_ATTR}] [${SLOT_ATTR}]::after {
      content: attr(${ORDER_ATTR});
      position: absolute;
      right: 8px;
      bottom: 8px;
      z-index: 10;
      min-width: 24px;
      height: 24px;
      padding: 0 6px;
      box-sizing: border-box;
      border-radius: 9999px;
      background: rgb(29, 155, 240);
      color: #ffffff;
      font: 700 13px/24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      text-align: center;
      pointer-events: none;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
    }
    [${MEDIA_GRID_ATTR}] [${MEDIA_DRAGGING_ATTR}="1"] {
      opacity: 0.35 !important;
      outline: 2px dashed rgb(29, 155, 240);
      outline-offset: -2px;
      cursor: grabbing !important;
    }
    .xf-media-drag-ghost {
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      box-sizing: border-box;
      border-radius: 16px;
      background-color: rgba(15, 20, 25, 0.85);
      background-position: center;
      background-repeat: no-repeat;
      background-size: cover;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      opacity: 0.95;
      transform: scale(1.05);
      transition: transform 0.1s ease;
    }
    [${MEDIA_GRID_ATTR}] [${SLOT_ATTR}] img {
      -webkit-user-drag: none !important;
      user-drag: none !important;
    }
    html.xf-media-dragging, html.xf-media-dragging * {
      cursor: grabbing !important;
      user-select: none !important;
      -webkit-user-select: none !important;
    }
  `,
  )
}

let enabledCache: boolean | null = null

export function invalidateComposerMediaCache() {
  enabledCache = null
}

async function isComposerMediaEnabled(): Promise<boolean> {
  if (enabledCache === null) {
    enabledCache = (await getStorage(KeyComposerMediaGrid)) !== 'off'
  }
  return enabledCache
}

/**
 * 解析并严格去重发帖框内的图片格子；
 * 只识别由 MAIN world 成功标注了 MEDIA_ID_ATTR 且索引唯一的图片节点，杜绝任何嵌套容器导致的重复序号
 */
export function resolveMediaGroups(root: HTMLElement): HTMLElement[] | null {
  const found = Array.from(root.querySelectorAll<HTMLElement>(`[${MEDIA_ID_ATTR}]`))
  const count = found.length
  if (count < 2 || count > MAX_COMPOSER_MEDIA) return null

  const ids = parseMediaIds(root.getAttribute(MEDIA_IDS_ATTR))
  if (ids.length !== count) return null

  const groups: HTMLElement[] = new Array(count)
  for (const group of found) {
    if (group.getAttribute(MEDIA_IMAGE_ATTR) !== '1') return null
    const index = Number(group.getAttribute(MEDIA_INDEX_ATTR))
    if (!Number.isInteger(index) || index < 0 || index >= count || groups[index]) return null
    if (ids[index] !== group.getAttribute(MEDIA_ID_ATTR)) return null
    groups[index] = group
  }

  return groups
}

function updateSlots(groups: HTMLElement[]) {
  groups.forEach((group, index) => {
    group.setAttribute(SLOT_ATTR, String(index))
    group.setAttribute(ORDER_ATTR, String(index + 1))
  })
}

function clearSlotMarks(root: HTMLElement) {
  root.removeAttribute(MEDIA_GRID_ATTR)
  root.removeAttribute(MEDIA_IDS_ATTR)
  root.removeAttribute(MEDIA_REORDER_ATTR)
  root.removeAttribute(MEDIA_REORDER_RESULT_ATTR)
  root.querySelectorAll<HTMLElement>(`[${SLOT_ATTR}], [${MEDIA_ID_ATTR}]`).forEach((el) => {
    el.removeAttribute(SLOT_ATTR)
    el.removeAttribute(ORDER_ATTR)
    el.removeAttribute(MEDIA_DRAGGING_ATTR)
    el.removeAttribute(MEDIA_ID_ATTR)
    el.removeAttribute(MEDIA_INDEX_ATTR)
    el.removeAttribute(MEDIA_IMAGE_ATTR)
  })
}

export function clearComposerMediaRoot(root: HTMLElement) {
  clearSlotMarks(root)
  const observer = observers.get(root)
  if (observer) {
    observer.disconnect()
    observers.delete(root)
  }
}

/**
 * 请求 MAIN world 同步媒体数据并应用序号标记
 */
export function syncComposerMediaRoot(root: HTMLElement): boolean {
  if (!root.isConnected) {
    clearComposerMediaRoot(root)
    return false
  }

  // 同步派发事件，让 MAIN world 立即打上各图片的 ID 和 INDEX 属性
  root.dispatchEvent(new CustomEvent(COMPOSER_MEDIA_SYNC_EVENT, { bubbles: true }))

  const groups = resolveMediaGroups(root)
  if (!groups) {
    clearSlotMarks(root)
    return false
  }

  ensureStyles()
  root.setAttribute(MEDIA_GRID_ATTR, String(groups.length))
  updateSlots(groups)

  // 绑定交互事件（仅绑一次）
  if (!boundRoots.has(root)) {
    boundRoots.add(root)
    root.addEventListener('pointerdown', (e) => handlePointerDown(root, e))
    // 阻止浏览器原生的图片拖动（避免截断 Pointer 事件）
    root.addEventListener('dragstart', (e) => {
      const target = e.target instanceof Element ? e.target : null
      if (activeDrag?.root === root || target?.closest(`[${SLOT_ATTR}]`)) {
        e.preventDefault()
      }
    })
  }

  // 监测附件区内部图片增删/重渲染（关闭扩展或断开 DOM 时才卸载）
  if (!observers.has(root)) {
    const observer = new MutationObserver(() => {
      if (activeDrag?.root === root) return
      syncComposerMediaRoot(root)
    })
    observer.observe(root, { childList: true, subtree: true })
    observers.set(root, observer)
  }

  return true
}

/**
 * 请求 MAIN world 执行多图重排事务
 */
export function requestComposerMediaReorder(root: HTMLElement, ids: string[]): boolean {
  root.removeAttribute(MEDIA_REORDER_RESULT_ATTR)
  root.setAttribute(MEDIA_REORDER_ATTR, ids.join(','))
  root.dispatchEvent(new CustomEvent(COMPOSER_MEDIA_REORDER_EVENT, { bubbles: true }))
  const ok = root.getAttribute(MEDIA_REORDER_RESULT_ATTR) === 'ok'
  root.removeAttribute(MEDIA_REORDER_RESULT_ATTR)
  root.removeAttribute(MEDIA_REORDER_ATTR)
  return ok
}

function handlePointerDown(root: HTMLElement, event: PointerEvent) {
  if (activeDrag || event.button !== 0 || !root.hasAttribute(MEDIA_GRID_ATTR)) return

  const target = event.target instanceof Element ? event.target : null
  // 排除发帖框自身的功能按钮（如图片上的“编辑”按钮、删除“X”按钮）
  if (!target || target.closest('button, a, input, textarea, [role="button"], [role="link"]')) {
    return
  }

  const group = target.closest<HTMLElement>(`[${SLOT_ATTR}]`)
  if (!group || !root.contains(group)) return

  const groups = resolveMediaGroups(root)
  if (!groups) return

  const fromIndex = groups.indexOf(group)
  if (fromIndex < 0) return

  const ids = groups.map((g) => g.getAttribute(MEDIA_ID_ATTR) || '')
  const rect = group.getBoundingClientRect()
  const rects: SlotRect[] = groups.map((g) => {
    const r = g.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  })

  activeDrag = {
    root,
    group,
    groups,
    ids,
    fromIndex,
    targetIndex: fromIndex,
    rects,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    started: false,
    ghost: null,
  }

  window.addEventListener('pointermove', onPointerMove, true)
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('pointercancel', onPointerCancel, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('blur', cancelDrag)
}

function startDrag(state: DragState) {
  state.started = true
  const rect = state.group.getBoundingClientRect()
  const ghost = document.createElement('div')
  ghost.className = 'xf-media-drag-ghost'
  ghost.style.width = `${rect.width}px`
  ghost.style.height = `${rect.height}px`

  const img = state.group.querySelector('img')
  const src = img?.getAttribute('src')
  if (src) {
    ghost.style.backgroundImage = `url(${JSON.stringify(src)})`
  }

  document.body.appendChild(ghost)
  state.ghost = ghost
  state.group.setAttribute(MEDIA_DRAGGING_ATTR, '1')
  document.documentElement.classList.add('xf-media-dragging')
  moveGhost(state, state.startX, state.startY)
}

function moveGhost(state: DragState, x: number, y: number) {
  if (!state.ghost) return
  state.ghost.style.left = `${x - state.offsetX}px`
  state.ghost.style.top = `${y - state.offsetY}px`
}

function onPointerMove(event: PointerEvent) {
  const state = activeDrag
  if (!state || event.pointerId !== state.pointerId) return

  if (!state.started) {
    if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < DRAG_THRESHOLD) {
      return
    }
    if (!state.group.isConnected) {
      cancelDrag()
      return
    }
    startDrag(state)
  }

  event.preventDefault()
  moveGhost(state, event.clientX, event.clientY)

  // 动态更新悬停目标槽位
  const target = slotFromPoint(state.rects, event.clientX, event.clientY)
  if (target >= 0 && target !== state.targetIndex) {
    state.targetIndex = target
    updateSlots(moveItem(state.groups, state.fromIndex, target))
  }
}

/** 拖拽结束后吞掉紧随 pointerup 触发的合成 click，避免误打开 X 原生裁剪媒体弹窗 */
function suppressTrailingClick() {
  const stopClick = (e: MouseEvent) => {
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  window.addEventListener('click', stopClick, true)
  setTimeout(() => {
    window.removeEventListener('click', stopClick, true)
  }, 80)
}

function onPointerUp(event: PointerEvent) {
  cleanupWindowEvents()
  const state = activeDrag
  if (!state || event.pointerId !== state.pointerId) {
    activeDrag = null
    return
  }

  state.ghost?.remove()
  state.group.removeAttribute(MEDIA_DRAGGING_ATTR)
  document.documentElement.classList.remove('xf-media-dragging')

  const wasStarted = state.started
  const from = state.fromIndex
  const to = state.targetIndex
  const root = state.root
  const groups = state.groups
  const ids = state.ids
  activeDrag = null

  if (wasStarted) {
    suppressTrailingClick()
  }

  if (wasStarted && from !== to && ids.length >= 2) {
    const reorderedIds = moveItem(ids, from, to)
    const success = requestComposerMediaReorder(root, reorderedIds)
    if (!success) {
      updateSlots(groups)
    }
  } else {
    updateSlots(groups)
  }
}

function onPointerCancel() {
  cancelDrag()
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    cancelDrag()
  }
}

function cleanupWindowEvents() {
  window.removeEventListener('pointermove', onPointerMove, true)
  window.removeEventListener('pointerup', onPointerUp, true)
  window.removeEventListener('pointercancel', onPointerCancel, true)
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('blur', cancelDrag)
}

function cancelDrag() {
  cleanupWindowEvents()
  if (activeDrag) {
    if (activeDrag.started) suppressTrailingClick()
    activeDrag.ghost?.remove()
    activeDrag.group.removeAttribute(MEDIA_DRAGGING_ATTR)
    updateSlots(activeDrag.groups)
    activeDrag = null
  }
  document.documentElement.classList.remove('xf-media-dragging')
}

/**
 * 更新页面中所有处于编辑状态的发帖框图片网格
 */
export async function updateComposerMediaGrids() {
  const enabled = await isComposerMediaEnabled()
  const roots = document.querySelectorAll<HTMLElement>(ROOT_SELECTOR)

  if (!enabled) {
    roots.forEach(clearComposerMediaRoot)
    removeStyles(STYLE_ID)
    return
  }

  roots.forEach((root) => {
    syncComposerMediaRoot(root)
  })
}
