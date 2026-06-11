/**
 * 手动切换橙盟视频生成使用的 Key。
 * 正常情况下旧 Key 余额用尽时会自动切到新 Key，无需手动操作。
 *
 * 用法:
 *   node scripts/switch-chengmeng-key.mjs legacy   # 强制用旧 Key
 *   node scripts/switch-chengmeng-key.mjs new        # 强制用新 Key
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const mode = (process.argv[2] || 'legacy').toLowerCase()
const dbPath = process.env.DB_PATH || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/huobao_drama.db')
const db = new Database(dbPath)
const ts = new Date().toISOString()

const rows = db.prepare(
  "SELECT id, name, is_active FROM ai_service_configs WHERE provider='chengmeng' AND service_type='video' ORDER BY id",
).all()

if (rows.length < 2) {
  console.error('未找到两条橙盟视频配置，请先运行 rotate-chengmeng-key.mjs')
  process.exit(1)
}

const legacy = rows[0]
const newer = rows[1]

if (mode === 'new' || mode === 'newer') {
  db.prepare('UPDATE ai_service_configs SET is_active = 0, updated_at = ? WHERE id = ?').run(ts, legacy.id)
  db.prepare('UPDATE ai_service_configs SET is_active = 1, updated_at = ? WHERE id = ?').run(ts, newer.id)
  console.log('已切换为【新账号】生成视频')
} else {
  db.prepare('UPDATE ai_service_configs SET is_active = 1, updated_at = ? WHERE id = ?').run(ts, legacy.id)
  db.prepare('UPDATE ai_service_configs SET is_active = 0, updated_at = ? WHERE id = ?').run(ts, newer.id)
  console.log('已切换为【旧账号余量】生成视频')
}

console.log(db.prepare(
  "SELECT id, name, is_active FROM ai_service_configs WHERE provider='chengmeng' ORDER BY id",
).all())
