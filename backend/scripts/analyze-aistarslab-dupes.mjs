import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const db = new Database(path.join(root, 'data', 'huobao_drama.db'), { readonly: true })

console.log('=== Recent aistarslab tasks ===')
const rows = db.prepare(`
  SELECT id, status, task_id, error_msg, created_at, credit_transaction_id
  FROM video_generations
  WHERE provider = 'aistarslab'
  ORDER BY id DESC LIMIT 25
`).all()
for (const r of rows) {
  console.log(r.id, r.status, r.task_id || '(no task_id)', r.created_at?.slice(0, 19))
}

console.log('\n=== Processing without task_id ===')
const stuck = db.prepare(`
  SELECT id, status, task_id, created_at, provider
  FROM video_generations
  WHERE provider = 'aistarslab' AND status = 'processing' AND (task_id IS NULL OR task_id = '')
`).all()
console.log(stuck)

console.log('\n=== Duplicate upstream task_ids ===')
const dup = db.prepare(`
  SELECT task_id, COUNT(*) AS c, GROUP_CONCAT(id) AS ids
  FROM video_generations
  WHERE provider = 'aistarslab' AND task_id IS NOT NULL AND task_id != ''
  GROUP BY task_id HAVING COUNT(*) > 1
`).all()
console.log(dup)

console.log('\n=== Similar prompts submitted multiple times today ===')
const prompts = db.prepare(`
  SELECT substr(prompt, 1, 60) AS p, COUNT(*) AS c, GROUP_CONCAT(id) AS ids
  FROM video_generations
  WHERE provider = 'aistarslab' AND created_at > datetime('now', '-1 day')
  GROUP BY substr(prompt, 1, 120)
  HAVING COUNT(*) > 1
  ORDER BY c DESC LIMIT 10
`).all()
console.log(prompts)
