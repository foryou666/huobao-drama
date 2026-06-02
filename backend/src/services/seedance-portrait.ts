import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import {
  ASSET_URI_PREFIX,
  SEEDANCE_EXPERIENCE_URL,
  SEEDANCE_PORTRAIT_DOC_URL,
  SEEDANCE_VIRTUAL_PORTRAIT_DOC_URL,
  normalizeAssetId,
  toAssetUri,
} from '../constants/seedance-portrait.js'
import { now } from '../utils/response.js'

export function getPortraitGuide() {
  return {
    doc_url: SEEDANCE_PORTRAIT_DOC_URL,
    virtual_doc_url: SEEDANCE_VIRTUAL_PORTRAIT_DOC_URL,
    experience_url: SEEDANCE_EXPERIENCE_URL,
    steps: [
      '生成或上传角色立绘',
      '点击「提交方舟素材库」— 走 AIGC 虚拟人像组入库（机器审核，约 1–3 分钟）',
      '状态变为「已入库」后，Seedance 2.0 视频生成自动使用 asset:// 引用',
      '若需真实演员，另在体验中心完成真人认证并绑定 Asset ID',
    ],
    notes: [
      '火山方舟直连 Key 无法调用素材入库，需配置服务端 SEEDANCE_ASSET_BASE_URL（如 https://www.anyfast.ai）',
      '若使用聚合网关，可另设 SEEDANCE_ASSET_API_KEY；PUBLIC_BASE_URL 供网关拉取立绘（可选，否则用 data URI）',
      '也可在体验中心手动入库后，将 Asset ID 粘贴到下方（与真人肖像相同）',
      '写实正脸立绘可能在审核阶段被拒，可改插画风格后重新提交',
    ],
    env: {
      SEEDANCE_ASSET_BASE_URL: process.env.SEEDANCE_ASSET_BASE_URL || null,
      has_asset_api_key: !!(process.env.SEEDANCE_ASSET_API_KEY || '').trim(),
    },
  }
}

export function bindCharacterPortrait(
  characterId: number,
  input: {
    portrait_type?: 'ai' | 'real_person'
    seedance_asset_id?: string | null
    seedance_asset_group_id?: string | null
    seedance_asset_status?: string | null
  },
) {
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  if (!char) throw new Error('角色不存在')

  const nextType = input.portrait_type != null
    ? (input.portrait_type === 'real_person' ? 'real_person' : 'ai')
    : (char.portraitType === 'real_person' ? 'real_person' : 'ai')

  let assetId = char.seedanceAssetId
  let groupId = char.seedanceAssetGroupId
  let status = char.seedanceAssetStatus

  if (input.seedance_asset_id !== undefined) {
    if (input.seedance_asset_id == null || input.seedance_asset_id === '') {
      assetId = null
    } else {
      assetId = normalizeAssetId(input.seedance_asset_id)
      if (!assetId) throw new Error('Asset ID 格式无效，示例：asset-20260222234430-mxpgh')
    }
  }

  if (input.seedance_asset_group_id !== undefined) {
    if (input.seedance_asset_group_id == null || input.seedance_asset_group_id === '') {
      groupId = null
    } else {
      groupId = normalizeAssetId(input.seedance_asset_group_id)
      if (!groupId) throw new Error('素材组 ID 格式无效，示例：group-20260429000614-xxx')
    }
  }

  if (input.seedance_asset_status !== undefined) {
    status = input.seedance_asset_status
  }

  if (input.seedance_asset_id !== undefined && assetId) {
    status = input.seedance_asset_status ?? 'active'
  }

  const ts = now()
  db.update(schema.characters)
    .set({
      portraitType: nextType,
      seedanceAssetId: assetId,
      seedanceAssetGroupId: groupId,
      seedanceAssetStatus: status,
      updatedAt: ts,
    })
    .where(eq(schema.characters.id, characterId))
    .run()

  const [updated] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  return {
    character: updated,
    asset_uri: assetId ? toAssetUri(assetId) : null,
  }
}

/** 视频多模态引用：已入库的 asset://（AI 与真人均可用） */
export function getCharacterSeedanceAssetRef(char: {
  id: number
  name?: string | null
  portraitType?: string | null
  seedanceAssetId?: string | null
  seedanceAssetStatus?: string | null
}) {
  const assetId = char.seedanceAssetId
  if (!assetId) return null
  const status = String(char.seedanceAssetStatus || '').toLowerCase()
  if (status && status !== 'active') return null

  const isReal = char.portraitType === 'real_person'
  return {
    type: 'image' as const,
    url: `${ASSET_URI_PREFIX}${assetId}`,
    role: 'reference_image' as const,
    label: isReal ? `真人·${char.name || '角色'}` : `角色·${char.name || '角色'}`,
    source: 'character' as const,
    charId: char.id,
    isAsset: true,
  }
}

/** @deprecated 使用 getCharacterSeedanceAssetRef */
export function getCharacterPortraitRef(char: Parameters<typeof getCharacterSeedanceAssetRef>[0]) {
  return getCharacterSeedanceAssetRef(char)
}
