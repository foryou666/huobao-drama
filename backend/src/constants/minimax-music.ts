/** MiniMax 官方音乐生成（https://api.minimaxi.com/v1/music_generation） */

export const MINIMAX_MUSIC_PROVIDER = 'minimax'
export const MINIMAX_MUSIC_DEFAULT_BASE_URL = 'https://api.minimaxi.com'

/** 前台可选模型（不含翻唱 music-cover，需参考音频） */
export const MINIMAX_MUSIC_MODELS = [
  'music-3.0',
  'music-2.6',
  'music-3.0-free',
  'music-2.6-free',
] as const

export type MinimaxMusicModel = (typeof MINIMAX_MUSIC_MODELS)[number]

export const MINIMAX_MUSIC_DEFAULT_MODEL: MinimaxMusicModel = 'music-3.0'

export const MINIMAX_MUSIC_MODEL_LABELS: Record<MinimaxMusicModel, string> = {
  'music-3.0': 'Music 3.0（推荐）',
  'music-2.6': 'Music 2.6',
  'music-3.0-free': 'Music 3.0 限免',
  'music-2.6-free': 'Music 2.6 限免',
}

export function normalizeMinimaxMusicModel(raw?: string | null): MinimaxMusicModel {
  const value = String(raw || '').trim().toLowerCase()
  // 兼容旧 Suno version 字段
  if (!value || value.startsWith('v')) return MINIMAX_MUSIC_DEFAULT_MODEL
  if ((MINIMAX_MUSIC_MODELS as readonly string[]).includes(value)) {
    return value as MinimaxMusicModel
  }
  return MINIMAX_MUSIC_DEFAULT_MODEL
}

export function resolveMinimaxMusicApiKey(): string {
  return (
    process.env.MINIMAX_API_KEY
    || process.env.MINIMAX_MUSIC_API_KEY
    || process.env.mimaxapikey
    || process.env.MIMAXAPIKEY
    || ''
  ).trim()
}

export function resolveMinimaxMusicBaseUrl(): string {
  return (
    process.env.MINIMAX_MUSIC_BASE_URL
    || process.env.MINIMAX_API_BASE_URL
    || MINIMAX_MUSIC_DEFAULT_BASE_URL
  ).trim().replace(/\/+$/, '')
}

export function resolveMinimaxGroupId(): string {
  return (
    process.env.MINIMAX_GROUP_ID
    || process.env.MINIMAX_MUSIC_GROUP_ID
    || ''
  ).trim()
}

export function maskMinimaxApiKey(apiKey?: string | null): string {
  const key = String(apiKey || '').trim()
  if (!key) return ''
  if (key.length <= 12) return `${key.slice(0, 3)}****`
  return `${key.slice(0, 8)}****${key.slice(-4)}`
}
