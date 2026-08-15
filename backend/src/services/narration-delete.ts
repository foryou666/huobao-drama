import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { softDeleteBoardByDramaId } from './canvas-boards.js'
import { parseDramaProjectMeta } from './narration-drama-meta.js'

type NarrationJob = typeof schema.narrationJobs.$inferSelect

function softDeleteDramaShell(dramaId: number, ts: string) {
  db.update(schema.dramas).set({
    deletedAt: ts,
    updatedAt: ts,
  }).where(and(
    eq(schema.dramas.id, dramaId),
    isNull(schema.dramas.deletedAt),
  )).run()

  db.update(schema.episodes).set({
    deletedAt: ts,
    updatedAt: ts,
  }).where(and(
    eq(schema.episodes.dramaId, dramaId),
    isNull(schema.episodes.deletedAt),
  )).run()

  db.update(schema.characters).set({
    deletedAt: ts,
    updatedAt: ts,
  }).where(and(
    eq(schema.characters.dramaId, dramaId),
    isNull(schema.characters.deletedAt),
  )).run()

  db.update(schema.scenes).set({
    deletedAt: ts,
    updatedAt: ts,
  }).where(and(
    eq(schema.scenes.dramaId, dramaId),
    isNull(schema.scenes.deletedAt),
  )).run()

  softDeleteBoardByDramaId(dramaId)
}

/** Soft-delete a narration job and its linked project shell (list / canvas / covers). */
export function softDeleteNarrationProject(job: NarrationJob) {
  if (!job || job.deletedAt) return { job_id: job?.id ?? null, drama_id: null }

  const ts = now()
  let dramaId = job.dramaId ?? null

  if (!dramaId) {
    // Fallback: find shell by metadata
    const shells = db.select().from(schema.dramas)
      .where(isNull(schema.dramas.deletedAt))
      .all()
      .filter((d) => {
        const { narration_job_id } = parseDramaProjectMeta(d)
        return narration_job_id === job.id
      })
    dramaId = shells[0]?.id ?? null
  }

  db.update(schema.narrationJobs).set({
    deletedAt: ts,
    updatedAt: ts,
  }).where(eq(schema.narrationJobs.id, job.id)).run()

  if (dramaId) softDeleteDramaShell(dramaId, ts)

  return { job_id: job.id, drama_id: dramaId }
}

/** Soft-delete narration job when its shell drama is deleted from project list. */
export function softDeleteNarrationJobForDrama(dramaId: number) {
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  const { project_kind, narration_job_id } = parseDramaProjectMeta(drama)
  if (project_kind !== 'narration' && !narration_job_id) return null
  if (!narration_job_id) return null

  const [job] = db.select().from(schema.narrationJobs)
    .where(eq(schema.narrationJobs.id, narration_job_id)).all()
  if (!job || job.deletedAt) {
    softDeleteDramaShell(dramaId, now())
    return { job_id: narration_job_id, drama_id: dramaId }
  }
  return softDeleteNarrationProject(job)
}
