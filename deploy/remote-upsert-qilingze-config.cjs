/**
 * 仅 upsert 启灵泽图片配置（CommonJS，在服务器 backend 目录执行）
 */
const path = require('path')
const backendDir = process.env.BACKEND_DIR || '/opt/hongguoduanju/backend'
const Database = require(path.join(backendDir, 'node_modules', 'better-sqlite3'))

const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/huobao_drama.db')
const KEY = process.env.QILINGZE_API_KEY || 'sk-G1k0RJy5be1ZtBKmhkIf6bIh9jzUp3w3oWl54N7mEoif74Yb'
const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)

const db = new Database(dbPath)
const existing = db.prepare(`
  SELECT id FROM ai_service_configs WHERE provider = 'qilingze' AND service_type = 'image'
`).get()

if (existing) {
  db.prepare(`
    UPDATE ai_service_configs
    SET name = ?, base_url = ?, api_key = ?, model = ?,
        priority = 100, is_default = 1, is_active = 1, updated_at = ?
    WHERE id = ?
  `).run(
    '启灵泽-图片',
    'https://api.qilingze.com',
    KEY,
    JSON.stringify(['gpt-image-2', 'nano-banana-2']),
    ts,
    existing.id,
  )
  console.log('updated qilingze id=', existing.id)
} else {
  const res = db.prepare(`
    INSERT INTO ai_service_configs (
      service_type, provider, name, base_url, api_key, model, priority,
      is_default, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 100, 1, 1, ?, ?)
  `).run(
    'image',
    'qilingze',
    '启灵泽-图片',
    'https://api.qilingze.com',
    KEY,
    JSON.stringify(['gpt-image-2', 'nano-banana-2']),
    ts,
    ts,
  )
  console.log('inserted qilingze id=', res.lastInsertRowid)
}

console.log(JSON.stringify(
  db.prepare(`
    SELECT id, name, provider, priority, is_default, is_active
    FROM ai_service_configs WHERE service_type = 'image' ORDER BY priority DESC
  `).all(),
  null,
  2,
))
