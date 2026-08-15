import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { ensureUserInDefaultTeam } from './teams.js'
import { ensureBoardForDrama } from './canvas-boards.js'
import {
  NARRATION_PROJECT_KIND,
  buildNarrationDramaMetadata,
  parseDramaProjectMeta,
} from './narration-drama-meta.js'
import { syncNarrationAssetsToDrama } from './narration-drama-sync.js'

export { NARRATION_PROJECT_KIND, parseDramaProjectMeta } from './narration-drama-meta.js'

type NarrationJob = typeof schema.narrationJobs.$inferSelect

/** Create or repair the lightweight drama shell used for project/canvas list + covers. */
export function ensureNarrationLinkedDrama(job: NarrationJob): NarrationJob {
  if (job.deletedAt) return job

  if (job.dramaId) {
    const [drama] = db.select().from(schema.dramas)
      .where(eq(schema.dramas.id, job.dramaId)).all()
    if (drama && !drama.deletedAt) {
      const { project_kind, narration_job_id, meta } = parseDramaProjectMeta(drama)
      const needsMeta = project_kind !== NARRATION_PROJECT_KIND || narration_job_id !== job.id
      const needsTitle = drama.title !== job.title
      if (needsMeta || needsTitle) {
        db.update(schema.dramas).set({
          title: job.title,
          metadata: needsMeta ? buildNarrationDramaMetadata(job.id, meta) : drama.metadata,
          style: drama.style || '解说漫',
          updatedAt: now(),
        }).where(eq(schema.dramas.id, drama.id)).run()
      }
      ensureBoardForDrama(drama, job.userId, { syncNodes: false })
      syncNarrationAssetsToDrama(job)
      return job
    }
  }

  const ts = now()
  let teamId = job.teamId ?? null
  if (teamId == null) teamId = ensureUserInDefaultTeam(job.userId)

  const insert = db.insert(schema.dramas).values({
    title: job.title || '解说漫项目',
    description: '解说漫工作流项目（封面与列表入口）',
    genre: '解说漫',
    style: '解说漫',
    tags: JSON.stringify(['解说漫']),
    metadata: buildNarrationDramaMetadata(job.id),
    teamId,
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const dramaId = Number(insert.lastInsertRowid)
  db.insert(schema.episodes).values({
    dramaId,
    episodeNumber: 1,
    title: '解说',
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  if (drama) ensureBoardForDrama(drama, job.userId, { syncNodes: false })

  db.update(schema.narrationJobs).set({
    dramaId,
    teamId,
    updatedAt: ts,
  }).where(eq(schema.narrationJobs.id, job.id)).run()

  const [fresh] = db.select().from(schema.narrationJobs).where(eq(schema.narrationJobs.id, job.id)).all()
  const linked = fresh || { ...job, dramaId, teamId }
  syncNarrationAssetsToDrama(linked)
  return linked
}

/** Backfill linked dramas for narration jobs missing drama_id (e.g. older tasks). */
export function ensureMissingNarrationLinkedDramas(opts?: {
  userId?: number | null
  teamId?: number | null
  limit?: number
}) {
  const limit = Math.max(1, Math.min(Number(opts?.limit) || 200, 500))
  let rows = db.select().from(schema.narrationJobs)
    .where(and(
      isNull(schema.narrationJobs.deletedAt),
      isNull(schema.narrationJobs.dramaId),
    ))
    .all()

  if (opts?.userId != null) {
    rows = rows.filter(r => r.userId === opts.userId)
  } else if (opts?.teamId != null) {
    rows = rows.filter(r => r.teamId === opts.teamId)
  }

  let created = 0
  for (const row of rows.slice(0, limit)) {
    const before = row.dramaId
    const next = ensureNarrationLinkedDrama(row)
    if (!before && next.dramaId) created += 1
  }
  return { scanned: rows.length, created }
}

export function syncNarrationDramaTitle(job: NarrationJob) {
  if (!job.dramaId) return
  db.update(schema.dramas).set({
    title: job.title,
    updatedAt: now(),
  }).where(eq(schema.dramas.id, job.dramaId)).run()
}
