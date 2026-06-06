import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from './response.js'

export function findActiveCharacterByName(dramaId: number, name: string) {
  return db.select().from(schema.characters)
    .where(and(eq(schema.characters.dramaId, dramaId), isNull(schema.characters.deletedAt)))
    .all()
    .find(c => c.name === name) ?? null
}

/** 若角色已软删，按同名找仍有效的替代角色 */
export function resolveActiveCharacterId(
  dramaId: number,
  characterId: number,
): number {
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  if (!char || char.dramaId !== dramaId) return characterId
  if (!char.deletedAt) return characterId
  const replacement = findActiveCharacterByName(dramaId, char.name)
  return replacement?.id ?? characterId
}

export function getStoryboardCharacterIdsForEpisode(episodeId: number) {
  const rows = db.select({ characterId: schema.storyboardCharacters.characterId })
    .from(schema.storyboardCharacters)
    .innerJoin(schema.storyboards, eq(schema.storyboardCharacters.storyboardId, schema.storyboards.id))
    .where(eq(schema.storyboards.episodeId, episodeId))
    .all()
  return [...new Set(rows.map(r => r.characterId))]
}

export function redirectCharacterReferences(dramaId: number, fromId: number, toId: number) {
  if (fromId === toId) return { episodeLinks: 0, storyboardLinks: 0 }

  const episodeLinks = db.select().from(schema.episodeCharacters)
    .where(eq(schema.episodeCharacters.characterId, fromId)).all()

  for (const link of episodeLinks) {
    const [existing] = db.select().from(schema.episodeCharacters).where(and(
      eq(schema.episodeCharacters.episodeId, link.episodeId),
      eq(schema.episodeCharacters.characterId, toId),
    )).all()
    if (existing) {
      db.delete(schema.episodeCharacters).where(and(
        eq(schema.episodeCharacters.episodeId, link.episodeId),
        eq(schema.episodeCharacters.characterId, fromId),
      )).run()
    } else {
      db.update(schema.episodeCharacters)
        .set({ characterId: toId })
        .where(and(
          eq(schema.episodeCharacters.episodeId, link.episodeId),
          eq(schema.episodeCharacters.characterId, fromId),
        ))
        .run()
    }
  }

  const storyboardLinks = db.select({ id: schema.storyboardCharacters.storyboardId })
    .from(schema.storyboardCharacters)
    .innerJoin(schema.storyboards, eq(schema.storyboardCharacters.storyboardId, schema.storyboards.id))
    .innerJoin(schema.episodes, eq(schema.storyboards.episodeId, schema.episodes.id))
    .where(and(
      eq(schema.storyboardCharacters.characterId, fromId),
      eq(schema.episodes.dramaId, dramaId),
    ))
    .all()

  for (const row of storyboardLinks) {
    const [existing] = db.select().from(schema.storyboardCharacters).where(and(
      eq(schema.storyboardCharacters.storyboardId, row.id),
      eq(schema.storyboardCharacters.characterId, toId),
    )).all()
    if (existing) {
      db.delete(schema.storyboardCharacters).where(and(
        eq(schema.storyboardCharacters.storyboardId, row.id),
        eq(schema.storyboardCharacters.characterId, fromId),
      )).run()
    } else {
      db.update(schema.storyboardCharacters)
        .set({ characterId: toId })
        .where(and(
          eq(schema.storyboardCharacters.storyboardId, row.id),
          eq(schema.storyboardCharacters.characterId, fromId),
        ))
        .run()
    }
  }

  return { episodeLinks: episodeLinks.length, storyboardLinks: storyboardLinks.length }
}

/** 将本集仍指向已删角色的链接重定向到同名有效角色（若有） */
export function repairEpisodeCharacterLinks(episodeId: number, dramaId: number) {
  const linkedIds = db.select().from(schema.episodeCharacters)
    .where(eq(schema.episodeCharacters.episodeId, episodeId)).all()
    .map(l => l.characterId)
  const sbIds = getStoryboardCharacterIdsForEpisode(episodeId)
  const allIds = [...new Set([...linkedIds, ...sbIds])]
  let repaired = 0
  for (const id of allIds) {
    const resolved = resolveActiveCharacterId(dramaId, id)
    if (resolved !== id) {
      redirectCharacterReferences(dramaId, id, resolved)
      repaired++
    }
  }
  return repaired
}

export function resolveCharacterIdsForEpisode(dramaId: number, characterIds: number[]) {
  return [...new Set(characterIds.map(id => resolveActiveCharacterId(dramaId, id)))]
}
