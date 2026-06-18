import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const db = new Database(path.join(root, 'data', 'huobao_drama.db'), { readonly: true })
const row = db.prepare(`
  SELECT api_key, base_url FROM ai_service_configs
  WHERE provider = 'aistarslab' AND service_type = 'video' AND is_active = 1
  ORDER BY priority DESC, id DESC LIMIT 1
`).get()

if (!row?.api_key) {
  console.error('No active aistarslab config')
  process.exit(1)
}

const base = String(row.base_url || 'https://api.video.aistarslab.com').replace(/\/+$/, '')
const url = `${base}/openapi/video/task/config`
const resp = await fetch(url, {
  headers: {
    Authorization: `Bearer ${row.api_key}`,
    Accept: 'application/json',
  },
})
const text = await resp.text()
console.log('HTTP', resp.status)
console.log(text)
