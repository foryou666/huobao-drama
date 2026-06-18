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
  WHERE provider = 'aistarslab' AND is_active = 1 ORDER BY priority DESC LIMIT 1
`).get()

const apiKey = cfg.api_key
const base = String(cfg.base_url || 'https://api.video.aistarslab.com').replace(/\/+$/, '')
const headers = {
  Authorization: `Bearer ${apiKey}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
}
const img = 'https://picsum.photos/720/1280'

async function create(label, body) {
  const resp = await fetch(`${base}/newapi/v1/video/generations`, {
    method: 'POST', headers, body: JSON.stringify(body),
  })
  const json = await resp.json()
  console.log(`\n=== create ${label} ===`, JSON.stringify(json))
  return json.task_id
}

async function inspect(taskId) {
  await new Promise(r => setTimeout(r, 3000))
  const get = await fetch(`${base}/newapi/v1/video/generations/${taskId}`, { headers })
  console.log('GET newapi:', await get.text())
  const batch = await fetch(`${base}/openapi/video/task/status/batch`, {
    method: 'POST', headers, body: JSON.stringify({ taskIds: [taskId] }),
  })
  console.log('batch:', await batch.text())
}

const textOnly = await create('text only', {
  model: '12:seedance-2.0-720p-fast',
  prompt: '一只猫',
  duration: 5,
  aspect_ratio: '9:16',
})

const withImages = await create('with images', {
  model: '12:seedance-2.0-720p-fast',
  prompt: '@图片1 一只猫',
  duration: 5,
  aspect_ratio: '9:16',
  images: [img],
})

const fullOfficial = await create('full official fields', {
  model: '12:seedance-2.0-720p-fast',
  prompt: '@图片1 一只猫',
  duration: 5,
  aspect_ratio: '9:16',
  seconds: 5,
  size: '9:16',
  resolution: '720p',
  enableSound: true,
  modeType: 'image2video',
  referenceMode: 'reference-to-video',
  images: [img],
})

await inspect(textOnly)
await inspect(withImages)
await inspect(fullOfficial)

// Try openapi task list
const list = await fetch(`${base}/openapi/video/task/list?pageNo=1&pageSize=5`, { headers })
console.log('\nopenapi list:', list.status, (await list.text()).slice(0, 2000))
