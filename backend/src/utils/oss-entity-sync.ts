/**
 * 项目资产在生成或手动上传时同步到 OSS：{dramaId}/asset/{文件名}
 */
import fs from 'fs'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from './response.js'
import { getAbsolutePath } from './storage.js'
import { logTaskProgress, logTaskWarn } from './task-logger.js'
import {
  isOssConfigured,
  lookupOssObjectKey,
  putLocalFileToOss,
  signOssObjectKey,
} from './oss-upload.js'
import { projectAssetObjectKey, referenceUploadObjectKey } from './oss-path.js'

function normalizeStaticPath(raw: string): string {
  return String(raw || '').trim().replace(/^\/+/, '')
}

function upsertMapping(localPath: string, objectKey: string) {
  const normalized = normalizeStaticPath(localPath)
  const ts = now()
  db.insert(schema.ossStaticMappings)
    .values({ localPath: normalized, objectKey, updatedAt: ts })
    .onConflictDoUpdate({
      target: schema.ossStaticMappings.localPath,
      set: { objectKey, updatedAt: ts },
    })
    .run()
}

function getCharacterDramaId(characterId: number): number | null {
  const [char] = db.select({ dramaId: schema.characters.dramaId })
    .from(schema.characters)
    .where(eq(schema.characters.id, characterId))
    .all()
  return char?.dramaId ?? null
}

function getSceneDramaId(sceneId: number): number | null {
  const [scene] = db.select({ dramaId: schema.scenes.dramaId })
    .from(schema.scenes)
    .where(eq(schema.scenes.id, sceneId))
    .all()
  return scene?.dramaId ?? null
}

function getStoryboardDramaId(storyboardId: number): number | null {
  const [sb] = db.select({ episodeId: schema.storyboards.episodeId })
    .from(schema.storyboards)
    .where(eq(schema.storyboards.id, storyboardId))
    .all()
  if (!sb) return null
  const [ep] = db.select({ dramaId: schema.episodes.dramaId })
    .from(schema.episodes)
    .where(eq(schema.episodes.id, sb.episodeId))
    .all()
  return ep?.dramaId ?? null
}

export async function syncProjectAsset(dramaId: number, localPath: string): Promise<string | null> {
  if (!isOssConfigured()) return null
  const normalized = normalizeStaticPath(localPath)
  if (!normalized.startsWith('static/')) {
    throw new Error(`仅支持 static/ 路径上传 OSS: ${localPath}`)
  }

  const absPath = getAbsolutePath(normalized)
  if (!fs.existsSync(absPath)) {
    throw new Error(`本地文件不存在: ${normalized}`)
  }

  const objectKey = projectAssetObjectKey(dramaId, normalized)
  await putLocalFileToOss(absPath, objectKey)
  upsertMapping(normalized, objectKey)
  logTaskProgress('OSS', 'asset-synced', { dramaId, path: normalized, objectKey })
  return objectKey
}

export async function syncCharacterPrimaryImage(characterId: number, localPath: string): Promise<string | null> {
  const dramaId = getCharacterDramaId(characterId)
  if (!dramaId) return null
  const objectKey = await syncProjectAsset(dramaId, localPath)
  if (objectKey) {
    db.update(schema.characters)
      .set({ ossObjectKey: objectKey, updatedAt: now() })
      .where(eq(schema.characters.id, characterId))
      .run()
  }
  return objectKey
}

export async function syncCharacterVariantImage(
  characterId: number,
  _variantId: string,
  localPath: string,
): Promise<string | null> {
  const dramaId = getCharacterDramaId(characterId)
  if (!dramaId) return null
  return syncProjectAsset(dramaId, localPath)
}

export async function syncCharacterOutfitImage(
  characterId: number,
  _outfitId: string,
  localPath: string,
): Promise<string | null> {
  const dramaId = getCharacterDramaId(characterId)
  if (!dramaId) return null
  return syncProjectAsset(dramaId, localPath)
}

export async function syncCharacterOutfitVariantImage(
  characterId: number,
  _outfitId: string,
  _variantId: string,
  localPath: string,
): Promise<string | null> {
  const dramaId = getCharacterDramaId(characterId)
  if (!dramaId) return null
  return syncProjectAsset(dramaId, localPath)
}

export async function syncScenePrimaryImage(sceneId: number, localPath: string): Promise<string | null> {
  const dramaId = getSceneDramaId(sceneId)
  if (!dramaId) return null
  const objectKey = await syncProjectAsset(dramaId, localPath)
  if (objectKey) {
    db.update(schema.scenes)
      .set({ ossObjectKey: objectKey, updatedAt: now() })
      .where(eq(schema.scenes.id, sceneId))
      .run()
  }
  return objectKey
}

export async function syncSceneAngleImage(sceneId: number, _angleId: string, localPath: string): Promise<string | null> {
  const dramaId = getSceneDramaId(sceneId)
  if (!dramaId) return null
  return syncProjectAsset(dramaId, localPath)
}

export async function syncStoryboardImage(
  storyboardId: number,
  _frameType: string | null | undefined,
  localPath: string,
  dramaId?: number | null,
): Promise<string | null> {
  const resolvedDramaId = dramaId ?? getStoryboardDramaId(storyboardId)
  if (!resolvedDramaId) return null
  return syncProjectAsset(resolvedDramaId, localPath)
}

/** 视频生成：优先用已有 OSS 映射签名，不重复上传 */
export async function resolveSignedUrlForStaticPath(localPath: string): Promise<string | null> {
  const normalized = normalizeStaticPath(localPath)
  if (!normalized.startsWith('static/') || !isOssConfigured()) return null

  const objectKey = lookupOssObjectKey(normalized)
  if (objectKey) {
    return signOssObjectKey(objectKey)
  }
  return null
}

export async function trySyncCharacterImageAfterGeneration(
  record: {
    characterId?: number | null
    dramaId?: number | null
    imageType?: string | null
    frameType?: string | null
    style?: string | null
  },
  localPath: string,
): Promise<void> {
  if (!record.characterId || !isOssConfigured()) return
  try {
    const dramaId = record.dramaId ?? getCharacterDramaId(record.characterId)
    if (!dramaId) return
    const isPrimary = !record.imageType
      || record.imageType === 'character'
      || (record.imageType !== 'character_variant'
        && record.imageType !== 'character_outfit'
        && record.imageType !== 'character_outfit_variant')
    if (isPrimary) {
      await syncCharacterPrimaryImage(record.characterId, localPath)
    } else {
      await syncProjectAsset(dramaId, localPath)
    }
  } catch (err: any) {
    logTaskWarn('OSS', 'character-sync-failed', {
      characterId: record.characterId,
      path: localPath,
      error: err?.message || String(err),
    })
  }
}

export async function trySyncSceneImageAfterGeneration(
  record: {
    sceneId?: number | null
    dramaId?: number | null
    storyboardId?: number | null
    imageType?: string | null
    frameType?: string | null
  },
  localPath: string,
): Promise<void> {
  if (!record.sceneId || !isOssConfigured()) return
  if (record.storyboardId) return
  try {
    const dramaId = record.dramaId ?? getSceneDramaId(record.sceneId)
    if (!dramaId) return
    const isPrimary = !record.imageType
      || record.imageType === 'scene'
      || (record.imageType !== 'scene_angle' && record.imageType !== 'scene_angle_sheet')
    if (isPrimary) {
      await syncScenePrimaryImage(record.sceneId, localPath)
    } else {
      await syncProjectAsset(dramaId, localPath)
    }
  } catch (err: any) {
    logTaskWarn('OSS', 'scene-sync-failed', {
      sceneId: record.sceneId,
      path: localPath,
      error: err?.message || String(err),
    })
  }
}

export async function trySyncStoryboardImageAfterGeneration(
  record: {
    storyboardId?: number | null
    dramaId?: number | null
    frameType?: string | null
  },
  localPath: string,
): Promise<void> {
  if (!record.storyboardId || !isOssConfigured()) return
  try {
    await syncStoryboardImage(record.storyboardId, record.frameType, localPath, record.dramaId)
  } catch (err: any) {
    logTaskWarn('OSS', 'storyboard-sync-failed', {
      storyboardId: record.storyboardId,
      path: localPath,
      error: err?.message || String(err),
    })
  }
}

/** 视频参考图同步 OSS（reference/ 目录，不进项目 asset/） */
export async function syncReferenceUploadToOss(localPath: string): Promise<string | null> {
  if (!isOssConfigured()) return null
  const normalized = normalizeStaticPath(localPath)
  if (!normalized.startsWith('static/')) {
    throw new Error(`仅支持 static/ 路径上传 OSS: ${localPath}`)
  }

  const absPath = getAbsolutePath(normalized)
  if (!fs.existsSync(absPath)) {
    throw new Error(`本地文件不存在: ${normalized}`)
  }

  const objectKey = referenceUploadObjectKey(normalized)
  await putLocalFileToOss(absPath, objectKey)
  upsertMapping(normalized, objectKey)
  logTaskProgress('OSS', 'reference-upload-synced', { path: normalized, objectKey })
  return objectKey
}

/** 通用图片上传（视频参考图）同步 OSS，返回签名 URL */
export async function trySyncUploadImageToOss(
  localPath: string,
  _dramaId?: number | null,
): Promise<string | null> {
  const objectKey = await syncReferenceUploadToOss(localPath)
  if (!objectKey) return null
  return signOssObjectKey(objectKey)
}
