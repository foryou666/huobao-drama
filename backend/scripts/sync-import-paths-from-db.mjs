import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const refDb = process.argv[2]
if (!refDb) {
  console.error('用法: node scripts/sync-import-paths-from-db.mjs <同事的数据库路径>')
  console.error('示例: node scripts/sync-import-paths-from-db.mjs D:/backup/huobao_drama.db')
  process.exit(1)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const localDbPath = process.env.DB_PATH || path.join(root, 'data', 'huobao_drama.db')
const staticRoot = process.env.STORAGE_PATH || path.join(root, 'data', 'static')

const local = new Database(localDbPath)
const ref = new Database(refDb, { readonly: true })

const refRows = ref.prepare(`
  SELECT name, type, url, local_path, thumbnail_url, description
  FROM assets WHERE deleted_at IS NULL AND source_type = 'import'
    AND (url IS NOT NULL OR local_path IS NOT NULL)
`).all()

const refByKey = new Map()
for (const r of refRows) {
  const key = `${r.type}::${r.name}`
  if (!refByKey.has(key)) refByKey.set(key, r)
}

const localRows = local.prepare(`
  SELECT id, name, type, url, local_path FROM assets
  WHERE deleted_at IS NULL AND source_type = 'import'
`).all()

let updated = 0
let missingFile = 0
let noRef = 0

const update = local.prepare(`
  UPDATE assets SET url = ?, local_path = ?, thumbnail_url = ?, updated_at = ? WHERE id = ?
`)

const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)

for (const row of localRows) {
  const hasPath = String(row.url || row.local_path || '').trim()
  if (hasPath) continue

  const refRow = refByKey.get(`${row.type}::${row.name}`)
  if (!refRow) { noRef++; continue }

  const rel = String(refRow.url || refRow.local_path || '').replace(/^\/+/, '')
  if (!rel) { noRef++; continue }

  const abs = path.join(staticRoot, rel.replace(/^static\//, ''))
  if (!fs.existsSync(abs)) {
    missingFile++
    continue
  }

  const thumb = refRow.thumbnail_url || rel
  update.run(rel, rel, thumb, ts, row.id)
  updated++
}

console.log(JSON.stringify({
  localImportAssets: localRows.length,
  refWithPaths: refRows.length,
  updated,
  missingFile,
  noRef,
}, null, 2))

local.close()
ref.close()
