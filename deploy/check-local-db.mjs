import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = path.join(root, 'data', 'huobao_drama.db')
const stat = fs.statSync(dbPath)
const db = new Database(dbPath, { readonly: true })
const q = (sql) => db.prepare(sql).get()
console.log('LOCAL', {
  bytes: stat.size,
  mtime: stat.mtime.toISOString(),
  users: q('SELECT COUNT(*) c FROM users').c,
  dramas: q('SELECT COUNT(*) c FROM dramas').c,
  videos: q('SELECT COUNT(*) c FROM video_generations').c,
  images: q('SELECT COUNT(*) c FROM image_generations').c,
  teams: q('SELECT COUNT(*) c FROM teams').c,
})
db.close()
