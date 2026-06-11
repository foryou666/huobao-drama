import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { getStoryboardCharacterIdsForEpisode, repairEpisodeCharacterLinks } from './character-redirect.js'
import { repairEpisodeSceneLinks } from './scene-redirect.js'

type CharacterRow = typeof schema.characters.$inferSelect
type SceneRow = typeof schema.scenes.$inferSelect

export function getStoryboardSceneIdsForEpisode(episodeId: number): number[] {
  const rows = db.select({ sceneId: schema.storyboards.sceneId })
    .from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .all()
  return [...new Set(rows.map(r => r.sceneId).filter((id): id is number => id != null))]
}

/** 当前集关联的角色 ID（episode_characters + 分镜引用，与 GET /episodes/:id/characters 一致） */
export function collectEpisodeCharacterIds(episodeId: number, dramaId: number, options?: { repair?: boolean }): Set<number> {
  if (options?.repair !== false) repairEpisodeCharacterLinks(episodeId, dramaId)
  const ids = new Set<number>()
  for (const link of db.select().from(schema.episodeCharacters).where(eq(schema.episodeCharacters.episodeId, episodeId)).all()) {
    ids.add(link.characterId)
  }
  for (const id of getStoryboardCharacterIdsForEpisode(episodeId)) ids.add(id)
  return ids
}

/** 当前集关联的场景 ID（episode_scenes + 分镜 scene_id） */
export function collectEpisodeSceneIds(episodeId: number, dramaId: number, options?: { repair?: boolean }): Set<number> {
  if (options?.repair !== false) repairEpisodeSceneLinks(episodeId, dramaId)
  const ids = new Set<number>()
  for (const link of db.select().from(schema.episodeScenes).where(eq(schema.episodeScenes.episodeId, episodeId)).all()) {
    ids.add(link.sceneId)
  }
  for (const id of getStoryboardSceneIdsForEpisode(episodeId)) ids.add(id)
  return ids
}

export function getEpisodeCharacters(episodeId: number, dramaId: number): CharacterRow[] {
  const ids = collectEpisodeCharacterIds(episodeId, dramaId)
  if (!ids.size) return []
  const all = db.select().from(schema.characters).where(eq(schema.characters.dramaId, dramaId)).all()
  return [...ids]
    .map(id => all.find(c => c.id === id))
    .filter((c): c is CharacterRow => !!c && !c.deletedAt)
}

export function getEpisodeScenes(episodeId: number, dramaId: number): SceneRow[] {
  const ids = collectEpisodeSceneIds(episodeId, dramaId)
  if (!ids.size) return []
  const all = db.select().from(schema.scenes).where(eq(schema.scenes.dramaId, dramaId)).all()
  return [...ids]
    .map(id => all.find(s => s.id === id))
    .filter((s): s is SceneRow => !!s && !s.deletedAt)
}

export function assertCharacterInEpisode(episodeId: number, dramaId: number, characterId: number): string | null {
  const ids = collectEpisodeCharacterIds(episodeId, dramaId)
  if (!ids.has(characterId)) return `角色 ${characterId} 不属于当前集`
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  if (!char || char.dramaId !== dramaId || char.deletedAt) return `角色 ${characterId} 不存在或已删除`
  return null
}

export function assertSceneInEpisode(episodeId: number, dramaId: number, sceneId: number): string | null {
  const ids = collectEpisodeSceneIds(episodeId, dramaId)
  if (!ids.has(sceneId)) return `场景 ${sceneId} 不属于当前集`
  const [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId)).all()
  if (!scene || scene.dramaId !== dramaId || scene.deletedAt) return `场景 ${sceneId} 不存在或已删除`
  return null
}

export function linkCharacterToEpisode(episodeId: number, characterId: number) {
  const ts = now()
  const existing = db.select().from(schema.episodeCharacters)
    .where(and(
      eq(schema.episodeCharacters.episodeId, episodeId),
      eq(schema.episodeCharacters.characterId, characterId),
    ))
    .all()
  if (!existing.length) {
    db.insert(schema.episodeCharacters).values({ episodeId, characterId, createdAt: ts }).run()
  }
}

export function linkSceneToEpisode(episodeId: number, sceneId: number) {
  const ts = now()
  const existing = db.select().from(schema.episodeScenes)
    .where(and(
      eq(schema.episodeScenes.episodeId, episodeId),
      eq(schema.episodeScenes.sceneId, sceneId),
    ))
    .all()
  if (!existing.length) {
    db.insert(schema.episodeScenes).values({ episodeId, sceneId, createdAt: ts }).run()
  }
}

/** 将分镜/片段已绑定的项目角色补写入 episode_characters（导入脚本时可能只写了 storyboard_characters） */
export function ensureEpisodeCharacterLinks(
  episodeId: number,
  dramaId: number,
  characterIds: number[] | undefined,
): Set<number> {
  const linked = new Set(
    db.select().from(schema.episodeCharacters)
      .where(eq(schema.episodeCharacters.episodeId, episodeId)).all()
      .map(row => row.characterId),
  )

  for (const id of characterIds || []) {
    if (linked.has(id)) continue
    const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
    if (char && char.dramaId === dramaId && !char.deletedAt) {
      linkCharacterToEpisode(episodeId, id)
      linked.add(id)
    }
  }

  return linked
}
