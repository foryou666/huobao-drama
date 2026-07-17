/**
 * upsert 花镜 NewAPI 图片配置（CommonJS，在服务器 backend 目录执行）
 * 用法: HUAJING_API_KEY=sk-... DB_PATH=... node deploy/remote-upsert-huajing-image-config.cjs
 */
const path = require('path')
const backendDir = process.env.BACKEND_DIR || '/opt/hongguoduanju/backend'
const Database = require(path.join(backendDir, 'node_modules', 'better-sqlite3'))

const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/huobao_drama.db')
const KEY = process.env.HUAJING_API_KEY
if (!KEY) {
  console.error('缺少 HUAJING_API_KEY')
  process.exit(1)
}

const BASE_URL = 'https://huajingapi.top'
// Image-2 在花镜为异步 queued 且无可用轮询接口；gpt-image2-Pro 同步返回 URL
const MODELS = JSON.stringify(['gpt-image2-Pro'])
const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)

const db = new Database(dbPath)

// 优先复用已有 huajing 域名的 chatfire 图片配置
let existing = db.prepare(`
  SELECT id FROM ai_service_configs
  WHERE service_type = 'image' AND (base_url LIKE '%huajingapi.top%' OR name LIKE '%花镜%')
  ORDER BY id ASC
  LIMIT 1
`).get()

if (!existing) {
  existing = db.prepare(`
    SELECT id FROM ai_service_configs
    WHERE service_type = 'image' AND provider = 'chatfire'
    ORDER BY id ASC
    LIMIT 1
  `).get()
}

if (existing) {
  db.prepare(`
    UPDATE ai_service_configs
    SET name = ?, provider = ?, base_url = ?, api_key = ?, model = ?,
        priority = 101, is_default = 1, is_active = 1, updated_at = ?
    WHERE id = ?
  `).run('花镜-图片', 'chatfire', BASE_URL, KEY, MODELS, ts, existing.id)
  console.log('updated huajing image config id=', existing.id)
} else {
  const res = db.prepare(`
    INSERT INTO ai_service_configs (
      service_type, provider, name, base_url, api_key, model, priority,
      is_default, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 101, 1, 1, ?, ?)
  `).run('image', 'chatfire', '花镜-图片', BASE_URL, KEY, MODELS, ts, ts)
  console.log('inserted huajing image config id=', res.lastInsertRowid)
}

// 启灵泽保留为备用，不再作为默认
db.prepare(`
  UPDATE ai_service_configs
  SET is_default = 0, priority = CASE WHEN priority > 100 THEN 100 ELSE priority END, updated_at = ?
  WHERE service_type = 'image' AND provider = 'qilingze'
`).run(ts)

console.log(JSON.stringify(
  db.prepare(`
    SELECT id, name, provider, base_url, model, priority, is_default, is_active
    FROM ai_service_configs WHERE service_type = 'image' ORDER BY priority DESC, id DESC
  `).all(),
  null,
  2,
))
