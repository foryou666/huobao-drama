/**
 * 通道2（火山方舟）多 API Key 管理：env 同步、切换启用、余额凭证
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import {
  SEEDANCE_ARK_BASE_URL,
  SEEDANCE_MODELS,
} from '../constants/seedance.js'
import { isPlaceholderApiKey, listOfficialVolcengineConfigRows } from '../utils/official-volcengine-video.js'
import { listVolcengineArkTasks } from './volcengine-ark-client.js'
import {
  fetchVolcengineAccountBalance,
  resolveVolcengineBillingCredentialsFromEnv,
  resolveVolcengineBillingPairFromEnv,
  listVolcengineBillingPairsFromEnv,
} from './volcengine-account-balance.js'

export interface OfficialKeySettings {
  channel2?: boolean
  env_name?: string | null
  /** 账单账号标识，对应 env：huoshanak_{label} / huoshansk_{label} */
  billing_label?: string | null
  access_key?: string | null
  secret_key?: string | null
  portrait_asset_quota?: number | null
}

const DEFAULT_MODELS = [
  SEEDANCE_MODELS.V2_5,
  SEEDANCE_MODELS.V2_0_MINI,
  SEEDANCE_MODELS.V2_0,
  SEEDANCE_MODELS.V2_0_FAST,
]

function nowIso() {
  return new Date().toISOString()
}

export function maskOfficialApiKey(apiKey?: string | null): string {
  const key = String(apiKey || '').trim()
  if (!key) return ''
  if (key.length <= 12) return `${key.slice(0, 3)}****`
  return `${key.slice(0, 8)}****${key.slice(-6)}`
}

export function parseOfficialKeySettings(raw?: string | null): OfficialKeySettings {
  if (!raw?.trim()) return { channel2: true }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { channel2: true }
    const quota = Number(parsed.portrait_asset_quota)
    return {
      channel2: parsed.channel2 !== false,
      env_name: parsed.env_name ? String(parsed.env_name) : null,
      billing_label: parsed.billing_label ? String(parsed.billing_label) : null,
      access_key: parsed.access_key ? String(parsed.access_key) : null,
      secret_key: parsed.secret_key ? String(parsed.secret_key) : null,
      portrait_asset_quota: Number.isFinite(quota) && quota > 0 ? quota : null,
    }
  } catch {
    return { channel2: true }
  }
}

export function stringifyOfficialKeySettings(settings: OfficialKeySettings): string {
  return JSON.stringify({
    channel2: true,
    env_name: settings.env_name || null,
    billing_label: settings.billing_label || null,
    access_key: settings.access_key || null,
    secret_key: settings.secret_key || null,
    portrait_asset_quota: settings.portrait_asset_quota || null,
  })
}

function labelFromEnvSuffix(suffix: string): string {
  const raw = String(suffix || '').trim()
  if (!raw) return '火山方舟'
  // hanqiaoyuan -> hanqiaoyuan；保留可读备注
  return raw
}

function billingLabelFromEnvName(envName?: string | null) {
  const name = String(envName || '').trim()
  const m = name.match(/^(?:huoshankey_|HUOSHAN_KEY_|HUOSHANKEY_)(.+)$/i)
  return m?.[1]?.trim() || ''
}

function resolveBillingLabel(settings: OfficialKeySettings) {
  return String(settings.billing_label || billingLabelFromEnvName(settings.env_name) || '').trim()
}

/** 解析 deploy/backend .env 中的 huoshankey_* / HUOSHAN_KEY_* */
export function listHuoshanKeysFromEnv(): Array<{
  env_name: string
  label: string
  api_key: string
  access_key: string | null
  secret_key: string | null
}> {
  const items: Array<{
    env_name: string
    label: string
    api_key: string
    access_key: string | null
    secret_key: string | null
  }> = []

  for (const [name, value] of Object.entries(process.env)) {
    const m = name.match(/^(?:huoshankey_|HUOSHAN_KEY_|HUOSHANKEY_)(.+)$/i)
    if (!m) continue
    const apiKey = String(value || '').trim()
    if (!apiKey || isPlaceholderApiKey(apiKey)) continue
    const suffix = m[1] || ''
    const pair = resolveVolcengineBillingPairFromEnv(suffix)
    const globalBilling = resolveVolcengineBillingCredentialsFromEnv()
    const accessKey = pair?.access_key
      || globalBilling.access_key
      || null
    const secretKey = pair?.secret_key
      || globalBilling.secret_key
      || null
    items.push({
      env_name: name,
      label: labelFromEnvSuffix(suffix),
      api_key: apiKey,
      access_key: accessKey,
      secret_key: secretKey,
    })
  }

  // 兼容单 key：HUOSHAN_API_KEY / ARK_API_KEY / VOLCENGINE_API_KEY
  const fallbackKey = (
    process.env.HUOSHAN_API_KEY
    || process.env.ARK_API_KEY
    || process.env.VOLCENGINE_API_KEY
    || ''
  ).trim()
  if (fallbackKey && !isPlaceholderApiKey(fallbackKey) && !items.some(i => i.api_key === fallbackKey)) {
    const globalBilling = resolveVolcengineBillingCredentialsFromEnv()
    items.push({
      env_name: 'HUOSHAN_API_KEY',
      label: '默认',
      api_key: fallbackKey,
      access_key: globalBilling.access_key,
      secret_key: globalBilling.secret_key,
    })
  }

  return items
}

function findRowByApiKey(apiKey: string) {
  const key = String(apiKey || '').trim()
  return listOfficialVolcengineConfigRows().find(r => String(r.apiKey || '').trim() === key) || null
}

function findRowByEnvName(envName: string) {
  const name = String(envName || '').trim()
  if (!name) return null
  return listOfficialVolcengineConfigRows().find((r) => {
    const settings = parseOfficialKeySettings(r.settings)
    return settings.env_name === name
  }) || null
}

function findRowByBillingLabel(label: string) {
  const name = String(label || '').trim()
  if (!name) return null
  return listOfficialVolcengineConfigRows().find((r) => {
    const settings = parseOfficialKeySettings(r.settings)
    return resolveBillingLabel(settings) === name
  }) || null
}

/** 将 env 中 huoshanak_* / huoshansk_* 写入已配置 billing_label 的 Key（或 env_name 后缀匹配） */
export function syncBillingCredentialsFromEnv(): { updated: number; labels: string[] } {
  const pairs = listVolcengineBillingPairsFromEnv()
  if (!pairs.length) return { updated: 0, labels: [] }

  const ts = nowIso()
  let updated = 0
  const labels: string[] = []

  for (const pair of pairs) {
    const row = findRowByBillingLabel(pair.label)
      || findRowByEnvName(`huoshankey_${pair.label}`)
      || findRowByEnvName(`HUOSHAN_KEY_${pair.label}`)
    if (!row) continue

    const settings = parseOfficialKeySettings(row.settings)
    const merged = stringifyOfficialKeySettings({
      channel2: true,
      env_name: settings.env_name || null,
      billing_label: settings.billing_label || pair.label,
      access_key: pair.access_key,
      secret_key: pair.secret_key,
      portrait_asset_quota: settings.portrait_asset_quota || null,
    })
    db.update(schema.aiServiceConfigs)
      .set({ settings: merged, updatedAt: ts })
      .where(eq(schema.aiServiceConfigs.id, row.id))
      .run()
    updated += 1
    labels.push(pair.label)
  }

  return { updated, labels }
}

function hasBillingCredentialsForSettings(settings: OfficialKeySettings) {
  if (settings.access_key && settings.secret_key) return true
  const label = resolveBillingLabel(settings)
  if (label && resolveVolcengineBillingPairFromEnv(label)) return true
  const env = resolveVolcengineBillingCredentialsFromEnv()
  return !!(env.access_key && env.secret_key)
}

export function resolveBillingCredentialsForConfigId(configId?: number | null) {
  const id = Number(configId)
  if (Number.isFinite(id) && id > 0) {
    const row = listOfficialVolcengineConfigRows().find(r => r.id === id)
    if (row) {
      const settings = parseOfficialKeySettings(row.settings)
      if (settings.access_key && settings.secret_key) {
        return {
          access_key: String(settings.access_key).trim(),
          secret_key: String(settings.secret_key).trim(),
          billing_label: resolveBillingLabel(settings) || null,
        }
      }
      const label = resolveBillingLabel(settings)
      if (label) {
        const pair = resolveVolcengineBillingPairFromEnv(label)
        if (pair) return { ...pair, billing_label: label }
      }
    }
  }
  const active = listOfficialVolcengineConfigRows().find(r => r.isActive)
    || listOfficialVolcengineConfigRows()[0]
    || null
  if (!active) return null
  const settings = parseOfficialKeySettings(active.settings)
  if (settings.access_key && settings.secret_key) {
    return {
      access_key: String(settings.access_key).trim(),
      secret_key: String(settings.secret_key).trim(),
      billing_label: resolveBillingLabel(settings) || null,
    }
  }
  const label = resolveBillingLabel(settings)
  if (label) {
    const pair = resolveVolcengineBillingPairFromEnv(label)
    if (pair) return { ...pair, billing_label: label }
  }
  const env = resolveVolcengineBillingCredentialsFromEnv()
  if (env.access_key && env.secret_key) {
    return { access_key: env.access_key, secret_key: env.secret_key, billing_label: label || null }
  }
  return null
}

export function hasAnyOfficialBillingCredentials() {
  for (const row of listOfficialVolcengineConfigRows()) {
    if (hasBillingCredentialsForSettings(parseOfficialKeySettings(row.settings))) return true
  }
  return listVolcengineBillingPairsFromEnv().length > 0
    || !!resolveVolcengineBillingCredentialsFromEnv().access_key
}

/** 启动 / 手动：把 env 里的 huoshankey_* 写入 ai_service_configs（不覆盖已有不同 key 的备注名冲突时按 env_name 更新） */
export function syncOfficialVolcengineKeysFromEnv(): {
  created: number
  updated: number
  billing_updated: number
  billing_labels: string[]
} {
  const envKeys = listHuoshanKeysFromEnv()
  let created = 0
  let updated = 0
  const existingOfficial = listOfficialVolcengineConfigRows()
  const hasActive = existingOfficial.some(r => r.isActive && r.apiKey && !isPlaceholderApiKey(r.apiKey))

  const ts = nowIso()
  if (envKeys.length) {
  const existingOfficial = listOfficialVolcengineConfigRows()
  const hasActive = existingOfficial.some(r => r.isActive && r.apiKey && !isPlaceholderApiKey(r.apiKey))

  for (const item of envKeys) {
    const byEnv = findRowByEnvName(item.env_name)
    const byKey = findRowByApiKey(item.api_key)
    const row = byEnv || byKey
    const billingLabel = billingLabelFromEnvName(item.env_name) || null
    const settings = stringifyOfficialKeySettings({
      channel2: true,
      env_name: item.env_name,
      billing_label: billingLabel,
      access_key: item.access_key,
      secret_key: item.secret_key,
    })

    if (row) {
      const nextSettings = parseOfficialKeySettings(row.settings)
      const merged = stringifyOfficialKeySettings({
        channel2: true,
        env_name: item.env_name,
        billing_label: nextSettings.billing_label || billingLabel,
        access_key: item.access_key || nextSettings.access_key || null,
        secret_key: item.secret_key || nextSettings.secret_key || null,
      })
      const patch: Record<string, unknown> = {
        apiKey: item.api_key,
        settings: merged,
        updatedAt: ts,
      }
      // 仅当名称仍是默认占位时才用 env 备注覆盖
      if (!row.name || row.name === '火山方舟 Seedance' || row.name.startsWith('volcengine-')) {
        patch.name = `火山方舟 · ${item.label}`
      }
      db.update(schema.aiServiceConfigs)
        .set(patch)
        .where(eq(schema.aiServiceConfigs.id, row.id))
        .run()
      updated += 1
      continue
    }

    const activate = !hasActive && created === 0 && updated === 0
    db.insert(schema.aiServiceConfigs).values({
      serviceType: 'video',
      provider: 'volcengine',
      name: `火山方舟 · ${item.label}`,
      baseUrl: SEEDANCE_ARK_BASE_URL,
      apiKey: item.api_key,
      model: JSON.stringify(DEFAULT_MODELS),
      priority: 100,
      isActive: activate,
      settings,
      createdAt: ts,
      updatedAt: ts,
    }).run()
    created += 1
  }
  }

  const billing = syncBillingCredentialsFromEnv()
  return {
    created,
    updated,
    billing_updated: billing.updated,
    billing_labels: billing.labels,
  }
}

export function activateOfficialVolcengineKey(configId: number) {
  const rows = listOfficialVolcengineConfigRows()
  const target = rows.find(r => r.id === configId)
  if (!target) throw new Error('通道2 配置不存在')
  if (isPlaceholderApiKey(target.apiKey)) throw new Error('该配置未填写有效 API Key')

  const ts = nowIso()
  for (const row of rows) {
    const nextActive = row.id === configId
    if (!!row.isActive === nextActive) continue
    db.update(schema.aiServiceConfigs)
      .set({ isActive: nextActive, updatedAt: ts })
      .where(eq(schema.aiServiceConfigs.id, row.id))
      .run()
  }
  return listOfficialVolcengineConfigRows().find(r => r.id === configId) || target
}

export function createOfficialVolcengineKey(input: {
  name?: string
  api_key: string
  billing_label?: string | null
  access_key?: string | null
  secret_key?: string | null
  activate?: boolean
}) {
  const apiKey = String(input.api_key || '').trim()
  if (!apiKey || isPlaceholderApiKey(apiKey)) throw new Error('请填写有效的方舟 API Key')
  if (findRowByApiKey(apiKey)) throw new Error('该 API Key 已存在')

  const rows = listOfficialVolcengineConfigRows()
  const activate = input.activate === true || !rows.some(r => r.isActive && !isPlaceholderApiKey(r.apiKey))
  const ts = nowIso()
  const name = String(input.name || '').trim() || `火山方舟 · ${maskOfficialApiKey(apiKey)}`
  const settings = stringifyOfficialKeySettings({
    channel2: true,
    billing_label: input.billing_label ? String(input.billing_label).trim() : null,
    access_key: input.access_key ? String(input.access_key).trim() : null,
    secret_key: input.secret_key ? String(input.secret_key).trim() : null,
  })

  if (activate) {
    for (const row of rows) {
      if (!row.isActive) continue
      db.update(schema.aiServiceConfigs)
        .set({ isActive: false, updatedAt: ts })
        .where(eq(schema.aiServiceConfigs.id, row.id))
        .run()
    }
  }

  const res = db.insert(schema.aiServiceConfigs).values({
    serviceType: 'video',
    provider: 'volcengine',
    name,
    baseUrl: SEEDANCE_ARK_BASE_URL,
    apiKey,
    model: JSON.stringify(DEFAULT_MODELS),
    priority: 100,
    isActive: activate,
    settings,
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const [row] = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, Number(res.lastInsertRowid)))
    .all()
  return row
}

export function updateOfficialVolcengineKey(
  configId: number,
  input: {
    name?: string
    api_key?: string
    billing_label?: string | null
    access_key?: string | null
    secret_key?: string | null
    clear_secret?: boolean
  },
) {
  const rows = listOfficialVolcengineConfigRows()
  const row = rows.find(r => r.id === configId)
  if (!row) throw new Error('通道2 配置不存在')

  const settings = parseOfficialKeySettings(row.settings)
  const patch: Record<string, unknown> = { updatedAt: nowIso() }
  if (input.name != null) patch.name = String(input.name).trim() || row.name
  if (input.api_key != null) {
    const apiKey = String(input.api_key).trim()
    if (!apiKey || isPlaceholderApiKey(apiKey)) throw new Error('API Key 无效')
    const dup = findRowByApiKey(apiKey)
    if (dup && dup.id !== configId) throw new Error('该 API Key 已被其他配置使用')
    patch.apiKey = apiKey
  }
  if (input.billing_label !== undefined) {
    settings.billing_label = input.billing_label ? String(input.billing_label).trim() : null
  }
  if (input.access_key !== undefined) {
    settings.access_key = input.access_key ? String(input.access_key).trim() : null
  }
  if (input.secret_key !== undefined) {
    const sk = String(input.secret_key || '').trim()
    if (sk && sk !== '********') settings.secret_key = sk
  }
  if (input.clear_secret) settings.secret_key = null
  patch.settings = stringifyOfficialKeySettings(settings)

  db.update(schema.aiServiceConfigs)
    .set(patch)
    .where(eq(schema.aiServiceConfigs.id, configId))
    .run()

  return listOfficialVolcengineConfigRows().find(r => r.id === configId) || null
}

export function deleteOfficialVolcengineKey(configId: number) {
  const rows = listOfficialVolcengineConfigRows()
  const row = rows.find(r => r.id === configId)
  if (!row) throw new Error('通道2 配置不存在')
  db.delete(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, configId)).run()

  // 若删的是当前启用，自动启用下一个
  if (row.isActive) {
    const rest = listOfficialVolcengineConfigRows().filter(r => !isPlaceholderApiKey(r.apiKey))
    if (rest[0]) activateOfficialVolcengineKey(rest[0].id)
  }
}

export async function probeOfficialVolcengineKey(row: typeof schema.aiServiceConfigs.$inferSelect) {
  const apiKey = String(row.apiKey || '').trim()
  if (!apiKey || isPlaceholderApiKey(apiKey)) {
    return { ok: false, error: '未配置 API Key' as string | null }
  }
  try {
    await listVolcengineArkTasks(
      { baseUrl: row.baseUrl || SEEDANCE_ARK_BASE_URL, apiKey },
      { pageSize: 1, pageNum: 1 },
    )
    return { ok: true, error: null as string | null }
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err || '探测失败') }
  }
}

export async function resolveOfficialKeyBalance(row: typeof schema.aiServiceConfigs.$inferSelect) {
  const settings = parseOfficialKeySettings(row.settings)
  const accessKey = String(settings.access_key || '').trim()
  const secretKey = String(settings.secret_key || '').trim()
  if (!accessKey || !secretKey) {
    return {
      balance: null as null | Awaited<ReturnType<typeof fetchVolcengineAccountBalance>>,
      error: null as string | null,
      has_billing_credentials: false,
    }
  }
  try {
    const balance = await fetchVolcengineAccountBalance(accessKey, secretKey)
    return { balance, error: null, has_billing_credentials: true }
  } catch (err: any) {
    return {
      balance: null,
      error: String(err?.message || err || '查询余额失败'),
      has_billing_credentials: true,
    }
  }
}

export function formatOfficialKeyAccount(row: typeof schema.aiServiceConfigs.$inferSelect) {
  const settings = parseOfficialKeySettings(row.settings)
  const billingLabel = resolveBillingLabel(settings) || null
  return {
    config_id: row.id,
    name: row.name,
    is_active: !!row.isActive,
    base_url: row.baseUrl || null,
    api_key_masked: maskOfficialApiKey(row.apiKey),
    has_api_key: !isPlaceholderApiKey(row.apiKey),
    env_name: settings.env_name || null,
    billing_label: billingLabel,
    has_billing_credentials: hasBillingCredentialsForSettings(settings),
    access_key_masked: settings.access_key
      ? maskOfficialApiKey(settings.access_key)
      : (billingLabel ? '(env)' : null),
  }
}
