/**
 * 合并用户 qiao -> qiao1（保留 qiao1，密码 111000）
 * 用法: DB_PATH=... node deploy/merge-qiao-users.cjs
 */
const path = require('path')
const { randomBytes, scryptSync } = require('crypto')
const backendDir = process.env.BACKEND_DIR || '/opt/hongguoduanju/backend'
const Database = require(path.join(backendDir, 'node_modules', 'better-sqlite3'))

const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/huobao_drama.db')
const FROM_ID = Number(process.env.FROM_USER_ID || 12)
const TO_ID = Number(process.env.TO_USER_ID || 14)
const NEW_PASSWORD = process.env.MERGE_PASSWORD || '111000'

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex')
  return `${salt}:${hash}`
}

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

const db = new Database(dbPath)

const fromUser = db.prepare('SELECT * FROM users WHERE id = ?').get(FROM_ID)
const toUser = db.prepare('SELECT * FROM users WHERE id = ?').get(TO_ID)
if (!fromUser || !toUser) {
  console.error('用户不存在', { fromUser: !!fromUser, toUser: !!toUser })
  process.exit(1)
}
if (fromUser.username !== 'qiao' || toUser.username !== 'qiao1') {
  console.error('用户名校验失败', { from: fromUser.username, to: toUser.username })
  process.exit(1)
}

const result = db.transaction(() => {
  const moved = {}
  const tables = [
    'credit_transactions',
    'activity_logs',
    'video_generations',
    'payment_orders',
    'assistant_threads',
    'video_repaint_jobs',
  ]
  for (const table of tables) {
    const info = db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`).run(TO_ID, FROM_ID)
    moved[table] = info.changes
  }

  const mergedBalance = (fromUser.credits_balance || 0) + (toUser.credits_balance || 0)
  db.prepare(`
    UPDATE users
    SET credits_balance = ?, password_hash = ?, updated_at = ?
    WHERE id = ?
  `).run(mergedBalance, hashPassword(NEW_PASSWORD), ts(), TO_ID)

  db.prepare('DELETE FROM team_members WHERE user_id = ?').run(FROM_ID)
  db.prepare(`
    UPDATE users
    SET username = ?, display_name = ?, is_active = 0, credits_balance = 0, updated_at = ?
    WHERE id = ?
  `).run(`_merged_${fromUser.username}_${FROM_ID}`, `${fromUser.display_name || fromUser.username}（已合并至 qiao1）`, ts(), FROM_ID)

  db.prepare(`
    INSERT INTO activity_logs (user_id, action, summary, metadata, created_at)
    VALUES (?, 'user.merge', ?, ?, ?)
  `).run(
    TO_ID,
    `账号合并：${fromUser.username} (#${FROM_ID}) 已并入 qiao1`,
    JSON.stringify({ from_user_id: FROM_ID, to_user_id: TO_ID, moved, merged_balance: mergedBalance }),
    ts(),
  )

  return {
    from: { id: fromUser.id, username: fromUser.username, balance: fromUser.credits_balance },
    to: { id: toUser.id, username: toUser.username, balance_before: toUser.credits_balance, balance_after: mergedBalance },
    moved,
  }
})()

console.log(JSON.stringify(result, null, 2))
