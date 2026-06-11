/**
 * Import committed seed database into local data/huobao_drama.db
 * Usage: node backend/scripts/import-db.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')
const seedDb = path.join(projectRoot, 'data', 'seed', 'huobao_drama.db')
const targetDb = process.env.DB_PATH || path.join(projectRoot, 'data', 'huobao_drama.db')

if (!fs.existsSync(seedDb)) {
  console.error('Seed database not found:', seedDb)
  console.error('Run: node backend/scripts/export-db.mjs')
  process.exit(1)
}

fs.mkdirSync(path.dirname(targetDb), { recursive: true })
for (const suffix of ['', '-wal', '-shm']) {
  const p = targetDb + suffix
  if (fs.existsSync(p)) fs.unlinkSync(p)
}
fs.copyFileSync(seedDb, targetDb)
console.log('Imported seed database to:', targetDb)
console.log('注意：seed 库中导入类资产的图片路径可能为空，需用 assets:repair-import 从原始资产包目录修复。')
