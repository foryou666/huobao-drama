/**
 * 删除含上游余额/价格信息的图片生成失败记录
 * Usage: node backend/scripts/delete-balance-failed-images.mjs
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/huobao_drama.db')
const db = new Database(dbPath)

const rows = db.prepare(`
  SELECT id, error_msg, created_at
  FROM image_generations
  WHERE status = 'failed'
    AND (
      error_msg LIKE '%预扣费%'
      OR error_msg LIKE '%💰%'
      OR error_msg LIKE '%剩余额度%'
      OR error_msg LIKE '%Requires %'
      OR error_msg LIKE '%Insufficient balance%'
    )
  ORDER BY id DESC
`).all()

if (!rows.length) {
  console.log('No matching failed image records to delete.')
  process.exit(0)
}

console.log('Will delete', rows.length, 'records:')
for (const row of rows) {
  console.log(`  #${row.id} ${row.created_at}`)
}

const ids = rows.map(r => r.id)
const placeholders = ids.map(() => '?').join(',')
db.prepare(`DELETE FROM image_generations WHERE id IN (${placeholders})`).run(...ids)
console.log('Deleted', ids.length, 'failed image_generations rows.')
