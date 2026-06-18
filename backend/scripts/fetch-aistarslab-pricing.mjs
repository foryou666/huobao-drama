import 'dotenv/config'
import {
  findAistarslabVideoConfigRow,
  loadAistarslabVideoConfigFromProvider,
  listAistarslabModelOptionsForApi,
  computeAistarslabCreditCost,
} from '../dist/utils/aistarslab-video-options.js'

const row = findAistarslabVideoConfigRow()
console.log('Config:', row?.id, row?.name)

const remote = await loadAistarslabVideoConfigFromProvider(row)
console.log('Channels:', remote.channels.length)
console.log('Reference video multiplier:', remote.referenceVideoCreditsMultiplier)

for (const ch of remote.channels) {
  console.log('\nChannel', ch.channel, '-', ch.title, `(duration ${ch.secondsMin}-${ch.secondsMax}s)`)
  for (const m of ch.models) {
    for (const sec of [4, 10, 15]) {
      const base = computeAistarslabCreditCost(remote, ch.channel, m.model, sec, false)
      const withVideo = computeAistarslabCreditCost(remote, ch.channel, m.model, sec, true)
      console.log(`  ${m.label} (${m.model}) @ ${sec}s: ${base} credits (with ref video: ${withVideo})`)
    }
    console.log(`    fixedTotalCredits=${m.fixedTotalCredits ?? '-'}, creditsPerSecond=${m.creditsPerSecond ?? '-'}`)
  }
}

const models = listAistarslabModelOptionsForApi(remote, row?.id ?? null)
console.log('\nDefault model options shown on page:')
for (const m of models.filter(x => x.channel === '12')) {
  console.log(`  ${m.label}: ${m.credit_cost_flat} credits (${m.billing_unit})`)
}
