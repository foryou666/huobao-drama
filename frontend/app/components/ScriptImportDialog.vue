<template>
  <div v-if="open" class="overlay" @click.self="close">
    <div class="modal card script-import-modal">
      <div class="modal-header">
        <div class="modal-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
        </div>
        <h2 class="modal-title">导入剧本</h2>
        <p class="modal-desc">{{ stepDesc }}</p>
      </div>

      <div class="si-steps">
        <span v-for="(s, i) in stepLabels" :key="s" class="si-step" :class="{ active: step === i, done: step > i }">{{ s }}</span>
      </div>

      <!-- Step 0: paste / upload -->
      <div v-if="step === 0" class="si-body">
        <label class="field">
          <span class="field-label">项目名称 <span class="required">*</span></span>
          <input v-model="title" class="input" placeholder="例如：都市逆袭《第X章》" />
        </label>
        <div class="field-row">
          <label class="field">
            <span class="field-label">导演风格</span>
            <BaseSelect v-model="directorStyle" :options="directorStyleOptions" placeholder="选择导演风格" />
          </label>
          <label class="field">
            <span class="field-label">图片服务（生图用）</span>
            <BaseSelect v-model="imageConfigId" :options="imageConfigOptions" placeholder="默认图片配置" searchable />
          </label>
        </div>
        <div class="si-upload-row">
          <input ref="fileInputRef" type="file" accept=".txt,text/plain" class="si-file" @change="onFilePick" />
          <button type="button" class="btn btn-sm" @click="fileInputRef?.click()">上传 txt</button>
          <span class="dim si-hint">须含「第N集」标记；无标记将拒绝导入</span>
        </div>
        <textarea
          v-model="scriptText"
          class="textarea si-textarea"
          rows="12"
          placeholder="粘贴整部剧本…&#10;&#10;第1集&#10;……&#10;&#10;第2集&#10;……"
        />
        <p v-if="error" class="si-error">{{ error }}</p>
        <p class="dim si-model-note">
          整部原文不会一次送入模型：先按集切开入库，再按集提取。单集过长可能变慢或截断。
        </p>
      </div>

      <!-- Step 1: confirm split -->
      <div v-else-if="step === 1" class="si-body">
        <p class="si-summary">
          共 <strong>{{ preview?.episodes?.length || 0 }}</strong> 集 ·
          全文约 {{ preview?.total_chars || 0 }} 字
        </p>
        <p v-if="preview?.model_note" class="dim si-model-note">{{ preview.model_note }}</p>
        <div class="si-ep-list">
          <div
            v-for="ep in preview?.episodes || []"
            :key="ep.episode_number"
            class="si-ep-row"
            :class="{ warn: ep.warn_long, risk: ep.risk_long }"
          >
            <span class="si-ep-title">{{ ep.title }}</span>
            <span class="dim">{{ ep.char_count }} 字</span>
            <span v-if="ep.risk_long" class="si-badge risk">过长·建议拆细</span>
            <span v-else-if="ep.warn_long" class="si-badge warn">偏长</span>
          </div>
        </div>
        <p class="dim">请确认分集无误后再创建项目。创建后会写入各集剧本，不会自动生图。</p>
      </div>

      <!-- Step 2: extracting -->
      <div v-else-if="step === 2" class="si-body">
        <p class="si-summary">
          项目已创建（#{{ dramaId }}）。正在按集提取角色 / 场景 / 道具文字…
        </p>
        <div class="si-progress">
          <div class="si-progress-bar" :style="{ width: extractPct + '%' }" />
        </div>
        <p class="dim">
          {{ extractDone }} / {{ extractTotal }} 集
          <template v-if="extractCurrent"> · 当前第 {{ extractCurrent }} 集</template>
        </p>
        <ul v-if="extractErrors.length" class="si-errors">
          <li v-for="(e, i) in extractErrors" :key="i">第{{ e.episode_number }}集：{{ e.error }}</li>
        </ul>
      </div>

      <!-- Step 3: preview assets + confirm images -->
      <div v-else-if="step === 3" class="si-body">
        <p class="si-summary">
          已提取 {{ assets?.total || 0 }} 项资产（缺图 {{ assets?.missing_count || 0 }}）。
          请预览确认后再生成图片。
        </p>
        <div class="si-asset-grid">
          <article
            v-for="item in assets?.items || []"
            :key="`${item.type}-${item.id}`"
            class="si-asset-card"
            :class="{ ready: item.has_image, selected: isSelected(item) }"
            @click="toggleSelect(item)"
          >
            <span class="si-asset-type">{{ typeLabel(item.type) }}</span>
            <strong class="si-asset-name">{{ item.name }}</strong>
            <p class="dim si-asset-desc">{{ item.description || item.prompt || '—' }}</p>
            <span class="si-asset-status">{{ item.has_image ? '已有图' : (isSelected(item) ? '将生图' : '跳过') }}</span>
          </article>
        </div>
        <p v-if="!assets?.items?.length" class="dim">暂无资产，可进入项目后手动提取。</p>
        <p v-if="genError" class="si-error">{{ genError }}</p>
      </div>

      <!-- Step 4: done -->
      <div v-else class="si-body">
        <p class="si-summary">导入流程完成。</p>
        <p class="dim">角色 / 场景图已提交生成（异步）；可在项目工作台查看进度与结果。</p>
        <p v-if="genResult" class="dim">生图提交 {{ genResult.started }}/{{ genResult.requested }}，失败 {{ genResult.failed }}</p>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn" @click="close">{{ step >= 4 ? '关闭' : '取消' }}</button>
        <template v-if="step === 0">
          <button type="button" class="btn btn-primary" :disabled="busy || !canPreview" @click="doPreview">
            {{ busy ? '解析中…' : '检测分集' }}
          </button>
        </template>
        <template v-else-if="step === 1">
          <button type="button" class="btn" :disabled="busy" @click="step = 0">上一步</button>
          <button type="button" class="btn btn-primary" :disabled="busy" @click="doCommit">
            {{ busy ? '创建中…' : '确认创建并提取' }}
          </button>
        </template>
        <template v-else-if="step === 3">
          <button type="button" class="btn" @click="skipImages">暂不生图，打开项目</button>
          <button type="button" class="btn btn-primary" :disabled="busy || !selectedMissingCount" @click="doGenerate">
            {{ busy ? '提交生图…' : `确认生成缺图（${selectedMissingCount}）` }}
          </button>
        </template>
        <template v-else-if="step === 4">
          <button type="button" class="btn btn-primary" @click="openProject">打开项目</button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import BaseSelect from '~/components/BaseSelect.vue'
import { aiConfigAPI, promptsAPI, scriptImportAPI } from '~/composables/useApi'
import { dramaWorkbenchPath } from '~/utils/drama-entry.js'

const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['update:open', 'created'])

const stepLabels = ['上传', '确认分集', '提取资产', '预览生图', '完成']
const step = ref(0)
const busy = ref(false)
const error = ref('')
const genError = ref('')
const title = ref('')
const scriptText = ref('')
const directorStyle = ref('hongguo_director')
const directorStyles = ref([])
const imageConfigId = ref(null)
const imageConfigs = ref([])
const preview = ref(null)
const dramaId = ref(null)
const status = ref(null)
const assets = ref(null)
const selected = ref(new Set())
const genResult = ref(null)
const fileInputRef = ref(null)
let pollTimer = null

const directorStyleOptions = computed(() =>
  directorStyles.value.map(s => ({ label: s.label, value: s.id })),
)
const imageConfigOptions = computed(() =>
  imageConfigs.value.map(c => ({
    label: configLabel(c),
    value: c.id,
  })),
)

const stepDesc = computed(() => {
  if (step.value === 0) return '粘贴或上传整部剧本，须带「第N集」标记'
  if (step.value === 1) return '核对自动分集结果，确认后再创建'
  if (step.value === 2) return '按集调用提取 Agent（非整部一次送入）'
  if (step.value === 3) return '预览文字资产，勾选后确认生图'
  return '可进入项目继续制作'
})

const canPreview = computed(() => title.value.trim() && scriptText.value.trim())
const extractDone = computed(() => status.value?.script_import?.extract?.done || 0)
const extractTotal = computed(() => status.value?.script_import?.extract?.total || 0)
const extractCurrent = computed(() => status.value?.script_import?.extract?.current_episode || null)
const extractErrors = computed(() => status.value?.script_import?.extract?.errors || [])
const extractPct = computed(() => {
  const t = extractTotal.value
  if (!t) return 0
  return Math.min(100, Math.round((extractDone.value / t) * 100))
})
const selectedMissingCount = computed(() => {
  if (!assets.value?.items) return 0
  return assets.value.items.filter(i => !i.has_image && selected.value.has(keyOf(i))).length
})

function configLabel(config) {
  if (!config) return ''
  let modelName = ''
  try {
    const m = JSON.parse(config.model || '[]')
    modelName = Array.isArray(m) ? (m[0] || '') : (m || '')
  } catch {
    modelName = config.model || ''
  }
  return `${config.name || config.label || '图片'}${modelName ? ` · ${modelName}` : ''}`
}

function typeLabel(t) {
  if (t === 'character') return '角色'
  if (t === 'scene') return '场景'
  if (t === 'prop') return '道具'
  return t
}

function keyOf(item) {
  return `${item.type}:${item.id}`
}

function isSelected(item) {
  return selected.value.has(keyOf(item))
}

function toggleSelect(item) {
  if (item.has_image) return
  const k = keyOf(item)
  const next = new Set(selected.value)
  if (next.has(k)) next.delete(k)
  else next.add(k)
  selected.value = next
}

function close() {
  stopPoll()
  emit('update:open', false)
}

function reset() {
  stopPoll()
  step.value = 0
  busy.value = false
  error.value = ''
  genError.value = ''
  title.value = ''
  scriptText.value = ''
  preview.value = null
  dramaId.value = null
  status.value = null
  assets.value = null
  selected.value = new Set()
  genResult.value = null
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function loadOptions() {
  try {
    const [styles, imgs] = await Promise.all([
      promptsAPI.directorStyles(),
      aiConfigAPI.list('image'),
    ])
    directorStyles.value = styles?.items || []
    if (styles?.default) directorStyle.value = styles.default
    imageConfigs.value = imgs || []
    const def = imageConfigs.value.find(c => c.is_default || c.isDefault) || imageConfigs.value[0]
    if (def) imageConfigId.value = def.id
  } catch {
    // ignore
  }
}

async function onFilePick(e) {
  const file = e.target?.files?.[0]
  if (!file) return
  try {
    scriptText.value = await file.text()
    if (!title.value.trim()) title.value = file.name.replace(/\.txt$/i, '')
  } catch {
    toast.error('读取文件失败')
  }
  e.target.value = ''
}

async function doPreview() {
  error.value = ''
  busy.value = true
  try {
    const res = await scriptImportAPI.preview({
      title: title.value.trim(),
      script_text: scriptText.value,
    })
    preview.value = res
    step.value = 1
  } catch (err) {
    error.value = err?.message || '分集失败'
    toast.error(error.value)
  } finally {
    busy.value = false
  }
}

async function doCommit() {
  busy.value = true
  error.value = ''
  try {
    const res = await scriptImportAPI.commit({
      title: title.value.trim(),
      script_text: scriptText.value,
      director_style: directorStyle.value,
      image_config_id: imageConfigId.value,
      episodes: preview.value?.episodes,
    })
    dramaId.value = res.drama_id
    emit('created', res)
    step.value = 2
    await scriptImportAPI.extract(res.drama_id)
    startPoll()
  } catch (err) {
    toast.error(err?.message || '创建失败')
  } finally {
    busy.value = false
  }
}

function startPoll() {
  stopPoll()
  pollTimer = setInterval(async () => {
    if (!dramaId.value) return
    try {
      const st = await scriptImportAPI.status(dramaId.value)
      status.value = st
      const stage = st?.script_import?.stage
      if (stage === 'extracted' || stage === 'error' || stage === 'done') {
        stopPoll()
        const a = await scriptImportAPI.assets(dramaId.value)
        assets.value = a
        const next = new Set()
        for (const item of a.items || []) {
          if (!item.has_image) next.add(keyOf(item))
        }
        selected.value = next
        step.value = 3
        if (stage === 'error') toast.error(st?.script_import?.error || '提取失败')
      }
    } catch {
      // ignore transient
    }
  }, 1500)
}

async function doGenerate() {
  if (!dramaId.value) return
  genError.value = ''
  busy.value = true
  try {
    const character_ids = []
    const scene_ids = []
    const prop_ids = []
    for (const item of assets.value?.items || []) {
      if (item.has_image || !selected.value.has(keyOf(item))) continue
      if (item.type === 'character') character_ids.push(item.id)
      else if (item.type === 'scene') scene_ids.push(item.id)
      else if (item.type === 'prop') prop_ids.push(item.id)
    }
    const res = await scriptImportAPI.generateImages(dramaId.value, {
      character_ids,
      scene_ids,
      prop_ids,
      only_missing: true,
    })
    genResult.value = res
    assets.value = res.assets || assets.value
    step.value = 4
    toast.success('已提交生图')
  } catch (err) {
    genError.value = err?.message || '生图失败'
    toast.error(genError.value)
  } finally {
    busy.value = false
  }
}

function skipImages() {
  openProject()
}

function openProject() {
  if (!dramaId.value) return
  close()
  navigateTo(dramaWorkbenchPath(dramaId.value, null, 1))
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      reset()
      loadOptions()
    } else {
      stopPoll()
    }
  },
)

onBeforeUnmount(stopPoll)
</script>

<style scoped>
.script-import-modal {
  width: min(720px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 28px;
}
.si-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}
.si-step {
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--bg-2);
  color: var(--text-3);
}
.si-step.active { background: var(--accent-bg); color: var(--accent); font-weight: 600; }
.si-step.done { color: var(--text-2); }
.si-body { display: flex; flex-direction: column; gap: 12px; margin-bottom: 8px; }
.si-textarea { width: 100%; min-height: 220px; font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; }
.si-upload-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.si-file { display: none; }
.si-hint { font-size: 12px; }
.si-model-note { font-size: 12px; line-height: 1.5; }
.si-error { color: var(--error); font-size: 13px; }
.si-summary { font-size: 14px; }
.si-ep-list { display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow: auto; }
.si-ep-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 8px; background: var(--bg-2);
}
.si-ep-row.warn { outline: 1px solid color-mix(in srgb, var(--warning, #c90) 50%, transparent); }
.si-ep-row.risk { outline: 1px solid color-mix(in srgb, var(--error) 50%, transparent); }
.si-ep-title { font-weight: 600; min-width: 64px; }
.si-badge { font-size: 11px; padding: 2px 6px; border-radius: 999px; }
.si-badge.warn { background: color-mix(in srgb, #c90 20%, transparent); color: #a80; }
.si-badge.risk { background: color-mix(in srgb, var(--error) 18%, transparent); color: var(--error); }
.si-progress { height: 8px; border-radius: 999px; background: var(--bg-2); overflow: hidden; }
.si-progress-bar { height: 100%; background: var(--accent); transition: width 0.3s; }
.si-errors { margin: 0; padding-left: 18px; font-size: 12px; color: var(--error); }
.si-asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
  max-height: 360px;
  overflow: auto;
}
.si-asset-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  cursor: pointer;
  background: var(--bg-1);
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 120px;
}
.si-asset-card.selected { border-color: var(--accent); background: var(--accent-bg); }
.si-asset-card.ready { opacity: 0.75; cursor: default; }
.si-asset-type { font-size: 10px; color: var(--text-3); text-transform: uppercase; }
.si-asset-name { font-size: 13px; }
.si-asset-desc {
  font-size: 11px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
}
.si-asset-status { font-size: 11px; color: var(--text-2); }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 640px) {
  .field-row { grid-template-columns: 1fr; }
}
</style>
