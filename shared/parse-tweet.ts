// 从 X.com 推文 article 元素中解析出文本/昵称/handle
// 抽到这里是为了可单测：jsdom 加载 HTML 字符串后调用即可

import { isInsideQuotedTweet } from './detect-language'

export * from './detect-language'

export interface TweetInfo {
  element: HTMLElement
  text: string
  authorHandle: string
  authorName: string
}

const NAVIGATION_HANDLES = new Set([
  'home',
  'explore',
  'notifications',
  'messages',
  'bookmarks',
  'profile',
  'i',
  'compose',
  'search',
  'settings',
])

/**
 * 提取推文中的 <a> 链接元素的完整文本，避免 URL 被视觉省略号截断：
 * X (Twitter) 在渲染外链时，会拆分为：
 *   1. 隐藏协议头 span（如 <span aria-hidden="true">https://</span>）
 *   2. 可见前缀文本（如 github.com/anthropics/Fla）
 *   3. 隐藏后缀文本 span（如 <span aria-hidden="true">shProve</span>）
 *   4. 省略号 span（如 <span aria-hidden="true" class="... r-lrvibr">…</span>）
 * 若直接读 textContent，会把结尾的视觉省略号也拼进去，导致变成 "https://github.com/anthropics/FlashProve…"
 * 本函数通过过滤纯视觉省略号节点，完整还原出真实的无省略 URL。
 */
export function extractAnchorFullText(
  doc: Document,
  a: HTMLElement,
): string {
  const walker = doc.createTreeWalker(a, NodeFilter.SHOW_ALL, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const elem = node as HTMLElement
        if (elem.hidden || elem.style?.display === 'none') {
          return NodeFilter.FILTER_REJECT
        }
        // Twitter 的视觉省略号节点通常带有 r-lrvibr 类，或者其文本仅为省略号
        const t = (elem.textContent || '').trim()
        if (t === '…' || t === '...') {
          return NodeFilter.FILTER_REJECT
        }
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let raw = ''
  let n: Node | null
  while ((n = walker.nextNode())) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.textContent || ''
      if (t.trim() !== '…' && t.trim() !== '...') {
        raw += t
      }
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as HTMLElement
      if (el.tagName.toUpperCase() === 'IMG') {
        raw += el.getAttribute('alt') || ''
      }
    }
  }

  let text = raw.trim()
  // 清理结尾可能残留的省略号（如 \u2026 或多个点）
  text = text.replace(/[\u2026]+$|\.{3,}$/, '')
  return text
}

/**
 * 收集元素的可见文本
 * X 把 emoji 渲染成 <img alt="🌸">，textContent 会漏掉，
 * 所以遍历时要把 img[alt] 也算进文本；遇到链接则提取完整无省略 URL。
 */
export function collectVisibleText(
  doc: Document,
  el: HTMLElement | null,
): string {
  if (!el) return ''
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_ALL, null)
  let result = ''
  let node: Node | null
  let currentAnchor: HTMLElement | null = null

  while ((node = walker.nextNode())) {
    if (currentAnchor) {
      if (currentAnchor.contains(node)) {
        continue
      }
      currentAnchor = null
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const e = node as HTMLElement
      const tag = e.tagName.toUpperCase()
      if (tag === 'A') {
        currentAnchor = e
        result += extractAnchorFullText(doc, e)
        continue
      }
      if (tag === 'IMG') {
        result += e.getAttribute('alt') || ''
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent || ''
    }
  }
  return result.replace(/\s+/g, ' ').trim()
}

/**
 * 从富文本文章容器中提取完整段落文本，保留段落/标题换行结构，
 * 并过滤掉图片、视频等媒体占位，只完整提取纯文字。
 */
export function collectArticleBodyText(
  doc: Document,
  articleEl: HTMLElement | null,
): string {
  if (!articleEl) return ''

  // 向下钻取单层无意义包装容器（如 DraftEditor-root / public-DraftEditor-content）
  let container = articleEl
  while (container.children.length === 1 && container.firstElementChild instanceof HTMLElement) {
    container = container.firstElementChild
  }

  // 1. 获取所有顶级段落/块级子元素（包括 h2, p, div 等）
  const children = Array.from(container.children) as HTMLElement[]
  if (children.length > 1) {
    const blocks: string[] = []
    for (const child of children) {
      const text = collectVisibleText(doc, child)
      if (text) {
        blocks.push(text)
      }
    }
    if (blocks.length > 0) {
      return blocks.join('\n\n')
    }
  }

  // 2. 若顶级直接子元素未能分块，尝试提取 [data-block="true"], p, h1~h6 等
  const candidateElements = Array.from(
    container.querySelectorAll<HTMLElement>(
      'h1, h2, h3, h4, h5, h6, [role="heading"], p, [data-block="true"], .longform-unstyled, li, blockquote, pre',
    ),
  )

  if (candidateElements.length > 0) {
    const topLevelBlocks = candidateElements.filter((el) => {
      let parent = el.parentElement
      while (parent && parent !== container) {
        if (candidateElements.includes(parent)) {
          return false
        }
        parent = parent.parentElement
      }
      return true
    })

    const paragraphs = topLevelBlocks
      .map((el) => collectVisibleText(doc, el))
      .filter(Boolean)

    if (paragraphs.length > 0) {
      return paragraphs.join('\n\n')
    }
  }

  // 若无特定分块标签，兜底直接提取容器内的完整可见文字
  return collectVisibleText(doc, container)
}

/**
 * 轻量提取推文作者 handle：仅 querySelector 查作者链接，不做 TreeWalker 全文解析。
 * 供高频路径（如 spam scanner 的 OP 判断）单独取 handle 用，
 * 避免为拿一个 handle 触发整条推文的昂贵解析。
 */
export function extractTweetHandle(article: HTMLElement): string {
  // author handle: 直接在 article 内部查找 /handle 链接，避免全局查询导致拿到错误用户，并排除引用推文卡片内的链接
  const handleLinks = article.querySelectorAll<HTMLAnchorElement>(
    'a[href^="/"][role="link"]',
  )
  for (const a of Array.from(handleLinks)) {
    if (isInsideQuotedTweet(a, article)) continue
    const m = a
      .getAttribute('href')
      ?.match(/^\/([A-Za-z0-9_]{1,15})(?:\/|$)/)
    if (m && m[1] && !NAVIGATION_HANDLES.has(m[1].toLowerCase())) {
      return m[1]
    }
  }
  return ''
}

function getPathnameFromContext(doc: Document, article?: HTMLElement): string {
  const docLoc = (article?.ownerDocument || doc)?.location?.pathname
  if (docLoc && docLoc !== 'blank') return docLoc

  const winLoc = (article?.ownerDocument || doc)?.defaultView?.location?.pathname
  if (winLoc && winLoc !== 'blank') return winLoc

  return typeof window !== 'undefined' ? window.location?.pathname || '' : ''
}

interface MainArticleFallbackEntry {
  article: HTMLElement | null
  at: number
}

const MAX_DOCUMENT_FALLBACK_ENTRIES = 8
const documentArticleFallbackCache = new WeakMap<Document, Map<string, MainArticleFallbackEntry>>()

export function _getDocumentArticleFallbackCacheSize(doc: Document): number {
  return documentArticleFallbackCache.get(doc)?.size ?? 0
}

function setDocumentArticleFallbackEntry(
  docMap: Map<string, MainArticleFallbackEntry>,
  statusId: string,
  article: HTMLElement | null,
): void {
  docMap.set(statusId, { article, at: Date.now() })
  if (docMap.size > MAX_DOCUMENT_FALLBACK_ENTRIES) {
    const oldestKey = docMap.keys().next().value
    if (oldestKey !== undefined) {
      docMap.delete(oldestKey)
    }
  }
}

function resolveMainStatusArticle(
  rootDoc: Document,
  statusId: string,
  statusRegex: RegExp,
): HTMLElement | null {
  let docMap = documentArticleFallbackCache.get(rootDoc)
  if (!docMap) {
    docMap = new Map()
    documentArticleFallbackCache.set(rootDoc, docMap)
  }

  const cached = docMap.get(statusId)
  if (cached !== undefined) {
    if (cached.article && cached.article.isConnected) {
      return cached.article
    }
    if (cached.article === null && Date.now() - cached.at < 1000) {
      return null
    }
  }

  const explicitLink = Array.from(
    rootDoc.querySelectorAll<HTMLAnchorElement>(`a[href*="/status/${statusId}"]`),
  ).find(
    (a) =>
      !a.closest('[data-testid="tweetText"], [data-testid="tweetTextContainer"]') &&
      !a.closest('[data-testid="quoteTweet"]') &&
      !a.closest('div[role="link"]') &&
      statusRegex.test(a.getAttribute('href') || ''),
  )

  let mainArticle: HTMLElement | null = null
  if (explicitLink) {
    mainArticle = explicitLink.closest<HTMLElement>('article[data-testid="tweet"]')
  }

  if (!mainArticle) {
    const firstTweet = rootDoc.querySelector<HTMLElement>('article[data-testid="tweet"]')
    if (firstTweet) {
      const otherStatusLink = Array.from(
        firstTweet.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'),
      ).some(
        (a) =>
          !a.closest('[data-testid="tweetText"], [data-testid="tweetTextContainer"]') &&
          !a.closest('[data-testid="quoteTweet"]') &&
          !a.closest('div[role="link"]') &&
          /\/status\/\d+/.test(a.getAttribute('href') || ''),
      )
      if (!otherStatusLink) {
        mainArticle = firstTweet
      }
    }
  }

  setDocumentArticleFallbackEntry(docMap, statusId, mainArticle)
  return mainArticle
}

/**
 * 详情页的全局兜底只允许用于主贴。
 * 评论区每条推文都会调用 extractTweetInfo；若不限制，
 * 会把主贴长文正文拼进每条评论。
 */
function canUseDocumentArticleFallback(doc: Document, article: HTMLElement): boolean {
  const pathname = getPathnameFromContext(doc, article)
  const statusMatch = pathname.match(/\/status\/(\d+)/)

  if (statusMatch) {
    const statusId = statusMatch[1]
    const statusRegex = new RegExp(`/status/${statusId}(?:[/?#]|$)`)
    const rootDoc = article.ownerDocument || doc

    const links = article.querySelectorAll<HTMLAnchorElement>(
      `a[href*="/status/${statusId}"]`,
    )
    for (const link of Array.from(links)) {
      // 评论里引用主贴时也会出现主贴链接，必须排除引用卡片内的链接
      if (isInsideQuotedTweet(link, article)) continue
      // 排除正文文本内部粘贴的超链接
      if (link.closest('[data-testid="tweetText"], [data-testid="tweetTextContainer"]')) continue
      const href = link.getAttribute('href') || ''
      if (statusRegex.test(href)) {
        let docMap = documentArticleFallbackCache.get(rootDoc)
        if (!docMap) {
          docMap = new Map()
          documentArticleFallbackCache.set(rootDoc, docMap)
        }
        setDocumentArticleFallbackEntry(docMap, statusId, article)
        return true
      }
    }

    const cachedMain = resolveMainStatusArticle(rootDoc, statusId, statusRegex)
    return cachedMain === article
  }

  // 文章页（/i/article/ 或 /[user]/article/）处理：
  // 仅当当前元素自带文章标题/阅读视图时允许，严格禁止读者评论继承长文
  const isArticlePage = /\/(?:i\/)?article\/(?:\d+|[A-Za-z0-9_-]+)/.test(pathname)
  if (isArticlePage) {
    return Boolean(
      article.querySelector('[data-testid="twitter-article-title"]') ||
      article.querySelector('[data-testid="twitterArticleRichTextView"]') ||
      article.querySelector('[data-testid="twitterArticleReadView"]'),
    )
  }

  return true
}

/**
 * 从推文 article 元素解析出 authorName/handle/text
 * 解析失败时返回 null（既没文本也没昵称）
 */
export function extractTweetInfo(
  doc: Document,
  article: HTMLElement,
  precomputedHandle?: string,
): TweetInfo | null {
  const handle =
    precomputedHandle ? precomputedHandle : extractTweetHandle(article)

  // 获取主推文昵称（排除引用推文中的 User-Name）
  const allUserNames = Array.from(article.querySelectorAll<HTMLElement>('[data-testid="User-Name"]'))
  const userNameEl = allUserNames.find((el) => !isInsideQuotedTweet(el, article)) || allUserNames[0]
  const authorName = collectVisibleText(doc, userNameEl)

  // 支持普通 Tweet (`tweetText`) 以及 X 文章 Article (`twitter-article-title` / `longformRichTextComponent` / `twitterArticleRichTextView` / `twitterArticleReadView`)
  // 1. 获取推文自带的正文（tweetText，例如推文导语）
  const allTweetTexts = Array.from(article.querySelectorAll<HTMLElement>('[data-testid="tweetText"]'))
  const textEl = allTweetTexts.find((el) => !isInsideQuotedTweet(el, article)) || allTweetTexts[0]
  const tweetIntroText = textEl ? collectVisibleText(doc, textEl) : ''

  // 2. 检查并提取 X 文章（Twitter Article）的大标题与完整正文
  const pathname = getPathnameFromContext(doc, article)
  const isDetailPage = /\/(?:status\/\d+|i\/article\/|article\/)/.test(pathname)
  const allowDocFallback = isDetailPage && canUseDocumentArticleFallback(doc, article)

  const titleEl =
    article.querySelector<HTMLElement>('[data-testid="twitter-article-title"]') ||
    (allowDocFallback ? doc.querySelector<HTMLElement>('[data-testid="twitter-article-title"]') : null)

  const articleBodyEl =
    article.querySelector<HTMLElement>('[data-testid="twitterArticleRichTextView"]') ||
    article.querySelector<HTMLElement>('[data-testid="twitterArticleReadView"]') ||
    article.querySelector<HTMLElement>('[data-testid="article-body"]') ||
    (allowDocFallback
      ? doc.querySelector<HTMLElement>('[data-testid="twitterArticleRichTextView"]') ||
        doc.querySelector<HTMLElement>('[data-testid="twitterArticleReadView"]')
      : null)

  const titleText = titleEl ? collectVisibleText(doc, titleEl) : ''
  const bodyText = articleBodyEl ? collectArticleBodyText(doc, articleBodyEl) : ''

  // 3. 完整拼装：绝不丢弃任何文章文字内容！
  // 若既有推文导语又有长文正文，按层级完整保留：导语 -> 标题 -> 正文
  const textParts: string[] = []
  if (tweetIntroText && tweetIntroText !== titleText) {
    textParts.push(tweetIntroText)
  }
  if (titleText && !bodyText.startsWith(titleText)) {
    textParts.push(`【文章标题】: ${titleText}`)
  }
  if (bodyText) {
    textParts.push(`【文章正文】:\n${bodyText}`)
  }

  const text = textParts.length > 0 ? textParts.join('\n\n') : tweetIntroText

  if (!text && !authorName) return null
  return { element: article, text, authorHandle: handle, authorName }
}

/**
 * 递归遍历收集元素的格式化可见文本，
 * 专为复制推文文案设计：
 * - 完整保留原本的段落换行与行内格式（避免被正则全部压成单个空格）
 * - 支持 <br> 显式换行
 * - 支持提取 <img> 的 alt 属性（X 把 Emoji 渲染为 <img alt="🌸">）
 * - 过滤隐藏节点以及内部的“显示更多 / Show more”等按钮元素
 */
export function collectFormattedTweetText(
  doc: Document,
  el: HTMLElement | null,
): string {
  if (!el) return ''

  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_ALL, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const elem = node as HTMLElement
        if (elem.hidden || elem.style?.display === 'none') {
          return NodeFilter.FILTER_REJECT
        }
        if (
          elem.getAttribute('role') === 'button' ||
          elem.tagName.toUpperCase() === 'BUTTON'
        ) {
          return NodeFilter.FILTER_REJECT
        }
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let raw = ''
  let node: Node | null
  let currentAnchor: HTMLElement | null = null

  while ((node = walker.nextNode())) {
    if (currentAnchor) {
      if (currentAnchor.contains(node)) {
        continue
      }
      currentAnchor = null
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const e = node as HTMLElement
      const tag = e.tagName.toUpperCase()
      if (tag === 'A') {
        currentAnchor = e
        raw += extractAnchorFullText(doc, e)
        continue
      }
      if (tag === 'BR') {
        raw += '\n'
        continue
      }
      if (tag === 'IMG') {
        raw += e.getAttribute('alt') || ''
        continue
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      raw += node.textContent || ''
    }
  }

  return raw
    .replace(/\r\n|\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 从富文本长文（Article）容器中提取纯净正文文本，保留段落/标题换行结构
 */
export function collectArticleCopyBodyText(
  doc: Document,
  articleEl: HTMLElement | null,
): string {
  if (!articleEl) return ''

  let container = articleEl
  while (container.children.length === 1 && container.firstElementChild instanceof HTMLElement) {
    container = container.firstElementChild
  }

  const children = Array.from(container.children) as HTMLElement[]
  if (children.length > 1) {
    const blocks: string[] = []
    for (const child of children) {
      const text = collectFormattedTweetText(doc, child)
      if (text) {
        blocks.push(text)
      }
    }
    if (blocks.length > 0) {
      return blocks.join('\n\n')
    }
  }

  const candidateElements = Array.from(
    container.querySelectorAll<HTMLElement>(
      'h1, h2, h3, h4, h5, h6, [role="heading"], p, [data-block="true"], .longform-unstyled, li, blockquote, pre',
    ),
  )

  if (candidateElements.length > 0) {
    const topLevelBlocks = candidateElements.filter((el) => {
      let parent = el.parentElement
      while (parent && parent !== container) {
        if (candidateElements.includes(parent)) {
          return false
        }
        parent = parent.parentElement
      }
      return true
    })

    const paragraphs = topLevelBlocks
      .map((el) => collectFormattedTweetText(doc, el))
      .filter(Boolean)

    if (paragraphs.length > 0) {
      return paragraphs.join('\n\n')
    }
  }

  return collectFormattedTweetText(doc, container)
}

/**
 * 提取推文用于剪贴板复制的纯文本内容：
 * 1. 优先提取当前推文正文（排除内部 Quote Tweet 引用推文）
 * 2. 完整保留换行与多行排版格式
 * 3. 提取 Emoji（img[alt]）与 <br>
 * 4. 兼容 Twitter Article 长文章与普通推文
 * 5. 过滤媒体，仅完整提取纯文本
 */
export function extractTweetCopyText(
  doc: Document,
  article: HTMLElement,
): string {
  // 1. 获取主推文的正文（排除引用推文中的 tweetText）
  const allTweetTexts = Array.from(article.querySelectorAll<HTMLElement>('[data-testid="tweetText"]'))
  const textEl = allTweetTexts.find((el) => !isInsideQuotedTweet(el, article)) || allTweetTexts[0]
  const tweetIntroText = textEl ? collectFormattedTweetText(doc, textEl) : ''

  // 2. 检查并提取 X 文章（Twitter Article）的大标题与完整正文
  const pathname = getPathnameFromContext(doc, article)
  const isDetailPage = /\/(?:status\/\d+|i\/article\/|article\/)/.test(pathname)
  const allowDocFallback = isDetailPage && canUseDocumentArticleFallback(doc, article)

  const titleEl =
    article.querySelector<HTMLElement>('[data-testid="twitter-article-title"]') ||
    (allowDocFallback ? doc.querySelector<HTMLElement>('[data-testid="twitter-article-title"]') : null)

  const articleBodyEl =
    article.querySelector<HTMLElement>('[data-testid="twitterArticleRichTextView"]') ||
    article.querySelector<HTMLElement>('[data-testid="twitterArticleReadView"]') ||
    article.querySelector<HTMLElement>('[data-testid="article-body"]') ||
    (allowDocFallback
      ? doc.querySelector<HTMLElement>('[data-testid="twitterArticleRichTextView"]') ||
        doc.querySelector<HTMLElement>('[data-testid="twitterArticleReadView"]')
      : null)

  const titleText = titleEl ? collectFormattedTweetText(doc, titleEl) : ''
  const bodyText = articleBodyEl ? collectArticleCopyBodyText(doc, articleBodyEl) : ''

  // 3. 组合推文导语、文章标题与正文
  const textParts: string[] = []
  if (tweetIntroText && tweetIntroText !== titleText && !bodyText.startsWith(tweetIntroText)) {
    textParts.push(tweetIntroText)
  }
  if (titleText && !bodyText.startsWith(titleText)) {
    textParts.push(titleText)
  }
  if (bodyText) {
    textParts.push(bodyText)
  }

  if (textParts.length > 0) {
    return textParts.join('\n\n')
  }

  return tweetIntroText
}
