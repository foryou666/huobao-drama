<template>
  <div class="studio-page narration-canvas-page">
    <header class="studio-header">
      <div class="studio-header-copy">
        <h1 class="studio-title">解说工作流</h1>
        <p class="studio-desc">
          上传小说 → 提取角色/场景/道具 → 定稿图 → 旁白分段 → TTS 原文朗读 → Grok 画面 → 导出剪映草稿。
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

          <div v-if="loading && !items.length" class="poster-grid">
            <div v-for="i in 6" :key="i" class="poster-card skeleton" />
          </div>
          <div v-else-if="!items.length" class="narration-jobs-empty">
            <p class="dim">还没有解说任务，在上方创建第一个</p>
          </div>
          <div v-else class="poster-grid">
            <article
              v-for="item in items"
              :key="item.id"
              class="poster-card"
              @click="openJob(item)"
            >
              <div class="poster-cover">
                <img
                  v-if="coverOf(item)"
                  :src="coverSrc(coverOf(item))"
                  :alt="item.title"
                  class="poster-img"
                  loading="lazy"
                />
                <div v-else class="poster-placeholder" aria-hidden="true" />

                <div class="poster-top">
                  <span class="episode-badge">解说漫</span>
                  <span class="share-badge">{{ stageLabel(item.stage) }}</span>
                </div>

                <div class="poster-top-right">
                  <button
                    v-if="isAdmin"
                    type="button"
                    class="share-action delete-action"
                    title="删除"
                    @click.stop="deleteJob(item)"
                  >删</button>
                  <span class="poster-nodes">{{ item.segment_count || 0 }} 段</span>
                </div>
              </div>

              <div class="poster-meta">
                <h3 class="poster-title">{{ item.title }}</h3>
                <div class="poster-stats">
                  <span v-if="item.drama_style" class="style-tag">{{ item.drama_style }}</span>
                  <span class="stat-item">角色 {{ item.character_count ?? 0 }}</span>
                  <span class="stat-item">场景 {{ item.scene_count ?? 0 }}</span>
                </div>
                <div class="poster-foot">
                  <span class="poster-id">#{{ item.id }}</span>
                  <span class="poster-date">{{ formatTime(item.updated_at || item.created_at) }}</span>
                </div>
              </div>
            </article>
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
import { mediaDisplayUrl } from '~/utils/media-url.js'
import { toast } from 'vue-sonner'
import { useAuth } from '~/composables/useAuth'

const { isAdmin } = useAuth()
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
    return new Date(raw).toLocaleString('zh-CN', {
      hour12: false,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return raw
  }
}

function coverOf(item) {
  const covers = item?.covers || {}
  return covers['3:4'] || item?.cover_3_4 || item?.cover_url || item?.thumbnail || ''
}

function coverSrc(raw) {
  return mediaDisplayUrl(raw)
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

async function deleteJob(item) {
  if (!item?.id) return
  if (!isAdmin.value) {
    toast.error('仅平台管理员可删除解说漫')
    return
  }
  if (!confirm(`确定删除解说漫「${item.title || `#${item.id}`}」？\n\n将从解说列表与项目列表中一并移除。`)) return
  try {
    await narrationAPI.delete(item.id)
    toast.success('已删除')
    items.value = items.value.filter(x => x.id !== item.id)
  } catch (err) {
    toast.error(err?.message || '删除失败')
  }
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

.poster-grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
  gap: 22px 16px;
}

.poster-card {
  cursor: pointer;
  border: none;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: transform 0.18s ease;
}

.poster-card:hover {
  transform: translateY(-3px);
}

.poster-card.skeleton {
  aspect-ratio: 3 / 4;
  border-radius: 12px;
  background: linear-gradient(110deg, #171a22 20%, #222735 40%, #171a22 60%);
  background-size: 200% 100%;
  animation: narr-shimmer 1.2s infinite linear;
}

@keyframes narr-shimmer {
  to { background-position: -200% 0; }
}

.poster-cover {
  position: relative;
  aspect-ratio: 3 / 4;
  border-radius: 12px;
  overflow: hidden;
  background: #151922;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}

.poster-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  display: block;
}

.poster-placeholder {
  width: 100%;
  height: 100%;
  background: linear-gradient(165deg, #2a3144 0%, #141820 48%, #0a0d14 100%);
}

.poster-top {
  position: absolute;
  top: 10px;
  left: 10px;
  right: 88px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.poster-top-right {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
}

.episode-badge,
.share-badge,
.poster-nodes {
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
}

.share-badge {
  background: rgba(64, 120, 255, 0.85);
}

.share-action {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
}

.share-action:hover {
  background: rgba(59, 130, 246, 0.85);
}

.delete-action:hover {
  background: rgba(239, 68, 68, 0.85);
}

.poster-meta {
  padding: 0 2px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.poster-title {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 650;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.94);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.poster-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.style-tag {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.78);
  background: rgba(255, 255, 255, 0.08);
}

.stat-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.62);
}

.poster-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.poster-id,
.poster-date {
  flex-shrink: 0;
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.42);
}

@media (max-width: 720px) {
  .poster-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px 10px;
  }
}

@media (min-width: 900px) {
  .poster-grid {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  }
}

@media (min-width: 1280px) {
  .poster-grid {
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  }
}

@media (min-width: 1600px) {
  .poster-grid {
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  }
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
