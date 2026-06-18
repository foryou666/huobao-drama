import 'dotenv/config'
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

if (process.env.CONFIRM !== '1') {
  console.error('⚠ 此脚本会创建真实上游任务并扣积分。')
  console.error('  若确认执行，请设置环境变量 CONFIRM=1')
  process.exit(1)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const db = new Database(path.join(root, 'data', 'huobao_drama.db'), { readonly: true })
const cfg = db.prepare(`
  SELECT api_key, base_url FROM ai_service_configs
  WHERE provider = 'aistarslab' AND is_active = 1
  ORDER BY priority DESC LIMIT 1
`).get()

if (!cfg?.api_key) {
  console.error('No aistarslab config')
  process.exit(1)
}

const apiKey = cfg.api_key
const base = String(cfg.base_url || 'https://api.video.aistarslab.com').replace(/\/+$/, '')
const headers = {
  Authorization: `Bearer ${apiKey}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
}

async function post(label, url, body) {
  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await resp.text()
  console.log(`\n=== ${label} ===`)
  console.log('Status:', resp.status)
  console.log(text.slice(0, 800))
}

await post('OpenAPI create (deprecated?)', `${base}/openapi/video/task`, {
  channel: '12',
  model: 'seedance-2.0-720p-fast',
  prompt: 'test',
  seconds: 5,
  size: '9:16',
  referenceMode: 'reference-to-video',
  modeType: 'text2video',
  imagesJson: '[]',
  videosJson: '[]',
  audiosJson: '[]',
})

await post('NewAPI text2video', `${base}/newapi/v1/video/generations`, {
  model: '12:seedance-2.0-720p-fast',
  prompt: '一只猫在草地上',
  duration: 5,
  aspect_ratio: '9:16',
})

await post('NewAPI image2video', `${base}/newapi/v1/video/generations`, {
  model: '12:seedance-2.0-720p-fast',
  prompt: '@图片1 一只猫',
  duration: 5,
  aspect_ratio: '9:16',
  images: ['https://picsum.photos/720/1280'],
})

const taskId = 'task_75331094e17a463a86a462011fb6b5a3'

async function req(label, method, url, body) {
  const resp = await fetch(url, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await resp.text()
  console.log(`\n=== ${label} ===`)
  console.log('Status:', resp.status)
  console.log(text.slice(0, 800))
}

await req('NewAPI GET task', 'GET', `${base}/newapi/v1/video/generations/${taskId}`)
await req('OpenAPI batch poll string id', 'POST', `${base}/openapi/video/task/status/batch`, { taskIds: [taskId] })
