import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'

const MAX_SEGMENT_CHARS = Number(process.env.NARRATION_SEGMENT_MAX_CHARS || 52)
const MIN_SEGMENT_CHARS = 16
/** 目标朗读时长约 8~10 秒（中文约 4~5 字/秒） */

/** 仅统一换行符，不改字、不压空格 */
export function normalizeNovelLineEndings(raw: string) {
  return String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * 将小说切分为 TTS 段：每段是原文的连续子串，拼接后与原文完全一致。
 * 只在超长处按标点断句，不润色、不合并改写。
 */
export function splitNovelIntoSegments(novelText: string): string[] {
  const text = normalizeNovelLineEndings(novelText)
  if (!text) return []

  const chunks: string[] = []
  let start = 0
  const len = text.length

  while (start < len) {
    let end = Math.min(start + MAX_SEGMENT_CHARS, len)
    if (end < len) {
      const slice = text.slice(start, end)
      let breakAt = -1
      for (const mark of ['。', '！', '？', '\n', '；', '，', ' ']) {
        const idx = slice.lastIndexOf(mark)
        if (idx > breakAt) breakAt = idx
      }
      if (breakAt >= MIN_SEGMENT_CHARS) {
        end = start + breakAt + 1
      }
    }
    chunks.push(text.slice(start, end))
    start = end
  }

  return chunks.filter(s => s.length > 0)
}

/** 校验分段是否完整覆盖原文（开发/调试） */
export function verifySegmentTextCoverage(novelText: string, segments: string[]) {
  const normalized = normalizeNovelLineEndings(novelText)
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
