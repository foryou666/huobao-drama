<template>
  <div class="blocking-panel">
    <div class="blocking-panel-head">
      <div>
        <span class="blocking-panel-title">场景站位图 (Blocking)</span>
        <span class="dim blocking-panel-copy">3D 纯色人偶站位示意图，仅作空间布局参考，避免干扰后续视频生成</span>
      </div>
      <div class="blocking-panel-head-actions">
          <NuxtLink v-if="directorHref" :to="directorHref" class="btn btn-sm">3D 导演台</NuxtLink>
        <span v-if="shotLabel" class="tag mono">{{ shotLabel }}</span>
      </div>
    </div>

    <div v-if="shotModeHint" class="blocking-mode-hint dim">{{ shotModeHint }}</div>

    <div v-if="!characterIds.length" class="dim blocking-empty">
      请先在分镜中绑定角色，并关联已有场景图的场景。
    </div>
    <template v-else>
      <div class="blocking-layout-grid">
        <div
          v-for="(entry, index) in layout.characters"
          :key="`blocking:${sb?.id}:${entry.character_id}`"
          class="blocking-layout-row"
        >
          <span class="blocking-char-name">
            <span class="blocking-color-dot" :style="{ background: mannequinColorCss(index) }" :title="`${mannequinColorLabel(index)}人偶`" />
            {{ characterName(entry.character_id) }}
          </span>
          <select
            class="input blocking-select"
            :value="entry.zone"
            @change="emit('entry-change', entry.character_id, { zone: $event.target.value })"
          >
            <option v-for="zone in BLOCKING_ZONES" :key="zone.id" :value="zone.id">{{ zone.label }}</option>
          </select>
          <select
            class="input blocking-select"
            :value="entry.facing || 'camera'"
            @change="emit('entry-change', entry.character_id, { facing: $event.target.value })"
          >
            <option v-for="facing in BLOCKING_FACINGS" :key="facing.id" :value="facing.id">{{ facing.label }}</option>
          </select>
        </div>
      </div>
      <div v-if="colorLegend.length" class="blocking-legend card-sub">
        <div class="blocking-legend-head">
          <span class="field-label">视频生成 · 颜色站位说明</span>
          <button type="button" class="btn btn-sm" @click="copyVideoSnippet">复制到 video_prompt</button>
        </div>
        <p class="dim blocking-legend-copy">
          站位图按上表顺序分配纯色人偶。生视频时在 <code>video_prompt</code> 首行用「图片N是…」说明参考图含义；角色参考图负责长相，站位图只负责位置。
        </p>
        <ul class="blocking-legend-list">
          <li v-for="(line, index) in colorLegend" :key="`legend:${index}`">
            <span class="blocking-color-dot" :style="{ background: mannequinColorCss(index) }" />
            {{ line }}
          </li>
        </ul>
        <pre class="blocking-snippet">{{ videoPromptSnippet }}</pre>
      </div>
      <label class="field">
        <span class="field-label">站位备注（可选）</span>
        <input
          :value="layout.notes || ''"
          class="input"
          placeholder="如：A 略靠前，B 与 C 形成三角站位"
          @blur="emit('notes-blur', $event.target.value)"
        />
      </label>
      <label class="field">
        <span class="field-label">自定义提示词（可选）</span>
        <textarea
          v-model="promptDraft"
          class="textarea blocking-prompt"
          rows="3"
          placeholder="留空则使用系统模板（赛璐璐纯色人偶 previz）；失败时可在此微调机位、景别或风格描述"
        />
      </label>
      <div class="blocking-preview-row">
        <button
          type="button"
          class="blocking-preview"
          @click="blockingImage && emit('preview')"
        >
          <img v-if="blockingImage" :src="mediaDisplayUrl(blockingImage)" alt="站位图" />
          <div v-else class="blocking-preview-empty">
            <Loader2 v-if="pending" :size="18" class="animate-spin" />
            <span v-else>尚未生成站位图</span>
          </div>
        </button>
        <div class="blocking-actions">
          <button
            class="btn btn-sm btn-primary"
            :disabled="generateDisabled"
            @click="emit('generate', promptDraft.trim() || undefined)"
          >
            {{ pending ? '生成中…' : (blockingImage ? '重新生成' : '生成站位图') }}
          </button>
          <button
            v-if="blockingImage"
            class="btn btn-sm"
            :disabled="pendingFirstFrame || !imageReferenceSupported"
            @click="emit('gen-first')"
          >
            {{ pendingFirstFrame ? '首帧生成中…' : '从站位图生成首帧' }}
          </button>
          <button
            v-if="blockingImage && frameMode === 'first_last'"
            class="btn btn-sm"
            :disabled="pendingLastFrame || !imageReferenceSupported"
            @click="emit('gen-last')"
          >
            {{ pendingLastFrame ? '尾帧生成中…' : '从站位图生成尾帧' }}
          </button>
          <button
            v-if="blockingImage"
            class="btn btn-sm"
            @click="emit('clear')"
          >
            删除站位图
          </button>
          <span v-if="disableReason" class="blocking-hint blocking-hint-warn">{{ disableReason }}</span>
          <span v-else class="dim blocking-hint">需已绑定场景且场景/角色均有参考图；消耗 12 积分</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { Loader2 } from 'lucide-vue-next'
import { copyText } from '~/utils/copy-text.js'
import { mediaDisplayUrl } from '~/utils/media-url.js'
import {
  BLOCKING_ZONES,
  BLOCKING_FACINGS,
  buildBlockingColorLegend,
  buildBlockingVideoPromptSnippet,
  mannequinColorCss,
  mannequinColorLabel,
} from '~/utils/blocking-layout.js'

const props = defineProps({
  sb: { type: Object, default: null },
  shotLabel: { type: String, default: '' },
  frameMode: { type: String, default: 'first' },
  characterIds: { type: Array, default: () => [] },
  layout: { type: Object, default: () => ({ characters: [], notes: '' }) },
  blockingImage: { type: String, default: '' },
  blockingImageIndex: { type: Number, default: null },
  pending: { type: Boolean, default: false },
  pendingFirstFrame: { type: Boolean, default: false },
  pendingLastFrame: { type: Boolean, default: false },
  generateDisabled: { type: Boolean, default: false },
  disableReason: { type: String, default: '' },
  shotModeHint: { type: String, default: '' },
  initialPrompt: { type: String, default: '' },
  imageReferenceSupported: { type: Boolean, default: true },
  characterName: { type: Function, default: (id) => `#${id}` },
  directorHref: { type: String, default: '' },
})

const emit = defineEmits(['entry-change', 'notes-blur', 'generate', 'gen-first', 'gen-last', 'clear', 'preview'])

const promptDraft = ref('')

watch(() => [props.sb?.id, props.initialPrompt], () => {
  promptDraft.value = props.initialPrompt || ''
}, { immediate: true })

const colorLegend = computed(() => buildBlockingColorLegend(props.layout, props.characterName))

const videoPromptSnippet = computed(() =>
  buildBlockingVideoPromptSnippet(props.layout, props.characterName, props.blockingImageIndex),
)

async function copyVideoSnippet() {
  const text = videoPromptSnippet.value
  if (!text) return
  const ok = await copyText(text)
  if (ok) toast.success('已复制站位说明，可粘贴到 video_prompt 首行')
  else toast.error('复制失败，请手动选中下方文本')
}

function normalizePath(raw) {
  return String(raw || '').replace(/^\/+/, '')
}
</script>

<style scoped>
.blocking-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.blocking-panel-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.blocking-panel-title {
  display: block;
  font-size: 13px;
  font-weight: 700;
}
.blocking-panel-copy {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.4;
}
.blocking-empty { font-size: 12px; padding: 8px 0; }
.blocking-layout-grid { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.blocking-layout-row {
  display: grid;
  grid-template-columns: minmax(72px, 1fr) 1fr 1fr;
  gap: 8px;
  align-items: center;
}
.blocking-char-name { font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
.blocking-color-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  flex-shrink: 0;
}
.blocking-legend {
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-2);
}
.blocking-legend-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.blocking-legend-copy { font-size: 11px; line-height: 1.5; margin: 0 0 8px; }
.blocking-legend-list {
  margin: 0 0 8px;
  padding-left: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.blocking-legend-list li {
  display: flex;
  align-items: center;
  gap: 6px;
}
.blocking-snippet {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--bg-1);
  border: 1px solid var(--border);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-1);
}
.blocking-select { font-size: 12px; padding: 6px 8px; min-height: 32px; }
.blocking-preview-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.blocking-preview {
  width: 180px;
  aspect-ratio: 16 / 9;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-2);
  cursor: pointer;
  flex-shrink: 0;
}
.blocking-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
.blocking-preview-empty {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-dim);
  padding: 8px;
  text-align: center;
}
.blocking-actions { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; flex: 1; min-width: 180px; }
.blocking-hint { font-size: 11px; line-height: 1.4; max-width: 320px; }
.blocking-hint-warn { color: var(--warning); }
.blocking-mode-hint { font-size: 11px; line-height: 1.4; margin-bottom: 10px; }
.blocking-prompt { min-height: 72px; font-size: 12px; }
</style>
