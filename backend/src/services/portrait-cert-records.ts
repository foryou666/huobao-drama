/**
 * 虚拟人像认证流水：软取消保留记录，便于误操作后重新认证
 */
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { listCharacterOutfits, findCharacterOutfit } from '../utils/character-image-variants.js'
import {
  formatOfficialKeyAccount,
  maskOfficialApiKey,
  parseOfficialKeySettings,
} from './official-volcengine-keys.js'
import type { OfficialKeySettings } from './official-volcengine-keys.js'
import { listOfficialVolcengineConfigRows } from '../utils/official-volcengine-video.js'
import { getAssetClient } from './seedance-asset.js'
import type { AuthUser } from '../middleware/auth.js'

export const DEFAULT_PORTRAIT_ASSET_QUOTA = Math.max(
  1,
  Number(process.env.PORTRAIT_ASSET_QUOTA_DEFAULT || 50) || 50,
)

export type PortraitCertStatus = 'processing' | 'active' | 'failed' | 'cancelled'

function operatorName(user?: AuthUser | null) {
  if (!user) return null
  return user.displayName || user.username || `user#${user.id}`
}

function findOfficialConfigByApiKey(apiKey: string) {
  const key = String(apiKey || '').trim()
  if (!key) return null
  return listOfficialVolcengineConfigRows().find((r: { apiKey?: string | null; id: number; name?: string | null }) =>
    String(r.apiKey || '').trim() === key,
  ) || null
}

function primaryOutfitClause() {
  return or(
    isNull(schema.portraitCertRecords.outfitId),
    eq(schema.portraitCertRecords.outfitId, ''),
  )
}

export function resolvePortraitAssetKeyMeta() {
  try {
    const client = getAssetClient()
    const apiKey = String(client.config.apiKey || '').trim()
    const row = findOfficialConfigByApiKey(apiKey)
    if (row) {
      return {
        config_id: row.id as number,
        config_name: row.name || `Key#${row.id}`,
        api_key_masked: maskOfficialApiKey(row.apiKey),
      }
    }
    const envAsset = (process.env.SEEDANCE_ASSET_API_KEY || '').trim()
    if (envAsset && envAsset === apiKey) {
      return {
        config_id: null as number | null,
        config_name: 'SEEDANCE_ASSET_API_KEY',
        api_key_masked: maskOfficialApiKey(apiKey),
      }
    }
    return {
      config_id: null as number | null,
      config_name: '当前视频 API Key',
      api_key_masked: maskOfficialApiKey(apiKey),
    }
  } catch {
    return {
      config_id: null as number | null,
      config_name: '未配置',
      api_key_masked: '',
    }
  }
}

function dramaTitleOf(dramaId?: number | null) {
  if (!dramaId) return null
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  return drama?.title || null
}

export function beginPortraitCertRecord(input: {
  characterId: number
  outfitId?: string | null
  user?: AuthUser | null
  force?: boolean
  imageUrl?: string | null
}): typeof schema.portraitCertRecords.$inferSelect | null {
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, input.characterId)).all()
  if (!char) return null

  const outfitId = String(input.outfitId || '').trim() || null
  const outfit = outfitId ? findCharacterOutfit(char.referenceImages, outfitId) : null
  const imageUrl = input.imageUrl
    || (outfit ? outfit.url : (char.imageUrl || char.localPath || null))
  const keyMeta = resolvePortraitAssetKeyMeta()
  const ts = now()

  if (input.force) {
    const actives = db.select().from(schema.portraitCertRecords).where(and(
      eq(schema.portraitCertRecords.characterId, input.characterId),
      outfitId
        ? eq(schema.portraitCertRecords.outfitId, outfitId)
        : primaryOutfitClause(),
      eq(schema.portraitCertRecords.status, 'active'),
    )).all()
    for (const row of actives) {
      db.update(schema.portraitCertRecords)
        .set({
          status: 'cancelled',
          cancelledAt: ts,
          cancelReason: 'replaced',
          cancelledBy: input.user?.id ?? null,
          cancelledByName: operatorName(input.user),
        })
        .where(eq(schema.portraitCertRecords.id, row.id))
        .run()
    }
  }

  const res = db.insert(schema.portraitCertRecords).values({
    characterId: char.id,
    dramaId: char.dramaId,
    outfitId,
    scope: outfitId ? 'outfit' : 'primary',
    characterName: char.name,
    outfitLabel: outfit?.label || null,
    dramaTitle: dramaTitleOf(char.dramaId),
    imageUrl,
    seedanceAssetId: null,
    seedanceAssetGroupId: char.seedanceAssetGroupId || null,
    status: 'processing',
    failedReason: null,
    configId: keyMeta.config_id,
    configName: keyMeta.config_name,
    apiKeyMasked: keyMeta.api_key_masked,
    createdBy: input.user?.id ?? null,
    createdByName: operatorName(input.user),
    cancelledBy: null,
    cancelledByName: null,
    createdAt: ts,
    activatedAt: null,
    cancelledAt: null,
    cancelReason: null,
    replacedById: null,
    metadata: null,
  }).run()

  const id = Number(res.lastInsertRowid)
  return db.select().from(schema.portraitCertRecords).where(eq(schema.portraitCertRecords.id, id)).all()[0] || null
}

export function finalizePortraitCertRecord(
  recordId: number | null | undefined,
  input: {
    status: PortraitCertStatus
    assetId?: string | null
    groupId?: string | null
    failedReason?: string | null
    skipped?: boolean
  },
) {
  if (!recordId) return null
  const [row] = db.select().from(schema.portraitCertRecords).where(eq(schema.portraitCertRecords.id, recordId)).all()
  if (!row) return null

  if (input.skipped && row.status === 'processing') {
    db.delete(schema.portraitCertRecords).where(eq(schema.portraitCertRecords.id, recordId)).run()
    return null
  }

  const ts = now()
  db.update(schema.portraitCertRecords)
    .set({
      status: input.status,
      seedanceAssetId: input.assetId ?? row.seedanceAssetId,
      seedanceAssetGroupId: input.groupId ?? row.seedanceAssetGroupId,
      failedReason: input.failedReason ?? null,
      activatedAt: input.status === 'active' ? ts : row.activatedAt,
    })
    .where(eq(schema.portraitCertRecords.id, recordId))
    .run()

  return db.select().from(schema.portraitCertRecords).where(eq(schema.portraitCertRecords.id, recordId)).all()[0] || null
}

export function softCancelPortraitCertRecord(input: {
  characterId: number
  outfitId?: string | null
  assetId?: string | null
  user?: AuthUser | null
  reason?: string
}) {
  const outfitId = String(input.outfitId || '').trim() || null
  const ts = now()
  const conditions = [
    eq(schema.portraitCertRecords.characterId, input.characterId),
    eq(schema.portraitCertRecords.status, 'active'),
    outfitId
      ? eq(schema.portraitCertRecords.outfitId, outfitId)
      : primaryOutfitClause(),
  ]

  let rows = db.select().from(schema.portraitCertRecords).where(and(...conditions)).all()
  if (input.assetId) {
    const match = rows.filter(r => r.seedanceAssetId === input.assetId)
    if (match.length) rows = match
  }

  for (const row of rows) {
    db.update(schema.portraitCertRecords)
      .set({
        status: 'cancelled',
        cancelledAt: ts,
        cancelReason: input.reason || 'user',
        cancelledBy: input.user?.id ?? null,
        cancelledByName: operatorName(input.user),
      })
      .where(eq(schema.portraitCertRecords.id, row.id))
      .run()
  }
  return rows.length
}

export function softCancelPortraitCertById(
  recordId: number,
  user?: AuthUser | null,
  reason = 'admin',
) {
  const [row] = db.select().from(schema.portraitCertRecords).where(eq(schema.portraitCertRecords.id, recordId)).all()
  if (!row) throw new Error('认证记录不存在')
  if (row.status === 'cancelled') return row
  if (row.status !== 'active' && row.status !== 'processing') {
    throw new Error('仅可取消「已认证」或「认证中」的记录')
  }
  const ts = now()
  db.update(schema.portraitCertRecords)
    .set({
      status: 'cancelled',
      cancelledAt: ts,
      cancelReason: reason,
      cancelledBy: user?.id ?? null,
      cancelledByName: operatorName(user),
    })
    .where(eq(schema.portraitCertRecords.id, recordId))
    .run()
  return db.select().from(schema.portraitCertRecords).where(eq(schema.portraitCertRecords.id, recordId)).all()[0]!
}

export function getPortraitCertRecord(id: number) {
  return db.select().from(schema.portraitCertRecords).where(eq(schema.portraitCertRecords.id, id)).all()[0] || null
}

/** 把角色上已有的 active 认证补进流水（历史数据） */
export function backfillPortraitCertRecordsFromLive() {
  const chars = db.select().from(schema.characters).all()
  let created = 0
  const keyMeta = resolvePortraitAssetKeyMeta()
  const ts = now()

  for (const char of chars) {
    if (char.seedanceAssetId && String(char.seedanceAssetStatus || '').toLowerCase() === 'active') {
      const existing = db.select().from(schema.portraitCertRecords).where(and(
        eq(schema.portraitCertRecords.characterId, char.id),
        primaryOutfitClause(),
        eq(schema.portraitCertRecords.seedanceAssetId, char.seedanceAssetId),
      )).all()
      if (!existing.length) {
        db.insert(schema.portraitCertRecords).values({
          characterId: char.id,
          dramaId: char.dramaId,
          outfitId: null,
          scope: 'primary',
          characterName: char.name,
          outfitLabel: null,
          dramaTitle: dramaTitleOf(char.dramaId),
          imageUrl: char.imageUrl || char.localPath || null,
          seedanceAssetId: char.seedanceAssetId,
          seedanceAssetGroupId: char.seedanceAssetGroupId,
          status: 'active',
          failedReason: null,
          configId: keyMeta.config_id,
          configName: keyMeta.config_name,
          apiKeyMasked: keyMeta.api_key_masked,
          createdBy: null,
          createdByName: '历史回填',
          cancelledBy: null,
          cancelledByName: null,
          createdAt: char.updatedAt || ts,
          activatedAt: char.updatedAt || ts,
          cancelledAt: null,
          cancelReason: null,
          replacedById: null,
          metadata: JSON.stringify({ backfill: true }),
        }).run()
        created += 1
      }
    }

    for (const outfit of listCharacterOutfits(char.referenceImages)) {
      if (!outfit.seedance_asset_id) continue
      if (String(outfit.seedance_asset_status || '').toLowerCase() !== 'active') continue
      const existing = db.select().from(schema.portraitCertRecords).where(and(
        eq(schema.portraitCertRecords.characterId, char.id),
        eq(schema.portraitCertRecords.outfitId, outfit.outfit_id),
        eq(schema.portraitCertRecords.seedanceAssetId, outfit.seedance_asset_id),
      )).all()
      if (existing.length) continue
      db.insert(schema.portraitCertRecords).values({
        characterId: char.id,
        dramaId: char.dramaId,
        outfitId: outfit.outfit_id,
        scope: 'outfit',
        characterName: char.name,
        outfitLabel: outfit.label,
        dramaTitle: dramaTitleOf(char.dramaId),
        imageUrl: outfit.url,
        seedanceAssetId: outfit.seedance_asset_id,
        seedanceAssetGroupId: char.seedanceAssetGroupId,
        status: 'active',
        failedReason: null,
        configId: keyMeta.config_id,
        configName: keyMeta.config_name,
        apiKeyMasked: keyMeta.api_key_masked,
        createdBy: null,
        createdByName: '历史回填',
        cancelledBy: null,
        cancelledByName: null,
        createdAt: outfit.created_at || ts,
        activatedAt: outfit.created_at || ts,
        cancelledAt: null,
        cancelReason: null,
        replacedById: null,
        metadata: JSON.stringify({ backfill: true }),
      }).run()
      created += 1
    }
  }
  return created
}

export function listPortraitCertRecords(query: {
  status?: string | null
  configId?: number | null
  q?: string | null
  limit?: number
  offset?: number
}) {
  backfillPortraitCertRecordsFromLive()

  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50))
  const offset = Math.max(0, Number(query.offset) || 0)
  const status = String(query.status || '').trim().toLowerCase()
  const q = String(query.q || '').trim()

  let rows = db.select().from(schema.portraitCertRecords)
    .orderBy(desc(schema.portraitCertRecords.createdAt))
    .all()

  if (status) rows = rows.filter(r => String(r.status).toLowerCase() === status)
  if (query.configId != null && Number.isFinite(query.configId)) {
    rows = rows.filter(r => r.configId === query.configId)
  }
  if (q) {
    const needle = q.toLowerCase()
    rows = rows.filter(r =>
      String(r.characterName || '').toLowerCase().includes(needle)
      || String(r.dramaTitle || '').toLowerCase().includes(needle)
      || String(r.outfitLabel || '').toLowerCase().includes(needle)
      || String(r.seedanceAssetId || '').toLowerCase().includes(needle)
      || String(r.configName || '').toLowerCase().includes(needle)
      || String(r.createdByName || '').toLowerCase().includes(needle),
    )
  }

  const total = rows.length
  const items = rows.slice(offset, offset + limit)
  return { items, total, limit, offset }
}

function readQuotaTotal(settingsRaw?: string | null) {
  const settings = parseOfficialKeySettings(settingsRaw) as OfficialKeySettings & { portrait_asset_quota?: number }
  const quota = Number(settings.portrait_asset_quota)
  return Number.isFinite(quota) && quota > 0 ? quota : DEFAULT_PORTRAIT_ASSET_QUOTA
}

export function getPortraitCertQuotaSummary() {
  backfillPortraitCertRecordsFromLive()

  const activeRows = db.select().from(schema.portraitCertRecords)
    .where(eq(schema.portraitCertRecords.status, 'active'))
    .all()

  const byConfig = new Map<number | 'unknown', {
    config_id: number | null
    name: string
    api_key_masked: string
    is_active: boolean
    quota_total: number
    certified_count: number
    remaining: number
  }>()

  for (const row of listOfficialVolcengineConfigRows()) {
    const quotaTotal = readQuotaTotal(row.settings)
    byConfig.set(row.id, {
      config_id: row.id,
      name: row.name,
      api_key_masked: maskOfficialApiKey(row.apiKey),
      is_active: !!row.isActive,
      quota_total: quotaTotal,
      certified_count: 0,
      remaining: quotaTotal,
    })
  }

  byConfig.set('unknown', {
    config_id: null,
    name: '未归属 Key / 环境变量',
    api_key_masked: '',
    is_active: false,
    quota_total: DEFAULT_PORTRAIT_ASSET_QUOTA,
    certified_count: 0,
    remaining: DEFAULT_PORTRAIT_ASSET_QUOTA,
  })

  for (const row of activeRows) {
    const key = row.configId != null && byConfig.has(row.configId) ? row.configId : 'unknown'
    const bucket = byConfig.get(key)!
    bucket.certified_count += 1
    bucket.remaining = Math.max(0, bucket.quota_total - bucket.certified_count)
  }

  const accounts = [...byConfig.values()].filter(a =>
    a.config_id != null || a.certified_count > 0,
  )

  const totalCertified = activeRows.length
  const totalQuota = accounts
    .filter(a => a.config_id != null)
    .reduce((sum, a) => sum + a.quota_total, 0)

  return {
    default_quota: DEFAULT_PORTRAIT_ASSET_QUOTA,
    total_certified: totalCertified,
    total_quota: totalQuota || DEFAULT_PORTRAIT_ASSET_QUOTA,
    total_remaining: Math.max(0, (totalQuota || DEFAULT_PORTRAIT_ASSET_QUOTA) - totalCertified),
    accounts,
  }
}

export function updatePortraitAssetQuota(configId: number, quota: number) {
  const [row] = db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, configId)).all()
  if (!row) throw new Error('API Key 不存在')
  const next = Math.max(1, Math.floor(Number(quota) || DEFAULT_PORTRAIT_ASSET_QUOTA))
  const settings = parseOfficialKeySettings(row.settings)
  db.update(schema.aiServiceConfigs)
    .set({
      settings: JSON.stringify({
        channel2: true,
        env_name: settings.env_name || null,
        access_key: settings.access_key || null,
        secret_key: settings.secret_key || null,
        portrait_asset_quota: next,
      }),
      updatedAt: now(),
    })
    .where(eq(schema.aiServiceConfigs.id, configId))
    .run()
  const [updated] = db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, configId)).all()
  return {
    ...formatOfficialKeyAccount(updated!),
    portrait_asset_quota: next,
  }
}
