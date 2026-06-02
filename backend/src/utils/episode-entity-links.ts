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
