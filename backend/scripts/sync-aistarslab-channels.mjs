/**
 * 从 Seedance VIP OpenAPI 同步通道3 线路与积分定价
 * 用法: cd backend && npx tsx scripts/sync-aistarslab-channels.mjs
 */
import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db, schema } from '../src/db/index.js'
import { now } from '../src/utils/response.js'
import { applyAistarslabChannelVisibility, setAistarslabChannelEnabled } from '../src/utils/aistarslab-channel-settings.js'
import { AISTARSLAB_MAX_UPSTREAM_DISPLAY_CREDITS } from '../src/constants/aistarslab.js'
import {
  findAistarslabVideoConfigRow,
  loadAistarslabVideoConfigFromProvider,
  listAistarslabModelOptionsForApi,
  resolveDefaultAistarslabSelection,
  syncAistarslabModelCreditPricing,
  computeAistarslabUpstreamCreditCost,
  filterAistarslabConfigForDisplay,
} from '../src/utils/aistarslab-video-options.js'
import { getActionCost } from '../src/services/credits.js'
import { aistarslabModelCreditAction } from '../src/constants/aistarslab.js'

const row = findAistarslabVideoConfigRow()
if (!row?.apiKey) {
  console.error('未找到有效的 Seedance VIP（aistarslab）视频配置')
  process.exit(1)
}

console.log(`配置 #${row.id} ${row.name}`)
console.log(`Base URL: ${row.baseUrl || 'https://api.video.aistarslab.com'}`)

const remote = await loadAistarslabVideoConfigFromProvider(row)
if (!remote.channels.length) {
  console.error('上游未返回任何线路')
  process.exit(1)
}

syncAistarslabModelCreditPricing(remote)

const displayFiltered = filterAistarslabConfigForDisplay(remote, AISTARSLAB_MAX_UPSTREAM_DISPLAY_CREDITS)
for (const channel of remote.channels) {
  const show = displayFiltered.channels.some(item => item.channel === channel.channel)
  setAistarslabChannelEnabled(channel.channel, show)
}

const visible = applyAistarslabChannelVisibility(remote)
const defaults = resolveDefaultAistarslabSelection(visible)
const modelIds = [...new Set(visible.channels.flatMap(ch => ch.models.map(m => m.model)))]
const ts = now()

db.update(schema.aiServiceConfigs)
  .set({
    model: JSON.stringify(modelIds),
    updatedAt: ts,
  })
  .where(eq(schema.aiServiceConfigs.id, row.id))
  .run()

console.log(`\n上游共 ${remote.channels.length} 条线路、${[...new Set(remote.channels.flatMap(ch => ch.models.map(m => m.model)))].length} 个模型`)
console.log(`展示规则: 仅 Seedance 模型；上游参考价（最长时长）≤ ${AISTARSLAB_MAX_UPSTREAM_DISPLAY_CREDITS} 积分`)
console.log(`默认选择: 线路 ${defaults.channel} · ${defaults.model}`)
console.log(`前台展示 ${visible.channels.length} 条线路\n`)

for (const channel of visible.channels) {
  console.log(`线路 ${channel.channel} ${channel.title} · ${channel.secondsMin}-${channel.secondsMax}s`)
  for (const model of channel.models) {
    const upstream = computeAistarslabUpstreamCreditCost(
      remote,
      channel.channel,
      model.model,
      channel.secondsMax,
      false,
    )
    const userCost = getActionCost(aistarslabModelCreditAction(channel.channel, model.model), 1)
    const perSecond = !model.fixedTotalCredits && !!(model.creditsPerSecond && model.creditsPerSecond > 0)
    const priceHint = model.fixedTotalCredits
      ? `上游 ${model.fixedTotalCredits} 积分/条`
      : model.creditsPerSecond
        ? `上游 ${model.creditsPerSecond} 积分/秒（${channel.secondsMax}秒=${upstream}）`
        : `上游 ${upstream} 积分`
    console.log(`  · ${model.model} ${model.label} · ${priceHint} · 用户 ${userCost} 积分/${perSecond ? '秒' : '次'}`)
  }
}

const hidden = remote.channels.filter(ch => !visible.channels.some(item => item.channel === ch.channel))
if (hidden.length) {
  console.log(`\n已隐藏 ${hidden.length} 条线路（非 Seedance / 上游 > ${AISTARSLAB_MAX_UPSTREAM_DISPLAY_CREDITS} / 无可用模型）:`)
  for (const channel of hidden) {
    console.log(`  · 线路 ${channel.channel} ${channel.title}`)
  }
}

const apiList = listAistarslabModelOptionsForApi(visible, row.id)
console.log('\n通道3 API 模型列表:')
for (const item of apiList) {
  if (item.billing_unit === 'per_second') {
    console.log(`  线路${item.channel} ${item.label} · ${item.credit_cost_per_second ?? item.credit_cost} 积分/秒`)
  } else {
    console.log(`  线路${item.channel} ${item.label} · ${item.credit_cost_flat ?? item.credit_cost} 积分/次`)
  }
}

console.log('\n同步完成')
