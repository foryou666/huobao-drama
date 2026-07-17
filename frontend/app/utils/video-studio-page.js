import { dramaAPI } from '~/composables/useApi'
import { prefetchLedgerMedia, seedMediaUrlCacheFromLedgerItems } from '~/utils/media-url.js'

export const VIDEO_DRAMA_CACHE_KEY = 'studio-video-dramas-lite-v1'

export function buildVideoLedgerCacheKey(prefix, parts = []) {
  return `${prefix}:${parts.map(p => String(p ?? '')).join(':')}`
}

export function restoreVideoLedgerCache(key) {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.items)) return null
    return parsed
  } catch {
    return null
  }
}

export function persistVideoLedgerCache(key, { items, stats, pagination }) {
  try {
    sessionStorage.setItem(key, JSON.stringify({
      items,
      stats,
      pagination,
      savedAt: Date.now(),
    }))
  } catch {
    // ignore quota / private mode
  }
}

export async function loadVideoDramasLite(dramasRef) {
  try {
    const raw = sessionStorage.getItem(VIDEO_DRAMA_CACHE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed.items) && parsed.items.length) {
        dramasRef.value = parsed.items
      }
    }
  } catch {
    // ignore
  }
  try {
    const res = await dramaAPI.listLite({ pageSize: 200 })
    dramasRef.value = res?.items ?? (Array.isArray(res) ? res : [])
    sessionStorage.setItem(VIDEO_DRAMA_CACHE_KEY, JSON.stringify({
      items: dramasRef.value,
      savedAt: Date.now(),
    }))
  } catch {
    // keep cached dramas
  }
}

export function finalizeVideoLedgerItems(nextItems) {
  seedMediaUrlCacheFromLedgerItems(nextItems)
  prefetchLedgerMedia(nextItems)
}
