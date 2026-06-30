import { performance } from 'node:perf_hooks'
import { listVideoLedger } from '../src/services/video-ledger.ts'
import { db, schema } from '../src/db/index.ts'

const users = db.select().from(schema.users).all()
const user = users.find(u => u.role === 'admin') || users[0]
if (!user) {
  console.log('no user')
  process.exit(1)
}

const t0 = performance.now()
const res = listVideoLedger({
  user: { id: user.id, username: user.username, role: user.role },
  activeTeamId: 1,
  limit: 30,
  offset: 0,
  provider: 'jimeng_web',
  mineOnly: false,
})
const res2 = listVideoLedger({
  user: { id: user.id, username: user.username, role: user.role },
  activeTeamId: 1,
  limit: 30,
  offset: 0,
  mineOnly: true,
})
console.log(JSON.stringify({
  jimeng: { items: res.items.length, total: res.pagination.total, ms: Math.round(performance.now() - t0) },
}))
const t1 = performance.now()
console.log(JSON.stringify({
  mineOnly: { items: res2.items.length, total: res2.pagination.total, ms: Math.round(performance.now() - t1) },
}))
