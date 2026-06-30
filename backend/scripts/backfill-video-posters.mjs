/**
 * 为已有视频批量生成列表封面图
 *
 *   npx tsx scripts/backfill-video-posters.mjs
 *   npx tsx scripts/backfill-video-posters.mjs --dry-run
 *   npx tsx scripts/backfill-video-posters.mjs --limit 20
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { db, schema } from '../src/db/index.js'
import { like, isNotNull } from 'drizzle-orm'
import { ensureVideoPoster, videoPosterExists, isVideoStaticPath } from '../src/utils/video-poster.js'
import { getAbsolutePath } from '../src/utils/storage.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../data/static')

const dryRun = process.argv.includes('--dry-run')
const limitArg = process.argv.find(a => a.startsWith('--limit='))
  || (process.argv.includes('--limit') ? `--limit=${process.argv[process.argv.indexOf('--limit') + 1]}` : null)
const limit = limitArg ? Number(limitArg.split('=')[1]) : 0

function walkVideos(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name)
    const stat = fs.statSync(abs)
    if (!stat.isFile()) continue
    const rel = path.relative(path.join(STORAGE_ROOT, '..'), abs).split(path.sep).join('/')
    if (isVideoStaticPath(rel)) out.push(rel)
  }
  return out
}

async function main() {
  console.log('=== 视频封面批量生成 ===', { dryRun, limit: limit || 'none' })

  const fromDb = db.select({ localPath: schema.videoGenerations.localPath })
    .from(schema.videoGenerations)
    .where(isNotNull(schema.videoGenerations.localPath))
    .all()
    .map(r => String(r.localPath || '').trim())
    .filter(p => isVideoStaticPath(p))

  const fromDisk = walkVideos(path.join(STORAGE_ROOT, 'videos'))
  const paths = [...new Set([...fromDb, ...fromDisk])]
  console.log(`待处理视频: ${paths.length}`)

  let generated = 0
  let skipped = 0
  let failed = 0

  for (const localPath of paths) {
    if (limit > 0 && generated + failed >= limit) break
    if (!fs.existsSync(getAbsolutePath(localPath))) {
      skipped++
      continue
    }
    if (videoPosterExists(localPath)) {
      skipped++
      continue
    }
    if (dryRun) {
      console.log('[dry-run]', localPath)
      generated++
      continue
    }
    try {
      const poster = await ensureVideoPoster(localPath)
      if (poster) {
        generated++
        if (generated % 20 === 0) console.log(`进度 ${generated} … ${poster}`)
      } else {
        failed++
      }
    } catch (err) {
      failed++
      console.warn('fail:', localPath, err?.message || err)
    }
  }

  console.log('\n=== 完成 ===')
  console.log(JSON.stringify({ scanned: paths.length, generated, skipped, failed }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
