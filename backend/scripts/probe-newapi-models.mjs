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

const base = String(cfg.base_url || 'https://api.video.aistarslab.com').replace(/\/+$/, '')
const headers = {
  Authorization: `Bearer ${cfg.api_key}`,
  Accept: 'application/json',
}

for (const pathSuffix of ['/newapi/v1/models', '/newapi/v1/video/models']) {
  const resp = await fetch(`${base}${pathSuffix}`, { headers })
  console.log(`\n=== GET ${pathSuffix} ===`)
  console.log('Status:', resp.status)
  const text = await resp.text()
  console.log(text.slice(0, 3000))
}
