/**
 * 从 APIMart 上游补救拉取 #1263–#1269 已完成的图片（轮询 URL bug 导致未落库）
 * 用法: node deploy/recover-apimart-studio-images.cjs
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const Database = require(path.join('/opt/hongguoduanju/backend/node_modules/better-sqlite3'))

const DB_PATH = '/opt/hongguoduanju/data/huobao_drama.db'
const STORAGE_ROOT = '/opt/hongguoduanju/data/static'

const RECOVER = [
  { id: 1263, taskId: 'task_01KWYA4R9P087DRA1KGHE7HQA6' },
  { id: 1264, taskId: 'task_01KWYADC32XCTGDZTNNTQPVGGM' },
  { id: 1265, taskId: 'task_01KWYANFRPXGJVPZFWQPG14D7X' },
  { id: 1266, taskId: 'task_01KWYARG2BKF394QEM9CTXSW7E' },
  { id: 1267, taskId: 'task_01KWYB0QZ4V6R1ARXRQPW6XXCC' },
  { id: 1268, taskId: 'task_01KWYB24W8277WED6YS4DQYDJC' },
  { id: 1269, taskId: 'task_01KWYB5EF9X1VMS4QMEGPHFVJZ' },
]

function now() {
  return new Date().toISOString()
}

function extractImageUrl(result) {
  const data = result?.data || result
  const images = data?.result?.images
  if (!Array.isArray(images) || !images.length) return null
  const urlField = images[0]?.url
  if (Array.isArray(urlField)) return urlField[0] || null
  return typeof urlField === 'string' ? urlField : null
}

async function fetchApimartTask(baseUrl, apiKey, taskId) {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/v1/tasks/${taskId}`)
  url.searchParams.set('language', 'zh')
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(60_000),
  })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { raw: text.slice(0, 500) }
  }
  if (!res.ok) {
    throw new Error(`APIMart poll HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  return body
}

async function downloadImage(url, subDir) {
  const dir = path.join(STORAGE_ROOT, subDir)
  fs.mkdirSync(dir, { recursive: true })
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`Download HTTP ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const ext = path.extname(new URL(url).pathname) || '.png'
  const filename = `${crypto.randomUUID()}${ext}`
  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, buffer)
  return `static/${subDir}/${filename}`
}

async function main() {
  const db = new Database(DB_PATH)
  const cfg = db.prepare(`
    SELECT api_key, base_url, model
    FROM ai_service_configs
    WHERE id = 12 AND provider = 'apimart'
  `).get()
  if (!cfg?.api_key) {
    throw new Error('APIMart config id=12 not found')
  }

  const update = db.prepare(`
    UPDATE image_generations
    SET provider = 'apimart',
        model = 'gpt-image-2',
        task_id = @taskId,
        status = 'completed',
        image_url = @imageUrl,
        local_path = @localPath,
        error_msg = '',
        updated_at = @updatedAt,
        completed_at = @completedAt
    WHERE id = @id
  `)

  const results = []
  for (const item of RECOVER) {
    const record = db.prepare('SELECT id, status, local_path FROM image_generations WHERE id = ?').get(item.id)
    if (!record) {
      results.push({ id: item.id, ok: false, error: 'record not found' })
      continue
    }

    try {
      const body = await fetchApimartTask(cfg.base_url, cfg.api_key, item.taskId)
      const status = String(body?.data?.status || '').toLowerCase()
      const imageUrl = extractImageUrl(body)
      if (status !== 'completed' || !imageUrl) {
        results.push({
          id: item.id,
          ok: false,
          taskId: item.taskId,
          upstreamStatus: status,
          error: 'upstream not completed or missing image URL',
        })
        continue
      }

      const localPath = await downloadImage(imageUrl, 'images')
      const ts = now()
      update.run({
        id: item.id,
        taskId: item.taskId,
        imageUrl,
        localPath,
        updatedAt: ts,
        completedAt: ts,
      })
      results.push({
        id: item.id,
        ok: true,
        taskId: item.taskId,
        previousStatus: record.status,
        previousLocalPath: record.local_path,
        localPath,
        imageUrl,
      })
    } catch (err) {
      results.push({
        id: item.id,
        ok: false,
        taskId: item.taskId,
        error: String(err?.message || err),
      })
    }
  }

  console.log(JSON.stringify({ recovered: results.filter(r => r.ok).length, total: RECOVER.length, results }, null, 2))
  db.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
