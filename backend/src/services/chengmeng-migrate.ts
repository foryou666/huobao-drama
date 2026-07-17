import { eq, and, isNull } from 'drizzle-orm'
import { db, schema, getAppMeta, setAppMeta } from '../db/index.js'
import { now } from '../utils/response.js'
import { CHENGMENT_DEFAULT_BASE_URL, CHENGMENT_DEFAULT_MODEL_ID } from '../constants/chengmeng.js'
import { logTaskProgress } from '../utils/task-logger.js'

const BASE_URL_MIGRATION_KEY = 'chengmeng_base_url_v2'
const KEY_ROTATION_META = 'chengmeng_api_key_rotation_v1'
const MODEL_IDS_MIGRATION_KEY = 'chengmeng_model_ids_v4'

const LEGACY_MODEL_IDS = new Set(['53', '32', '31', '15', '49'])

/** 将已保存的 cpolar 临时地址迁移到官方 API 网关 */
export function migrateChengmengBaseUrlIfNeeded() {
  if (getAppMeta(BASE_URL_MIGRATION_KEY)) return

  const rows = db.select().from(schema.aiServiceConfigs).all()
  const ts = now()
  let updated = 0
  for (const row of rows) {
    if (row.provider !== 'chengmeng') continue
    const base = String(row.baseUrl || '')
    if (!base.includes('cpolar')) continue
    db.update(schema.aiServiceConfigs)
      .set({ baseUrl: CHENGMENT_DEFAULT_BASE_URL, updatedAt: ts })
      .where(eq(schema.aiServiceConfigs.id, row.id))
      .run()
    updated++
  }
  setAppMeta(BASE_URL_MIGRATION_KEY, `${ts}:${updated}`)
}

function remapLegacyChengmengModelId(modelId: string): string {
  const id = String(modelId || '').trim()
  if (id === '32' || id === '49') return '77'
  if (LEGACY_MODEL_IDS.has(id)) return CHENGMENT_DEFAULT_MODEL_ID
  return id || CHENGMENT_DEFAULT_MODEL_ID
}

/** 将 AI 配置中已下线的 model_id（53/49/32 等）迁移到新线路（70/77） */
export function migrateChengmengModelIdsIfNeeded() {
  if (getAppMeta(MODEL_IDS_MIGRATION_KEY)) return

  const rows = db.select().from(schema.aiServiceConfigs).all()
  const ts = now()
  let updated = 0
  for (const row of rows) {
    if (row.provider !== 'chengmeng') continue
    let models: string[] = []
    try {
      models = row.model ? JSON.parse(row.model) : []
    } catch {
      models = row.model ? [String(row.model)] : []
    }
    if (!models.length) {
      models = [CHENGMENT_DEFAULT_MODEL_ID]
    } else {
      models = models.map(remapLegacyChengmengModelId)
      if (!models.includes(CHENGMENT_DEFAULT_MODEL_ID)) {
        models = [CHENGMENT_DEFAULT_MODEL_ID, ...models]
      }
      // 去重并保留顺序
      const seen = new Set<string>()
      models = models.filter((id) => {
        if (seen.has(id)) return false
        seen.add(id)
        return true
      })
    }
    const next = JSON.stringify(models)
    if (next === row.model) continue
    db.update(schema.aiServiceConfigs)
      .set({ model: next, updatedAt: ts })
      .where(eq(schema.aiServiceConfigs.id, row.id))
      .run()
    updated++
  }
  setAppMeta(MODEL_IDS_MIGRATION_KEY, `${ts}:${updated}`)
}

/**
 * 橙盟 API Key 轮换：保留旧 Key 配置供历史任务查询，新 Key 用于后续生成。
 * 新 Key 来源（优先级）：CHENGMENG_NEW_API_KEY 环境变量 > 参数 newApiKey
 */
export function migrateChengmengApiKeyIfNeeded(newApiKey?: string) {
  const envKey = (process.env.CHENGMENG_NEW_API_KEY || '').trim()
  const nextKey = (newApiKey || envKey).trim()
  if (!nextKey) return { skipped: true, reason: 'no-new-key' as const }

  const activeRows = db.select().from(schema.aiServiceConfigs)
    .all()
    .filter(r => r.serviceType === 'video' && r.provider === 'chengmeng' && r.isActive)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.id || 0) - (a.id || 0))

  const active = activeRows[0]
  if (!active) {
    return { skipped: true, reason: 'no-active-config' as const }
  }

  if (active.apiKey === nextKey) {
    return { skipped: true, reason: 'already-current' as const, activeConfigId: active.id }
  }

  const ts = now()
  const legacyId = active.id

  db.update(schema.videoGenerations)
    .set({ configId: legacyId, updatedAt: ts })
    .where(and(
      eq(schema.videoGenerations.provider, 'chengmeng'),
      isNull(schema.videoGenerations.configId),
    ))
    .run()

  db.update(schema.aiServiceConfigs)
    .set({
      isActive: false,
      name: active.name.includes('旧') ? active.name : `${active.name} (旧账号)`,
      updatedAt: ts,
    })
    .where(eq(schema.aiServiceConfigs.id, legacyId))
    .run()

  const insert = db.insert(schema.aiServiceConfigs).values({
    serviceType: 'video',
    provider: 'chengmeng',
    name: '橙盟 Seedance 2.0-视频',
    baseUrl: active.baseUrl || CHENGMENT_DEFAULT_BASE_URL,
    apiKey: nextKey,
    model: active.model,
    endpoint: active.endpoint,
    queryEndpoint: active.queryEndpoint,
    priority: Math.max(active.priority || 0, 1),
    isDefault: active.isDefault,
    isActive: true,
    settings: active.settings,
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const newConfigId = Number(insert.lastInsertRowid)
  setAppMeta(KEY_ROTATION_META, `${ts}:legacy=${legacyId}:new=${newConfigId}`)

  logTaskProgress('ChengmengMigrate', 'api-key-rotated', {
    legacyConfigId: legacyId,
    newConfigId,
  })

  return {
    skipped: false,
    legacyConfigId: legacyId,
    newConfigId,
  }
}
