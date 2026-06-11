/**
 * 批量修复资产库媒体：重同步项目资产、补 OSS 映射、补缩略图
 *
 *   npx tsx scripts/backfill-asset-media.mjs
 *   npx tsx scripts/backfill-asset-media.mjs --oss-only
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { db, schema } from '../src/db/index.js'
import { syncDramaAssets } from '../src/services/asset-library.js'
import { isOssConfigured } from '../src/utils/oss-upload.js'
import {
  syncProjectAsset,
  syncReferenceUploadToOss,
} from '../src/utils/oss-entity-sync.js'
import { getAbsolutePath } from '../src/utils/storage.js'
import { ensureThumbnail } from '../src/utils/thumbnail.js'
import { thumbPathForSource } from '../src/utils/thumbnail.js'
import { isNull, eq } from 'drizzle-orm'
import { now } from '../src/utils/response.js'
import { resolveDramaIdForStaticPath } from '../src/utils/oss-path.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ossOnly = process.argv.includes('--oss-only')

function norm(raw) {
  return String(raw || '').trim().replace(/^\/+/, '')
}

function collectStaticPaths() {
  const paths = new Map()

  const add = (p, meta = {}) => {
    const normalized = norm(p)
    if (!normalized.startsWith('static/')) return
    if (!paths.has(normalized)) paths.set(normalized, meta)
  }

  for (const row of db.select().from(schema.assets).where(isNull(schema.assets.deletedAt)).all()) {
    add(row.url || row.localPath, { dramaId: row.dramaId, assetId: row.id, type: row.type })
    add(row.thumbnailUrl)
  }

  if (!ossOnly) {
    for (const row of db.select().from(schema.characters).where(isNull(schema.characters.deletedAt)).all()) {
      add(row.imageUrl || row.localPath, { dramaId: row.dramaId, characterId: row.id })
    }
    for (const row of db.select().from(schema.scenes).where(isNull(schema.scenes.deletedAt)).all()) {
      add(row.imageUrl || row.localPath, { dramaId: row.dramaId, sceneId: row.id })
    }
    for (const row of db.select().from(schema.props).where(isNull(schema.props.deletedAt)).all()) {
      add(row.imageUrl || row.localPath, { dramaId: row.dramaId, propId: row.id })
    }
  }

  return paths
}

async function backfillOss(paths) {
  if (!isOssConfigured()) {
    console.log('OSS 未配置，跳过 OSS 回填')
    return { uploaded: 0, skipped: paths.size, failed: 0 }
  }

  let uploaded = 0
  let skipped = 0
  let failed = 0

  for (const [p, meta] of paths) {
    const abs = getAbsolutePath(p)
    if (!fs.existsSync(abs)) {
      skipped++
      continue
    }

    const existing = db.select().from(schema.ossStaticMappings)
      .where(eq(schema.ossStaticMappings.localPath, p))
      .all()[0]
    if (existing?.objectKey) {
      skipped++
      continue
    }

    try {
      const dramaId = meta.dramaId || resolveDramaIdForStaticPath(p)
      if (dramaId) {
        await syncProjectAsset(dramaId, p)
      } else if (p.startsWith('static/uploads/')) {
        await syncReferenceUploadToOss(p)
      } else {
        skipped++
        continue
      }
      uploaded++
      console.log('OSS ok:', p)
    } catch (err) {
      failed++
      console.warn('OSS fail:', p, err?.message || err)
    }
  }

  return { uploaded, skipped, failed }
}

async function backfillThumbnails() {
  const assets = db.select().from(schema.assets).where(isNull(schema.assets.deletedAt)).all()
  let updated = 0
  let generated = 0

  for (const asset of assets) {
    const source = norm(asset.url || asset.localPath)
    if (!source || asset.type === 'voice') continue
    const thumb = await ensureThumbnail(source)
    if (!thumb) continue
    generated++
    if (norm(asset.thumbnailUrl) !== thumb) {
      db.update(schema.assets)
        .set({ thumbnailUrl: thumb, updatedAt: now() })
        .where(eq(schema.assets.id, asset.id))
        .run()
      updated++
    }
  }

  return { generated, updated }
}

function resyncDramas() {
  const dramas = db.select({ id: schema.dramas.id, title: schema.dramas.title }).from(schema.dramas).all()
  let total = 0
  for (const drama of dramas) {
    const synced = syncDramaAssets(drama.id)
    total += synced
    console.log(`同步项目 #${drama.id} ${drama.title}: ${synced} 条`)
  }
  return { dramas: dramas.length, synced: total }
}

async function main() {
  console.log('=== 资产库媒体批量修复 ===')

  let syncResult = { dramas: 0, synced: 0 }
  if (!ossOnly) {
    syncResult = resyncDramas()
  }

  const paths = collectStaticPaths()
  console.log(`待处理 static 路径: ${paths.size}`)

  const ossResult = await backfillOss(paths)
  const thumbResult = ossOnly ? { generated: 0, updated: 0 } : await backfillThumbnails()

  const allAssets = db.select().from(schema.assets).where(isNull(schema.assets.deletedAt)).all()
  const mappings = new Set(
    db.select({ localPath: schema.ossStaticMappings.localPath }).from(schema.ossStaticMappings).all()
      .map(row => norm(row.localPath)),
  )
  const after = {
    total: allAssets.length,
    no_path: allAssets.filter(a => !norm(a.url || a.localPath)).length,
    no_oss: allAssets.filter(a => {
      const p = norm(a.url || a.localPath)
      return p && !mappings.has(p)
    }).length,
    with_path: allAssets.filter(a => norm(a.url || a.localPath)).length,
  }

  console.log('\n=== 完成 ===')
  console.log(JSON.stringify({
    syncResult,
    ossResult,
    thumbResult,
    after,
  }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
