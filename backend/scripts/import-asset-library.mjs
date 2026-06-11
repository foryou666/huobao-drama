/**
 * 从本地文件夹批量导入资产库图片
 * 用法: node backend/scripts/import-asset-library.mjs [源目录]
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'
import { v4 as uuid } from 'uuid'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')
const DB_PATH = process.env.DB_PATH || path.join(projectRoot, 'data', 'huobao_drama.db')
const STORAGE_ROOT = process.env.STORAGE_PATH || path.join(projectRoot, 'data', 'static')
const args = process.argv.slice(2).filter(a => a !== '--repair')
const repair = process.argv.includes('--repair')
const SOURCE_ROOT = args[0] || 'C:/baidunetdiskdownload/500'

const FOLDER_MAP = {
  '\u4eba\u7269\u8d44\u4ea7': 'character',
  '\u4eba\u7269': 'character',
  '\u573a\u666f': 'scene',
  '\u670d\u88c5': 'costume',
  '\u9053\u5177': 'prop',
}

const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function cleanName(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/_\d{10,}$/, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .trim()
}

function walkImages(dir) {
  const items = []
  if (!fs.existsSync(dir)) return items
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) items.push(...walkImages(full))
    else if (IMAGE_RE.test(entry.name)) items.push(full)
  }
  return items
}

function findExisting(db, name, type) {
  return db.prepare(`
    SELECT id, url, local_path FROM assets
    WHERE deleted_at IS NULL AND name = ? AND type = ? AND source_type = 'import'
    LIMIT 1
  `).get(name, type)
}

function parseDescriptionPath(description) {
  const m = String(description || '').match(/从本地资产包导入：[^/]+[/\\]([^/\\]+)$/)
  return m?.[1] || null
}

function main() {
  if (!fs.existsSync(SOURCE_ROOT)) {
    console.error('源目录不存在:', SOURCE_ROOT)
    process.exit(1)
  }

  const db = new Database(DB_PATH)
  const destDir = path.join(STORAGE_ROOT, 'assets', 'imported')
  fs.mkdirSync(destDir, { recursive: true })

  const insert = db.prepare(`
    INSERT INTO assets (
      drama_id, name, description, type, category, url, local_path, thumbnail_url,
      source_type, source_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'import', NULL, ?, ?)
  `)

  let imported = 0
  let skipped = 0
  let failed = 0

  for (const [folderName, assetType] of Object.entries(FOLDER_MAP)) {
    const sourceDir = path.join(SOURCE_ROOT, folderName)
    const files = walkImages(sourceDir)
    console.log(`\n[${folderName}] -> ${assetType}: ${files.length} 张`)

    for (const src of files) {
      const name = cleanName(src)
      if (!name) {
        failed += 1
        console.warn('  跳过（无法解析名称）:', src)
        continue
      }

      const existing = findExisting(db, name, assetType)
      const hasPath = existing && String(existing.url || existing.local_path || '').trim()
      if (existing && hasPath && !repair) {
        skipped += 1
        console.log('  已存在，跳过:', name)
        continue
      }

      try {
        const ext = path.extname(src).toLowerCase() || '.png'
        const filename = `${uuid()}${ext}`
        const destAbs = path.join(destDir, filename)
        fs.copyFileSync(src, destAbs)

        const relative = `static/assets/imported/${filename}`
        const ts = now()
        const description = `从本地资产包导入：${folderName}/${path.basename(src)}`
        if (existing && repair) {
          db.prepare(`
            UPDATE assets
            SET url = ?, local_path = ?, thumbnail_url = ?, description = ?, updated_at = ?
            WHERE id = ?
          `).run(relative, relative, relative, description, ts, existing.id)
          imported += 1
          console.log('  ↻ 修复:', name)
        } else {
          insert.run(
            null,
            name,
            description,
            assetType,
            assetType,
            relative,
            relative,
            relative,
            ts,
            ts,
          )
          imported += 1
          console.log('  +', name)
        }
      } catch (err) {
        failed += 1
        console.error('  失败:', name, err.message)
      }
    }
  }

  db.close()
  console.log(`\n完成：${repair ? '修复' : '导入'} ${imported}，跳过 ${skipped}，失败 ${failed}`)
}

main()
