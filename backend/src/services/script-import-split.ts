/**
 * 按「第 N 集」标记切分整部剧本。无标记则拒绝，不做 AI 分集。
 */

export const SCRIPT_IMPORT_WARN_CHARS = 20_000

/** 单集超过此长度时在预览中标为高风险（上下文可能装不下） */
export const SCRIPT_IMPORT_RISK_CHARS = 50_000

const MARKER_RE =
  /(^|\n)\s*(?:#{1,3}\s*)?(?:【\s*)?第\s*([0-9０-９一二三四五六七八九十百千零两〇]+)\s*集(?:\s*】)?\s*[：:\-—–]?/g

const CN_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

function normalizeDigits(raw: string): string {
  return String(raw || '')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .trim()
}

/** 解析「第N集」中的 N（阿拉伯或常见中文数字） */
export function parseEpisodeOrdinal(raw: string): number | null {
  const s = normalizeDigits(raw)
  if (!s) return null
  if (/^\d+$/.test(s)) {
    const n = Number(s)
    return Number.isFinite(n) && n > 0 ? n : null
  }

  if (s === '十') return 10
  if (s === '百') return 100

  let total = 0
  let current = 0
  for (const ch of s) {
    if (ch === '十') {
      current = current === 0 ? 10 : current * 10
      total += current
      current = 0
    } else if (ch === '百') {
      current = (current === 0 ? 1 : current) * 100
      total += current
      current = 0
    } else if (ch === '千') {
      current = (current === 0 ? 1 : current) * 1000
      total += current
      current = 0
    } else if (ch in CN_DIGIT) {
      current = CN_DIGIT[ch]
    } else {
      return null
    }
  }
  total += current
  return total > 0 ? total : null
}

export interface ScriptEpisodeSlice {
  /** 展示用集号（尽量用标记中的数字；冲突时按出现顺序） */
  episode_number: number
  marker: string
  title: string
  content: string
  char_count: number
  warn_long: boolean
  risk_long: boolean
}

export interface ScriptSplitResult {
  ok: boolean
  reason?: string
  preamble: string
  episodes: ScriptEpisodeSlice[]
  total_chars: number
}

export function splitScriptByEpisodeMarkers(rawText: string): ScriptSplitResult {
  const text = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!text) {
    return { ok: false, reason: '剧本内容为空', preamble: '', episodes: [], total_chars: 0 }
  }

  const matches: Array<{ index: number; end: number; ordinalRaw: string; marker: string }> = []
  MARKER_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MARKER_RE.exec(text)) !== null) {
    const lead = m[1] || ''
    const ordinalRaw = m[2] || ''
    const markerStart = m.index + lead.length
    matches.push({
      index: markerStart,
      end: m.index + m[0].length,
      ordinalRaw,
      marker: text.slice(markerStart, m.index + m[0].length).trim(),
    })
  }

  if (!matches.length) {
    return {
      ok: false,
      reason: '未检测到「第N集」标记。请先按集标注（如「第1集」「第一章」不可替代），确认后再导入。',
      preamble: '',
      episodes: [],
      total_chars: text.length,
    }
  }

  const preamble = text.slice(0, matches[0].index).trim()
  const usedNumbers = new Set<number>()
  const episodes: ScriptEpisodeSlice[] = []

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]
    const next = matches[i + 1]
    let content = text.slice(cur.end, next ? next.index : text.length).trim()
    // 首集可附带文首前言（简介/人物表等）
    if (i === 0 && preamble) {
      content = preamble + (content ? `\n\n${content}` : '')
    }

    let episodeNumber = parseEpisodeOrdinal(cur.ordinalRaw) ?? (i + 1)
    if (usedNumbers.has(episodeNumber)) {
      episodeNumber = i + 1
      while (usedNumbers.has(episodeNumber)) episodeNumber += 1
    }
    usedNumbers.add(episodeNumber)

    const charCount = content.length
    episodes.push({
      episode_number: episodeNumber,
      marker: cur.marker.replace(/\s+/g, ''),
      title: `第${episodeNumber}集`,
      content,
      char_count: charCount,
      warn_long: charCount >= SCRIPT_IMPORT_WARN_CHARS,
      risk_long: charCount >= SCRIPT_IMPORT_RISK_CHARS,
    })
  }

  const empty = episodes.filter(e => !e.content.trim())
  if (empty.length === episodes.length) {
    return {
      ok: false,
      reason: '已识别集标记，但各集正文为空',
      preamble,
      episodes: [],
      total_chars: text.length,
    }
  }

  return {
    ok: true,
    preamble,
    episodes: episodes.sort((a, b) => a.episode_number - b.episode_number),
    total_chars: text.length,
  }
}
