import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KeySpamFilterEnabled } from '../../storage-keys'

const { getStorageMock, migrateSpamStorageMock } = vi.hoisted(() => ({
  getStorageMock: vi.fn(),
  migrateSpamStorageMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../content-scripts/utilities/storage', () => ({
  getStorage: getStorageMock,
}))

vi.mock('../../shared/spam-migration', () => ({
  migrateSpamStorage: migrateSpamStorageMock,
}))

import { getSpamConfig, invalidateSpamConfigCache } from '../../content-scripts/spam/config'

describe('spam config TTL cache when disabled', () => {
  beforeEach(() => {
    vi.useRealTimers()
    invalidateSpamConfigCache()
    getStorageMock.mockReset()
    getStorageMock.mockResolvedValue({
      [KeySpamFilterEnabled]: 'off',
    })
  })

  it('reuses cached null within TTL and re-fetches after invalidate', async () => {
    const config1 = await getSpamConfig()
    expect(config1).toBeNull()
    expect(getStorageMock).toHaveBeenCalledTimes(1)

    const config2 = await getSpamConfig()
    expect(config2).toBeNull()
    expect(getStorageMock).toHaveBeenCalledTimes(1)

    invalidateSpamConfigCache()

    const config3 = await getSpamConfig()
    expect(config3).toBeNull()
    expect(getStorageMock).toHaveBeenCalledTimes(2)
  })

  it('expires naturally after 5s TTL', async () => {
    vi.useFakeTimers()
    const config1 = await getSpamConfig()
    expect(config1).toBeNull()
    expect(getStorageMock).toHaveBeenCalledTimes(1)

    // 4秒后仍在 TTL 内
    vi.advanceTimersByTime(4000)
    const config2 = await getSpamConfig()
    expect(config2).toBeNull()
    expect(getStorageMock).toHaveBeenCalledTimes(1)

    // 超过 5秒后过期重新读取
    vi.advanceTimersByTime(1001)
    const config3 = await getSpamConfig()
    expect(config3).toBeNull()
    expect(getStorageMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('deduplicates concurrent in-flight calls to a single storage read', async () => {
    let resolveStorage: (val: any) => void = () => {}
    getStorageMock.mockReturnValue(
      new Promise((res) => {
        resolveStorage = res
      }),
    )

    const promise1 = getSpamConfig()
    const promise2 = getSpamConfig()

    expect(getStorageMock).toHaveBeenCalledTimes(1)

    resolveStorage({ [KeySpamFilterEnabled]: 'off' })
    const [res1, res2] = await Promise.all([promise1, promise2])

    expect(res1).toBeNull()
    expect(res2).toBeNull()
    expect(getStorageMock).toHaveBeenCalledTimes(1)
  })

  it('discards in-flight load result if invalidated before completion (race condition prevention)', async () => {
    let resolveFirstLoad: (val: any) => void = () => {}
    getStorageMock.mockReturnValueOnce(
      new Promise((res) => {
        resolveFirstLoad = res
      }),
    )

    // 第一次调用在途中
    const inFlightLoad = getSpamConfig()
    expect(getStorageMock).toHaveBeenCalledTimes(1)

    // 用户在设置中切换开关，触发立即失效
    invalidateSpamConfigCache()

    // 准备第二次调用的返回值（过滤开启状态）
    getStorageMock.mockResolvedValueOnce({
      [KeySpamFilterEnabled]: 'off',
    })

    // 先前在途的第一次请求迟到返回
    resolveFirstLoad({ [KeySpamFilterEnabled]: 'off' })
    await inFlightLoad

    // 触发新一次读取，验证不会误用先前的旧缓存
    await getSpamConfig()
    expect(getStorageMock).toHaveBeenCalledTimes(2)
  })
})
