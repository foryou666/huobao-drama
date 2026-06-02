import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.DB_PATH || path.resolve(__dirname, '../../data/huobao_drama.db')
const db = new Database(dbPath, { readonly: true })
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
console.log('DB:', dbPath)
console.log('Tables:', tables.map(t => t.name).join(', '))
for (const t of ['users', 'dramas', 'teams', 'team_members', 'ai_service_configs', 'episodes', 'storyboards']) {
  try {
    console.log(`${t}:`, db.prepare(`SELECT COUNT(*) as n FROM ${t}`).get().n)
  } catch { /* ignore */ }
}
db.close()
