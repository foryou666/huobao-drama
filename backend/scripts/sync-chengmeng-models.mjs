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
import {
  CHENGMENT_DEFAULT_MODEL_ID,
  CHENGMENG_CHANNEL1_PREFERRED_MODEL_IDS,
  isChengmengChannel1PreferredModel,
} from '../src/constants/chengmeng.js'
import {
  isChengmengModelWithinChannel1UpstreamBudget,
  resolveChengmengUpstreamYuanPer15Seconds,
} from '../src/utils/chengmeng-video-options.js'
import { setChengmengModelEnabled } from '../src/utils/chengmeng-model-settings.js'

const RETIRED_UI_IDS = ['90', '83', '71', '82', '70', '77']

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

const remoteIds = new Set(remote.map(item => item.id))
for (const item of remote) {
  // 首选开通线路始终启用；其余仍按 15 秒上游预算筛选
  const enabled = isChengmengChannel1PreferredModel(item.id)
    || isChengmengModelWithinChannel1UpstreamBudget(item)
  setChengmengModelEnabled(item.id, enabled)
}
// 上游已下线的旧线路：禁用，避免设置页残留启用状态
for (const id of RETIRED_UI_IDS) {
  if (!remoteIds.has(id)) setChengmengModelEnabled(id, false)
}

const uiModels = pickChengmengChannel1UiModels(remote)
const defaultModel = uiModels.find(item => item.defaultOption) || uiModels[0] || remote[0]
// 配置里优先写当前开通线路，再补上其余上游线路
const modelIds = [
  ...CHENGMENG_CHANNEL1_PREFERRED_MODEL_IDS.filter(id => remoteIds.has(id)),
  ...remote.map(item => item.modelId).filter(id => !CHENGMENG_CHANNEL1_PREFERRED_MODEL_IDS.includes(id)),
]
const ts = now()

db.update(schema.aiServiceConfigs)
  .set({
    model: JSON.stringify(modelIds),
    updatedAt: ts,
  })
  .where(eq(schema.aiServiceConfigs.id, row.id))
  .run()

console.log(`\n上游共 ${remote.length} 个 model_id，已写入 ai_service_configs.model`)
console.log(`前台展示 ${uiModels.length} 个（首选开通且上游在线）`)
console.log(`默认模型: ${defaultModel?.modelId || CHENGMENT_DEFAULT_MODEL_ID}\n`)
console.log(`离线首选: ${CHENGMENG_CHANNEL1_PREFERRED_MODEL_IDS.filter(id => !remoteIds.has(id)).join(', ') || '无'}`)
console.log(`上游有但非首选: ${[...remoteIds].filter(id => !isChengmengChannel1PreferredModel(id)).join(', ') || '无'}\n`)

for (const item of remote) {
  const inUi = uiModels.some(m => m.id === item.id)
  const cost = getActionCost(item.creditAction, 1)
  const perSecond = String(item.unitLabel || '').includes('秒')
  const upstreamYuan15 = resolveChengmengUpstreamYuanPer15Seconds(item)
  const upstream = item.basePriceYuan != null
    ? `${item.basePriceYuan}${item.unitLabel || '元'}${upstreamYuan15 != null ? `（≈${upstreamYuan15}元/15秒）` : ''}`
    : '价格未知'
  const hideReason = !inUi && upstreamYuan15 != null && upstreamYuan15 > 5
    ? '，超5元/15秒'
    : !inUi && (upstreamYuan15 == null || upstreamYuan15 <= 0)
      ? '，无有效上游价'
      : ''
  const userPrice = perSecond ? `${cost} 积分/秒` : `${cost} 积分/条`
  console.log(`  [${inUi ? '展示' : '隐藏'}] ${item.id} ${item.label} · 上游 ${upstream}${hideReason} · 用户 ${userPrice}`)
}

const apiList = listChengmengModelOptionsForApi(uiModels, row.id)
console.log('\n通道1 API 模型列表:')
for (const item of apiList) {
  const price = item.billing_unit === 'per_second'
    ? `${item.credit_cost_per_second} 积分/秒`
    : `${item.credit_cost_flat} 积分/条`
  console.log(`  ${item.model_id} ${item.label} · ${price}`)
}

console.log('\n同步完成')
