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

async function post(pathSuffix, body) {
  const resp = await fetch(`${base}${pathSuffix}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await resp.text()
  console.log(`\n=== POST ${pathSuffix} ===`)
  console.log('Status:', resp.status)
  console.log(text.slice(0, 500))
}

const official = {
  channel: '12',
  model: 'seedance-2.0-720p-fast',
  resolution: '720p',
  prompt: '@图片1 test cat',
  seconds: 5,
  size: '9:16',
  enableSound: true,
  images: [img],
}

const openapiJson = {
  channel: '12',
  model: 'seedance-2.0-720p-fast',
  prompt: '@图片1 test cat',
  seconds: 5,
  size: '9:16',
  referenceMode: 'reference-to-video',
  modeType: 'image2video',
  imagesJson: JSON.stringify([img]),
  videosJson: '[]',
  audiosJson: '[]',
}

const newapiHybrid = {
  model: '12:seedance-2.0-720p-fast',
  prompt: '@图片1 test cat',
  duration: 5,
  aspect_ratio: '9:16',
  images: [img],
  imagesJson: JSON.stringify([img]),
  referenceMode: 'reference-to-video',
  modeType: 'image2video',
}

for (const [pathSuffix, body] of [
  ['/openapi/video/task', official],
  ['/openapi/video/task', openapiJson],
  ['/openapi/v2/video/task', official],
  ['/openapi/video/task/create', official],
  ['/newapi/v1/video/generations', newapiHybrid],
]) {
  await post(pathSuffix, body)
}
