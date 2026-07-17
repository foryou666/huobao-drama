import type { NarrationAnalysis, NarrationCharacter } from './narration-types.js'

/** IndexTTS2 旁白默认音色 */
export function defaultNarratorVoice(): string {
  return process.env.INDEXTTS2_VOICE || process.env.TTS2_VOICE || 'voice_01'
}

export function indexTts2VoicePool(): string[] {
  const raw = process.env.INDEXTTS2_VOICE_POOL || process.env.TTS2_VOICE_POOL || ''
  const pool = raw.split(',').map(s => s.trim()).filter(Boolean)
  if (pool.length) return pool
  return Array.from({ length: 12 }, (_, i) => `voice_${String(i + 1).padStart(2, '0')}`)
}

export function isValidIndexTts2Voice(voice: string): boolean {
  const trimmed = String(voice || '').trim()
  if (!trimmed) return false
  if (/^https?:\/\//i.test(trimmed)) return true
  if (trimmed.startsWith('static/') || trimmed.startsWith('/')) return true
  if (/^voice_\d{1,2}(?:\.wav)?$/i.test(trimmed)) return true
  if (/^\d+$/.test(trimmed)) {
    const idx = Number(trimmed)
    return idx >= 0 && idx <= 11
  }
  return false
}

function parseVoicePool(narratorVoice: string): string[] {
  const pool = indexTts2VoicePool()
  if (pool.length) return pool
  return narratorVoice ? [narratorVoice] : []
}

function stableVoiceIndex(key: string, size: number) {
  let hash = 0
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return hash % size
}

/** 将无效音色映射到 IndexTTS2 可用音色（voice_01~voice_12 等） */
export function normalizeIndexTts2Voice(voice: string, key = 'default'): string {
  const trimmed = String(voice || '').trim()
  if (isValidIndexTts2Voice(trimmed)) return trimmed
  const pool = indexTts2VoicePool()
  return pool[stableVoiceIndex(key, pool.length)] || defaultNarratorVoice()
}

/** 为角色分配固定音色，同一 id/name 始终映射到同一 voice_id */
export function assignCharacterVoices(
  characters: NarrationCharacter[],
  narratorVoice: string,
): void {
  const narrator = normalizeIndexTts2Voice(narratorVoice, 'narrator')
  const pool = parseVoicePool(narrator)
  const defaultPool = indexTts2VoicePool()
  const voices = pool.length ? pool : defaultPool
  const used = new Set<string>([narrator])

  for (const c of characters) {
    const existing = String(c.voice_id || '').trim()
    if (existing && isValidIndexTts2Voice(existing)) {
      used.add(existing)
      c.voice_id = existing
      continue
    }
    const key = c.id || c.name
    let voice = voices[stableVoiceIndex(key, voices.length)]
    if (used.has(voice)) {
      const free = voices.find(v => !used.has(v))
      if (free) voice = free
    }
    c.voice_id = voice
    used.add(voice)
  }
}

export function ensureAnalysisVoices(
  analysis: NarrationAnalysis,
  narratorVoice: string,
): NarrationAnalysis {
  assignCharacterVoices(analysis.characters, narratorVoice)
  for (const meta of analysis.segment_meta) {
    if (!meta.speaker_id) meta.speaker_id = 'narrator'
  }
  return analysis
}

/** 解析该段 TTS 应使用的音色：旁白用 narrator；角色台词用角色固定音色 */
export function resolveSegmentVoice(
  narratorVoice: string,
  segmentIndex: number,
  analysis: NarrationAnalysis,
): string {
  const narrator = normalizeIndexTts2Voice(narratorVoice, 'narrator')
  const meta = analysis.segment_meta.find(m => m.segment_index === segmentIndex)
  const speakerId = String(meta?.speaker_id || 'narrator').trim()
  if (speakerId && speakerId !== 'narrator') {
    const char = analysis.characters.find(c => c.id === speakerId)
    if (char?.voice_id) return normalizeIndexTts2Voice(char.voice_id, char.id || char.name)
  }
  return narrator
}
