import 'dotenv/config'
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { normalizeAistarslabContentRefs, buildAistarslabNewApiTaskPayload } from '../dist/utils/aistarslab-content.js'

if (process.env.CONFIRM !== '1') {
  console.error('⚠ 此脚本会创建真实上游任务并扣积分。')
  console.error('  若确认执行，请设置环境变量 CONFIRM=1')
  process.exit(1)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const db = new Database(path.join(root, 'data', 'huobao_drama.db'), { readonly: true })
const cfg = db.prepare(`
  SELECT api_key, base_url FROM ai_service_configs
  WHERE provider = 'aistarslab' AND is_active = 1 ORDER BY priority DESC LIMIT 1
`).get()
const row = db.prepare('SELECT * FROM video_generations WHERE id = 1255').get()

const apiKey = cfg.api_key
const base = String(cfg.base_url || 'https://api.video.aistarslab.com').replace(/\/+$/, '')
const headers = {
  Authorization: `Bearer ${apiKey}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
}

const resolved = await normalizeAistarslabContentRefs(row.reference_payload)
const current = buildAistarslabNewApiTaskPayload({
  channel: row.style || '12',
  model: row.model,
  prompt: row.prompt.slice(0, 200),
  seconds: row.duration,
  aspectRatio: row.aspect_ratio,
  referenceMode: row.reference_mode,
  contentRefs: resolved,
})

const images = current.images
const url = `${base}/newapi/v1/video/generations`

async function post(label, body) {
  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await resp.text()
  console.log(`\n=== ${label} ===`)
  console.log('Status:', resp.status)
  console.log(text.slice(0, 500))
  return text
}

// Current format
await post('current NewAPI', current)

// Official web UI shape (OpenAPI fields) on NewAPI endpoint
await post('official UI shape on NewAPI', {
  channel: '12',
  model: 'seedance-2.0-720p-fast',
  resolution: '720p',
  prompt: current.prompt,
  seconds: 15,
  size: '9:16',
  enableSound: true,
  images,
})

// OpenAPI imagesJson shape on NewAPI
await post('imagesJson on NewAPI', {
  channel: '12',
  model: 'seedance-2.0-720p-fast',
  prompt: current.prompt,
  seconds: 15,
  size: '9:16',
  referenceMode: 'reference-to-video',
  modeType: 'image2video',
  imagesJson: JSON.stringify(images),
  videosJson: '[]',
  audiosJson: '[]',
})

// Poll task to see stored imagesJson
const taskId = JSON.parse(await post('official UI shape task', {
  channel: '12',
  model: 'seedance-2.0-720p-fast',
  resolution: '720p',
  prompt: '@图片1 test',
  seconds: 5,
  size: '9:16',
  enableSound: true,
  images: images.slice(0, 1),
})).task_id

if (taskId) {
  const poll = await fetch(`${base}/openapi/video/task/status/batch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ taskIds: [taskId] }),
  })
  console.log('\n=== poll stored task ===')
  console.log(await poll.text())
}
