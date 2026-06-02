<template>
  <div v-if="open" class="asset-picker-overlay" @click.self="close">
    <div class="asset-picker-dialog card">
      <div class="asset-picker-head">
        <div>
          <h3 class="asset-picker-title">{{ title }}</h3>
          <p class="dim asset-picker-sub">{{ subtitleText }}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="close">关闭</button>
      </div>
      <div class="asset-picker-toolbar">
        <input v-model="keyword" class="input" placeholder="搜索资产名称…" />
      </div>
      <div v-if="loading" class="dim asset-picker-empty">加载中…</div>
      <div v-else-if="!filteredItems.length" class="dim asset-picker-empty">暂无可用资产</div>
      <div v-else class="asset-picker-grid">
        <button
          v-for="item in filteredItems"
          :key="item.id"
          type="button"
          class="asset-picker-item"
          :class="{ selected: selectedItem?.id === item.id }"
          @click="onItemClick(item)"
        >
          <img :src="'/' + normalizePath(item.url || item.local_path || item.localPath)" :alt="item.name" />
          <span class="asset-picker-name">{{ item.name }}</span>
          <span class="asset-picker-tag">{{ assetCategoryLabel(item.type) }}</span>
        </button>
      </div>
      <div v-if="confirmBeforeSelect" class="asset-picker-foot">
        <div v-if="selectedItem" class="asset-picker-preview">
          <img :src="'/' + normalizePath(selectedItem.url || selectedItem.local_path || selectedItem.localPath)" :alt="selectedItem.name" />
          <div class="asset-picker-preview-copy">
            <span class="asset-picker-preview-name">{{ selectedItem.name }}</span>
            <span class="dim asset-picker-preview-hint">{{ confirmHint }}</span>
          </div>
        </div>
        <div v-else class="dim asset-picker-preview-empty">请先选择一张服装图</div>
        <label class="asset-picker-prompt-field">
          <span class="asset-picker-prompt-label">{{ promptLabel }}</span>
          <textarea
            v-model="customPrompt"
            class="textarea asset-picker-prompt"
            rows="3"
            :placeholder="promptPlaceholder"
          />
        </label>
        <div class="asset-picker-actions">
          <button type="button" class="btn btn-sm" @click="close">取消</button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="!selectedItem"
            @click="confirmPick"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { assetAPI } from '~/composables/useApi'
import { assetCategoryLabel } from '~/utils/asset-categories.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  type: { type: String, default: 'character' },
  dramaId: { type: Number, default: null },
  title: { type: String, default: '从资产库选择' },
  confirmBeforeSelect: { type: Boolean, default: false },
  confirmLabel: { type: String, default: '确认' },
  confirmHint: { type: String, default: '确认后将重新生成一张换装图' },
  promptLabel: { type: String, default: '自定义提示（可选）' },
  promptPlaceholder: {
    type: String,
    default: '例如：保持三视图拼板布局不变，仅替换为参考图2的服装，保持写实摄影质感。',
  },
})

const emit = defineEmits(['close', 'select'])

const loading = ref(false)
const items = ref([])
const keyword = ref('')
const selectedItem = ref(null)
const customPrompt = ref('')

const subtitleText = computed(() => {
  if (props.confirmBeforeSelect) return '选择服装后点击确认，将基于角色基准图重新生成换装图'
  return '仅显示有图片的资产'
})

const filteredItems = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return items.value.filter(item => {
    const url = item.url || item.local_path || item.localPath
    if (!url) return false
    if (!q) return true
    return String(item.name || '').toLowerCase().includes(q)
  })
})

function normalizePath(raw) {
  return String(raw || '').replace(/^\/+/, '')
}

async function load() {
  loading.value = true
  try {
    items.value = await assetAPI.list({ type: props.type }) || []
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}

function close() {
  emit('close')
}

function onItemClick(item) {
  if (props.confirmBeforeSelect) {
    selectedItem.value = item
    return
  }
  emit('select', item)
}

function confirmPick() {
  if (!selectedItem.value) return
  emit('select', {
    asset: selectedItem.value,
    prompt: customPrompt.value.trim() || undefined,
  })
}

watch(() => [props.open, props.type, props.dramaId], ([isOpen]) => {
  if (isOpen) {
    keyword.value = ''
    selectedItem.value = null
    customPrompt.value = ''
    load()
  }
}, { immediate: true })
</script>

<style scoped>
.asset-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(8, 12, 20, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.asset-picker-dialog {
  width: min(920px, 100%);
  max-height: min(80vh, 760px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.asset-picker-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 8px;
  border-bottom: 1px solid var(--border);
}
.asset-picker-title { margin: 0; font-size: 16px; }
.asset-picker-sub { margin: 4px 0 0; font-size: 11px; line-height: 1.4; }
.asset-picker-toolbar { padding: 12px 16px; }
.asset-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
  padding: 0 16px 16px;
  overflow: auto;
  flex: 1;
}
.asset-picker-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-1);
  cursor: pointer;
  text-align: left;
}
.asset-picker-item:hover { border-color: var(--accent); }
.asset-picker-item.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgba(76, 125, 255, 0.25);
  background: var(--accent-bg);
}
.asset-picker-item img {
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border-radius: 6px;
  background: var(--bg-2);
}
.asset-picker-name {
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-picker-tag { font-size: 10px; color: var(--text-dim); }
.asset-picker-empty { padding: 24px; text-align: center; }
.asset-picker-foot {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg-1);
}
.asset-picker-preview {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}
.asset-picker-preview img {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--border);
  flex-shrink: 0;
}
.asset-picker-preview-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.asset-picker-preview-name {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-picker-preview-hint { font-size: 11px; line-height: 1.3; }
.asset-picker-preview-empty { font-size: 12px; }
.asset-picker-prompt-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.asset-picker-prompt-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-dim);
}
.asset-picker-prompt {
  width: 100%;
  min-height: 72px;
  font-size: 12px;
}
.asset-picker-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-shrink: 0;
}
</style>
