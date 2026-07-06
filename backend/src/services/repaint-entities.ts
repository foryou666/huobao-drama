import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { syncCharacterAsset, syncPropAsset, syncSceneAsset } from './asset-library.js'
import { repairEpisodeSceneLinks } from '../utils/scene-redirect.js'
import {
  buildDefaultCharacterImagePrompt,
  buildDefaultSceneImagePrompt,
  shouldRefreshCharacterImagePrompt,
  shouldRefreshSceneImagePrompt,
} from '../constants/image-prompt-templates.js'
import type { RepaintAnalysis } from './repaint-types.js'

function linkCharToEpisode(episodeId: number, characterId: number) {
  const ts = now()
  const existing = db.select().from(schema.episodeCharacters)
    .where(eq(schema.episodeCharacters.episodeId, episodeId)).all()
    .find(row => row.characterId === characterId)
  if (!existing) {
    db.insert(schema.episodeCharacters).values({ episodeId, characterId, createdAt: ts }).run()
  }
}

function linkSceneToEpisode(episodeId: number, sceneId: number) {
  const ts = now()
  const existing = db.select().from(schema.episodeScenes)
    .where(eq(schema.episodeScenes.episodeId, episodeId)).all()
    .find(row => row.sceneId === sceneId)
  if (!existing) {
    db.insert(schema.episodeScenes).values({ episodeId, sceneId, createdAt: ts }).run()
  }
}

export function syncRepaintEntitiesToDrama(
  dramaId: number,
  episodeId: number,
  analysis: RepaintAnalysis,
): RepaintAnalysis {
  const ts = now()
  const next: RepaintAnalysis = JSON.parse(JSON.stringify(analysis))

  for (const draft of next.characters) {
    const existing = db.select().from(schema.characters)
      .where(eq(schema.characters.dramaId, dramaId)).all()
      .filter(c => !c.deletedAt)
      .find(c => c.name === draft.name)

    if (existing) {
      const appearance = draft.appearance || existing.appearance
      const description = draft.description || existing.description
      const imagePrompt = shouldRefreshCharacterImagePrompt(existing.imagePrompt)
        ? buildDefaultCharacterImagePrompt({ name: draft.name, appearance, description })
        : existing.imagePrompt!.trim()
      db.update(schema.characters).set({
        role: draft.role || existing.role,
        description,
        appearance,
        personality: draft.personality || existing.personality,
        imagePrompt,
        updatedAt: ts,
      }).where(eq(schema.characters.id, existing.id)).run()
      linkCharToEpisode(episodeId, existing.id)
      syncCharacterAsset(existing.id)
      draft.character_id = existing.id
    } else {
      const res = db.insert(schema.characters).values({
        dramaId,
        name: draft.name,
        role: draft.role || '',
        description: draft.description || '',
        appearance: draft.appearance || '',
        personality: draft.personality || '',
        imagePrompt: buildDefaultCharacterImagePrompt({
          name: draft.name,
          appearance: draft.appearance,
          description: draft.description,
        }),
        createdAt: ts,
        updatedAt: ts,
      }).run()
      const charId = Number(res.lastInsertRowid)
      linkCharToEpisode(episodeId, charId)
      syncCharacterAsset(charId)
      draft.character_id = charId
    }
  }

  for (const draft of next.scenes) {
    const time = draft.time || ''
    const existing = db.select().from(schema.scenes)
      .where(eq(schema.scenes.dramaId, dramaId)).all()
      .filter(s => !s.deletedAt)
      .find(s => s.location === draft.location && (s.time || '') === time)

    if (existing) {
      if (shouldRefreshSceneImagePrompt(existing.prompt)) {
        db.update(schema.scenes).set({
          prompt: buildDefaultSceneImagePrompt({
            location: draft.location,
            time: draft.time,
            prompt: draft.prompt,
          }),
          updatedAt: ts,
        }).where(eq(schema.scenes.id, existing.id)).run()
      }
      linkSceneToEpisode(episodeId, existing.id)
      syncSceneAsset(existing.id)
      draft.scene_id = existing.id
    } else {
      const res = db.insert(schema.scenes).values({
        dramaId,
        location: draft.location,
        time,
        prompt: buildDefaultSceneImagePrompt({
          location: draft.location,
          time: draft.time,
          prompt: draft.prompt,
        }),
        createdAt: ts,
        updatedAt: ts,
      }).run()
      const sceneId = Number(res.lastInsertRowid)
      linkSceneToEpisode(episodeId, sceneId)
      syncSceneAsset(sceneId)
      draft.scene_id = sceneId
    }
  }

  repairEpisodeSceneLinks(episodeId, dramaId)

  for (const draft of next.props) {
    const existing = db.select().from(schema.props)
      .where(eq(schema.props.dramaId, dramaId)).all()
      .filter(p => !p.deletedAt)
      .find(p => p.name === draft.name)

    if (existing) {
      db.update(schema.props).set({
        type: draft.type || existing.type,
        description: draft.description || existing.description,
        prompt: draft.prompt || existing.prompt,
        updatedAt: ts,
      }).where(eq(schema.props.id, existing.id)).run()
      syncPropAsset(existing.id)
      draft.prop_id = existing.id
    } else {
      const res = db.insert(schema.props).values({
        dramaId,
        name: draft.name,
        type: draft.type || 'prop',
        description: draft.description || '',
        prompt: draft.prompt || draft.description || draft.name,
        createdAt: ts,
        updatedAt: ts,
      }).run()
      const propId = Number(res.lastInsertRowid)
      syncPropAsset(propId)
      draft.prop_id = propId
    }
  }

  return next
}
