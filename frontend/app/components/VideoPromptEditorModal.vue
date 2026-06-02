<template>
  <div v-if="open" class="video-prompt-overlay" @click.self="close">
    <div class="video-prompt-dialog card">
      <div class="video-prompt-head">
        <div>
          <h3 class="video-prompt-title">{{ title }}</h3>
          <p class="dim video-prompt-sub">{{ subtitle }}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="close">关闭</button>
      </div>

      <div class="video-prompt-context" v-if="contextLines.length">
        <div v-for="(line, idx) in contextLines" :key="idx" class="video-prompt-context-line">{{ line }}</div>
      </div>

      <div class="video-prompt-view-tabs">
        <button type="button" :class="['btn btn-sm', { 'btn-primary': viewTab === 'edit' }]" @click="viewTab = 'edit'">编辑</button>
        <button
          type="button"
          :class="['btn btn-sm', { 'btn-primary': viewTab === 'compare' }]"
          :disabled="!lastChange"
          @click="viewTab = 'compare'"
        >
          对比
          <span v-if="lastChange" class="tag mono video-prompt-tab-badge">新</span>
        </button>
        <button type="button" :class="['btn btn-sm', { 'btn-primary': viewTab === 'history' }]" @click="viewTab = 'history'">
          历史
          <span v-if="historyItems.length" class="tag mono video-prompt-tab-badge">{{ historyItems.length }}</span>
        </button>
      </div>

      <div v-if="viewTab === 'edit'" class="video-prompt-field">
        <span class="video-prompt-label">视频提示词</span>
        <textarea
          v-model="promptDraft"
          class="textarea video-prompt-textarea"
          rows="14"
          placeholder="拆解分镜时生成，可在此完整编辑；支持多段【镜头 NNN】结构"
        />
        <div class="video-prompt-meta">
          <span class="dim">{{ promptDraft.length }} 字</span>
          <span class="dim">当前视频模型：{{ videoModelLabel || '未配置' }}</span>
        </div>
      </div>

      <div v-else-if="viewTab === 'compare' && lastChange" class="video-prompt-compare-panel">
        <div class="video-prompt-compare-head">
          <div>
            <div class="video-prompt-compare-title">{{ lastChange.label || '本次修改' }}</div>
            <div class="dim video-prompt-compare-time">{{ formatTime(lastChange.createdAt) }}</div>
          </div>
          <div class="video-prompt-compare-actions">
            <button type="button" class="btn btn-sm" @click="undoLastChange">撤销本次</button>
            <button type="button" class="btn btn-primary btn-sm" @click="viewTab = 'edit'">继续编辑</button>
          </div>
        </div>
        <VideoPromptDiffPanel
          :before-text="lastChange.before"
          :after-text="lastChange.after"
        />
      </div>

      <div v-else-if="viewTab === 'history'" class="video-prompt-history-panel">
        <div v-if="historyLoading" class="dim video-prompt-history-empty">加载历史…</div>
        <div v-else-if="!historyItems.length" class="dim video-prompt-history-empty">暂无修改历史</div>
        <template v-else>
          <div class="video-prompt-history-list">
            <button
              v-for="item in historyItems"
              :key="item.id"
              type="button"
              :class="['video-prompt-history-item', { active: selectedHistoryId === item.id }]"
              @click="selectHistory(item)"
            >
              <div class="video-prompt-history-item-head">
                <span class="video-prompt-history-label">{{ item.label }}</span>
                <span class="dim">{{ formatTime(item.created_at) }}</span>
              </div>
              <div class="dim video-prompt-history-preview">{{ previewText(item.after_prompt) }}</div>
            </button>
          </div>
          <div v-if="selectedHistory" class="video-prompt-history-detail card">
            <div class="video-prompt-compare-head">
              <div>
                <div class="video-prompt-compare-title">{{ selectedHistory.label }}</div>
                <div class="dim video-prompt-compare-time">{{ formatTime(selectedHistory.created_at) }}</div>
              </div>
              <div class="video-prompt-compare-actions">
                <button type="button" class="btn btn-sm" @click="compareHistoryWithCurrent">对比当前</button>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  :disabled="restoring"
                  @click="restoreHistory(selectedHistory)"
                >
                  {{ restoring ? '恢复中…' : '恢复此版本' }}
                </button>
              </div>
            </div>
            <VideoPromptDiffPanel
              :before-text="selectedHistory.before_prompt"
              :after-text="selectedHistory.after_prompt"
            />
          </div>
        </template>
      </div>

      <div v-if="viewTab === 'edit'" class="video-prompt-ai">
        <div class="video-prompt-ai-head">
          <span class="video-prompt-label">专业导演优化</span>
          <span class="dim video-prompt-ai-hint">优化完成后自动进入「对比」页，可查看着色差异与左右对比</span>
        </div>
        <div class="video-prompt-special-grid">
          <button
            v-for="item in specialOptimizers"
            :key="item.focus"
            type="button"
            class="video-prompt-special-btn"
            :class="{ active: optimizing && optimizeMode === item.focus }"
            :disabled="optimizing || !promptDraft.trim()"
            @click="runOptimizeFocus(item.focus)"
          >
            <span class="video-prompt-special-title">
              <Loader2 v-if="optimizing && optimizeMode === item.focus" :size="13" class="animate-spin" />
              {{ optimizing && optimizeMode === item.focus ? `${item.label}中…` : item.label }}
            </span>
            <span class="dim video-prompt-special-desc">{{ item.desc }}</span>
          </button>
        </div>

        <div class="video-prompt-ai-head video-prompt-ai-head-secondary">
          <span class="video-prompt-label">自定义优化</span>
        </div>
        <div class="video-prompt-chips">
          <button
            v-for="chip in quickChips"
            :key="chip"
            type="button"
            class="video-prompt-chip"
            :disabled="optimizing"
            @click="applyChip(chip)"
          >
            {{ chip }}
          </button>
        </div>
        <textarea
          v-model="feedbackDraft"
          class="textarea video-prompt-feedback"
          rows="3"
          placeholder="例如：运镜再慢一些；加强眼神变化；保留图片1/图片2 映射"
        />
        <div class="video-prompt-ai-actions">
          <button type="button" class="btn btn-sm" :disabled="optimizing || !promptDraft.trim()" @click="runOptimize('polish')">
            <Loader2 v-if="optimizing && optimizeMode === 'polish'" :size="13" class="animate-spin" />
            {{ optimizing && optimizeMode === 'polish' ? '优化中…' : '润色优化' }}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="optimizing || (!promptDraft.trim() && !feedbackDraft.trim())"
            @click="runOptimize('rewrite')"
          >
            <Loader2 v-if="optimizing && optimizeMode === 'rewrite'" :size="13" class="animate-spin" />
            {{ optimizing && optimizeMode === 'rewrite' ? '重写中…' : '按反馈重写' }}
          </button>
        </div>
      </div>

      <div class="video-prompt-foot">
        <button type="button" class="btn btn-sm" @click="resetDraft">恢复打开前</button>
        <div class="video-prompt-foot-actions">
          <button type="button" class="btn btn-sm" @click="close">取消</button>
          <button type="button" class="btn btn-primary btn-sm" :disabled="saving || !promptDraft.trim()" @click="save">
            {{ saving ? '保存中…' : '保存并关闭' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { storyboardAPI } from '~/composables/useApi'
import VideoPromptDiffPanel from '~/components/VideoPromptDiffPanel.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  storyboardId: { type: Number, default: null },
  shotLabel: { type: String, default: '镜头' },
  initialPrompt: { type: String, default: '' },
  videoModelLabel: { type: String, default: '' },
  contextLines: { type: Array, default: () => [] },
})

const emit = defineEmits(['close', 'saved'])

const promptDraft = ref('')
const feedbackDraft = ref('')
const originalPrompt = ref('')
const optimizing = ref(false)
const optimizeMode = ref('polish')
const saving = ref(false)
const restoring = ref(false)
const viewTab = ref('edit')
const lastChange = ref(null)
const historyItems = ref([])
const historyLoading = ref(false)
const selectedHistoryId = ref(null)

const quickChips = [
  '增强运镜与镜头语言',
  '补充表演与口型细节',
  '优化光影与氛围',
  '精简冗余描述',
  '强化参考图映射首行',
]

const specialOptimizers = [
  { focus: 'transition', label: '转场优化', desc: '检查各段衔接，用导演视角优化切镜与过渡' },
  { focus: 'shot', label: '镜头优化', desc: '复检景别构图，符合竖屏红果网剧分镜习惯' },
  { focus: 'camera', label: '运镜优化', desc: '复检推拉摇移，让运镜服务情绪与叙事' },
  { focus: 'dialogue', label: '台词优化', desc: '核对台词时长、口型节奏与切镜是否合理' },
]

const focusSuccessLabels = {
  transition: '转场已优化',
  shot: '镜头已优化',
  camera: '运镜已优化',
  dialogue: '台词已优化',
}

const sourceLabels = {
  transition: '转场优化',
  shot: '镜头优化',
  camera: '运镜优化',
  dialogue: '台词优化',
  polish: '润色优化',
  rewrite: '按反馈重写',
  manual_save: '手动保存',
  restore: '恢复历史版本',
}

const title = computed(() => `${props.shotLabel} · 视频提示词`)
const subtitle = computed(() => '支持左右/着色对比、修改历史保存与版本恢复')
const selectedHistory = computed(() => historyItems.value.find(item => item.id === selectedHistoryId.value) || null)

function formatTime(raw) {
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString('zh-CN', { hour12: false })
}

function previewText(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  return value.length > 72 ? `${value.slice(0, 72)}…` : value
}

function normalizeHistoryItem(item) {
  return {
    id: item?.id,
    before_prompt: item?.before_prompt || item?.beforePrompt || '',
    after_prompt: item?.after_prompt || item?.afterPrompt || '',
    source: item?.source || '',
    label: item?.label || sourceLabels[item?.source] || item?.source || '修改',
    created_at: item?.created_at || item?.createdAt || '',
  }
}

async function loadHistory() {
  if (!props.storyboardId) {
    historyItems.value = []
    return
  }
  historyLoading.value = true
  try {
    const rows = await storyboardAPI.videoPromptHistory(props.storyboardId)
    historyItems.value = (rows || []).map(normalizeHistoryItem)
    if (!selectedHistoryId.value && historyItems.value.length) {
      selectedHistoryId.value = historyItems.value[0].id
    }
  } catch {
    historyItems.value = []
  } finally {
    historyLoading.value = false
  }
}

function recordChange(before, after, meta = {}) {
  if (before === after) return
  lastChange.value = {
    before,
    after,
    label: meta.label || sourceLabels[meta.source] || '修改',
    source: meta.source || 'polish',
    createdAt: meta.created_at || new Date().toISOString(),
    historyId: meta.historyId || meta.id || null,
  }
  viewTab.value = 'compare'
}

function applyOptimizationResult(before, res, source) {
  const after = (res?.after_prompt || res?.video_prompt || res?.videoPrompt || '').trim()
  if (!after) throw new Error('AI 未返回有效提示词')
  promptDraft.value = after
  const history = res?.history ? normalizeHistoryItem(res.history) : null
  recordChange(before, after, {
    source,
    label: history?.label || sourceLabels[source],
    created_at: history?.created_at,
    historyId: history?.id,
  })
  if (history) {
    historyItems.value = [history, ...historyItems.value.filter(item => item.id !== history.id)]
    selectedHistoryId.value = history.id
  } else {
    loadHistory()
  }
}

function resetDraft() {
  promptDraft.value = originalPrompt.value
  feedbackDraft.value = ''
  lastChange.value = null
  viewTab.value = 'edit'
}

function undoLastChange() {
  if (!lastChange.value) return
  promptDraft.value = lastChange.value.before
  lastChange.value = null
  viewTab.value = 'edit'
  toast.info('已撤销本次修改')
}

function applyChip(chip) {
  feedbackDraft.value = feedbackDraft.value ? `${feedbackDraft.value.trim()}；${chip}` : chip
}

async function runOptimize(mode, focus = 'general') {
  if (!props.storyboardId) return
  const before = promptDraft.value
  optimizing.value = true
  optimizeMode.value = focus !== 'general' ? focus : mode
  try {
    const res = await storyboardAPI.optimizeVideoPrompt(props.storyboardId, {
      current_prompt: before,
      feedback: feedbackDraft.value.trim() || undefined,
      mode,
      focus: focus !== 'general' ? focus : undefined,
    })
    applyOptimizationResult(before, res, focus !== 'general' ? focus : mode)
    toast.success(focusSuccessLabels[focus] || (mode === 'rewrite' ? '已按反馈重写' : '已润色优化'))
  } catch (e) {
    toast.error(e?.message || 'AI 优化失败')
  } finally {
    optimizing.value = false
  }
}

function runOptimizeFocus(focus) {
  runOptimize('polish', focus)
}

function selectHistory(item) {
  selectedHistoryId.value = item.id
}

function compareHistoryWithCurrent() {
  if (!selectedHistory.value) return
  recordChange(selectedHistory.value.after_prompt, promptDraft.value, {
    source: 'manual_save',
    label: `历史版本 vs 当前（${selectedHistory.value.label}）`,
  })
}

async function restoreHistory(item) {
  if (!props.storyboardId || !item?.id) return
  restoring.value = true
  try {
    const before = promptDraft.value
    const res = await storyboardAPI.restoreVideoPromptHistory(props.storyboardId, item.id)
    const after = res?.video_prompt || res?.videoPrompt || item.after_prompt
    promptDraft.value = after
    const history = res?.history ? normalizeHistoryItem(res.history) : null
    recordChange(before, after, {
      source: 'restore',
      label: history?.label || `恢复：${item.label}`,
      created_at: history?.created_at,
      historyId: history?.id,
    })
    await loadHistory()
    toast.success('已恢复该历史版本')
  } catch (e) {
    toast.error(e?.message || '恢复失败')
  } finally {
    restoring.value = false
  }
}

async function save() {
  if (!props.storyboardId) return
  saving.value = true
  try {
    const after = promptDraft.value.trim()
    await storyboardAPI.update(props.storyboardId, { video_prompt: after })
    emit('saved', { storyboardId: props.storyboardId, videoPrompt: after })
    emit('close')
    toast.success('视频提示词已保存')
  } catch (e) {
    toast.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

function close() {
  emit('close')
}

watch(() => [props.open, props.storyboardId, props.initialPrompt], ([open]) => {
  if (!open) return
  const initial = String(props.initialPrompt || '')
  originalPrompt.value = initial
  promptDraft.value = initial
  feedbackDraft.value = ''
  lastChange.value = null
  viewTab.value = 'edit'
  selectedHistoryId.value = null
  loadHistory()
}, { immediate: true })
</script>

<style scoped>
.video-prompt-overlay {
  position: fixed;
  inset: 0;
  z-index: 135;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(18, 24, 34, 0.72);
  backdrop-filter: blur(10px);
}
.video-prompt-dialog {
  width: min(1120px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  overflow: auto;
  border-radius: 24px;
}
.video-prompt-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px 12px;
  border-bottom: 1px solid rgba(27, 41, 64, 0.08);
}
.video-prompt-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  font-family: var(--font-display);
}
.video-prompt-sub { margin: 4px 0 0; font-size: 12px; }
.video-prompt-context {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  padding: 0 20px 12px;
}
.video-prompt-context-line {
  font-size: 12px;
  color: var(--text-2);
  background: rgba(59, 130, 246, 0.06);
  border: 1px solid rgba(59, 130, 246, 0.12);
  border-radius: 999px;
  padding: 4px 10px;
}
.video-prompt-view-tabs {
  display: flex;
  gap: 6px;
  padding: 0 20px 12px;
}
.video-prompt-tab-badge {
  margin-left: 4px;
  font-size: 10px;
  padding: 0 5px;
}
.video-prompt-field,
.video-prompt-ai,
.video-prompt-compare-panel,
.video-prompt-history-panel {
  padding: 0 20px 16px;
}
.video-prompt-label {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-2);
  margin-bottom: 8px;
}
.video-prompt-textarea {
  width: 100%;
  min-height: 280px;
  font-size: 14px;
  line-height: 1.65;
  font-family: var(--font-mono, ui-monospace, monospace);
  resize: vertical;
}
.video-prompt-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  font-size: 11px;
}
.video-prompt-compare-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.video-prompt-compare-title { font-size: 14px; font-weight: 700; }
.video-prompt-compare-time { font-size: 11px; margin-top: 2px; }
.video-prompt-compare-actions { display: flex; gap: 8px; flex-shrink: 0; }
.video-prompt-history-panel {
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
  gap: 12px;
  min-height: 280px;
}
.video-prompt-history-empty {
  grid-column: 1 / -1;
  padding: 40px 0;
  text-align: center;
}
.video-prompt-history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  overflow: auto;
}
.video-prompt-history-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid rgba(27, 41, 64, 0.1);
  border-radius: 12px;
  background: rgba(255,255,255,0.75);
  text-align: left;
  cursor: pointer;
}
.video-prompt-history-item.active {
  border-color: rgba(59, 130, 246, 0.4);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}
.video-prompt-history-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.video-prompt-history-label { font-size: 12px; font-weight: 700; }
.video-prompt-history-preview { font-size: 11px; line-height: 1.45; }
.video-prompt-history-detail { padding: 12px; min-width: 0; }
.video-prompt-ai {
  border-top: 1px solid rgba(27, 41, 64, 0.08);
  padding-top: 16px;
}
.video-prompt-ai-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}
.video-prompt-ai-head-secondary {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed rgba(27, 41, 64, 0.1);
}
.video-prompt-special-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 4px;
}
.video-prompt-special-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid rgba(27, 41, 64, 0.12);
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,251,255,0.88));
  text-align: left;
  cursor: pointer;
}
.video-prompt-special-btn:hover:not(:disabled) { border-color: rgba(59, 130, 246, 0.35); }
.video-prompt-special-btn.active { border-color: rgba(59, 130, 246, 0.45); }
.video-prompt-special-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.video-prompt-special-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
}
.video-prompt-special-desc { font-size: 11px; line-height: 1.45; }
.video-prompt-ai-hint { font-size: 11px; }
.video-prompt-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.video-prompt-chip {
  border: 1px solid rgba(27, 41, 64, 0.12);
  background: rgba(255, 255, 255, 0.8);
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 11px;
  color: var(--text-2);
  cursor: pointer;
}
.video-prompt-feedback {
  width: 100%;
  font-size: 13px;
  line-height: 1.55;
  margin-bottom: 10px;
}
.video-prompt-ai-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.video-prompt-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px 18px;
  border-top: 1px solid rgba(27, 41, 64, 0.08);
}
.video-prompt-foot-actions { display: flex; gap: 8px; }
@media (max-width: 900px) {
  .video-prompt-history-panel { grid-template-columns: 1fr; }
  .video-prompt-special-grid { grid-template-columns: 1fr; }
}
@media (max-width: 720px) {
  .video-prompt-overlay { padding: 12px; }
  .video-prompt-dialog { width: 100%; max-height: calc(100vh - 24px); }
  .video-prompt-textarea { min-height: 220px; font-size: 13px; }
}
</style>
