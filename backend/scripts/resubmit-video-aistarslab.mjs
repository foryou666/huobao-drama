import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

if (process.env.CONFIRM !== '1') {
  console.error('⚠ 此脚本会创建真实上游任务并扣积分。')
  console.error('  若确认执行，请设置环境变量 CONFIRM=1')
  process.exit(1)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const db = new Database(path.join(root, 'data', 'huobao_drama.db'))

const sourceId = Number(process.argv[2] || 1162)
const row = db.prepare('SELECT * FROM video_generations WHERE id = ?').get(sourceId)
if (!row) {
  console.error('Record not found:', sourceId)
  process.exit(1)
}

const aistarslabCfg = db.prepare(`
  SELECT id, name, provider, base_url, model, api_key
  FROM ai_service_configs
  WHERE service_type = 'video' AND provider = 'aistarslab' AND is_active = 1
  ORDER BY priority DESC, id DESC LIMIT 1
`).get()

if (!aistarslabCfg?.api_key) {
  console.error('No active aistarslab video config')
  process.exit(1)
}

let models = []
try { models = JSON.parse(aistarslabCfg.model || '[]') } catch { models = [aistarslabCfg.model].filter(Boolean) }
const model = models[0] || 'seedance-2.0-720p-fast'

const payload = {
  prompt: row.prompt,
  aistarslab: true,
  aistarslab_channel: row.style || '12',
  config_id: aistarslabCfg.id,
  model,
  duration: row.duration || 15,
  aspect_ratio: row.aspect_ratio || '9:16',
  drama_id: row.drama_id || undefined,
  reference_mode: 'none',
}

if (row.reference_payload) {
  try {
    payload.content_refs = JSON.parse(row.reference_payload)
  } catch { /* ignore */ }
}
if (row.reference_image_urls) {
  try {
    payload.reference_image_urls = JSON.parse(row.reference_image_urls)
  } catch { /* ignore */ }
}

console.log('Source task #' + sourceId, row.provider, row.model, row.status)
console.log('Resubmit payload:', JSON.stringify({ ...payload, prompt: payload.prompt?.slice(0, 80) + '...' }, null, 2))

const base = process.env.API_BASE || 'http://localhost:5679/api/v1'

// login as admin
const admin = db.prepare(`SELECT username FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`).get()
const loginRes = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: admin.username, password: process.env.ADMIN_PASSWORD || 'admin123' }),
})
const loginJson = await loginRes.json()
const token = loginJson.data?.token
if (!token) {
  console.error('Login failed:', JSON.stringify(loginJson, null, 2))
  process.exit(1)
}
console.log('Logged in as', admin.username)

const genRes = await fetch(`${base}/videos`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify(payload),
})
const genJson = await genRes.json()
console.log('Submit response:', JSON.stringify(genJson, null, 2))
if (genJson.code >= 400 || !genRes.ok) process.exit(1)

const genId = genJson.data?.id
console.log('\nPolling task #' + genId + ' ...')
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 5000))
  const stRes = await fetch(`${base}/videos/${genId}`, { headers: { Authorization: `Bearer ${token}` } })
  const stJson = await stRes.json()
  const task = stJson.data
  console.log(`[${i + 1}] status=${task?.status} error=${task?.error_msg || task?.error_message || '-'}`)
  if (task?.status === 'completed') {
    console.log('SUCCESS:', task.video_url || task.local_path)
    process.exit(0)
  }
  if (task?.status === 'failed') {
    console.error('FAILED:', task.error_msg || task.error_message)
    process.exit(1)
  }
}
console.error('Timeout')
process.exit(1)
