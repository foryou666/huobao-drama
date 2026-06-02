<template>
  <div v-if="open" class="manual-entity-overlay" @click.self="close">
    <div class="manual-entity-dialog card">
      <div class="manual-entity-head">
        <div>
          <h3 class="manual-entity-title">{{ title }}</h3>
          <p class="dim manual-entity-sub">{{ subtitle }}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="close">关闭</button>
      </div>

      <div class="manual-entity-body">
        <template v-if="type === 'character'">
          <label class="manual-entity-field">
            <span class="manual-entity-label">角色名称 *</span>
            <input v-model="form.name" class="input" placeholder="如：岑柚" />
          </label>
          <label class="manual-entity-field">
            <span class="manual-entity-label">角色类型</span>
            <input v-model="form.role" class="input" placeholder="如：女主 / 配角 / 旁白" />
          </label>
          <label class="manual-entity-field">
            <span class="manual-entity-label">人物描述</span>
            <textarea v-model="form.description" class="textarea" rows="3" placeholder="身份、性格、与剧情关系" />
          </label>
          <label class="manual-entity-field">
            <span class="manual-entity-label">外貌特征</span>
            <textarea v-model="form.appearance" class="textarea" rows="3" placeholder="发型、服装、体态等，用于生成形象" />
          </label>
        </template>

        <template v-else>
          <label class="manual-entity-field">
            <span class="manual-entity-label">场景地点 *</span>
            <input v-model="form.location" class="input" placeholder="如：慈宁宫殿门 / 御书房" />
          </label>
          <label class="manual-entity-field">
            <span class="manual-entity-label">时间段</span>
            <input v-model="form.time" class="input" placeholder="如：日 / 夜 / 黄昏" />
          </label>
          <label class="manual-entity-field">
            <span class="manual-entity-label">场景描述 / 图片提示词</span>
            <textarea v-model="form.prompt" class="textarea" rows="4" placeholder="光线、色调、氛围、空间布局等" />
          </label>
        </template>
      </div>

      <div class="manual-entity-foot">
        <button type="button" class="btn btn-sm" @click="close">取消</button>
        <button type="button" class="btn btn-primary btn-sm" :disabled="saving || !canSubmit" @click="submit">
          {{ saving ? '保存中…' : confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { characterAPI, sceneAPI } from '~/composables/useApi'

const props = defineProps({
  open: { type: Boolean, default: false },
  type: { type: String, default: 'character' },
  dramaId: { type: Number, default: null },
  episodeId: { type: Number, default: null },
})

const emit = defineEmits(['close', 'created'])

const saving = ref(false)
const form = reactive({
  name: '',
  role: '',
  description: '',
  appearance: '',
  location: '',
  time: '',
  prompt: '',
})

const title = computed(() => (props.type === 'character' ? '手动添加角色' : '手动添加场景'))
const subtitle = computed(() => (
  props.type === 'character'
    ? '添加到当前剧本项目，并关联到本集'
    : '添加到当前剧本项目，并关联到本集（同地点+时间会自动合并关联）'
))
const confirmLabel = computed(() => (props.type === 'character' ? '添加角色' : '添加场景'))
const canSubmit = computed(() => {
  if (props.type === 'character') return !!String(form.name || '').trim()
  return !!String(form.location || '').trim()
})

function resetForm() {
  form.name = ''
  form.role = ''
  form.description = ''
  form.appearance = ''
  form.location = ''
  form.time = ''
  form.prompt = ''
}

async function submit() {
  if (!props.dramaId || !props.episodeId) {
    toast.error('缺少剧集信息')
    return
  }
  saving.value = true
  try {
    if (props.type === 'character') {
      const res = await characterAPI.create({
        drama_id: props.dramaId,
        episode_id: props.episodeId,
        name: form.name.trim(),
        role: form.role.trim(),
        description: form.description.trim(),
        appearance: form.appearance.trim(),
      })
      toast.success(res?.merged ? '已关联同名角色到本集' : '角色已添加')
    } else {
      const res = await sceneAPI.create({
        drama_id: props.dramaId,
        episode_id: props.episodeId,
        location: form.location.trim(),
        time: form.time.trim(),
        prompt: form.prompt.trim() || form.location.trim(),
      })
      toast.success(res?.merged ? '已关联相同场景到本集' : '场景已添加')
    }
    emit('created')
    emit('close')
    resetForm()
  } catch (e) {
    toast.error(e?.message || '添加失败')
  } finally {
    saving.value = false
  }
}

function close() {
  emit('close')
}

watch(() => [props.open, props.type], ([open]) => {
  if (open) resetForm()
})
</script>

<style scoped>
.manual-entity-overlay {
  position: fixed;
  inset: 0;
  z-index: 132;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(18, 24, 34, 0.68);
  backdrop-filter: blur(8px);
}
.manual-entity-dialog {
  width: min(520px, calc(100vw - 48px));
  border-radius: 20px;
  overflow: hidden;
}
.manual-entity-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 12px;
  border-bottom: 1px solid rgba(27, 41, 64, 0.08);
}
.manual-entity-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}
.manual-entity-sub { margin: 4px 0 0; font-size: 12px; }
.manual-entity-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px;
}
.manual-entity-field { display: flex; flex-direction: column; gap: 6px; }
.manual-entity-label { font-size: 12px; font-weight: 600; color: var(--text-2); }
.manual-entity-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px 18px;
  border-top: 1px solid rgba(27, 41, 64, 0.08);
}
</style>
