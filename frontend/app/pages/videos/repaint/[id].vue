<template>
  <div class="studio-page">
    <header class="studio-header">
      <div class="studio-header-copy">
        <button type="button" class="btn btn-ghost btn-sm repaint-back" @click="goList">← 任务列表</button>
        <h1 class="studio-title">{{ job?.title || '视频转绘' }}</h1>
        <p v-if="job" class="studio-desc">
          任务 #{{ job.id }}
          <span v-if="job.source_duration"> · 原片 {{ formatDuration(job.source_duration) }}</span>
          · 当前：{{ stageLabel(job.stage) }}
        </p>
      </div>
      <div class="studio-header-actions">
        <button type="button" class="btn btn-sm" :disabled="loading" @click="loadJob">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </header>

    <nav class="repaint-steps" aria-label="转绘步骤">
      <button
        v-for="(step, idx) in REPAINT_STAGES"
        :key="step.id"
        type="button"
        class="repaint-step"
        :class="{
          active: activeStepIndex === idx,
          done: stepIndex(job?.stage) > idx,
          current: job?.stage === step.id || (step.id === 'analysis' && job?.stage === 'upload'),
        }"
        @click="activeStepIndex = idx"
      >
        <span class="repaint-step-num">{{ idx + 1 }}</span>
        <span class="repaint-step-text">
          <strong>{{ step.label }}</strong>
          <small>{{ step.desc }}</small>
        </span>
      </button>
    </nav>

    <div v-if="loadError" class="repaint-panel card">{{ loadError }}</div>
    <div v-else-if="!job && loading" class="studio-empty dim">加载中…</div>

    <div v-else-if="job" class="repaint-panel card">
      <!-- 步骤 1：分析 -->
      <section v-show="activeStepIndex === 0" class="repaint-section">
        <h2>1. 分析原片</h2>
        <p class="dim">自动切镜、ASR 台词、抽取角色 / 场景 / 道具清单。完成后可编辑再进入资产生成。</p>

        <div v-if="job.source_video_url" class="repaint-preview">
          <video :src="mediaDisplayUrl(job.source_video_url)" controls playsinline class="repaint-video" />
        </div>

        <div v-if="job.analysis?.shots?.length" class="repaint-analysis">
          <div class="repaint-stats">
            <span>镜头 {{ job.analysis.shots.length }}</span>
            <span>台词 {{ job.analysis.utterances?.length || 0 }}</span>
            <span>角色 {{ job.analysis.characters?.length || 0 }}</span>
            <span>场景 {{ job.analysis.scenes?.length || 0 }}</span>
            <span>道具 {{ job.analysis.props?.length || 0 }}</span>
          </div>

          <RepaintAnalysisEditor
            :analysis="draftAnalysis"
            :total-duration="job.source_duration || 0"
            @update="onAnalysisDraftChange"
          />

          <div class="repaint-actions repaint-actions-inline">
            <button type="button" class="btn btn-sm" :disabled="busy || !analysisDirty" @click="saveAnalysis">
              {{ busy ? '保存中…' : analysisDirty ? '保存修改' : '已保存' }}
            </button>
          </div>
        </div>

        <p v-if="analyzing" class="repaint-progress dim">
          正在分析：切镜 → 提取音频 → ASR → 实体抽取 → 视觉理解（逐镜关键帧）。2 分钟视频通常需 2–5 分钟，请耐心等待。
        </p>

        <p v-if="job.error_msg" class="repaint-error">{{ job.error_msg }}</p>

        <div class="repaint-actions">
          <button
            type="button"
            class="btn btn-primary"
            :disabled="busy || analyzing"
            @click="runAnalyze"
          >
            {{ analyzing ? '分析中…' : hasAnalysis ? '重新分析' : '开始分析' }}
          </button>
          <button
            type="button"
            class="btn"
            :disabled="busy || !hasAnalysis"
            @click="confirmStage('analysis')"
          >
            确认分析，进入资产
          </button>
        </div>
      </section>

      <!-- 步骤 2：资产 -->
      <section v-show="activeStepIndex === 1" class="repaint-section">
        <h2>2. 角色 / 场景 / 道具</h2>
        <p class="dim">三类资产需<strong>分别生成</strong>定稿图。可直接在此页 AI 生图或上传，无需进入工作台。</p>

        <div v-if="readiness" class="repaint-readiness">
          <p :class="readiness.ready ? 'repaint-ok' : 'repaint-warn'">
            {{ readiness.ready ? '资产已就绪，可进入分段 Prompt' : `尚有 ${readiness.missing?.length || 0} 项缺图` }}
          </p>
        </div>

        <RepaintAssetPanel
          v-if="job.drama_id && job.episode_id"
          :drama-id="job.drama_id"
          :episode-id="job.episode_id"
          :analysis="job.analysis"
          @updated="onAssetsUpdated"
        />

        <div class="repaint-actions">
          <button type="button" class="btn btn-sm" :disabled="busy" @click="checkReadiness">
            检查就绪状态
          </button>
          <button type="button" class="btn btn-sm" :disabled="!job.drama_id" @click="openDramaWorkbench">
            高级：打开工作台
          </button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="busy || !readiness?.ready"
            @click="confirmStage('assets')"
          >
            确认资产，进入分段
          </button>
        </div>
      </section>

      <!-- 步骤 3：分段 Prompt -->
      <section v-show="activeStepIndex === 2" class="repaint-section">
        <h2>3. 分段 Prompt</h2>
        <p class="dim">按 4–15 秒打包 Seedance 段，绑定 @图片N 到已定稿的角色 / 场景 / 道具。段级 prompt 可单独修改。</p>

        <div class="repaint-actions repaint-actions-inline">
          <button type="button" class="btn btn-sm" :disabled="busy" @click="loadSegments">
            刷新分段
          </button>
          <button type="button" class="btn btn-sm" :disabled="busy" @click="rebuildSegments">
            {{ busy ? '生成 Prompt 中…' : '重新打包 Prompt' }}
          </button>
        </div>

        <div v-if="!segments.length" class="dim repaint-soon">暂无分段，请先完成资产步骤并点击「重新打包 Prompt」</div>

        <div v-else class="repaint-segment-list">
          <article v-for="seg in segments" :key="seg.id" class="repaint-segment-card card">
            <div class="repaint-segment-head">
              <strong>段 {{ seg.segment_index + 1 }}</strong>
              <span class="dim mono">{{ seg.start_sec }}s – {{ seg.end_sec }}s · {{ seg.duration_sec }}s</span>
              <span class="tag" :class="segmentStatusClass(seg)">{{ segmentStatusLabel(seg) }}</span>
            </div>
            <textarea
              v-model="seg.video_prompt"
              class="textarea repaint-segment-prompt"
              rows="6"
              @change="saveSegmentPrompt(seg)"
            />
            <div class="repaint-segment-foot">
              <span class="dim">{{ seg.content_refs?.length || 0 }} 张参考图</span>
              <button type="button" class="btn btn-sm btn-primary" :disabled="busy || seg.status === 'generating'" @click="generateSegment(seg)">
                {{ seg.status === 'generating' ? '生成中…' : '生成此段' }}
              </button>
            </div>
            <p v-if="seg.video_error || seg.error_msg" class="repaint-error">{{ seg.video_error || seg.error_msg }}</p>
            <video
              v-if="seg.video_url && seg.video_status === 'completed'"
              :src="mediaDisplayUrl(seg.video_url)"
              controls
              playsinline
              class="repaint-segment-video"
            />
          </article>
        </div>

        <div class="repaint-actions">
          <button type="button" class="btn btn-primary" :disabled="busy" @click="confirmStage('prompts')">
            确认 Prompt，进入生成
          </button>
        </div>
      </section>

      <!-- 步骤 4：生成 -->
      <section v-show="activeStepIndex === 3" class="repaint-section">
        <h2>4. 分段视频生成</h2>
        <p class="dim">使用 seedance通道1（橙盟）按段重画，单段可重跑，不影响其他段。</p>
        <p class="dim repaint-soon">段级生成与进度列表开发中。</p>
        <div class="repaint-actions">
          <button type="button" class="btn btn-primary" :disabled="busy" @click="confirmStage('generate')">
            全部段完成后，进入拼接
          </button>
        </div>
      </section>

      <!-- 步骤 5：成片 -->
      <section v-show="activeStepIndex === 4" class="repaint-section">
        <h2>5. 拼接成片</h2>
        <p class="dim">ffmpeg 按顺序拼接各段，输出最终转绘成片。</p>
        <div v-if="job.merged_video_url" class="repaint-preview">
          <video :src="mediaDisplayUrl(job.merged_video_url)" controls playsinline class="repaint-video" />
        </div>
        <p v-else class="dim repaint-soon">拼接功能开发中。</p>
        <div class="repaint-actions">
          <button type="button" class="btn btn-primary" :disabled="busy" @click="confirmStage('merge')">
            标记任务完成
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { repaintAPI } from '~/composables/useApi'
import { REPAINT_STAGES, repaintStageIndex } from '~/constants/repaint-steps.js'
import { mediaDisplayUrl } from '~/utils/media-url.js'
import { toast } from 'vue-sonner'
import RepaintAnalysisEditor from '~/components/RepaintAnalysisEditor.vue'
import RepaintAssetPanel from '~/components/RepaintAssetPanel.vue'

const route = useRoute()
const router = useRouter()
const jobId = computed(() => Number(route.params.id))
const loading = ref(false)
const busy = ref(false)
const loadError = ref('')
const job = ref(null)
const readiness = ref(null)
const activeStepIndex = ref(0)
const draftAnalysis = ref(null)
const analysisDirty = ref(false)
const segments = ref([])

const hasAnalysis = computed(() => !!(job.value?.analysis?.shots?.length))
const analyzing = computed(() => busy.value || job.value?.status === 'analyzing')

let analyzePollTimer = null

function stopAnalyzePoll() {
  if (analyzePollTimer) {
    clearInterval(analyzePollTimer)
    analyzePollTimer = null
  }
}

function startAnalyzePoll(finishOnDone = false) {
  stopAnalyzePoll()
  analyzePollTimer = setInterval(async () => {
    try {
      const next = await repaintAPI.get(jobId.value)
      if (next.status === 'analyzing') {
        job.value = { ...job.value, status: 'analyzing' }
        return
      }
      stopAnalyzePoll()
      if (next.status === 'analyzed' || next.status === 'failed') {
        job.value = next
        draftAnalysis.value = cloneAnalysis(next.analysis)
        analysisDirty.value = false
        syncActiveStep()
        if (finishOnDone) {
          if (next.status === 'analyzed') {
            const w = next.analysis?.warnings?.length
            toast.success(w ? `分析完成（${w} 条警告）` : '分析完成')
          } else if (next.error_msg) {
            toast.error(next.error_msg)
          }
          busy.value = false
        }
      }
    } catch {
      // 轮询失败时忽略，主请求仍会返回或超时
    }
  }, 3000)
}

function cloneAnalysis(raw) {
  if (!raw) return null
  return JSON.parse(JSON.stringify(raw))
}

function onAnalysisDraftChange(next) {
  draftAnalysis.value = next
  analysisDirty.value = true
}

async function saveAnalysis() {
  if (!draftAnalysis.value || !analysisDirty.value) return
  busy.value = true
  try {
    job.value = await repaintAPI.patchAnalysis(jobId.value, {
      shots: draftAnalysis.value.shots,
      utterances: draftAnalysis.value.utterances,
      characters: draftAnalysis.value.characters,
      scenes: draftAnalysis.value.scenes,
      props: draftAnalysis.value.props,
      shot_assignments: draftAnalysis.value.shot_assignments,
    })
    draftAnalysis.value = cloneAnalysis(job.value.analysis)
    analysisDirty.value = false
    toast.success('分析结果已保存')
  } catch (err) {
    toast.error(err?.message || '保存失败')
  } finally {
    busy.value = false
  }
}

function stepIndex(stage) {
  const order = ['upload', 'analysis', 'assets', 'prompts', 'generate', 'merge', 'completed']
  return order.indexOf(String(stage || 'upload'))
}

function stageLabel(stage) {
  const map = {
    upload: '待分析',
    analyzing: '分析中',
    analysis: '分析',
    assets: '资产',
    prompts: '分段',
    generate: '生成',
    merge: '拼接',
    completed: '已完成',
  }
  return map[stage] || stage
}

function formatDuration(sec) {
  const s = Math.round(Number(sec) || 0)
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}分${r}秒` : `${s}秒`
}

function syncActiveStep() {
  if (!job.value) return
  activeStepIndex.value = repaintStageIndex(job.value.stage)
}

async function loadJob() {
  if (!Number.isFinite(jobId.value)) {
    loadError.value = '无效的任务 ID'
    return
  }
  loading.value = true
  loadError.value = ''
  try {
    job.value = await repaintAPI.get(jobId.value)
    draftAnalysis.value = cloneAnalysis(job.value.analysis)
    analysisDirty.value = false
    syncActiveStep()
    if (stepIndex(job.value.stage) >= stepIndex('assets')) {
      await checkReadiness()
    }
    if (stepIndex(job.value.stage) >= stepIndex('prompts')) {
      await loadSegments()
    }
    if (job.value.status === 'analyzing') {
      busy.value = true
      startAnalyzePoll(true)
    }
  } catch (err) {
    loadError.value = err?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function checkReadiness() {
  try {
    readiness.value = await repaintAPI.assetReadiness(jobId.value)
  } catch (err) {
    toast.error(err?.message || '检查失败')
  }
}

async function onAssetsUpdated() {
  await checkReadiness()
}

async function runAnalyze() {
  if (analysisDirty.value) {
    toast.error('请先保存分析修改，或刷新丢弃未保存内容')
    return
  }
  busy.value = true
  if (job.value) job.value = { ...job.value, status: 'analyzing', error_msg: null }
  startAnalyzePoll(false)
  try {
    job.value = await repaintAPI.analyze(jobId.value)
    draftAnalysis.value = cloneAnalysis(job.value.analysis)
    analysisDirty.value = false
    syncActiveStep()
    const w = job.value.analysis?.warnings?.length
    toast.success(w ? `分析完成（${w} 条警告）` : '分析完成')
  } catch (err) {
    await loadJob()
    toast.error(err?.message || '分析失败')
  } finally {
    stopAnalyzePoll()
    busy.value = false
  }
}

async function loadSegments() {
  try {
    const res = await repaintAPI.listSegments(jobId.value)
    segments.value = res?.items || []
  } catch (err) {
    toast.error(err?.message || '加载分段失败')
  }
}

async function rebuildSegments() {
  busy.value = true
  try {
    toast.message('正在生成详细分镜 Prompt，每段约 10–20 秒…')
    const res = await repaintAPI.buildSegments(jobId.value)
    segments.value = res?.items || []
    toast.success(`已生成 ${segments.value.length} 个分段（含景别/运镜/调度）`)
  } catch (err) {
    toast.error(err?.message || '打包失败')
  } finally {
    busy.value = false
  }
}

async function saveSegmentPrompt(seg) {
  try {
    await repaintAPI.patchSegment(jobId.value, seg.id, { video_prompt: seg.video_prompt })
  } catch (err) {
    toast.error(err?.message || '保存 Prompt 失败')
  }
}

async function generateSegment(seg) {
  busy.value = true
  try {
    await saveSegmentPrompt(seg)
    const res = await repaintAPI.generateSegment(jobId.value, seg.id)
    toast.success(`段 ${seg.segment_index + 1} 已提交生成`)
    if (res?.segment) {
      const idx = segments.value.findIndex(s => s.id === seg.id)
      if (idx >= 0) segments.value[idx] = res.segment
    }
    setTimeout(loadSegments, 8000)
  } catch (err) {
    toast.error(err?.message || '生成失败')
  } finally {
    busy.value = false
  }
}

function segmentStatusLabel(seg) {
  if (seg.video_status === 'completed' || seg.status === 'completed') return '已完成'
  if (seg.status === 'generating' || seg.video_status === 'processing') return '生成中'
  if (seg.status === 'failed' || seg.video_status === 'failed') return '失败'
  return seg.status === 'prompt_ready' ? '可生成' : '草稿'
}

function segmentStatusClass(seg) {
  if (seg.video_status === 'completed') return 'tag-accent'
  if (seg.status === 'failed' || seg.video_status === 'failed') return 'tag-warn'
  return ''
}

watch(activeStepIndex, (idx) => {
  if (idx === 2 && !segments.value.length) loadSegments()
})

async function confirmStage(stage) {
  if (analysisDirty.value) {
    toast.error('请先保存分析修改')
    return
  }
  busy.value = true
  try {
    job.value = await repaintAPI.confirm(jobId.value, stage)
    syncActiveStep()
    toast.success('已进入下一步')
    if (stage === 'analysis') await checkReadiness()
    if (stage === 'assets') await loadSegments()
  } catch (err) {
    toast.error(err?.message || '操作失败')
  } finally {
    busy.value = false
  }
}

function openDramaWorkbench() {
  if (!job.value?.drama_id) return
  router.push(`/drama/${job.value.drama_id}`)
}

function goList() {
  router.push('/videos/repaint')
}

watch(jobId, loadJob, { immediate: true })

onBeforeUnmount(stopAnalyzePoll)
</script>

<style scoped>
.studio-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.studio-header {
  padding: 16px 24px 8px;
  flex-shrink: 0;
}

.repaint-back {
  margin-bottom: 8px;
  padding-left: 0;
}

.studio-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}

.studio-desc {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-1);
}

.studio-header-actions {
  position: absolute;
  top: 16px;
  right: 24px;
}

.studio-header {
  position: relative;
}

.repaint-steps {
  display: flex;
  gap: 8px;
  padding: 0 24px 12px;
  overflow-x: auto;
  flex-shrink: 0;
}

.repaint-step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 140px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-2);
  cursor: pointer;
  text-align: left;
  color: var(--text-0);
  transition: border-color 0.15s, background 0.15s;
}

.repaint-step:hover {
  background: var(--bg-hover);
}

.repaint-step.active,
.repaint-step.current {
  border-color: rgba(76, 125, 255, 0.45);
  background: var(--accent-bg);
}

.repaint-step.done .repaint-step-num {
  background: var(--accent);
  color: #fff;
}

.repaint-step-num {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  background: var(--bg-3);
  flex-shrink: 0;
}

.repaint-step-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.repaint-step-text strong {
  font-size: 13px;
}

.repaint-step-text small {
  font-size: 11px;
  color: var(--text-2);
  line-height: 1.3;
}

.repaint-panel {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0 24px 24px;
  padding: 20px;
}

.repaint-section h2 {
  margin: 0 0 8px;
  font-size: 17px;
}

.repaint-section .dim {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.55;
}

.repaint-preview {
  margin-bottom: 16px;
  max-width: 480px;
}

.repaint-video {
  width: 100%;
  border-radius: var(--radius);
  background: #000;
}

.repaint-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 13px;
  color: var(--text-1);
  margin-bottom: 12px;
}

.repaint-actions-inline {
  margin-top: 0;
  margin-bottom: 8px;
}

.repaint-progress {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--bg-2, rgba(255, 255, 255, 0.04));
  font-size: 13px;
  line-height: 1.5;
}

.repaint-error {
  color: var(--danger, #e57373);
  font-size: 13px;
  margin: 0 0 12px;
}

.repaint-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 20px;
}

.repaint-readiness {
  margin-bottom: 16px;
  padding: 12px;
  border-radius: var(--radius);
  background: var(--bg-2);
}

.repaint-ok { color: var(--accent-text); margin: 0 0 8px; }
.repaint-warn { color: #ffb74d; margin: 0 0 8px; }

.repaint-missing {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--text-1);
}

.repaint-soon {
  padding: 12px;
  border-radius: var(--radius);
  background: var(--bg-2);
  border: 1px dashed var(--border);
}

.repaint-segment-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.repaint-segment-card {
  padding: 12px;
}

.repaint-segment-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.repaint-segment-prompt {
  width: 100%;
  font-size: 13px;
  font-family: var(--font-mono, monospace);
}

.repaint-segment-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.repaint-segment-video {
  width: 100%;
  max-width: 360px;
  margin-top: 10px;
  border-radius: var(--radius);
  background: #000;
}

.studio-empty {
  padding: 32px;
  text-align: center;
}
</style>
