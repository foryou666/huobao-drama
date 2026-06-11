/**
 * Export SQLite database to a committed seed file for other developers.
 * Usage: node backend/scripts/export-db.mjs
 */
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')
const dbPath = process.env.DB_PATH || path.join(projectRoot, 'data', 'huobao_drama.db')
const outDir = path.join(projectRoot, 'data', 'seed')
const outDb = path.join(outDir, 'huobao_drama.db')
const outSql = path.join(outDir, 'huobao_drama.sql')

if (!fs.existsSync(dbPath)) {
  console.error('Database not found:', dbPath)
  process.exit(1)
}

fs.mkdirSync(outDir, { recursive: true })

const src = new Database(dbPath)
src.pragma('wal_checkpoint(TRUNCATE)')
src.close()

fs.copyFileSync(dbPath, outDb)
for (const suffix of ['-wal', '-shm']) {
  const p = outDb + suffix
  if (fs.existsSync(p)) fs.unlinkSync(p)
}

// Strip secrets so the seed can be pushed to GitHub
const writable = new Database(outDb)
writable.pragma('journal_mode = DELETE')

writable.prepare(`
  UPDATE ai_service_configs
  SET api_key = 'REPLACE_WITH_YOUR_KEY'
  WHERE api_key IS NOT NULL AND api_key != ''
`).run()

const clearColumns = {
  video_generations: ['video_url', 'minio_url', 'local_path', 'image_url', 'first_frame_url', 'last_frame_url', 'reference_image_urls'],
  image_generations: ['image_url', 'minio_url', 'local_path', 'reference_images'],
  storyboards: ['composed_image', 'first_frame_image', 'last_frame_image', 'blocking_image', 'video_url', 'tts_audio_url', 'subtitle_url', 'composed_video_url', 'reference_images', 'character_image_refs'],
  characters: ['image_url', 'local_path', 'reference_images', 'voice_sample_url'],
  scenes: ['image_url', 'local_path'],
  props: ['image_url', 'local_path', 'reference_images'],
  episodes: ['video_url', 'thumbnail'],
  dramas: ['thumbnail'],
  video_merges: ['merged_url'],
}

for (const [table, columns] of Object.entries(clearColumns)) {
  for (const col of columns) {
    try {
      writable.prepare(`UPDATE "${table}" SET "${col}" = NULL WHERE "${col}" IS NOT NULL`).run()
    } catch { /* column may not exist */ }
  }
}

// 资产库：仅清除 http(s) 外链，保留 static/ 本地路径（服装/道具导入图不是密钥）
for (const col of ['url', 'thumbnail_url', 'local_path']) {
  try {
    writable.prepare(`
      UPDATE assets SET "${col}" = NULL
      WHERE "${col}" IS NOT NULL
        AND ("${col}" LIKE 'http://%' OR "${col}" LIKE 'https://%')
    `).run()
  } catch { /* ignore */ }
}

// Scrub any remaining signed URLs / keys in text columns
const sensitive = /AKLT|X-Tos-|X-Amz-|sig(nature)?=/i
const tables = writable.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
for (const { name: table } of tables) {
  const cols = writable.prepare(`PRAGMA table_info("${table}")`).all()
  for (const col of cols) {
    if (col.type && !/TEXT|JSON|BLOB|CHAR|CLOB/i.test(String(col.type))) continue
    try {
      const rows = writable.prepare(`SELECT rowid as rid, "${col.name}" as val FROM "${table}" WHERE "${col.name}" IS NOT NULL`).all()
      const upd = writable.prepare(`UPDATE "${table}" SET "${col.name}" = NULL WHERE rowid = ?`)
      for (const row of rows) {
        const val = String(row.val || '')
        if (sensitive.test(val)) upd.run(row.rid)
      }
    } catch { /* ignore */ }
  }
}

writable.close()

// Reclaim space so scrubbed secrets are not left in the file
const vacuum = new Database(outDb)
vacuum.pragma('journal_mode = DELETE')
vacuum.exec('VACUUM')
vacuum.close()

for (const suffix of ['-wal', '-shm']) {
  const p = outDb + suffix
  if (fs.existsSync(p)) fs.unlinkSync(p)
}

// Also export SQL dump for local inspection (gitignored)
const ro = new Database(outDb, { readonly: true })
const sqlTables = ro.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
const lines = ['BEGIN TRANSACTION;', 'PRAGMA foreign_keys=OFF;']
for (const { name } of sqlTables) {
  const ddl = ro.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name)?.sql
  if (ddl) lines.push(`${ddl};`)
  const rows = ro.prepare(`SELECT * FROM "${name}"`).all()
  for (const row of rows) {
    const cols = Object.keys(row)
    const vals = cols.map(c => {
      const v = row[c]
      if (v == null) return 'NULL'
      if (typeof v === 'number') return String(v)
      return `'${String(v).replace(/'/g, "''")}'`
    })
    lines.push(`INSERT INTO "${name}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});`)
  }
}
lines.push('COMMIT;')
ro.close()
fs.writeFileSync(outSql, lines.join('\n'), 'utf8')

const size = fs.statSync(outDb).size
console.log('Exported:')
console.log(' ', outDb, `(${(size / 1024).toFixed(1)} KB)`)
console.log(' ', outSql)
