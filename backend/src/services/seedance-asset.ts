/**
 * Seedance 2.0 私域素材入库
 * - 聚合网关：SEEDANCE_ASSET_BASE_URL + /volc/asset/*（如 Anyfast）
 * - 可选：SEEDANCE_ASSET_API_KEY（默认同视频配置 API Key）
 * - 火山方舟直连 ark.cn-beijing 仅开放视频/Files API，/portrait/ 会 404
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { SEEDANCE_ARK_BASE_URL } from '../constants/seedance.js'
import { normalizeAssetId, toAssetUri } from '../constants/seedance-portrait.js'
import { getActiveConfig } from './ai.js'
import type { AIConfig } from './ai.js'
import { readImageAsCompressedDataUrl } from '../utils/storage.js'
import { now } from '../utils/response.js'
import { logTaskError, logTaskProgress, logTaskWarn } from '../utils/task-logger.js'

const PORTRAIT_VERSION = '2024-01-01'
const POLL_INTERVAL_MS = 3000
const POLL_MAX_ATTEMPTS = 100

export type SeedanceAssetStatus = 'pending' | 'processing' | 'active' | 'failed'
type AssetClientMode = 'volc_asset' | 'portrait'

interface AssetClient {
  mode: AssetClientMode
  config: AIConfig
  baseUrl: string
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

  return {
    mode: 'portrait',
    baseUrl: SEEDANCE_ARK_BASE_URL,
    config: { ...video, baseUrl: SEEDANCE_ARK_BASE_URL, apiKey: video.apiKey },
  }
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

async function resolveImageUrlForPortrait(localPath: string): Promise<string> {
  const publicBase = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
  const normalized = localPath.startsWith('/static/')
    ? localPath.slice(1)
    : localPath.startsWith('static/')
      ? localPath
      : `static/${localPath.replace(/^\/+/, '')}`

  if (publicBase) {
    return `${publicBase}/${normalized}`
  }

  logTaskWarn('SeedanceAsset', 'no-public-base-url', {
    hint: '设置 PUBLIC_BASE_URL 供网关拉取立绘；未配置时使用 data URI',
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

async function getPortraitAssetStatus(
  client: AssetClient,
  assetId: string,
): Promise<{ status: string; failedReason?: string }> {
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
}

export async function syncCharacterSeedanceAsset(
  characterId: number,
  options?: { force?: boolean },
): Promise<SyncCharacterAssetResult> {
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  if (!char) throw new Error('角色不存在')

  const imagePath = char.imageUrl || char.localPath
  if (!imagePath) throw new Error('请先生成或上传角色立绘')

  const client = getAssetClient()

  if (
    !options?.force
    && char.seedanceAssetId
    && char.seedanceAssetStatus === 'active'
    && char.seedanceAssetGroupId
  ) {
    try {
      const current = await getPortraitAssetStatus(client, char.seedanceAssetId)
      if (current.status === 'Active') {
        return {
          character: char,
          asset_id: char.seedanceAssetId,
          asset_uri: toAssetUri(char.seedanceAssetId)!,
          group_id: char.seedanceAssetGroupId,
          status: 'active',
          skipped: true,
        }
      }
    } catch {
      // 继续重新入库
    }
  }

  updateCharacterAssetFields(characterId, {
    portraitType: 'ai',
    seedanceAssetStatus: 'processing',
  })

  logTaskProgress('SeedanceAsset', 'sync-start', {
    characterId,
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

    const imageUrl = await resolveImageUrlForPortrait(imagePath)
    const assetId = await createPortraitImageAsset(
      client,
      groupId,
      imageUrl,
      `char-${characterId}-${Date.now()}`,
    )

    updateCharacterAssetFields(characterId, {
      seedanceAssetId: assetId,
      seedanceAssetStatus: 'processing',
    })

    await pollPortraitAssetActive(client, assetId)

    updateCharacterAssetFields(characterId, {
      seedanceAssetStatus: 'active',
      portraitType: 'ai',
    })

    const [updated] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()

    logTaskProgress('SeedanceAsset', 'sync-done', { characterId, assetId, groupId })

    return {
      character: updated!,
      asset_id: assetId,
      asset_uri: toAssetUri(assetId)!,
      group_id: groupId,
      status: 'active',
    }
  } catch (err: any) {
    logTaskError('SeedanceAsset', 'sync-failed', { characterId, error: err.message })
    updateCharacterAssetFields(characterId, { seedanceAssetStatus: 'failed' })
    throw err
  }
}

export async function refreshCharacterSeedanceAssetStatus(characterId: number) {
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  if (!char?.seedanceAssetId) throw new Error('角色尚未提交素材库')

  const client = getAssetClient()
  const { status, failedReason } = await getPortraitAssetStatus(client, char.seedanceAssetId)

  let mapped: SeedanceAssetStatus = 'processing'
  if (status === 'Active') mapped = 'active'
  else if (status === 'Failed') mapped = 'failed'

  updateCharacterAssetFields(characterId, { seedanceAssetStatus: mapped })

  const [updated] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  return {
    character: updated!,
    status: mapped,
    failed_reason: failedReason,
    asset_uri: toAssetUri(char.seedanceAssetId),
  }
}

/** @deprecated 使用 getAssetClient */
export function getPortraitApiConfig(): AIConfig {
  return getAssetClient().config
}
