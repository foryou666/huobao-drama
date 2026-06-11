import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const db = new Database(path.join(root, 'data/huobao_drama.db'), { readonly: true })

const byType = db.prepare(`
  SELECT type,
    COUNT(*) as total,
    SUM(CASE WHEN url IS NULL AND local_path IS NULL THEN 1 ELSE 0 END) as no_path,
    SUM(CASE WHEN url IS NOT NULL OR local_path IS NOT NULL THEN 1 ELSE 0 END) as has_path
  FROM assets WHERE deleted_at IS NULL AND source_type='import'
  GROUP BY type
`).all()

console.log('import by type:', byType)

const charImportWithPath = db.prepare(`
  SELECT id, name, url, local_path FROM assets
  WHERE deleted_at IS NULL AND source_type='import' AND type='character' AND (url IS NOT NULL OR local_path IS NOT NULL)
  LIMIT 5
`).all()
console.log('character import with path:', charImportWithPath)
