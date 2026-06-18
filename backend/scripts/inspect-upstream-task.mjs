import 'dotenv/config'
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const taskId = process.argv[2] || 'task_0ffdfa0f25aa42c3ad96bb4c1f808b5c'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const db = new Database(path.join(root, 'data', 'huobao_drama.db'), { readonly: true })
const cfg = db.prepare(`
  SELECT api_key, base_url FROM ai_service_configs
  WHERE provider = 'aistarslab' AND is_active = 1 ORDER BY priority DESC LIMIT 1
`).get()

const base = String(cfg.base_url || 'https://api.video.aistarslab.com').replace(/\/+$/, '')
const headers = {
  Authorization: `Bearer ${cfg.api_key}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
}

const newapi = await fetch(`${base}/newapi/v1/video/generations/${taskId}`, { headers })
console.log('=== NewAPI GET ===')
console.log(await newapi.text())

const batch = await fetch(`${base}/openapi/video/task/status/batch`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ taskIds: [taskId] }),
})
console.log('\n=== OpenAPI batch ===')
console.log(await batch.text())
