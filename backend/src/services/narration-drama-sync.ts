import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { loadSyncedNarrationAnalysis } from './narration-assets.js'
import {
  NARRATION_PROJECT_KIND,
  parseDramaProjectMeta,
} from './narration-drama-meta.js'

type NarrationJob = typeof schema.narrationJobs.$inferSelect

type SyncMap = {
  characters: Record<string, number>
  scenes: Record<string, number>
}

function asSyncMap(raw: unknown): SyncMap {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const characters = obj.characters && typeof obj.characters === 'object'
    ? Object.fromEntries(
      Object.entries(obj.characters as Record<string, unknown>)
        .map(([k, v]) => [k, Number(v)] as const)
        .filter((entry): entry is readonly [string, number] => Number.isFinite(entry[1]) && entry[1] > 0),
    )
    : {}
  const scenes = obj.scenes && typeof obj.scenes === 'object'
    ? Object.fromEntries(
      Object.entries(obj.scenes as Record<string, unknown>)
        .map(([k, v]) => [k, Number(v)] as const)
        .filter((entry): entry is readonly [string, number] => Number.isFinite(entry[1]) && entry[1] > 0),
    )
    : {}
  return { characters, scenes }
}

/** Store media path like drama tables expect: static/... without leading slash. */
function toDramaMediaPath(raw?: string | null): string | null {
  const value = String(raw || '').trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  return value.replace(/^\/+/, '')
}

/**
 * Upsert narration analysis characters/scenes into the linked drama tables
 * so project/canvas cover modal can pick reference images.
 */
export function syncNarrationAssetsToDrama(job: NarrationJob): {
  characters: number
  scenes: number
} {
  if (!job.dramaId || job.deletedAt) return { characters: 0, scenes: 0 }

  const [drama] = db.select().from(schema.dramas)
    .where(eq(schema.dramas.id, job.dramaId)).all()
  if (!drama || drama.deletedAt) return { characters: 0, scenes: 0 }

  const { project_kind, narration_job_id, meta } = parseDramaProjectMeta(drama)
  if (project_kind === NARRATION_PROJECT_KIND && narration_job_id && narration_job_id !== job.id) {
    return { characters: 0, scenes: 0 }
  }

  const analysis = loadSyncedNarrationAnalysis(job.id, job.analysisJson)
  const syncMap = asSyncMap(meta.narration_sync)
  const ts = now()
  let charCount = 0
  let sceneCount = 0

  for (const [index, ch] of analysis.characters.entries()) {
    const name = String(ch.name || '').trim() || `角色${index + 1}`
    const media = toDramaMediaPath(ch.image_url)
    const existingId = syncMap.characters[ch.id]
    const patch = {
      name,
      role: ch.role || null,
      appearance: ch.appearance || null,
      description: ch.description || ch.appearance || null,
      personality: ch.personality || null,
      imageUrl: media,
      localPath: media && !/^https?:\/\//i.test(media) ? media : (media || null),
      sortOrder: index,
      deletedAt: null,
      updatedAt: ts,
    }

    if (existingId) {
      const [row] = db.select().from(schema.characters)
        .where(eq(schema.characters.id, existingId)).all()
      if (row && row.dramaId === job.dramaId) {
        db.update(schema.characters).set(patch).where(eq(schema.characters.id, existingId)).run()
        charCount += 1
        continue
      }
    }

    const insert = db.insert(schema.characters).values({
      dramaId: job.dramaId,
      ...patch,
      createdAt: ts,
    }).run()
    syncMap.characters[ch.id] = Number(insert.lastInsertRowid)
    charCount += 1
  }

  for (const [index, sc] of analysis.scenes.entries()) {
    const location = String(sc.location || '').trim() || `场景${index + 1}`
    const media = toDramaMediaPath(sc.image_url)
    const existingId = syncMap.scenes[sc.id]
    const patch = {
      location,
      time: String(sc.time || '').trim() || '日',
      prompt: String(sc.prompt || '').trim() || location,
      imageUrl: media,
      localPath: media && !/^https?:\/\//i.test(media) ? media : (media || null),
      status: media ? 'completed' : 'pending',
      deletedAt: null,
      updatedAt: ts,
    }

    if (existingId) {
      const [row] = db.select().from(schema.scenes)
        .where(eq(schema.scenes.id, existingId)).all()
      if (row && row.dramaId === job.dramaId) {
        db.update(schema.scenes).set(patch).where(eq(schema.scenes.id, existingId)).run()
        sceneCount += 1
        continue
      }
    }

    const insert = db.insert(schema.scenes).values({
      dramaId: job.dramaId,
      ...patch,
      createdAt: ts,
    }).run()
    syncMap.scenes[sc.id] = Number(insert.lastInsertRowid)
    sceneCount += 1
  }

  const nextMeta = {
    ...meta,
    project_kind: NARRATION_PROJECT_KIND,
    narration_job_id: job.id,
    narration_sync: syncMap,
  }
  db.update(schema.dramas).set({
    metadata: JSON.stringify(nextMeta),
    updatedAt: ts,
  }).where(eq(schema.dramas.id, job.dramaId)).run()

  return { characters: charCount, scenes: sceneCount }
}

/** Sync by linked drama id (used by cover / drama detail APIs). */
export function syncNarrationAssetsForDramaId(dramaId: number): {
  characters: number
  scenes: number
  job_id: number | null
} {
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  const { project_kind, narration_job_id } = parseDramaProjectMeta(drama)
  if (project_kind !== NARRATION_PROJECT_KIND || !narration_job_id) {
    return { characters: 0, scenes: 0, job_id: null }
  }
  const [job] = db.select().from(schema.narrationJobs)
    .where(eq(schema.narrationJobs.id, narration_job_id)).all()
  if (!job || job.deletedAt) return { characters: 0, scenes: 0, job_id: narration_job_id }
  if (!job.dramaId) {
    db.update(schema.narrationJobs).set({
      dramaId,
      updatedAt: now(),
    }).where(eq(schema.narrationJobs.id, job.id)).run()
    job.dramaId = dramaId
  }
  const result = syncNarrationAssetsToDrama(job)
  return { ...result, job_id: job.id }
}
