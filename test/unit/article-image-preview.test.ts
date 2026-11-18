import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  isArticlePage,
  extractArticleImages,
  openArticleImagePreviewModal,
  closeArticleImagePreviewModal,
  openLightbox,
  closeLightbox,
  scrollToArticleImage,
  renderArticleImagePreviewButtons,
} from '../../content-scripts/features/article-image-preview'

describe('文章图片双列排版预览与大图查看器测试', () => {
  let dom: JSDOM

  const createDom = (url: string, htmlContent = '') => {
    dom = new JSDOM(
      `<!DOCTYPE html><html><head></head><body>${htmlContent}</body></html>`,
      { pretendToBeVisual: true, url },
    )
    globalThis.document = dom.window.document
    // @ts-expect-error jsdom window 类型
    globalThis.window = dom.window
    globalThis.location = dom.window.location
    globalThis.HTMLElement = dom.window.HTMLElement
    globalThis.HTMLImageElement = dom.window.HTMLImageElement
    globalThis.HTMLButtonElement = dom.window.HTMLButtonElement
    dom.window.HTMLElement.prototype.scrollIntoView = vi.fn()
  }

  afterEach(() => {
    closeArticleImagePreviewModal()
    closeLightbox()
    if (dom) dom.window.close()
  })

  it('isArticlePage 在 /compose/articles/edit/* 及文章页正确识别', () => {
    createDom('https://x.com/compose/articles/edit/2110182999413469184')
    expect(isArticlePage()).toBe(true)

    createDom('https://x.com/compose/articles/new')
    expect(isArticlePage()).toBe(true)

    createDom('https://x.com/home')
    expect(isArticlePage()).toBe(false)
  })

  it('extractArticleImages 正确提取文章内图片并过滤头像和微小图标', () => {
    const html = `
      <!-- 用户头像：应被过滤 -->
      <div data-testid="UserAvatar-Container-star_flow_ai">
        <img src="https://pbs.twimg.com/profile_images/123/avatar.jpg" width="48" height="48" />
      </div>

      <!-- 扩展程序图标：应被过滤 -->
      <img src="chrome-extension://abcdef/icon.svg" width="800" height="800" />

      <!-- 文章封面图：应被保留且识别为封面 -->
      <div data-testid="twitterArticleReadView">
        <img src="https://pbs.twimg.com/media/cover_img.jpg" width="1200" height="480" />
      </div>

      <!-- 文章正文插图：应被保留为大图 -->
      <div data-testid="composer">
        <img src="blob:https://x.com/blob-id-1" width="1199" height="675" />
        <img src="https://pbs.twimg.com/media/article_p2?format=jpg&name=medium" width="1200" height="800" />
      </div>
    `
    createDom('https://x.com/compose/articles/edit/2110182999413469184', html)

    const images = extractArticleImages()
    expect(images.length).toBe(3)

    // 第一张为封面
    expect(images[0].isCover).toBe(true)
    expect(images[0].src).toBe('https://pbs.twimg.com/media/cover_img.jpg')
    expect(images[0].origSrc).toContain('name=large')

    // 第二张为 blob 正文图片
    expect(images[1].src).toBe('blob:https://x.com/blob-id-1')
    expect(images[1].width).toBe(1199)
    expect(images[1].height).toBe(675)

    // 第三张为 Twitter media，且大图参数优化为 large
    expect(images[2].src).toContain('name=medium')
    expect(images[2].origSrc).toContain('name=large')
  })

  it('openArticleImagePreviewModal 渲染双列卡片布局并支持关闭', () => {
    const html = `
      <div data-testid="composer">
        <img src="blob:https://x.com/p1" width="1200" height="675" />
        <img src="blob:https://x.com/p2" width="1200" height="800" />
      </div>
    `
    createDom('https://x.com/compose/articles/edit/2110182999413469184', html)

    openArticleImagePreviewModal()

    const modal = document.getElementById('xf-article-image-modal')
    expect(modal).not.toBeNull()

    // 验证标题文案为简明的“文章图片预览”
    expect(modal!.querySelector('.xf-aim-title span')?.textContent).toBe('文章图片预览')

    // 验证双列网格与卡片数量
    const grid = modal!.querySelector('.xf-aim-grid')
    expect(grid).not.toBeNull()

    const cards = modal!.querySelectorAll('.xf-aim-card')
    expect(cards.length).toBe(2)

    // 验证关闭
    closeArticleImagePreviewModal()
    expect(document.getElementById('xf-article-image-modal')).toBeNull()
  })

  it('点击卡片头部 图 X / 定位 按钮快速定位并平滑滚动到正文对应图片位置', () => {
    const html = `
      <div data-testid="composer">
        <img id="img1" src="blob:https://x.com/img1" width="1000" height="500" />
        <img id="img2" src="blob:https://x.com/img2" width="1200" height="800" />
      </div>
    `
    createDom('https://x.com/compose/articles/edit/2110182999413469184', html)

    openArticleImagePreviewModal()

    const targetImg = document.getElementById('img2') as HTMLElement
    const scrollMock = vi.fn()
    targetImg.scrollIntoView = scrollMock

    // 获取第二个卡片的头部定位按钮（图 2 / 定位）
    const jumpBtn = document.querySelector('.xf-aim-tag[data-jump-index="1"]') as HTMLElement
    expect(jumpBtn).not.toBeNull()
    expect(jumpBtn.textContent).toContain('图 2')
    expect(jumpBtn.textContent).toContain('定位')

    // 点击定位按钮
    jumpBtn.click()

    // 弹窗应被自动关闭
    expect(document.getElementById('xf-article-image-modal')).toBeNull()

    // 目标图片应被触发平滑居中滚动
    expect(scrollMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  })

  it('点击卡片打开大图查看器 Lightbox，支持前后翻页与 ESC 退出', () => {
    const html = `
      <div data-testid="composer">
        <img src="blob:https://x.com/img1" width="1000" height="500" />
        <img src="blob:https://x.com/img2" width="1200" height="800" />
      </div>
    `
    createDom('https://x.com/compose/articles/edit/2110182999413469184', html)

    openArticleImagePreviewModal()
    const firstCard = document.querySelector('.xf-aim-card[data-index="0"]') as HTMLElement
    firstCard.click()

    const lightbox = document.getElementById('xf-article-image-lightbox')
    expect(lightbox).not.toBeNull()

    const currNumber = lightbox!.querySelector('#xf-aim-lb-curr')
    expect(currNumber?.textContent).toBe('1')

    // 下一张翻页
    const nextBtn = lightbox!.querySelector('#xf-aim-lb-next') as HTMLElement
    nextBtn.click()
    expect(currNumber?.textContent).toBe('2')

    // ESC 键盘退出大图
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.getElementById('xf-article-image-lightbox')).toBeNull()
  })

  it('renderArticleImagePreviewButtons 在文章编辑页注入顶部按钮与浮标', () => {
    const html = `
      <div>
        <a href="/compose/articles/edit/123/preview"><span>预览</span></a>
        <div><button><span>发布</span></button></div>
      </div>
    `
    createDom('https://x.com/compose/articles/edit/2110182999413469184', html)

    renderArticleImagePreviewButtons()

    const topBtn = document.getElementById('xf-article-img-preview-btn')
    const floatingBtn = document.getElementById('xf-article-img-floating-btn')

    expect(topBtn).not.toBeNull()
    expect(floatingBtn).not.toBeNull()
  })

  it('renderArticleImagePreviewButtons 在他人文章阅读页注入顶栏放大图标左侧且不显示底部浮标', () => {
    const html = `
      <div id="app-bar">
        <div>
          <button data-testid="app-bar-back" type="button">
            <svg viewBox="0 0 24 24"><path d="M7.414 13l5.043 5.04-1.414 1.42L3.586 12l7.457-7.46 1.414 1.42L7.414 11H21v2H7.414z"></path></svg>
          </button>
        </div>
        <div><h2 role="heading" aria-level="2">文章</h2></div>
        <div id="app-bar-actions">
          <div id="action-group">
            <a
              href="/anewczs/article/2119673620570034494"
              aria-label="专注模式"
              role="link"
            >
              <svg viewBox="0 0 24 24"><path d="M13 3h8v8h-2V6.41l-5.043 5.05-1.414-1.42L17.586 5H13V3zm-1.543 10.96L6.414 19H11v2H3v-8h2v4.59l5.043-5.05 1.414 1.42z"></path></svg>
            </a>
          </div>
        </div>
      </div>
      <div data-testid="twitterArticleReadView">
        <img src="https://pbs.twimg.com/media/article_cover.jpg" width="1200" height="480" />
      </div>
    `
    createDom('https://x.com/anewczs/status/2119673620570034494', html)

    renderArticleImagePreviewButtons()

    const focusLink = document.querySelector('a[aria-label="专注模式"]')
    const topBtn = document.getElementById('xf-article-img-preview-btn')

    // 按钮插入在「专注模式」放大图标左侧（同一操作组内）
    expect(topBtn).not.toBeNull()
    expect(topBtn!.nextElementSibling).toBe(focusLink)
    expect(topBtn!.parentElement?.id).toBe('action-group')

    // 阅读页不再渲染右下角浮标
    expect(document.getElementById('xf-article-img-floating-btn')).toBeNull()

    // 重复调用保持幂等，不产生重复按钮
    renderArticleImagePreviewButtons()
    expect(document.querySelectorAll('#xf-article-img-preview-btn').length).toBe(1)
  })

  it('renderArticleImagePreviewButtons 通过放大图标 SVG 特征兼容非中文界面', () => {
    const html = `
      <div>
        <div>
          <a href="/someone/article/123" role="link">
            <svg viewBox="0 0 24 24"><path d="M13 3h8v8h-2V6.41l-5.043 5.05-1.414-1.42L17.586 5H13V3z"></path></svg>
          </a>
        </div>
      </div>
      <div data-testid="twitterArticleReadView"></div>
    `
    createDom('https://x.com/someone/article/123', html)

    renderArticleImagePreviewButtons()

    const focusLink = document.querySelector('a[href="/someone/article/123"]')
    const topBtn = document.getElementById('xf-article-img-preview-btn')
    expect(topBtn).not.toBeNull()
    expect(topBtn!.nextElementSibling).toBe(focusLink)
  })
})
