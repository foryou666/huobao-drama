<template>
  <div class="studio-page narration-canvas-page">
    <header class="studio-header">
      <div class="studio-header-copy">
        <h1 class="studio-title">解说工作流</h1>
        <p class="studio-desc">
          上传小说 → TTS2 <strong>原文朗读</strong>（不改写）→ 抽取角色/场景/道具 → Grok 生成画面 → 导出剪映草稿。
        </p>
      </div>
      <div class="studio-header-actions">
        <button type="button" class="btn btn-sm btn-ghost" :disabled="loading" @click="reload">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </header>

    <div class="narration-list-workspace">
      <div class="narration-list-toolbar">
        <span class="narration-list-toolbar-title">新建解说任务</span>
        <span class="dim narration-list-toolbar-hint">支持上传 .txt，或直接粘贴小说正文</span>
      </div>

      <div class="narration-list-body">
        <section class="narration-create-panel">
          <div class="narration-create-actions">
            <input
              ref="fileInputRef"
              type="file"
              accept=".txt,text/plain"
              class="narration-file-input"
              @change="onFilePick"
            />
            <input
              v-model="newTitle"
              type="text"
              class="input narration-title-input"
              placeholder="任务名称（可选）"
            />
            <button v-if="!pickedFile" type="button" class="btn btn-sm" @click="openFilePicker">
              选择 txt
            </button>
            <button
              type="button"
              class="btn btn-sm btn-primary"
              :disabled="uploading || (!pickedFile && !novelText.trim())"
              @click="startCreate"
            >
              {{ uploading ? '创建中…' : pickedFile ? `上传「${pickedFile.name}」` : '创建任务' }}
            </button>
          </div>
          <textarea
            v-model="novelText"
            class="textarea narration-text-input"
            rows="6"
            placeholder="或直接粘贴小说正文…"
          />
          <p v-if="uploadError" class="narration-error">{{ uploadError }}</p>
        </section>

        <section class="narration-jobs-panel">
          <div class="narration-jobs-head">
            <span class="narration-jobs-label">任务列表</span>
            <span v-if="items.length" class="dim narration-jobs-count">{{ items.length }} 个</span>
          </div>

          <div v-if="loading && !items.length" class="narration-jobs-empty dim">加载中…</div>
          <div v-else-if="!items.length" class="narration-jobs-empty">
            <p class="dim">还没有解说任务，在上方创建第一个</p>
          </div>
          <div v-else class="narration-jobs-grid">
            <button
              v-for="item in items"
              :key="item.id"
              type="button"
              class="narration-job-card"
              @click="openJob(item)"
            >
              <div class="narration-job-head">
                <span class="narration-job-type">任务</span>
                <span class="narration-job-stage">{{ stageLabel(item.stage) }}</span>
              </div>
              <strong class="narration-job-title">{{ item.title }}</strong>
              <p class="narration-job-meta dim">
                #{{ item.id }} · {{ formatTime(item.updated_at || item.created_at) }}
              </p>
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { narrationAPI } from '~/composables/useApi'
import { NARRATION_STAGE_LABELS } from '~/constants/narration-steps.js'
import { toast } from 'vue-sonner'

const router = useRouter()
const loading = ref(false)
const uploading = ref(false)
const uploadError = ref('')
const items = ref([])
const pickedFile = ref(null)
const newTitle = ref('')
const novelText = ref('')
const fileInputRef = ref(null)

function stageLabel(stage) {
  return NARRATION_STAGE_LABELS[stage] || stage || '上传'
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
  pickedFile.value = event.target.files?.[0] || null
}

async function reload() {
  loading.value = true
  try {
    const res = await narrationAPI.list()
    items.value = res?.items || []
  } catch (err) {
    toast.error(err?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function startCreate() {
  if (uploading.value) return
  if (!pickedFile.value && !novelText.value.trim()) return
  uploading.value = true
  uploadError.value = ''
  try {
    const job = await narrationAPI.create({
      title: newTitle.value,
      novel_text: novelText.value,
      file: pickedFile.value || undefined,
    })
    toast.success('解说任务已创建')
    pickedFile.value = null
    novelText.value = ''
    newTitle.value = ''
    if (fileInputRef.value) fileInputRef.value.value = ''
    await router.push(`/narration/${job.id}`)
  } catch (err) {
    uploadError.value = err?.message || '创建失败'
    toast.error(uploadError.value)
  } finally {
    uploading.value = false
  }
}

function openJob(item) {
  router.push(`/narration/${item.id}`)
}

onMounted(reload)
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
  margin: 0;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
}

.studio-desc {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-1);
  max-width: 720px;
  line-height: 1.55;
}

.narration-list-workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin: 0 16px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  background: #0d0f14;
}

.narration-list-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.35);
  flex-shrink: 0;
}

.narration-list-toolbar-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.88);
}

.narration-list-toolbar-hint {
  font-size: 11px;
}

.narration-list-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background-color: #0d0f14;
  background-image: radial-gradient(circle, rgba(255, 255, 255, 0.07) 1px, transparent 1px);
  background-size: 24px 24px;
}

.narration-create-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgba(22, 26, 36, 0.94);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
}

.narration-create-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.narration-file-input {
  display: none;
}

.narration-title-input {
  min-width: 180px;
  max-width: 280px;
  flex: 1;
}

.narration-text-input {
  width: 100%;
  min-height: 140px;
}

.narration-error {
  margin: 0;
  color: #ffb4b4;
  font-size: 13px;
}

.narration-jobs-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.narration-jobs-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.narration-jobs-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
}

.narration-jobs-count {
  font-size: 11px;
}

.narration-jobs-empty {
  padding: 28px 16px;
  text-align: center;
  border: 1px dashed rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgba(22, 26, 36, 0.5);
}

.narration-jobs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.narration-job-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgba(22, 26, 36, 0.94);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.narration-job-card:hover {
  border-color: rgba(255, 255, 255, 0.28);
}

.narration-job-card:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgba(76, 125, 255, 0.35), 0 12px 32px rgba(0, 0, 0, 0.45);
}

.narration-job-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.narration-job-type {
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
}

.narration-job-stage {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.72);
}

.narration-job-title {
  font-size: 14px;
  line-height: 1.3;
  color: rgba(255, 255, 255, 0.92);
}

.narration-job-meta {
  margin: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}

/* 深色工作区内的表单控件 */
.narration-list-workspace :deep(.input),
.narration-list-workspace :deep(.textarea) {
  color: rgba(255, 255, 255, 0.92);
  background: rgba(0, 0, 0, 0.28);
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow: none;
}

.narration-list-workspace :deep(.input:hover),
.narration-list-workspace :deep(.textarea:hover) {
  border-color: rgba(255, 255, 255, 0.22);
}

.narration-list-workspace :deep(.input:focus),
.narration-list-workspace :deep(.textarea:focus) {
  border-color: rgba(120, 170, 255, 0.65);
  box-shadow: 0 0 0 1px rgba(120, 170, 255, 0.25);
  background: rgba(0, 0, 0, 0.35);
}

.narration-list-workspace :deep(.input::placeholder),
.narration-list-workspace :deep(.textarea::placeholder) {
  color: rgba(255, 255, 255, 0.35);
}

.narration-list-workspace :deep(.btn) {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.88);
  box-shadow: none;
}

.narration-list-workspace :deep(.btn:hover) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.24);
  color: #fff;
  transform: none;
}

.narration-list-workspace :deep(.btn-primary) {
  background: var(--accent-gradient);
  border-color: transparent;
  color: #fff;
}

.narration-list-workspace :deep(.dim) {
  color: rgba(255, 255, 255, 0.45);
}
</style>
