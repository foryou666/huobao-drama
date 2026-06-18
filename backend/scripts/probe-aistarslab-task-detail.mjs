import 'dotenv/config'
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

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

const taskIds = [
  'task_221db2e4ac7e4038a6e2c7aba6058a80', // 1255
  'task_f85db52eb76d4c2f891d9b47814c3338', // 1207
  'task_6ae1d8ea5ab7466aa9774dc88f586965', // probe
]

for (const taskId of taskIds) {
  console.log(`\n======== ${taskId} ========`)
  const batch = await fetch(`${base}/openapi/video/task/status/batch`, {
    method: 'POST', headers, body: JSON.stringify({ taskIds: [taskId] }),
  })
  console.log('batch:', await batch.text())

  const get = await fetch(`${base}/newapi/v1/video/generations/${taskId}`, { headers })
  console.log('newapi get:', await get.text())
}

// list openapi tasks if endpoint exists
const list = await fetch(`${base}/openapi/video/task/list?page=1&pageSize=3`, { headers })
console.log('\nlist status:', list.status)
console.log((await list.text()).slice(0, 1500))
