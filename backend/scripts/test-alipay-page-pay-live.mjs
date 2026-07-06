import 'dotenv/config'
import { createAlipayPagePayOrder, isAlipayConfigured } from '../src/services/alipay-pay.ts'

if (!isAlipayConfigured()) {
  console.error('alipay not configured')
  process.exit(1)
}

const outTradeNo = `ALI${Date.now()}`
const { payUrl } = createAlipayPagePayOrder({
  outTradeNo,
  subject: '鲸灵科技-积分充值联调测试',
  amountYuan: 1000,
  returnUrl: 'https://ai.weikuaiche.cn/recharge?order_id=0',
})

console.log('out_trade_no:', outTradeNo)
console.log('pay_url_len:', payUrl.length)

const resp = await fetch(payUrl, { redirect: 'manual' })
const body = await resp.text()
const location = resp.headers.get('location') || ''

console.log('http_status:', resp.status)
console.log('location:', location.slice(0, 200))

const snippet = body.replace(/\s+/g, ' ').slice(0, 500)
console.log('body_snippet:', snippet)

const errorHints = [
  '接口调用权限不足',
  '应用未上线',
  '无效的应用',
  'INVALID_PARAMETER',
  'ACQ',
  'error',
  '系统繁忙',
]
for (const hint of errorHints) {
  if (body.includes(hint) || location.includes(hint)) {
    console.log('detected_hint:', hint)
  }
}

if (resp.status === 302 || resp.status === 301 || body.includes('alipay.com') || location.includes('alipay.com')) {
  console.log('result: likely_ok_redirect_to_alipay')
} else {
  console.log('result: check_body_for_errors')
}
