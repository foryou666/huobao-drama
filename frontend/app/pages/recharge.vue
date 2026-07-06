<template>
  <div class="recharge-page">
    <div class="recharge-card card">
      <div class="recharge-head">
        <h1 class="recharge-title">积分充值</h1>
        <p class="dim">1 元 = 100 积分 · 微信扫码 / 支付宝网页支付</p>
        <p v-if="balance != null" class="recharge-balance">当前余额：<strong>{{ balance }}</strong> 积分</p>
      </div>

      <div v-if="configLoading" class="dim recharge-empty">加载中…</div>
      <div v-else-if="!rechargeReady" class="recharge-warn">
        <p>支付功能尚未配置完成。</p>
      </div>

      <template v-else>
        <div v-if="!activeOrder && payMethods.length > 1" class="pay-method-tabs">
          <button
            v-for="item in payMethods"
            :key="item.id"
            type="button"
            class="pay-method-tab"
            :class="{ active: payMethod === item.id }"
            @click="payMethod = item.id"
          >
            {{ item.label }}
          </button>
        </div>

        <div v-if="!activeOrder" class="package-grid">
          <button
            v-for="item in packages"
            :key="item.id"
            type="button"
            class="package-item"
            :class="{ active: selectedId === item.id }"
            @click="selectedId = item.id"
          >
            <div class="package-yuan">{{ item.label }}</div>
            <div class="package-credits">{{ item.credits }} 积分</div>
            <div v-if="item.bonus_label" class="package-bonus">{{ item.bonus_label }}</div>
          </button>
        </div>

        <div v-if="!activeOrder" class="recharge-actions">
          <button type="button" class="btn btn-primary" :disabled="!selectedId || paying" @click="createOrder">
            {{ paying ? '创建订单中…' : payButtonLabel }}
          </button>
          <p v-if="orderStatusText && !activeOrder" class="pay-status is-error">{{ orderStatusText }}</p>
        </div>

        <div v-else class="pay-panel">
          <template v-if="activeOrder.provider === 'alipay'">
            <p class="pay-summary">
              正在确认支付宝支付结果
              <strong>{{ activeOrder.amount_yuan }} 元</strong>
              （到账 <strong>{{ activeOrder.credits }}</strong> 积分）
            </p>
            <p class="dim pay-hint">支付完成后会自动刷新；若长时间未到账可点击下方按钮查询。</p>
          </template>
          <template v-else>
            <p class="pay-summary">
              请使用微信扫描下方二维码支付
              <strong>{{ activeOrder.amount_yuan }} 元</strong>
              （到账 <strong>{{ activeOrder.credits }}</strong> 积分）
            </p>
            <div class="qr-wrap">
              <img v-if="qrImageUrl" :src="qrImageUrl" alt="支付二维码" class="qr-image" />
              <div v-else class="dim">二维码生成中…</div>
            </div>
            <p class="dim pay-hint">支付完成后页面将自动刷新余额；若长时间未到账可点击下方按钮查询。</p>
          </template>
          <div class="recharge-actions">
            <button type="button" class="btn btn-ghost" :disabled="polling" @click="pollOrder">
              {{ polling ? '查询中…' : '我已支付，查询状态' }}
            </button>
            <button type="button" class="btn btn-ghost" @click="resetOrder">重新选择套餐</button>
          </div>
          <p v-if="orderStatusText" class="pay-status" :class="orderStatusClass">{{ orderStatusText }}</p>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { paymentsAPI, creditsAPI } from '~/composables/useApi'
import { useAuth } from '~/composables/useAuth'
import { useRechargeAccess } from '~/composables/useRechargeAccess'

const router = useRouter()
const route = useRoute()
const { rechargeEnabled } = useRechargeAccess()

const { refreshBalance, user } = useAuth()

const configLoading = ref(true)
const wechatEnabled = ref(false)
const alipayEnabled = ref(false)
const packages = ref([])
const selectedId = ref('')
const payMethod = ref('wechat')
const paying = ref(false)
const polling = ref(false)
const activeOrder = ref(null)
const balance = ref(null)
const orderStatusText = ref('')
let pollTimer = null
let redirectTimer = null

const payMethods = computed(() => {
  const items = []
  if (wechatEnabled.value) items.push({ id: 'wechat', label: '微信支付' })
  if (alipayEnabled.value) items.push({ id: 'alipay', label: '支付宝' })
  return items
})

const rechargeReady = computed(() => payMethods.value.length > 0)

const payButtonLabel = computed(() => {
  if (payMethod.value === 'alipay') return '跳转支付宝支付'
  return '微信扫码支付'
})

const qrImageUrl = computed(() => {
  if (activeOrder.value?.provider === 'alipay') return ''
  const url = activeOrder.value?.code_url
  if (!url) return ''
  return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(url)}`
})

const orderStatusClass = computed(() => {
  const status = activeOrder.value?.status
  if (status === 'paid') return 'is-success'
  if (status === 'failed' || status === 'closed') return 'is-error'
  return ''
})

async function loadConfig() {
  configLoading.value = true
  try {
    const [cfg, pkgRes, balRes] = await Promise.all([
      paymentsAPI.config(),
      paymentsAPI.packages(),
      creditsAPI.balance(),
    ])
    wechatEnabled.value = !!cfg?.wechat_enabled
    alipayEnabled.value = !!cfg?.alipay_enabled
    packages.value = pkgRes?.items || []
    balance.value = balRes?.balance ?? user.value?.credits_balance ?? null
    if (!selectedId.value && packages.value.length) {
      selectedId.value = packages.value[0].id
    }
    if (wechatEnabled.value) payMethod.value = 'wechat'
    else if (alipayEnabled.value) payMethod.value = 'alipay'
  } finally {
    configLoading.value = false
  }
}

async function createOrder() {
  if (!selectedId.value) return
  paying.value = true
  orderStatusText.value = ''
  try {
    if (payMethod.value === 'alipay') {
      const order = await paymentsAPI.createAlipayOrder({ package_id: selectedId.value })
      if (!order?.code_url) throw new Error('未获取到支付宝支付链接')
      window.location.href = order.code_url
      return
    }
    activeOrder.value = await paymentsAPI.createWechatOrder({ package_id: selectedId.value })
    startPolling()
  } catch (err) {
    orderStatusText.value = err?.message || '创建订单失败'
  } finally {
    paying.value = false
  }
}

async function pollOrder() {
  if (!activeOrder.value?.id) return
  polling.value = true
  try {
    const next = await paymentsAPI.getOrder(activeOrder.value.id)
    activeOrder.value = next
    if (next.status === 'paid') {
      orderStatusText.value = '支付成功，积分已到账，即将跳转到积分明细…'
      await refreshBalance()
      const balRes = await creditsAPI.balance()
      balance.value = balRes?.balance ?? balance.value
      stopPolling()
      scheduleRedirectToRecords()
    } else if (next.status === 'closed' || next.status === 'failed') {
      orderStatusText.value = next.error_msg || '订单已关闭，请重新下单'
      stopPolling()
    } else {
      orderStatusText.value = activeOrder.value?.provider === 'alipay'
        ? '尚未检测到支付，请完成支付宝付款后重试'
        : '尚未检测到支付，请完成扫码后重试'
    }
  } catch (err) {
    orderStatusText.value = err?.message || '查询失败'
  } finally {
    polling.value = false
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(() => {
    void pollOrder()
  }, 4000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function scheduleRedirectToRecords() {
  if (redirectTimer) clearTimeout(redirectTimer)
  redirectTimer = setTimeout(() => {
    void router.push('/activity?tab=credits&recharge=success')
  }, 1500)
}

function resetOrder() {
  if (redirectTimer) {
    clearTimeout(redirectTimer)
    redirectTimer = null
  }
  stopPolling()
  activeOrder.value = null
  orderStatusText.value = ''
  if (route.query.order_id) {
    void router.replace({ path: '/recharge' })
  }
}

async function resumeOrderFromQuery() {
  const raw = route.query.order_id
  const orderId = Number(Array.isArray(raw) ? raw[0] : raw)
  if (!Number.isFinite(orderId) || orderId <= 0) return

  try {
    const next = await paymentsAPI.getOrder(orderId)
    activeOrder.value = next
    if (next.status === 'paid') {
      orderStatusText.value = '支付成功，积分已到账，即将跳转到积分明细…'
      await refreshBalance()
      const balRes = await creditsAPI.balance()
      balance.value = balRes?.balance ?? balance.value
      scheduleRedirectToRecords()
      return
    }
    if (next.status === 'closed' || next.status === 'failed') {
      orderStatusText.value = next.error_msg || '订单已关闭，请重新下单'
      return
    }
    orderStatusText.value = '正在确认支付宝支付结果…'
    startPolling()
  } catch (err) {
    orderStatusText.value = err?.message || '加载订单失败'
  }
}

onMounted(() => {
  if (!rechargeEnabled.value) {
    void router.replace('/activity?tab=credits')
    return
  }
  void loadConfig().then(() => resumeOrderFromQuery())
})

onBeforeUnmount(() => {
  stopPolling()
  if (redirectTimer) {
    clearTimeout(redirectTimer)
    redirectTimer = null
  }
})
</script>

<style scoped>
.recharge-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}
.recharge-card { padding: 24px; }
.recharge-title { margin: 0 0 8px; font-size: 22px; }
.recharge-balance { margin-top: 12px; }
.recharge-empty, .recharge-warn { padding: 24px 0; }
.pay-method-tabs {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
.pay-method-tab {
  border: 1px solid var(--border);
  background: var(--bg-1);
  color: var(--text-0);
  border-radius: 999px;
  padding: 8px 14px;
  cursor: pointer;
}
.pay-method-tab.active {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent-text);
}
.package-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 20px;
}
.package-item {
  border: 1px solid var(--border);
  background: var(--bg-1);
  border-radius: 12px;
  padding: 16px;
  text-align: left;
  cursor: pointer;
}
.package-item.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.package-yuan { font-size: 18px; font-weight: 700; }
.package-credits { margin-top: 6px; color: var(--accent-text); font-weight: 600; }
.package-bonus { margin-top: 4px; font-size: 12px; color: var(--text-1); }
.recharge-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 20px;
}
.pay-panel { margin-top: 20px; text-align: center; }
.pay-summary { margin-bottom: 16px; }
.qr-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 260px;
  min-width: 260px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  padding: 12px;
}
.qr-image { width: 260px; height: 260px; }
.pay-hint { margin-top: 12px; font-size: 13px; }
.pay-status { margin-top: 12px; }
.pay-status.is-success { color: #66bb6a; }
.pay-status.is-error { color: #ef5350; }
@media (max-width: 560px) {
  .package-grid { grid-template-columns: 1fr; }
}
</style>
