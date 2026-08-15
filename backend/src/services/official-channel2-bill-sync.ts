/**
 * 通道2 控制台实付 — 后台定时增量同步（从新到旧翻页，避免限流）
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import {
  fetchVolcengineBillDetailsForAnchors,
  matchVolcengineBillToTask,
} from './volcengine-task-billing.js'
import {
  hasAnyOfficialBillingCredentials,
  resolveBillingCredentialsForConfigId,
} from './official-volcengine-keys.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../../..')
const STATE_PATH = path.join(projectRoot, 'data', 'official-channel2-bill-sync.json')

export interface OfficialBillSyncState {
  enabled: boolean
  interval_ms: number
  batch_size: number
  /** 下一批只处理 id 小于此值的缺实付任务；null = 从最新开始 */
  cursor_before_id: number | null
  last_run_at: string | null
  last_error: string | null
  last_attempted: number
  last_matched: number
  last_cycle_completed_at: string | null
  total_runs: number
  total_matched: number
  remaining_missing: number
  running: boolean
}

const DEFAULT_STATE: OfficialBillSyncState = {
  enabled: true,
  interval_ms: 60_000,
  batch_size: 5,
  cursor_before_id: null,
  last_run_at: null,
  last_error: null,
  last_attempted: 0,
  last_matched: 0,
  last_cycle_completed_at: null,
  total_runs: 0,
  total_matched: 0,
  remaining_missing: 0,
  running: false,
}

let timer: ReturnType<typeof setInterval> | null = null
let tickInFlight = false
let memoryState: OfficialBillSyncState = { ...DEFAULT_STATE }

function readEnvInt(name: string, fallback: number) {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function isEnabledByEnv() {
  const raw = String(process.env.OFFICIAL_BILL_SYNC_ENABLED ?? '1').trim().toLowerCase()
  return raw !== '0' && raw !== 'false' && raw !== 'off'
}

function resolveConfig() {
  return {
    enabled: isEnabledByEnv(),
    intervalMs: readEnvInt('OFFICIAL_BILL_SYNC_INTERVAL_MS', 60_000),
    batchSize: Math.min(20, readEnvInt('OFFICIAL_BILL_SYNC_BATCH', 5)),
    dateLimit: Math.min(8, readEnvInt('OFFICIAL_BILL_SYNC_DATE_LIMIT', 2)),
    delayMs: readEnvInt('OFFICIAL_BILL_SYNC_BILL_DELAY_MS', 400),
  }
}

function isCompletedStatus(status?: string | null) {
  const s = String(status || '').toLowerCase()
  return s === 'completed' || s === 'succeeded' || s === 'success'
}

function parseAnchorMs(row: {
  completedAt?: string | null
  createdAt?: string | null
}) {
  const raw = row.completedAt || row.createdAt
  if (!raw) return NaN
  const ms = Date.parse(String(raw))
  return Number.isFinite(ms) ? ms : NaN
}

function loadStateFile(): Partial<OfficialBillSyncState> {
  try {
    if (!fs.existsSync(STATE_PATH)) return {}
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as Partial<OfficialBillSyncState>
  } catch {
    return {}
  }
}

function saveStateFile(state: OfficialBillSyncState) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8')
}

function countRemainingMissing() {
  return db.select({ id: schema.videoGenerations.id })
    .from(schema.videoGenerations)
    .where(and(
      eq(schema.videoGenerations.provider, 'volcengine'),
      or(
        eq(schema.videoGenerations.status, 'completed'),
        eq(schema.videoGenerations.status, 'succeeded'),
        eq(schema.videoGenerations.status, 'success'),
      ),
      isNull(schema.videoGenerations.upstreamActualCostYuan),
    ))
    .all().length
}

function loadUsedBillIds() {
  return new Set(
    db.select({ billId: schema.videoGenerations.upstreamBillId })
      .from(schema.videoGenerations)
      .all()
      .map(r => String(r.billId || '').trim())
      .filter(Boolean),
  )
}

function resolveBillingCreds() {
  return resolveBillingCredentialsForConfigId(null)
}

function groupBatchByConfigId(batch: typeof schema.videoGenerations.$inferSelect[]) {
  const groups = new Map<number | 'none', typeof batch>()
  for (const row of batch) {
    const key = row.configId != null && Number.isFinite(Number(row.configId))
      ? Number(row.configId)
      : 'none'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }
  return groups
}

export function getOfficialChannel2BillSyncStatus(): OfficialBillSyncState {
  const cfg = resolveConfig()
  const file = loadStateFile()
  return {
    ...DEFAULT_STATE,
    ...file,
    ...memoryState,
    enabled: cfg.enabled && memoryState.enabled !== false,
    interval_ms: cfg.intervalMs,
    batch_size: cfg.batchSize,
    remaining_missing: countRemainingMissing(),
    running: tickInFlight,
  }
}

export async function runOfficialChannel2BillSyncBatch(options: {
  batchSize?: number
  cursorBeforeId?: number | null
  persistCursor?: boolean
} = {}) {
  const cfg = resolveConfig()
  const batchSize = Math.min(20, options.batchSize ?? cfg.batchSize)
  const persistCursor = options.persistCursor !== false
  const state = getOfficialChannel2BillSyncStatus()
  let cursorBeforeId = options.cursorBeforeId !== undefined
    ? options.cursorBeforeId
    : state.cursor_before_id

  const creds = resolveBillingCreds()
  if (!hasAnyOfficialBillingCredentials()) {
    const err = '未配置 AK/SK，无法拉取账单实付'
    memoryState = {
      ...getOfficialChannel2BillSyncStatus(),
      last_run_at: new Date().toISOString(),
      last_error: err,
      last_attempted: 0,
      last_matched: 0,
    }
    if (persistCursor) saveStateFile(memoryState)
    return { attempted: 0, matched: 0, remaining: countRemainingMissing(), error: err, cursor_before_id: cursorBeforeId }
  }

  const whereParts = [
    eq(schema.videoGenerations.provider, 'volcengine'),
    or(
      eq(schema.videoGenerations.status, 'completed'),
      eq(schema.videoGenerations.status, 'succeeded'),
      eq(schema.videoGenerations.status, 'success'),
    ),
    isNull(schema.videoGenerations.upstreamActualCostYuan),
  ]
  if (cursorBeforeId != null && Number.isFinite(cursorBeforeId)) {
    whereParts.push(lt(schema.videoGenerations.id, cursorBeforeId))
  }

  const batch = db.select()
    .from(schema.videoGenerations)
    .where(and(...whereParts))
    .orderBy(desc(schema.videoGenerations.id))
    .limit(batchSize)
    .all()
    .filter(r => isCompletedStatus(r.status))

  if (!batch.length) {
    const now = new Date().toISOString()
    memoryState = {
      ...getOfficialChannel2BillSyncStatus(),
      cursor_before_id: null,
      last_run_at: now,
      last_error: null,
      last_attempted: 0,
      last_matched: 0,
      last_cycle_completed_at: now,
      total_runs: (state.total_runs || 0) + 1,
      remaining_missing: countRemainingMissing(),
    }
    if (persistCursor) saveStateFile(memoryState)
    return {
      attempted: 0,
      matched: 0,
      remaining: memoryState.remaining_missing,
      error: null,
      cursor_before_id: null,
      cycle_completed: true,
    }
  }

  const anchorTimesMs = batch.map(parseAnchorMs).filter(ms => Number.isFinite(ms) && ms > 0)
  const groups = groupBatchByConfigId(batch)
  const usedBillIds = loadUsedBillIds()
  const ts = new Date().toISOString()
  let matched = 0
  let lastError: string | null = null

  for (const [configKey, rows] of groups) {
    const configId = configKey === 'none' ? null : configKey
    const groupCreds = resolveBillingCredentialsForConfigId(configId) || creds
    if (!groupCreds) continue

    const groupAnchors = rows.map(parseAnchorMs).filter(ms => Number.isFinite(ms) && ms > 0)
    let billRows: Awaited<ReturnType<typeof fetchVolcengineBillDetailsForAnchors>> = []
    try {
      billRows = await fetchVolcengineBillDetailsForAnchors(
        groupCreds.access_key,
        groupCreds.secret_key,
        groupAnchors.length ? groupAnchors : anchorTimesMs,
        { maxDates: cfg.dateLimit, delayMs: cfg.delayMs },
      )
    } catch (err: any) {
      lastError = String(err?.message || '拉取账单失败')
      continue
    }

    for (const row of rows) {
      const anchorMs = parseAnchorMs(row)
      if (!Number.isFinite(anchorMs)) continue
      const hit = matchVolcengineBillToTask(anchorMs, billRows, usedBillIds)
      if (!hit) continue
      db.update(schema.videoGenerations)
        .set({
          upstreamActualCostYuan: hit.actual_cost,
          upstreamBillId: hit.bill_id,
          upstreamBillSyncedAt: ts,
          updatedAt: ts,
        })
        .where(eq(schema.videoGenerations.id, row.id))
        .run()
      matched += 1
    }
  }

  if (lastError && matched === 0 && batch.length > 0) {
    memoryState = {
      ...getOfficialChannel2BillSyncStatus(),
      last_run_at: new Date().toISOString(),
      last_error: lastError,
      last_attempted: batch.length,
      last_matched: 0,
      total_runs: (state.total_runs || 0) + 1,
      remaining_missing: countRemainingMissing(),
    }
    if (persistCursor) saveStateFile(memoryState)
    return {
      attempted: batch.length,
      matched: 0,
      remaining: memoryState.remaining_missing,
      error: lastError,
      cursor_before_id: cursorBeforeId,
    }
  }

  const minId = Math.min(...batch.map(r => r.id))
  const nextCursor = minId
  const now = new Date().toISOString()
  memoryState = {
    ...getOfficialChannel2BillSyncStatus(),
    cursor_before_id: nextCursor,
    last_run_at: now,
    last_error: null,
    last_attempted: batch.length,
    last_matched: matched,
    total_runs: (state.total_runs || 0) + 1,
    total_matched: (state.total_matched || 0) + matched,
    remaining_missing: countRemainingMissing(),
  }
  if (persistCursor) saveStateFile(memoryState)

  return {
    attempted: batch.length,
    matched,
    remaining: memoryState.remaining_missing,
    error: null,
    cursor_before_id: nextCursor,
    cycle_completed: false,
    batch_video_ids: batch.map(r => r.id),
  }
}

async function tick() {
  if (tickInFlight) return
  if (!resolveConfig().enabled) return
  tickInFlight = true
  try {
    await runOfficialChannel2BillSyncBatch()
  } catch (err: any) {
    memoryState = {
      ...getOfficialChannel2BillSyncStatus(),
      last_run_at: new Date().toISOString(),
      last_error: String(err?.message || err || '同步失败'),
    }
    saveStateFile(memoryState)
  } finally {
    tickInFlight = false
  }
}

export function startOfficialChannel2BillSyncWorker() {
  const cfg = resolveConfig()
  memoryState = {
    ...DEFAULT_STATE,
    ...loadStateFile(),
    enabled: cfg.enabled,
    interval_ms: cfg.intervalMs,
    batch_size: cfg.batchSize,
    remaining_missing: countRemainingMissing(),
  }

  if (!cfg.enabled) {
    console.log('通道2 实付定时同步：已禁用 (OFFICIAL_BILL_SYNC_ENABLED=0)')
    return
  }

  if (!hasAnyOfficialBillingCredentials()) {
    console.warn('通道2 实付定时同步：未配置 AK/SK，跳过启动')
    return
  }

  if (timer) clearInterval(timer)
  const intervalMs = cfg.intervalMs
  console.log(`通道2 实付定时同步：每 ${Math.round(intervalMs / 1000)}s 拉 ${cfg.batchSize} 条，从新到旧翻页`)
  void tick()
  timer = setInterval(() => { void tick() }, intervalMs)
}

export function stopOfficialChannel2BillSyncWorker() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
