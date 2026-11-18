import { describe, it, expect, beforeEach } from 'vitest'
import { buildThinScrollbarCss } from '../../content-scripts/utilities/scrollbarStyles'
import { updateArticleToc, destroyArticleToc } from '../../content-scripts/features/article-toc'
import { attachSidebarScheduledPanorama, removeSidebarScheduledPanorama } from '../../content-scripts/options/scheduled-time'
import { KeyArticleToc, KeyScheduledPanorama, KeySidebarColumn } from '../../storage-keys'
import { setStorage } from '../../content-scripts/utilities/storage'

describe('scrollbarStyles 与目录导航/排期全景滚动条一致性', () => {
  beforeEach(async () => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    if (typeof (globalThis as any).IntersectionObserver === 'undefined') {
      ;(globalThis as any).IntersectionObserver = class {
        observe() {}
        disconnect() {}
        unobserve() {}
      }
    }
    const store: Record<string, unknown> = {}
    ;(globalThis as any).browser = {
      runtime: { id: 'test-runtime', onMessage: { addListener: () => {} } },
      storage: {
        local: {
          get: async (keys: string | string[]) => {
            const arr = Array.isArray(keys) ? keys : [keys]
            return arr.reduce<Record<string, unknown>>((acc, k) => {
              acc[k] = store[k]
              return acc
            }, {})
          },
          set: async (data: Record<string, unknown>) => {
            Object.assign(store, data)
          },
          remove: async () => {},
        },
      },
    }
    await setStorage({
      [KeyArticleToc]: 'on',
      [KeyScheduledPanorama]: 'on',
      [KeySidebarColumn]: 'off',
    })
    destroyArticleToc()
    removeSidebarScheduledPanorama()
  })

  it('buildThinScrollbarCss 重置继承并生成浅灰半透明 WebKit 细滚动条规则', () => {
    expect(buildThinScrollbarCss([])).toBe('')
    expect(buildThinScrollbarCss(['  ', ''])).toBe('')

    const css = buildThinScrollbarCss([' .foo ', '.bar'])
    expect(css).toContain('.foo,\n.bar {')
    expect(css).toContain('scrollbar-width: auto !important;')
    expect(css).toContain('scrollbar-color: auto !important;')
    expect(css).toContain('.foo::-webkit-scrollbar,\n.bar::-webkit-scrollbar {')
    expect(css).toContain('width: 5px !important;')
    expect(css).toContain('background: transparent !important;')
    expect(css).toContain('background: rgba(150, 150, 150, 0.2) !important;')
    expect(css).toContain('.foo:hover::-webkit-scrollbar-thumb,\n.bar:hover::-webkit-scrollbar-thumb {')
    expect(css).toContain('background: rgba(150, 150, 150, 0.26) !important;')
    expect(css).toContain('.foo::-webkit-scrollbar-thumb:hover,\n.bar::-webkit-scrollbar-thumb:hover {')
    expect(css).toContain('background: rgba(150, 150, 150, 0.34) !important;')
    expect(css).toContain('border-radius: 9999px !important;')
  })

  it('article-toc 注入与全扩展一致的浅色细滚动条和防滚动穿透样式', async () => {
    window.history.pushState({}, '', '/user/article/123')
    document.body.innerHTML = `
      <article data-testid="article">
        <div data-testid="twitterArticleReadView">
          <h1>一、第一章节</h1>
          <h2>1.1 子标题</h2>
        </div>
      </article>
    `

    await updateArticleToc(true)

    const styleEl = document.getElementById('xf-style-article-toc')
    expect(styleEl).not.toBeNull()
    const css = styleEl!.textContent || ''
    expect(css).toContain('.xf-toc-items')
    expect(css).toContain('overscroll-behavior: contain !important;')
    expect(css).toContain('scrollbar-width: auto !important;')
    expect(css).toContain('scrollbar-color: auto !important;')
    expect(css).toContain('.xf-toc-items:hover::-webkit-scrollbar-thumb')
    expect(css).toContain('background: rgba(150, 150, 150, 0.26) !important;')
    expect(css).toContain('background: rgba(150, 150, 150, 0.34) !important;')
    expect(css).toContain('.xf-toc-items::-webkit-scrollbar-track')
    expect(css).toContain('border-radius: 9999px !important;')
  })

  it('scheduled-time 注入全量排期滚动容器的一致浅色细滚动条规则', async () => {
    window.history.pushState({}, '', '/home')
    document.body.innerHTML = `
      <div data-testid="sidebarColumn" style="display: block; width: 350px;">
        <div>
          <form role="search"><input data-testid="SearchBox_Search_Input" /></form>
          <div class="existing-section">Trends</div>
        </div>
      </div>
    `

    await attachSidebarScheduledPanorama()

    const styleEl = document.getElementById('xf-style-scheduledPanoramaStyles')
    expect(styleEl).not.toBeNull()
    const css = styleEl!.textContent || ''
    for (const sel of [
      '.xf-floating-scroll-body',
      '.xf-sidebar-scheduled-panorama .xf-scheduled-body',
      '.xf-standalone-scheduled-sidebar',
      '.xf-scheduled-drawer',
      '.xf-scheduled-timeline-list',
    ]) {
      expect(css).toContain(sel)
    }
    expect(css).toContain('scrollbar-width: auto !important;')
    expect(css).toContain('scrollbar-color: auto !important;')
    expect(css).toContain('background: rgba(150, 150, 150, 0.26) !important;')
    expect(css).toContain('background: rgba(150, 150, 150, 0.34) !important;')
  })
})
