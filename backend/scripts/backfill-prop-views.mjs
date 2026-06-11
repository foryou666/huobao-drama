/**
 * 为已导入道具补写 reference_images（多图）
 * npx tsx scripts/backfill-prop-views.mjs [源目录] [--drama-id=7]
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuid } from 'uuid'
import { db, schema } from '../src/db/index.js'
import { eq, and, isNull } from 'drizzle-orm'
import { now } from '../src/utils/response.js'
import { ensureThumbnail } from '../src/utils/thumbnail.js'
import { upsertPropViewImage } from '../src/utils/prop-image-variants.js'
import { syncPropAsset } from '../src/services/asset-library.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')
const STORAGE_ROOT = process.env.STORAGE_PATH || path.join(projectRoot, 'data', 'static')
const argv = process.argv.slice(2)
const SOURCE_ROOT = argv.find(a => !a.startsWith('--')) || 'D:/Desktop/Crash into his arms'
const DRAMA_ID = Number((argv.find(a => a.startsWith('--drama-id=')) || '--drama-id=7').split('=')[1])
const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i

function slugifyId(name) {
  return String(name || 'item').trim().replace(/\s+/g, '_').replace(/[^\w\u4e00-\u9fff-]/g, '').slice(0, 48) || 'item'
}
function stem(file) { return path.basename(file, path.extname(file)) }
function listImages(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && IMAGE_RE.test(e.name))
    .map(e => path.join(dir, e.name))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
}
function fileSize(file) { try { return fs.statSync(file).size } catch { return 0 } }
function pickPrimary(files, hint) {
  const lower = String(hint || '').toLowerCase()
  return [...files].sort((a, b) => {
    const sa = fileSize(a) + (lower && stem(a).toLowerCase().includes(lower) ? 1e9 : 0)
    const sb = fileSize(b) + (lower && stem(b).toLowerCase().includes(lower) ? 1e9 : 0)
    return sb - sa
  })[0]
}
async function copyToStatic(src, subDir) {
  const dir = path.join(STORAGE_ROOT, subDir)
  fs.mkdirSync(dir, { recursive: true })
  const ext = path.extname(src).toLowerCase() || '.png'
  const filename = `${uuid()}${ext}`
  fs.copyFileSync(src, path.join(dir, filename))
  const relative = `static/${subDir}/${filename}`
  await ensureThumbnail(relative).catch(() => {})
  return relative
}

async function main() {
  const propRoot = path.join(SOURCE_ROOT, '道具')
  if (!fs.existsSync(propRoot)) {
    console.error('未找到道具目录:', propRoot)
    process.exit(1)
  }

  let updated = 0
  for (const entry of fs.readdirSync(propRoot, { withFileTypes: true }).filter(e => e.isDirectory())) {
    const prop = db.select().from(schema.props)
      .where(and(eq(schema.props.dramaId, DRAMA_ID), isNull(schema.props.deletedAt)))
      .all()
      .find(p => p.name === entry.name)
    if (!prop) {
      console.warn('跳过（DB无此道具）:', entry.name)
      continue
    }

    const images = listImages(path.join(propRoot, entry.name))
    if (images.length <= 1) continue

    const primaryFile = pickPrimary(images, entry.name)
    const primaryRelative = await copyToStatic(primaryFile, 'props')
    db.update(schema.props)
      .set({ imageUrl: primaryRelative, localPath: primaryRelative, updatedAt: now() })
      .where(eq(schema.props.id, prop.id))
      .run()

    for (const img of images) {
      if (img === primaryFile) continue
      const relative = await copyToStatic(img, 'props')
      upsertPropViewImage(prop.id, `ref_${slugifyId(stem(img))}`, relative, stem(img))
    }
    syncPropAsset(prop.id)
    updated++
    console.log(`✓ ${entry.name}: ${images.length} 张`)
  }
  console.log(JSON.stringify({ drama_id: DRAMA_ID, updated }, null, 2))
}

main().catch(err => { console.error(err); process.exit(1) })
