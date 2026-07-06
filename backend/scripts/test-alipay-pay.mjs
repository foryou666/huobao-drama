import 'dotenv/config'
import { createAlipayPagePayOrder, getAlipayConfig, isAlipayConfigured } from '../src/services/alipay-pay.ts'

console.log('configured:', isAlipayConfigured())
const config = getAlipayConfig()
console.log('config:', config ? { appId: config.appId, pid: config.pid, returnUrl: config.returnUrl } : null)

if (!isAlipayConfigured()) {
  process.exit(1)
}

try {
  const outTradeNo = `ALI${Date.now()}`
  const { payUrl } = createAlipayPagePayOrder({
    outTradeNo,
    subject: '鲸灵科技-积分充值测试',
    amountYuan: 1000,
    returnUrl: `${config.returnUrl}?order_id=0`,
  })
  console.log('page_pay_ok:', payUrl.slice(0, 120) + '...')
  console.log('method:', new URL(payUrl).searchParams.get('method'))
} catch (err) {
  console.error('create_fail:', err?.message || String(err))
  process.exit(1)
}
