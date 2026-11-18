import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  captureFlipPositions,
  playFlipAnimation,
} from '../../content-scripts/options/flip-animator'

describe('flip-animator (原生 FLIP 排序过渡动效引擎)', () => {
  let container: HTMLElement

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    vi.useRealTimers()
    container.remove()
    document.body.innerHTML = ''
  })

  it('captureFlipPositions: 准确提取所有带 data-sort-key 元素的 top 物理坐标', () => {
    container.innerHTML = `
      <div data-sort-key="item-1">Item 1</div>
      <div data-sort-key="item-2">Item 2</div>
      <div>Non sortable</div>
    `
    const el1 = container.querySelector('[data-sort-key="item-1"]')!
    const el2 = container.querySelector('[data-sort-key="item-2"]')!

    vi.spyOn(el1, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 140,
      left: 0,
      right: 200,
      width: 200,
      height: 40,
      x: 0,
      y: 100,
      toJSON: () => {},
    })

    vi.spyOn(el2, 'getBoundingClientRect').mockReturnValue({
      top: 150,
      bottom: 190,
      left: 0,
      right: 200,
      width: 200,
      height: 40,
      x: 0,
      y: 150,
      toJSON: () => {},
    })

    const positions = captureFlipPositions(container)
    expect(positions.size).toBe(2)
    expect(positions.get('item-1')).toBe(100)
    expect(positions.get('item-2')).toBe(150)
  })

  it('playFlipAnimation: 在空 positions 或无位移时不触发任何样式修改', () => {
    container.innerHTML = `<div data-sort-key="item-1">Item 1</div>`
    const el1 = container.querySelector<HTMLElement>('[data-sort-key="item-1"]')!
    vi.spyOn(el1, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 140,
      left: 0,
      right: 200,
      width: 200,
      height: 40,
      x: 0,
      y: 100,
      toJSON: () => {},
    })

    const emptyMap = new Map<string, number>()
    playFlipAnimation(container, emptyMap)

    expect(el1.style.transform).toBe('')
    expect(el1.style.transition).toBe('')
  })

  it('playFlipAnimation: 元素发生排序位移时，完整执行 Invert 与 Play 阶段并在 transitionend 时清理', () => {
    container.innerHTML = `
      <div data-sort-key="item-1">Item 1</div>
      <div data-sort-key="item-2">Item 2</div>
    `
    const el1 = container.querySelector<HTMLElement>('[data-sort-key="item-1"]')!
    const el2 = container.querySelector<HTMLElement>('[data-sort-key="item-2"]')!

    // 假设更新前：item-1 在 100px，item-2 在 150px
    const firstPositions = new Map<string, number>([
      ['item-1', 100],
      ['item-2', 150],
    ])

    // 更新后 item-1 和 item-2 交换了位置：item-1 变成 150px，item-2 变成 100px
    vi.spyOn(el1, 'getBoundingClientRect').mockReturnValue({
      top: 150,
      bottom: 190,
      left: 0,
      right: 200,
      width: 200,
      height: 40,
      x: 0,
      y: 150,
      toJSON: () => {},
    })
    vi.spyOn(el2, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 140,
      left: 0,
      right: 200,
      width: 200,
      height: 40,
      x: 0,
      y: 100,
      toJSON: () => {},
    })

    playFlipAnimation(container, firstPositions)

    // Invert 阶段：瞬时被拉回旧位置（item-1 deltaY = 100 - 150 = -50px；item-2 deltaY = 150 - 100 = 50px）
    expect(el1.style.transform).toBe('translate3d(0, -50px, 0)')
    expect(el1.style.transition).toBe('none')
    expect(el2.style.transform).toBe('translate3d(0, 50px, 0)')
    expect(el2.style.transition).toBe('none')

    // 仅推进到下一帧（20ms），触发 Play 阶段动画，尚未到达 cleanup 超时
    vi.advanceTimersByTime(20)

    // Play 阶段：启用 cubic-bezier(0.16, 1, 0.3, 1) 缓动并滑向 translate3d(0, 0, 0)
    expect(el1.style.transition).toContain('cubic-bezier(0.16, 1, 0.3, 1)')
    expect(el1.style.transform).toBe('translate3d(0, 0, 0)')
    expect(el2.style.transition).toContain('cubic-bezier(0.16, 1, 0.3, 1)')
    expect(el2.style.transform).toBe('translate3d(0, 0, 0)')

    // 模拟 transitionend 触发
    el1.dispatchEvent(new Event('transitionend'))
    expect(el1.style.transform).toBe('')
    expect(el1.style.transition).toBe('')
    expect(el1.style.willChange).toBe('')

    // 超时兜底测试：未触发 transitionend 时，400ms 后自动清理
    vi.advanceTimersByTime(400)
    expect(el2.style.transform).toBe('')
    expect(el2.style.transition).toBe('')
    expect(el2.style.willChange).toBe('')
  })

  it('playFlipAnimation: 对新增节点应用轻微缩放和淡入过渡', () => {
    container.innerHTML = `
      <div data-sort-key="existing-item">Existing</div>
      <div data-sort-key="new-item">New</div>
    `
    const existingEl = container.querySelector<HTMLElement>('[data-sort-key="existing-item"]')!
    const newEl = container.querySelector<HTMLElement>('[data-sort-key="new-item"]')!

    const firstPositions = new Map<string, number>([
      ['existing-item', 100],
    ])

    vi.spyOn(existingEl, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 140,
      left: 0,
      right: 200,
      width: 200,
      height: 40,
      x: 0,
      y: 100,
      toJSON: () => {},
    })

    vi.spyOn(newEl, 'getBoundingClientRect').mockReturnValue({
      top: 150,
      bottom: 190,
      left: 0,
      right: 200,
      width: 200,
      height: 40,
      x: 0,
      y: 150,
      toJSON: () => {},
    })

    playFlipAnimation(container, firstPositions)

    // 新增元素初始状态：透明且微缩放
    expect(newEl.style.opacity).toBe('0')
    expect(newEl.style.transform).toContain('scale(0.97)')

    // 推进到下一帧触发 Play 阶段
    vi.advanceTimersByTime(20)

    // Play 阶段：淡入展开
    expect(newEl.style.opacity).toBe('1')
    expect(newEl.style.transform).toBe('translate3d(0, 0, 0) scale(1)')

    // 结束清理
    newEl.dispatchEvent(new Event('transitionend'))
    expect(newEl.style.opacity).toBe('')
    expect(newEl.style.transform).toBe('')
  })
})
