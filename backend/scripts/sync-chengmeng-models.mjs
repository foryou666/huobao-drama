/**
 * 从橙盟 /api/models 同步通道1 线路与积分定价（线上/本地均可运行）
 * 用法: cd backend && npx tsx scripts/sync-chengmeng-models.mjs
 */
import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db, schema } from '../src/db/index.js'
import { now } from '../src/utils/response.js'
import {
  findChengmengVideoConfigRow,
  getChengmengVideoModelOptions,
  pickChengmengChannel1UiModels,
  syncChengmengModelCreditPricing,
  listChengmengModelOptionsForApi,
} from '../src/utils/chengmeng-video-options.js'
import { getActionCost } from '../src/services/credits.js'
import { CHENGMENT_DEFAULT_MODEL_ID } from '../src/constants/chengmeng.js'
import {
  isChengmengModelWithinChannel1UpstreamBudget,
  resolveChengmengUpstreamYuanPer15Seconds,
} from '../src/utils/chengmeng-video-options.js'
import { setChengmengModelEnabled } from '../src/utils/chengmeng-model-settings.js'

const row = findChengmengVideoConfigRow()
if (!row?.apiKey) {
  console.error('未找到有效的橙盟（chengmeng）视频配置')
  process.exit(1)
}

console.log(`配置 #${row.id} ${row.name}`)
console.log(`Base URL: ${row.baseUrl || 'https://api.chengmeng.site'}`)

const remote = await getChengmengVideoModelOptions(row, { refresh: true })
if (!remote.length) {
  console.error('上游未返回任何模型')
  process.exit(1)
}

syncChengmengModelCreditPricing(remote)

for (const item of remote) {
  setChengmengModelEnabled(item.id, isChengmengModelWithinChannel1UpstreamBudget(item))
}

const uiModels = pickChengmengChannel1UiModels(remote)
const defaultModel = uiModels.find(item => item.defaultOption) || uiModels[0] || remote[0]
const modelIds = remote.map(item => item.modelId)
const ts = now()

db.update(schema.aiServiceConfigs)
  .set({
    model: JSON.stringify(modelIds),
    updatedAt: ts,
  })
  .where(eq(schema.aiServiceConfigs.id, row.id))
  .run()

console.log(`\n上游共 ${remote.length} 个 model_id，已写入 ai_service_configs.model`)
console.log(`前台展示 ${uiModels.length} 个（启用且 15 秒成本 ≤ 5 元）`)
console.log(`默认模型: ${defaultModel?.modelId || CHENGMENT_DEFAULT_MODEL_ID}\n`)

for (const item of remote) {
  const inUi = uiModels.some(m => m.id === item.id)
  const cost = getActionCost(item.creditAction, 1)
  const upstreamYuan15 = resolveChengmengUpstreamYuanPer15Seconds(item)
  const upstream = item.basePriceYuan != null
    ? `${item.basePriceYuan}${item.unitLabel || '元'}${upstreamYuan15 != null ? `（≈${upstreamYuan15}元/15秒）` : ''}`
    : '价格未知'
  const hideReason = !inUi && upstreamYuan15 != null && upstreamYuan15 > 5
    ? '，超5元/15秒'
    : !inUi && (upstreamYuan15 == null || upstreamYuan15 <= 0)
      ? '，无有效上游价'
      : ''
  console.log(`  [${inUi ? '展示' : '隐藏'}] ${item.id} ${item.label} · 上游 ${upstream}${hideReason} · 用户 ${cost} 积分/条`)
}

const apiList = listChengmengModelOptionsForApi(uiModels, row.id)
console.log('\n通道1 API 模型列表:')
for (const item of apiList) {
  console.log(`  ${item.model_id} ${item.label} · ${item.credit_cost_flat} 积分/条`)
}

console.log('\n同步完成')
