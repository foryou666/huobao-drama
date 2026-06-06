/**
 * OSS 对象路径 — 以项目(dramaId)为根，所有资产统一放在 asset/ 目录
 */
import path from 'path'
import { eq, or } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

function normalizeStaticPath(raw: string): string {
  return String(raw || '').trim().replace(/^\/+/, '')
}

export function ossKeyPrefix(): string {
  return (process.env.OSS_KEY_PREFIX || '').replace(/^\/+|\/+$/g, '')
}

/** {dramaId}/...，可选全局 OSS_KEY_PREFIX */
export function projectObjectKey(dramaId: number, ...parts: string[]): string {
  const globalPrefix = ossKeyPrefix()
  const joined = [String(dramaId), ...parts.filter(Boolean)].join('/')
  return globalPrefix ? `${globalPrefix}/${joined}` : joined
}

/** 项目资产统一路径：{dramaId}/asset/{文件名} */
export function projectAssetObjectKey(dramaId: number, localPath: string): string {
  const basename = path.basename(normalizeStaticPath(localPath))
  return projectObjectKey(dramaId, 'asset', basename)
}

/** 视频参考图（团队级，可选项目标签仅作 metadata）：reference/{文件名} */
export function referenceUploadObjectKey(localPath: string): string {
  const basename = path.basename(normalizeStaticPath(localPath))
  const globalPrefix = ossKeyPrefix()
  const joined = `reference/${basename}`
  return globalPrefix ? `${globalPrefix}/${joined}` : joined
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

/** 根据 static 路径推断所属项目 dramaId */
export function resolveDramaIdForStaticPath(localPath: string): number | null {
  const normalized = normalizeStaticPath(localPath)
  if (!normalized.startsWith('static/')) return null

  const [char] = db.select({ dramaId: schema.characters.dramaId })
    .from(schema.characters)
    .where(or(
      eq(schema.characters.imageUrl, normalized),
      eq(schema.characters.localPath, normalized),
    ))
    .all()
  if (char?.dramaId) return char.dramaId

  const [scene] = db.select({ dramaId: schema.scenes.dramaId })
    .from(schema.scenes)
    .where(or(
      eq(schema.scenes.imageUrl, normalized),
      eq(schema.scenes.localPath, normalized),
    ))
    .all()
  if (scene?.dramaId) return scene.dramaId

  const storyboardColumns = [
    schema.storyboards.firstFrameImage,
    schema.storyboards.lastFrameImage,
    schema.storyboards.blockingImage,
    schema.storyboards.composedImage,
  ] as const
  for (const column of storyboardColumns) {
    const [sb] = db.select({ id: schema.storyboards.id })
      .from(schema.storyboards)
      .where(eq(column, normalized))
      .all()
    if (sb) {
      const dramaId = getStoryboardDramaId(sb.id)
      if (dramaId) return dramaId
    }
  }

  const [gen] = db.select({ dramaId: schema.imageGenerations.dramaId })
    .from(schema.imageGenerations)
    .where(eq(schema.imageGenerations.localPath, normalized))
    .all()
  if (gen?.dramaId) return gen.dramaId

  return null
}

/** 兜底上传时推断 OSS 路径 */
export function resolveProjectObjectKeyForStaticPath(localPath: string): string | null {
  const normalized = normalizeStaticPath(localPath)
  const dramaId = resolveDramaIdForStaticPath(normalized)
  if (!dramaId) return null
  return projectAssetObjectKey(dramaId, normalized)
}
