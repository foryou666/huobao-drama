<script setup lang="ts">
import type { AssistantAttachment, AssistantMessage } from '~/composables/useEpisodeAssistant'
import { mediaDisplayUrl } from '~/utils/media-url.js'

const props = defineProps<{
  messages: AssistantMessage[]
  running: boolean
  loadingHistory: boolean
  quickChips: string[]
  agentType: string | null
  stepLabel: string
  disabled: boolean
  collapsed?: boolean
  selectedStoryboard?: { id: number; index: number; title?: string } | null
  characters?: Array<Record<string, any>>
  scenes?: Array<Record<string, any>>
  storyboards?: Array<Record<string, any>>
}>()

const input = defineModel<string>('input', { default: '' })

const emit = defineEmits<{
  send: [text: string]
  clear: []
  stop: []
  toggle: []
  navigate: [attachment: AssistantAttachment]
}>()

const listRef = ref<HTMLElement | null>(null)

watch(
  () => props.messages,
  async () => {
    await nextTick()
    const el = listRef.value
    if (el) el.scrollTop = el.scrollHeight
  },
  { deep: true },
)

function onSubmit() {
  const text = input.value.trim()
  if (!text) return
  emit('send', text)
}

function onChip(text: string) {
  emit('send', text)
}

function insertShotRef() {
  const sb = props.selectedStoryboard
  if (!sb) return
  const tag = `@镜头${sb.index}${sb.title ? `（${sb.title}）` : ''} `
  input.value = input.value ? `${input.value.trimEnd()} ${tag}` : tag
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    onSubmit()
  }
}

function formatTime(at: number) {
  return new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function isStreamingMessage(msg: AssistantMessage) {
  if (!props.running || msg.role !== 'assistant') return false
  const last = props.messages[props.messages.length - 1]
  return last?.id === msg.id
}

function mediaUrl(raw?: string | null) {
  return mediaDisplayUrl(raw)
}

function resolveAttachmentUrl(att: AssistantAttachment) {
  if (att.url) return mediaUrl(att.url)
  if (att.kind === 'character' && att.id) {
    const c = props.characters?.find(item => item.id === att.id)
    return mediaUrl(c?.image_url || c?.imageUrl)
  }
  if (att.kind === 'scene' && att.id) {
    const s = props.scenes?.find(item => item.id === att.id)
    return mediaUrl(s?.image_url || s?.imageUrl)
  }
  if (att.id && props.storyboards?.length) {
    const sb = props.storyboards.find(item => item.id === att.id)
    if (!sb) return null
    if (att.kind === 'shot_frame') {
      if (att.frame_type === 'last_frame') return mediaUrl(sb.last_frame_image || sb.lastFrameImage)
      return mediaUrl(sb.first_frame_image || sb.firstFrameImage)
    }
    if (att.kind === 'shot_blocking') return mediaUrl(sb.blocking_image || sb.blockingImage)
    if (att.kind === 'shot_video') return mediaUrl(sb.video_url || sb.videoUrl)
    if (att.kind === 'shot_compose') return mediaUrl(sb.composed_video_url || sb.composedVideoUrl)
    return mediaUrl(sb.composed_image || sb.composedImage || sb.first_frame_image || sb.firstFrameImage)
  }
  return null
}

function enrichedAttachments(msg: AssistantMessage) {
  return (msg.attachments || []).map(att => {
    const url = resolveAttachmentUrl(att)
    const ready = att.status === 'ready' || (!!url && att.status !== 'failed')
    return {
      ...att,
      url,
      ready,
      clickable: att.id > 0,
    }
  })
}

function onAttachmentClick(att: AssistantAttachment) {
  if (!att.id) return
  emit('navigate', att)
}
</script>

<template>
  <aside v-show="!collapsed" class="assistant-panel">
    <div class="assistant-head">
      <div>
        <div class="assistant-title">制作助手</div>
        <div class="assistant-sub">本集对话 · 当前步骤：{{ stepLabel }}</div>
      </div>
      <div class="assistant-head-actions">
        <button type="button" class="assistant-clear" title="收起面板" @click="emit('toggle')">收起</button>
        <button type="button" class="assistant-clear" title="清空对话" @click="emit('clear')">清空</button>
      </div>
    </div>

    <div v-if="selectedStoryboard" class="assistant-context">
      <span class="assistant-context-tag">已选 镜头 #{{ selectedStoryboard.index }}</span>
      <span class="assistant-context-title">{{ selectedStoryboard.title || '未命名' }}</span>
      <button type="button" class="assistant-context-btn" :disabled="disabled" @click="insertShotRef">引用到输入框</button>
    </div>

    <div v-if="!agentType" class="assistant-empty">
      导出等步骤暂不支持对话助手，请回到剧本或制作步骤。
    </div>

    <div v-else-if="loadingHistory" class="assistant-empty">
      加载对话历史…
    </div>

    <div v-else ref="listRef" class="assistant-messages">
      <div v-if="!messages.length" class="assistant-hint">
        <p>用对话完成本集制作与迭代，切换左侧菜单不会清空这里的对话；左侧一键操作也会显示在这里。</p>
        <ul>
          <li>生成 / 重新生成图片、视频、配音</li>
          <li>提取角色、改写剧本、拆解分镜</li>
          <li>选中镜头后点「引用到输入框」</li>
        </ul>
      </div>
      <div
        v-for="msg in messages"
        :key="msg.id"
        :class="['assistant-msg', msg.role]"
      >
        <div class="assistant-msg-meta">
          <span>{{ msg.role === 'user' ? '你' : '助手' }}</span>
          <span class="assistant-msg-time">{{ formatTime(msg.at) }}</span>
        </div>
        <div class="assistant-msg-body">
          {{ msg.content || (running && msg.role === 'assistant' ? '思考与执行中…' : '') }}<span
            v-if="isStreamingMessage(msg) && msg.content"
            class="assistant-cursor"
          >▍</span>
        </div>
        <div v-if="msg.toolSummary" class="assistant-tool">{{ msg.toolSummary }}</div>
        <div v-if="enrichedAttachments(msg).length" class="assistant-attachments">
          <button
            v-for="(att, idx) in enrichedAttachments(msg)"
            :key="`${msg.id}-att-${idx}`"
            type="button"
            class="assistant-attachment"
            :class="{ ready: att.ready, processing: !att.ready && att.status !== 'failed', failed: att.status === 'failed' }"
            :disabled="!att.clickable"
            :title="att.clickable ? '点击查看左侧对应项' : att.label"
            @click="onAttachmentClick(att)"
          >
            <img v-if="att.url" :src="att.url" :alt="att.label || '生成结果'" class="assistant-attachment-img" />
            <div v-else class="assistant-attachment-placeholder">
              <span>{{ att.status === 'failed' ? '失败' : '生成中' }}</span>
            </div>
            <span class="assistant-attachment-label">{{ att.label || att.kind }}</span>
          </button>
        </div>
      </div>
    </div>

    <div v-if="agentType && quickChips.length" class="assistant-chips">
      <button
        v-for="chip in quickChips"
        :key="chip"
        type="button"
        class="assistant-chip"
        :disabled="disabled"
        @click="onChip(chip)"
      >
        {{ chip }}
      </button>
    </div>

    <div class="assistant-input-wrap">
      <textarea
        v-model="input"
        class="assistant-input"
        rows="3"
        :disabled="disabled && !running"
        :placeholder="agentType ? '输入调整指令，Enter 发送，Shift+Enter 换行' : '当前步骤不可用'"
        @keydown="onKeydown"
      />
      <div class="assistant-actions">
        <button
          v-if="running"
          type="button"
          class="assistant-stop"
          @click="emit('stop')"
        >
          停止
        </button>
        <button
          type="button"
          class="assistant-send"
          :disabled="(disabled && !running) || (!running && !input.trim())"
          @click="onSubmit"
        >
          {{ running ? '生成中…' : '发送' }}
        </button>
      </div>
    </div>
  </aside>

  <button
    v-if="collapsed"
    type="button"
    class="assistant-fab"
    title="展开制作助手"
    @click="emit('toggle')"
  >
    助手
  </button>
</template>

<style scoped>
.assistant-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  border-radius: 28px;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  box-shadow: var(--shadow-panel);
  backdrop-filter: blur(12px);
}

.assistant-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.assistant-head-actions {
  display: flex;
  gap: 4px;
}

.assistant-title {
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-0);
}

.assistant-sub {
  margin-top: 2px;
  font-size: 10px;
  color: var(--text-3);
}

.assistant-clear {
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 10px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}

.assistant-clear:hover {
  color: var(--text-1);
  background: var(--bg-hover);
}

.assistant-context {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--accent-bg);
  flex-shrink: 0;
}

.assistant-context-tag {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent-text);
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(76, 125, 255, 0.12);
}

.assistant-context-title {
  flex: 1;
  min-width: 0;
  font-size: 10px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-context-btn {
  border: 1px solid var(--border);
  background: var(--bg-0);
  color: var(--text-2);
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 999px;
  cursor: pointer;
}

.assistant-context-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-text);
}

.assistant-context-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.assistant-messages {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.assistant-empty,
.assistant-hint {
  font-size: 11px;
  line-height: 1.55;
  color: var(--text-2);
}

.assistant-hint ul {
  margin: 8px 0 0 16px;
}

.assistant-msg.user .assistant-msg-body {
  background: var(--accent-bg);
  border: 1px solid rgba(76, 125, 255, 0.18);
}

.assistant-msg.assistant .assistant-msg-body {
  background: var(--bg-1);
  border: 1px solid var(--border);
}

.assistant-msg-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  color: var(--text-3);
  margin-bottom: 4px;
}

.assistant-msg-body {
  padding: 8px 10px;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-1);
  white-space: pre-wrap;
  word-break: break-word;
}

.assistant-cursor {
  animation: assistant-blink 1s step-end infinite;
  color: var(--accent);
}

@keyframes assistant-blink {
  50% { opacity: 0; }
}

.assistant-tool {
  margin-top: 4px;
  font-size: 10px;
  color: var(--success);
}

.assistant-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.assistant-attachment {
  width: 72px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-0);
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  text-align: left;
}

.assistant-attachment:disabled {
  cursor: default;
}

.assistant-attachment.ready:not(:disabled):hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-glow);
}

.assistant-attachment.processing {
  border-style: dashed;
}

.assistant-attachment.failed {
  border-color: var(--error);
}

.assistant-attachment-img,
.assistant-attachment-placeholder {
  width: 100%;
  height: 72px;
  object-fit: cover;
  display: block;
  background: var(--bg-1);
}

.assistant-attachment-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--text-3);
}

.assistant-attachment-label {
  display: block;
  padding: 4px 6px;
  font-size: 9px;
  line-height: 1.3;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 12px 8px;
  flex-shrink: 0;
}

.assistant-chip {
  border: 1px solid var(--border);
  background: var(--bg-0);
  color: var(--text-2);
  font-size: 10px;
  padding: 4px 8px;
  border-radius: 999px;
  cursor: pointer;
  line-height: 1.3;
  max-width: 100%;
  text-align: left;
}

.assistant-chip:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-text);
  background: var(--accent-bg);
}

.assistant-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.assistant-input-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.assistant-input {
  width: 100%;
  resize: vertical;
  min-height: 64px;
  max-height: 140px;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  font-family: var(--font-body);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-0);
}

.assistant-input:focus {
  outline: none;
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.assistant-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.assistant-stop {
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-0);
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}

.assistant-stop:hover {
  border-color: var(--error);
  color: var(--error);
}

.assistant-send {
  height: 32px;
  padding: 0 16px;
  border: none;
  border-radius: 10px;
  background: var(--accent-gradient);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.assistant-send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.assistant-fab {
  position: fixed;
  right: 16px;
  bottom: 24px;
  z-index: 40;
  height: 40px;
  padding: 0 16px;
  border: 1px solid var(--panel-border);
  border-radius: 999px;
  background: var(--accent-gradient);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--shadow-lg);
}
</style>
