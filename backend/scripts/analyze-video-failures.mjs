import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/huobao_drama.db')
const db = new Database(dbPath, { readonly: true })

const days = Number(process.argv[2] || 3)
const since = new Date(Date.now() - days * 24 * 3600 * 1000)
  .toISOString().slice(0, 19).replace('T', ' ')

// Sample distinct error messages
const distinct = db.prepare(`
  SELECT error_msg, COUNT(*) c
  FROM video_generations
  WHERE status = 'failed' AND created_at >= ?
  GROUP BY error_msg
  ORDER BY c DESC
  LIMIT 25
`).all(since)

// High-fail shots
const hotShots = db.prepare(`
  SELECT s.episode_id, e.episode_number, s.storyboard_number, s.location, COUNT(*) c,
         GROUP_CONCAT(DISTINCT substr(v.error_msg, 1, 60)) as errors
  FROM video_generations v
  JOIN storyboards s ON s.id = v.storyboard_id
  JOIN episodes e ON e.id = s.episode_id
  WHERE v.status = 'failed' AND v.created_at >= ?
  GROUP BY v.storyboard_id
  ORDER BY c DESC
  LIMIT 10
`).all(since)

const summary = db.prepare(`
  SELECT status, COUNT(*) c FROM video_generations WHERE created_at >= ? GROUP BY status
`).all(since)

const total = summary.reduce((s, r) => s + r.c, 0)
const failCount = summary.find(r => r.status === 'failed')?.c || 0

console.log(JSON.stringify({
  period_days: days,
  since,
  total,
  failed: failCount,
  fail_rate: total ? `${((failCount / total) * 100).toFixed(1)}%` : '0%',
  distinct_errors: distinct,
  hot_shots: hotShots,
}, null, 2))
