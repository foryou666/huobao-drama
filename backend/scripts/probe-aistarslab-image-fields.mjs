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
const url = `${base}/newapi/v1/video/generations`
const img = 'https://picsum.photos/720/1280'

async function post(label, body) {
  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await resp.text()
  console.log(`\n=== ${label} ===`)
  console.log('Status:', resp.status)
  console.log(text.slice(0, 600))
}

const models = await fetch(`${base}/newapi/v1/models`, { headers })
console.log('models:', (await models.text()).slice(0, 800))

await post('baseline images[]', {
  model: '12:seedance-2.0-720p-fast',
  prompt: '@图片1 一只猫',
  duration: 5,
  aspect_ratio: '9:16',
  images: [img],
})

await post('+ modeType image2video', {
  model: '12:seedance-2.0-720p-fast',
  prompt: '@图片1 一只猫',
  duration: 5,
  aspect_ratio: '9:16',
  modeType: 'image2video',
  images: [img],
})

await post('+ referenceMode', {
  model: '12:seedance-2.0-720p-fast',
  prompt: '@图片1 一只猫',
  duration: 5,
  aspect_ratio: '9:16',
  referenceMode: 'reference-to-video',
  modeType: 'image2video',
  images: [img],
})

await post('+ seconds/size/resolution/enableSound', {
  model: '12:seedance-2.0-720p-fast',
  prompt: '@图片1 一只猫',
  seconds: 5,
  size: '9:16',
  resolution: '720p',
  enableSound: true,
  modeType: 'image2video',
  referenceMode: 'reference-to-video',
  images: [img],
})

await post('image_urls field', {
  model: '12:seedance-2.0-720p-fast',
  prompt: '@图片1 一只猫',
  duration: 5,
  aspect_ratio: '9:16',
  image_urls: [img],
})

await post('input.images nested', {
  model: '12:seedance-2.0-720p-fast',
  prompt: '@图片1 一只猫',
  duration: 5,
  aspect_ratio: '9:16',
  input: { images: [img] },
})
