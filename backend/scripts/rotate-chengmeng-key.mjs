/**
 * 轮换橙盟视频 API Key：旧 Key 保留在「旧账号」配置，历史任务继续用旧 Key 查询。
 *
 * 用法:
 *   node scripts/rotate-chengmeng-key.mjs "<NEW_API_KEY>"
 * 或:
 *   CHENGMENG_NEW_API_KEY="..." node scripts/rotate-chengmeng-key.mjs
 */
import { migrateChengmengApiKeyIfNeeded } from '../dist/services/chengmeng-migrate.js'

const key = process.argv[2] || process.env.CHENGMENG_NEW_API_KEY || ''
if (!key.trim()) {
  console.error('请提供新 Key：node scripts/rotate-chengmeng-key.mjs "<NEW_API_KEY>"')
  process.exit(1)
}

const result = migrateChengmengApiKeyIfNeeded(key.trim())
console.log(JSON.stringify(result, null, 2))
