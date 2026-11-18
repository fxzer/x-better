import { describe, expect, it } from 'vitest'
import {
  buildSearchQuery,
  createSearchLatestTracker,
  filteredSearchHref,
  hasSearchFilters,
  latestSearchHref,
  parseSearchLocation,
  splitSearchQuery,
} from '../../shared/search-tools'

describe('搜索工具与语法解析', () => {
  it('splitSearchQuery: 正确分离普通搜索词与各种筛选语法糖', () => {
    const query = 'AI 大模型 within_time:7d min_faves:100 -filter:replies filter:images url:"x.com/i/article"'
    const { terms, filters } = splitSearchQuery(query)

    expect(terms).toBe('AI 大模型')
    expect(filters.time).toBe('7d')
    expect(filters.minLikes).toBe(100)
    expect(filters.originalOnly).toBe(true)
    expect(filters.media).toBe('images')
    expect(filters.articlesOnly).toBe(true)
  })

  it('buildSearchQuery: 重新将筛选语法合成规范字符串', () => {
    const terms = 'Claude'
    const query = buildSearchQuery(terms, {
      time: '24h',
      minLikes: 10,
      originalOnly: true,
      articlesOnly: false,
      media: 'videos',
    })
    expect(query).toBe('Claude within_time:24h min_faves:10 -filter:replies filter:videos')
  })

  it('hasSearchFilters: 正确判断是否存在生效的筛选条件', () => {
    expect(hasSearchFilters({ time: null, minLikes: null, originalOnly: false, articlesOnly: false, media: null })).toBe(false)
    expect(hasSearchFilters({ time: '24h', minLikes: null, originalOnly: false, articlesOnly: false, media: null })).toBe(true)
    expect(hasSearchFilters({ time: null, minLikes: null, originalOnly: true, articlesOnly: false, media: null })).toBe(true)
  })

  it('parseSearchLocation: 准确解析搜索页与话题页参数', () => {
    const searchUrl = 'https://x.com/search?q=deepseek&f=live&pf=on'
    const page = parseSearchLocation(searchUrl)
    expect(page).toEqual({
      query: 'deepseek',
      tab: 'live',
      following: true,
      hashtag: false,
    })

    const hashtagUrl = 'https://x.com/hashtag/Antigravity'
    const hashtagPage = parseSearchLocation(hashtagUrl)
    expect(hashtagPage?.query).toBe('#Antigravity')
    expect(hashtagPage?.hashtag).toBe(true)

    expect(parseSearchLocation('https://x.com/home')).toBeNull()
  })

  it('latestSearchHref: 为停留在热门的搜索页追加 f=live', () => {
    const topUrl = 'https://x.com/search?q=cursor'
    expect(latestSearchHref(topUrl)).toBe('/search?q=cursor&f=live')

    const alreadyLiveUrl = 'https://x.com/search?q=cursor&f=live'
    expect(latestSearchHref(alreadyLiveUrl)).toBeNull()
  })

  it('filteredSearchHref: 构造带有更新筛选条件的 URL', () => {
    const current = 'https://x.com/search?q=vue&f=live'
    const next = filteredSearchHref(current, 'vue within_time:7d', true)
    expect(next).toBe('/search?q=vue%20within_time%3A7d&f=live&pf=on')
  })

  it('createSearchLatestTracker: 记住手动保持的热门搜索词', () => {
    const tracker = createSearchLatestTracker()
    const url = 'https://x.com/search?q=react'

    expect(tracker.next(url)).toBe('/search?q=react&f=live')

    tracker.keepTop('react')
    expect(tracker.next(url)).toBeNull()
  })
})
