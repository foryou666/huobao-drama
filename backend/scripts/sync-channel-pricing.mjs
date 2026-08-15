/**
 * 一次性：从上游同步通道1/通道3线路定价，并打印开通线路价格表
 * 用法（服务器）: cd /opt/hongguoduanju/backend && npx tsx scripts/sync-channel-pricing.mjs
 */
import {
  findChengmengVideoConfigRow,
  getChengmengVideoModelOptions,
  pickChengmengChannel1UiModels,
  syncChengmengModelCreditPricing,
  resolveChengmengUpstreamYuanPer15Seconds,
  listChengmengModelOptionsForApi,
} from '../src/utils/chengmeng-video-options.ts'
import {
  findAistarslabVideoConfigRow,
  syncAistarslabChannelsFromProvider,
  listAistarslabModelOptionsForApi,
} from '../src/utils/aistarslab-video-options.ts'
import { applyAistarslabChannelVisibility } from '../src/utils/aistarslab-channel-settings.ts'
import { getConfigById } from '../src/services/ai.ts'

const cmRow = findChengmengVideoConfigRow()
const cmModelsRaw = await getChengmengVideoModelOptions(cmRow, { refresh: true })
const cmUi = pickChengmengChannel1UiModels(cmModelsRaw)
syncChengmengModelCreditPricing(cmUi)
const cmApi = listChengmengModelOptionsForApi(cmUi, cmRow?.id ?? null)

console.log('===CHANNEL1===')
for (const m of cmApi) {
  const raw = cmUi.find(x => x.id === m.id)
  const up = raw ? resolveChengmengUpstreamYuanPer15Seconds(raw) : null
  console.log(JSON.stringify({
    channel: '1',
    id: m.id,
    label: m.label,
    upstream_yuan: up,
    user_credits: m.credit_cost_flat ?? m.credit_cost,
  }))
}

const asRow = findAistarslabVideoConfigRow()
console.log('===CHANNEL3===')
if (!asRow) {
  console.log(JSON.stringify({ error: 'no aistarslab config' }))
  process.exit(0)
}
const cfg = getConfigById(asRow.id, { includeInactive: true })
const loaded = await syncAistarslabChannelsFromProvider(cfg || asRow, { refresh: true })
const visible = applyAistarslabChannelVisibility(loaded)
const asApi = listAistarslabModelOptionsForApi(visible, asRow.id)

for (const m of asApi) {
  const upCredits = m.upstream_credit_cost
  console.log(JSON.stringify({
    channel: '3',
    line: m.channel,
    title: m.channel_title,
    model: m.model,
    label: m.label,
    upstream_credits: upCredits,
    upstream_yuan: Number((upCredits / 100).toFixed(2)),
    user_credits: m.credit_cost_flat ?? m.credit_cost,
  }))
}
