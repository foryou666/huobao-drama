import Database from 'better-sqlite3'

const MESSAGE = 'Insufficient balance. Requires 750'

function isLeak(text) {
  const s = String(text || '').trim()
  if (!s) return false
  if (s === '余额不足，需要7.5元') return true
  if (s === 'Insufficient balance. Requires 7.5 yuan.') return true
  if (s === MESSAGE) return false
  const lower = s.toLowerCase()
  if (/余额|可用余额|额度|积分不足|次数.*用完|充值|insufficient|quota|depleted|no\s*credit/.test(lower)) return true
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

const db = new Database('../data/huobao_drama.db')
const videoCount = scrubTable(db, 'video_generations')
const imageCount = scrubTable(db, 'image_generations')
console.log(`Updated ${videoCount} video + ${imageCount} image error_msg rows`)
