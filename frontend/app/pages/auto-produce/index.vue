<template>
  <div class="page">
    <div class="page-head">
      <div class="head-left">
        <h1 class="page-title">一键出片</h1>
        <p class="page-desc">粘贴剧本 → 自动拆镜 → 批量生视频 → 拼接成片</p>
      </div>
      <NuxtLink to="/canvas" class="btn">前往画布</NuxtLink>
    </div>

    <div class="layout">
      <section class="panel compose">
        <label class="field">
          <span class="field-label">项目名称</span>
          <input v-model="title" class="input" placeholder="例如：我名苍天·试稿" :disabled="busy" />
        </label>

        <div class="field-row">
          <label class="field">
            <span class="field-label">镜头数</span>
            <input v-model.number="clipCount" class="input" type="number" min="3" max="12" :disabled="busy" />
          </label>
          <label class="field">
            <span class="field-label">单镜时长（秒）</span>
            <input v-model.number="durationSec" class="input" type="number" min="8" max="15" :disabled="busy" />
          </label>
          <label class="field">
            <span class="field-label">画幅</span>
            <select v-model="aspectRatio" class="input select" :disabled="busy">
              <option value="16:9">16:9 横屏</option>
              <option value="9:16">9:16 竖屏</option>
            </select>
          </label>
        </div>

        <label class="check-row">
          <input v-model="dialogueLock" type="checkbox" :disabled="busy" />
          <span>台词硬锁（分镜尽量保留剧本原句）</span>
        </label>

        <div class="field">
          <div class="field-label-row">
            <span class="field-label">剧本</span>
            <button type="button" class="btn btn-sm" :disabled="busy" @click="fileInput?.click()">上传 txt</button>
            <input ref="fileInput" type="file" accept=".txt,text/plain" class="hidden-file" @change="onFilePick" />
          </div>
          <textarea
            v-model="scriptText"
            class="textarea"
            rows="14"
            :disabled="busy"
            placeholder="粘贴剧本。若无「第N集」标记，将自动作为第1集处理。&#10;&#10;建议先用 1 集试稿内容验证。"
          />
        </div>

        <p v-if="formError" class="error">{{ formError }}</p>

        <div class="actions">
          <button type="button" class="btn btn-primary" :disabled="busy || !canSubmit" @click="startJob">
            {{ busy ? '出片中…' : '开始一键出片' }}
          </button>
          <span class="dim hint">将创建新项目并自动跑完整流水线，请确认积分充足</span>
        </div>
      </section>

      <aside class="panel side">
        <h2 class="side-title">流水线</h2>
        <nav class="pipeline-rail" aria-label="一键出片进度">
          <div
            v-for="step in displaySteps"
            :key="step.key"
            class="pipe-step"
            :class="[`st-${step.status}`, { running: step.status === 'running' }]"
          >
            <span class="pipe-dot" />
            <span class="pipe-label">{{ step.label }}</span>
            <span v-if="step.detail" class="pipe-detail">{{ step.detail }}</span>
          </div>
        </nav>

        <div v-if="activeJob" class="job-card">
          <div class="job-row">
            <span class="dim">状态</span>
            <strong :class="statusClass">{{ statusLabel }}</strong>
          </div>
          <div v-if="activeJob.drama_id || activeJob.dramaId" class="job-row">
            <span class="dim">项目</span>
            <NuxtLink
              class="linkish"
              :to="`/drama/${activeJob.drama_id || activeJob.dramaId}`"
            >
              #{{ activeJob.drama_id || activeJob.dramaId }}
            </NuxtLink>
          </div>
          <div v-if="mergedUrl" class="job-row">
            <span class="dim">成片</span>
            <a class="linkish" :href="mergedUrl" target="_blank" rel="noopener">打开视频</a>
          </div>
          <p v-if="activeJob.error" class="error">{{ activeJob.error }}</p>
        </div>

        <div class="history">
          <div class="history-head">
            <h3>最近任务</h3>
            <button type="button" class="btn btn-sm" :disabled="loadingList" @click="loadJobs">刷新</button>
          </div>
          <ul v-if="jobs.length" class="job-list">
            <li
              v-for="item in jobs"
              :key="item.id"
              class="job-item"
              :class="{ on: item.id === activeJobId }"
              @click="selectJob(item.id)"
            >
              <div class="job-item-title">{{ item.title }}</div>
              <div class="job-item-meta dim">
                {{ statusText(item.status) }} · {{ fmtTime(item.updated_at || item.updatedAt) }}
              </div>
            </li>
          </ul>
          <p v-else class="dim empty">还没有任务</p>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { autoProduceAPI } from '~/composables/useApi'

definePageMeta({ layout: 'default' })

const title = ref('')
const scriptText = ref('')
const clipCount = ref(5)
const durationSec = ref(15)
const aspectRatio = ref('16:9')
const dialogueLock = ref(true)
const formError = ref('')
const fileInput = ref(null)

const busy = ref(false)
const loadingList = ref(false)
const jobs = ref([])
const activeJobId = ref('')
const activeJob = ref(null)
let pollTimer = null

const canSubmit = computed(() => title.value.trim() && scriptText.value.trim().length >= 20)

const displaySteps = computed(() => {
  const steps = activeJob.value?.steps
  if (Array.isArray(steps) && steps.length) return steps
  return [
    { key: 'import', label: '导入剧本', status: 'pending' },
    { key: 'extract', label: '提取资产', status: 'pending' },
    { key: 'storyboard', label: '拆解分镜', status: 'pending' },
    { key: 'videos', label: '生成视频', status: 'pending' },
    { key: 'compose', label: '合成镜头', status: 'pending' },
    { key: 'merge', label: '拼接成片', status: 'pending' },
  ]
})

const statusLabel = computed(() => statusText(activeJob.value?.status))
const statusClass = computed(() => {
  const s = activeJob.value?.status
  if (s === 'completed') return 'ok'
  if (s === 'failed') return 'bad'
  return ''
})
const mergedUrl = computed(() => {
  const r = activeJob.value?.result
  return r?.merged_url || r?.mergedUrl || null
})

function statusText(s) {
  if (s === 'queued') return '排队中'
  if (s === 'running') return '进行中'
  if (s === 'completed') return '已完成'
  if (s === 'failed') return '失败'
  return s || '—'
}

function fmtTime(v) {
  if (!v) return ''
  try {
    return new Date(v).toLocaleString()
  } catch {
    return String(v)
  }
}

async function onFilePick(e) {
  const file = e?.target?.files?.[0]
  if (!file) return
  scriptText.value = await file.text()
  if (!title.value.trim()) title.value = file.name.replace(/\.txt$/i, '')
  e.target.value = ''
}

async function loadJobs() {
  loadingList.value = true
  try {
    const res = await autoProduceAPI.list()
    jobs.value = res?.items || []
  } catch (err) {
    toast.error(err?.message || '加载任务失败')
  } finally {
    loadingList.value = false
  }
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function refreshActive() {
  if (!activeJobId.value) return
  try {
    const job = await autoProduceAPI.get(activeJobId.value)
    activeJob.value = job
    busy.value = job?.status === 'queued' || job?.status === 'running'
    if (job?.status === 'completed' || job?.status === 'failed') {
      stopPoll()
      await loadJobs()
      if (job.status === 'completed') toast.success('一键出片完成')
      if (job.status === 'failed') toast.error(job.error || '一键出片失败')
    }
  } catch (err) {
    stopPoll()
    busy.value = false
    toast.error(err?.message || '查询任务失败')
  }
}

function startPoll() {
  stopPoll()
  pollTimer = setInterval(refreshActive, 2500)
}

async function selectJob(id) {
  activeJobId.value = id
  await refreshActive()
  if (busy.value) startPoll()
}

async function startJob() {
  formError.value = ''
  if (!canSubmit.value) {
    formError.value = '请填写项目名称与足够长的剧本'
    return
  }
  busy.value = true
  try {
    const job = await autoProduceAPI.create({
      title: title.value.trim(),
      script_text: scriptText.value.trim(),
      clip_count: Number(clipCount.value) || 5,
      duration_sec: Number(durationSec.value) || 15,
      aspect_ratio: aspectRatio.value,
      dialogue_lock: dialogueLock.value,
    })
    activeJobId.value = job.id
    activeJob.value = job
    toast.success('任务已创建，开始出片')
    await loadJobs()
    startPoll()
  } catch (err) {
    busy.value = false
    formError.value = err?.message || '创建失败'
    toast.error(formError.value)
  }
}

onMounted(loadJobs)
onBeforeUnmount(stopPoll)
</script>

<style scoped>
.page {
  width: 100%;
  max-width: none;
  margin: 0;
  align-self: stretch;
  box-sizing: border-box;
  padding: 24px 28px 56px;
  min-height: 100%;
  background:
    radial-gradient(1000px 480px at 8% -8%, rgba(91,140,255,.14), transparent 55%),
    radial-gradient(800px 420px at 92% 0%, rgba(125,211,252,.08), transparent 50%),
    #0b0d12;
  color: #f3f5f9;
}
.page-head {
  width: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}
.page-title { margin: 0; font-size: 1.55rem; letter-spacing: 0.02em; color: #fff; }
.page-desc { margin: 6px 0 0; color: rgba(255, 255, 255, 0.55); font-size: 0.9rem; }

.page :deep(.btn) {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
  color: #e8ecf4;
}
.page :deep(.btn:hover) {
  background: rgba(255, 255, 255, 0.14);
}
.page :deep(.btn-primary) {
  background: #3b82f6;
  border-color: #3b82f6;
  color: #fff;
}
.page :deep(.btn-primary:hover) {
  filter: brightness(1.06);
}
.page :deep(.btn:disabled),
.page :deep(.btn-primary:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.8fr);
  gap: 18px;
  align-items: start;
}
.panel {
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 14px;
  background: rgba(0,0,0,.18);
  padding: 18px;
}
.compose { display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.field-label { font-size: 0.8rem; color: #9aa3b8; }
.field-label-row {
  display: flex; align-items: center; gap: 10px;
}
.input, .textarea, .select {
  width: 100%;
  box-sizing: border-box;
  border-radius: 10px;
  border: 1px solid rgba(157, 183, 255, .28);
  background: #1a2030;
  color: #e8ecf5;
  font: inherit;
  padding: 10px 12px;
  color-scheme: dark;
}
.textarea { resize: vertical; line-height: 1.55; min-height: 280px; }
.check-row {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 0.88rem; color: #c5cde0;
}
.actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.hint { font-size: 0.8rem; }
.error { color: #ff8f8f; margin: 0; font-size: 0.88rem; }
.dim { color: rgba(255,255,255,.55); }
.hidden-file { display: none; }

.side-title { margin: 0 0 12px; font-size: 1rem; color: #fff; }
.pipeline-rail {
  display: flex; flex-direction: column; gap: 8px;
  margin-bottom: 16px;
}
.pipe-step {
  display: grid;
  grid-template-columns: 10px 1fr;
  grid-template-rows: auto auto;
  column-gap: 8px;
  row-gap: 2px;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,.08);
  background: rgba(255,255,255,.03);
  color: #d7deee;
  font-size: 0.82rem;
}
.pipe-step.running { border-color: #5b8cff; background: rgba(91,140,255,.16); box-shadow: 0 0 0 1px rgba(91,140,255,.35); }
.pipe-step.st-done .pipe-dot { background: #86efac; }
.pipe-step.st-running .pipe-dot, .pipe-step.running .pipe-dot { background: #5b8cff; }
.pipe-step.st-error .pipe-dot { background: #ff8f8f; }
.pipe-step.st-pending .pipe-dot, .pipe-step.st-skipped .pipe-dot { background: #64748b; }
.pipe-dot {
  width: 8px; height: 8px; border-radius: 50%; background: #64748b;
  margin-top: 5px; grid-row: 1 / span 2;
}
.pipe-label { font-weight: 600; }
.pipe-detail { grid-column: 2; font-size: 0.75rem; color: #9aa3b8; }

.job-card {
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 12px;
  padding: 12px;
  background: rgba(22, 26, 36, .7);
  margin-bottom: 16px;
  display: flex; flex-direction: column; gap: 8px;
}
.job-row { display: flex; justify-content: space-between; gap: 10px; font-size: 0.86rem; }
.linkish { color: #9db7ff; text-decoration: none; }
.linkish:hover { text-decoration: underline; }
.ok { color: #86efac; }
.bad { color: #ff8f8f; }

.history-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px;
}
.history-head h3 { margin: 0; font-size: 0.92rem; }
.job-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.job-item {
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  background: rgba(255,255,255,.02);
}
.job-item:hover { border-color: rgba(91,140,255,.45); }
.job-item.on { border-color: #5b8cff; background: rgba(91,140,255,.12); }
.job-item-title { font-size: 0.86rem; margin-bottom: 4px; }
.job-item-meta { font-size: 0.75rem; }
.empty { font-size: 0.84rem; margin: 8px 0 0; }

@media (max-width: 960px) {
  .layout { grid-template-columns: 1fr; }
  .field-row { grid-template-columns: 1fr; }
}
</style>
