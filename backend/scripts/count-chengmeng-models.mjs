import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const db = new Database(path.join(root, 'data', 'huobao_drama.db'), { readonly: true })
const rows = db.prepare(`
  SELECT model, COUNT(*) AS c
  FROM video_generations
  WHERE provider = 'chengmeng' AND deleted_at IS NULL
  GROUP BY model
  ORDER BY c DESC
`).all()
console.log('chengmeng by model:', rows)
