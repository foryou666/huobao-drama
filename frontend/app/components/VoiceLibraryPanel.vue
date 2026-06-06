<template>
  <div class="voice-library">
    <div class="voice-library-bar">
      <div>
        <p class="voice-library-title">{{ title }}</p>
        <p class="dim voice-library-desc">上传角色音色参考 MP3，时长须 3~10 秒；可在视频生成时作为音色参考（最多 3 个）</p>
      </div>
      <button type="button" class="btn btn-sm btn-primary" :disabled="uploading" @click="triggerUpload">
        {{ uploading ? '上传中…' : '上传音色' }}
      </button>
      <input ref="fileInput" type="file" accept=".mp3,audio/mpeg,audio/mp3" hidden @change="onFileChange" />
    </div>

    <div v-if="loading" class="dim voice-library-empty">加载中…</div>
    <div v-else-if="!voices.length" class="voice-library-empty card">
      <p class="dim">暂无音色，请上传 MP3 参考音频</p>
    </div>
    <div v-else class="voice-grid">
      <div v-for="item in voices" :key="item.id" class="card voice-card">
        <div class="voice-card-head">
          <span class="voice-card-name">{{ item.name }}</span>
          <span v-if="item.duration" class="voice-card-duration">{{ formatVoiceDuration(item.duration) }}</span>
        </div>
        <audio
          v-if="item.url || item.local_path || item.localPath"
          class="voice-card-audio"
          :src="audioUrl(item)"
          controls
          preload="none"
        />
        <div v-if="item.description" class="dim voice-card-desc">{{ item.description }}</div>
        <div class="voice-card-actions">
          <button type="button" class="btn btn-sm danger ml-auto" @click="removeVoice(item)">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { assetAPI } from '~/composables/useApi'
import { formatVoiceDuration } from '~/utils/voice-refs.js'
import { normalizeMediaPath } from '~/utils/media-url.js'

const props = defineProps({
  dramaId: { type: [Number, String], required: true },
  title: { type: String, default: '项目音色库' },
})

const emit = defineEmits(['change'])

const loading = ref(true)
const uploading = ref(false)
const voices = ref([])
const fileInput = ref(null)

function audioUrl(item) {
  const raw = item.url || item.local_path || item.localPath
  const path = normalizeMediaPath(raw)
  return path ? `/${path}` : ''
}

async function loadVoices() {
  const dramaId = Number(props.dramaId)
  if (!Number.isFinite(dramaId)) {
    voices.value = []
    loading.value = false
    return
  }
  loading.value = true
  try {
    const rows = await assetAPI.list({ drama_id: dramaId, type: 'voice' })
    voices.value = Array.isArray(rows) ? rows : []
    emit('change', voices.value)
  } catch (err) {
    toast.error(err?.message || '加载音色库失败')
    voices.value = []
  } finally {
    loading.value = false
  }
}

function triggerUpload() {
  fileInput.value?.click()
}

async function onFileChange(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return

  const name = window.prompt('请输入音色名称', file.name.replace(/\.mp3$/i, '') || '音色参考')
  if (!name?.trim()) return

  uploading.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    form.append('type', 'voice')
    form.append('name', name.trim())
    form.append('drama_id', String(props.dramaId))
    await assetAPI.upload(form)
    toast.success('音色上传成功')
    await loadVoices()
  } catch (err) {
    toast.error(err?.message || '上传失败')
  } finally {
    uploading.value = false
  }
}

async function removeVoice(item) {
  if (!window.confirm(`确定删除音色「${item.name}」？`)) return
  try {
    await assetAPI.del(item.id)
    toast.success('已删除')
    await loadVoices()
  } catch (err) {
    toast.error(err?.message || '删除失败')
  }
}

watch(() => props.dramaId, () => loadVoices(), { immediate: true })

defineExpose({ reload: loadVoices, voices })
</script>

<style scoped>
.voice-library {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.voice-library-bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.voice-library-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.voice-library-desc {
  margin: 4px 0 0;
  font-size: 12px;
  max-width: 560px;
}

.voice-library-empty {
  padding: 28px 16px;
  text-align: center;
}

.voice-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.voice-card {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.voice-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.voice-card-name {
  font-size: 13px;
  font-weight: 600;
}

.voice-card-duration {
  font-size: 11px;
  color: var(--text-3);
  background: var(--bg-3);
  padding: 2px 8px;
  border-radius: 999px;
}

.voice-card-audio {
  width: 100%;
  height: 32px;
}

.voice-card-desc {
  font-size: 11px;
  line-height: 1.4;
}

.voice-card-actions {
  display: flex;
  gap: 8px;
}
</style>
