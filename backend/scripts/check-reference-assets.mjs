import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.DB_PATH || path.resolve(__dirname, '../../data/huobao_drama.db')
const db = new Database(dbPath)

const refs = db.prepare(`
  SELECT id, name, type, local_path, drama_id, source_type, created_at
  FROM assets
  WHERE type = 'reference' AND deleted_at IS NULL
  ORDER BY id DESC
  LIMIT 20
`).all()

console.log('DB:', dbPath)
console.log('reference assets:', refs.length)
for (const row of refs) console.log(row)

const latest = db.prepare(`
  SELECT id, name, type, local_path, created_at
  FROM assets
  WHERE deleted_at IS NULL
  ORDER BY id DESC
  LIMIT 8
`).all()
console.log('\nlatest assets:')
for (const row of latest) console.log(row)
