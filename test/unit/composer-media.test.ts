import { describe, expect, it } from 'vitest'
import {
  moveItem,
  parseMediaIds,
  sameMediaSet,
  slotFromPoint,
  type SlotRect,
} from '../../shared/composer-media'
import {
  findMediaStore,
  readMediaGroup,
  reorderComposerMedia,
  syncComposerMediaMetadata,
  type ComposerMediaItem,
} from '../../shared/composer-media-bridge'

describe('发帖多图排序纯逻辑', () => {
  it('moveItem: 正确将指定位置元素移至目标位置', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['b', 'c', 'd', 'a'])
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], -1, 1)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
  })

  it('slotFromPoint: 准确命中槽位矩形或最近的中心槽位', () => {
    const rects: SlotRect[] = [
      { left: 0, top: 0, right: 100, bottom: 60 },
      { left: 108, top: 0, right: 208, bottom: 60 },
      { left: 0, top: 68, right: 100, bottom: 128 },
    ]
    expect(slotFromPoint(rects, 50, 30)).toBe(0)
    expect(slotFromPoint(rects, 150, 30)).toBe(1)
    expect(slotFromPoint(rects, 104, 100)).toBe(2)
    expect(slotFromPoint(rects, 300, -50)).toBe(1)
  })

  it('sameMediaSet: 检验两组媒体是否为全同集合', () => {
    expect(sameMediaSet(['1', '2', '3'], ['3', '1', '2'])).toBe(true)
    expect(sameMediaSet(['1', '2'], ['1', '3'])).toBe(false)
    expect(sameMediaSet(['1', '1'], ['1', '2'])).toBe(false)
    expect(sameMediaSet(['1', '2'], ['1', '2', '3'])).toBe(false)
  })

  it('parseMediaIds: 正确解析逗号分隔的 ID', () => {
    expect(parseMediaIds('101, 102 , 103')).toEqual(['101', '102', '103'])
    expect(parseMediaIds('')).toEqual([])
    expect(parseMediaIds(null)).toEqual([])
  })
})

describe('发帖多图 MAIN world 桥接与原子事务', () => {
  function createMockEnvironment(items: ComposerMediaItem[]) {
    let storeMediaUpload = [...items]

    const store = {
      getState: () => ({ mediaUpload: storeMediaUpload }),
      dispatch: (action: { type: string; payload: unknown }) => {
        if (action.type === 'rweb/mediaUpload/REMOVE_MEDIA') {
          const idsToRemove = action.payload as Array<number | string>
          storeMediaUpload = storeMediaUpload.filter((m) => !idsToRemove.includes(m.id))
        } else if (action.type === 'rweb/mediaUpload/ADD_MEDIA') {
          const itemsToAdd = action.payload as ComposerMediaItem[]
          storeMediaUpload = [...storeMediaUpload, ...itemsToAdd]
        }
      },
    }

    const root = document.createElement('div')
    root.setAttribute('data-testid', 'attachments')

    // 模拟 React Fiber 链表
    const fiberRoot = {
      memoizedProps: { store },
      return: null,
    }

    const groups: HTMLElement[] = []
    items.forEach((item) => {
      const g = document.createElement('div')
      g.setAttribute('role', 'group')
      const gFiber = {
        memoizedProps: {
          mediaItem: item,
          media: items,
        },
        return: fiberRoot,
      }
      ;(g as unknown as Record<string, unknown>)['__reactFiber$test'] = gFiber
      root.appendChild(g)
      groups.push(g)
    })
    ;(root as unknown as Record<string, unknown>)['__reactFiber$test'] = fiberRoot

    return { root, groups, store, getStoreMedia: () => storeMediaUpload }
  }

  it('readMediaGroup & syncComposerMediaMetadata 能从 Fiber 提取并标注元数据', () => {
    const items: ComposerMediaItem[] = [
      { id: '101', mediaFile: { isImage: true } },
      { id: '102', mediaFile: { isImage: true } },
    ]
    const { root, groups } = createMockEnvironment(items)

    const groupFound = readMediaGroup(groups[0])
    expect(groupFound).not.toBeNull()
    expect(groupFound?.item.id).toBe('101')
    expect(groupFound?.list.length).toBe(2)

    const syncRes = syncComposerMediaMetadata(root)
    expect(syncRes.ids).toEqual(['101', '102'])
    expect(groups[0].getAttribute('data-xf-media-id')).toBe('101')
    expect(groups[0].getAttribute('data-xf-media-index')).toBe('0')
    expect(groups[0].getAttribute('data-xf-media-image')).toBe('1')
  })

  it('reorderComposerMedia: 通过 REMOVE + ADD 原子事务成功完成顺序重排', () => {
    const items: ComposerMediaItem[] = [
      { id: '101', mediaFile: { isImage: true } },
      { id: '102', mediaFile: { isImage: true } },
      { id: '103', mediaFile: { isImage: true } },
    ]
    const { root, getStoreMedia } = createMockEnvironment(items)

    const ok = reorderComposerMedia(root, ['103', '101', '102'])
    expect(ok).toBe(true)

    const afterIds = getStoreMedia().map((m) => String(m.id))
    expect(afterIds).toEqual(['103', '101', '102'])
  })

  it('findMediaStore: 能快速定位到 Store', () => {
    const items: ComposerMediaItem[] = [
      { id: '101', mediaFile: { isImage: true } },
    ]
    const { root } = createMockEnvironment(items)
    const store = findMediaStore(root, items)
    expect(store).not.toBeNull()
  })

  it('resolveMediaGroups: 严格按 index 去重并拒绝嵌套伪节点或非图片媒体', async () => {
    const { resolveMediaGroups } = await import('../../content-scripts/options/composer-media')
    const root = document.createElement('div')
    root.setAttribute('data-xf-media-ids', '101,102')

    const makeGroup = (id: string, index: string, image = '1') => {
      const el = document.createElement('div')
      el.setAttribute('data-xf-media-id', id)
      el.setAttribute('data-xf-media-index', index)
      el.setAttribute('data-xf-media-image', image)
      return el
    }

    // DOM 逆序放置也应严格映射为 [101, 102]
    const g2 = makeGroup('102', '1')
    const g1 = makeGroup('101', '0')
    root.append(g2, g1)
    expect(resolveMediaGroups(root)).toEqual([g1, g2])

    // 混入视频 (image='0') 应拒绝接管
    g2.setAttribute('data-xf-media-image', '0')
    expect(resolveMediaGroups(root)).toBeNull()

    // 重复 index 应拒绝接管（防止两个 3）
    g2.setAttribute('data-xf-media-image', '1')
    g2.setAttribute('data-xf-media-index', '0')
    expect(resolveMediaGroups(root)).toBeNull()
  })
})
