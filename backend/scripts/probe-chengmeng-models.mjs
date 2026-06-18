import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const db = new Database(path.join(root, 'data', 'huobao_drama.db'), { readonly: true })
const row = db.prepare(`
  SELECT api_key, base_url FROM ai_service_configs
  WHERE provider = 'chengmeng' AND is_active = 1
  ORDER BY priority DESC, id DESC LIMIT 1
`).get()

if (!row?.api_key) {
  console.error('No active chengmeng config')
  process.exit(1)
}

const base = String(row.base_url || 'https://api.chengmeng.site').replace(/\/+$/, '')
const headers = { Authorization: `Bearer ${row.api_key}`, Accept: 'application/json' }
const paths = [
  '/api/models',
  '/api/model/list',
  '/api/groups',
  '/api/model-groups',
  '/api/user/models',
  '/api/config/models',
  '/api/tasks?page=1&limit=1',
]

for (const p of paths) {
  try {
    const resp = await fetch(`${base}${p}`, { headers })
    const text = await resp.text()
    console.log('\n===', p, resp.status, '===')
    console.log(text.slice(0, 1200))
  } catch (err) {
    console.log('\n===', p, 'ERR ===', err.message)
  }
}
