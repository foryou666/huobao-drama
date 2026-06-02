<template>
  <div class="page" v-if="drama">
    <!-- Header -->
    <div class="page-head">
      <div class="head-left">
        <button class="back-btn" @click="navigateTo('/')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
          返回
        </button>
        <div class="head-info">
          <h1 class="page-title">{{ drama.title }}</h1>
          <div class="page-meta">
            <span v-if="drama.style" class="style-chip">{{ drama.style }}</span>
            <span v-if="directorStyleLabel" class="style-chip director-chip">{{ directorStyleLabel }}</span>
            <span v-if="drama.style || directorStyleLabel" class="meta-divider"></span>
            <span class="meta-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              {{ drama.characters?.length || 0 }} 角色
            </span>
            <span class="meta-divider"></span>
            <span class="meta-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>
              {{ drama.scenes?.length || 0 }} 场景
            </span>
          </div>
        </div>
      </div>
      <div v-if="canManageDrama" class="head-actions">
        <button v-if="drama.is_archived" class="btn" @click="restoreDrama">
          恢复项目
        </button>
        <button v-else class="btn" @click="archiveDrama">
          归档
        </button>
        <button class="btn btn-primary" @click="openAddEpisode">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          添加集
        </button>
      </div>
    </div>

    <!-- Team sharing -->
    <section v-if="drama" class="share-panel card">
      <div class="share-head">
        <div>
          <div class="share-title">团队共享</div>
          <div class="share-desc">
            归属团队：{{ drama.owner_team_name || '—' }}
            <span v-if="drama.is_shared_project" class="tag tag-accent">外部共享项目</span>
          </div>
        </div>
      </div>
      <div v-if="shareInfo?.shared_teams?.length" class="share-tags">
        <span v-for="t in shareInfo.shared_teams" :key="t.team_id" class="share-tag">
          {{ t.team_name }}
          <button
            v-if="canManageShares"
            type="button"
            class="share-tag-remove"
            title="取消共享"
            @click="removeShare(t.team_id)"
          >×</button>
        </span>
      </div>
      <p v-else class="share-empty">尚未共享给其他团队</p>
      <form v-if="canManageShares" class="share-form" @submit.prevent="addShare">
        <select v-model.number="shareTeamId" class="input" required>
          <option :value="null" disabled>选择要共享的团队</option>
          <option
            v-for="t in shareTeamOptions"
            :key="t.id"
            :value="t.id"
          >{{ t.name }}</option>
        </select>
        <button type="submit" class="btn btn-sm" :disabled="!shareTeamId">添加共享</button>
      </form>
    </section>

    <!-- Episode List -->
    <div class="section-label">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <rect x="2" y="2" width="20" height="20" rx="2.5"/>
        <line x1="7" y1="8" x2="7" y2="16"/>
        <line x1="10" y1="8" x2="10" y2="16"/>
        <line x1="13" y1="8" x2="13" y2="16"/>
        <line x1="16" y1="8" x2="16" y2="16"/>
      </svg>
      剧集列表
    </div>

    <div class="ep-grid">
      <div
        v-for="(ep, i) in drama.episodes"
        :key="ep.id"
        class="card ep-card"
        :style="{ animationDelay: `${i * 0.05}s` }"
        @click="navigateTo(`/drama/${drama.id}/episode/${ep.episode_number || ep.episodeNumber}`)"
      >
        <div class="ep-number">E{{ String(ep.episode_number || ep.episodeNumber).padStart(2, '0') }}</div>
        <div class="ep-body">
          <span class="ep-title">{{ ep.title }}</span>
          <div class="ep-status">
            <span :class="['status-dot', scriptStatus(ep).ready ? 'dot-ready' : 'dot-pending']"></span>
            <span class="status-text">{{ scriptStatus(ep).label }}</span>
          </div>
          <div class="ep-summary">
            <span class="ep-summary-item ep-summary-item-script">{{ summaryLine(ep, 'script') }}</span>
            <span v-if="summaryLine(ep, 'characters')" class="ep-summary-item">{{ summaryLine(ep, 'characters') }}</span>
            <span v-if="summaryLine(ep, 'scenes')" class="ep-summary-item">{{ summaryLine(ep, 'scenes') }}</span>
            <span v-if="summaryLine(ep, 'storyboards')" class="ep-summary-item">{{ summaryLine(ep, 'storyboards') }}</span>
          </div>
          <button
            v-if="activityPreview(ep)"
            type="button"
            class="ep-meta ep-meta-btn"
            @click.stop="openActivityLogs(ep)"
          >
            <span>{{ activityPreview(ep) }}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
        </div>
        <div class="ep-arrow">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
        <button
          v-if="canManageDrama && ep.can_delete"
          type="button"
          class="btn btn-ghost btn-icon ep-delete"
          title="删除空集"
          @click.stop="deleteEpisode(ep)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>

      <!-- Empty episode state -->
      <div v-if="!drama.episodes?.length" class="card ep-empty">
        <div class="ep-empty-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="16"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
        </div>
        <p>点击上方「添加集」创建第一集</p>
      </div>
    </div>

    <div v-if="activityDialog.open" class="dialog-mask" @click.self="closeActivityLogs">
      <div class="card dialog activity-dialog">
        <div class="dialog-head">
          <div class="dialog-head-copy">
            <div class="dialog-kicker">Activity Log</div>
            <div class="dialog-title-row">
              <div class="dialog-title">{{ activityDialog.title }}</div>
              <span v-if="activityDialog.total" class="dialog-badge">{{ activityDialog.total }} 条</span>
            </div>
            <div class="dialog-sub">本集所有操作记录，含不同成员的操作时间与动作说明。</div>
          </div>
          <button class="back-btn" @click="closeActivityLogs">关闭</button>
        </div>
        <div class="activity-dialog-body">
          <div v-if="activityDialog.loading" class="activity-empty">加载中...</div>
          <div v-else-if="!activityDialog.items.length" class="activity-empty">暂无操作记录</div>
          <div v-else class="activity-log-list">
            <div v-for="item in activityDialog.items" :key="item.id" class="activity-log-item">
              <div class="activity-log-head">
                <span class="activity-log-action">{{ actionLabel(item.action) }}</span>
                <span class="activity-log-time">{{ fmtDateTime(item.created_at) }}</span>
              </div>
              <div class="activity-log-meta">
                <span>{{ item.operator_name || item.display_name || item.username || '未知用户' }}</span>
                <span v-if="item.credit_cost > 0" class="activity-log-cost">-{{ item.credit_cost }} 积分</span>
              </div>
              <div v-if="item.summary" class="activity-log-summary">{{ item.summary }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="addDialog" class="dialog-mask" @click.self="addDialog = false">
      <div class="card dialog">
        <div class="dialog-head">
          <div class="dialog-head-copy">
            <div class="dialog-kicker">Episode Setup</div>
            <div class="dialog-title-row">
              <div class="dialog-title">创建新集</div>
              <span class="dialog-badge">配置将锁定</span>
            </div>
            <div class="dialog-sub">为这一集预先锁定图片、视频和音频生成服务。创建后，这些生成链路将始终跟随当前集配置。</div>
          </div>
          <button class="back-btn" @click="addDialog = false">取消</button>
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
              <input v-model="newEpisodeTitle" class="input" placeholder="默认按集数自动命名" />
              <span class="field-hint">留空时会自动按集数命名，例如“第 3 集”。</span>
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
                <BaseSelect v-model="newEpisodeImageConfigId" :options="imageConfigOptions" placeholder="选择图片服务" searchable />
              </label>
              <label class="config-card">
                <span class="config-card-kicker">VIDEO</span>
                <span class="field-label">视频配置</span>
                <BaseSelect v-model="newEpisodeVideoConfigId" :options="videoConfigOptions" placeholder="选择视频服务" searchable />
              </label>
              <label class="config-card">
                <span class="config-card-kicker">AUDIO</span>
                <span class="field-label">音频配置</span>
                <BaseSelect v-model="newEpisodeAudioConfigId" :options="audioConfigOptions" placeholder="选择音频服务" searchable />
              </label>
            </div>
          </div>
        </div>
        <div class="dialog-foot">
          <div class="dialog-foot-copy">创建后，工作台中的图片、视频、音频生成入口都会锁定到当前集。</div>
          <button class="btn btn-primary" :disabled="creatingEpisode || !canCreateEpisode" @click="addEpisode">
            {{ creatingEpisode ? '创建中...' : '创建并锁定配置' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { aiConfigAPI, dramaAPI, episodeAPI, promptsAPI, teamsAPI, ACTION_LABELS } from '~/composables/useApi'
import { useTeam } from '~/composables/useTeam'

const route = useRoute()
const { activeTeamId } = useTeam()
const drama = ref(null)
const dramaId = Number(route.params.id)
const directorStyles = ref([])
const directorStyleLabel = computed(() => {
  const id = drama.value?.director_style || drama.value?.directorStyle || 'hongguo_director'
  return directorStyles.value.find(s => s.id === id)?.label || ''
})
const addDialog = ref(false)
const creatingEpisode = ref(false)
const newEpisodeTitle = ref('')
const imageConfigs = ref([])
const videoConfigs = ref([])
const audioConfigs = ref([])
const newEpisodeImageConfigId = ref(null)
const newEpisodeVideoConfigId = ref(null)
const newEpisodeAudioConfigId = ref(null)
const shareInfo = ref(null)
const allTeams = ref([])
const shareTeamId = ref(null)
const activityDialog = ref({
  open: false,
  loading: false,
  episodeId: null,
  title: '',
  total: 0,
  items: [],
})

const canManageShares = computed(() => Boolean(drama.value?.can_manage_shares))
const canManageDrama = computed(() => Boolean(drama.value?.can_manage_drama))
const shareTeamOptions = computed(() => {
  const ownerId = drama.value?.team_id
  const shared = new Set((shareInfo.value?.shared_teams || []).map(t => t.team_id))
  return allTeams.value.filter(t => t.id !== ownerId && !shared.has(t.id))
})

function hasScript(ep) { return !!(ep.script_content || ep.scriptContent) }

function getEpisodeSummary(ep) {
  return ep.summary || null
}

function formatCount(n) {
  const value = Number(n) || 0
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万`
  return String(value)
}

function scriptStatus(ep) {
  const s = getEpisodeSummary(ep)?.script
  const scriptText = String(ep.script_content || ep.scriptContent || '').trim()
  const sourceText = String(ep.content || '').trim()
  if (s?.has_script || scriptText) {
    return { ready: true, label: '已完成剧本' }
  }
  if (s?.has_source || sourceText) {
    return { ready: false, label: '已有素材 · 待改写' }
  }
  return { ready: false, label: '待编写' }
}

function imageProgressLabel(total, done) {
  if (!total) return ''
  if (done >= total) return '图片已生成'
  if (done > 0) return `图片 ${done}/${total}`
  return '图片未生成'
}

function summaryLine(ep, kind) {
  const s = getEpisodeSummary(ep)
  if (kind === 'script') {
    const sc = s?.script
    const scriptText = String(ep.script_content || ep.scriptContent || '').trim()
    const sourceText = String(ep.content || '').trim()
    const hasScriptText = sc?.has_script ?? Boolean(scriptText)
    const hasSourceText = sc?.has_source ?? Boolean(sourceText)
    const scriptChars = sc?.script_char_count ?? [...scriptText.replace(/\s+/g, '')].length
    const sourceChars = sc?.source_char_count ?? [...sourceText.replace(/\s+/g, '')].length
    const durationSec = sc?.estimate_duration_sec ?? Math.max(0, Number(ep.duration) || 0)

    if (hasScriptText) {
      const parts = [`剧本 ${formatCount(scriptChars)} 字`]
      if (hasSourceText && sourceChars > 0) parts.push(`素材 ${formatCount(sourceChars)} 字`)
      if (durationSec > 0) parts.push(`预估 ${durationSec}s`)
      return parts.join(' · ')
    }
    if (hasSourceText) {
      const parts = [`素材 ${formatCount(sourceChars)} 字`, '待 AI 改写']
      if (durationSec > 0) parts.push(`预估 ${durationSec}s`)
      return parts.join(' · ')
    }
    return '暂无剧本'
  }
  if (!s) return ''
  if (kind === 'characters') {
    const total = s.characters?.total || 0
    if (!total) return ''
    const done = s.characters?.with_image || 0
    return `角色 ${total} 个 · ${imageProgressLabel(total, done)}`
  }
  if (kind === 'scenes') {
    const total = s.scenes?.total || 0
    if (!total) return ''
    const done = s.scenes?.with_image || 0
    return `场景 ${total} 个 · ${imageProgressLabel(total, done)}`
  }
  if (kind === 'storyboards') {
    const total = s.storyboards?.total || 0
    if (!total) return ''
    const img = s.storyboards?.with_image || 0
    const vid = s.storyboards?.with_video || 0
    const parts = [`镜头 ${total} 个`]
    if (img > 0) parts.push(`图 ${img}/${total}`)
    if (vid > 0) parts.push(`视频 ${vid}/${total}`)
    if (img === 0 && vid === 0) parts.push('未生成')
    return parts.join(' · ')
  }
  return ''
}

function activityPreview(ep) {
  const act = getEpisodeSummary(ep)?.activity
  const at = act?.last_operated_at || getEpisodeSummary(ep)?.last_operated_at || ep.updated_at || ep.updatedAt
  const time = at ? fmtDateTime(at) : ''

  if ((act?.total || 0) > 0) {
    const parts = [`${act.total} 条操作`]
    if ((act.operator_count || 0) > 1) {
      parts.push(`${act.operator_count} 人参与`)
    } else if (act.last_operator_name) {
      parts.push(`操作人 ${act.last_operator_name}`)
    }
    if (time) parts.push(time)
    return parts.join(' · ')
  }

  if (act?.last_operator_name && time) return `操作人 ${act.last_operator_name} · ${time}`
  if (time) return `更新于 ${time}`
  return ''
}

function actionLabel(action) {
  return ACTION_LABELS[action] || action
}

async function openActivityLogs(ep) {
  activityDialog.value = {
    open: true,
    loading: true,
    episodeId: ep.id,
    title: ep.title || `第 ${ep.episode_number || ep.episodeNumber} 集`,
    total: getEpisodeSummary(ep)?.activity?.total || 0,
    items: [],
  }
  try {
    const res = await episodeAPI.activityLogs(ep.id, { limit: 100 })
    activityDialog.value.items = res.items || []
    activityDialog.value.total = res.total || activityDialog.value.items.length
  } catch (e) {
    toast.error(e.message || '加载操作日志失败')
    activityDialog.value.open = false
  } finally {
    activityDialog.value.loading = false
  }
}

function closeActivityLogs() {
  activityDialog.value.open = false
}

function fmtDateTime(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value || '')
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function configLabel(config) {
  if (!config) return ''
  let modelName = ''
  try { const m = JSON.parse(config.model || '[]'); modelName = Array.isArray(m) ? (m[0] || '') : (m || '') } catch { modelName = config.model || '' }
  return modelName ? `${config.name} · ${modelName} (${config.provider})` : `${config.name} (${config.provider})`
}

const imageConfigOptions = computed(() => imageConfigs.value.map(c => ({ label: configLabel(c), value: c.id })))
const videoConfigOptions = computed(() => videoConfigs.value.map(c => ({ label: configLabel(c), value: c.id })))
const audioConfigOptions = computed(() => audioConfigs.value.map(c => ({ label: configLabel(c), value: c.id })))
const canCreateEpisode = computed(() => !!(newEpisodeImageConfigId.value && newEpisodeVideoConfigId.value && newEpisodeAudioConfigId.value))

async function loadDirectorStyles() {
  try {
    const res = await promptsAPI.directorStyles()
    directorStyles.value = res.items || []
  } catch {
    directorStyles.value = [
      { id: 'hongguo_director', label: '红果导演' },
      { id: 'super_director', label: '超级导演' },
      { id: 'north_america_director', label: '北美导演' },
    ]
  }
}

async function load() {
  try {
    drama.value = await dramaAPI.get(dramaId)
    drama.value.is_shared_project = activeTeamId.value != null
      && drama.value.team_id != null
      && drama.value.team_id !== activeTeamId.value
    shareInfo.value = await dramaAPI.shares(dramaId)
    if (drama.value.can_manage_shares) {
      const dir = await teamsAPI.directory()
      allTeams.value = dir.items || []
    }
  } catch (e) {
    toast.error(e.message)
  }
}

async function addShare() {
  if (!shareTeamId.value) return
  try {
    const res = await dramaAPI.addShare(dramaId, shareTeamId.value)
    shareInfo.value = { ...shareInfo.value, shared_teams: res.shared_teams }
    shareTeamId.value = null
    toast.success('已添加共享团队')
  } catch (e) {
    toast.error(e.message)
  }
}

async function removeShare(teamId) {
  if (!confirm('确定取消对该团队的共享？')) return
  try {
    const res = await dramaAPI.removeShare(dramaId, teamId)
    shareInfo.value = { ...shareInfo.value, shared_teams: res.shared_teams }
    toast.success('已取消共享')
  } catch (e) {
    toast.error(e.message)
  }
}

async function loadConfigs() {
  try {
    const [imgs, vids, auds] = await Promise.all([
      aiConfigAPI.list('image'),
      aiConfigAPI.list('video'),
      aiConfigAPI.list('audio'),
    ])
    imageConfigs.value = imgs || []
    videoConfigs.value = vids || []
    audioConfigs.value = auds || []
    if (!newEpisodeImageConfigId.value && imageConfigs.value.length) newEpisodeImageConfigId.value = imageConfigs.value[0].id
    if (!newEpisodeVideoConfigId.value && videoConfigs.value.length) newEpisodeVideoConfigId.value = videoConfigs.value[0].id
    if (!newEpisodeAudioConfigId.value && audioConfigs.value.length) newEpisodeAudioConfigId.value = audioConfigs.value[0].id
  } catch (e) {
    toast.error(e.message)
  }
}

function openAddEpisode() {
  newEpisodeTitle.value = ''
  addDialog.value = true
}

async function addEpisode() {
  try {
    creatingEpisode.value = true
    await episodeAPI.create({
      drama_id: dramaId,
      title: newEpisodeTitle.value || undefined,
      image_config_id: newEpisodeImageConfigId.value,
      video_config_id: newEpisodeVideoConfigId.value,
      audio_config_id: newEpisodeAudioConfigId.value,
    })
    toast.success('已添加新集')
    addDialog.value = false
    load()
  } catch (e) {
    toast.error(e.message)
  } finally {
    creatingEpisode.value = false
  }
}

async function archiveDrama() {
  const summary = drama.value?.content_summary || '含制作内容'
  const msg = drama.value?.can_delete
    ? `归档后将从列表隐藏，可随时恢复。\n\n当前内容：${summary}`
    : `该项目含制作内容，无法直接删除。\n\n${drama.value?.delete_block_reason || summary}\n\n是否改为归档？`
  if (!confirm(`归档「${drama.value?.title}」？\n\n${msg}`)) return
  try {
    await dramaAPI.archive(dramaId)
    toast.success('已归档')
    navigateTo('/')
  } catch (e) {
    toast.error(e.message)
  }
}

async function restoreDrama() {
  if (!confirm(`恢复项目「${drama.value?.title}」到列表？`)) return
  try {
    await dramaAPI.restore(dramaId)
    toast.success('已恢复')
    load()
  } catch (e) {
    toast.error(e.message)
  }
}

async function deleteEpisode(ep) {
  const num = ep.episode_number || ep.episodeNumber
  const summary = ep.content_summary || '无制作内容'
  if (!confirm(`确定删除第 ${num} 集？\n\n当前内容：${summary}\n\n仅允许删除无制作内容的集。`)) return
  try {
    await episodeAPI.del(ep.id)
    toast.success('已删除')
    load()
  } catch (e) {
    toast.error(e.message)
  }
}

onMounted(() => { loadDirectorStyles(); load(); loadConfigs() })
</script>

<style scoped>
.page {
  padding: 28px 48px 40px;
  overflow-y: auto;
  height: 100%;
  animation: fadeUp 0.35s var(--ease-out) both;
}

.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 24px;
  gap: 20px;
}
.head-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.head-left { display: flex; align-items: flex-start; gap: 12px; }
.head-info { display: flex; flex-direction: column; gap: 8px; }

.back-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 12px; font-size: 13px; font-weight: 500;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg-0); color: var(--text-2);
  cursor: pointer; transition: all 0.18s var(--ease-out);
  box-shadow: var(--shadow-xs);
}
.back-btn:hover { background: var(--bg-hover); border-color: var(--border-strong); color: var(--text-0); }

.page-title {
  font-family: var(--font-display);
  font-size: 26px; font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.page-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.style-chip {
  font-size: 11px; font-weight: 500;
  padding: 2px 8px;
  background: var(--accent-bg); color: var(--accent-text);
  border-radius: 99px; border: 1px solid rgba(184,120,20,0.12);
}
.meta-divider { width: 3px; height: 3px; border-radius: 50%; background: var(--text-3); }
.meta-item {
  display: flex; align-items: center; gap: 5px;
  font-size: 12px; color: var(--text-2);
}

/* Section label */
.section-label {
  display: flex; align-items: center; gap: 7px;
  font-size: 11px; font-weight: 700;
  color: var(--text-3); letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 12px;
}

/* Episode Grid */
.ep-grid { display: flex; flex-direction: column; gap: 10px; max-width: 860px; }

.ep-card {
  display: flex; align-items: flex-start; gap: 16px;
  padding: 14px 16px;
  cursor: pointer;
  animation: fadeUp 0.35s var(--ease-out) both;
  transition: transform 0.18s var(--ease-out), box-shadow 0.18s var(--ease-out), border-color 0.18s;
}
.ep-card:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow);
  transform: translateX(4px);
}

.ep-number {
  width: 44px; height: 44px; flex-shrink: 0;
  border-radius: var(--radius);
  background: var(--bg-2);
  border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-mono);
  font-size: 12px; font-weight: 700;
  color: var(--text-2);
  transition: all 0.18s;
}
.ep-card:hover .ep-number {
  background: var(--accent-bg);
  border-color: rgba(184,120,20,0.2);
  color: var(--accent);
}

.ep-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.ep-title { font-size: 14px; font-weight: 600; color: var(--text-0); }
.ep-status { display: flex; align-items: center; gap: 6px; }
.ep-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-top: 2px;
}
.ep-summary-item {
  font-size: 11px;
  color: var(--text-2);
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-2);
  border: 1px solid var(--border);
}
.ep-summary-item-script {
  color: var(--text-1);
  background: rgba(76,125,255,0.06);
  border-color: rgba(76,125,255,0.12);
}
.ep-meta {
  font-size: 11px;
  color: var(--text-3);
}
.ep-meta-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  transition: color 0.18s;
}
.ep-meta-btn:hover {
  color: var(--accent-text);
}
.ep-meta-btn svg {
  opacity: 0.7;
  transition: transform 0.18s;
}
.ep-meta-btn:hover svg {
  transform: translateY(1px);
}

.activity-dialog {
  width: min(640px, 100%);
  max-height: min(720px, calc(100vh - 48px));
}
.activity-dialog-body {
  overflow-y: auto;
  padding-right: 4px;
}
.activity-empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 13px;
}
.activity-log-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.activity-log-item {
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255,255,255,0.72);
  border: 1px solid rgba(27, 41, 64, 0.08);
}
.activity-log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}
.activity-log-action {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-0);
}
.activity-log-time {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
}
.activity-log-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-2);
}
.activity-log-cost {
  color: var(--accent-text);
}
.activity-log-summary {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-2);
}
.status-dot {
  width: 6px; height: 6px; border-radius: 50%;
}
.dot-ready { background: var(--success); }
.dot-pending { background: var(--text-3); }
.status-text { font-size: 11px; color: var(--text-3); }

.ep-arrow { color: var(--text-3); flex-shrink: 0; transition: transform 0.18s; margin-top: 12px; }
.ep-card:hover .ep-arrow { transform: translateX(3px); color: var(--accent); }
.ep-delete {
  flex-shrink: 0;
  opacity: 0;
  color: var(--text-3);
  transition: opacity 0.18s, color 0.18s;
}
.ep-card:hover .ep-delete { opacity: 1; }
.ep-delete:hover { color: var(--error); }

/* Empty */
.ep-empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 48px; text-align: center; color: var(--text-3); font-size: 13px;
  border-style: dashed;
}
.ep-empty-icon {
  width: 48px; height: 48px; border-radius: 50%;
  background: var(--bg-2); display: flex; align-items: center; justify-content: center;
}

.dialog-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 38, 0.18);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.dialog {
  width: min(760px, 100%);
  max-height: min(860px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 26px 26px 22px;
  border-radius: 28px;
  background:
    radial-gradient(circle at top left, rgba(122,167,255,0.14), transparent 34%),
    radial-gradient(circle at top right, rgba(76,125,255,0.08), transparent 26%),
    linear-gradient(180deg, rgba(255,255,255,0.98), rgba(242,247,255,0.92));
  overflow: hidden;
  border: 1px solid rgba(27, 41, 64, 0.08);
  box-shadow: 0 22px 52px rgba(32, 48, 77, 0.14), 0 8px 18px rgba(32, 48, 77, 0.08);
}
.dialog-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.dialog-head-copy { display: flex; flex-direction: column; gap: 8px; max-width: 520px; }
.dialog-kicker {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-3);
}
.dialog-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dialog-title { font-size: 28px; font-weight: 800; color: var(--text-0); letter-spacing: -0.03em; }
.dialog-badge {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(76,125,255,0.1);
  color: var(--accent-text);
  font-size: 12px;
  font-weight: 700;
}
.dialog-sub { font-size: 14px; line-height: 1.7; color: var(--text-2); }
.dialog-summary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.summary-chip {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(255,255,255,0.78);
  border: 1px solid rgba(27, 41, 64, 0.08);
  font-size: 12px;
  color: var(--text-2);
}
.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding-right: 4px;
}
.dialog-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
  border-radius: 22px;
  background: rgba(255,255,255,0.72);
  border: 1px solid rgba(27, 41, 64, 0.08);
}
.dialog-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.dialog-section-title { font-size: 14px; font-weight: 700; color: var(--text-0); }
.dialog-section-copy { font-size: 12px; color: var(--text-3); }
.config-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.config-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(244,248,255,0.96), rgba(255,255,255,0.78));
  border: 1px solid rgba(27, 41, 64, 0.08);
}
.config-card-kicker {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-3);
}
.dialog-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 2px;
}
.dialog-foot-copy {
  flex: 1;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-3);
}
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; font-weight: 600; color: var(--text-1); }
.field-hint { font-size: 12px; color: var(--text-3); }

.share-panel {
  margin-bottom: 20px;
  padding: 16px 18px;
}
.share-head { margin-bottom: 12px; }
.share-title { font-size: 14px; font-weight: 600; }
.share-desc { font-size: 12px; color: var(--text-3); margin-top: 4px; display: flex; align-items: center; gap: 8px; }
.share-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.share-tag {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--bg-2);
  font-size: 12px;
}
.share-tag-remove {
  border: none; background: none; cursor: pointer;
  color: var(--text-3); font-size: 14px; line-height: 1; padding: 0;
}
.share-tag-remove:hover { color: var(--error); }
.share-empty { font-size: 12px; color: var(--text-3); margin: 0 0 12px; }
.share-form { display: flex; gap: 10px; align-items: center; }
.share-form .input { flex: 1; max-width: 280px; }

@media (max-width: 860px) {
  .dialog {
    width: 100%;
    max-height: calc(100vh - 24px);
    padding: 18px;
    border-radius: 22px;
  }

  .dialog-title {
    font-size: 24px;
  }

  .config-grid {
    grid-template-columns: 1fr;
  }

  .dialog-foot {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
