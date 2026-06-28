import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dbPath = process.env.DB_PATH || path.join(root, 'data', 'huobao_drama.db')
const db = new Database(dbPath)
const result = db.prepare(
  "DELETE FROM video_generations WHERE provider = 'jimeng_web' OR model LIKE 'jimeng-video-%'",
).run()
console.log(`Deleted ${result.changes} jimeng video record(s) from ${dbPath}`)
