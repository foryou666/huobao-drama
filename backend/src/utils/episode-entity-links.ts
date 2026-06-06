import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'

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
