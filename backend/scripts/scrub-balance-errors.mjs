/**
 * 将数据库中含上游余额/价格信息的 error_msg 替换为脱敏文案
 * Usage: node backend/scripts/scrub-balance-errors.mjs
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MESSAGE = '生成失败：服务账户余额不足，请联系管理员'

function isLeak(text) {
  const s = String(text || '').trim()
  if (!s) return false
  if (s === MESSAGE) return false
  if (/^积分不足：本次需要\s+\d+\s+积分/.test(s)) return false
  if (/^积分不足：批量操作需要/.test(s)) return false
  const lower = s.toLowerCase()
  if (/元|💰|预扣费|剩余额度|需要预扣费/.test(s)) return true
  if (/余额|可用余额|额度|积分不足|次数.*用完|充值|insufficient|quota|depleted|no\s*credit/.test(lower)) return true
  if (/requires\s+[\d.]+/i.test(s)) return true
  if (/需要\s*[\d.]+\s*元|当前可用.*?元|[\d.]+\s*元/.test(s)) return true
  if (/"required"\s*:\s*[\d.]+/.test(s) && /"balance"\s*:\s*[\d.]+/.test(s)) return true
  if (/上游未返回任务/.test(s) && /积分不足|余额/.test(s)) return true
  return false
}

function scrubTable(db, table) {
  const rows = db.prepare(`SELECT id, error_msg FROM ${table} WHERE error_msg IS NOT NULL AND error_msg != ''`).all()
  let updated = 0
  const update = db.prepare(`UPDATE ${table} SET error_msg = ? WHERE id = ?`)
  for (const row of rows) {
    if (isLeak(row.error_msg)) {
      update.run(MESSAGE, row.id)
      updated += 1
    }
  }
  return updated
}

const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/huobao_drama.db')
const db = new Database(dbPath)
const videoCount = scrubTable(db, 'video_generations')
const imageCount = scrubTable(db, 'image_generations')
console.log(`Updated ${videoCount} video + ${imageCount} image error_msg rows`)
