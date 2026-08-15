<template>
  <div class="studio-page tts-studio-page">
    <header class="studio-header">
      <div class="studio-header-copy">
        <h1 class="studio-title">AI 配音</h1>
        <p class="studio-desc">从音色库选择或本地上传参考音频（3~10 秒），输入文案生成配音；支持情绪文字描述或滑条调节（IndexTTS2）</p>
      </div>
    </header>

    <div
      class="tts-server-banner"
      :class="{
        online: serverState === 'online',
        offline: serverState === 'offline' || serverState === 'unconfigured',
        checking: serverState === 'checking',
      }"
      role="status"
    >
      <div class="tts-server-banner-icon" aria-hidden="true">
        <svg v-if="serverState === 'online'" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2v4" />
          <path d="M12 18v4" />
          <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
          <path d="M4.9 4.9l2.8 2.8" />
          <path d="M16.3 16.3l2.8 2.8" />
          <path d="M2 12h4" />
          <path d="M18 12h4" />
          <path d="M4.9 19.1l2.8-2.8" />
          <path d="M16.3 7.7l2.8-2.8" />
        </svg>
        <svg v-else-if="serverState === 'checking'" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <circle cx="12" cy="12" r="9" opacity="0.35" />
          <path d="M21 12a9 9 0 0 0-9-9" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18.4 18.4A9 9 0 0 1 5.6 5.6" />
          <path d="M9.2 4.3A9 9 0 0 1 19.7 14.8" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <path d="M4 4l16 16" />
        </svg>
      </div>
      <div class="tts-server-banner-copy">
        <strong class="tts-server-banner-title">{{ serverBannerTitle }}</strong>
        <span class="tts-server-banner-detail">{{ serverBannerDetail }}</span>
      </div>
      <button
        type="button"
        class="btn btn-sm tts-server-banner-refresh"
        :disabled="serverChecking"
        @click="checkServerStatus(true)"
      >
        {{ serverChecking ? '检测中…' : '重新检测' }}
      </button>
    </div>

    <div class="tts-feed">
      <div v-if="loading && !items.length" class="studio-empty card dim">加载中…</div>
      <div v-else-if="!items.length" class="studio-empty card">
        <p>还没有配音记录，在下方输入文本并生成</p>
      </div>
      <div v-else class="tts-history-list">
        <article v-for="item in items" :key="item.id" class="tts-history-card card">
          <div class="tts-history-head">
            <strong>#{{ item.id }}</strong>
            <span class="dim">{{ item.voice_name || '音色' }}</span>
            <span v-if="item.duration_sec" class="dim">{{ formatSec(item.duration_sec) }}</span>
            <span v-if="item.emotion_mode && item.emotion_mode !== 'same'" class="tag">{{ emotionLabel(item) }}</span>
          </div>
          <p class="tts-history-text">{{ item.text }}</p>
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
            <button type="button" class="btn btn-sm" @click="router.push('/assets?type=voice')">管理音色库</button>
            <input
              ref="voiceFileInput"
              type="file"
              class="tts-voice-file-input"
              accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/*"
              @change="onVoiceFileChange"
            />
            <span v-if="selectedAssetVoice" class="tts-voice-pill">
              库：{{ selectedAssetVoice.name }}
              <button type="button" class="tts-voice-clear" @click="clearAssetVoice">×</button>
            </span>
            <span v-else-if="selectedUploadVoice" class="tts-voice-pill">
              上传：{{ selectedUploadVoice.name }}
              <button type="button" class="tts-voice-clear" @click="clearUploadVoice">×</button>
            </span>
            <span v-else-if="selectedPreset" class="dim">内置：{{ selectedPreset.name }}</span>
            <span v-else class="dim">未选择音色</span>
          </div>
          <audio
            v-if="selectedUploadVoice?.url"
            class="tts-voice-preview"
            :src="mediaDisplayUrl(selectedUploadVoice.url)"
            controls
            preload="metadata"
          />

          <div class="tts-preset-grid">
            <button
              v-for="p in voicePresets"
              :key="p.voice_id"
              type="button"
              class="tts-preset-btn"
              :class="{ active: !selectedAssetVoice && selectedPresetId === p.voice_id }"
              @click="selectPreset(p.voice_id)"
            >
              {{ p.name }}
            </button>
          </div>
        </div>

        <div class="tts-composer-side">
          <label class="tts-label">情绪控制</label>
          <div class="tts-emotion-tabs">
            <button
              v-for="m in emotionModes"
              :key="m.id"
              type="button"
              class="tts-emotion-tab"
              :class="{ active: emotionMode === m.id }"
              @click="emotionMode = m.id"
            >
              {{ m.label }}
            </button>
          </div>

          <template v-if="emotionMode === 'text'">
            <input v-model="emotionText" class="input" placeholder="如：开心、悬疑、温柔低沉…" />
            <div class="tts-quick-presets">
              <button
                v-for="p in emotionQuickPresets"
                :key="p.id"
                type="button"
                class="btn btn-sm"
                @click="applyEmotionPreset(p)"
              >
                {{ p.label }}
              </button>
            </div>
          </template>

          <template v-else-if="emotionMode === 'vector'">
            <div v-for="s in emotionVectorLabels" :key="s.key" class="tts-slider-row">
              <span>{{ s.label }}</span>
              <input v-model.number="emotionVector[s.key]" type="range" min="0" max="1.4" step="0.05" />
              <span class="dim mono">{{ Number(emotionVector[s.key] || 0).toFixed(1) }}</span>
            </div>
          </template>

          <p v-else class="dim tts-emotion-hint">情绪与参考音色保持一致</p>

          <label class="tts-label">情绪权重</label>
          <input v-model.number="emotionWeight" type="range" min="0" max="1.6" step="0.05" class="tts-weight" />
          <span class="dim mono">{{ emotionWeightLabel }}</span>
        </div>
      </div>

      <div class="tts-composer-foot">
        <span class="dim tts-composer-count">{{ text.length }} 字</span>
        <div class="tts-composer-actions">
          <button type="button" class="btn btn-sm" :disabled="loading" @click="reload">
            {{ loading ? '刷新中…' : '刷新' }}
          </button>
          <button type="button" class="btn btn-primary" :disabled="generating || !canGenerate || !serverOnline" @click="generate">
            {{ !serverOnline ? '服务器未开机' : generating ? '生成中…' : '生成配音' }}
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
import { ttsAPI, dramaAPI, assetAPI, uploadAPI } from '~/composables/useApi'
import { NARRATION_VOICE_PRESETS } from '~/constants/narration-voices.js'
import { TTS_EMOTION_MODES, TTS_EMOTION_VECTOR_LABELS, TTS_EMOTION_QUICK_PRESETS } from '~/constants/tts-studio.js'
import { mediaDisplayUrl } from '~/utils/media-url.js'
import { toast } from 'vue-sonner'

const VoiceAssetPickerModal = defineAsyncComponent(() => import('~/components/VoiceAssetPickerModal.vue'))

const voicePresets = NARRATION_VOICE_PRESETS
const emotionModes = TTS_EMOTION_MODES
const emotionVectorLabels = TTS_EMOTION_VECTOR_LABELS
const emotionQuickPresets = TTS_EMOTION_QUICK_PRESETS

const router = useRouter()

const loading = ref(false)
const generating = ref(false)
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
const selectedPresetId = ref('voice_01')
const emotionMode = ref('same')
const emotionText = ref('')
const emotionWeight = ref(0.8)
const emotionVector = ref({
  happy: 0, angry: 0, sad: 0, afraid: 0, disgusted: 0, melancholic: 0, surprised: 0, calm: 0,
})

/** checking | online | offline | unconfigured */
const serverState = ref('checking')
const serverLabel = ref('正在检测 TTS 服务器状态…')
const serverDetail = ref('')
const serverChecking = ref(false)
let serverPollTimer = null

const serverOnline = computed(() => serverState.value === 'online')
const serverBannerTitle = computed(() => {
  if (serverState.value === 'online') return '当前 TTS 服务器已开机，正常使用'
  if (serverState.value === 'checking') return '正在检测 TTS 服务器状态…'
  if (serverState.value === 'unconfigured') return '当前 TTS 服务器未配置，暂停使用'
  return '当前 TTS 服务器已关机'
})
const serverBannerDetail = computed(() => {
  if (serverState.value === 'online') return serverDetail.value || '可正常生成配音'
  if (serverState.value === 'checking') return '请稍候'
  if (serverState.value === 'unconfigured') return serverDetail.value || '请联系管理员配置 IndexTTS2'
  return '如需使用配音功能，请向管理员申请开机。'
})

const selectedPreset = computed(() =>
  voicePresets.find(p => p.voice_id === selectedPresetId.value) || null,
)

const emotionWeightLabel = computed(() => {
  const n = Number(emotionWeight.value)
  return Number.isFinite(n) ? n.toFixed(2) : '0.80'
})

const canGenerate = computed(() =>
  text.value.trim().length > 0 && (selectedAssetVoice.value || selectedUploadVoice.value || selectedPresetId.value),
)

async function checkServerStatus(force = false) {
  if (serverChecking.value && !force) return
  serverChecking.value = true
  if (serverState.value !== 'online' && serverState.value !== 'offline' && serverState.value !== 'unconfigured') {
    serverState.value = 'checking'
  }
  try {
    const res = await ttsAPI.status({ force })
    serverState.value = res?.state || (res?.online ? 'online' : 'offline')
    serverLabel.value = res?.label || serverBannerTitle.value
    serverDetail.value = res?.detail || ''
  } catch (err) {
    serverState.value = 'offline'
    serverLabel.value = '当前 TTS 服务器已关机。如需使用配音功能，请向管理员申请开机。'
    serverDetail.value = err?.message || '无法获取服务器状态'
  } finally {
    serverChecking.value = false
  }
}

function formatSec(sec) {
  const n = Number(sec)
  return Number.isFinite(n) && n > 0 ? `${n.toFixed(1)}s` : ''
}

function emotionLabel(item) {
  if (item.emotion_mode === 'text') return item.emotion_text || '文字情绪'
  if (item.emotion_mode === 'vector') return '滑条情绪'
  return ''
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
    const params = {}
    if (filterDramaId.value) params.drama_id = Number(filterDramaId.value)
    params.type = 'voice'
    const res = await assetAPI.list(params)
    voiceAssets.value = Array.isArray(res) ? res : (res?.items || [])
  } catch {
    voiceAssets.value = []
  }
}

async function reload() {
  loading.value = true
  try {
    const res = await ttsAPI.list({ limit: 50 })
    items.value = res.items || []
  } catch (err) {
    toast.error(err?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function selectPreset(voiceId) {
  selectedPresetId.value = voiceId
  selectedAssetVoice.value = null
  selectedUploadVoice.value = null
}

function clearAssetVoice() {
  selectedAssetVoice.value = null
}

function clearUploadVoice() {
  selectedUploadVoice.value = null
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
      duration_sec: res?.duration_sec ?? res?.durationSec,
    }
    selectedAssetVoice.value = null
    selectedPresetId.value = ''
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
  selectedPresetId.value = ''
  selectedUploadVoice.value = null
}

function applyEmotionPreset(preset) {
  emotionMode.value = preset.mode
  if (preset.mode === 'text') emotionText.value = preset.text
}

function buildPayload() {
  const payload = {
    text: text.value.trim(),
    emotion_mode: emotionMode.value,
    emotion_weight: emotionWeight.value,
  }
  if (filterDramaId.value) payload.drama_id = Number(filterDramaId.value)

  if (selectedAssetVoice.value?.asset_id) {
    payload.voice_asset_id = selectedAssetVoice.value.asset_id
  } else if (selectedAssetVoice.value?.path) {
    payload.voice_path = selectedAssetVoice.value.path
  } else if (selectedUploadVoice.value?.path) {
    payload.voice_path = selectedUploadVoice.value.path
  } else {
    payload.voice_id = selectedPresetId.value || 'voice_01'
  }

  if (emotionMode.value === 'text') {
    payload.emotion_text = emotionText.value.trim()
  } else if (emotionMode.value === 'vector') {
    payload.emotion_vector = { ...emotionVector.value }
  }
  return payload
}

async function generate() {
  if (!serverOnline.value) {
    toast.error('当前 TTS 服务器已关机。如需使用配音功能，请向管理员申请开机。')
    return
  }
  generating.value = true
  try {
    const row = await ttsAPI.generate(buildPayload())
    items.value = [row, ...items.value.filter(i => i.id !== row.id)]
    toast.success('配音已生成')
  } catch (err) {
    toast.error(err?.message || '生成失败')
    void checkServerStatus(true)
  } finally {
    generating.value = false
  }
}

onMounted(async () => {
  void checkServerStatus(true)
  serverPollTimer = setInterval(() => { void checkServerStatus(false) }, 60_000)
  try {
    await ensureDramasLoaded()
    await loadVoices()
    await reload()
  } catch (err) {
    console.error('[tts] init failed', err)
    toast.error(err?.message || '页面初始化失败')
  }
})

onUnmounted(() => {
  if (serverPollTimer) {
    clearInterval(serverPollTimer)
    serverPollTimer = null
  }
})
</script>

<style scoped>
.tts-studio-page {
  display: flex;
  flex-direction: column;
  min-height: 100%;
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

.tts-server-banner.online {
  background: rgba(46, 160, 67, 0.16);
  border-color: rgba(46, 160, 67, 0.65);
  color: #1b7a32;
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

.tts-server-banner-icon {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.55);
}

.tts-server-banner.online .tts-server-banner-icon {
  color: #1b7a32;
  box-shadow: 0 0 0 3px rgba(46, 160, 67, 0.25);
}

.tts-server-banner.offline .tts-server-banner-icon {
  color: #b42318;
  box-shadow: 0 0 0 3px rgba(220, 50, 50, 0.25);
}

.tts-server-banner.checking .tts-server-banner-icon {
  color: #8a6a12;
  animation: tts-spin 1s linear infinite;
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
  letter-spacing: 0.01em;
}

.tts-server-banner-detail {
  font-size: 12px;
  opacity: 0.85;
}

.tts-server-banner-refresh {
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.7);
}

@keyframes tts-spin {
  to { transform: rotate(360deg); }
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
  margin-bottom: 8px;
  font-size: 12px;
}

.tts-history-text {
  margin: 0 0 10px;
  font-size: 13px;
  white-space: pre-wrap;
}

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

.tts-voice-preview {
  width: 100%;
  height: 36px;
  margin-bottom: 10px;
}

.tts-voice-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--bg-2);
  font-size: 12px;
}

.tts-voice-clear {
  border: none;
  background: none;
  cursor: pointer;
  color: var(--text-dim);
}

.tts-preset-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tts-preset-btn {
  border: 1px solid var(--border);
  background: var(--bg-2);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
}

.tts-preset-btn.active {
  border-color: var(--primary);
  color: var(--primary);
}

.tts-emotion-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.tts-emotion-tab {
  border: 1px solid var(--border);
  background: var(--bg-2);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}

.tts-emotion-tab.active {
  border-color: var(--primary);
}

.tts-quick-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.tts-slider-row {
  display: grid;
  grid-template-columns: 48px 1fr 36px;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  margin-bottom: 6px;
}

.tts-emotion-hint {
  font-size: 12px;
  margin: 0 0 10px;
}

.tts-weight {
  width: 100%;
  margin-bottom: 4px;
}

.tts-composer-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.tts-composer-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.studio-filter-select {
  min-width: 140px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  color: var(--text);
  font-size: 12px;
}

@media (max-width: 900px) {
  .tts-composer-grid {
    grid-template-columns: 1fr;
  }

  .tts-composer-foot {
    flex-direction: column;
    align-items: stretch;
  }

  .tts-composer-actions {
    margin-left: 0;
    justify-content: flex-end;
  }
}
</style>
