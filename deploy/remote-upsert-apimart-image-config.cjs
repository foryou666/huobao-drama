/**
 * upsert APIMart 图片配置并设为默认通道
 * 用法: APIMART_API_KEY=sk-... DB_PATH=... node deploy/remote-upsert-apimart-image-config.cjs
 */
const path = require('path')
const backendDir = process.env.BACKEND_DIR || '/opt/hongguoduanju/backend'
const Database = require(path.join(backendDir, 'node_modules', 'better-sqlite3'))

const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/huobao_drama.db')
const KEY = process.env.APIMART_API_KEY
if (!KEY) {
  console.error('缺少 APIMART_API_KEY')
  process.exit(1)
}

const BASE_URL = 'https://api.apib.ai'
const MODELS = JSON.stringify(['gpt-image-2'])
const SETTINGS = JSON.stringify({
  mirror_hosts: ['apib.ai', 'aiuxu.com', 'aishuch.com'],
  mirror_base_urls: [
    'https://api.apib.ai',
    'https://api.aiuxu.com',
    'https://api.aishuch.com',
    'https://api.apimart.ai',
  ],
  default_resolution: '1k',
})
const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)

const db = new Database(dbPath)
const existing = db.prepare(`
  SELECT id FROM ai_service_configs
  WHERE provider = 'apimart' AND service_type = 'image'
`).get()

if (existing) {
  db.prepare(`
    UPDATE ai_service_configs
    SET name = ?, base_url = ?, api_key = ?, model = ?, settings = ?,
        priority = 102, is_default = 1, is_active = 1, updated_at = ?
    WHERE id = ?
  `).run('APIMart-图片', BASE_URL, KEY, MODELS, SETTINGS, ts, existing.id)
  console.log('updated apimart id=', existing.id)
} else {
  const res = db.prepare(`
    INSERT INTO ai_service_configs (
      service_type, provider, name, base_url, api_key, model, settings, priority,
      is_default, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 102, 1, 1, ?, ?)
  `).run('image', 'apimart', 'APIMart-图片', BASE_URL, KEY, MODELS, SETTINGS, ts, ts)
  console.log('inserted apimart id=', res.lastInsertRowid)
}

db.prepare(`
  UPDATE ai_service_configs
  SET is_default = 0,
      priority = CASE WHEN priority >= 102 THEN 101 ELSE priority END,
      updated_at = ?
  WHERE service_type = 'image' AND provider != 'apimart'
`).run(ts)

console.log(JSON.stringify(
  db.prepare(`
    SELECT id, name, provider, base_url, model, priority, is_default, is_active
    FROM ai_service_configs WHERE service_type = 'image' ORDER BY priority DESC, id DESC
  `).all(),
  null,
  2,
))
