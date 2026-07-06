import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const db = new Database(path.join(__dirname, '../../data/huobao_drama.db'), { readonly: true })

// VolcEngine AK pattern often starts with AKLT
const needle = 'AKLT'
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()

for (const { name } of tables) {
  const cols = db.prepare(`PRAGMA table_info("${name}")`).all()
  const textCols = cols.filter(c => ['TEXT', 'JSON', 'BLOB'].includes(String(c.type).toUpperCase()) || !c.type)
  for (const col of textCols) {
    try {
      const rows = db.prepare(`SELECT rowid as rid, "${col.name}" as val FROM "${name}" WHERE "${col.name}" LIKE ? LIMIT 3`).all(`%${needle}%`)
      for (const row of rows) {
        const val = String(row.val || '')
        console.log(`${name}.${col.name} rowid=${row.rid}:`, val.slice(0, 120))
      }
    } catch { /* ignore */ }
  }
}
db.close()
