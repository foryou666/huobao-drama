/**
 * 将误存为 .bin 的 MP4 视频重命名为 .mp4，并更新数据库与 OSS 映射
 *
 *   npx tsx scripts/rename-bin-videos.mjs
 *   npx tsx scripts/rename-bin-videos.mjs --dry-run
 */
import 'dotenv/config'
import fs from 'fs'
import { eq, like, or, sql } from 'drizzle-orm'
import { db, schema } from '../src/db/index.js'
import { getAbsolutePath } from '../src/utils/storage.js'
import { trySyncStaticToOss } from '../src/utils/oss-entity-sync.js'
import { now } from '../src/utils/response.js'

const dryRun = process.argv.includes('--dry-run')

function norm(raw) {
  return String(raw || '').trim().replace(/^\/+/, '')
}

function isMp4Buffer(buf) {
  return buf.length >= 12 && buf.slice(4, 8).toString('ascii') === 'ftyp'
}

function pathVariants(p) {
  const normalized = norm(p)
  if (!normalized) return []
  const withSlash = normalized.startsWith('static/') ? `/${normalized}` : normalized
  const withoutSlash = normalized.startsWith('/') ? normalized.slice(1) : normalized
  return [...new Set([normalized, withSlash, withoutSlash])]
}

function replacePathInDb(oldPath, newPath) {
  const ts = now()
  const variants = pathVariants(oldPath)

  for (const variant of variants) {
    db.update(schema.videoGenerations)
      .set({ localPath: newPath, updatedAt: ts })
      .where(eq(schema.videoGenerations.localPath, variant))
      .run()

    db.update(schema.videoGenerations)
      .set({ videoUrl: newPath, updatedAt: ts })
      .where(eq(schema.videoGenerations.videoUrl, variant))
      .run()

    db.update(schema.storyboards)
      .set({ videoUrl: newPath, updatedAt: ts })
      .where(eq(schema.storyboards.videoUrl, variant))
      .run()

    db.update(schema.assets)
      .set({ url: newPath, localPath: newPath, updatedAt: ts })
      .where(or(eq(schema.assets.url, variant), eq(schema.assets.localPath, variant)))
      .run()

    for (const row of db.select().from(schema.ossStaticMappings)
      .where(eq(schema.ossStaticMappings.localPath, variant)).all()) {
      db.delete(schema.ossStaticMappings)
        .where(eq(schema.ossStaticMappings.localPath, row.localPath))
        .run()
    }
  }
}

async function main() {
  const rows = db.select({
    id: schema.videoGenerations.id,
    dramaId: schema.videoGenerations.dramaId,
    localPath: schema.videoGenerations.localPath,
  })
    .from(schema.videoGenerations)
    .where(like(schema.videoGenerations.localPath, '%.bin'))
    .all()

  console.log(`=== 修复 .bin 视频扩展名 === dryRun=${dryRun}`)
  console.log(`待处理: ${rows.length}`)

  let renamed = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    const oldPath = norm(row.localPath)
    if (!oldPath.endsWith('.bin')) {
      skipped++
      continue
    }
    const newPath = oldPath.replace(/\.bin$/i, '.mp4')

    const absOld = getAbsolutePath(oldPath)
    if (!fs.existsSync(absOld)) {
      console.warn('missing file:', oldPath)
      failed++
      continue
    }

    const buf = fs.readFileSync(absOld)
    if (!isMp4Buffer(buf)) {
      console.warn('not mp4, skip:', oldPath)
      skipped++
      continue
    }

    if (dryRun) {
      console.log('[dry-run]', oldPath, '->', newPath)
      renamed++
      continue
    }

    try {
      const absNew = getAbsolutePath(newPath)
      if (absNew !== absOld) {
        if (fs.existsSync(absNew)) fs.unlinkSync(absOld)
        else fs.renameSync(absOld, absNew)
      }
      replacePathInDb(oldPath, newPath)
      await trySyncStaticToOss(newPath, row.dramaId)
      renamed++
      if (renamed % 20 === 0) console.log(`进度 ${renamed}/${rows.length} … ${newPath}`)
    } catch (err) {
      failed++
      console.warn('fail:', oldPath, err?.message || err)
    }
  }

  const remaining = db.select({ c: sql`count(*)` })
    .from(schema.videoGenerations)
    .where(like(schema.videoGenerations.localPath, '%.bin'))
    .all()[0]?.c

  console.log('\n=== 完成 ===')
  console.log(JSON.stringify({ total: rows.length, renamed, skipped, failed, remainingBin: remaining }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
