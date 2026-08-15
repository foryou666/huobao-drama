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
import { listCharacterOutfits } from '../utils/character-image-variants.js'
import { now } from '../utils/response.js'

export function getPortraitGuide() {
  return {
    doc_url: SEEDANCE_PORTRAIT_DOC_URL,
    virtual_doc_url: SEEDANCE_VIRTUAL_PORTRAIT_DOC_URL,
    experience_url: SEEDANCE_EXPERIENCE_URL,
    steps: [
      '在资产库打开角色资产，对造型分组里的任意一张图点击「认证人像」',
      '每张图可独立提交方舟素材入库（约 1–3 分钟审核）',
      '状态变为「已认证」后，通道2 Seedance 视频生成在选用该图时自动改为 asset:// 传输',
      '不用时可对单张图「取消认证」删除方舟素材，腾出高级权益包素材资产配额',
      '若需真实演员，另在体验中心完成真人认证并绑定 Asset ID',
    ],
    notes: [
      '通道2 生视频用 ark- API Key；虚拟人像入库用同一火山账号的 Access Key / Secret Key（管控面）',
      '请在设置 → 通道2 Key 填写 AK/SK（与查余额相同），或配置 VOLCENGINE_ACCESS_KEY_ID / VOLCENGINE_SECRET_ACCESS_KEY',
      'AK/SK 在火山引擎控制台 → 访问控制 → 密钥管理 创建；需与已开通「虚拟人像/素材资产」权益包的账号一致',
      '也可在体验中心手动入库后，将 Asset ID 粘贴绑定（与真人肖像相同）',
      '写实正脸立绘可能在审核阶段被拒，可改插画风格后重新提交',
      '通道2 提交时：已认证图走 asset://；未认证图仍走公网/OSS URL',
    ],
    env: {
      asset_mode: (process.env.SEEDANCE_ASSET_BASE_URL || '').trim()
        ? 'gateway'
        : ((process.env.VOLCENGINE_ACCESS_KEY_ID || process.env.VOLC_ACCESS_KEY || process.env.SEEDANCE_ASSET_ACCESS_KEY || '').trim()
          ? 'volc_open_env'
          : 'volc_open_or_missing_aksk'),
      SEEDANCE_ASSET_BASE_URL: process.env.SEEDANCE_ASSET_BASE_URL || null,
      has_volc_aksk: !!(
        (process.env.VOLCENGINE_ACCESS_KEY_ID || process.env.VOLC_ACCESS_KEY || process.env.SEEDANCE_ASSET_ACCESS_KEY || '').trim()
        && (process.env.VOLCENGINE_SECRET_ACCESS_KEY || process.env.VOLC_SECRET_KEY || process.env.SEEDANCE_ASSET_SECRET_KEY || '').trim()
      ),
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
  imageUrl?: string | null
  localPath?: string | null
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

function normalizeLocalImagePath(raw?: string | null): string {
  return String(raw || '').trim().replace(/^\/+/, '')
}

function pathsLikelySame(a?: string | null, b?: string | null): boolean {
  const na = normalizeLocalImagePath(a)
  const nb = normalizeLocalImagePath(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const fa = na.split('/').pop() || ''
  const fb = nb.split('/').pop() || ''
  return !!fa && fa === fb
}

function isCandidateAssetActive(candidate: {
  seedance_asset_id?: string | null
  seedance_asset_status?: string | null
  seedance_certified_url?: string | null
  url?: string | null
}): boolean {
  const assetId = normalizeAssetId(candidate.seedance_asset_id)
  if (!assetId) return false
  const status = String(candidate.seedance_asset_status || '').toLowerCase()
  if (status && status !== 'active') return false
  const certified = normalizeLocalImagePath(candidate.seedance_certified_url || candidate.url)
  const current = normalizeLocalImagePath(candidate.url)
  if (certified && current && !pathsLikelySame(certified, current)) return false
  return true
}

function isOutfitAssetActive(outfit: {
  seedance_asset_id?: string | null
  seedance_asset_status?: string | null
  seedance_certified_url?: string | null
  url?: string | null
  candidates?: Array<{
    seedance_asset_id?: string | null
    seedance_asset_status?: string | null
    seedance_certified_url?: string | null
    url?: string | null
  }>
}): boolean {
  if ((outfit.candidates || []).some(isCandidateAssetActive)) return true
  const assetId = normalizeAssetId(outfit.seedance_asset_id)
  if (!assetId) return false
  const status = String(outfit.seedance_asset_status || '').toLowerCase()
  if (status && status !== 'active') return false
  const certified = normalizeLocalImagePath(outfit.seedance_certified_url || outfit.url)
  const current = normalizeLocalImagePath(outfit.url)
  if (certified && current && !pathsLikelySame(certified, current)) return false
  return true
}

/** 角色下所有已激活的 path → asset:// 绑定（基准图 + 各造型备选图） */
export function collectCharacterActiveAssetBindings(char: {
  id: number
  name?: string | null
  portraitType?: string | null
  seedanceAssetId?: string | null
  seedanceAssetStatus?: string | null
  imageUrl?: string | null
  localPath?: string | null
  referenceImages?: string | null
}): Array<{ path: string; assetUri: string; scope: 'primary' | 'outfit'; outfitId?: string; candidateId?: string }> {
  const bindings: Array<{ path: string; assetUri: string; scope: 'primary' | 'outfit'; outfitId?: string; candidateId?: string }> = []
  const primaryRef = getCharacterSeedanceAssetRef(char)
  const primaryPath = normalizeLocalImagePath(char.imageUrl || char.localPath)
  if (primaryRef && primaryPath) {
    bindings.push({ path: primaryPath, assetUri: primaryRef.url, scope: 'primary' })
  } else if (primaryRef) {
    bindings.push({ path: '', assetUri: primaryRef.url, scope: 'primary' })
  }

  for (const outfit of listCharacterOutfits(char.referenceImages)) {
    const candidates = outfit.candidates || []
    let anyCandidateBound = false
    for (const candidate of candidates) {
      if (!isCandidateAssetActive(candidate)) continue
      const assetUri = toAssetUri(candidate.seedance_asset_id)
      const path = normalizeLocalImagePath(candidate.url)
      if (!assetUri || !path) continue
      bindings.push({
        path,
        assetUri,
        scope: 'outfit',
        outfitId: outfit.outfit_id,
        candidateId: candidate.id,
      })
      anyCandidateBound = true
    }
    // 兼容旧版仅定稿级认证
    if (!anyCandidateBound && isOutfitAssetActive(outfit)) {
      const assetUri = toAssetUri(outfit.seedance_asset_id)
      const path = normalizeLocalImagePath(outfit.seedance_certified_url || outfit.url)
      if (assetUri && path) {
        bindings.push({
          path,
          assetUri,
          scope: 'outfit',
          outfitId: outfit.outfit_id,
        })
      }
    }
  }
  return bindings
}

/**
 * 若解析出的角色图已认证（基准图或造型定稿），则改用 asset://。
 */
export function resolveCharacterVideoImageUrl(
  char: {
    id: number
    name?: string | null
    portraitType?: string | null
    seedanceAssetId?: string | null
    seedanceAssetStatus?: string | null
    imageUrl?: string | null
    localPath?: string | null
    referenceImages?: string | null
  },
  resolvedLocalUrl?: string | null,
): string | null {
  const local = normalizeLocalImagePath(resolvedLocalUrl)
  const bindings = collectCharacterActiveAssetBindings(char)

  if (!local) {
    const primary = bindings.find(b => b.scope === 'primary')
    return primary?.assetUri || null
  }

  for (const binding of bindings) {
    if (binding.path && pathsLikelySame(local, binding.path)) return binding.assetUri
  }
  return local || null
}

/** 把 content_refs / 参考图 URL 中已认证角色图改写为 asset:// */
export function rewriteUrlsToSeedanceAssets(
  urls: Array<string | null | undefined>,
  dramaId?: number | null,
): string[] {
  const chars = dramaId
    ? db.select().from(schema.characters).where(eq(schema.characters.dramaId, dramaId)).all()
    : db.select().from(schema.characters).all()

  const allBindings = chars.flatMap(c => collectCharacterActiveAssetBindings(c))
  if (!allBindings.length) {
    return urls.map(u => String(u || '').trim()).filter(Boolean)
  }

  return urls.map((raw) => {
    const url = String(raw || '').trim()
    if (!url || url.startsWith(ASSET_URI_PREFIX)) return url
    for (const binding of allBindings) {
      if (binding.path && pathsLikelySame(url, binding.path)) {
        return binding.assetUri
      }
    }
    return url
  }).filter(Boolean)
}

/** @deprecated 使用 getCharacterSeedanceAssetRef */
export function getCharacterPortraitRef(char: Parameters<typeof getCharacterSeedanceAssetRef>[0]) {
  return getCharacterSeedanceAssetRef(char)
}
