import { eq } from 'drizzle-orm'
import { db, schema, getAppMeta, setAppMeta } from '../db/index.js'
import { now } from '../utils/response.js'
import { CHENGMENT_DEFAULT_BASE_URL } from '../constants/chengmeng.js'

const MIGRATION_KEY = 'chengmeng_base_url_v2'

/** 将已保存的 cpolar 临时地址迁移到官方 API 网关 */
export function migrateChengmengBaseUrlIfNeeded() {
  if (getAppMeta(MIGRATION_KEY)) return

  const rows = db.select().from(schema.aiServiceConfigs).all()
  const ts = now()
  let updated = 0
  for (const row of rows) {
    if (row.provider !== 'chengmeng') continue
    const base = String(row.baseUrl || '')
    if (!base.includes('cpolar')) continue
    db.update(schema.aiServiceConfigs)
      .set({ baseUrl: CHENGMENT_DEFAULT_BASE_URL, updatedAt: ts })
      .where(eq(schema.aiServiceConfigs.id, row.id))
      .run()
    updated++
  }
  setAppMeta(MIGRATION_KEY, `${ts}:${updated}`)
}
