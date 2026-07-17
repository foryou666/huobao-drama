<template>
  <div v-if="open" class="dialog-mask" @click.self="close">
    <div class="card dialog">
      <div class="dialog-head">
        <div class="dialog-head-copy">
          <div class="dialog-kicker">Episode Setup</div>
          <div class="dialog-title-row">
            <div class="dialog-title">{{ title }}</div>
            <span class="dialog-badge">配置将锁定</span>
          </div>
          <div class="dialog-sub">{{ subtitle }}</div>
        </div>
        <button type="button" class="back-btn" @click="close">取消</button>
      </div>
      <div class="dialog-summary">
        <div class="summary-chip">图片 · {{ imageConfigs.length }} 可选</div>
        <div class="summary-chip">视频 · {{ videoConfigs.length }} 可选</div>
        <div class="summary-chip">音频 · {{ audioConfigs.length }} 可选</div>
      </div>
      <div class="dialog-body">
        <div class="dialog-section">
          <div class="dialog-section-head">
            <span class="dialog-section-title">基础信息</span>
            <span class="dialog-section-copy">这一项只影响显示名称，不影响生成配置</span>
          </div>
          <label class="field">
            <span class="field-label">标题</span>
            <input v-model="episodeTitle" class="input" placeholder="默认按集数自动命名" />
            <span class="field-hint">留空时会自动按集数命名，例如「第 3 集」。</span>
          </label>
        </div>
        <div class="dialog-section">
          <div class="dialog-section-head">
            <span class="dialog-section-title">生成配置</span>
            <span class="dialog-section-copy">创建后不可更改，建议在这里一次性选对</span>
          </div>
          <div class="config-grid">
            <label class="config-card">
              <span class="config-card-kicker">IMAGE</span>
              <span class="field-label">图片配置</span>
              <BaseSelect v-model="imageConfigId" :options="imageConfigOptions" placeholder="选择图片服务" searchable />
            </label>
            <label class="config-card">
              <span class="config-card-kicker">VIDEO</span>
              <span class="field-label">视频配置</span>
              <BaseSelect v-model="videoConfigId" :options="videoConfigOptions" placeholder="选择视频服务" searchable />
            </label>
            <label class="config-card">
              <span class="config-card-kicker">AUDIO</span>
              <span class="field-label">音频配置</span>
              <BaseSelect v-model="audioConfigId" :options="audioConfigOptions" placeholder="选择音频服务" searchable />
            </label>
          </div>
        </div>
      </div>
      <div class="dialog-foot">
        <div class="dialog-foot-copy">创建后，工作台中的图片、视频、音频生成入口都会锁定到当前集。</div>
        <button type="button" class="btn btn-primary" :disabled="creating || !canCreate" @click="submit">
          {{ creating ? '创建中…' : confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { aiConfigAPI, episodeAPI } from '~/composables/useApi'

const props = defineProps({
  open: { type: Boolean, default: false },
  dramaId: { type: Number, required: true },
  title: { type: String, default: '创建新集' },
  subtitle: {
    type: String,
    default: '为这一集预先锁定图片、视频和音频生成服务。创建后，这些生成链路将始终跟随当前集配置。',
  },
  confirmLabel: { type: String, default: '创建并锁定配置' },
})

const emit = defineEmits(['update:open', 'created'])

const creating = ref(false)
const episodeTitle = ref('')
const imageConfigs = ref([])
const videoConfigs = ref([])
const audioConfigs = ref([])
const imageConfigId = ref(null)
const videoConfigId = ref(null)
const audioConfigId = ref(null)

function configLabel(config) {
  if (!config) return ''
  let modelName = ''
  try {
    const m = JSON.parse(config.model || '[]')
    modelName = Array.isArray(m) ? (m[0] || '') : (m || '')
  } catch {
    modelName = config.model || ''
  }
  return modelName ? `${config.name} · ${modelName} (${config.provider})` : `${config.name} (${config.provider})`
}

const imageConfigOptions = computed(() => imageConfigs.value.map(c => ({ label: configLabel(c), value: c.id })))
const videoConfigOptions = computed(() => videoConfigs.value.map(c => ({ label: configLabel(c), value: c.id })))
const audioConfigOptions = computed(() => audioConfigs.value.map(c => ({ label: configLabel(c), value: c.id })))
const canCreate = computed(() => !!(imageConfigId.value && videoConfigId.value && audioConfigId.value))

function close() {
  emit('update:open', false)
}

async function loadConfigs() {
  const [imgs, vids, auds] = await Promise.all([
    aiConfigAPI.list('image'),
    aiConfigAPI.list('video'),
    aiConfigAPI.list('audio'),
  ])
  imageConfigs.value = imgs || []
  videoConfigs.value = vids || []
  audioConfigs.value = auds || []
  if (!imageConfigId.value && imageConfigs.value.length) imageConfigId.value = imageConfigs.value[0].id
  if (!videoConfigId.value && videoConfigs.value.length) videoConfigId.value = videoConfigs.value[0].id
  if (!audioConfigId.value && audioConfigs.value.length) audioConfigId.value = audioConfigs.value[0].id
}

async function submit() {
  if (!canCreate.value) return
  creating.value = true
  try {
    const ep = await episodeAPI.create({
      drama_id: props.dramaId,
      title: episodeTitle.value.trim() || undefined,
      image_config_id: imageConfigId.value,
      video_config_id: videoConfigId.value,
      audio_config_id: audioConfigId.value,
    })
    toast.success('已创建新集')
    emit('created', ep)
    close()
    episodeTitle.value = ''
  } catch (e) {
    toast.error(e?.message || '创建失败')
  } finally {
    creating.value = false
  }
}

watch(() => props.open, (visible) => {
  if (!visible) return
  episodeTitle.value = ''
  void loadConfigs()
})
</script>

<style scoped>
.dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.dialog {
  width: min(720px, 100%);
  max-height: min(90vh, 860px);
  overflow: auto;
  padding: 20px;
}

.dialog-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.dialog-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.dialog-title {
  font-size: 20px;
  font-weight: 700;
}

.dialog-kicker {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
  margin-bottom: 4px;
}

.dialog-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-bg);
  color: var(--accent-text);
}

.dialog-sub {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.5;
}

.dialog-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.summary-chip {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  color: var(--text-2);
}

.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.dialog-section-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 10px;
}

.dialog-section-title {
  font-size: 14px;
  font-weight: 600;
}

.dialog-section-copy {
  font-size: 12px;
  color: var(--text-3);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
}

.field-hint {
  font-size: 11px;
  color: var(--text-3);
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.config-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg-2);
}

.config-card-kicker {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-3);
}

.dialog-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.dialog-foot-copy {
  font-size: 12px;
  color: var(--text-3);
  max-width: 420px;
  line-height: 1.45;
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-0);
  color: var(--text-2);
  cursor: pointer;
}

@media (max-width: 720px) {
  .config-grid {
    grid-template-columns: 1fr;
  }
}
</style>
