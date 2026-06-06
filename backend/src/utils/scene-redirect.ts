import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from './response.js'

export function findActiveSceneByLocationTime(dramaId: number, location: string, time: string) {
  const normalizedTime = time || ''
  return db.select().from(schema.scenes)
    .where(and(eq(schema.scenes.dramaId, dramaId), isNull(schema.scenes.deletedAt)))
    .all()
    .find(s => s.location === location && (s.time || '') === normalizedTime) ?? null
}

export function findActiveSceneByLocation(dramaId: number, location: string) {
  return db.select().from(schema.scenes)
    .where(and(eq(schema.scenes.dramaId, dramaId), isNull(schema.scenes.deletedAt)))
    .all()
    .find(s => s.location === location) ?? null
}

/** 若 scene 已软删，按 location+time（或仅 location）找同项目内仍有效的替代场景 */
export function resolveActiveSceneId(
  dramaId: number,
  sceneId: number | null | undefined,
): number | null | undefined {
  if (sceneId == null) return sceneId
  const [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId)).all()
  if (!scene || scene.dramaId !== dramaId) return sceneId
  if (!scene.deletedAt) return sceneId
  const replacement = findActiveSceneByLocationTime(dramaId, scene.location, scene.time || '')
    ?? findActiveSceneByLocation(dramaId, scene.location)
  return replacement?.id ?? sceneId
}

export function redirectSceneReferences(dramaId: number, fromSceneId: number, toSceneId: number) {
  if (fromSceneId === toSceneId) return { episodeLinks: 0, storyboards: 0 }

  const links = db.select().from(schema.episodeScenes)
    .where(eq(schema.episodeScenes.sceneId, fromSceneId)).all()

  for (const link of links) {
    const [existing] = db.select().from(schema.episodeScenes).where(and(
      eq(schema.episodeScenes.episodeId, link.episodeId),
      eq(schema.episodeScenes.sceneId, toSceneId),
    )).all()
    if (existing) {
      db.delete(schema.episodeScenes).where(and(
        eq(schema.episodeScenes.episodeId, link.episodeId),
        eq(schema.episodeScenes.sceneId, fromSceneId),
      )).run()
    } else {
      db.update(schema.episodeScenes)
        .set({ sceneId: toSceneId })
        .where(and(
          eq(schema.episodeScenes.episodeId, link.episodeId),
          eq(schema.episodeScenes.sceneId, fromSceneId),
        ))
        .run()
    }
  }

  const storyboardRows = db.select({ id: schema.storyboards.id })
    .from(schema.storyboards)
    .innerJoin(schema.episodes, eq(schema.storyboards.episodeId, schema.episodes.id))
    .where(and(
      eq(schema.storyboards.sceneId, fromSceneId),
      eq(schema.episodes.dramaId, dramaId),
    ))
    .all()

  const ts = now()
  for (const row of storyboardRows) {
    db.update(schema.storyboards)
      .set({ sceneId: toSceneId, updatedAt: ts })
      .where(eq(schema.storyboards.id, row.id))
      .run()
  }

  return { episodeLinks: links.length, storyboards: storyboardRows.length }
}

/** 修复本集 episode_scenes 中指向已删场景的链接 */
export function repairEpisodeSceneLinks(episodeId: number, dramaId: number) {
  const links = db.select().from(schema.episodeScenes)
    .where(eq(schema.episodeScenes.episodeId, episodeId)).all()
  let repaired = 0
  for (const link of links) {
    const resolved = resolveActiveSceneId(dramaId, link.sceneId)
    if (resolved != null && resolved !== link.sceneId) {
      redirectSceneReferences(dramaId, link.sceneId, resolved)
      repaired++
    }
  }
  return repaired
}
