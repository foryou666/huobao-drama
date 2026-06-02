import { and, asc, desc, eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'

export interface StoredAssistantMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  tool_summary: string | null
  attachments: string | null
  created_at: string
  sort_order: number
}

export function getOrCreateThread(
  userId: number,
  episodeId: number,
  stepKey: string,
  agentType: string,
) {
  const existing = db.select().from(schema.assistantThreads)
    .where(and(
      eq(schema.assistantThreads.userId, userId),
      eq(schema.assistantThreads.episodeId, episodeId),
      eq(schema.assistantThreads.stepKey, stepKey),
    ))
    .all()[0]

  if (existing) {
    if (existing.agentType !== agentType) {
      db.update(schema.assistantThreads)
        .set({ agentType, updatedAt: now() })
        .where(eq(schema.assistantThreads.id, existing.id))
        .run()
    }
    return existing
  }

  const ts = now()
  db.insert(schema.assistantThreads).values({
    userId,
    episodeId,
    stepKey,
    agentType,
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const [inserted] = db.select().from(schema.assistantThreads)
    .where(and(
      eq(schema.assistantThreads.userId, userId),
      eq(schema.assistantThreads.episodeId, episodeId),
      eq(schema.assistantThreads.stepKey, stepKey),
    ))
    .all()

  return inserted!
}

export function listThreadMessages(threadId: number, limit = 40): StoredAssistantMessage[] {
  const rows = db.select().from(schema.assistantMessages)
    .where(eq(schema.assistantMessages.threadId, threadId))
    .orderBy(asc(schema.assistantMessages.sortOrder), asc(schema.assistantMessages.id))
    .all()

  return rows.slice(-limit).map(row => ({
    id: row.id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    tool_summary: row.toolSummary,
    attachments: row.attachments ?? null,
    created_at: row.createdAt,
    sort_order: row.sortOrder,
  }))
}

export function updateThreadMessage(
  messageId: number,
  patch: { content?: string; attachments?: string | null },
) {
  const updates: Record<string, string | null> = {}
  if (patch.content !== undefined) updates.content = patch.content
  if (patch.attachments !== undefined) updates.attachments = patch.attachments
  if (!Object.keys(updates).length) return null

  db.update(schema.assistantMessages)
    .set(updates)
    .where(eq(schema.assistantMessages.id, messageId))
    .run()

  const [row] = db.select().from(schema.assistantMessages)
    .where(eq(schema.assistantMessages.id, messageId))
    .all()

  return row ?? null
}

export function appendThreadMessage(
  threadId: number,
  role: 'user' | 'assistant',
  content: string,
  toolSummary?: string | null,
  attachments?: string | null,
) {
  const [last] = db.select().from(schema.assistantMessages)
    .where(eq(schema.assistantMessages.threadId, threadId))
    .orderBy(desc(schema.assistantMessages.sortOrder))
    .limit(1)
    .all()

  const sortOrder = (last?.sortOrder ?? 0) + 1
  const ts = now()

  const res = db.insert(schema.assistantMessages).values({
    threadId,
    role,
    content,
    toolSummary: toolSummary ?? null,
    attachments: attachments ?? null,
    sortOrder,
    createdAt: ts,
  }).run()

  db.update(schema.assistantThreads)
    .set({ updatedAt: ts })
    .where(eq(schema.assistantThreads.id, threadId))
    .run()

  const [inserted] = db.select().from(schema.assistantMessages)
    .where(eq(schema.assistantMessages.id, Number(res.lastInsertRowid)))
    .all()

  return inserted!
}

export function clearAssistantThread(userId: number, episodeId: number, stepKey: string) {
  const [thread] = db.select().from(schema.assistantThreads)
    .where(and(
      eq(schema.assistantThreads.userId, userId),
      eq(schema.assistantThreads.episodeId, episodeId),
      eq(schema.assistantThreads.stepKey, stepKey),
    ))
    .all()

  if (!thread) return false

  db.delete(schema.assistantMessages)
    .where(eq(schema.assistantMessages.threadId, thread.id))
    .run()
  db.delete(schema.assistantThreads)
    .where(eq(schema.assistantThreads.id, thread.id))
    .run()
  return true
}

export function getThreadForUser(userId: number, episodeId: number, stepKey: string) {
  return db.select().from(schema.assistantThreads)
    .where(and(
      eq(schema.assistantThreads.userId, userId),
      eq(schema.assistantThreads.episodeId, episodeId),
      eq(schema.assistantThreads.stepKey, stepKey),
    ))
    .all()[0] ?? null
}

export function buildHistoryFromThread(
  threadId: number,
  latestUserPlainText: string,
  context?: string,
): { role: 'user' | 'assistant'; content: string }[] {
  const rows = listThreadMessages(threadId, 30)
  const history = rows.map(row => ({
    role: row.role,
    content: row.content,
  }))

  if (!history.length) return []

  const last = history[history.length - 1]
  if (last.role === 'user' && last.content === latestUserPlainText.trim()) {
    history.pop()
  }

  return history
}

export function applyContextToUserMessage(message: string, context?: string) {
  const contextBlock = typeof context === 'string' ? context.trim() : ''
  if (!contextBlock) return message.trim()
  return `${contextBlock}\n\n[用户指令]\n${message.trim()}`
}
