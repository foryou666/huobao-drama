<template>
  <div class="page-redirect">
    <Loader2 v-if="!error" :size="24" class="animate-spin" />
    <span v-if="!error">正在进入工作台…</span>
    <template v-else>
      <p>{{ error }}</p>
      <button type="button" class="btn" @click="navigateTo('/')">返回项目列表</button>
    </template>
  </div>
</template>

<script setup>
import { Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { dramaAPI } from '~/composables/useApi'
import { dramaWorkbenchPath } from '~/utils/drama-entry.js'

const route = useRoute()
const dramaId = Number(route.params.id)
const error = ref('')

onMounted(async () => {
  if (!Number.isFinite(dramaId) || dramaId <= 0) {
    error.value = '无效的项目 ID'
    return
  }
  try {
    const drama = await dramaAPI.get(dramaId)
    const target = dramaWorkbenchPath(dramaId, drama?.episodes)
    await navigateTo(target, { replace: true })
  } catch (e) {
    error.value = e?.message || '加载项目失败'
    toast.error(error.value)
  }
})
</script>

<style scoped>
.page-redirect {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-2);
  font-size: 14px;
}
</style>
