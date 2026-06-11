import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const dbPath = process.env.DB_PATH || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/huobao_drama.db')
const db = new Database(dbPath)

function findRefund(chargeTxId) {
  if (!chargeTxId) return null
  const rows = db.prepare(`SELECT id, amount, summary, metadata FROM credit_transactions WHERE type = 'refund'`).all()
  for (const row of rows) {
    if (!row.metadata) continue
    try {
      const meta = JSON.parse(row.metadata)
      if (Number(meta.charge_tx_id) === chargeTxId) return row
    } catch { /* ignore */ }
  }
  return null
}

// Last 7 days failed videos with charge linkage
const recentFailed = db.prepare(`
  SELECT v.id, v.status, v.credit_transaction_id, v.created_at,
         substr(v.error_msg,1,120) AS error_msg, ct.amount, ct.user_id, u.username
  FROM video_generations v
  LEFT JOIN credit_transactions ct ON ct.id = v.credit_transaction_id
  LEFT JOIN users u ON u.id = ct.user_id
  WHERE v.status = 'failed' AND v.credit_transaction_id IS NOT NULL
  ORDER BY v.id DESC
  LIMIT 15
`).all()

console.log('=== 最近 15 条失败视频（有扣费）===')
for (const r of recentFailed) {
  const refund = findRefund(r.credit_transaction_id)
  console.log(`#${r.id} user=${r.username} charge=${r.amount} tx=${r.credit_transaction_id} refund=${refund ? `yes(#${refund.id} +${refund.amount})` : 'NO'}`)
  console.log(`  ${r.created_at?.slice(0,19)} | ${r.error_msg}`)
}

// Recent image studio charges
const imgCharges = db.prepare(`
  SELECT ct.id AS tx_id, ct.amount, ct.created_at, ct.summary,
         ig.id AS gen_id, ig.status, ig.error_msg
  FROM credit_transactions ct
  LEFT JOIN image_generations ig ON ig.credit_transaction_id = ct.id
  WHERE ct.action = 'image.generate' AND ct.type = 'charge'
  ORDER BY ct.id DESC
  LIMIT 10
`).all()
console.log('\n=== 最近图片扣费记录 ===')
for (const r of imgCharges) {
  const refund = findRefund(r.tx_id)
  console.log(`tx=${r.tx_id} gen=#${r.gen_id||'?'} status=${r.status||'?'} amt=${r.amount} refund=${refund ? 'yes' : r.status==='failed'?'NO':'n/a'} ${r.summary}`)
}

// Stuck processing
const stuck = db.prepare(`
  SELECT id, status, credit_transaction_id, task_id, created_at, substr(error_msg,1,80) AS err
  FROM video_generations
  WHERE status IN ('processing','pending') AND credit_transaction_id IS NOT NULL
  ORDER BY id DESC
`).all()
console.log('\n=== 仍显示生成中（已扣费未失败）===')
for (const r of stuck) {
  console.log(`#${r.id} ${r.status} tx=${r.credit_transaction_id} task=${r.task_id||'—'} since ${r.created_at?.slice(0,19)}`)
}
