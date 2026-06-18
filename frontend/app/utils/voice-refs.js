export const MAX_VOICE_REFS = 3
export const VOICE_REF_MIN_SECONDS = 3
export const VOICE_REF_MAX_SECONDS = 10

export function parseVoiceRefs(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return normalizeVoiceRefs(raw)
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? normalizeVoiceRefs(parsed) : []
    } catch {
      return []
    }
  }
  return []
}

function normalizeVoiceRefs(items) {
  const seen = new Set()
  const result = []
  for (const item of items) {
    const path = String(item?.path || item?.url || item?.local_path || item?.localPath || '').trim().replace(/^\/+/, '')
    if (!path || seen.has(path)) continue
    seen.add(path)
    result.push({
      asset_id: item?.asset_id ?? item?.assetId ?? null,
      path,
      name: String(item?.name || item?.label || '音色').trim() || '音色',
      duration: item?.duration != null ? Number(item.duration) : null,
    })
    if (result.length >= MAX_VOICE_REFS) break
  }
  return result
}

export function voiceRefFromAsset(asset) {
  if (!asset) return null
  const path = String(asset.local_path || asset.localPath || asset.url || '').trim().replace(/^\/+/, '')
  if (!path) return null
  return {
    asset_id: asset.id,
    path,
    name: asset.name || '音色',
    duration: asset.duration ?? null,
  }
}

export function formatVoiceDuration(seconds) {
  const n = Number(seconds)
  if (!Number.isFinite(n) || n <= 0) return ''
  return `${n.toFixed(1).replace(/\.0$/, '')}s`
}

/** 橙盟/Seedance 参考音频描述：音频1是「{name}的声音」 */
export function formatVoicePromptLabel(name) {
  const raw = String(name || '').trim()
  if (!raw) return '参考音色的声音'
  if (/的声音$/u.test(raw)) return raw
  return `${raw.replace(/的声音$/u, '')}的声音`
}
