/**
 * 修复导入资产：为 source_type=import 且无图片路径的记录重新复制文件并写回 DB
 *
 *   npx tsx scripts/repair-import-assets.mjs [源目录]
 *   npx tsx scripts/repair-import-assets.mjs D:/Desktop
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuid } from 'uuid'
import { db, schema } from '../src/db/index.js'
import { isNull, eq } from 'drizzle-orm'
import { now } from '../src/utils/response.js'
import { ensureThumbnail, thumbPathForSource } from '../src/utils/thumbnail.js'
import { syncProjectAsset, syncReferenceUploadToOss } from '../src/utils/oss-entity-sync.js'
import { isOssConfigured } from '../src/utils/oss-upload.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')
const STORAGE_ROOT = process.env.STORAGE_PATH || path.join(projectRoot, 'data', 'static')
const SOURCE_ROOTS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
    'C:/baidunetdiskdownload/500',
    'D:/baidunetdiskdownload/500',
    'D:/Desktop',
  ]

const FOLDER_HINTS = ['服装', '道具', '人物', '人物资产', '场景', '角色', '本官是只猫-资产']
const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i

function cleanName(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/_\d{10,}$/, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .trim()
}

function walkImages(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkImages(full, out)
    else if (IMAGE_RE.test(entry.name)) out.push(full)
  }
  return out
}

function buildFileIndex() {
  const byName = new Map()
  const byDescBasename = new Map()

  for (const root of SOURCE_ROOTS) {
    if (!fs.existsSync(root)) continue
    const files = walkImages(root)
    for (const file of files) {
      const stem = cleanName(file)
      if (stem && !byName.has(stem)) byName.set(stem, file)
      const base = path.basename(file)
      if (!byDescBasename.has(base)) byDescBasename.set(base, file)
    }
  }
  return { byName, byDescBasename }
}

function parseDescriptionPath(description) {
  const m = String(description || '').match(/从本地资产包导入：[^/]+[/\\]([^/\\]+)$/)
  return m?.[1] || null
}

function resolveSourceFile(asset, index) {
  const byName = index.byName.get(String(asset.name || '').trim())
  if (byName) return byName
  const descFile = parseDescriptionPath(asset.description)
  if (descFile && index.byDescBasename.has(descFile)) {
    return index.byDescBasename.get(descFile)
  }
  return null
}

async function main() {
  console.log('源目录:', SOURCE_ROOTS.filter(r => fs.existsSync(r)))
  const index = buildFileIndex()
  console.log(`已索引源图片: ${index.byName.size} 个名称`)

  const rows = db.select().from(schema.assets).where(
    isNull(schema.assets.deletedAt),
  ).all().filter(row =>
    row.sourceType === 'import'
    && !String(row.url || row.localPath || '').trim()
  )

  console.log(`待修复导入资产: ${rows.length}`)

  const destDir = path.join(STORAGE_ROOT, 'assets', 'imported')
  fs.mkdirSync(destDir, { recursive: true })

  let repaired = 0
  let missing = 0
  let ossOk = 0

  for (const asset of rows) {
    const src = resolveSourceFile(asset, index)
    if (!src) {
      missing++
      continue
    }

    const ext = path.extname(src).toLowerCase() || '.png'
    const filename = `${uuid()}${ext}`
    const destAbs = path.join(destDir, filename)
    fs.copyFileSync(src, destAbs)

    const relative = `static/assets/imported/${filename}`
    const thumb = await ensureThumbnail(relative)
    const ts = now()

    db.update(schema.assets)
      .set({
        url: relative,
        localPath: relative,
        thumbnailUrl: thumb || thumbPathForSource(relative),
        updatedAt: ts,
      })
      .where(eq(schema.assets.id, asset.id))
      .run()

    repaired++
    console.log(`✓ [${asset.type}] ${asset.name}`)

    if (isOssConfigured()) {
      try {
        if (asset.dramaId) {
          await syncProjectAsset(asset.dramaId, relative)
        } else {
          await syncReferenceUploadToOss(relative)
        }
        ossOk++
      } catch (err) {
        console.warn(`  OSS 失败: ${asset.name}`, err?.message || err)
      }
    }
  }

  console.log('\n=== 修复完成 ===')
  console.log(JSON.stringify({ total: rows.length, repaired, missing, ossOk }, null, 2))
  if (missing) {
    console.log('\n仍有未匹配源文件的条目，请确认原始资产包路径后重试：')
    console.log('  npx tsx scripts/repair-import-assets.mjs <你的资产包目录>')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
