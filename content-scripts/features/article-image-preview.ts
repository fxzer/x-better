/**
 * 文章图片双列排版预览与大图查看器（仿微信公众号后台图集预览体验）
 * 功能：
 * - 在文章编辑页（/compose/articles/*）顶部操作栏注入「图片双列预览」按钮，同时在右下角提供快捷浮标
 * - 在文章阅读页（他人文章）顶栏「专注模式」放大图标左侧注入「图片预览」按钮，不再占用右下角
 * - 自动识别文章所有内嵌图片与封面图，以精美双列网格排版呈现
 * - 点击任意图片展开沉浸式高保真全屏大图查看器（Lightbox），支持键盘左右切换与 ESC 退出
 * - 完美适配 X 的亮色、Dim（暗蓝）与 Lights out（纯黑）模式
 */

export interface ArticleImageItem {
  index: number
  src: string
  origSrc: string
  width: number
  height: number
  isCover: boolean
  element?: HTMLImageElement
}

export function isArticlePage(pathname: string = window.location.pathname): boolean {
  return getArticlePageMode(pathname) !== null
}

type ArticlePageMode = 'compose' | 'read'

/**
 * 区分文章编辑页与阅读页：
 * - compose：自己正在编辑的文章（/compose/articles/* 或存在编辑器容器）
 * - read：他人文章阅读页（文章阅读视图，顶栏为「返回 / 文章 / 专注模式」）
 */
function getArticlePageMode(pathname: string = window.location.pathname): ArticlePageMode | null {
  if (/\/compose\/articles(\/|$)/.test(pathname)) return 'compose'
  if (typeof document === 'undefined') return null

  if (
    document.querySelector(
      '[data-testid="twitterArticleReadView"], [data-testid="twitterArticleRichTextView"]',
    )
  ) {
    return 'read'
  }
  if (
    document.querySelector(
      '[data-testid="composer"], [data-testid="composerRichTextInputContainer"]',
    )
  ) {
    return 'compose'
  }
  return null
}

/**
 * 提取文章中包含的所有图片（排除头像、图标、表情与微小元素）
 */
export function extractArticleImages(): ArticleImageItem[] {
  const images = Array.from(document.querySelectorAll<HTMLImageElement>('img'))
  const results: ArticleImageItem[] = []
  const seenSrcs = new Set<string>()

  for (const img of images) {
    const src = img.src || ''
    if (!src) continue

    // 排除插件图标、用户头像、默认图标
    if (src.startsWith('chrome-extension://') || src.startsWith('moz-extension://')) continue
    if (src.includes('/profile_images/') || src.includes('/default_profile')) continue
    if (img.closest('[data-testid^="UserAvatar"]')) continue

    const w = img.naturalWidth || img.width || 0
    const h = img.naturalHeight || img.height || 0
    // 过滤小于 100px 的图标或占位符
    if (w > 0 && w < 100) continue
    if (h > 0 && h < 100) continue

    if (seenSrcs.has(src)) continue
    seenSrcs.add(src)

    // 大图优化：Twitter 媒体链接转换为高清原图
    let origSrc = src
    if (origSrc.includes('pbs.twimg.com/media/')) {
      if (origSrc.includes('&name=') || origSrc.includes('?name=')) {
        origSrc = origSrc.replace(/name=[a-z0-9_]+/i, 'name=large')
      } else if (!origSrc.includes('?')) {
        origSrc = `${origSrc}?format=jpg&name=large`
      }
    }

    const isCover =
      results.length === 0 &&
      (Boolean(img.closest('[data-testid="twitterArticleReadView"]')) ||
        src.includes('pbs.twimg.com/media/'))

    results.push({
      index: results.length + 1,
      src,
      origSrc,
      width: w,
      height: h,
      isCover,
      element: img,
    })
  }

  return results
}

const MODAL_ID = 'xf-article-image-modal'
const LIGHTBOX_ID = 'xf-article-image-lightbox'
const TOP_BTN_ID = 'xf-article-img-preview-btn'
const FLOATING_BTN_ID = 'xf-article-img-floating-btn'

let currentImages: ArticleImageItem[] = []
let activeLightboxIndex = 0

/**
 * 打开图片双列排版预览弹窗
 */
export function openArticleImagePreviewModal(): void {
  currentImages = extractArticleImages()

  // 若已有弹窗先关闭刷新
  closeArticleImagePreviewModal()

  const modal = document.createElement('div')
  modal.id = MODAL_ID
  modal.className = 'xf-aim-overlay'

  const countText = `${currentImages.length} 张`

  modal.innerHTML = `
    <div class="xf-aim-panel" role="dialog" aria-modal="true" aria-label="文章图片预览">
      <div class="xf-aim-header">
        <div class="xf-aim-title-group">
          <div class="xf-aim-title">
            <span>文章图片预览</span>
            <span class="xf-aim-badge" id="xf-aim-total-badge">${countText}</span>
          </div>
          <div class="xf-aim-subtitle">双列排版对照 · 点击「图 X」定位到正文对应位置 · 点击图片查看大图</div>
        </div>
        <div class="xf-aim-actions">
          <button class="xf-aim-close-btn" id="xf-aim-close" title="关闭 (ESC)">✕</button>
        </div>
      </div>
      <div class="xf-aim-body">
        ${
          currentImages.length === 0
            ? '<div class="xf-aim-empty"><span>当前文章草稿中未检测到图片</span></div>'
            : `<div class="xf-aim-grid" id="xf-aim-grid">
                ${currentImages
                  .map(
                    (item, idx) => `
                  <div class="xf-aim-card" data-index="${idx}" tabindex="0" role="button" title="点击放大查看第 ${item.index} 张图片">
                    <div class="xf-aim-card-top">
                      <button type="button" class="xf-aim-tag ${item.isCover ? 'xf-aim-tag-cover' : ''}" data-jump-index="${idx}" title="点击定位到文章该图片位置">
                        <span>${item.isCover ? '封面' : `图 ${item.index}`}</span>
                        <span class="xf-aim-tag-locate">定位</span>
                      </button>
                      ${item.width && item.height ? `<span class="xf-aim-res">${item.width} × ${item.height}</span>` : ''}
                    </div>
                    <div class="xf-aim-img-wrap">
                      <img src="${item.src}" alt="文章图片 ${item.index}" loading="lazy" />
                      <div class="xf-aim-overlay-hover">
                        <span class="xf-aim-hover-tip">点击放大</span>
                      </div>
                    </div>
                  </div>
                `,
                  )
                  .join('')}
              </div>`
        }
      </div>
    </div>
  `

  injectArticlePreviewStyles()
  document.body.appendChild(modal)

  // 绑定事件
  const closeBtn = modal.querySelector('#xf-aim-close') as HTMLElement
  closeBtn.onclick = () => closeArticleImagePreviewModal()

  modal.onclick = (e) => {
    if (e.target === modal) {
      closeArticleImagePreviewModal()
    }
  }

  // 绑定“图 X / 定位”按钮快速跳转事件（阻止冒泡避免触发打开大图）
  const jumpButtons = modal.querySelectorAll<HTMLElement>('.xf-aim-tag[data-jump-index]')
  jumpButtons.forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation()
      const idx = parseInt(btn.getAttribute('data-jump-index') || '0', 10)
      scrollToArticleImage(idx)
    }
    btn.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        const idx = parseInt(btn.getAttribute('data-jump-index') || '0', 10)
        scrollToArticleImage(idx)
      }
    }
  })

  const cards = modal.querySelectorAll('.xf-aim-card')
  cards.forEach((card) => {
    const el = card as HTMLElement
    const clickHandler = (e: MouseEvent | KeyboardEvent) => {
      // 若点击的是定位按钮则不打开大图
      if ((e.target as HTMLElement)?.closest('.xf-aim-tag')) return
      const idx = parseInt(el.getAttribute('data-index') || '0', 10)
      openLightbox(idx)
    }
    el.onclick = (e) => clickHandler(e)
    el.onkeydown = (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault()
        clickHandler(ev)
      }
    }
  })

  // ESC 快捷键监听
  document.addEventListener('keydown', handleKeydownGlobal)
}

/**
 * 关闭双列排版预览弹窗
 */
export function closeArticleImagePreviewModal(): void {
  closeLightbox()
  const modal = document.getElementById(MODAL_ID)
  if (modal) modal.remove()
  document.removeEventListener('keydown', handleKeydownGlobal)
}

/**
 * 快速定位并平滑滚动到文章正文中对应的图片位置，并添加呼吸高亮提示
 */
export function scrollToArticleImage(index: number): boolean {
  if (index < 0 || index >= currentImages.length) return false
  const targetItem = currentImages[index]
  if (!targetItem) return false

  // 1. 优先使用提取时缓存的 DOM 节点引用
  let targetEl: HTMLElement | null =
    targetItem.element && targetItem.element.isConnected ? targetItem.element : null

  // 2. 若引用失效，通过特征重新在 DOM 中匹配
  if (!targetEl) {
    const allImgs = Array.from(document.querySelectorAll<HTMLImageElement>('img')).filter((img) => {
      const s = img.src || ''
      return (
        !s.startsWith('chrome-extension://') &&
        !s.startsWith('moz-extension://') &&
        !s.includes('/profile_images/') &&
        !s.includes('/default_profile') &&
        !img.closest('[data-testid^="UserAvatar"]') &&
        (img.naturalWidth > 100 || img.width > 100 || (img.naturalWidth === 0 && img.width === 0))
      )
    })

    targetEl = allImgs.find((img) => img.src === targetItem.src) || allImgs[index] || null
  }

  if (!targetEl) return false

  // 关闭全屏大图与预览弹窗
  closeLightbox()
  closeArticleImagePreviewModal()

  // 平滑滚动至视口正中
  if (typeof targetEl.scrollIntoView === 'function') {
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // 触发高亮光环
  flashImageHighlight(targetEl)

  return true
}

/**
 * 在目标图片周围动态渲染高保真脉冲高亮环，平滑跟随滚动并在结束后自动回收
 */
function flashImageHighlight(target: HTMLElement): void {
  const old = document.getElementById('xf-aim-spotlight')
  if (old) old.remove()

  const spotlight = document.createElement('div')
  spotlight.id = 'xf-aim-spotlight'
  spotlight.style.opacity = '0'
  document.body.appendChild(spotlight)

  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const duration = 2400

  const updatePosition = () => {
    if (!target.isConnected) {
      spotlight.remove()
      return
    }
    const rect = target.getBoundingClientRect()
    // 处于视口附近时才显示光环
    if (rect.bottom > 0 && rect.top < (typeof window !== 'undefined' ? window.innerHeight : 800)) {
      spotlight.style.left = `${rect.left - 4}px`
      spotlight.style.top = `${rect.top - 4}px`
      spotlight.style.width = `${rect.width + 8}px`
      spotlight.style.height = `${rect.height + 8}px`
      spotlight.style.opacity = '1'
    } else {
      spotlight.style.opacity = '0'
    }

    const elapsed =
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime
    if (elapsed < duration - 400) {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(updatePosition)
      } else {
        spotlight.remove()
      }
    } else if (elapsed < duration) {
      spotlight.style.opacity = '0'
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(updatePosition)
      } else {
        spotlight.remove()
      }
    } else {
      spotlight.remove()
    }
  }

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(updatePosition)
  } else {
    spotlight.remove()
  }
}

/**
 * 打开全屏大图查看器（Lightbox）
 */
export function openLightbox(index: number): void {
  if (!currentImages.length) return
  activeLightboxIndex = Math.max(0, Math.min(index, currentImages.length - 1))

  let lightbox = document.getElementById(LIGHTBOX_ID)
  if (!lightbox) {
    lightbox = document.createElement('div')
    lightbox.id = LIGHTBOX_ID
    lightbox.className = 'xf-aim-lightbox'
    lightbox.innerHTML = `
      <div class="xf-aim-lb-top">
        <div class="xf-aim-lb-counter">
          第 <strong id="xf-aim-lb-curr">1</strong> / <span id="xf-aim-lb-total">${currentImages.length}</span> 张
          <span class="xf-aim-lb-tag" id="xf-aim-lb-tag"></span>
        </div>
        <div class="xf-aim-lb-controls">
          <button id="xf-aim-lb-locate" type="button" class="xf-aim-lb-btn" title="关闭大图并定位到正文该图片位置">定位到正文 ↗</button>
          <a id="xf-aim-lb-open-orig" target="_blank" rel="noopener noreferrer" class="xf-aim-lb-btn" title="在新标签页打开原图">查看原图 ↗</a>
          <button id="xf-aim-lb-close" class="xf-aim-lb-btn xf-aim-lb-close" title="退出大图 (ESC)">✕</button>
        </div>
      </div>
      <div class="xf-aim-lb-stage">
        <button id="xf-aim-lb-prev" class="xf-aim-lb-nav xf-aim-lb-prev" title="上一张 (←)">◀</button>
        <div class="xf-aim-lb-img-container">
          <img id="xf-aim-lb-img" src="" alt="大图预览" />
        </div>
        <button id="xf-aim-lb-next" class="xf-aim-lb-nav xf-aim-lb-next" title="下一张 (→)">▶</button>
      </div>
      <div class="xf-aim-lb-info" id="xf-aim-lb-info"></div>
    `
    document.body.appendChild(lightbox)

    const lbClose = lightbox.querySelector('#xf-aim-lb-close') as HTMLElement
    lbClose.onclick = () => closeLightbox()

    const lbLocate = lightbox.querySelector('#xf-aim-lb-locate') as HTMLElement
    if (lbLocate) {
      lbLocate.onclick = () => {
        scrollToArticleImage(activeLightboxIndex)
      }
    }

    const lbPrev = lightbox.querySelector('#xf-aim-lb-prev') as HTMLElement
    lbPrev.onclick = (e) => {
      e.stopPropagation()
      stepLightbox(-1)
    }

    const lbNext = lightbox.querySelector('#xf-aim-lb-next') as HTMLElement
    lbNext.onclick = (e) => {
      e.stopPropagation()
      stepLightbox(1)
    }

    lightbox.onclick = (e) => {
      if (e.target === lightbox || (e.target as HTMLElement).classList.contains('xf-aim-lb-stage')) {
        closeLightbox()
      }
    }
  }

  updateLightboxContent()
}

function stepLightbox(delta: number): void {
  if (!currentImages.length) return
  const newIndex = activeLightboxIndex + delta
  if (newIndex >= 0 && newIndex < currentImages.length) {
    activeLightboxIndex = newIndex
    updateLightboxContent()
  }
}

function updateLightboxContent(): void {
  const lightbox = document.getElementById(LIGHTBOX_ID)
  if (!lightbox) return

  const item = currentImages[activeLightboxIndex]
  if (!item) return

  const currEl = lightbox.querySelector('#xf-aim-lb-curr')
  const totalEl = lightbox.querySelector('#xf-aim-lb-total')
  const tagEl = lightbox.querySelector('#xf-aim-lb-tag')
  const imgEl = lightbox.querySelector('#xf-aim-lb-img') as HTMLImageElement
  const origLink = lightbox.querySelector('#xf-aim-lb-open-orig') as HTMLAnchorElement
  const infoEl = lightbox.querySelector('#xf-aim-lb-info')
  const prevBtn = lightbox.querySelector('#xf-aim-lb-prev') as HTMLButtonElement
  const nextBtn = lightbox.querySelector('#xf-aim-lb-next') as HTMLButtonElement

  if (currEl) currEl.textContent = String(item.index)
  if (totalEl) totalEl.textContent = String(currentImages.length)
  if (tagEl) {
    tagEl.textContent = item.isCover ? '封面' : `图 ${item.index}`
    tagEl.setAttribute('title', '点击定位到正文对应位置')
    ;(tagEl as HTMLElement).style.cursor = 'pointer'
    ;(tagEl as HTMLElement).onclick = () => scrollToArticleImage(activeLightboxIndex)
  }
  if (imgEl) imgEl.src = item.origSrc || item.src
  if (origLink) origLink.href = item.origSrc || item.src
  if (infoEl) {
    infoEl.textContent =
      item.width && item.height ? `分辨率: ${item.width} × ${item.height}` : ''
  }

  if (prevBtn) prevBtn.style.opacity = activeLightboxIndex > 0 ? '1' : '0.2'
  if (nextBtn) nextBtn.style.opacity = activeLightboxIndex < currentImages.length - 1 ? '1' : '0.2'
}

/**
 * 关闭全屏大图查看器
 */
export function closeLightbox(): void {
  const lightbox = document.getElementById(LIGHTBOX_ID)
  if (lightbox) lightbox.remove()
}

function handleKeydownGlobal(e: KeyboardEvent): void {
  const hasLightbox = Boolean(document.getElementById(LIGHTBOX_ID))
  if (e.key === 'Escape') {
    e.preventDefault()
    if (hasLightbox) {
      closeLightbox()
    } else {
      closeArticleImagePreviewModal()
    }
  } else if (hasLightbox) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      e.preventDefault()
      stepLightbox(-1)
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      e.preventDefault()
      stepLightbox(1)
    }
  }
}

/**
 * 寻找长文章阅读视图顶部的“专注模式/放大”图标按钮
 */
export function findArticleHeaderFocusButton(): HTMLElement | null {
  // 1. 优先通过特定的属性查找
  const byAttr = document.querySelector<HTMLElement>(
    'a[aria-label="专注模式"], button[aria-label="专注模式"], a[aria-label*="Focus"], a[aria-label*="focus"], a[href*="/article/"]',
  )
  if (byAttr && byAttr.querySelector('svg')) {
    return byAttr
  }

  // 2. 通过放大图标（展开对角箭头）的 SVG path 特征匹配
  const candidateButtons = Array.from(document.querySelectorAll<HTMLElement>('a, button'))
  for (const btn of candidateButtons) {
    const d = btn.querySelector('svg path')?.getAttribute('d') || ''
    if (d.includes('M13 3h8v8h-2V6.41') || d.includes('M13 3h8v8')) {
      return btn
    }
  }

  return null
}

/**
 * 注入顶部操作按钮：编辑页插入胶囊按钮 + 浮标，阅读页只插入顶栏按钮
 */
export function renderArticleImagePreviewButtons(): void {
  const mode = getArticlePageMode()
  const existingTopBtn = document.getElementById(TOP_BTN_ID)
  const existingFloatingBtn = document.getElementById(FLOATING_BTN_ID)

  if (!mode) {
    if (existingTopBtn) existingTopBtn.remove()
    if (existingFloatingBtn) existingFloatingBtn.remove()
    closeArticleImagePreviewModal()
    return
  }

  // 阅读页（浏览他人文章）：按钮固定在顶栏「专注模式」放大图标左侧，不再出现右下角浮标
  if (mode === 'read') {
    if (existingFloatingBtn) existingFloatingBtn.remove()

    const focusBtn = findArticleHeaderFocusButton()
    if (focusBtn) {
      if (
        !existingTopBtn ||
        !existingTopBtn.isConnected ||
        existingTopBtn.nextElementSibling !== focusBtn
      ) {
        if (existingTopBtn) existingTopBtn.remove()

        const topBtn = document.createElement('button')
        topBtn.id = TOP_BTN_ID
        topBtn.className = 'xf-article-img-preview-btn xf-article-img-preview-btn-focus'
        topBtn.type = 'button'
        topBtn.innerHTML = `<span>图片预览</span>`
        topBtn.title = '像微信公众号一样预览文章全部图片（双列排版）'
        topBtn.onclick = () => openArticleImagePreviewModal()

        focusBtn.insertAdjacentElement('beforebegin', topBtn)
      }
    }

    injectArticlePreviewStyles()
    return
  }

  // 编辑器场景：寻找文章顶部的“预览”链接或“发布”按钮容器
  const publishBtn = Array.from(document.querySelectorAll('button')).find(
    (b) => ((b.innerText || b.textContent)?.trim() === '发布'),
  )
  const previewLink = Array.from(document.querySelectorAll('a')).find(
    (a) =>
      (a.innerText || a.textContent)?.trim() === '预览' &&
      a.getAttribute('href')?.includes('/preview'),
  )

  const targetContainer = previewLink?.parentElement || publishBtn?.parentElement?.parentElement
  if (targetContainer) {
    if (!existingTopBtn || !existingTopBtn.isConnected || !targetContainer.contains(existingTopBtn)) {
      if (existingTopBtn) existingTopBtn.remove()

      const topBtn = document.createElement('button')
      topBtn.id = TOP_BTN_ID
      topBtn.className = 'xf-article-img-preview-btn'
      topBtn.type = 'button'
      topBtn.innerHTML = `<span>图片预览</span>`
      topBtn.title = '像微信公众号一样预览文章全部图片（双列排版）'
      topBtn.onclick = () => openArticleImagePreviewModal()

      if (previewLink) {
        targetContainer.insertBefore(topBtn, previewLink)
      } else if (publishBtn?.parentElement) {
        targetContainer.insertBefore(topBtn, publishBtn.parentElement)
      } else {
        targetContainer.appendChild(topBtn)
      }
    }
  }

  // 编辑器右下角快捷浮标（确保深长文章随时一键展开）
  if (!existingFloatingBtn) {
    const floatingBtn = document.createElement('div')
    floatingBtn.id = FLOATING_BTN_ID
    floatingBtn.className = 'xf-article-img-floating-btn'
    floatingBtn.role = 'button'
    floatingBtn.tabIndex = 0
    floatingBtn.title = '查看文章图片双列排版预览 (仿微信公众号)'
    floatingBtn.innerHTML = `
      <span class="xf-aif-text">图片预览</span>
    `
    floatingBtn.onclick = () => openArticleImagePreviewModal()
    floatingBtn.onkeydown = (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault()
        openArticleImagePreviewModal()
      }
    }
    document.body.appendChild(floatingBtn)
  }

  injectArticlePreviewStyles()
}

function injectArticlePreviewStyles(): void {
  if (document.getElementById('xf-article-preview-styles')) return
  const style = document.createElement('style')
  style.id = 'xf-article-preview-styles'
  style.textContent = `
    /* 顶部按钮 */
    .${TOP_BTN_ID},
    #${TOP_BTN_ID} {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      padding: 0 14px !important;
      height: 32px !important;
      border-radius: 9999px !important;
      font-size: 13px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      border: 1px solid rgb(207, 217, 222) !important;
      background: rgba(15, 20, 25, 0.05) !important;
      color: rgb(15, 20, 25) !important;
      transition: all 0.15s ease !important;
      user-select: none !important;
      margin-right: 8px !important;
    }
    #${TOP_BTN_ID}.xf-article-img-preview-btn-focus {
      margin-left: 0 !important;
      margin-right: 8px !important;
      flex-shrink: 0 !important;
    }
    #${TOP_BTN_ID}:hover {
      background: rgba(15, 20, 25, 0.1) !important;
      border-color: rgb(185, 202, 211) !important;
    }
    body[style*="background-color: rgb(0, 0, 0)"] #${TOP_BTN_ID},
    body[style*="background-color: rgb(21, 32, 43)"] #${TOP_BTN_ID},
    html[style*="color-scheme: dark"] #${TOP_BTN_ID} {
      border-color: rgb(83, 100, 113) !important;
      background: rgba(255, 255, 255, 0.08) !important;
      color: rgb(231, 233, 234) !important;
    }
    body[style*="background-color: rgb(0, 0, 0)"] #${TOP_BTN_ID}:hover,
    body[style*="background-color: rgb(21, 32, 43)"] #${TOP_BTN_ID}:hover,
    html[style*="color-scheme: dark"] #${TOP_BTN_ID}:hover {
      background: rgba(255, 255, 255, 0.15) !important;
    }

    /* 右下角浮标 */
    #${FLOATING_BTN_ID} {
      position: fixed !important;
      right: 24px !important;
      bottom: 28px !important;
      z-index: 99997 !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 7px !important;
      padding: 9px 16px !important;
      border-radius: 9999px !important;
      font-size: 13px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18) !important;
      background: rgb(29, 155, 240) !important;
      color: #fff !important;
      border: 1px solid rgba(255, 255, 255, 0.2) !important;
      transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
      user-select: none !important;
    }
    #${FLOATING_BTN_ID}:hover {
      transform: translateY(-2px) scale(1.03) !important;
      box-shadow: 0 6px 22px rgba(29, 155, 240, 0.45) !important;
      background: rgb(26, 140, 216) !important;
    }

    /* 弹窗遮罩 */
    .xf-aim-overlay {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      z-index: 99998 !important;
      background: rgba(0, 0, 0, 0.6) !important;
      backdrop-filter: blur(8px) !important;
      -webkit-backdrop-filter: blur(8px) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 24px !important;
      animation: xfFadeIn 0.2s ease !important;
    }
    @keyframes xfFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* 弹窗主体面板 */
    .xf-aim-panel {
      width: 860px !important;
      max-width: 94vw !important;
      height: 86vh !important;
      max-height: 86vh !important;
      display: flex !important;
      flex-direction: column !important;
      border-radius: 18px !important;
      overflow: hidden !important;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35) !important;
      /* 亮色默认 */
      background: #ffffff !important;
      color: rgb(15, 20, 25) !important;
      border: 1px solid rgb(207, 217, 222) !important;
      animation: xfScaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }
    @keyframes xfScaleIn {
      from { transform: scale(0.96); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    /* 暗黑模式主体 */
    body[style*="background-color: rgb(0, 0, 0)"] .xf-aim-panel,
    body[style*="background-color: rgb(21, 32, 43)"] .xf-aim-panel,
    html[style*="color-scheme: dark"] .xf-aim-panel {
      background: #16181c !important;
      color: rgb(231, 233, 234) !important;
      border: 1px solid rgb(47, 51, 54) !important;
    }

    .xf-aim-header {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 16px 24px !important;
      border-bottom: 1px solid rgba(128, 128, 128, 0.15) !important;
      flex-shrink: 0 !important;
    }
    .xf-aim-title {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      font-size: 17px !important;
      font-weight: 700 !important;
    }
    .xf-aim-badge {
      font-size: 12px !important;
      font-weight: 600 !important;
      padding: 2px 8px !important;
      border-radius: 9999px !important;
      background: rgba(29, 155, 240, 0.12) !important;
      color: rgb(29, 155, 240) !important;
    }
    .xf-aim-subtitle {
      font-size: 12px !important;
      color: rgb(83, 100, 113) !important;
      margin-top: 3px !important;
    }
    body[style*="background-color: rgb(0, 0, 0)"] .xf-aim-subtitle,
    body[style*="background-color: rgb(21, 32, 43)"] .xf-aim-subtitle,
    html[style*="color-scheme: dark"] .xf-aim-subtitle {
      color: rgb(140, 147, 155) !important;
    }
    .xf-aim-close-btn {
      width: 32px !important;
      height: 32px !important;
      border-radius: 50% !important;
      border: none !important;
      background: transparent !important;
      cursor: pointer !important;
      font-size: 16px !important;
      color: inherit !important;
      opacity: 0.65 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      transition: all 0.15s ease !important;
    }
    .xf-aim-close-btn:hover {
      opacity: 1 !important;
      background: rgba(128, 128, 128, 0.15) !important;
    }

    /* 滚动网格区域 */
    .xf-aim-body {
      flex: 1 !important;
      overflow-y: auto !important;
      padding: 20px 24px !important;
      overscroll-behavior: contain !important;
    }
    .xf-aim-grid {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      gap: 16px !important;
    }
    @media (max-width: 640px) {
      .xf-aim-grid {
        grid-template-columns: 1fr !important;
      }
    }

    /* 单个图片卡片 */
    .xf-aim-card {
      display: flex !important;
      flex-direction: column !important;
      border-radius: 12px !important;
      overflow: hidden !important;
      background: rgba(128, 128, 128, 0.05) !important;
      border: 1px solid rgba(128, 128, 128, 0.18) !important;
      cursor: zoom-in !important;
      transition: all 0.2s ease !important;
      user-select: none !important;
    }
    .xf-aim-card:hover {
      border-color: rgb(29, 155, 240) !important;
      transform: translateY(-2px) !important;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12) !important;
    }
    .xf-aim-card-top {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 7px 12px !important;
      font-size: 11px !important;
      font-weight: 600 !important;
      border-bottom: 1px solid rgba(128, 128, 128, 0.1) !important;
      background: rgba(128, 128, 128, 0.04) !important;
    }
    .xf-aim-tag {
      display: inline-flex !important;
      align-items: center !important;
      gap: 5px !important;
      padding: 2px 8px !important;
      border-radius: 9999px !important;
      border: 1px solid rgba(128, 128, 128, 0.25) !important;
      background: rgba(128, 128, 128, 0.08) !important;
      color: inherit !important;
      font-size: 11px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      transition: all 0.15s ease !important;
      user-select: none !important;
      line-height: 1.4 !important;
    }
    .xf-aim-tag:hover {
      background: rgba(29, 155, 240, 0.12) !important;
      border-color: rgb(29, 155, 240) !important;
      color: rgb(29, 155, 240) !important;
      transform: translateY(-1px) !important;
    }
    .xf-aim-tag:active {
      transform: translateY(0) !important;
    }
    .xf-aim-tag-cover {
      border-color: rgba(29, 155, 240, 0.4) !important;
      background: rgba(29, 155, 240, 0.1) !important;
      color: rgb(29, 155, 240) !important;
      font-weight: 700 !important;
    }
    .xf-aim-tag-cover:hover {
      background: rgba(29, 155, 240, 0.2) !important;
      border-color: rgb(29, 155, 240) !important;
    }
    .xf-aim-tag-locate {
      font-size: 10px !important;
      font-weight: 500 !important;
      opacity: 0.75 !important;
      padding-left: 4px !important;
      border-left: 1px solid currentColor !important;
    }
    body[style*="background-color: rgb(0, 0, 0)"] .xf-aim-tag,
    body[style*="background-color: rgb(21, 32, 43)"] .xf-aim-tag,
    html[style*="color-scheme: dark"] .xf-aim-tag {
      border-color: rgba(255, 255, 255, 0.2) !important;
      background: rgba(255, 255, 255, 0.08) !important;
    }
    body[style*="background-color: rgb(0, 0, 0)"] .xf-aim-tag:hover,
    body[style*="background-color: rgb(21, 32, 43)"] .xf-aim-tag:hover,
    html[style*="color-scheme: dark"] .xf-aim-tag:hover {
      border-color: rgb(29, 155, 240) !important;
      background: rgba(29, 155, 240, 0.25) !important;
      color: rgb(29, 155, 240) !important;
    }
    #xf-aim-spotlight {
      position: fixed !important;
      border-radius: 16px !important;
      border: 3px solid rgb(29, 155, 240) !important;
      box-shadow: 0 0 25px rgba(29, 155, 240, 0.75), inset 0 0 16px rgba(29, 155, 240, 0.25) !important;
      pointer-events: none !important;
      z-index: 99999 !important;
      transition: opacity 0.35s ease !important;
    }
    .xf-aim-res {
      opacity: 0.5 !important;
      font-weight: 400 !important;
      font-family: monospace !important;
    }
    .xf-aim-img-wrap {
      position: relative !important;
      width: 100% !important;
      height: 220px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      background: rgba(0, 0, 0, 0.03) !important;
      overflow: hidden !important;
    }
    .xf-aim-img-wrap img {
      width: 100% !important;
      height: 100% !important;
      object-fit: cover !important;
      transition: transform 0.25s ease !important;
    }
    .xf-aim-card:hover .xf-aim-img-wrap img {
      transform: scale(1.04) !important;
    }
    .xf-aim-overlay-hover {
      position: absolute !important;
      inset: 0 !important;
      background: rgba(0, 0, 0, 0.25) !important;
      opacity: 0 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      transition: opacity 0.15s ease !important;
    }
    .xf-aim-card:hover .xf-aim-overlay-hover {
      opacity: 1 !important;
    }
    .xf-aim-hover-tip {
      background: rgba(0, 0, 0, 0.75) !important;
      color: #fff !important;
      padding: 5px 12px !important;
      border-radius: 9999px !important;
      font-size: 12px !important;
      font-weight: 600 !important;
      backdrop-filter: blur(4px) !important;
    }

    .xf-aim-empty {
      padding: 60px 0 !important;
      text-align: center !important;
      color: rgb(140, 147, 155) !important;
      font-size: 14px !important;
    }

    /* 沉浸式大图查看器 (Lightbox) */
    .xf-aim-lightbox {
      position: fixed !important;
      inset: 0 !important;
      z-index: 99999 !important;
      background: rgba(0, 0, 0, 0.94) !important;
      backdrop-filter: blur(12px) !important;
      -webkit-backdrop-filter: blur(12px) !important;
      display: flex !important;
      flex-direction: column !important;
      user-select: none !important;
      animation: xfFadeIn 0.15s ease !important;
    }
    .xf-aim-lb-top {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 16px 24px !important;
      color: #fff !important;
      font-size: 14px !important;
      flex-shrink: 0 !important;
    }
    .xf-aim-lb-counter {
      font-size: 14px !important;
      font-weight: 500 !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
    }
    .xf-aim-lb-tag {
      font-size: 11px !important;
      padding: 1px 6px !important;
      border-radius: 4px !important;
      background: rgb(29, 155, 240) !important;
      color: #fff !important;
      font-weight: 600 !important;
    }
    .xf-aim-lb-controls {
      display: flex !important;
      align-items: center !important;
      gap: 12px !important;
    }
    .xf-aim-lb-btn {
      color: #fff !important;
      text-decoration: none !important;
      font-size: 13px !important;
      padding: 6px 12px !important;
      border-radius: 9999px !important;
      background: rgba(255, 255, 255, 0.15) !important;
      border: none !important;
      cursor: pointer !important;
      transition: all 0.15s ease !important;
    }
    .xf-aim-lb-btn:hover {
      background: rgba(255, 255, 255, 0.25) !important;
    }
    .xf-aim-lb-close {
      width: 32px !important;
      height: 32px !important;
      padding: 0 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 16px !important;
    }

    .xf-aim-lb-stage {
      flex: 1 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 10px 24px !important;
      overflow: hidden !important;
      cursor: pointer !important;
    }
    .xf-aim-lb-nav {
      width: 44px !important;
      height: 44px !important;
      border-radius: 50% !important;
      background: rgba(255, 255, 255, 0.15) !important;
      border: none !important;
      color: #fff !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 16px !important;
      transition: all 0.15s ease !important;
      flex-shrink: 0 !important;
      z-index: 2 !important;
    }
    .xf-aim-lb-nav:hover {
      background: rgba(255, 255, 255, 0.3) !important;
      transform: scale(1.08) !important;
    }
    .xf-aim-lb-img-container {
      flex: 1 !important;
      height: 100% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 10px !important;
      cursor: default !important;
    }
    .xf-aim-lb-img-container img {
      max-width: 90vw !important;
      max-height: 82vh !important;
      object-fit: contain !important;
      border-radius: 8px !important;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6) !important;
      transition: transform 0.2s ease !important;
    }

    .xf-aim-lb-info {
      text-align: center !important;
      padding: 12px 0 18px !important;
      color: rgba(255, 255, 255, 0.6) !important;
      font-size: 12px !important;
      font-family: monospace !important;
      flex-shrink: 0 !important;
    }
  `
  document.head.appendChild(style)
}
