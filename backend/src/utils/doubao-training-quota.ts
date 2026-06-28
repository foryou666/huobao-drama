import { getAppMeta, setAppMeta } from '../db/index.js'
import { DOUBAO_TRAINING_DAILY_QUOTA } from '../constants/doubao-training.js'

const META_KEY = 'doubao_training_daily_usage'

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

type UsageMap = Record<string, Record<string, number>>

function loadUsage(): UsageMap {
  const raw = getAppMeta(META_KEY)
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as UsageMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveUsage(map: UsageMap) {
  setAppMeta(META_KEY, JSON.stringify(map))
}

export function getDoubaoSessionDailyUsage(sessionInternalId: string): number {
  const day = todayKey()
  return loadUsage()[day]?.[sessionInternalId] ?? 0
}

export function getDoubaoSessionRemainingQuota(sessionInternalId: string, max = DOUBAO_TRAINING_DAILY_QUOTA): number {
  return Math.max(0, max - getDoubaoSessionDailyUsage(sessionInternalId))
}

export function incrementDoubaoSessionDailyUsage(sessionInternalId: string): number {
  const day = todayKey()
  const map = loadUsage()
  if (!map[day]) map[day] = {}
  map[day][sessionInternalId] = (map[day][sessionInternalId] ?? 0) + 1
  // 保留最近 7 天
  const keep = Object.keys(map).sort().slice(-7)
  const trimmed: UsageMap = {}
  for (const key of keep) trimmed[key] = map[key]
  saveUsage(trimmed)
  return trimmed[day][sessionInternalId]
}

export function listDoubaoSessionQuotaSummaries(sessionIds: string[], max = DOUBAO_TRAINING_DAILY_QUOTA) {
  return sessionIds.map(id => ({
    session_id: id,
    used_today: getDoubaoSessionDailyUsage(id),
    remaining_today: getDoubaoSessionRemainingQuota(id, max),
    daily_quota: max,
  }))
}
