import { desc, eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'

const SOURCE_LABELS: Record<string, string> = {
  transition: '转场优化',
  shot: '镜头优化',
  camera: '运镜优化',
  dialogue: '台词优化',
  polish: '润色优化',
  rewrite: '按反馈重写',
  manual_save: '手动保存',
  restore: '恢复历史版本',
  open: '打开编辑器',
}

export function resolveVideoPromptHistoryLabel(source: string, label?: string | null) {
  if (label?.trim()) return label.trim()
  return SOURCE_LABELS[source] || source
}

export function appendVideoPromptHistory(params: {
  storyboardId: number
  beforePrompt: string
  afterPrompt: string
  source: string
  label?: string
}) {
  const before = String(params.beforePrompt ?? '')
  const after = String(params.afterPrompt ?? '')
  if (before === after) return null

  const [last] = listVideoPromptHistory(params.storyboardId, 1)
  if (last && last.before_prompt === before && last.after_prompt === after) {
    return last
  }

  const ts = now()
  const res = db.insert(schema.videoPromptHistory).values({
    storyboardId: params.storyboardId,
    beforePrompt: before,
    afterPrompt: after,
    source: params.source,
    label: resolveVideoPromptHistoryLabel(params.source, params.label),
    createdAt: ts,
  }).run()

  const id = Number(res.lastInsertRowid)
  return {
    id,
    storyboard_id: params.storyboardId,
    before_prompt: before,
    after_prompt: after,
    source: params.source,
    label: resolveVideoPromptHistoryLabel(params.source, params.label),
    created_at: ts,
  }
}

export function listVideoPromptHistory(storyboardId: number, limit = 50) {
  return db.select()
    .from(schema.videoPromptHistory)
    .where(eq(schema.videoPromptHistory.storyboardId, storyboardId))
    .orderBy(desc(schema.videoPromptHistory.id))
    .all()
    .slice(0, limit)
    .map(row => ({
      id: row.id,
      storyboard_id: row.storyboardId,
      before_prompt: row.beforePrompt,
      after_prompt: row.afterPrompt,
      source: row.source,
      label: row.label || resolveVideoPromptHistoryLabel(row.source),
      created_at: row.createdAt,
    }))
}

export function getVideoPromptHistoryEntry(storyboardId: number, historyId: number) {
  const [row] = db.select()
    .from(schema.videoPromptHistory)
    .where(eq(schema.videoPromptHistory.id, historyId))
    .all()
  if (!row || row.storyboardId !== storyboardId) return null
  return {
    id: row.id,
    storyboard_id: row.storyboardId,
    before_prompt: row.beforePrompt,
    after_prompt: row.afterPrompt,
    source: row.source,
    label: row.label || resolveVideoPromptHistoryLabel(row.source),
    created_at: row.createdAt,
  }
}
