/**
 * 为已有 static/ 图片批量生成缩略图，并回填 assets.thumbnail_url
 *
 *   node scripts/backfill-thumbnails.mjs
 *   node scripts/backfill-thumbnails.mjs --force
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')
const storageRoot = process.env.STORAGE_PATH || path.join(projectRoot, 'data', 'static')
const dbPath = process.env.DB_PATH || path.join(projectRoot, 'data', 'huobao_drama.db')
const force = process.argv.includes('--force')

const THUMB_MAX_WIDTH = 480
const THUMB_WEBP_QUALITY = 80
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

function normalizeStaticPath(raw) {
  return String(raw || '').trim().replace(/^\/+/, '')
}

function isImageStaticPath(raw) {
  const normalized = normalizeStaticPath(raw)
  if (!normalized.startsWith('static/')) return false
  if (normalized.startsWith('static/thumbs/')) return false
  const ext = path.extname(normalized).toLowerCase()
  return IMAGE_EXTS.has(ext)
}

function thumbPathForSource(sourcePath) {
  const normalized = normalizeStaticPath(sourcePath)
  if (!isImageStaticPath(normalized)) return null
  const rest = normalized.slice('static/'.length)
  const withoutExt = rest.replace(/\.[^.]+$/i, '')
  return `static/thumbs/${withoutExt}.webp`
}

function sourceAbs(relative) {
  return path.join(storageRoot, '..', relative.replace(/^\/+/, ''))
}

function thumbAbs(thumbPath) {
  return path.join(storageRoot, '..', thumbPath.replace(/^\/+/, ''))
}

async function ensureThumbnail(sourcePath) {
  const normalized = normalizeStaticPath(sourcePath)
  if (!isImageStaticPath(normalized)) return null
  const thumbPath = thumbPathForSource(normalized)
  if (!thumbPath) return null

  const srcFile = sourceAbs(normalized)
  if (!fs.existsSync(srcFile)) return null

  const outFile = thumbAbs(thumbPath)
  fs.mkdirSync(path.dirname(outFile), { recursive: true })

  if (!force && fs.existsSync(outFile)) {
    const srcStat = fs.statSync(srcFile)
    const outStat = fs.statSync(outFile)
    if (outStat.mtimeMs >= srcStat.mtimeMs) return thumbPath
  }

  await sharp(srcFile)
    .rotate()
    .resize({ width: THUMB_MAX_WIDTH, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: THUMB_WEBP_QUALITY })
    .toFile(outFile)

  return thumbPath
}

function walkImages(dir, results = []) {
  if (!fs.existsSync(dir)) return results
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'thumbs') continue
      walkImages(full, results)
      continue
    }
    const ext = path.extname(entry.name).toLowerCase()
    if (!IMAGE_EXTS.has(ext)) continue
    const rel = path.relative(path.join(storageRoot, '..'), full).replace(/\\/g, '/')
    results.push(rel)
  }
  return results
}

async function main() {
  const images = walkImages(storageRoot)
  console.log(`Found ${images.length} source images under static/`)

  let generated = 0
  let skipped = 0
  let failed = 0

  for (const rel of images) {
    try {
      const thumb = await ensureThumbnail(rel)
      if (thumb) generated += 1
      else skipped += 1
    } catch (err) {
      failed += 1
      console.warn('FAIL', rel, err?.message || err)
    }
  }

  console.log(`Thumbnails: generated/updated=${generated}, skipped=${skipped}, failed=${failed}`)

  if (!fs.existsSync(dbPath)) {
    console.log('DB not found, skip assets.thumbnail_url backfill')
    return
  }

  const db = new Database(dbPath)
  const assets = db.prepare(`
    SELECT id, url, local_path, thumbnail_url FROM assets
    WHERE deleted_at IS NULL AND (url IS NOT NULL OR local_path IS NOT NULL)
  `).all()

  const update = db.prepare('UPDATE assets SET thumbnail_url = ?, updated_at = ? WHERE id = ?')
  const ts = new Date().toISOString()
  let assetUpdated = 0

  for (const row of assets) {
    const source = normalizeStaticPath(row.url || row.local_path)
    const thumb = thumbPathForSource(source)
    if (!thumb) continue
    if (row.thumbnail_url === thumb) continue
    update.run(thumb, ts, row.id)
    assetUpdated += 1
  }

  db.close()
  console.log(`assets.thumbnail_url backfill: ${assetUpdated} rows updated`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
