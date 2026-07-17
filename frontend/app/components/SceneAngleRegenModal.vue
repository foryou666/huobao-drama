<template>
  <div v-if="open" class="scene-angle-regen-overlay" @click.self="close">
    <div class="scene-angle-regen-dialog card">
      <div class="scene-angle-regen-head">
        <div>
          <h3 class="scene-angle-regen-title">调整提示词并重生成</h3>
          <p class="dim scene-angle-regen-sub">{{ subtitle }}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="close">关闭</button>
      </div>

      <div class="scene-angle-regen-body">
        <button
          v-if="imageUrl"
          type="button"
          class="scene-angle-regen-preview"
          @click="emit('preview', previewSrc)"
        >
          <img :src="previewSrc" :alt="angleLabel" />
          <span class="dim">点击查看大图</span>
        </button>

        <label class="scene-angle-regen-prompt-field">
          <span class="scene-angle-regen-prompt-label">生成提示词</span>
          <span class="dim scene-angle-regen-prompt-hint">可修改机位、构图、强调元素等；提交后将覆盖当前角度图（12 积分）</span>
          <textarea
            v-model="promptDraft"
            class="textarea scene-angle-regen-prompt"
            rows="8"
            :placeholder="promptPlaceholder"
          />
        </label>
      </div>

      <div class="scene-angle-regen-foot">
        <button type="button" class="btn btn-sm" @click="resetPrompt">恢复默认</button>
        <div class="scene-angle-regen-actions">
          <button type="button" class="btn btn-sm" @click="close">取消</button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="disabled || !promptDraft.trim()"
            @click="confirm"
          >
            {{ disabled ? '生成中…' : '确认重生成' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  open: { type: Boolean, default: false },
  sceneLocation: { type: String, default: '' },
  angleLabel: { type: String, default: '' },
  angleId: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  initialPrompt: { type: String, default: '' },
  defaultPrompt: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  isSheet: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'confirm', 'preview'])

const promptDraft = ref('')

const subtitle = computed(() => {
  const scope = props.isSheet ? '多视角拼板' : `「${props.angleLabel}」角度`
  return `${props.sceneLocation || '场景'} · ${scope} · 基于主视角参考图`
})

const promptPlaceholder = computed(() => (
  props.isSheet
    ? '例如：左格全景、中格左45°、右格对面，保持同一客厅空间与暖色灯光…'
    : '例如：机位略低，强调沙发与茶几关系，保持相同装修与光照…'
))

const previewSrc = computed(() => {
  const raw = String(props.imageUrl || '').replace(/^\/+/, '')
  return raw ? `/${raw}` : ''
})

function close() {
  emit('close')
}

function resetPrompt() {
  promptDraft.value = props.defaultPrompt || props.initialPrompt || ''
}

function confirm() {
  const value = promptDraft.value.trim()
  if (!value || props.disabled) return
  emit('confirm', value)
}

watch(() => [props.open, props.initialPrompt], ([isOpen, prompt]) => {
  if (isOpen) promptDraft.value = prompt || props.defaultPrompt || ''
}, { immediate: true })
</script>

<style scoped>
.scene-angle-regen-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(8, 12, 20, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.scene-angle-regen-dialog {
  width: min(640px, 100%);
  max-height: min(85vh, 760px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.scene-angle-regen-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 8px;
  border-bottom: 1px solid var(--border);
}
.scene-angle-regen-title { margin: 0; font-size: 16px; }
.scene-angle-regen-sub { margin: 4px 0 0; font-size: 11px; line-height: 1.4; }
.scene-angle-regen-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 16px;
  overflow: auto;
}
.scene-angle-regen-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  align-self: center;
}
.scene-angle-regen-preview img {
  width: min(280px, 100%);
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-2);
}
.scene-angle-regen-preview span { font-size: 10px; }
.scene-angle-regen-prompt-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.scene-angle-regen-prompt-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-dim);
}
.scene-angle-regen-prompt-hint { font-size: 10px; line-height: 1.35; }
.scene-angle-regen-prompt {
  width: 100%;
  min-height: 160px;
  font-size: 12px;
  line-height: 1.45;
}
.scene-angle-regen-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg-1);
}
.scene-angle-regen-actions {
  display: flex;
  gap: 8px;
}
</style>
