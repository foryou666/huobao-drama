<template>
  <div class="studio-page">
    <header class="studio-header">
      <div class="studio-header-copy">
        <h1 class="studio-title">视频转绘</h1>
        <StudioGuideButton
          title="视频转绘说明"
          text="上传原片（≤5 分钟）→ 分析切镜与台词 → 单独生成角色三视图 / 场景 / 道具 → 分段 Prompt → 通道1 重画 → 拼接成片。中间每一步可暂停修改。"
        />
      </div>
      <div class="studio-header-actions">
        <button type="button" class="btn btn-sm" :disabled="loading" @click="reload">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </header>

    <div class="repaint-upload card">
      <div class="repaint-upload-copy">
        <h2>新建转绘任务</h2>
        <p class="dim">支持 MP4 / MOV / WebM，时长不超过 5 分钟</p>
      </div>
      <div class="repaint-upload-actions">
        <input
          ref="fileInputRef"
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.webm,.m4v"
          class="repaint-file-input"
          @change="onFilePick"
        />
        <input
          v-model="newTitle"
          type="text"
          class="input repaint-title-input"
          placeholder="任务名称（可选）"
        />
        <button
          type="button"
          class="btn btn-primary"
          :disabled="!pickedFile || uploading"
          @click="startUpload"
        >
          {{ uploading ? '上传中…' : pickedFile ? `上传「${pickedFile.name}」` : '选择视频' }}
        </button>
        <button v-if="!pickedFile" type="button" class="btn" @click="openFilePicker">
          选择文件
        </button>
      </div>
      <p v-if="uploadError" class="repaint-error">{{ uploadError }}</p>
    </div>

    <div class="studio-feed">
      <div v-if="loading && !items.length" class="studio-empty dim">加载中…</div>
      <div v-else-if="!items.length" class="studio-empty card">
        <p>还没有转绘任务，请先上传原片</p>
      </div>

      <div v-else class="repaint-list">
        <article
          v-for="item in items"
          :key="item.id"
          class="repaint-card card"
          @click="openJob(item)"
        >
          <div class="repaint-card-main">
            <h3>{{ item.title }}</h3>
            <p class="dim repaint-card-meta">
              #{{ item.id }}
              <span v-if="item.source_duration"> · {{ formatDuration(item.source_duration) }}</span>
              · {{ formatTime(item.updated_at || item.created_at) }}
            </p>
          </div>
          <div class="repaint-card-side">
            <span class="tag tag-accent">{{ stageLabel(item.stage) }}</span>
            <span class="repaint-card-arrow">→</span>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup>
import { repaintAPI } from '~/composables/useApi'
import { REPAINT_STAGE_LABELS } from '~/constants/repaint-steps.js'
import { toast } from 'vue-sonner'

const router = useRouter()

const loading = ref(false)
const uploading = ref(false)
const uploadError = ref('')
const items = ref([])
const pickedFile = ref(null)
const newTitle = ref('')
const fileInputRef = ref(null)

function stageLabel(stage) {
  return REPAINT_STAGE_LABELS[stage] || stage || '上传'
}

function formatDuration(sec) {
  const s = Math.round(Number(sec) || 0)
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}分${r}秒` : `${s}秒`
}

function formatTime(raw) {
  if (!raw) return '—'
  try {
    return new Date(raw).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return raw
  }
}

function openFilePicker() {
  fileInputRef.value?.click()
}

function onFilePick(event) {
  uploadError.value = ''
  const file = event.target.files?.[0]
  pickedFile.value = file || null
}

async function reload() {
  loading.value = true
  try {
    const res = await repaintAPI.list()
    items.value = res?.items || []
  } catch (err) {
    toast.error(err?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function startUpload() {
  if (!pickedFile.value || uploading.value) return
  uploading.value = true
  uploadError.value = ''
  try {
    const job = await repaintAPI.create(pickedFile.value, newTitle.value)
    toast.success('转绘任务已创建')
    pickedFile.value = null
    newTitle.value = ''
    if (fileInputRef.value) fileInputRef.value.value = ''
    await router.push(`/videos/repaint/${job.id}`)
  } catch (err) {
    uploadError.value = err?.message || '上传失败'
    toast.error(uploadError.value)
  } finally {
    uploading.value = false
  }
}

function openJob(item) {
  router.push(`/videos/repaint/${item.id}`)
}

onMounted(reload)
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 24px 10px;
  flex-shrink: 0;
  flex-wrap: nowrap;
}

.studio-header-copy {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-shrink: 0;
}

.studio-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
  white-space: nowrap;
}

.studio-header-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
}

.repaint-upload {
  margin: 0 24px 16px;
  padding: 16px 18px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.repaint-upload h2 {
  margin: 0 0 4px;
  font-size: 16px;
}

.repaint-upload-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.repaint-file-input {
  display: none;
}

.repaint-title-input {
  min-width: 180px;
  max-width: 240px;
}

.repaint-error {
  width: 100%;
  margin: 0;
  color: var(--danger, #e57373);
  font-size: 13px;
}

.studio-feed {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 24px 24px;
}

.studio-empty {
  padding: 32px;
  text-align: center;
  color: var(--text-1);
}

.repaint-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.repaint-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.repaint-card:hover {
  border-color: rgba(76, 125, 255, 0.35);
  background: var(--bg-hover);
}

.repaint-card h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.repaint-card-meta {
  margin: 4px 0 0;
  font-size: 12px;
}

.repaint-card-side {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.repaint-card-arrow {
  color: var(--text-2);
  font-size: 18px;
}
</style>
