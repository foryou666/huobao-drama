/**
 * 通道2：火山账单实付匹配 + 本站积分扣费解析
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import {
  fetchVolcengineBillDetails,
  resolveVolcengineBillingCredentialsFromEnv,
  resolveVolcengineBillingPairFromEnv,
} from './volcengine-account-balance.js'
import {
  parseOfficialKeySettings,
} from './official-volcengine-keys.js'

export interface VolcengineBillRow {
  BillID?: string
  BillId?: string
  Product?: string
  ProductZh?: string
  Element?: string
  ElementZh?: string
  BillingItem?: string
  BillingItemZh?: string
  ExpenseBeginTime?: string
  ExpenseEndTime?: string
  PayableAmount?: string | number
  PaidAmount?: string | number
  [key: string]: unknown
}

function parseMoney(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  const n = Number(String(raw).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

function parseVolcengineBillTime(raw: unknown): number | null {
  const s = String(raw || '').trim()
  if (!s) return null
  if (s.includes('T') || s.includes('+') || s.endsWith('Z')) {
    const ms = Date.parse(s)
    return Number.isFinite(ms) ? ms : null
  }
  const ms = Date.parse(`${s.replace(' ', 'T')}+08:00`)
  return Number.isFinite(ms) ? ms : null
}

function shanghaiDateParts(ms: number) {
  const s = new Date(ms).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
  return {
    billPeriod: s.slice(0, 7),
    expenseDate: s.slice(0, 10),
  }
}

function billRowId(row: VolcengineBillRow): string {
  return String(row.BillID || row.BillId || '').trim()
}

export function isVolcengineArkVideoBill(row: VolcengineBillRow): boolean {
  const haystack = [
    row.Product,
    row.ProductZh,
    row.Element,
    row.ElementZh,
    row.BillingItem,
    row.BillingItemZh,
    row.InstanceName,
    row.InstanceID,
  ].map(v => String(v || '').toLowerCase()).join(' ')
  if (!haystack.trim()) return true
  if (haystack.includes('方舟') || haystack.includes('ark') || haystack.includes('seedance')) return true
  if (haystack.includes('即梦') || haystack.includes('视频生成')) return true
  if (haystack.includes('豆包') || haystack.includes('大模型') || haystack.includes('模型服务')) return true
  // 排除明显非视频/大模型消费
  if (haystack.includes('cdn') || haystack.includes('对象存储') || haystack.includes('带宽')) return false
  return true
}

function billingLabelFromSettings(settings: ReturnType<typeof parseOfficialKeySettings>) {
  if (settings.billing_label) return String(settings.billing_label).trim()
  const envName = String(settings.env_name || '').trim()
  const m = envName.match(/^(?:huoshankey_|HUOSHAN_KEY_|HUOSHANKEY_)(.+)$/i)
  return m?.[1]?.trim() || ''
}

export function resolveOfficialVolcengineBillingCredentials(
  row: typeof schema.aiServiceConfigs.$inferSelect,
): { access_key: string; secret_key: string; billing_label?: string | null } | null {
  const settings = parseOfficialKeySettings(row.settings)
  let access_key = String(settings.access_key || '').trim()
  let secret_key = String(settings.secret_key || '').trim()
  const billing_label = billingLabelFromSettings(settings) || null

  if (!access_key || !secret_key) {
    const label = billing_label
    if (label) {
      const pair = resolveVolcengineBillingPairFromEnv(label)
      if (pair) {
        access_key = pair.access_key
        secret_key = pair.secret_key
      }
    }
  }
  if (!access_key || !secret_key) {
    const env = resolveVolcengineBillingCredentialsFromEnv()
    access_key = access_key || String(env.access_key || '').trim()
    secret_key = secret_key || String(env.secret_key || '').trim()
  }
  if (!access_key || !secret_key) return null
  return { access_key, secret_key, billing_label }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function fetchVolcengineBillDetailsForAnchors(
  accessKeyId: string,
  secretAccessKey: string,
  anchorTimesMs: number[],
  options: { maxDates?: number; delayMs?: number } = {},
): Promise<VolcengineBillRow[]> {
  const maxDates = Math.max(1, Number(options.maxDates) || 20)
  const delayMs = Math.max(0, Number(options.delayMs) || 350)
  const queries = new Map<string, { billPeriod: string; expenseDate: string }>()
  for (const ms of anchorTimesMs) {
    if (!Number.isFinite(ms) || ms <= 0) continue
    const { billPeriod, expenseDate } = shanghaiDateParts(ms)
    queries.set(`${billPeriod}|${expenseDate}`, { billPeriod, expenseDate })
  }

  const queryList = [...queries.values()].slice(0, maxDates)
  const allItems: VolcengineBillRow[] = []
  for (const { billPeriod, expenseDate } of queryList) {
    let offset = 0
    let total = Number.POSITIVE_INFINITY
    while (offset < total) {
      const page = await fetchVolcengineBillDetails(accessKeyId, secretAccessKey, {
        billPeriod,
        expenseDate,
        groupTerm: 0,
        groupPeriod: 2,
        limit: 300,
        offset,
      })
      allItems.push(...(page.items as VolcengineBillRow[]))
      total = Number(page.total) || allItems.length
      offset += page.items.length
      if (!page.items.length) break
      if (delayMs > 0) await sleep(delayMs)
    }
    if (delayMs > 0) await sleep(delayMs)
  }
  return allItems
}

export function matchVolcengineBillToTask(
  anchorMs: number,
  bills: VolcengineBillRow[],
  usedBillIds: Set<string>,
): {
  actual_cost: number
  bill_id: string
  note: string
} | null {
  if (!Number.isFinite(anchorMs) || anchorMs <= 0) return null

  let best: {
    actual_cost: number
    bill_id: string
    note: string
    score: number
  } | null = null

  for (const row of bills) {
    if (!isVolcengineArkVideoBill(row)) continue
    const billId = billRowId(row)
    if (billId && usedBillIds.has(billId)) continue

    const payable = parseMoney(row.PayableAmount ?? row.PaidAmount)
    if (payable == null || payable <= 0) continue

    const beginMs = parseVolcengineBillTime(row.ExpenseBeginTime)
    const endMs = parseVolcengineBillTime(row.ExpenseEndTime)
    if (beginMs == null || endMs == null) continue

    const windowStart = beginMs - 90_000
    const windowEnd = endMs + 90_000
    if (anchorMs < windowStart || anchorMs > windowEnd) continue

    const mid = (beginMs + endMs) / 2
    const score = Math.abs(anchorMs - mid)
    if (!best || score < best.score) {
      best = {
        actual_cost: Math.round(payable * 1_000_000) / 1_000_000,
        bill_id: billId || `${beginMs}`,
        note: `账单 ${billId || '—'} · ${row.ExpenseBeginTime || ''}~${row.ExpenseEndTime || ''}`,
        score,
      }
    }
  }

  if (!best) return null
  if (best.bill_id) usedBillIds.add(best.bill_id)
  return {
    actual_cost: best.actual_cost,
    bill_id: best.bill_id,
    note: best.note,
  }
}

export function resolveSiteCreditCharge(creditTransactionId?: number | null) {
  const empty = {
    site_credits: null as number | null,
    site_credits_refunded: false,
    site_credits_net: null as number | null,
    site_credits_note: null as string | null,
  }
  const txId = Number(creditTransactionId)
  if (!Number.isFinite(txId) || txId <= 0) {
    return { ...empty, site_credits_note: '非本站提交或未扣费' }
  }

  const charge = db.select()
    .from(schema.creditTransactions)
    .where(eq(schema.creditTransactions.id, txId))
    .all()[0]
  if (!charge) {
    return { ...empty, site_credits_note: `扣费记录 #${txId} 不存在` }
  }

  const chargeAmount = Math.abs(Number(charge.amount) || 0)
  let refundAmount = 0
  for (const tx of db.select().from(schema.creditTransactions).all()) {
    if (tx.type !== 'refund' || !tx.metadata) continue
    try {
      const meta = JSON.parse(tx.metadata)
      if (Number(meta.charge_tx_id) === txId) {
        refundAmount = Math.abs(Number(tx.amount) || 0)
        break
      }
    } catch { /* ignore */ }
  }

  const net = Math.max(0, chargeAmount - refundAmount)
  return {
    site_credits: chargeAmount,
    site_credits_refunded: refundAmount > 0,
    site_credits_net: net,
    site_credits_note: refundAmount > 0
      ? `已退 ${refundAmount} 积分（原扣 ${chargeAmount}）`
      : null,
  }
}
