<template>
  <div class="studio-page tts-studio-page">
    <header class="studio-header">
      <div class="studio-header-copy">
        <h1 class="studio-title">AI 配音</h1>
        <p class="studio-desc">选择或上传参考音色，输入文案后生成；忙时本地自动排队。</p>
      </div>
    </header>

    <div
      v-if="serverState !== 'ready'"
      class="tts-server-banner"
      :class="{
        offline: serverState === 'unconfigured' || serverState === 'needs_bindings',
        checking: serverState === 'checking',
      }"
      role="status"
    >
      <div class="tts-server-banner-copy">
        <strong class="tts-server-banner-title">{{ statusBannerTitle }}</strong>
        <span class="tts-server-banner-detail">{{ statusBannerDetail }}</span>
      </div>
      <button type="button" class="btn btn-sm" @click="checkStatus">重新检测</button>
    </div>

    <div class="tts-feed">
      <div v-if="loading && !items.length" class="studio-empty card dim">加载中…</div>
      <div v-else-if="!items.length" class="studio-empty card">
        <p>还没有云端配音记录，在下方输入文本并生成</p>
      </div>
      <div v-else class="tts-history-list">
        <article v-for="item in items" :key="item.id" class="tts-history-card card">
          <div class="tts-history-head">
            <strong>#{{ item.id }}</strong>
            <span class="tag" :class="statusClass(item.status)">{{ statusLabel(item.status) }}</span>
            <span class="dim">{{ item.voice_name || '音色' }}</span>
            <span v-if="item.duration_sec" class="dim">{{ formatSec(item.duration_sec) }}</span>
            <span v-if="item.emotion_text" class="tag mono">{{ item.emotion_text }}</span>
          </div>
          <div class="tts-history-meta dim">
            <span>操作人 {{ operatorLabel(item) }}</span>
            <span>操作时间 {{ formatTime(item.created_at) }}</span>
          </div>
          <p class="tts-history-text">{{ item.text }}</p>
          <p v-if="item.error_msg" class="tts-error">{{ item.error_msg }}</p>
          <audio v-if="item.audio_url" :src="mediaDisplayUrl(item.audio_url)" controls class="tts-audio" />
        </article>
      </div>
    </div>

    <div class="tts-composer card">
      <div class="tts-composer-grid">
        <div class="tts-composer-main">
          <label class="tts-label">配音文本</label>
          <textarea
            v-model="text"
            class="textarea tts-textarea"
            rows="4"
            placeholder="输入需要朗读的文案…"
          />

          <label class="tts-label">参考音色</label>
          <div class="tts-voice-row">
            <select
              v-model="filterDramaId"
              class="studio-filter-select tts-drama-select"
              title="筛选音色库所属项目"
              @focus="ensureDramasLoaded"
              @change="loadVoices"
            >
              <option value="">全部项目音色</option>
              <option v-for="d in dramas" :key="d.id" :value="String(d.id)">{{ d.title }}</option>
            </select>
            <button type="button" class="btn btn-sm" @click="voicePickerOpen = true">从音色库选择</button>
            <button type="button" class="btn btn-sm" :disabled="uploadingVoice" @click="triggerVoiceUpload">
              {{ uploadingVoice ? '上传中…' : '上传参考音频' }}
            </button>
            <input
              ref="voiceFileInput"
              type="file"
              class="tts-voice-file-input"
              accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/*"
              @change="onVoiceFileChange"
            />
            <span v-if="selectedAssetVoice" class="tts-voice-pill">
              库：{{ selectedAssetVoice.name }}
              <button type="button" class="tts-voice-clear" @click="selectedAssetVoice = null">×</button>
            </span>
            <span v-else-if="selectedUploadVoice" class="tts-voice-pill">
              上传：{{ selectedUploadVoice.name }}
              <button type="button" class="tts-voice-clear" @click="selectedUploadVoice = null">×</button>
            </span>
            <span v-else class="dim">请选择或上传参考音频</span>
          </div>
          <audio
            v-if="selectedUploadVoice?.url"
            class="tts-voice-preview"
            :src="mediaDisplayUrl(selectedUploadVoice.url)"
            controls
            preload="metadata"
          />
        </div>

        <div class="tts-composer-side">
          <label class="tts-label">情感向量（强度最高为 1）</label>
          <p class="dim tts-emotion-hint">【喜】【怒】【哀】【惧】【厌恶】【低落】【惊喜】【平静】</p>
          <div v-for="s in emotionLabels" :key="s.key" class="tts-slider-row">
            <span>{{ s.label }}</span>
            <input v-model.number="emotionVector[s.key]" type="range" min="0" max="1" step="0.05" />
            <span class="dim mono">{{ Number(emotionVector[s.key] || 0).toFixed(2) }}</span>
          </div>
          <p class="dim mono tts-vector-preview">{{ vectorPreview }}</p>

          <label class="tts-label">情绪权重（emo_alpha）</label>
          <input v-model.number="emotionWeight" type="range" min="0" max="1.6" step="0.05" class="tts-weight" />
          <span class="dim mono">{{ Number(emotionWeight).toFixed(2) }}</span>
        </div>
      </div>

      <div class="tts-composer-foot">
        <span class="dim tts-composer-count">
          {{ text.length }} 字
          <template v-if="hasActiveJobs"> · 有任务生成中，可刷新查看</template>
        </span>
        <div class="tts-composer-actions">
          <button type="button" class="btn btn-sm" :disabled="loading" @click="reload">
            {{ loading ? '刷新中…' : '刷新' }}
          </button>
          <button type="button" class="btn btn-primary" :disabled="submitting || !canGenerate" @click="generate">
            {{ generateButtonLabel }}
          </button>
        </div>
      </div>
    </div>

    <VoiceAssetPickerModal
      :open="voicePickerOpen"
      :voices="voiceAssets"
      :selected="selectedAssetVoice ? [selectedAssetVoice] : []"
      :max="1"
      @close="voicePickerOpen = false"
      @confirm="onVoicePicked"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, defineAsyncComponent } from 'vue'
import { ttsRunninghubAPI, dramaAPI, assetAPI, uploadAPI } from '~/composables/useApi'
import { mediaDisplayUrl } from '~/utils/media-url.js'
import { toast } from 'vue-sonner'

const VoiceAssetPickerModal = defineAsyncComponent(() => import('~/components/VoiceAssetPickerModal.vue'))

const emotionLabels = [
  { key: 'happy', label: '喜' },
  { key: 'angry', label: '怒' },
  { key: 'sad', label: '哀' },
  { key: 'afraid', label: '惧' },
  { key: 'disgusted', label: '厌恶' },
  { key: 'melancholic', label: '低落' },
  { key: 'surprised', label: '惊喜' },
  { key: 'calm', label: '平静' },
]

const loading = ref(false)
const submitting = ref(false)
const items = ref([])
const text = ref('')
const dramas = ref([])
const filterDramaId = ref('')
const voiceAssets = ref([])
const voicePickerOpen = ref(false)
const voiceFileInput = ref(null)
const uploadingVoice = ref(false)
const selectedAssetVoice = ref(null)
const selectedUploadVoice = ref(null)
const emotionWeight = ref(0.8)
const emotionVector = ref({
  happy: 0, angry: 0, sad: 0, afraid: 0, disgusted: 0, melancholic: 0, surprised: 0, calm: 0,
})

const serverState = ref('checking')
let pollTimer = null

const vectorPreview = computed(() => {
  const keys = emotionLabels.map(s => s.key)
  const vals = keys.map(k => {
    const n = Number(emotionVector.value[k] || 0)
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  })
  return `[${vals.join(', ')}]`
})

const hasVoice = computed(() => !!(selectedAssetVoice.value || selectedUploadVoice.value))
const hasText = computed(() => text.value.trim().length > 0)
const serverReady = computed(() => serverState.value === 'ready')

const canGenerate = computed(() =>
  hasText.value && hasVoice.value && serverReady.value,
)

const generateButtonLabel = computed(() => {
  if (submitting.value) return '提交中…'
  if (serverState.value === 'checking') return '检测服务中…'
  if (!serverReady.value) return '服务未就绪'
  if (!hasText.value) return '请先输入文案'
  if (!hasVoice.value) return '请先选择音色'
  return '生成配音'
})

const statusBannerTitle = computed(() => {
  if (serverState.value === 'checking') return '正在检测云端配音服务…'
  if (serverState.value === 'needs_bindings') return '配音服务需同步节点参数'
  if (serverState.value === 'unconfigured') return '配音服务未配置'
  return '配音服务暂不可用'
})

const statusBannerDetail = computed(() => {
  if (serverState.value === 'checking') return '请稍候'
  if (serverState.value === 'needs_bindings') return '请管理员在设置中同步 RunningHub IndexTTS2 节点参数'
  if (serverState.value === 'unconfigured') return '请管理员配置 RunningHub API Key'
  return '请联系管理员检查 RunningHub 配置'
})

const hasActiveJobs = computed(() =>
  items.value.some(i => i.status === 'pending' || i.status === 'processing'),
)

function formatSec(sec) {
  const n = Number(sec)
  return Number.isFinite(n) && n > 0 ? `${n.toFixed(1)}s` : ''
}

function operatorLabel(item) {
  return item?.operator_name || item?.display_name || item?.username || '—'
}

function formatTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('zh-CN', { hour12: false })
}

function statusLabel(status) {
  const map = {
    pending: '排队中',
    processing: '生成中',
    completed: '完成',
    failed: '失败',
  }
  return map[status] || status || '完成'
}

function statusClass(status) {
  if (status === 'completed') return 'ok'
  if (status === 'failed') return 'err'
  if (status === 'pending' || status === 'processing') return 'pending'
  return ''
}

function ensurePolling() {
  if (hasActiveJobs.value) {
    if (!pollTimer) {
      pollTimer = setInterval(() => { void reloadQuiet() }, 4000)
    }
  } else if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function checkStatus() {
  try {
    const res = await ttsRunninghubAPI.status()
    serverState.value = res?.state || 'unconfigured'
  } catch {
    serverState.value = 'unconfigured'
  }
}

async function ensureDramasLoaded() {
  if (dramas.value.length) return
  try {
    const res = await dramaAPI.list()
    dramas.value = res.items || res || []
  } catch { /* ignore */ }
}

async function loadVoices() {
  try {
    const params = { type: 'voice' }
    if (filterDramaId.value) params.drama_id = Number(filterDramaId.value)
    const res = await assetAPI.list(params)
    voiceAssets.value = Array.isArray(res) ? res : (res?.items || [])
  } catch {
    voiceAssets.value = []
  }
}

async function reload() {
  loading.value = true
  try {
    const res = await ttsRunninghubAPI.list({ limit: 50 })
    items.value = res.items || []
    ensurePolling()
  } catch (err) {
    toast.error(err?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function reloadQuiet() {
  try {
    const res = await ttsRunninghubAPI.list({ limit: 50 })
    items.value = res.items || []
    ensurePolling()
  } catch { /* ignore */ }
}

function triggerVoiceUpload() {
  voiceFileInput.value?.click()
}

async function onVoiceFileChange(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  uploadingVoice.value = true
  try {
    const res = await uploadAPI.audio(file)
    const path = res?.path || res?.local_path || res?.localPath
    if (!path) throw new Error('上传失败')
    selectedUploadVoice.value = {
      name: res?.name || file.name.replace(/\.[^.]+$/, '') || '参考音色',
      path,
      url: res?.url || `/${path}`,
    }
    selectedAssetVoice.value = null
    toast.success('参考音频已上传')
  } catch (err) {
    toast.error(err?.message || '上传失败')
  } finally {
    uploadingVoice.value = false
  }
}

function onVoicePicked(picked) {
  const ref = picked?.[0]
  if (!ref) return
  selectedAssetVoice.value = ref
  selectedUploadVoice.value = null
}

async function generate() {
  if (!canGenerate.value || submitting.value) return
  if (serverState.value !== 'ready') {
    toast.error('RunningHub 配音未就绪，请先在设置中配置 API Key 并同步节点参数')
    return
  }
  submitting.value = true
  try {
    const payload = {
      text: text.value.trim(),
      emotion_vector: { ...emotionVector.value },
      emotion_weight: emotionWeight.value,
    }
    if (filterDramaId.value) payload.drama_id = Number(filterDramaId.value)
    if (selectedAssetVoice.value?.asset_id) {
      payload.voice_asset_id = selectedAssetVoice.value.asset_id
    } else if (selectedAssetVoice.value?.id && selectedAssetVoice.value?.type === 'voice') {
      payload.voice_asset_id = selectedAssetVoice.value.id
    } else if (selectedAssetVoice.value?.path) {
      payload.voice_path = selectedAssetVoice.value.path
    } else if (selectedUploadVoice.value?.path) {
      payload.voice_path = selectedUploadVoice.value.path
    }
    const row = await ttsRunninghubAPI.generate(payload)
    items.value = [row, ...items.value.filter(i => i.id !== row.id)]
    toast.success('已提交，生成中可继续操作，完成后列表会自动更新')
    ensurePolling()
  } catch (err) {
    toast.error(err?.message || '提交失败')
    void checkStatus()
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  void checkStatus()
  try {
    await ensureDramasLoaded()
    await loadVoices()
    await reload()
  } catch (err) {
    toast.error(err?.message || '页面初始化失败')
  }
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<style scoped>
.tts-studio-page {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.studio-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.tts-server-banner {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 0 24px 16px;
  padding: 14px 18px;
  border-radius: 12px;
  border: 2px solid transparent;
  font-size: 14px;
  line-height: 1.35;
}

.tts-server-banner.offline {
  background: rgba(220, 50, 50, 0.14);
  border-color: rgba(220, 50, 50, 0.7);
  color: #b42318;
}

.tts-server-banner.checking {
  background: rgba(180, 140, 40, 0.14);
  border-color: rgba(180, 140, 40, 0.55);
  color: #8a6a12;
}

.tts-server-banner-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tts-server-banner-title {
  font-size: 16px;
  font-weight: 700;
}

.tts-server-banner-detail {
  font-size: 12px;
  opacity: 0.85;
}

.tts-feed {
  flex: 1;
  overflow: auto;
  padding: 0 24px 16px;
}

.tts-history-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tts-history-card {
  padding: 14px 16px;
}

.tts-history-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
  font-size: 12px;
}

.tts-history-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 12px;
}

.tts-history-text {
  margin: 0 0 10px;
  font-size: 13px;
  white-space: pre-wrap;
}

.tts-error {
  color: #c0392b;
  font-size: 12px;
  margin: 0 0 8px;
}

.tag.ok { background: var(--accent-bg, rgba(76,125,255,0.12)); color: var(--accent-text, #1e3f8a); }
.tag.err { background: rgba(192, 57, 43, 0.12); color: #a93226; }
.tag.pending { background: var(--bg-2, #eef3f9); color: var(--text-3, #2e2e2e); }

.tts-audio {
  width: 100%;
  height: 36px;
}

.tts-composer {
  margin: 0 24px 24px;
  padding: 16px;
}

.tts-composer-grid {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 20px;
}

.tts-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}

.tts-textarea {
  width: 100%;
  margin-bottom: 14px;
}

.tts-voice-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.tts-drama-select {
  min-width: 148px;
  max-width: 220px;
}

.tts-voice-file-input {
  display: none;
}

.tts-voice-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  font-size: 12px;
}

.tts-voice-clear {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

.tts-voice-preview {
  width: 100%;
  height: 36px;
  margin-top: 8px;
}

.tts-slider-row {
  display: grid;
  grid-template-columns: 48px 1fr 40px;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
  font-size: 12px;
}

.tts-emotion-hint,
.tts-vector-preview {
  font-size: 12px;
  margin: 0 0 10px;
}

.tts-weight {
  width: 100%;
  margin-bottom: 4px;
}

.tts-composer-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.tts-composer-actions {
  display: flex;
  gap: 8px;
}

@media (max-width: 900px) {
  .tts-composer-grid {
    grid-template-columns: 1fr;
  }
}
</style>
