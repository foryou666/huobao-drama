<template>
  <div class="settings-scroll admin-portrait-certs">
    <div class="settings-head">
      <h2 class="settings-title">虚拟人像认证</h2>
      <p class="settings-desc">
        管理通道2 方舟虚拟人像认证流水。取消认证会删除方舟侧素材并腾出配额，本地记录保留，可随时重新认证。
        提交后通常需 1–3 分钟审核。
      </p>
    </div>

    <section class="setup-panel card">
      <div class="quota-head">
        <h3 class="setup-title">账号额度</h3>
        <button type="button" class="btn btn-sm" :disabled="loading" @click="reload">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
      <div class="quota-summary">
        <div class="quota-stat">
          <span class="dim">总额度</span>
          <strong>{{ summary.total_quota ?? '—' }}</strong>
        </div>
        <div class="quota-stat">
          <span class="dim">已认证</span>
          <strong>{{ summary.total_certified ?? 0 }}</strong>
        </div>
        <div class="quota-stat">
          <span class="dim">剩余</span>
          <strong>{{ summary.total_remaining ?? '—' }}</strong>
        </div>
      </div>
      <div v-if="!(summary.accounts || []).length" class="dim quota-empty">暂无通道2 Key 或认证记录</div>
      <div v-else class="quota-grid">
        <div v-for="acc in summary.accounts" :key="acc.config_id || acc.name" class="quota-card">
          <div class="quota-card-top">
            <div>
              <div class="quota-name">
                {{ acc.name }}
                <span v-if="acc.is_active" class="tag tag-success">当前</span>
              </div>
              <div class="dim mono">{{ acc.api_key_masked || '—' }}</div>
            </div>
            <div v-if="acc.config_id" class="quota-edit">
              <label class="dim">总额度</label>
              <input
                class="input input-sm"
                type="number"
                min="1"
                :value="acc.quota_total"
                @change="onQuotaChange(acc, $event)"
              />
            </div>
          </div>
          <div class="quota-card-nums">
            <span>已认证 <b>{{ acc.certified_count }}</b></span>
            <span>剩余 <b>{{ acc.remaining }}</b></span>
          </div>
        </div>
      </div>
      <p class="dim quota-note">默认额度 {{ summary.default_quota || 50 }}（可按账号修改；与火山权益包「素材资产」对齐自行填写）</p>
    </section>

    <section class="setup-panel card">
      <div class="records-filters">
        <select v-model="filterStatus" class="input" @change="reloadRecords">
          <option value="">全部状态</option>
          <option value="active">已认证</option>
          <option value="processing">认证中</option>
          <option value="failed">失败</option>
          <option value="cancelled">已取消</option>
        </select>
        <select v-model="filterConfigId" class="input" @change="reloadRecords">
          <option value="">全部 Key</option>
          <option v-for="acc in summary.accounts.filter(a => a.config_id)" :key="acc.config_id" :value="String(acc.config_id)">
            {{ acc.name }}
          </option>
        </select>
        <input
          v-model="keyword"
          class="input records-keyword"
          type="search"
          placeholder="搜索角色 / 项目 / 认证人…"
          @keydown.enter="reloadRecords"
        />
        <button type="button" class="btn btn-sm" :disabled="loading" @click="reloadRecords">查询</button>
      </div>

      <div v-if="loading && !items.length" class="dim records-empty">加载中…</div>
      <div v-else-if="!items.length" class="dim records-empty">暂无认证记录</div>
      <div v-else class="records-table-wrap">
        <table class="records-table">
          <thead>
            <tr>
              <th>图片</th>
              <th>角色 / 范围</th>
              <th>项目</th>
              <th>所属 Key</th>
              <th>认证人</th>
              <th>认证时间</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id">
              <td>
                <button
                  v-if="thumbUrl(item)"
                  type="button"
                  class="records-thumb-btn"
                  title="查看大图"
                  @click="openViewer(item)"
                >
                  <img :src="thumbUrl(item)" alt="" class="records-thumb" loading="lazy" />
                </button>
                <div v-else class="records-thumb-empty dim">无图</div>
              </td>
              <td>
                <div>{{ item.character_name || `角色#${item.character_id}` }}</div>
                <div class="dim">{{ scopeLabel(item) }}</div>
              </td>
              <td>{{ item.drama_title || (item.drama_id ? `#${item.drama_id}` : '—') }}</td>
              <td>
                <div>{{ item.config_name || '—' }}</div>
                <div class="dim mono">{{ item.api_key_masked || '' }}</div>
              </td>
              <td>{{ item.created_by_name || '—' }}</td>
              <td class="dim">{{ formatTime(item.activated_at || item.created_at) }}</td>
              <td>
                <span class="tag" :class="statusClass(item.status)">{{ statusLabel(item) }}</span>
              </td>
              <td class="records-actions">
                <button
                  v-if="item.status === 'active' || item.status === 'processing'"
                  type="button"
                  class="btn btn-sm btn-ghost"
                  :disabled="busyId === item.id"
                  @click="cancelRecord(item)"
                >
                  取消认证
                </button>
                <button
                  v-if="item.status === 'cancelled' || item.status === 'failed'"
                  type="button"
                  class="btn btn-sm btn-primary"
                  :disabled="busyId === item.id"
                  @click="recertifyRecord(item)"
                >
                  重新认证
                </button>
                <span v-if="item.status === 'active' && !item.seedance_asset_id" class="dim">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="dim records-stats">共 {{ total }} 条</p>
    </section>

    <div
      v-if="viewer.open && viewer.src"
      class="records-viewer-overlay"
      @click.self="closeViewer"
    >
      <div class="records-viewer card">
        <div class="records-viewer-head">
          <span>{{ viewer.title }}</span>
          <button type="button" class="btn btn-ghost btn-sm" @click="closeViewer">关闭</button>
        </div>
        <img :src="viewer.src" alt="" class="records-viewer-img" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { portraitAPI } from '~/composables/useApi'
import { mediaDisplayUrl, mediaGridUrl } from '~/utils/media-url.js'

const loading = ref(false)
const busyId = ref(null)
const items = ref([])
const total = ref(0)
const filterStatus = ref('')
const filterConfigId = ref('')
const keyword = ref('')
const summary = ref({
  total_quota: 0,
  total_certified: 0,
  total_remaining: 0,
  default_quota: 50,
  accounts: [],
})
const viewer = ref({ open: false, src: '', title: '' })

function thumbUrl(item) {
  const raw = item?.image_url || ''
  if (!raw) return ''
  return mediaGridUrl(raw) || mediaDisplayUrl(raw)
}

function openViewer(item) {
  const src = mediaDisplayUrl(item?.image_url || '') || thumbUrl(item)
  if (!src) return
  viewer.value = {
    open: true,
    src,
    title: `${item.character_name || '角色'} · ${scopeLabel(item)}`,
  }
}

function closeViewer() {
  viewer.value = { open: false, src: '', title: '' }
}

function scopeLabel(item) {
  if (item.scope === 'outfit' || item.outfit_id) {
    return `造型 · ${item.outfit_label || item.outfit_id}`
  }
  return '基准图'
}

function statusLabel(item) {
  const s = item?.status
  if (s === 'active') return '已认证'
  if (s === 'processing') return '认证中'
  if (s === 'failed') return '失败'
  if (s === 'cancelled') {
    if (item.cancel_reason === 'replaced') return '已替换'
    return '已取消'
  }
  return s || '—'
}

function statusClass(status) {
  if (status === 'active') return 'tag-success'
  if (status === 'processing') return 'tag-accent'
  if (status === 'failed') return 'tag-error'
  return ''
}

function formatTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('zh-CN', { hour12: false })
}

async function reload() {
  loading.value = true
  try {
    const [sum, list] = await Promise.all([
      portraitAPI.adminSummary(),
      portraitAPI.adminRecords({
        status: filterStatus.value || undefined,
        config_id: filterConfigId.value || undefined,
        q: keyword.value.trim() || undefined,
        limit: 100,
      }),
    ])
    summary.value = sum || summary.value
    items.value = list?.items || []
    total.value = list?.total || 0
  } catch (e) {
    toast.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function reloadRecords() {
  loading.value = true
  try {
    const list = await portraitAPI.adminRecords({
      status: filterStatus.value || undefined,
      config_id: filterConfigId.value || undefined,
      q: keyword.value.trim() || undefined,
      limit: 100,
    })
    items.value = list?.items || []
    total.value = list?.total || 0
  } catch (e) {
    toast.error(e?.message || '查询失败')
  } finally {
    loading.value = false
  }
}

async function onQuotaChange(acc, event) {
  const next = Number(event?.target?.value)
  if (!acc.config_id || !Number.isFinite(next) || next < 1) return
  try {
    await portraitAPI.adminUpdateQuota(acc.config_id, next)
    toast.success('额度已更新')
    await reload()
  } catch (e) {
    toast.error(e?.message || '更新失败')
    event.target.value = acc.quota_total
  }
}

async function cancelRecord(item) {
  if (!confirm('取消认证会删除方舟侧素材并腾出配额；本地记录会保留，之后可重新认证。确定？')) return
  busyId.value = item.id
  try {
    await portraitAPI.adminCancelRecord(item.id)
    toast.success('已取消认证（记录已保留）')
    await reload()
  } catch (e) {
    toast.error(e?.message || '取消失败')
  } finally {
    busyId.value = null
  }
}

async function recertifyRecord(item) {
  if (!confirm('提交后需 1–3 分钟完成方舟审核，期间会占用素材资产配额。确认重新认证？')) return
  busyId.value = item.id
  try {
    await portraitAPI.adminRecertifyRecord(item.id)
    toast.success('已提交重新认证')
    await reload()
  } catch (e) {
    toast.error(e?.message || '重新认证失败')
  } finally {
    busyId.value = null
  }
}

onMounted(reload)
</script>

<style scoped>
.quota-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.quota-summary {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.quota-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 88px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--bg-2);
  border: 1px solid var(--border);
}
.quota-stat strong { font-size: 18px; }
.quota-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}
.quota-card {
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg-2);
}
.quota-card-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: flex-start;
}
.quota-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  margin-bottom: 2px;
}
.quota-edit {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-end;
}
.quota-edit .input-sm {
  width: 72px;
  padding: 4px 6px;
  font-size: 12px;
}
.quota-card-nums {
  display: flex;
  gap: 14px;
  margin-top: 8px;
  font-size: 12px;
}
.quota-note, .quota-empty, .records-empty, .records-stats {
  margin-top: 10px;
  font-size: 12px;
}
.records-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.records-keyword { min-width: 200px; flex: 1; }
.records-table-wrap { overflow: auto; }
.records-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.records-table th,
.records-table td {
  padding: 8px 6px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: middle;
}
.records-table th {
  color: var(--text-dim);
  font-weight: 600;
  white-space: nowrap;
}
.records-thumb-btn {
  padding: 0;
  border: none;
  background: transparent;
  cursor: zoom-in;
}
.records-thumb {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--border);
}
.records-thumb-empty {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--bg-2);
  font-size: 11px;
}
.records-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
.records-viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.records-viewer {
  max-width: min(920px, 96vw);
  max-height: 92vh;
  overflow: auto;
  padding: 12px;
}
.records-viewer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.records-viewer-img {
  max-width: 100%;
  max-height: 80vh;
  display: block;
  margin: 0 auto;
  border-radius: 8px;
}
</style>
