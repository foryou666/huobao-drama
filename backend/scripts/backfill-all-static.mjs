/**
 * 全量将 data/static 下已有文件同步到 OSS 并写入 oss_static_mappings
 *
 *   npx tsx scripts/backfill-all-static.mjs --dry-run
 *   npx tsx scripts/backfill-all-static.mjs --skip-existing
 *   npx tsx scripts/backfill-all-static.mjs --limit 50
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { isOssConfigured } from '../src/utils/oss-upload.js'
import { trySyncStaticToOss } from '../src/utils/oss-entity-sync.js'
import { lookupOssObjectKey } from '../src/utils/oss-upload.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../data/static')

const dryRun = process.argv.includes('--dry-run')
const skipExisting = process.argv.includes('--skip-existing')
const limitArg = process.argv.find(a => a.startsWith('--limit='))
  || (process.argv.includes('--limit') ? `--limit=${process.argv[process.argv.indexOf('--limit') + 1]}` : null)
const limit = limitArg ? Number(limitArg.split('=')[1]) : 0

const SKIP_DIR_RE = /[/\\]thumbs?[/\\]/i
const SKIP_FILE_RE = /_thumb\.[a-z0-9]+$/i

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name)
    const stat = fs.statSync(abs)
    if (stat.isDirectory()) {
      if (SKIP_DIR_RE.test(abs)) continue
      walkFiles(abs, out)
      continue
    }
    if (!stat.isFile() || stat.size <= 0) continue
    if (SKIP_FILE_RE.test(name)) continue
    const rel = path.relative(path.join(STORAGE_ROOT, '..'), abs).split(path.sep).join('/')
    if (!rel.startsWith('static/')) continue
    out.push(rel)
  }
  return out
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

async function main() {
  console.log('=== 全量 static → OSS 回填 ===')
  console.log('STORAGE_ROOT:', STORAGE_ROOT)
  console.log('dryRun:', dryRun, 'skipExisting:', skipExisting, 'limit:', limit || 'none')

  if (!isOssConfigured()) {
    console.error('OSS 未配置，请检查 backend/.env')
    process.exit(1)
  }

  const files = walkFiles(STORAGE_ROOT)
  console.log(`扫描到 ${files.length} 个文件`)

  let uploaded = 0
  let skipped = 0
  let failed = 0
  let bytes = 0
  const started = Date.now()

  for (const localPath of files) {
    if (limit > 0 && uploaded + failed >= limit) break

    const abs = path.join(STORAGE_ROOT, '..', localPath)
    const size = fs.statSync(abs).size

    if (skipExisting && lookupOssObjectKey(localPath)) {
      skipped++
      continue
    }

    if (dryRun) {
      console.log('[dry-run]', localPath, formatBytes(size))
      uploaded++
      bytes += size
      continue
    }

    try {
      const key = await trySyncStaticToOss(localPath)
      if (key) {
        uploaded++
        bytes += size
        if (uploaded % 20 === 0) {
          console.log(`进度 ${uploaded}/${files.length} … 最近: ${localPath}`)
        }
      } else {
        skipped++
      }
    } catch (err) {
      failed++
      console.warn('fail:', localPath, err?.message || err)
    }
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log('\n=== 完成 ===')
  console.log(JSON.stringify({
    scanned: files.length,
    uploaded,
    skipped,
    failed,
    bytes: formatBytes(bytes),
    elapsedSec: elapsed,
  }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
