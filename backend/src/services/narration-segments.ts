import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'

/** 中文朗读约 4.5 字/秒（与前端 estimateSpeechSec 一致） */
export const NARRATION_CHARS_PER_SEC = 4.5

/**
 * 打包目标对齐 Grok 单镜最长 10 秒：
 * - 有台词：约 8s，最长 10s（口型/对白需要更长镜头）
 * - 纯叙述：约 6s，最长 8s（避免 10 秒空镜只缓推）
 */
const DIALOGUE_TARGET_SEC = 8
const DIALOGUE_MAX_SEC = 10
const NARRATION_TARGET_SEC = 6
const NARRATION_MAX_SEC = 8

function packLimitSec(hasDialogue: boolean): { target: number; max: number } {
  if (hasDialogue) return { target: DIALOGUE_TARGET_SEC, max: DIALOGUE_MAX_SEC }
  return { target: NARRATION_TARGET_SEC, max: NARRATION_MAX_SEC }
}

const STRONG_END = new Set(['。', '！', '？'])
const TRAILING_CLOSERS = new Set(['」', '』', '"', '）', ')', '】', '》', '’', "'"])

/** 片头 / 制作说明整行（不进 TTS、不进画面段） */
const META_LINE_RE = /^(?:《[^》]+》|第\s*\d+\s*集(?:[：:].*)?|类型\s*[：:].*|成片时长\s*[：:].*|画幅\s*[：:].*|表现形式\s*[：:].*|时长\s*[：:].*|分辨率\s*[：:].*|比例\s*[：:].*|时间\s*[：:].*|地点\s*[：:].*|场景\s*[：:].*|BGM\s*[：:].*|背景音乐\s*[：:].*|【[^】]*】)\s*$/i

/** 仅标签行：画面：/音效：/解说： */
const LABEL_ONLY_RE = /^(画面|音效|解说|旁白|对白|台词|视觉|SFX|BGM)\s*[：:]\s*$/i

/** 标签 + 同行内容 */
const LABEL_INLINE_RE = /^(画面|音效|解说|旁白|对白|台词|视觉|SFX|BGM)\s*[：:]\s*(.+)$/i

const SKIP_BLOCK_LABELS = new Set(['画面', '音效', '视觉', 'sfx', 'bgm'])
const SPEAK_BLOCK_LABELS = new Set(['解说', '旁白', '对白', '台词'])

/** 仅统一换行符，不改字、不压空格 */
export function normalizeNovelLineEndings(raw: string) {
  return String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function estimateSpeechSecFromText(text: string): number {
  const chars = String(text || '').replace(/\s/g, '').length
  return Math.max(0.5, chars / NARRATION_CHARS_PER_SEC)
}

/** 是否含对白/台词痕迹（引号对白、角色名：台词 等） */
export function segmentHasDialogue(text: string): boolean {
  const s = String(text || '')
  if (/[「『]/.test(s)) return true
  if (/["“].+?["”]/.test(s)) return true
  // 「角色名：台词」常见写法（含无引号）
  if (/[\u4e00-\u9fffA-Za-z0-9·•]{1,12}[：:]\s*[「『"“\S]/.test(s)) return true
  return false
}

/** 整段仅为「艾拉：」这类说话人标签（尚无台词） */
export function isDanglingSpeakerLabel(text: string): boolean {
  return /^[\u4e00-\u9fffA-Za-z0-9·•]{1,12}[：:]\s*$/.test(String(text || '').trim())
}

/** 句子是否以「角色名：」开头（换说话人应另起镜头段） */
export function startsWithSpeakerLabel(text: string): boolean {
  return /^[\n\r\s]*[\u4e00-\u9fffA-Za-z0-9·•]{1,12}[：:]/.test(String(text || ''))
}

/**
 * 若文本末尾挂着孤立说话人标签（如 …房。艾拉：），剥下标签，留给下一段。
 * 保证拼接后与原文一致。
 */
export function peelTrailingSpeakerLabel(text: string): { body: string; speaker: string } {
  const s = String(text || '')
  const m = s.match(/(\n?[\u4e00-\u9fffA-Za-z0-9·•]{1,12}[：:])\s*$/)
  if (!m) return { body: s, speaker: '' }
  const label = m[1].replace(/^\n/, '')
  if (!isDanglingSpeakerLabel(label)) return { body: s, speaker: '' }
  return { body: s.slice(0, s.length - m[1].length), speaker: m[1] }
}

/**
 * 把孤立的「角色名：」句子粘到下一句，避免「艾拉：」与台词拆开。
 */
export function glueDanglingSpeakerSentences(sentences: string[]): string[] {
  if (!sentences.length) return []
  const out: string[] = []
  for (let i = 0; i < sentences.length; i++) {
    const cur = sentences[i]
    if (!cur) continue

    // 纯空白并入上一句 / 下一句
    if (!cur.trim()) {
      if (out.length) out[out.length - 1] += cur
      else if (i + 1 < sentences.length) sentences[i + 1] = cur + sentences[i + 1]
      else out.push(cur)
      continue
    }

    // 整句只是说话人标签 → 并入下一句
    if (isDanglingSpeakerLabel(cur) && i + 1 < sentences.length) {
      out.push(cur + sentences[i + 1])
      i += 1
      continue
    }

    // 句尾挂着说话人标签 → 剥给下一句
    const { body, speaker } = peelTrailingSpeakerLabel(cur)
    if (speaker && body && i + 1 < sentences.length) {
      if (body) out.push(body)
      sentences[i + 1] = speaker + sentences[i + 1]
      continue
    }

    out.push(cur)
  }
  return out
}

/**
 * 打包后若某段以孤立「角色名：」结尾，挪到下一段开头。
 */
export function reattachOrphanSpeakerLabels(segments: string[]): string[] {
  if (segments.length < 2) return segments
  const out: string[] = []
  for (let i = 0; i < segments.length; i++) {
    let seg = segments[i]
    if (!seg) continue

    if (isDanglingSpeakerLabel(seg) && i + 1 < segments.length) {
      segments[i + 1] = seg + segments[i + 1]
      continue
    }

    const { body, speaker } = peelTrailingSpeakerLabel(seg)
    if (speaker && body && i + 1 < segments.length) {
      out.push(body)
      segments[i + 1] = speaker + segments[i + 1]
      continue
    }

    out.push(seg)
  }
  return out.filter(s => s.length > 0)
}

function looksLikeDialogueLine(line: string): boolean {
  return segmentHasDialogue(line) || isDanglingSpeakerLabel(line)
}

function isMetaLine(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  return META_LINE_RE.test(t)
}

/**
 * 清洗分镜/剧本粘贴稿：去掉片头元数据、画面/音效块与纯标签行。
 * 若存在「解说：/旁白：」结构，只保留可朗读的解说与对白（画面说明留给全文上下文推理）。
 * 纯小说正文则仅去掉元数据行，尽量保留叙事。
 */
export function sanitizeNarrationScriptText(raw: string): string {
  const text = normalizeNovelLineEndings(raw)
  if (!text.trim()) return ''

  const hasSpokenLabel = /(?:^|\n)\s*(解说|旁白)\s*[：:]/.test(text)
  const lines = text.split('\n')
  const out: string[] = []

  /** default | skip | speak — 仅在「有解说标签」的剧本结构下使用 skip/speak */
  let mode: 'default' | 'skip' | 'speak' = hasSpokenLabel ? 'skip' : 'default'

  const pushLine = (line: string) => {
    if (!line.trim()) {
      if (out.length && out[out.length - 1] !== '\n') out.push('\n')
      return
    }
    out.push(line)
    if (!line.endsWith('\n')) out.push('\n')
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed) {
      if (!hasSpokenLabel || mode === 'speak' || mode === 'default') pushLine('')
      continue
    }

    if (isMetaLine(trimmed)) continue

    if (LABEL_ONLY_RE.test(trimmed)) {
      const key = trimmed.match(/^(画面|音效|解说|旁白|对白|台词|视觉|SFX|BGM)/i)?.[1]?.toLowerCase() || ''
      if (!hasSpokenLabel) {
        // 无解说结构：只丢弃标签行本身，不改变后续正文收纳
        continue
      }
      if (SPEAK_BLOCK_LABELS.has(key)) mode = 'speak'
      else mode = 'skip'
      continue
    }

    const inline = trimmed.match(LABEL_INLINE_RE)
    if (inline) {
      const key = inline[1].toLowerCase()
      const body = inline[2].trim()
      if (!hasSpokenLabel) {
        // 无解说结构：丢掉「画面：/音效：」标签，正文仍保留
        if (SKIP_BLOCK_LABELS.has(key)) {
          if (body) pushLine(body)
          continue
        }
        if (SPEAK_BLOCK_LABELS.has(key)) {
          if (body) pushLine(body)
          continue
        }
        pushLine(trimmed)
        continue
      }
      if (SKIP_BLOCK_LABELS.has(key)) {
        mode = 'skip'
        continue
      }
      if (SPEAK_BLOCK_LABELS.has(key)) {
        mode = 'speak'
        if (body) pushLine(body)
        continue
      }
      mode = 'skip'
      continue
    }

    // 解说结构下：跳过画面/音效块，但始终保留明显对白行
    if (hasSpokenLabel) {
      if (looksLikeDialogueLine(trimmed) || mode === 'speak') {
        pushLine(trimmed)
      }
      continue
    }

    pushLine(trimmed)
  }

  // 收束：去掉首尾空行，压缩过多空行
  let joined = out.join('')
  joined = joined.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '')
  // 若清洗后几乎为空，回退为仅剔元数据行（避免误杀纯小说）
  if (!joined.trim() && text.trim()) {
    return text
      .split('\n')
      .filter(l => {
        const t = l.trim()
        if (!t) return true
        if (isMetaLine(t)) return false
        if (LABEL_ONLY_RE.test(t)) return false
        return true
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+/, '')
      .replace(/\n+$/, '')
  }
  return joined
}

/**
 * 按强句末点切成句子，标点留在句尾；不在逗号处断开。
 * 「」『』引号内的 。！？ 不拆（避免「不等了！睡觉。」被拆成两段）。
 * 拼接后与原文完全一致。
 */
export function splitIntoSentencesPreserving(text: string): string[] {
  const src = String(text || '')
  if (!src) return []

  const openToClose: Record<string, string> = {
    '「': '」',
    '『': '』',
    '“': '”',
  }
  const sentences: string[] = []
  let buf = ''
  let closer: string | null = null

  const flush = () => {
    if (!buf) return
    // 纯空白（多为换行）并入上一句，避免单独成「空段」破坏打包
    if (!buf.trim()) {
      if (sentences.length) sentences[sentences.length - 1] += buf
      else sentences.push(buf)
      buf = ''
      return
    }
    sentences.push(buf)
    buf = ''
  }

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]

    if (!closer && openToClose[ch]) {
      closer = openToClose[ch]
      buf += ch
      continue
    }

    if (closer) {
      buf += ch
      if (ch === closer) {
        closer = null
        // 引号闭合后吞掉紧随的句末标点，整段对白作为一句
        while (i + 1 < src.length && STRONG_END.has(src[i + 1])) {
          i += 1
          buf += src[i]
        }
        while (i + 1 < src.length && TRAILING_CLOSERS.has(src[i + 1])) {
          i += 1
          buf += src[i]
        }
        flush()
      }
      continue
    }

    buf += ch
    if (STRONG_END.has(ch)) {
      while (i + 1 < src.length && TRAILING_CLOSERS.has(src[i + 1])) {
        i += 1
        buf += src[i]
      }
      flush()
      continue
    }

    if (ch === '\n') {
      // 有正文再断句；纯换行留在缓冲里并入下一句开头
      if (buf.trim()) flush()
    }
  }

  flush()
  return glueDanglingSpeakerSentences(sentences.filter(s => s.length > 0))
}

/**
 * 将句子打包为 TTS/镜头段：
 * - 绝不从句子中间切开
 * - 有台词约 8s（最长 10s）；纯叙述约 6s（最长 8s），减轻空镜拖沓
 * - 换说话人另起段；台词与纯叙述不混装
 */
export function packSentencesBySpeech(sentences: string[]): string[] {
  if (!sentences.length) return []

  const segments: string[] = []
  let current = ''
  let currentDialogue = false

  const flush = () => {
    if (!current) return
    segments.push(current)
    current = ''
    currentDialogue = false
  }

  for (const sent of sentences) {
    if (!sent) continue
    const dial = segmentHasDialogue(sent)

    if (!current) {
      current = sent
      currentDialogue = dial
      continue
    }

    // 新说话人标签开头 → 另起一段（避免「女人：…」「艾拉：…」粘在同一镜）
    if (startsWithSpeakerLabel(sent) && current.trim()) {
      flush()
      current = sent
      currentDialogue = dial
      continue
    }

    // 台词段与纯叙述不混装，避免对白后拖上长叙述
    if (currentDialogue !== dial) {
      flush()
      current = sent
      currentDialogue = dial
      continue
    }

    const merged = current + sent
    const { target, max } = packLimitSec(currentDialogue || dial)
    const mergedSec = estimateSpeechSecFromText(merged)
    const currentSec = estimateSpeechSecFromText(current)

    // 超过硬上限：不切开句，先落盘当前段
    if (mergedSec > max && currentSec > 0) {
      flush()
      current = sent
      currentDialogue = dial
      continue
    }

    // 已达目标且当前段已有实质内容 → 收束，新句另起
    if (currentSec >= target) {
      flush()
      current = sent
      currentDialogue = dial
      continue
    }

    current = merged
    currentDialogue = dial || currentDialogue
  }

  flush()
  return reattachOrphanSpeakerLabels(segments)
}

/**
 * 将小说切分为 TTS/镜头段：先清洗剧本元数据，再按整句打包。
 * 每段是清洗后文本的连续子串；拼接后应等于 sanitize 结果。
 */
export function splitNovelIntoSegments(novelText: string): string[] {
  const text = sanitizeNarrationScriptText(novelText)
  if (!text) return []
  const sentences = splitIntoSentencesPreserving(text)
  const packed = packSentencesBySpeech(sentences)
  return packed.filter(s => s.length > 0)
}

/** 校验分段是否完整覆盖清洗后的正文（开发/调试） */
export function verifySegmentTextCoverage(novelText: string, segments: string[]) {
  const normalized = sanitizeNarrationScriptText(novelText)
  return segments.join('') === normalized
}

export function rebuildNarrationSegments(jobId: number, texts: string[]) {
  const ts = now()
  db.delete(schema.narrationSegments).where(eq(schema.narrationSegments.jobId, jobId)).run()
  texts.forEach((text, index) => {
    db.insert(schema.narrationSegments).values({
      jobId,
      segmentIndex: index,
      text,
      status: 'draft',
      createdAt: ts,
      updatedAt: ts,
    }).run()
  })
  db.update(schema.narrationJobs).set({
    stage: 'segment',
    status: 'segmented',
    updatedAt: ts,
    errorMsg: null,
  }).where(eq(schema.narrationJobs.id, jobId)).run()
}

export function listNarrationSegments(jobId: number) {
  return db.select().from(schema.narrationSegments)
    .where(eq(schema.narrationSegments.jobId, jobId))
    .orderBy(schema.narrationSegments.segmentIndex)
    .all()
}
