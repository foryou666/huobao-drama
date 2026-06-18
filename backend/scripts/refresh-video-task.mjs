import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const id = Number(process.argv[2] || 1170)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const db = new Database(path.join(root, 'data', 'huobao_drama.db'))
const admin = db.prepare(`SELECT username FROM users WHERE role = 'admin' LIMIT 1`).get()
const base = process.env.API_BASE || 'http://localhost:5679/api/v1'

const loginRes = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: admin.username, password: process.env.ADMIN_PASSWORD || 'admin123' }),
})
const token = (await loginRes.json()).data?.token
if (!token) throw new Error('login failed')

async function refresh() {
  const res = await fetch(`${base}/videos/${id}/refresh`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  return res.json()
}

async function getStatus() {
  const res = await fetch(`${base}/videos/${id}`, { headers: { Authorization: `Bearer ${token}` } })
  return res.json()
}

console.log('Refreshing task #' + id)
console.log(JSON.stringify(await refresh(), null, 2))

for (let i = 0; i < 36; i++) {
  await new Promise(r => setTimeout(r, 10000))
  if (i > 0 && i % 3 === 0) await refresh()
  const st = await getStatus()
  const row = st.data
  console.log(`[${i + 1}] status=${row?.status} error=${row?.error_msg || '-'}`)
  if (row?.status === 'completed') {
    console.log('SUCCESS:', row.video_url || row.local_path)
    process.exit(0)
  }
  if (row?.status === 'failed') {
    console.error('FAILED:', row.error_msg)
    process.exit(1)
  }
}
console.error('Timeout')
process.exit(1)
