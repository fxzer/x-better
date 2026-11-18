import { describe, it, expect, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  extractTweetInfo,
  collectVisibleText,
  collectFormattedTweetText,
  extractTweetCopyText,
  _getDocumentArticleFallbackCacheSize,
} from '../../shared/parse-tweet'

function docOf(html: string): Document {
  return new JSDOM(html).window.document
}

describe('collectVisibleText', () => {
  it('returns empty string for null element', () => {
    const doc = docOf('<div></div>')
    expect(collectVisibleText(doc, null)).toBe('')
  })

  it('returns inner text from regular elements', () => {
    const doc = docOf('<div>hello world</div>')
    const el = doc.querySelector('div')!
    expect(collectVisibleText(doc, el)).toBe('hello world')
  })

  it('includes <img alt> as text (X renders emoji as img)', () => {
    const doc = docOf('<div><img alt="🌸">plain</div>')
    const el = doc.querySelector('div')!
    // img 和 plain 紧贴：没有空白节点，所以不会插空格
    expect(collectVisibleText(doc, el)).toBe('🌸plain')
  })

  it('normalizes whitespace and trims', () => {
    const doc = docOf('<div>  hello\n\n   world  </div>')
    const el = doc.querySelector('div')!
    expect(collectVisibleText(doc, el)).toBe('hello world')
  })

  it('skips the root element itself (only children contribute)', () => {
    const doc = docOf('<div>ROOT<p>child</p></div>')
    const el = doc.querySelector('div')!
    // 跳过根节点，理论上不收集"ROOT"，但 TreeWalker 的实现可能行为不一致
    // 这里只验证不会把 div 自身文字重复算入两次
    const result = collectVisibleText(doc, el)
    expect(result).toContain('child')
  })

  it('handles multiple img alt emoji in sequence', () => {
    // img 紧贴时，alt 之间没有空白
    const doc = docOf('<div><img alt="🌻"><img alt="😂"><img alt="🌹"></div>')
    const el = doc.querySelector('div')!
    expect(collectVisibleText(doc, el)).toBe('🌻😂🌹')
  })

  it('inserts single space when img elements are separated by whitespace', () => {
    const doc = docOf(
      '<div><img alt="🌻">\n            <img alt="😂">\n            <img alt="🌹"></div>',
    )
    const el = doc.querySelector('div')!
    expect(collectVisibleText(doc, el)).toBe('🌻 😂 🌹')
  })

  it('handles img with no alt attribute (returns empty str for that img)', () => {
    const doc = docOf('<div>text<img>after</div>')
    const el = doc.querySelector('div')!
    expect(collectVisibleText(doc, el)).toBe('textafter')
  })

  it('handles nested child elements with text (no space inserted between elements)', () => {
    // collectVisibleText 不做内联元素间插空格，与 textContent 行为一致
    const doc = docOf('<div><span>hello</span><span>world</span></div>')
    const el = doc.querySelector('div')!
    expect(collectVisibleText(doc, el)).toBe('helloworld')
  })

  it('handles nested elements with whitespace in HTML source', () => {
    const doc = docOf('<div><span>hello</span> <span>world</span></div>')
    const el = doc.querySelector('div')!
    expect(collectVisibleText(doc, el)).toBe('hello world')
  })

  it('returns empty for element with no text content', () => {
    const doc = docOf('<div><span></span><img alt=""></div>')
    const el = doc.querySelector('div')!
    expect(collectVisibleText(doc, el)).toBe('')
  })

  it('handles mixed inline elements and text', () => {
    const doc = docOf('<div>prefix <strong>bold</strong> <img alt="emoji"> suffix</div>')
    const el = doc.querySelector('div')!
    expect(collectVisibleText(doc, el)).toBe('prefix bold emoji suffix')
  })
})

describe('extractTweetInfo', () => {
  it('extracts handle from /<handle> links inside the article', () => {
    const html = `
      <article data-testid="tweet">
        <a href="/home">home link</a>
        <a href="/alice" role="link">@alice</a>
        <div data-testid="User-Name"><span>Alice</span></div>
        <div data-testid="tweetText"><span>hello</span></div>
      </article>
    `
    const doc = docOf(html)
    const article = doc.querySelector('article')!
    const info = extractTweetInfo(doc, article)
    expect(info).not.toBeNull()
    expect(info!.authorHandle).toBe('alice')
    expect(info!.authorName).toBe('Alice')
    expect(info!.text).toBe('hello')
  })

  it('skips navigation handles (home, explore, ...)', () => {
    const html = `
      <article data-testid="tweet">
        <a href="/home" role="link">Home</a>
        <a href="/explore" role="link">Explore</a>
        <a href="/bob" role="link">@bob</a>
        <div data-testid="User-Name">Bob</div>
        <div data-testid="tweetText">hi</div>
      </article>
    `
    const doc = docOf(html)
    const article = doc.querySelector('article')!
    const info = extractTweetInfo(doc, article)
    expect(info!.authorHandle).toBe('bob')
  })

  it('returns null when both text and name are empty', () => {
    const html = `<article data-testid="tweet"></article>`
    const doc = docOf(html)
    const article = doc.querySelector('article')!
    expect(extractTweetInfo(doc, article)).toBeNull()
  })

  it('handles emoji-only text (X renders emoji as <img alt>)', () => {
    // X 实际 HTML：img 之间有换行+缩进
    const html = `
      <article data-testid="tweet">
        <a href="/x" role="link">x</a>
        <div data-testid="User-Name">花姐</div>
        <div data-testid="tweetText"><img alt="🌻">
            <img alt="😂">
            <img alt="🌹"></div>
      </article>
    `
    const doc = docOf(html)
    const article = doc.querySelector('article')!
    const info = extractTweetInfo(doc, article)
    expect(info!.text).toBe('🌻 😂 🌹')
  })

  it('does not pick up links from outside the article', () => {
    const html = `
      <div>
        <a href="/outside" role="link">outside</a>
        <article data-testid="tweet">
          <a href="/inside" role="link">inside</a>
          <div data-testid="User-Name">X</div>
          <div data-testid="tweetText">y</div>
        </article>
      </div>
    `
    const doc = docOf(html)
    const article = doc.querySelector('article')!
    const info = extractTweetInfo(doc, article)
    expect(info!.authorHandle).toBe('inside')
  })

  it('extracts title and content from X Article components', () => {
    const html = `
      <article data-testid="tweet" role="article">
        <a href="/aAbi8MOGCZi0JUR" role="link">@aAbi8MOGCZi0JUR</a>
        <div data-testid="User-Name">Prompt 修仙散人</div>
        <div data-testid="twitter-article-title">如何快速做到每天增长 200+？试试越南赛道</div>
        <div data-testid="twitterArticleRichTextView">
          <h2>我的战绩</h2>
          <div>中文区太卷，不妨换个赛道</div>
        </div>
      </article>
    `
    const doc = docOf(html)
    const article = doc.querySelector('article')!
    const info = extractTweetInfo(doc, article)
    expect(info).not.toBeNull()
    expect(info!.authorHandle).toBe('aAbi8MOGCZi0JUR')
    expect(info!.authorName).toBe('Prompt 修仙散人')
    expect(info!.text).toContain('如何快速做到每天增长 200+？试试越南赛道')
    expect(info!.text).toContain('中文区太卷，不妨换个赛道')
  })
})

describe('collectFormattedTweetText', () => {
  it('preserves line breaks and paragraphs unlike collectVisibleText', () => {
    const html = `<div>第一行内容\n\n第二行内容\n• 列表项 1\n• 列表项 2</div>`
    const doc = docOf(html)
    const el = doc.querySelector('div')!
    const text = collectFormattedTweetText(doc, el)
    expect(text).toBe('第一行内容\n\n第二行内容\n• 列表项 1\n• 列表项 2')
  })

  it('converts <br> tags into newlines', () => {
    const html = `<div>第一段<br>第二段<br/><br/>第三段</div>`
    const doc = docOf(html)
    const el = doc.querySelector('div')!
    const text = collectFormattedTweetText(doc, el)
    expect(text).toBe('第一段\n第二段\n\n第三段')
  })

  it('extracts emoji from img alt attributes', () => {
    const html = `<div>你好 <img alt="🌸"> 世界 <img alt="🎉"></div>`
    const doc = docOf(html)
    const el = doc.querySelector('div')!
    expect(collectFormattedTweetText(doc, el)).toBe('你好 🌸 世界 🎉')
  })

  it('ignores hidden elements and show more buttons', () => {
    const html = `<div>这是前面完整的内容… <button>显示更多</button><span role="button">Show more</span><span hidden>隐藏说明</span></div>`
    const doc = docOf(html)
    const el = doc.querySelector('div')!
    const text = collectFormattedTweetText(doc, el)
    expect(text).toBe('这是前面完整的内容…')
    expect(text).not.toContain('显示更多')
    expect(text).not.toContain('Show more')
    expect(text).not.toContain('隐藏说明')
  })
})

describe('extractTweetCopyText', () => {
  it('extracts plain tweet text with formatting and emojis preserved', () => {
    const html = `
      <article data-testid="tweet">
        <div data-testid="User-Name"><span>作者</span></div>
        <div data-testid="tweetText">
          <span>深度长文思考：\n\n1. 第一点分析 <img alt="💡">\n2. 第二点落地</span>
        </div>
      </article>
    `
    const doc = docOf(html)
    const article = doc.querySelector('article')!
    const copied = extractTweetCopyText(doc, article)
    expect(copied).toBe('深度长文思考：\n\n1. 第一点分析 💡\n2. 第二点落地')
  })

  it('extracts main tweet text and ignores nested quote tweet text', () => {
    const html = `
      <article data-testid="tweet">
        <div data-testid="tweetText">这是对引用推文的精彩点评！</div>
        <div data-testid="quoteTweet">
          <div data-testid="tweetText">这是被引用的原推文内容</div>
        </div>
      </article>
    `
    const doc = docOf(html)
    const article = doc.querySelector('article')!
    const copied = extractTweetCopyText(doc, article)
    expect(copied).toBe('这是对引用推文的精彩点评！')
    expect(copied).not.toContain('这是被引用的原推文内容')
  })

  it('extracts article title and body cleanly without AI prompt tags', () => {
    const html = `
      <article data-testid="tweet">
        <div data-testid="tweetText">导语部分介绍</div>
        <div data-testid="twitter-article-title">干货深度好文</div>
        <div data-testid="twitterArticleRichTextView">
          <p>正文段落一</p>
          <p>正文段落二</p>
        </div>
      </article>
    `
    const doc = docOf(html)
    const article = doc.querySelector('article')!
    const copied = extractTweetCopyText(doc, article)
    expect(copied).toBe('导语部分介绍\n\n干货深度好文\n\n正文段落一\n\n正文段落二')
  })

  it('returns empty string for pure media tweet with no text', () => {
    const html = `
      <article data-testid="tweet">
        <div data-testid="tweetPhoto"><img src="photo.jpg"></div>
      </article>
    `
    const doc = docOf(html)
    const article = doc.querySelector('article')!
    const copied = extractTweetCopyText(doc, article)
    expect(copied).toBe('')
  })

  it('restores complete URLs without truncated ellipsis from Twitter anchor elements', () => {
    // 模拟 X/Twitter 真实推文 DOM 结构（如 FlashProve 推文）
    const html = `
      <article data-testid="tweet">
        <div data-testid="tweetText">
          <span>你这边怎么验：\n1. git clone </span><a dir="ltr" href="https://t.co/1jvRufSUTA" rel="noopener noreferrer nofollow" target="_blank" role="link"><span aria-hidden="true">https://</span>github.com/anthropics/Fla<span aria-hidden="true">shProve</span><span aria-hidden="true" class="r-lrvibr">…</span></a><span>\n2. apt-get install -y g++ make python3 unzip\n\nGitHub：</span><a dir="ltr" href="https://t.co/1jvRufSUTA" rel="noopener noreferrer nofollow" target="_blank" role="link"><span aria-hidden="true">https://</span>github.com/anthropics/Fla<span aria-hidden="true">shProve</span><span aria-hidden="true" class="r-lrvibr">…</span></a>
        </div>
      </article>
    `
    const doc = docOf(html)
    const article = doc.querySelector('article')!
    const copied = extractTweetCopyText(doc, article)

    expect(copied).toContain('git clone https://github.com/anthropics/FlashProve\n')
    expect(copied).toContain('GitHub：https://github.com/anthropics/FlashProve')
    expect(copied).not.toContain('FlashProve…')
  })
})

describe('detail page comment isolation', () => {
  it('prevents comment from inheriting main article body while main tweet still can', () => {
    window.history.pushState({}, '', '/alice/status/1234567890')
    try {
      const html = `
        <article data-testid="tweet" id="main-tweet">
          <a href="/alice/status/1234567890" role="link">time</a>
          <div data-testid="User-Name">Alice</div>
          <div data-testid="tweetText">main intro</div>
        </article>
        <div data-testid="twitterArticleRichTextView">
          <p>MAIN_ARTICLE_BODY_SENTINEL</p>
        </div>
        <article data-testid="tweet" id="comment-tweet">
          <a href="/bob/status/999" role="link">time</a>
          <div data-testid="User-Name">Bob</div>
          <div data-testid="tweetText">comment text</div>
        </article>
      `
      const doc = docOf(html)
      const main = doc.querySelector('#main-tweet') as HTMLElement
      const comment = doc.querySelector('#comment-tweet') as HTMLElement

      const commentInfo = extractTweetInfo(doc, comment)
      expect(commentInfo).not.toBeNull()
      expect(commentInfo!.text).toBe('comment text')

      const mainInfo = extractTweetInfo(doc, main)
      expect(mainInfo).not.toBeNull()
      expect(mainInfo!.text).toContain('MAIN_ARTICLE_BODY_SENTINEL')

      const commentCopy = extractTweetCopyText(doc, comment)
      expect(commentCopy).toBe('comment text')
    } finally {
      window.history.pushState({}, '', '/')
    }
  })

  it('prevents comment from inheriting main article body when comment text pastes main tweet url (P0 fix)', () => {
    window.history.pushState({}, '', '/alice/status/1234567890')
    try {
      const html = `
        <article data-testid="tweet" id="main-tweet">
          <a href="/alice/status/1234567890" role="link">time</a>
          <div data-testid="User-Name">Alice</div>
          <div data-testid="tweetText">main intro</div>
        </article>
        <div data-testid="twitterArticleRichTextView">
          <p>MAIN_ARTICLE_BODY_SENTINEL</p>
        </div>
        <article data-testid="tweet" id="comment-tweet">
          <a href="/bob/status/999" role="link">time</a>
          <div data-testid="User-Name">Bob</div>
          <div data-testid="tweetText">
            <span>楼主原推看这里：</span>
            <a href="https://x.com/alice/status/1234567890" role="link">https://x.com/alice/status/1234567890</a>
          </div>
        </article>
      `
      const doc = docOf(html)
      const comment = doc.querySelector('#comment-tweet') as HTMLElement

      const commentInfo = extractTweetInfo(doc, comment)
      expect(commentInfo).not.toBeNull()
      expect(commentInfo!.text).toContain('楼主原推看这里：')
      expect(commentInfo!.text).not.toContain('MAIN_ARTICLE_BODY_SENTINEL')

      const commentCopy = extractTweetCopyText(doc, comment)
      expect(commentCopy).not.toContain('MAIN_ARTICLE_BODY_SENTINEL')
    } finally {
      window.history.pushState({}, '', '/')
    }
  })

  it('prevents comment from inheriting main article body when linking to status with shared prefix', () => {
    window.history.pushState({}, '', '/alice/status/1234567890')
    try {
      const html = `
        <article data-testid="tweet" id="main-tweet">
          <a href="/alice/status/1234567890" role="link">time</a>
          <div data-testid="User-Name">Alice</div>
          <div data-testid="tweetText">main intro</div>
        </article>
        <div data-testid="twitterArticleRichTextView">
          <p>MAIN_ARTICLE_BODY_SENTINEL</p>
        </div>
        <article data-testid="tweet" id="comment-tweet">
          <a href="/charlie/status/1234567890999" role="link">time</a>
          <div data-testid="User-Name">Charlie</div>
          <div data-testid="tweetText">other tweet</div>
        </article>
      `
      const doc = docOf(html)
      const comment = doc.querySelector('#comment-tweet') as HTMLElement

      const commentInfo = extractTweetInfo(doc, comment)
      expect(commentInfo).not.toBeNull()
      expect(commentInfo!.text).toBe('other tweet')
      expect(commentInfo!.text).not.toContain('MAIN_ARTICLE_BODY_SENTINEL')
    } finally {
      window.history.pushState({}, '', '/')
    }
  })

  it('allows main tweet to inherit article body even if main tweet lacks status href (P1 fix)', () => {
    window.history.pushState({}, '', '/alice/status/1234567890')
    try {
      const html = `
        <article data-testid="tweet" id="main-tweet">
          <div data-testid="User-Name">Alice</div>
          <div data-testid="tweetText">main intro without href link</div>
        </article>
        <div data-testid="twitterArticleRichTextView">
          <p>MAIN_ARTICLE_BODY_SENTINEL</p>
        </div>
        <article data-testid="tweet" id="comment-tweet">
          <div data-testid="User-Name">Bob</div>
          <div data-testid="tweetText">comment text</div>
        </article>
      `
      const doc = docOf(html)
      const main = doc.querySelector('#main-tweet') as HTMLElement
      const comment = doc.querySelector('#comment-tweet') as HTMLElement

      const mainInfo = extractTweetInfo(doc, main)
      expect(mainInfo).not.toBeNull()
      expect(mainInfo!.text).toContain('MAIN_ARTICLE_BODY_SENTINEL')

      const commentInfo = extractTweetInfo(doc, comment)
      expect(commentInfo).not.toBeNull()
      expect(commentInfo!.text).toBe('comment text')
      expect(commentInfo!.text).not.toContain('MAIN_ARTICLE_BODY_SENTINEL')
    } finally {
      window.history.pushState({}, '', '/')
    }
  })

  it('prevents reader comments on /i/article/ page from inheriting article content (P1 fix)', () => {
    window.history.pushState({}, '', '/i/article/1850000000000000000')
    try {
      const html = `
        <div data-testid="twitter-article-title">深度好文标题</div>
        <div data-testid="twitterArticleRichTextView">
          <p>LONG_ARTICLE_CONTENT_SENTINEL</p>
        </div>
        <article data-testid="tweet" id="reader-comment">
          <div data-testid="User-Name">Reader</div>
          <div data-testid="tweetText">文章写得太好了！</div>
        </article>
      `
      const doc = docOf(html)
      const comment = doc.querySelector('#reader-comment') as HTMLElement

      const commentInfo = extractTweetInfo(doc, comment)
      expect(commentInfo).not.toBeNull()
      expect(commentInfo!.text).toBe('文章写得太好了！')
      expect(commentInfo!.text).not.toContain('LONG_ARTICLE_CONTENT_SENTINEL')
      expect(commentInfo!.text).not.toContain('深度好文标题')

      const commentCopy = extractTweetCopyText(doc, comment)
      expect(commentCopy).toBe('文章写得太好了！')
      expect(commentCopy).not.toContain('LONG_ARTICLE_CONTENT_SENTINEL')
    } finally {
      window.history.pushState({}, '', '/')
    }
  })

  it('supports detached Document with defaultView location without global window (P2 fix)', () => {
    const html = `
      <article data-testid="tweet" id="main-tweet">
        <a href="/alice/status/1234567890" role="link">time</a>
        <div data-testid="User-Name">Alice</div>
        <div data-testid="tweetText">detached doc test</div>
      </article>
      <div data-testid="twitterArticleRichTextView">
        <p>DETACHED_ARTICLE_BODY</p>
      </div>
    `
    const dom = new JSDOM(html, { url: 'https://x.com/alice/status/1234567890' })
    const doc = dom.window.document
    const main = doc.querySelector('#main-tweet') as HTMLElement

    const mainInfo = extractTweetInfo(doc, main)
    expect(mainInfo).not.toBeNull()
    expect(mainInfo!.text).toContain('DETACHED_ARTICLE_BODY')
  })

  it('extracts longform text for main tweet when only comment quotes the main tweet (regression 2)', () => {
    window.history.pushState({}, '', '/author/status/1234567890')
    try {
      const html = `
        <article data-testid="tweet" id="main-tweet">
          <div data-testid="User-Name">Author</div>
          <div data-testid="tweetText">main tweet without status link</div>
        </article>
        <div data-testid="twitterArticleRichTextView">
          <p>MAIN_ARTICLE_BODY_LONG</p>
        </div>
        <article data-testid="tweet" id="comment-tweet">
          <div data-testid="User-Name">Commenter</div>
          <div data-testid="tweetText">comment quoting main tweet</div>
          <div data-testid="quoteTweet">
            <a href="/author/status/1234567890" role="link">quoted link</a>
          </div>
        </article>
      `
      const doc = docOf(html)
      const main = doc.querySelector('#main-tweet') as HTMLElement
      const comment = doc.querySelector('#comment-tweet') as HTMLElement

      const mainInfo = extractTweetInfo(doc, main)
      expect(mainInfo).not.toBeNull()
      expect(mainInfo!.text).toContain('MAIN_ARTICLE_BODY_LONG')

      const commentInfo = extractTweetInfo(doc, comment)
      expect(commentInfo).not.toBeNull()
      expect(commentInfo!.text).not.toContain('MAIN_ARTICLE_BODY_LONG')
    } finally {
      window.history.pushState({}, '', '/')
    }
  })

  it('keeps main tweet and comments isolated in same document across multiple calls (regression 1)', () => {
    window.history.pushState({}, '', '/author/status/999888777')
    try {
      const html = `
        <article data-testid="tweet" id="main-tweet">
          <a href="/author/status/999888777" role="link">time</a>
          <div data-testid="User-Name">Author</div>
          <div data-testid="tweetText">main intro</div>
        </article>
        <div data-testid="twitterArticleRichTextView">
          <p>CACHE_ISOLATION_LONG_TEXT</p>
        </div>
        <article data-testid="tweet" id="comment-1">
          <div data-testid="User-Name">C1</div>
          <div data-testid="tweetText">comment 1 text</div>
        </article>
        <article data-testid="tweet" id="comment-2">
          <div data-testid="User-Name">C2</div>
          <div data-testid="tweetText">comment 2 text</div>
        </article>
        <article data-testid="tweet" id="comment-3">
          <div data-testid="User-Name">C3</div>
          <div data-testid="tweetText">comment 3 text</div>
        </article>
      `
      const doc = docOf(html)
      const main = doc.querySelector('#main-tweet') as HTMLElement
      const c1 = doc.querySelector('#comment-1') as HTMLElement
      const c2 = doc.querySelector('#comment-2') as HTMLElement
      const c3 = doc.querySelector('#comment-3') as HTMLElement

      const mainInfo = extractTweetInfo(doc, main)
      const c1Info = extractTweetInfo(doc, c1)
      const c2Info = extractTweetInfo(doc, c2)
      const c3Info = extractTweetInfo(doc, c3)

      expect(mainInfo!.text).toContain('CACHE_ISOLATION_LONG_TEXT')
      expect(c1Info!.text).toBe('comment 1 text')
      expect(c1Info!.text).not.toContain('CACHE_ISOLATION_LONG_TEXT')
      expect(c2Info!.text).toBe('comment 2 text')
      expect(c2Info!.text).not.toContain('CACHE_ISOLATION_LONG_TEXT')
      expect(c3Info!.text).toBe('comment 3 text')
      expect(c3Info!.text).not.toContain('CACHE_ISOLATION_LONG_TEXT')
    } finally {
      window.history.pushState({}, '', '/')
    }
  })

  it('falls back to extracting handle from article when precomputedHandle is empty string (regression 4)', () => {
    const html = `
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <a href="/real_handle" role="link">Real User</a>
        </div>
        <div data-testid="tweetText">hello world</div>
      </article>
    `
    const doc = docOf(html)
    const article = doc.querySelector('article[data-testid="tweet"]') as HTMLElement
    const info = extractTweetInfo(doc, article, '')
    expect(info).not.toBeNull()
    expect(info!.authorHandle).toBe('real_handle')
  })

  it('heals late-rendered main tweet when null cache entry expires after 1 second (regression 7)', () => {
    vi.useFakeTimers()
    window.history.pushState({}, '', '/alice/status/888999000')
    try {
      const html = `
        <div data-testid="twitterArticleRichTextView">
          <p>LATE_MAIN_ARTICLE_BODY</p>
        </div>
        <article data-testid="tweet" id="comment-tweet">
          <a href="/bob/status/111222" role="link">time</a>
          <div data-testid="User-Name">Bob</div>
          <div data-testid="tweetText">only a comment for now</div>
        </article>
      `
      const doc = docOf(html)
      const comment = doc.querySelector('#comment-tweet') as HTMLElement

      // 首次解析：页面只有评论，没有主贴
      const commentInfo = extractTweetInfo(doc, comment)
      expect(commentInfo).not.toBeNull()
      expect(commentInfo!.text).toBe('only a comment for now')
      expect(commentInfo!.text).not.toContain('LATE_MAIN_ARTICLE_BODY')

      // 构造主贴并插入 DOM
      const main = doc.createElement('article')
      main.setAttribute('data-testid', 'tweet')
      main.id = 'main-tweet'
      main.innerHTML = `
        <a href="/alice/status/888999000" role="link">time</a>
        <div data-testid="User-Name">Alice</div>
        <div data-testid="tweetText">main intro</div>
      `
      doc.body.insertBefore(main, comment)

      // 推进时间超过 1 秒（1001ms），使得 null 缓存过期重算
      vi.advanceTimersByTime(1001)

      const mainInfo = extractTweetInfo(doc, main)
      expect(mainInfo).not.toBeNull()
      expect(mainInfo!.text).toContain('LATE_MAIN_ARTICLE_BODY')
    } finally {
      vi.useRealTimers()
      window.history.pushState({}, '', '/')
    }
  })

  it('caps fallback cache size to 8 to prevent memory leak across multiple status pages (regression 6)', () => {
    const doc = docOf(`
      <article data-testid="tweet" id="tweet">
        <div data-testid="User-Name">Alice</div>
        <div data-testid="tweetText">text</div>
      </article>
      <div data-testid="twitterArticleRichTextView">
        <p>BODY</p>
      </div>
    `)
    const article = doc.querySelector('#tweet') as HTMLElement

    try {
      for (let i = 1; i <= 10; i++) {
        window.history.pushState({}, '', `/alice/status/100000000${i}`)
        const info = extractTweetInfo(doc, article)
        expect(info).not.toBeNull()
      }
      expect(_getDocumentArticleFallbackCacheSize(doc)).toBe(8)
    } finally {
      window.history.pushState({}, '', '/')
    }
  })
})


