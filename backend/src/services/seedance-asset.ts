/**
 * Seedance 2.0 私域素材入库
 * - 官方推荐：火山管控面 open.volcengineapi.com + AK/SK（开通虚拟人像权益包后使用）
 * - 可选聚合网关：SEEDANCE_ASSET_BASE_URL + /volc/asset/*（如 Anyfast）
 * - 火山方舟 ark- API Key 只能生视频，不能直连 /portrait/ 入库（会 404）
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { normalizeAssetId, toAssetUri } from '../constants/seedance-portrait.js'
import { getActiveConfig } from './ai.js'
import type { AIConfig } from './ai.js'
import { parseOfficialKeySettings } from './official-volcengine-keys.js'
import { volcArkAssetOpenAction, type VolcArkAssetCredentials } from './volcengine-ark-asset.js'
import { readImageAsCompressedDataUrl } from '../utils/storage.js'
import { isOssConfigured, resolveMediaUrlForExternalApi } from '../utils/oss-upload.js'
import { now } from '../utils/response.js'
import { logTaskError, logTaskProgress, logTaskWarn } from '../utils/task-logger.js'
import {
  characterHasAnySeedanceAsset,
  findCharacterOutfit,
  findCharacterOutfitCandidate,
  updateCharacterOutfitCandidateSeedanceFields,
  updateCharacterOutfitSeedanceFields,
} from '../utils/character-image-variants.js'

const PORTRAIT_VERSION = '2024-01-01'
const POLL_INTERVAL_MS = 3000
const POLL_MAX_ATTEMPTS = 100

export type SeedanceAssetStatus = 'pending' | 'processing' | 'active' | 'failed'
type AssetClientMode = 'volc_open' | 'volc_asset' | 'portrait'

interface AssetClient {
  mode: AssetClientMode
  config: AIConfig
  baseUrl: string
  credentials?: VolcArkAssetCredentials | null
}

function resolveVolcAssetCredentials(video: AIConfig): VolcArkAssetCredentials | null {
  const envAk = (
    process.env.SEEDANCE_ASSET_ACCESS_KEY
    || process.env.VOLCENGINE_ACCESS_KEY_ID
    || process.env.VOLC_ACCESS_KEY
    || ''
  ).trim()
  const envSk = (
    process.env.SEEDANCE_ASSET_SECRET_KEY
    || process.env.VOLCENGINE_SECRET_ACCESS_KEY
    || process.env.VOLC_SECRET_KEY
    || ''
  ).trim()
  if (envAk && envSk) return { accessKeyId: envAk, secretAccessKey: envSk }

  const rawSettings = video.settings
  const settings = typeof rawSettings === 'string'
    ? parseOfficialKeySettings(rawSettings)
    : {
        access_key: rawSettings?.access_key ? String(rawSettings.access_key) : null,
        secret_key: rawSettings?.secret_key ? String(rawSettings.secret_key) : null,
      }
  const ak = String(settings.access_key || '').trim()
  const sk = String(settings.secret_key || '').trim()
  if (ak && sk) return { accessKeyId: ak, secretAccessKey: sk }
  return null
}

export function getAssetClient(): AssetClient {
  const video = getActiveConfig('video')
  if (!video?.apiKey) throw new Error('未配置视频服务 API Key')

  const assetBase = (process.env.SEEDANCE_ASSET_BASE_URL || '').trim().replace(/\/+$/, '')
  const assetKey = (process.env.SEEDANCE_ASSET_API_KEY || '').trim() || video.apiKey

  if (assetBase) {
    const mode: AssetClientMode = /portrait/i.test(assetBase) ? 'portrait' : 'volc_asset'
    return {
      mode,
      baseUrl: assetBase,
      config: { ...video, baseUrl: assetBase, apiKey: assetKey },
    }
  }

  const credentials = resolveVolcAssetCredentials(video)
  if (credentials) {
    return {
      mode: 'volc_open',
      baseUrl: 'https://open.volcengineapi.com',
      config: video,
      credentials,
    }
  }

  throw new Error(
    '虚拟人像入库需要火山管控面 Access Key / Secret Key（不是 ark- API Key）。'
    + '请在设置 → 通道2 Key 中填写 AK/SK（与查余额同一组），'
    + '或配置环境变量 VOLCENGINE_ACCESS_KEY_ID / VOLCENGINE_SECRET_ACCESS_KEY。'
    + 'AK/SK 在火山引擎控制台 → 访问控制 → 密钥管理 创建。',
  )
}

function extractPortraitError(json: any): string | null {
  const err = json?.ResponseMetadata?.Error ?? json?.error
  if (!err) return null
  const code = err.Code ?? err.code
  const message = err.Message ?? err.message
  if (!code && !message) return null
  return `${code || 'Error'}: ${message || 'Portrait API failed'}`
}

function extractVolcAssetError(json: any, status: number): string | null {
  const err = json?.error ?? json?.ResponseMetadata?.Error
  if (err?.message) return String(err.message)
  if (status >= 400) return JSON.stringify(json).slice(0, 300)
  return null
}

function formatAssetApiFailure(mode: AssetClientMode, status: number, detail: string): Error {
  if (status === 404 && mode === 'portrait') {
    return new Error(
      '火山方舟直连未提供素材入库接口（/portrait/ 返回 404）。'
      + '请在服务端配置环境变量 SEEDANCE_ASSET_BASE_URL（支持 /volc/asset 的 Seedance 素材网关，如 Anyfast），'
      + '或在方舟体验中心手动入库后将 Asset ID 粘贴到角色卡片。',
    )
  }
  if (status === 401) {
    return new Error(
      `素材 API 鉴权失败（401）。若使用聚合网关，请配置 SEEDANCE_ASSET_API_KEY 为该平台的 Key（可与方舟 Key 不同）。详情：${detail}`,
    )
  }
  return new Error(`素材 API 失败（HTTP ${status}）：${detail}`)
}

async function portraitAction(client: AssetClient, action: string, body: Record<string, unknown>) {
  const url = `${client.baseUrl.replace(/\/+$/, '')}/portrait/?Action=${encodeURIComponent(action)}&Version=${PORTRAIT_VERSION}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${client.config.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  let json: any
  const text = await resp.text()
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw formatAssetApiFailure('portrait', resp.status, text.slice(0, 200) || '非 JSON 响应')
  }

  const apiErr = extractPortraitError(json)
  if (apiErr) throw new Error(apiErr)
  if (!resp.ok) throw formatAssetApiFailure('portrait', resp.status, JSON.stringify(json).slice(0, 300))

  return json.Result ?? json
}

async function volcAssetAction(client: AssetClient, action: string, body: Record<string, unknown>) {
  const url = `${client.baseUrl.replace(/\/+$/, '')}/volc/asset/${action}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${client.config.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  let json: any
  const text = await resp.text()
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw formatAssetApiFailure('volc_asset', resp.status, text.slice(0, 200) || '非 JSON 响应')
  }

  const apiErr = extractVolcAssetError(json, resp.status)
  if (apiErr && resp.status >= 400) throw formatAssetApiFailure('volc_asset', resp.status, apiErr)
  if (!resp.ok) throw formatAssetApiFailure('volc_asset', resp.status, JSON.stringify(json).slice(0, 300))

  return json
}

async function resolveImageUrlForPortrait(localPath: string, dramaId?: number | null): Promise<string> {
  const raw = String(localPath || '').trim()
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw

  const normalized = raw.startsWith('/static/')
    ? raw.slice(1)
    : raw.startsWith('static/')
      ? raw
      : `static/${raw.replace(/^\/+/, '')}`

  if (isOssConfigured()) {
    try {
      const ossUrl = await resolveMediaUrlForExternalApi(normalized, dramaId)
      if (ossUrl?.startsWith('http')) return ossUrl
    } catch (err: any) {
      logTaskWarn('SeedanceAsset', 'oss-url-failed', { path: normalized, error: err?.message })
    }
  }

  const publicBase = (
    process.env.PUBLIC_BASE_URL
    || process.env.OSS_PUBLIC_BASE_URL
    || ''
  ).trim().replace(/\/+$/, '')
  if (publicBase) {
    return `${publicBase}/${normalized}`
  }

  logTaskWarn('SeedanceAsset', 'no-public-base-url', {
    hint: '设置 PUBLIC_BASE_URL / OSS 供方舟拉取立绘；未配置时使用 data URI（官方可能不接受）',
  })
  const dataUrl = await readImageAsCompressedDataUrl(normalized, {
    maxWidth: 1024,
    maxHeight: 1024,
    quality: 80,
  })
  if (!dataUrl) throw new Error('无法读取角色立绘文件')
  return dataUrl
}

async function ensureAigcAssetGroup(
  client: AssetClient,
  characterId: number,
  characterName: string,
  existingGroupId?: string | null,
): Promise<string> {
  const existing = normalizeAssetId(existingGroupId)
  if (existing?.startsWith('group-')) return existing

  if (client.mode === 'volc_open') {
    const result = await volcArkAssetOpenAction(client.credentials!, 'CreateAssetGroup', {
      Name: `huobao-char-${characterId}`.slice(0, 64),
      Description: `火宝短剧 AIGC 角色立绘：${characterName || characterId}`.slice(0, 300),
      GroupType: 'AIGC',
    })
    const groupId = normalizeAssetId(result?.Id ?? result?.id)
    if (!groupId) throw new Error('创建素材组失败：未返回 GroupId')
    return groupId
  }

  if (client.mode === 'volc_asset') {
    const result = await volcAssetAction(client, 'CreateAssetGroup', {
      model: 'volc-asset',
      Name: `huobao-char-${characterId}`,
    })
    const groupId = normalizeAssetId(result?.Id ?? result?.id)
    if (!groupId) throw new Error('创建素材组失败：未返回 GroupId')
    return groupId
  }

  const result = await portraitAction(client, 'CreateAssetGroup', {
    GroupType: 'AIGC',
    Name: `huobao-char-${characterId}`,
    Title: characterName || `角色${characterId}`,
    Description: '火宝短剧 AIGC 角色立绘素材组',
  })
  const groupId = normalizeAssetId(result?.Id ?? result?.id)
  if (!groupId) throw new Error('创建素材组失败：未返回 GroupId')
  return groupId
}

async function createPortraitImageAsset(
  client: AssetClient,
  groupId: string,
  imageUrl: string,
  name: string,
): Promise<string> {
  if (client.mode === 'volc_open') {
    const result = await volcArkAssetOpenAction(client.credentials!, 'CreateAsset', {
      GroupId: groupId,
      URL: imageUrl,
      AssetType: 'Image',
      Name: name.slice(0, 64),
    })
    const assetId = normalizeAssetId(result?.Id ?? result?.id)
    if (!assetId) throw new Error('创建素材失败：未返回 AssetId')
    return assetId
  }

  if (client.mode === 'volc_asset') {
    const result = await volcAssetAction(client, 'CreateAsset', {
      model: 'volc-asset',
      GroupId: groupId,
      URL: imageUrl,
      AssetType: 'Image',
      Name: name,
    })
    const assetId = normalizeAssetId(result?.Id ?? result?.id)
    if (!assetId) throw new Error('创建素材失败：未返回 AssetId')
    return assetId
  }

  const result = await portraitAction(client, 'CreateAsset', {
    GroupId: groupId,
    URL: imageUrl,
    AssetType: 'Image',
    Name: name,
  })
  const assetId = normalizeAssetId(result?.Id ?? result?.id)
  if (!assetId) throw new Error('创建素材失败：未返回 AssetId')
  return assetId
}

async function deletePortraitAsset(client: AssetClient, assetId: string): Promise<void> {
  const id = normalizeAssetId(assetId)
  if (!id) return
  if (client.mode === 'volc_open') {
    await volcArkAssetOpenAction(client.credentials!, 'DeleteAsset', { Id: id })
    return
  }
  if (client.mode === 'volc_asset') {
    await volcAssetAction(client, 'DeleteAsset', { model: 'volc-asset', Id: id })
    return
  }
  await portraitAction(client, 'DeleteAsset', { Id: id })
}

async function deletePortraitAssetGroup(client: AssetClient, groupId: string): Promise<void> {
  const id = normalizeAssetId(groupId)
  if (!id) return
  if (client.mode === 'volc_open') {
    await volcArkAssetOpenAction(client.credentials!, 'DeleteAssetGroup', { Id: id })
    return
  }
  if (client.mode === 'volc_asset') {
    await volcAssetAction(client, 'DeleteAssetGroup', { model: 'volc-asset', Id: id })
    return
  }
  await portraitAction(client, 'DeleteAssetGroup', { Id: id })
}

async function getPortraitAssetStatus(
  client: AssetClient,
  assetId: string,
): Promise<{ status: string; failedReason?: string }> {
  if (client.mode === 'volc_open') {
    const result = await volcArkAssetOpenAction(client.credentials!, 'GetAsset', { Id: assetId })
    const item = result?.AssetItem ?? result
    return {
      status: String(item?.Status || item?.UpstreamStatus || 'Processing'),
      failedReason: item?.FailedReason
        ?? item?.failed_reason
        ?? item?.Error?.Message
        ?? item?.error?.message,
    }
  }

  try {
    const result = await portraitAction(client, 'GetAsset', { Id: assetId })
    const item = result?.AssetItem ?? result
    return {
      status: String(item?.Status || 'Processing'),
      failedReason: item?.FailedReason ?? item?.failed_reason,
    }
  } catch (err: any) {
    if (client.mode === 'volc_asset') {
      logTaskWarn('SeedanceAsset', 'get-asset-skip', { assetId, error: err.message })
      return { status: 'Active' }
    }
    throw err
  }
}

async function pollPortraitAssetActive(client: AssetClient, assetId: string): Promise<void> {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    const { status, failedReason } = await getPortraitAssetStatus(client, assetId)
    if (status === 'Active') return
    if (status === 'Failed') {
      throw new Error(failedReason || '素材审核未通过（可能被判定为真人脸或违规内容）')
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error('素材入库审核超时，请稍后在角色卡片点击「刷新状态」')
}

function updateCharacterAssetFields(
  characterId: number,
  fields: {
    seedanceAssetGroupId?: string | null
    seedanceAssetId?: string | null
    seedanceAssetStatus?: string | null
    portraitType?: string
  },
) {
  db.update(schema.characters)
    .set({ ...fields, updatedAt: now() })
    .where(eq(schema.characters.id, characterId))
    .run()
}

export interface SyncCharacterAssetResult {
  character: typeof schema.characters.$inferSelect
  asset_id: string
  asset_uri: string
  group_id: string
  status: SeedanceAssetStatus
  skipped?: boolean
  outfit_id?: string | null
  candidate_id?: string | null
}

export async function syncCharacterSeedanceAsset(
  characterId: number,
  options?: { force?: boolean; outfitId?: string | null; candidateId?: string | null },
): Promise<SyncCharacterAssetResult> {
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  if (!char) throw new Error('角色不存在')

  const outfitId = String(options?.outfitId || '').trim() || null
  const candidateId = String(options?.candidateId || '').trim() || null
  const outfit = outfitId ? findCharacterOutfit(char.referenceImages, outfitId) : null
  if (outfitId && !outfit) throw new Error('服装造型不存在')

  let imagePath: string | null | undefined = null
  let existingAssetId: string | null = null
  let existingStatus = ''

  if (outfitId && candidateId) {
    const candidate = findCharacterOutfitCandidate(char.referenceImages, outfitId, candidateId)
      || (outfit?.candidates || []).find(c => c.id === candidateId)
    if (!candidate) throw new Error('备选图不存在')
    imagePath = candidate.url
    existingAssetId = normalizeAssetId(candidate.seedance_asset_id)
    existingStatus = String(candidate.seedance_asset_status || '').toLowerCase()
  } else if (outfitId) {
    // 兼容：未传 candidateId 时认当前定稿
    imagePath = outfit!.url
    const matched = (outfit!.candidates || []).find(c =>
      String(c.url || '').replace(/^\/+/, '') === String(outfit!.url || '').replace(/^\/+/, ''),
    )
    if (matched?.seedance_asset_id) {
      existingAssetId = normalizeAssetId(matched.seedance_asset_id)
      existingStatus = String(matched.seedance_asset_status || '').toLowerCase()
    } else {
      existingAssetId = normalizeAssetId(outfit!.seedance_asset_id)
      existingStatus = String(outfit!.seedance_asset_status || '').toLowerCase()
    }
  } else {
    imagePath = char.imageUrl || char.localPath
    existingAssetId = normalizeAssetId(char.seedanceAssetId)
    existingStatus = String(char.seedanceAssetStatus || '').toLowerCase()
  }

  if (!imagePath) {
    throw new Error(outfitId ? '请先上传该造型图片' : '请先生成或上传角色立绘')
  }

  const resolvedCandidateId = candidateId
    || (outfit
      ? ((outfit.candidates || []).find(c =>
          String(c.url || '').replace(/^\/+/, '') === String(imagePath || '').replace(/^\/+/, ''),
        )?.id || null)
      : null)

  const client = getAssetClient()

  if (
    !options?.force
    && existingAssetId
    && existingStatus === 'active'
    && char.seedanceAssetGroupId
  ) {
    try {
      const current = await getPortraitAssetStatus(client, existingAssetId)
      if (current.status === 'Active') {
        return {
          character: char,
          asset_id: existingAssetId,
          asset_uri: toAssetUri(existingAssetId)!,
          group_id: char.seedanceAssetGroupId,
          status: 'active',
          skipped: true,
          outfit_id: outfitId,
          candidate_id: resolvedCandidateId,
        }
      }
    } catch {
      // 继续重新入库
    }
  }

  const patchProcessing = () => {
    if (outfitId && resolvedCandidateId) {
      updateCharacterOutfitCandidateSeedanceFields(characterId, outfitId, resolvedCandidateId, {
        seedance_asset_status: 'processing',
      })
    } else if (outfitId) {
      updateCharacterOutfitSeedanceFields(characterId, outfitId, {
        seedance_asset_status: 'processing',
      })
    } else {
      updateCharacterAssetFields(characterId, {
        portraitType: 'ai',
        seedanceAssetStatus: 'processing',
      })
    }
  }
  patchProcessing()

  logTaskProgress('SeedanceAsset', 'sync-start', {
    characterId,
    outfitId,
    candidateId: resolvedCandidateId,
    name: char.name,
    mode: client.mode,
    baseUrl: client.baseUrl,
  })

  try {
    const groupId = await ensureAigcAssetGroup(
      client,
      characterId,
      char.name || '',
      char.seedanceAssetGroupId,
    )

    updateCharacterAssetFields(characterId, { seedanceAssetGroupId: groupId })

    const imageUrl = await resolveImageUrlForPortrait(imagePath, char.dramaId)
    const assetName = outfitId
      ? `char-${characterId}-outfit-${outfitId}-${resolvedCandidateId || 'default'}-${Date.now()}`
      : `char-${characterId}-${Date.now()}`
    const assetId = await createPortraitImageAsset(client, groupId, imageUrl, assetName)

    if (outfitId && resolvedCandidateId) {
      updateCharacterOutfitCandidateSeedanceFields(characterId, outfitId, resolvedCandidateId, {
        seedance_asset_id: assetId,
        seedance_asset_status: 'processing',
        seedance_certified_url: imagePath,
      })
    } else if (outfitId) {
      updateCharacterOutfitSeedanceFields(characterId, outfitId, {
        seedance_asset_id: assetId,
        seedance_asset_status: 'processing',
        seedance_certified_url: imagePath,
      })
    } else {
      updateCharacterAssetFields(characterId, {
        seedanceAssetId: assetId,
        seedanceAssetStatus: 'processing',
      })
    }

    await pollPortraitAssetActive(client, assetId)

    if (outfitId && resolvedCandidateId) {
      updateCharacterOutfitCandidateSeedanceFields(characterId, outfitId, resolvedCandidateId, {
        seedance_asset_status: 'active',
        seedance_certified_url: imagePath,
      })
    } else if (outfitId) {
      updateCharacterOutfitSeedanceFields(characterId, outfitId, {
        seedance_asset_status: 'active',
        seedance_certified_url: imagePath,
      })
    } else {
      updateCharacterAssetFields(characterId, {
        seedanceAssetStatus: 'active',
        portraitType: 'ai',
      })
    }

    const [updated] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()

    logTaskProgress('SeedanceAsset', 'sync-done', {
      characterId,
      outfitId,
      candidateId: resolvedCandidateId,
      assetId,
      groupId,
    })

    return {
      character: updated!,
      asset_id: assetId,
      asset_uri: toAssetUri(assetId)!,
      group_id: groupId,
      status: 'active',
      outfit_id: outfitId,
      candidate_id: resolvedCandidateId,
    }
  } catch (err: any) {
    logTaskError('SeedanceAsset', 'sync-failed', {
      characterId,
      outfitId,
      candidateId: resolvedCandidateId,
      error: err.message,
    })
    if (outfitId && resolvedCandidateId) {
      updateCharacterOutfitCandidateSeedanceFields(characterId, outfitId, resolvedCandidateId, {
        seedance_asset_status: 'failed',
      })
    } else if (outfitId) {
      updateCharacterOutfitSeedanceFields(characterId, outfitId, { seedance_asset_status: 'failed' })
    } else {
      updateCharacterAssetFields(characterId, { seedanceAssetStatus: 'failed' })
    }
    throw err
  }
}

export async function refreshCharacterSeedanceAssetStatus(
  characterId: number,
  options?: { outfitId?: string | null; candidateId?: string | null },
) {
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  if (!char) throw new Error('角色不存在')

  const outfitId = String(options?.outfitId || '').trim() || null
  const candidateId = String(options?.candidateId || '').trim() || null
  const outfit = outfitId ? findCharacterOutfit(char.referenceImages, outfitId) : null
  if (outfitId && !outfit) throw new Error('服装造型不存在')

  let assetId: string | null = null
  if (outfitId && candidateId) {
    const candidate = findCharacterOutfitCandidate(char.referenceImages, outfitId, candidateId)
    assetId = normalizeAssetId(candidate?.seedance_asset_id)
  } else if (outfitId) {
    assetId = normalizeAssetId(outfit?.seedance_asset_id)
  } else {
    assetId = normalizeAssetId(char.seedanceAssetId)
  }
  if (!assetId) throw new Error(outfitId ? '该图片尚未提交素材库' : '角色尚未提交素材库')

  const client = getAssetClient()
  const { status, failedReason } = await getPortraitAssetStatus(client, assetId)

  let mapped: SeedanceAssetStatus = 'processing'
  if (status === 'Active') mapped = 'active'
  else if (status === 'Failed') mapped = 'failed'

  if (outfitId && candidateId) {
    updateCharacterOutfitCandidateSeedanceFields(characterId, outfitId, candidateId, {
      seedance_asset_status: mapped,
    })
  } else if (outfitId) {
    updateCharacterOutfitSeedanceFields(characterId, outfitId, { seedance_asset_status: mapped })
  } else {
    updateCharacterAssetFields(characterId, { seedanceAssetStatus: mapped })
  }

  const [updated] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  return {
    character: updated!,
    status: mapped,
    failed_reason: failedReason,
    asset_uri: toAssetUri(assetId),
    outfit_id: outfitId,
    candidate_id: candidateId,
    seedance_asset_id: assetId,
  }
}

/** 取消虚拟人像认证：删除方舟素材（腾出权益包素材资产配额）并清空本站字段 */
export async function cancelCharacterSeedanceAsset(
  characterId: number,
  options?: { deleteGroup?: boolean; outfitId?: string | null; candidateId?: string | null },
): Promise<{
  character: typeof schema.characters.$inferSelect
  deleted_asset_id: string | null
  outfit_id?: string | null
  candidate_id?: string | null
}> {
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  if (!char) throw new Error('角色不存在')

  const outfitId = String(options?.outfitId || '').trim() || null
  const candidateId = String(options?.candidateId || '').trim() || null
  const outfit = outfitId ? findCharacterOutfit(char.referenceImages, outfitId) : null
  if (outfitId && !outfit) throw new Error('服装造型不存在')

  let assetId: string | null = null
  if (outfitId && candidateId) {
    const candidate = findCharacterOutfitCandidate(char.referenceImages, outfitId, candidateId)
    if (!candidate) throw new Error('备选图不存在')
    assetId = normalizeAssetId(candidate.seedance_asset_id)
  } else if (outfitId) {
    assetId = normalizeAssetId(outfit?.seedance_asset_id)
  } else {
    assetId = normalizeAssetId(char.seedanceAssetId)
  }
  const groupId = normalizeAssetId(char.seedanceAssetGroupId)

  if (!assetId && !outfitId && !groupId) {
    updateCharacterAssetFields(characterId, {
      seedanceAssetId: null,
      seedanceAssetGroupId: null,
      seedanceAssetStatus: null,
    })
    const [cleared] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
    return { character: cleared!, deleted_asset_id: null, outfit_id: null, candidate_id: null }
  }

  if (!assetId && outfitId && candidateId) {
    updateCharacterOutfitCandidateSeedanceFields(characterId, outfitId, candidateId, {
      seedance_asset_id: null,
      seedance_asset_status: null,
      seedance_certified_url: null,
    })
    const [cleared] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
    return { character: cleared!, deleted_asset_id: null, outfit_id: outfitId, candidate_id: candidateId }
  }

  if (!assetId && outfitId) {
    updateCharacterOutfitSeedanceFields(characterId, outfitId, {
      seedance_asset_id: null,
      seedance_asset_status: null,
      seedance_certified_url: null,
    })
    const [cleared] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
    return { character: cleared!, deleted_asset_id: null, outfit_id: outfitId, candidate_id: candidateId }
  }

  const client = getAssetClient()
  const errors: string[] = []

  if (assetId) {
    try {
      await deletePortraitAsset(client, assetId)
    } catch (err: any) {
      errors.push(`DeleteAsset: ${err?.message || err}`)
    }
  }

  if (outfitId && candidateId) {
    updateCharacterOutfitCandidateSeedanceFields(characterId, outfitId, candidateId, {
      seedance_asset_id: null,
      seedance_asset_status: null,
      seedance_certified_url: null,
    })
  } else if (outfitId) {
    updateCharacterOutfitSeedanceFields(characterId, outfitId, {
      seedance_asset_id: null,
      seedance_asset_status: null,
      seedance_certified_url: null,
    })
  } else {
    updateCharacterAssetFields(characterId, {
      seedanceAssetId: null,
      seedanceAssetStatus: null,
    })
  }

  const [afterClear] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  const stillHasAssets = characterHasAnySeedanceAsset(afterClear!)

  if (!stillHasAssets && options?.deleteGroup !== false && groupId) {
    try {
      await deletePortraitAssetGroup(client, groupId)
    } catch (err: any) {
      logTaskWarn('SeedanceAsset', 'delete-group-skip', {
        characterId,
        groupId,
        error: String(err?.message || err),
      })
    }
    updateCharacterAssetFields(characterId, { seedanceAssetGroupId: null })
  }

  if (errors.length && assetId) {
    logTaskWarn('SeedanceAsset', 'cancel-partial', { characterId, outfitId, candidateId, errors })
  }

  const [updated] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  logTaskProgress('SeedanceAsset', 'cancel-done', { characterId, outfitId, candidateId, assetId })
  return {
    character: updated!,
    deleted_asset_id: assetId,
    outfit_id: outfitId,
    candidate_id: candidateId,
  }
}

/** @deprecated 使用 getAssetClient */
export function getPortraitApiConfig(): AIConfig {
  return getAssetClient().config
}
