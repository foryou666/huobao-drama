import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.resolve(__dirname, '../../data/huobao_drama.db')
const db = new Database(dbPath)

const configs = db.prepare(`
  SELECT id, name, provider, base_url, model, is_active,
         CASE WHEN api_key IS NOT NULL AND length(trim(api_key)) > 0 THEN 1 ELSE 0 END AS has_key
  FROM ai_service_configs WHERE service_type = 'video'
`).all()

console.log('=== Video configs ===')
for (const c of configs) {
  let models = []
  try { models = JSON.parse(c.model || '[]') } catch { models = [c.model] }
  console.log(`#${c.id} ${c.name} | ${c.provider} | active=${c.is_active} | key=${c.has_key ? 'yes' : 'NO'}`)
  console.log(`   url: ${c.base_url}`)
  console.log(`   model used: ${models[0] || '(empty)'}`)
}

const pick = configs.find(c => c.is_active && c.has_key) || configs.find(c => c.has_key)
if (!pick) {
  console.error('\nNo video config with API key found.')
  process.exit(1)
}

let model = ''
try {
  const models = JSON.parse(pick.model || '[]')
  model = models[0] || ''
} catch {
  model = pick.model || ''
}

const base = 'http://localhost:5679/api/v1'

// 1) Config probe (same as settings test)
console.log('\n=== Probe (settings test equivalent) ===')
const probeRes = await fetch(`${base}/ai-configs/test`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    service_type: 'video',
    provider: pick.provider,
    base_url: pick.base_url,
    model: [model],
    api_key: db.prepare('SELECT api_key FROM ai_service_configs WHERE id = ?').get(pick.id).api_key,
  }),
})
const probeJson = await probeRes.json()
console.log('probe:', JSON.stringify(probeJson.data || probeJson, null, 2))

// 2) Real video generation
console.log('\n=== Submit video generation ===')
const genRes = await fetch(`${base}/videos`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'A golden cat slowly blinks, soft wind in fur, cinematic close-up, warm lighting, no text',
    config_id: pick.id,
    duration: 5,
    aspect_ratio: '9:16',
    reference_mode: 'none',
  }),
})
const genJson = await genRes.json()
if (genJson.code >= 400 || !genRes.ok) {
  console.error('generate failed:', JSON.stringify(genJson, null, 2))
  process.exit(1)
}
const genId = genJson.data?.id
console.log('task id:', genId, 'status:', genJson.data?.status)

// 3) Poll up to 3 min
console.log('\n=== Poll status ===')
for (let i = 0; i < 36; i++) {
  await new Promise(r => setTimeout(r, 5000))
  const st = await fetch(`${base}/videos/${genId}`)
  const stJson = await st.json()
  const row = stJson.data
  console.log(`[${i + 1}] status=${row?.status} error=${row?.error_message || row?.error || '-'}`)
  if (row?.status === 'completed') {
    console.log('SUCCESS video_url:', row.video_url || row.local_path || '(see record)')
    process.exit(0)
  }
  if (row?.status === 'failed') {
    console.error('FAILED:', row.error_message || row.error || JSON.stringify(row))
    process.exit(1)
  }
}
console.error('Timeout waiting for video')
process.exit(1)
