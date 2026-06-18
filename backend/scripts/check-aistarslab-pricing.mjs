import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const db = new Database(path.join(root, 'data', 'huobao_drama.db'), { readonly: true })

const pricing = db.prepare(
  "SELECT action, label, cost, description FROM credit_pricing WHERE action = 'video.generate.aistarslab'",
).get()
console.log('Fallback pricing (settings):', pricing)

const tx = db.prepare(`
  SELECT t.id, t.amount, t.summary, t.metadata, t.created_at
  FROM credit_transactions t
  WHERE t.action = 'video.generate.aistarslab'
  ORDER BY t.id DESC LIMIT 5
`).all()
console.log('\nRecent aistarslab transactions:')
for (const row of tx) console.log(JSON.stringify(row))
