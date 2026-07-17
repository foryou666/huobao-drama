<template>
  <div class="studio-page narration-canvas-page">
    <header class="studio-header">
      <div class="studio-header-copy">
        <button type="button" class="btn btn-ghost btn-sm narration-back" @click="goList">← 任务列表</button>
        <h1 class="studio-title">{{ job?.title || '解说工作流' }}</h1>
        <p v-if="job" class="studio-desc">
          任务 #{{ job.id }} · {{ stageLabel(job.stage) }}
          <span v-if="segments.length"> · {{ segments.length }} 段旁白</span>
        </p>
      </div>
      <button type="button" class="btn btn-sm" :disabled="loading" @click="loadJob">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </header>

    <div v-if="loadError" class="narration-error-banner">{{ loadError }}</div>
    <div v-else-if="!job && loading" class="studio-empty dim">加载中…</div>

    <template v-else-if="job">
      <div class="narration-workspace">
        <NarrationWorkflowCanvas
          :job="job"
          :segments="segments"
          :analysis="analysis"
          :asset-readiness="assetReadiness"
          :selected-id="selectedNode?.id || ''"
          @select="onSelectNode"
        />

        <aside v-if="selectedNode" class="narration-drawer card">
          <header class="narration-drawer-head">
            <div>
              <p class="narration-drawer-type">{{ drawerTypeLabel }}</p>
              <h2 class="narration-drawer-title">{{ selectedNode.title }}</h2>
            </div>
            <button type="button" class="btn btn-sm btn-ghost" @click="selectedNode = null">关闭</button>
          </header>

          <div class="narration-drawer-body">
            <!-- 分段 -->
            <template v-if="selectedNode.type === 'segment'">
              <p class="dim">按约 <strong>8~10 秒朗读</strong>切分原文，与 Grok 单镜头最长 10 秒对齐；TTS 将逐字朗读下列分段。</p>
              <p v-if="job.error_msg" class="narration-error">{{ job.error_msg }}</p>
              <div class="narration-drawer-actions">
                <button type="button" class="btn btn-primary" :disabled="busy || ttsLocked" @click="runResplit">
                  {{ busy ? '处理中…' : '按 10 秒重新切分' }}
                </button>
                <button type="button" class="btn btn-sm" :disabled="busy" @click="runSegment">
                  仅刷新切分
                </button>
              </div>
              <p v-if="ttsLocked" class="dim">已完成 TTS，无法重新切分。</p>
              <div v-if="segments.length" class="narration-segment-preview">
                <p class="dim">共 {{ segments.length }} 段</p>
                <div v-for="seg in segments" :key="seg.id" class="narration-mini-seg">
                  <strong>段 {{ seg.segment_index + 1 }}</strong>
                  <span class="dim"> · 约 {{ seg.estimated_speech_sec || estimateSpeechSec(seg.text) }}s</span>
                  <span v-if="(seg.estimated_speech_sec || estimateSpeechSec(seg.text)) > GROK_SHOT_MAX_SEC" class="narration-warn-tag">偏长</span>
                  <pre>{{ seg.text }}</pre>
                </div>
              </div>
            </template>

            <!-- 实体抽取 -->
            <template v-else-if="selectedNode.type === 'extract'">
              <p class="dim">LLM 自动抽取实体，并为每段生成 Grok 画面 Prompt。</p>
              <div v-if="hasAnalysis" class="narration-entity-grid">
                <div v-if="analysis.characters?.length" class="narration-entity-block">
                  <h3>角色 ({{ analysis.characters.length }})</h3>
                  <ul>
                    <li v-for="c in analysis.characters" :key="c.id">
                      <strong>{{ c.name }}</strong>
                      <span v-if="c.appearance" class="dim"> · {{ c.appearance.slice(0, 40) }}</span>
                    </li>
                  </ul>
                </div>
                <div v-if="analysis.scenes?.length" class="narration-entity-block">
                  <h3>场景</h3>
                  <ul>
                    <li v-for="s in analysis.scenes" :key="s.id">{{ s.location }} — {{ s.prompt?.slice(0, 50) }}</li>
                  </ul>
                </div>
                <div v-if="analysis.props?.length" class="narration-entity-block">
                  <h3>道具</h3>
                  <ul>
                    <li v-for="p in analysis.props" :key="p.id">{{ p.name }}</li>
                  </ul>
                </div>
              </div>
              <button type="button" class="btn btn-primary" :disabled="busy || extracting" @click="runExtract">
                {{ extracting ? '抽取中…' : hasAnalysis ? '重新抽取' : '开始抽取' }}
              </button>
            </template>

            <!-- 资产节点 -->
            <template v-else-if="selectedNode.type.startsWith('asset-')">
              <p class="dim">gpt-image-2 · {{ selectedNode.subtitle }}</p>
              <div v-if="selectedNode.imageUrl" class="narration-drawer-preview">
                <img :src="mediaDisplayUrl(selectedNode.imageUrl)" :alt="selectedNode.title" />
              </div>
              <p class="dim">状态：{{ assetStatusLabel(selectedNode.status, selectedNode.stageDone) }}</p>
              <button
                type="button"
                class="btn btn-primary"
                :disabled="assetBusy || selectedNode.stageDone || selectedNode.status === 'generating'"
                @click="generateSelectedAsset"
              >
                {{ selectedNode.status === 'generating' ? '生成中…' : selectedNode.stageDone ? '已定稿' : 'AI 生图' }}
              </button>
              <button
                v-if="assetReadiness.items?.length"
                type="button"
                class="btn btn-sm"
                :disabled="assetBusy"
                @click="generateAllAssets"
              >
                一键生成全部缺图
              </button>
            </template>

            <!-- TTS -->
            <template v-else-if="selectedNode.type === 'tts'">
              <p class="dim"><strong>直接朗读小说原文</strong>，不改写。生成前请选择旁白与角色参考音色。</p>

              <div class="narration-voice-section">
                <label class="narration-voice-label">旁白音色</label>
                <div class="narration-voice-grid">
                  <button
                    v-for="v in NARRATION_VOICE_PRESETS"
                    :key="v.voice_id"
                    type="button"
                    class="narration-voice-card"
                    :class="{ active: narratorVoice === v.voice_id, disabled: ttsLocked }"
                    :disabled="ttsLocked"
                    @click="selectNarratorVoice(v.voice_id)"
                  >
                    <strong>{{ v.name }}</strong>
                    <span class="dim">{{ v.gender }} · {{ v.style }}</span>
                    <span
                      v-if="previewVoiceId === v.voice_id && previewAudioUrl"
                      class="narration-voice-preview-link"
                      @click.stop
                    >
                      <audio :src="previewAudioUrl" controls class="narration-audio" />
                    </span>
                    <span
                      v-else
                      class="narration-voice-preview-btn"
                      @click.stop="previewVoice(v.voice_id)"
                    >
                      {{ previewingVoice === v.voice_id ? '生成试听…' : '试听' }}
                    </span>
                  </button>
                </div>
              </div>

              <div v-if="analysis.characters?.length" class="narration-voice-section">
                <label class="narration-voice-label">角色音色（台词段使用）</label>
                <div v-for="c in analysis.characters" :key="c.id" class="narration-char-voice-row">
                  <span class="narration-char-name">{{ c.name }}</span>
                  <select
                    class="input"
                    :value="c.voice_id || ''"
                    :disabled="ttsLocked"
                    @change="setCharacterVoice(c, $event.target.value)"
                  >
                    <option value="">自动分配</option>
                    <option v-for="v in NARRATION_VOICE_PRESETS" :key="c.id + v.voice_id" :value="v.voice_id">
                      {{ v.name }}（{{ v.gender }}）
                    </option>
                  </select>
                </div>
              </div>

              <button type="button" class="btn btn-primary" :disabled="busy || ttsRunning || !narratorVoice" @click="runTTS">
                {{ ttsRunning ? '合成中…' : '批量 TTS 朗读' }}
              </button>
              <p v-if="ttsSummary" class="dim">{{ ttsSummary }}</p>

              <div v-if="segments.some(s => s.tts_audio_url)" class="narration-tts-list">
                <label class="narration-voice-label">已合成旁白</label>
                <div v-for="seg in segments.filter(s => s.tts_audio_url)" :key="seg.id" class="narration-tts-item">
                  <div class="narration-tts-item-head">
                    <strong>段 {{ seg.segment_index + 1 }}</strong>
                    <span class="dim">{{ formatSec(seg.tts_duration_sec) }}</span>
                    <span v-if="seg.duration_mismatch" class="narration-warn-tag">
                      视频需 {{ seg.shots_needed }} 镜或循环
                    </span>
                  </div>
                  <audio :src="mediaDisplayUrl(seg.tts_audio_url)" controls class="narration-audio" />
                </div>
              </div>
            </template>

            <!-- Grok 镜头 -->
            <template v-else-if="selectedNode.type === 'grok'">
              <p class="dim">自动带入本段关联的定稿图作为 Grok 参考（最多 6 张）。</p>
              <div v-if="selectedGrokSeg?.duration_mismatch" class="narration-duration-warn">
                <strong>时长不匹配</strong>
                <p>
                  旁白 {{ formatSec(selectedGrokSeg.tts_duration_sec) }}，Grok 单镜最长 {{ selectedGrokSeg.video_max_sec || GROK_SHOT_MAX_SEC }}s。
                  导出剪映时会<strong>循环视频</strong>铺满旁白；建议将本段拆成 {{ selectedGrokSeg.shots_needed }} 镜或重新切分旁白。
                </p>
              </div>
              <p v-else-if="selectedGrokSeg?.tts_duration_sec" class="dim">
                旁白 {{ formatSec(selectedGrokSeg.tts_duration_sec) }} · 视频最长 {{ selectedGrokSeg.video_max_sec || GROK_SHOT_MAX_SEC }}s
              </p>
              <pre class="narration-segment-text">{{ selectedGrokSeg?.text }}</pre>
              <textarea
                v-if="selectedGrokSeg"
                v-model="selectedGrokSeg.video_prompt"
                class="textarea narration-segment-prompt"
                rows="5"
                placeholder="画面 Prompt"
                @change="saveSegmentPrompt(selectedGrokSeg)"
              />
              <div v-if="selectedGrokSeg?.content_refs?.length" class="narration-ref-list">
                <p class="dim">关联参考图：</p>
                <ul>
                  <li v-for="(ref, i) in selectedGrokSeg.content_refs" :key="i">{{ ref.label }}</li>
                </ul>
              </div>
              <div class="narration-drawer-actions">
                <button type="button" class="btn btn-sm" :disabled="busy" @click="loadJob">刷新</button>
                <button type="button" class="btn btn-sm" :disabled="busy" @click="generateAll">生成全部</button>
                <button
                  v-if="selectedGrokSeg"
                  type="button"
                  class="btn btn-sm btn-primary"
                  :disabled="busy || selectedGrokSeg.status === 'generating'"
                  @click="generateSegment(selectedGrokSeg)"
                >
                  {{ selectedGrokSeg.status === 'generating' ? '生成中…' : '生成此段' }}
                </button>
              </div>
              <audio
                v-if="selectedGrokSeg?.tts_audio_url"
                :src="mediaDisplayUrl(selectedGrokSeg.tts_audio_url)"
                controls
                class="narration-audio"
              />
              <video
                v-if="selectedGrokSeg?.video_url && selectedGrokSeg.status === 'completed' && mediaDisplayUrl(selectedGrokSeg.video_url)"
                :src="mediaDisplayUrl(selectedGrokSeg.video_url)"
                controls
                playsinline
                class="narration-segment-video"
              />
              <p
                v-else-if="selectedGrokSeg?.video_url && selectedGrokSeg.status === 'completed'"
                class="dim"
              >
                视频地址加载中…
              </p>
              <p v-if="selectedGrokSeg?.error_msg" class="narration-error">{{ selectedGrokSeg.error_msg }}</p>
            </template>

            <!-- 导出 -->
            <template v-else-if="selectedNode.type === 'export'">
              <p class="dim">将旁白音频与 Grok 视频按时间轴对齐，生成剪映草稿。</p>
              <button type="button" class="btn btn-primary" :disabled="busy || exporting" @click="runExport">
                {{ exporting ? '导出中…' : '导出剪映草稿' }}
              </button>
              <a
                v-if="job.jianying_draft_url"
                :href="mediaDisplayUrl(job.jianying_draft_url)"
                class="btn"
                target="_blank"
                rel="noopener"
              >
                打开草稿目录
              </a>
            </template>
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>

<script setup>
import { narrationAPI } from '~/composables/useApi'
import { NARRATION_STAGE_LABELS } from '~/constants/narration-steps.js'
import { NARRATION_VOICE_PRESETS, DEFAULT_NARRATION_VOICE_ID, GROK_SHOT_MAX_SEC, estimateSpeechSec, findNarrationVoicePreset } from '~/constants/narration-voices.js'
import { mediaDisplayUrl, prefetchMediaUrlsInBackground, collectMediaPrefetchPaths } from '~/utils/media-url.js'
import { toast } from 'vue-sonner'
import NarrationWorkflowCanvas from '~/components/NarrationWorkflowCanvas.vue'

const route = useRoute()
const router = useRouter()
const jobId = computed(() => Number(route.params.id))

const loading = ref(false)
const busy = ref(false)
const extracting = ref(false)
const ttsRunning = ref(false)
const exporting = ref(false)
const assetBusy = ref(false)
const loadError = ref('')
const job = ref(null)
const segments = ref([])
const analysis = ref({ characters: [], scenes: [], props: [], segment_meta: [] })
const assetReadiness = ref({ items: [], ready: false, total: 0, ready_count: 0 })
const selectedNode = ref(null)
const narratorVoice = ref('')
const ttsSummary = ref('')
const previewingVoice = ref('')
const previewVoiceId = ref('')
const previewAudioUrl = ref('')

let assetPollTimer = null

const ttsLocked = computed(() =>
  segments.value.some(s => s.tts_audio_url || s.status === 'tts_done' || s.tts_voice),
)

const hasAnalysis = computed(() =>
  (analysis.value.characters?.length || 0) + (analysis.value.scenes?.length || 0) > 0,
)

const selectedGrokSeg = computed(() => {
  if (selectedNode.value?.type !== 'grok') return null
  const id = selectedNode.value.data?.seg?.id
  return segments.value.find(s => s.id === id) || selectedNode.value.data?.seg
})

const drawerTypeLabel = computed(() => {
  const t = selectedNode.value?.type
  if (t === 'segment') return '旁白分段'
  if (t === 'extract') return '实体抽取'
  if (t?.startsWith('asset-character')) return '角色三视图'
  if (t?.startsWith('asset-scene')) return '场景定稿'
  if (t?.startsWith('asset-prop')) return '道具定稿'
  if (t === 'tts') return 'TTS 朗读'
  if (t === 'grok') return 'Grok 视频'
  if (t === 'export') return '剪映导出'
  return '节点'
})

function stageLabel(stage) {
  return NARRATION_STAGE_LABELS[stage] || stage
}

function assetStatusLabel(status, done) {
  if (done) return '已定稿'
  if (status === 'generating') return '生成中…'
  if (status === 'failed') return '生成失败'
  return '待生成'
}

function prefetchJobMedia(data) {
  const paths = collectMediaPrefetchPaths(
    ...(data.segments || []).flatMap(s => [
      s.video_url,
      s.tts_audio_url,
      ...(s.content_refs || []).map(r => r.url),
    ]),
    ...(data.asset_readiness?.items || []).map(i => i.image_url),
  )
  if (paths.length) prefetchMediaUrlsInBackground(paths)
}

function applyJob(data) {
  job.value = data
  segments.value = (data.segments || []).map(s => ({ ...s }))
  analysis.value = data.analysis || { characters: [], scenes: [], props: [], segment_meta: [] }
  assetReadiness.value = data.asset_readiness || {
    items: [],
    ready: false,
    total: 0,
    ready_count: 0,
  }
  narratorVoice.value = data.narrator_voice || DEFAULT_NARRATION_VOICE_ID
  prefetchJobMedia(data)

  if (selectedNode.value) {
    const id = selectedNode.value.id
    if (id.startsWith('grok-')) {
      const segId = Number(id.replace('grok-', ''))
      const seg = segments.value.find(s => s.id === segId)
      if (seg) {
        selectedNode.value = {
          ...selectedNode.value,
          stageDone: seg.status === 'completed',
          status: seg.status,
          imageUrl: null,
          videoUrl: seg.video_url && seg.status === 'completed' ? seg.video_url : null,
          data: { seg, refCount: (seg.content_refs || []).length },
        }
      }
    } else if (id.startsWith('asset-')) {
      const item = assetReadiness.value.items?.find(
        r => `asset-${r.type}-${r.id}` === id,
      )
      if (item) {
        selectedNode.value = {
          ...selectedNode.value,
          stageDone: item.has_image,
          status: item.image_status,
          imageUrl: item.image_url,
        }
      }
    }
  }
}

function onSelectNode(node) {
  selectedNode.value = node
}

async function onAssetsUpdated(payload) {
  if (payload) {
    applyJob(payload)
    return
  }
  try {
    const data = await narrationAPI.get(jobId.value)
    applyJob(data)
  } catch { /* poll */ }
}

function startAssetPoll() {
  stopAssetPoll()
  assetPollTimer = setInterval(() => onAssetsUpdated(), 4000)
}

function stopAssetPoll() {
  if (assetPollTimer) {
    clearInterval(assetPollTimer)
    assetPollTimer = null
  }
}

async function loadJob() {
  if (!jobId.value) return
  loading.value = true
  loadError.value = ''
  try {
    const data = await narrationAPI.get(jobId.value)
    applyJob(data)
    if (assetReadiness.value.items?.some(i => i.image_status === 'generating')) {
      startAssetPoll()
    }
  } catch (err) {
    loadError.value = err?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function goList() {
  router.push('/narration')
}

async function runSegment() {
  busy.value = true
  try {
    const data = await narrationAPI.segment(jobId.value)
    applyJob(data)
    toast.success('旁白已重新切分')
  } catch (err) {
    toast.error(err?.message || '切分失败')
  } finally {
    busy.value = false
  }
}

async function runExtract() {
  extracting.value = true
  busy.value = true
  try {
    const data = await narrationAPI.extract(jobId.value)
    applyJob(data)
    toast.success('实体抽取完成')
  } catch (err) {
    toast.error(err?.message || '抽取失败')
  } finally {
    extracting.value = false
    busy.value = false
  }
}

function apiAssetType(type) {
  if (type === 'character') return 'characters'
  if (type === 'scene') return 'scenes'
  return 'props'
}

async function generateSelectedAsset() {
  const item = selectedNode.value?.data?.item
    || assetReadiness.value.items?.find(r => `asset-${r.type}-${r.id}` === selectedNode.value?.id)
  if (!item) return
  assetBusy.value = true
  try {
    const res = await narrationAPI.generateAsset(jobId.value, apiAssetType(item.type), item.id)
    applyJob(res.job || res)
    toast.success(`${item.name} 已提交生图`)
    startAssetPoll()
  } catch (err) {
    toast.error(err?.message || '生图失败')
  } finally {
    assetBusy.value = false
  }
}

async function generateAllAssets() {
  assetBusy.value = true
  try {
    const res = await narrationAPI.generateAllAssets(jobId.value)
    applyJob(res.job || res)
    toast.success('已提交批量生图')
    startAssetPoll()
  } catch (err) {
    toast.error(err?.message || '批量生图失败')
  } finally {
    assetBusy.value = false
  }
}

function formatSec(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return `${n.toFixed(1)}s`
}

async function selectNarratorVoice(voiceId) {
  narratorVoice.value = voiceId
  await saveVoice()
}

async function previewVoice(voiceId) {
  previewingVoice.value = voiceId
  try {
    const preset = findNarrationVoicePreset(voiceId)
    const res = await narrationAPI.previewVoice(jobId.value, { voice_id: voiceId })
    previewVoiceId.value = voiceId
    previewAudioUrl.value = mediaDisplayUrl(res.audio_url)
  } catch (err) {
    toast.error(err?.message || '试听失败')
  } finally {
    previewingVoice.value = ''
  }
}

async function setCharacterVoice(char, voiceId) {
  char.voice_id = voiceId || undefined
  try {
    const data = await narrationAPI.patchAnalysis(jobId.value, analysis.value)
    applyJob(data)
    toast.success(`${char.name} 音色已保存`)
  } catch (err) {
    toast.error(err?.message || '保存失败')
  }
}

async function runResplit() {
  busy.value = true
  try {
    const data = await narrationAPI.resplitSegments(jobId.value)
    applyJob(data)
    toast.success('已按约 10 秒重新切分')
  } catch (err) {
    toast.error(err?.message || '切分失败')
  } finally {
    busy.value = false
  }
}

async function saveVoice() {
  try {
    const data = await narrationAPI.patch(jobId.value, { narrator_voice: narratorVoice.value })
    applyJob(data)
  } catch (err) {
    toast.error(err?.message || '保存失败')
  }
}

async function runTTS() {
  ttsRunning.value = true
  busy.value = true
  ttsSummary.value = ''
  try {
    const res = await narrationAPI.tts(jobId.value)
    applyJob(res.job || res)
    ttsSummary.value = `完成 ${res.tts_done || 0} 段${res.errors?.length ? `，失败：${res.errors.join('; ')}` : ''}`
    toast.success('TTS 批量完成')
  } catch (err) {
    toast.error(err?.message || 'TTS 失败')
  } finally {
    ttsRunning.value = false
    busy.value = false
  }
}

async function saveSegmentPrompt(seg) {
  try {
    await narrationAPI.patchSegment(jobId.value, seg.id, { video_prompt: seg.video_prompt })
  } catch (err) {
    toast.error(err?.message || '保存失败')
  }
}

async function generateSegment(seg) {
  busy.value = true
  try {
    await narrationAPI.generateSegment(jobId.value, seg.id)
    toast.success(`段 ${seg.segment_index + 1} 已提交生成`)
    await loadJob()
  } catch (err) {
    toast.error(err?.message || '生成失败')
  } finally {
    busy.value = false
  }
}

async function generateAll() {
  busy.value = true
  try {
    const res = await narrationAPI.generateAll(jobId.value)
    applyJob(res.job || res)
    toast.success(`已提交 ${res.queued || 0} 段`)
    if (res.errors?.length) toast.warning(`部分失败：${res.errors.join(', ')}`)
  } catch (err) {
    toast.error(err?.message || '批量生成失败')
  } finally {
    busy.value = false
  }
}

async function runExport() {
  exporting.value = true
  busy.value = true
  try {
    const data = await narrationAPI.exportJianying(jobId.value)
    applyJob(data)
    toast.success('剪映草稿已导出')
  } catch (err) {
    toast.error(err?.message || '导出失败')
  } finally {
    exporting.value = false
    busy.value = false
  }
}

onMounted(loadJob)
onUnmounted(stopAssetPoll)
watch(() => route.params.id, loadJob)
</script>

<style scoped>
.narration-canvas-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.studio-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 24px 8px;
  flex-shrink: 0;
}

.studio-title {
  margin: 4px 0 0;
  font-size: 22px;
}

.studio-desc {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-1);
}

.narration-back {
  padding-left: 0;
}

.narration-error-banner {
  margin: 0 24px;
  padding: 12px;
  color: var(--danger, #e57373);
}

.narration-workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 0;
  overflow: hidden;
}

.narration-drawer {
  width: min(420px, 38vw);
  flex-shrink: 0;
  margin: 0 16px 16px 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border-radius: 12px;
}

.narration-drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.narration-drawer-type {
  margin: 0;
  font-size: 11px;
  color: var(--text-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.narration-drawer-title {
  margin: 4px 0 0;
  font-size: 18px;
}

.narration-drawer-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.narration-drawer-preview img {
  width: 100%;
  border-radius: 8px;
  object-fit: contain;
  max-height: 280px;
  background: var(--bg-2);
}

.narration-drawer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.narration-error {
  color: var(--danger, #e57373);
  font-size: 13px;
}

.narration-segment-preview {
  margin-top: 8px;
}

.narration-mini-seg {
  margin-top: 10px;
}

.narration-mini-seg pre {
  margin: 6px 0 0;
  font-size: 12px;
  white-space: pre-wrap;
  background: var(--bg-2);
  padding: 8px;
  border-radius: 8px;
  max-height: 100px;
  overflow: auto;
}

.narration-entity-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.narration-entity-block ul {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 12px;
}

.narration-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.narration-segment-text {
  font-size: 12px;
  margin: 0;
  white-space: pre-wrap;
  background: var(--bg-2);
  padding: 10px;
  border-radius: 8px;
  max-height: 120px;
  overflow: auto;
}

.narration-segment-prompt {
  width: 100%;
}

.narration-ref-list ul {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 12px;
}

.narration-audio {
  width: 100%;
  height: 32px;
}

.narration-voice-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.narration-voice-label {
  font-size: 12px;
  font-weight: 600;
}

.narration-voice-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.narration-voice-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  background: var(--bg-2);
  text-align: left;
  cursor: pointer;
}

.narration-voice-card.active {
  border-color: rgba(120, 170, 255, 0.65);
  box-shadow: 0 0 0 1px rgba(120, 170, 255, 0.25);
}

.narration-voice-card.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.narration-voice-preview-btn {
  font-size: 11px;
  color: var(--accent, #7eb0ff);
}

.narration-char-voice-row {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 8px;
  align-items: center;
}

.narration-char-name {
  font-size: 12px;
}

.narration-tts-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
}

.narration-tts-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-radius: 8px;
  background: var(--bg-2);
}

.narration-tts-item-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.narration-warn-tag {
  font-size: 11px;
  color: #ffb86c;
  border: 1px solid rgba(255, 184, 108, 0.35);
  border-radius: 999px;
  padding: 1px 8px;
}

.narration-duration-warn {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 184, 108, 0.08);
  border: 1px solid rgba(255, 184, 108, 0.25);
  font-size: 12px;
}

.narration-duration-warn p {
  margin: 6px 0 0;
  color: var(--text-dim);
}

.narration-segment-video {
  width: 100%;
  border-radius: 8px;
}

.studio-empty {
  padding: 32px;
  text-align: center;
}
</style>
