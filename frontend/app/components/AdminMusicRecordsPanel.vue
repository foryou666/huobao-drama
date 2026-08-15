<template>
  <div class="settings-scroll admin-music-records">
    <div class="settings-head">
      <h2 class="settings-title">音乐记录</h2>
      <p class="settings-desc">
        管理员专属：查看 MiniMax 配乐生成流水、平台积分消耗，以及上游账户余额（若可查询）。
      </p>
    </div>

    <section class="setup-panel card">
      <div class="quota-head">
        <h3 class="setup-title">概览</h3>
        <button type="button" class="btn btn-sm" :disabled="loading" @click="reload">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
      <div class="quota-summary">
        <div class="quota-stat">
          <span class="dim">总生成</span>
          <strong>{{ summary.counts?.total ?? 0 }}</strong>
        </div>
        <div class="quota-stat">
          <span class="dim">已完成</span>
          <strong>{{ summary.counts?.completed ?? 0 }}</strong>
        </div>
        <div class="quota-stat">
          <span class="dim">失败</span>
          <strong>{{ summary.counts?.failed ?? 0 }}</strong>
        </div>
        <div class="quota-stat">
          <span class="dim">进行中</span>
          <strong>{{ (summary.counts?.pending || 0) + (summary.counts?.processing || 0) }}</strong>
        </div>
        <div class="quota-stat">
          <span class="dim">积分消耗</span>
          <strong>{{ summary.credits_spent ?? 0 }}</strong>
        </div>
        <div class="quota-stat">
          <span class="dim">单价</span>
          <strong>{{ summary.unit_credit_cost ?? '—' }}</strong>
        </div>
      </div>

      <div class="upstream-card">
        <div class="upstream-top">
          <div>
            <div class="quota-name">
              MiniMax 上游
              <span class="tag" :class="summary.configured ? 'tag-success' : 'tag-warn'">
                {{ summary.configured ? '已配置' : '未配置' }}
              </span>
            </div>
            <div class="dim mono">{{ summary.upstream?.api_key_masked || '—' }}</div>
          </div>
          <div class="upstream-balance">
            <span class="dim">余额 / 余量</span>
            <strong>{{ balanceLabel }}</strong>
          </div>
        </div>
        <p v-if="summary.upstream?.error" class="dim upstream-note">{{ summary.upstream.error }}</p>
        <p v-else-if="summary.upstream?.group_id" class="dim upstream-note mono">
          GroupId {{ summary.upstream.group_id }}
        </p>
        <p v-else class="dim upstream-note">
          可配置 MINIMAX_GROUP_ID 以提升余额查询成功率；余额也可在 MiniMax 控制台查看。
        </p>
      </div>
    </section>

    <section class="setup-panel card">
      <div class="records-filters">
        <select v-model="filterStatus" class="input" @change="reloadRecords">
          <option value="">全部状态</option>
          <option value="completed">已完成</option>
          <option value="processing">生成中</option>
          <option value="pending">排队中</option>
          <option value="failed">失败</option>
        </select>
        <input
          v-model="keyword"
          class="input records-keyword"
          type="search"
          placeholder="搜索订单号 / 标题 / 提示词…"
          @keydown.enter="reloadRecords"
        />
        <button type="button" class="btn btn-sm" :disabled="loading" @click="reloadRecords">查询</button>
      </div>

      <div v-if="loading && !items.length" class="dim records-empty">加载中…</div>
      <div v-else-if="!items.length" class="dim records-empty">暂无配乐记录</div>
      <div v-else class="records-table-wrap">
        <table class="records-table">
          <thead>
            <tr>
              <th>试听</th>
              <th>订单 / ID</th>
              <th>时间</th>
              <th>模型</th>
              <th>操作人</th>
              <th>团队</th>
              <th>积分</th>
              <th>状态</th>
              <th>标题 / 提示词</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id">
              <td>
                <audio
                  v-if="audioUrl(item)"
                  class="records-audio"
                  controls
                  preload="none"
                  :src="audioUrl(item)"
                />
                <div v-else class="records-thumb-empty dim">
                  {{ item.status === 'failed' ? '失败' : (item.status === 'completed' ? '无音频' : '…') }}
                </div>
              </td>
              <td>
                <div class="mono">{{ item.order_no || `YG-BGM-${item.id}` }}</div>
                <div class="dim mono">#{{ item.id }}</div>
              </td>
              <td class="dim">{{ formatTime(item.created_at) }}</td>
              <td>
                <span class="tag tag-accent">{{ item.model_label || item.version || '—' }}</span>
              </td>
              <td>{{ item.operator_name || '—' }}</td>
              <td>{{ item.team_name || '—' }}</td>
              <td class="mono">{{ item.credit_cost != null ? item.credit_cost : '—' }}</td>
              <td>
                <span class="tag" :class="statusClass(item.status)">{{ statusLabel(item.status) }}</span>
                <div v-if="item.error_msg" class="dim records-error" :title="item.error_msg">
                  {{ previewPrompt(item.error_msg, 48) }}
                </div>
              </td>
              <td class="records-prompt" :title="item.prompt">
                <div v-if="item.title">{{ item.title }}</div>
                <div class="dim">{{ previewPrompt(item.prompt) }}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="pagination.has_more" class="records-more">
        <button type="button" class="btn btn-sm" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? '加载中…' : '加载更多' }}
        </button>
      </div>
      <p class="dim records-stats">共 {{ pagination.total || 0 }} 条</p>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { musicSunoAPI } from '~/composables/useApi'
import { mediaDisplayUrl } from '~/utils/media-url.js'

const loading = ref(false)
const loadingMore = ref(false)
const items = ref([])
const filterStatus = ref('')
const keyword = ref('')
const pagination = ref({ total: 0, has_more: false, offset: 0, limit: 40 })
const summary = ref({
  configured: false,
  unit_credit_cost: null,
  counts: { total: 0, completed: 0, failed: 0, pending: 0, processing: 0 },
  credits_spent: 0,
  upstream: null,
})

const balanceLabel = computed(() => {
  const up = summary.value.upstream
  if (!up) return '—'
  if (up.raw_label) return up.raw_label
  if (up.balance != null) {
    const unit = up.currency && up.currency !== 'quota' ? ` ${up.currency}` : ''
    return `${up.balance}${unit}`
  }
  return up.error ? '查询失败' : '—'
})

function formatTime(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 19)
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(iso).slice(0, 19)
  }
}

function statusLabel(status) {
  const map = {
    completed: '已完成',
    processing: '生成中',
    pending: '排队中',
    failed: '失败',
  }
  return map[status] || status || '—'
}

function statusClass(status) {
  if (status === 'completed') return 'tag-success'
  if (status === 'failed') return 'tag-danger'
  if (status === 'processing' || status === 'pending') return 'tag-warn'
  return ''
}

function previewPrompt(text, max = 80) {
  const s = String(text || '').trim()
  if (!s) return '—'
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function audioUrl(item) {
  const raw = item?.audio_url || (item?.clips?.[0]?.audio_url) || null
  if (!raw) return ''
  return mediaDisplayUrl(raw) || raw
}

async function loadSummary() {
  const data = await musicSunoAPI.adminSummary()
  summary.value = {
    configured: Boolean(data?.configured),
    unit_credit_cost: data?.unit_credit_cost ?? null,
    counts: data?.counts || { total: 0, completed: 0, failed: 0, pending: 0, processing: 0 },
    credits_spent: data?.credits_spent ?? 0,
    upstream: data?.upstream || null,
  }
}

async function fetchRecords({ append = false } = {}) {
  const offset = append ? items.value.length : 0
  const data = await musicSunoAPI.adminRecords({
    status: filterStatus.value || undefined,
    q: keyword.value.trim() || undefined,
    limit: pagination.value.limit || 40,
    offset,
  })
  const next = Array.isArray(data?.items) ? data.items : []
  items.value = append ? [...items.value, ...next] : next
  pagination.value = {
    total: data?.total ?? next.length,
    has_more: Boolean(data?.has_more),
    offset: data?.offset ?? offset,
    limit: data?.limit ?? 40,
  }
}

async function reload() {
  loading.value = true
  try {
    await Promise.all([loadSummary(), fetchRecords({ append: false })])
  } catch (err) {
    toast.error(err?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function reloadRecords() {
  loading.value = true
  try {
    await fetchRecords({ append: false })
  } catch (err) {
    toast.error(err?.message || '查询失败')
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || !pagination.value.has_more) return
  loadingMore.value = true
  try {
    await fetchRecords({ append: true })
  } catch (err) {
    toast.error(err?.message || '加载更多失败')
  } finally {
    loadingMore.value = false
  }
}

onMounted(() => {
  void reload()
})

defineExpose({ reload })
</script>

<style scoped>
.quota-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.quota-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  margin-bottom: 16px;
}
.quota-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 88px;
}
.quota-stat strong {
  font-size: 18px;
}
.upstream-card {
  padding: 12px 14px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.12);
}
.upstream-top {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
}
.quota-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  margin-bottom: 4px;
}
.upstream-balance {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.upstream-balance strong {
  font-size: 18px;
}
.upstream-note {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.4;
}
.records-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
  align-items: center;
}
.records-keyword {
  min-width: 180px;
  flex: 1;
}
.records-empty {
  padding: 24px 0;
}
.records-table-wrap {
  overflow-x: auto;
}
.records-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.records-table th,
.records-table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  vertical-align: top;
}
.records-table th {
  color: var(--text-dim, #888);
  font-weight: 500;
  white-space: nowrap;
}
.records-prompt {
  max-width: 260px;
  line-height: 1.4;
  word-break: break-word;
}
.records-error {
  margin-top: 4px;
  max-width: 160px;
  word-break: break-word;
}
.records-audio {
  width: 168px;
  height: 32px;
}
.records-thumb-empty {
  width: 64px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.15);
  font-size: 12px;
}
.records-more {
  margin-top: 12px;
}
.records-stats {
  margin-top: 8px;
  font-size: 12px;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
</style>
