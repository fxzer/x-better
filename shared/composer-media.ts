/**
 * 发帖框多图排版与拖拽排序：页面主环境（MAIN world）和内容脚本共用的常量与纯计算。
 * 纯逻辑模块，可安全运行于任意 JS Realm 并进行独立单测。
 */

/** 内容脚本请求 MAIN world 进行图片重排的自定义事件名称 */
export const COMPOSER_MEDIA_REORDER_EVENT = 'xf-composer-media-reorder'
/** 内容脚本请求 MAIN world 同步图片编号与元数据的自定义事件名称 */
export const COMPOSER_MEDIA_SYNC_EVENT = 'xf-composer-media-sync'

/** 附件根容器：当前顺序的图片编号列表（逗号分隔） */
export const MEDIA_IDS_ATTR = 'data-xf-media-ids'
/** 附件根容器：期望的新顺序图片编号列表（逗号分隔） */
export const MEDIA_REORDER_ATTR = 'data-xf-media-reorder'
/** 附件根容器：上次重排结果（'ok' | 'error'） */
export const MEDIA_REORDER_RESULT_ATTR = 'data-xf-media-reorder-result'

/** 图片格子：X 内部的媒体编号标识 */
export const MEDIA_ID_ATTR = 'data-xf-media-id'
/** 图片格子：在帖子中的视觉排序索引（从 0 开始） */
export const MEDIA_INDEX_ATTR = 'data-xf-media-index'
/** 图片格子：是否为纯静态图片（1: 是, 0: 否） */
export const MEDIA_IMAGE_ATTR = 'data-xf-media-image'
/** 附件根容器：是否已被多图网格排序接管 */
export const MEDIA_GRID_ATTR = 'data-xf-media-grid'
/** 正在被拖拽的图片元素属性标记 */
export const MEDIA_DRAGGING_ATTR = 'data-xf-media-dragging'

/** 图片排序支持的附件上限（X 官方标准普通发帖最多 4 张，长文发帖或未来上限支持至 20 张） */
export const MAX_COMPOSER_MEDIA = 20

/**
 * 将数组中 from 位置的元素移至 to 位置，其余元素依次平移
 * @returns 浅拷贝的新数组
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) {
    return next
  }
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export interface SlotRect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * 根据指针坐标计算命中的目标槽位索引；
 * 若未直接命中矩形内部，则选择欧氏中心距离最近的槽位
 */
export function slotFromPoint(rects: readonly SlotRect[], x: number, y: number): number {
  let best = -1
  let bestDistance = Infinity

  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return i
    }
    const dx = x - (rect.left + rect.right) / 2
    const dy = y - (rect.top + rect.bottom) / 2
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      best = i
      bestDistance = distance
    }
  }

  return best
}

/**
 * 解析逗号分隔的媒体 ID 字符串列表
 */
export function parseMediaIds(value: string | null | undefined): string[] {
  return (value || '').split(',').map((id) => id.trim()).filter(Boolean)
}

/**
 * 校验两组 ID 集合是否包含完全相同的图片元素（顺序可不同）
 */
export function sameMediaSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const setA = new Set(a)
  return setA.size === a.length && new Set(b).size === b.length && b.every((id) => setA.has(id))
}
