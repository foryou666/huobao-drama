import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const db = new Database(path.join(root, 'data', 'huobao_drama.db'))

const id = Number(process.argv[2] || 1169)
const row = db.prepare('SELECT * FROM video_generations WHERE id = ?').get(id)
console.log(JSON.stringify(row, null, 2))

const cfg = db.prepare('SELECT id, base_url, provider FROM ai_service_configs WHERE id = ?').get(row.config_id)
console.log('config:', cfg)
