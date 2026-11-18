/**
 * MAIN world 拦截器 → isolated world 监听器的桥接常量。
 *
 * XF_BRIDGE_MARKER 不是真正的安全边界（同源页面理论上仍可读取并伪造），
 * 它的作用是：
 *  1. 防止其他脚本 / 扩展意外消费我们广播的用户数据；
 *  2. 让数据流意图显式，监听端必须校验此标记 + 来源才会处理。
 * 真正的隔离依赖 Chrome 的 content script isolated world 机制本身。
 */
export const XF_BRIDGE_MARKER = '__x_focus_bridge_v1__'

/** 排期全量数据 postMessage 的 type */
export const SCHEDULED_TWEETS_TYPE = 'XF_SCHEDULED_TWEETS'

/** 新建定时推文成功 postMessage 的 type */
export const SCHEDULED_TWEET_CREATED_TYPE = 'XF_SCHEDULED_TWEET_CREATED'

/** 删除定时推文成功 postMessage 的 type */
export const SCHEDULED_TWEET_DELETED_TYPE = 'XF_SCHEDULED_TWEET_DELETED'

/** 推文/长文书签收藏数据 postMessage 的 type */
export const BOOKMARK_METRICS_TYPE = 'XF_BOOKMARK_METRICS'

/** 主动全量同步排期推文请求 postMessage 的 type */
export const FETCH_SCHEDULED_REQ_TYPE = 'XF_FETCH_SCHEDULED_REQ'

/** 即时推文发布成功 postMessage 的 type */
export const TWEET_CREATED_TYPE = 'XF_TWEET_CREATED'

/** 搜索页路由平滑切换 postMessage 的 type（搜索筛选条与默认最新） */
export const SEARCH_NAVIGATE_TYPE = 'XF_SEARCH_NAVIGATE'
