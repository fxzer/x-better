import { describe, expect, it } from 'vitest'
import {
  computeCarouselProgress,
  computeScrollVelocity,
  scrollLeftFromRatio,
  stepCarouselInertia,
} from '../../shared/media-carousel'

describe('多图轮播横滑物理与进度计算', () => {
  it('computeCarouselProgress: 非溢出轮播返回 scrollable=false', () => {
    expect(computeCarouselProgress(0, 698, 698, 2)).toEqual({
      scrollable: false,
      maxScroll: 0,
      ratio: 0,
      currentIndex: 1,
      total: 2,
    })
  })

  it('computeCarouselProgress: 20 图轮播正确映射起点、中点与终点页码', () => {
    const start = computeCarouselProgress(0, 8036, 698, 20)
    expect(start.scrollable).toBe(true)
    expect(start.maxScroll).toBe(7338)
    expect(start.ratio).toBe(0)
    expect(start.currentIndex).toBe(1)

    const mid = computeCarouselProgress(3669, 8036, 698, 20)
    expect(mid.ratio).toBeCloseTo(0.5, 4)
    expect(mid.currentIndex).toBe(11)

    const end = computeCarouselProgress(7338, 8036, 698, 20)
    expect(end.ratio).toBe(1)
    expect(end.currentIndex).toBe(20)
  })

  it('scrollLeftFromRatio: 按比例准确映射并钳位边界', () => {
    expect(scrollLeftFromRatio(-0.2, 5000)).toBe(0)
    expect(scrollLeftFromRatio(0.5, 5000)).toBe(2500)
    expect(scrollLeftFromRatio(1.4, 5000)).toBe(5000)
  })

  it('computeScrollVelocity: 往左甩返回正向滚动速度，停顿后松手返回 0', () => {
    const samples = [
      { x: 600, time: 100 },
      { x: 520, time: 120 },
      { x: 400, time: 140 },
    ]
    // 400 - 600 = -200px in 40ms -> ~5 px/ms * gain, capped at max
    const velocity = computeScrollVelocity(samples, 150)
    expect(velocity).toBeGreaterThan(4)

    // 抬指瞬间 1px 微颤样本不会吞掉原本的甩手初速度
    const jitterSamples = [
      ...samples,
      { x: 399, time: 152 },
    ]
    expect(computeScrollVelocity(jitterSamples, 195)).toBeGreaterThan(4)

    // 短暂自然停顿（90ms，例如物理鼠标抬指瞬间）仍保留合理惯性
    const briefPauseVel = computeScrollVelocity(samples, 230)
    expect(briefPauseVel).toBeGreaterThan(2)

    // 停顿超过 155ms 后再松手不触发惯性误甩
    expect(computeScrollVelocity(samples, 300)).toBe(0)
  })

  it('stepCarouselInertia: 按帧平滑减速，时钟抖动(dt<=0)不误杀，碰壁时停止', () => {
    const jitter = stepCarouselInertia(1000, 2.0, 7000, -0.5)
    expect(jitter.done).toBe(false)
    expect(jitter.nextVelocity).toBe(2.0)

    const s1 = stepCarouselInertia(1000, 2.0, 7000, 16.67)
    expect(s1.done).toBe(false)
    expect(s1.nextScrollLeft).toBeGreaterThan(1025)
    expect(s1.nextVelocity).toBeLessThan(2.0)

    const boundary = stepCarouselInertia(6990, 2.5, 7000, 16.67)
    expect(boundary.nextScrollLeft).toBe(7000)
    expect(boundary.nextVelocity).toBe(0)
    expect(boundary.done).toBe(true)
  })

  it('findBarAnchor: 自动跳过绝对定位、row-flex 与 padding-bottom 占位盒子', async () => {
    const { findBarAnchor } = await import('../../content-scripts/features/media-carousel-bar')
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div id="outer-col" style="display:flex;flex-direction:column;">
          <div id="aspect-box" style="display:flex;flex-direction:column;position:relative;">
            <div style="padding-bottom:90%;"></div>
            <div id="abs-layer" style="position:absolute;">
              <nav style="display:flex;flex-direction:row;">
                <div style="display:flex;flex-direction:row;">
                  <div data-testid="ScrollSnap-SwipeableList">
                    <div id="list" data-testid="ScrollSnap-List"></div>
                  </div>
                </div>
              </nav>
            </div>
          </div>
        </div>
      </article>
    `
    const list = document.getElementById('list')!
    const anchor = findBarAnchor(list)
    expect(anchor?.id).toBe('aspect-box')
  })

  it('分段进度条同步总段数 CSS 变量并将滑块点挂载在遮罩轨道外层', async () => {
    const { createCarouselBar, renderCarouselBarMetrics } = await import(
      '../../content-scripts/features/media-carousel-bar'
    )
    const list = document.createElement('div')
    const base = createCarouselBar(list)
    const binding = {
      ...base,
      resizeObserver: { observe() {}, disconnect() {}, unobserve() {} } as unknown as ResizeObserver,
      rafId: null,
      dragRafId: null,
      snapRestoreTimer: null,
    }

    // thumb 在 track 下而非 rail 下，防止被分段 mask 切缝遮罩
    expect(base.thumb.parentElement).toBe(base.track)
    expect(base.rail.contains(base.thumb)).toBe(false)

    renderCarouselBarMetrics(binding, 1834.5, 8036, 698, 20)
    expect(base.rail.getAttribute('data-segmented')).toBe('1')
    expect(base.rail.style.getPropertyValue('--xf-segs')).toBe('20')
    expect(base.fill.style.width).toBe('25%')
    expect(base.counter.textContent).toBe('6 / 20')
  })
})
