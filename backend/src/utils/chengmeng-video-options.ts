import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { isChengmengProvider } from '../constants/chengmeng.js'
import { getConfigById } from '../services/ai.js'

export function listChengmengVideoConfigRows() {
  return db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, 'video'))
    .all()
    .filter(row => isChengmengProvider(row.provider))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (a.id || 0) - (b.id || 0))
}

export function findChengmengVideoConfigRow() {
  const rows = listChengmengVideoConfigRows()
  return rows.find(row => row.isActive) || rows[0] || null
}

export function findChengmengVideoConfig() {
  const row = findChengmengVideoConfigRow()
  return row ? getConfigById(row.id, { includeInactive: true }) : null
}
