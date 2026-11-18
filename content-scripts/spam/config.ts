import {
  KeySpamBlacklist,
  KeySpamDebugMode,
  KeySpamFilterEnabled,
  KeySpamKeywordList,
  KeySpamRulesEnabled,
  KeySpamThreshold,
  KeySpamWhitelist,
} from '../../storage-keys'
import { normalizeKeyword, parseEnabledRules, parseHandleList, parseKeywordList } from '../../shared/spam-rules'
import { migrateSpamStorage } from '../../shared/spam-migration'
import type { SpamRuleId } from '../../shared/spam-types'
import { getStorage } from '../utilities/storage'
import type { SpamConfig } from './types'

function handleSet(raw: string | undefined | null): Set<string> {
  return new Set(parseHandleList(raw))
}

let migrationChecked = false

async function loadConfig(): Promise<SpamConfig | null> {
  if (!migrationChecked) {
    migrationChecked = true
    await migrateSpamStorage()
  }

  const values = await getStorage([
    KeySpamFilterEnabled,
    KeySpamThreshold,
    KeySpamDebugMode,
    KeySpamKeywordList,
    KeySpamRulesEnabled,
    KeySpamWhitelist,
    KeySpamBlacklist,
  ])

  if (values[KeySpamFilterEnabled] !== 'on') return null

  const keywords = parseKeywordList(String(values[KeySpamKeywordList] ?? ''))

  return {
    threshold: Number(values[KeySpamThreshold]) || 55,
    debug: values[KeySpamDebugMode] === 'on',
    keywords,
    // 一次性预计算所有关键词的 normalized 形式，
    // 避免 spam-rules.ts 中 checkMarketingKeyword / checkMarketingNickname
    // 对每条推文的每个关键词重复调用 normalizeKeyword。
    normalizedKeywords: keywords.map((kw) => normalizeKeyword(kw)),
    enabledRules: parseEnabledRules(String(values[KeySpamRulesEnabled] ?? '')) as Set<SpamRuleId>,
    whitelist: handleSet(String(values[KeySpamWhitelist] ?? '')),
    blacklist: handleSet(String(values[KeySpamBlacklist] ?? '')),
  }
}

let cachedConfig: SpamConfig | null = null
let cachedAt = 0
let cachedLoaded = false
let configVersion = 0
let inFlightPromise: Promise<SpamConfig | null> | null = null
const CONFIG_TTL = 5_000

export async function getSpamConfig(): Promise<SpamConfig | null> {
  if (cachedLoaded && Date.now() - cachedAt < CONFIG_TTL) return cachedConfig
  if (inFlightPromise) return inFlightPromise

  const currentVersion = ++configVersion
  let task: Promise<SpamConfig | null> | null = null
  task = (async () => {
    try {
      const config = await loadConfig()
      if (currentVersion === configVersion) {
        cachedConfig = config
        cachedAt = Date.now()
        cachedLoaded = true
      }
      return config
    } finally {
      if (inFlightPromise === task) inFlightPromise = null
    }
  })()
  inFlightPromise = task

  return task
}

export function invalidateSpamConfigCache() {
  configVersion++
  inFlightPromise = null
  cachedConfig = null
  cachedAt = 0
  cachedLoaded = false
}
