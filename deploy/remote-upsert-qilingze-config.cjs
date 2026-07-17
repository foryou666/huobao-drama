/**
 * upsert 启灵泽图片配置并设为默认通道
 * 用法: QILINGZE_API_KEY=sk-... DB_PATH=... node deploy/remote-upsert-qilingze-config.cjs
 */
const path = require('path')
const backendDir = process.env.BACKEND_DIR || '/opt/hongguoduanju/backend'
const Database = require(path.join(backendDir, 'node_modules', 'better-sqlite3'))

const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/huobao_drama.db')
const KEY = process.env.QILINGZE_API_KEY
if (!KEY) {
  console.error('缺少 QILINGZE_API_KEY')
  process.exit(1)
}

const BASE_URL = 'https://api.qilingze.com'
const MODELS = JSON.stringify(['nano-banana-2', 'gpt-image-2'])
const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)

const db = new Database(dbPath)
const existing = db.prepare(`
  SELECT id FROM ai_service_configs WHERE provider = 'qilingze' AND service_type = 'image'
`).get()

if (existing) {
  db.prepare(`
    UPDATE ai_service_configs
    SET name = ?, base_url = ?, api_key = ?, model = ?,
        priority = 101, is_default = 1, is_active = 1, updated_at = ?
    WHERE id = ?
  `).run('启灵泽-图片', BASE_URL, KEY, MODELS, ts, existing.id)
  console.log('updated qilingze id=', existing.id)
} else {
  const res = db.prepare(`
    INSERT INTO ai_service_configs (
      service_type, provider, name, base_url, api_key, model, priority,
      is_default, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 101, 1, 1, ?, ?)
  `).run('image', 'qilingze', '启灵泽-图片', BASE_URL, KEY, MODELS, ts, ts)
  console.log('inserted qilingze id=', res.lastInsertRowid)
}

// 其他图片通道降为备用
db.prepare(`
  UPDATE ai_service_configs
  SET is_default = 0,
      priority = CASE WHEN priority >= 101 THEN 100 ELSE priority END,
      updated_at = ?
  WHERE service_type = 'image' AND provider != 'qilingze'
`).run(ts)

console.log(JSON.stringify(
  db.prepare(`
    SELECT id, name, provider, base_url, model, priority, is_default, is_active
    FROM ai_service_configs WHERE service_type = 'image' ORDER BY priority DESC, id DESC
  `).all(),
  null,
  2,
))
