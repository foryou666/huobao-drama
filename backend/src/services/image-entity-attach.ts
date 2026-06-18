import { eq, and, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { appendCharacterOutfitImage } from '../utils/character-image-variants.js'
import { upsertSceneAngleImage } from '../utils/scene-image-variants.js'
import { upsertPropViewImage } from '../utils/prop-image-variants.js'
import { syncCharacterPrimaryImage, syncScenePrimaryImage } from '../utils/oss-entity-sync.js'
import { syncCharacterAsset, syncPropAsset, syncSceneAsset, ensurePropFromManualPropAsset } from './asset-library.js'
import { userCanAccessDrama } from './drama-shares.js'
import { buildDefaultCharacterImagePrompt } from '../utils/character-image-prompt.js'
import type { AuthUser } from '../middleware/auth.js'

export type ImageAttachEntityType = 'character' | 'scene' | 'prop'

export interface AttachCreateEntityInput {
  name?: string | null
  location?: string | null
  time?: string | null
  role?: string | null
  description?: string | null
  appearance?: string | null
  prompt?: string | null
}

export interface AttachImageToEntityInput {
  generationId: number
  entityType: ImageAttachEntityType
  entityId?: number | null
  dramaId?: number | null
  createEntity?: AttachCreateEntityInput | null
  groupId?: string | null
  groupLabel?: string | null
  setAsDefault?: boolean
  user: AuthUser
  activeTeamId?: number | null
}

function normalizePath(raw: string): string {
  return String(raw || '').trim().replace(/^\/+/, '')
}

function slugifyGroupId(name: string): string {
  const base = String(name || 'group')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .slice(0, 32) || 'group'
  return `${base}_${Date.now()}`
}

function resolveGenerationImagePath(generationId: number): string | null {
  const [row] = db.select().from(schema.imageGenerations)
    .where(eq(schema.imageGenerations.id, generationId))
    .all()
  if (!row) return null
  const path = normalizePath(row.localPath || row.imageUrl || '')
  return path || null
}

function assertEntityAccess(dramaId: number | null | undefined, user: AuthUser) {
  if (!dramaId) throw new Error('实体未绑定项目')
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  if (!drama) throw new Error('项目不存在')
  if (!userCanAccessDrama(drama, user)) throw new Error('无权操作该项目资产')
}

function resolveEntityDrama(entityType: ImageAttachEntityType, entityId: number) {
  if (entityType === 'character') {
    const [row] = db.select().from(schema.characters).where(eq(schema.characters.id, entityId)).all()
    if (!row || row.deletedAt) throw new Error('角色不存在')
    return { dramaId: row.dramaId, label: row.name }
  }
  if (entityType === 'scene') {
    const [row] = db.select().from(schema.scenes).where(eq(schema.scenes.id, entityId)).all()
    if (!row || row.deletedAt) throw new Error('场景不存在')
    return { dramaId: row.dramaId, label: row.location }
  }
  const [row] = db.select().from(schema.props).where(eq(schema.props.id, entityId)).all()
  if (!row || row.deletedAt) throw new Error('道具不存在')
  return { dramaId: row.dramaId, label: row.name }
}

function attachToCharacter(entityId: number, imagePath: string, groupId: string, groupLabel: string, setAsDefault: boolean) {
  const outfits = appendCharacterOutfitImage(entityId, {
    outfitId: groupId,
    label: groupLabel,
    url: imagePath,
    setAsDefault,
    candidateLabel: setAsDefault ? '定稿' : undefined,
  })
  syncCharacterPrimaryImage(entityId, imagePath).catch(() => {})
  syncCharacterAsset(entityId)
  const outfit = outfits.find(item => item.outfit_id === groupId) || null
  return { group_id: groupId, group_label: groupLabel, outfit }
}

function attachToScene(entityId: number, imagePath: string, groupId: string, groupLabel: string) {
  if (groupId === 'hero') {
    const ts = now()
    db.update(schema.scenes)
      .set({ imageUrl: imagePath, localPath: imagePath, updatedAt: ts, status: 'completed' })
      .where(eq(schema.scenes.id, entityId))
      .run()
    syncScenePrimaryImage(entityId, imagePath).catch(() => {})
  } else {
    upsertSceneAngleImage(entityId, groupId, imagePath, groupLabel)
  }
  syncSceneAsset(entityId)
  return { group_id: groupId, group_label: groupLabel }
}

function resolveOrCreateCharacter(dramaId: number, input: AttachCreateEntityInput): number {
  const name = String(input.name || '').trim()
  if (!name) throw new Error('请填写角色名称')

  const existing = db.select().from(schema.characters)
    .where(and(eq(schema.characters.dramaId, dramaId), isNull(schema.characters.deletedAt)))
    .all()
    .find(item => item.name === name)

  if (existing) {
    syncCharacterAsset(existing.id)
    return existing.id
  }

  const ts = now()
  const res = db.insert(schema.characters).values({
    dramaId,
    name,
    role: String(input.role || '').trim(),
    description: String(input.description || '').trim(),
    appearance: String(input.appearance || input.description || '').trim(),
    personality: '',
    imagePrompt: buildDefaultCharacterImagePrompt({
      name,
      appearance: input.appearance || input.description,
      description: input.description,
    }),
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const characterId = Number(res.lastInsertRowid)
  syncCharacterAsset(characterId)
  return characterId
}

function resolveOrCreateScene(dramaId: number, input: AttachCreateEntityInput): number {
  const location = String(input.location || input.name || '').trim()
  if (!location) throw new Error('请填写场景地点')
  const time = String(input.time || '').trim()

  const existing = db.select().from(schema.scenes)
    .where(and(eq(schema.scenes.dramaId, dramaId), isNull(schema.scenes.deletedAt)))
    .all()
    .find(item => item.location === location && (item.time || '') === time)

  if (existing) {
    syncSceneAsset(existing.id)
    return existing.id
  }

  const ts = now()
  const res = db.insert(schema.scenes).values({
    dramaId,
    location,
    time,
    prompt: String(input.prompt || input.description || location).trim(),
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const sceneId = Number(res.lastInsertRowid)
  syncSceneAsset(sceneId)
  return sceneId
}

function resolveOrCreateProp(dramaId: number, input: AttachCreateEntityInput): number {
  const name = String(input.name || '').trim()
  if (!name) throw new Error('请填写道具名称')

  const propId = ensurePropFromManualPropAsset({
    dramaId,
    name,
    description: input.description || null,
  })
  if (!propId) throw new Error('创建道具失败')
  return propId
}

function resolveOrCreateEntity(
  entityType: ImageAttachEntityType,
  dramaId: number,
  input: AttachCreateEntityInput,
): number {
  if (entityType === 'character') return resolveOrCreateCharacter(dramaId, input)
  if (entityType === 'scene') return resolveOrCreateScene(dramaId, input)
  return resolveOrCreateProp(dramaId, input)
}

function attachToProp(entityId: number, imagePath: string, groupId: string, groupLabel: string) {
  if (groupId === 'hero') {
    const ts = now()
    db.update(schema.props)
      .set({ imageUrl: imagePath, localPath: imagePath, updatedAt: ts })
      .where(eq(schema.props.id, entityId))
      .run()
  } else {
    upsertPropViewImage(entityId, groupId, imagePath, groupLabel)
  }
  syncPropAsset(entityId)
  return { group_id: groupId, group_label: groupLabel }
}

export function attachGeneratedImageToEntity(input: AttachImageToEntityInput) {
  const imagePath = resolveGenerationImagePath(input.generationId)
  if (!imagePath) throw new Error('图片不存在或尚未生成完成')

  const entityType = input.entityType
  let entityId = Number(input.entityId)
  let createdEntity = false

  if (!Number.isFinite(entityId) || entityId <= 0) {
    const dramaId = Number(input.dramaId)
    if (!Number.isFinite(dramaId) || dramaId <= 0) throw new Error('请选择项目并填写新建信息')
    assertEntityAccess(dramaId, input.user)
    entityId = resolveOrCreateEntity(entityType, dramaId, input.createEntity || {})
    createdEntity = true
  }

  const entity = resolveEntityDrama(entityType, entityId)
  assertEntityAccess(entity.dramaId, input.user)

  let groupId = String(input.groupId || '').trim()
  let groupLabel = String(input.groupLabel || '').trim()
  const isNewGroup = !groupId

  if (isNewGroup) {
    if (!groupLabel) throw new Error('请填写分组名称')
    groupId = slugifyGroupId(groupLabel)
  } else if (!groupLabel) {
    groupLabel = groupId === 'hero' ? (entityType === 'scene' ? '主视角' : '主图') : groupId
  }

  const setAsDefault = input.setAsDefault !== false

  const base = {
    entity_type: entityType,
    entity_id: entityId,
    entity_label: entity.label,
    image_path: imagePath,
    created_entity: createdEntity,
  }

  if (entityType === 'character') {
    const result = attachToCharacter(entityId, imagePath, groupId, groupLabel, isNewGroup ? true : setAsDefault)
    return { ...base, ...result }
  }

  if (entityType === 'scene') {
    const result = attachToScene(entityId, imagePath, groupId, groupLabel)
    return { ...base, ...result }
  }

  const result = attachToProp(entityId, imagePath, groupId, groupLabel)
  return { ...base, ...result }
}
