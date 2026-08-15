<template>
  <div class="page">
    <!-- Page Header -->
    <div class="page-head">
      <div class="head-left">
        <h1 class="page-title">短剧项目</h1>
        <p class="page-desc">{{ dramas.length }} 个项目</p>
      </div>
      <div class="page-head-actions">
        <button class="btn" @click="showImport = true">导入剧本</button>
        <button class="btn btn-primary" @click="showCreate = true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          新建项目
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading-state">
      <div class="loading-grid">
        <div v-for="i in 3" :key="i" class="skeleton-card card"></div>
      </div>
    </div>

    <!-- Grid -->
    <div v-else class="grid">
      <div
        v-for="(d, i) in dramas"
        :key="d.id"
        class="card project-card"
        :style="{ animationDelay: `${i * 0.06}s` }"
        @click="openDrama(d)"
      >
        <div class="project-cover">
          <img
            v-if="coverSrc(d)"
            :src="coverSrc(d)"
            :alt="d.title"
            class="project-cover-img"
            loading="lazy"
          />
          <div v-else class="project-cover-placeholder" aria-hidden="true" />

          <div class="cover-top">
            <div class="episode-badge">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
              {{ isNarrationProject(d) ? '解说漫' : `${d.episodes?.length || 0} 集` }}
            </div>
            <span v-if="isNarrationProject(d)" class="tag tag-accent share-badge">解说</span>
            <span v-else-if="d.is_shared_project" class="tag tag-accent share-badge">共享</span>
            <span
              v-else-if="d.shared_teams?.length"
              class="tag share-badge share-owned-badge"
              :title="d.shared_teams.map(t => t.team_name).join('、')"
            >已共享 {{ d.shared_teams.length }}</span>
          </div>

          <div class="cover-overlay" :class="{ 'is-empty': !coverSrc(d) }">
            <button
              type="button"
              class="cover-gen-btn"
              @click.stop="openCoverModal(d)"
            >
              {{ coverSrc(d) ? '封面查看' : '生成封面' }}
            </button>
          </div>

          <div v-if="d.can_manage_drama" class="card-actions" @click.stop>
            <button
              class="btn btn-ghost btn-icon card-action"
              @click="openShareModal(d)"
              title="共享给其他团队"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
            </button>
            <button
              class="btn btn-ghost btn-icon card-action"
              @click="archiveDrama(d)"
              title="归档"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
              </svg>
            </button>
            <button
              v-if="canShowDelete(d)"
              class="btn btn-ghost btn-icon card-action card-delete"
              @click="delDrama(d)"
              :title="isNarrationProject(d) ? '删除解说漫' : '删除空项目'"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="card-body">
          <h3 class="project-title">{{ d.title }}</h3>
          <p v-if="d.is_shared_project && d.owner_team_name" class="project-owner dim">来自 {{ d.owner_team_name }}</p>

          <div class="project-meta">
            <span v-if="d.style" class="style-tag">{{ d.style }}</span>
            <span class="meta-item">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              {{ d.character_count ?? d.characters?.length ?? 0 }}
            </span>
            <span class="meta-item">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>
              {{ d.scene_count ?? d.scenes?.length ?? 0 }}
            </span>
          </div>
        </div>

        <div class="card-footer">
          <div class="progress-mini">
            <div class="progress-mini-track">
              <div class="progress-mini-fill" :style="{ width: getProgress(d) + '%' }"></div>
            </div>
          </div>
          <div class="card-footer-actions">
            <button
              v-if="isNarrationProject(d)"
              type="button"
              class="card-link-btn"
              @click.stop="openDrama(d)"
            >解说工作流</button>
            <template v-else>
              <button type="button" class="card-link-btn" @click.stop="openDramaCanvas(d)">画布</button>
              <button type="button" class="card-link-btn" @click.stop="navigateTo(`/assets?drama_id=${d.id}&type=voice`)">音色库</button>
            </template>
            <span class="card-date">{{ fmtDate(d.updated_at || d.updatedAt) }}</span>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-if="!dramas.length" class="card empty-card" @click="showCreate = true">
        <div class="empty-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
            <rect x="3" y="3" width="18" height="18" rx="3"/>
            <line x1="12" y1="8" x2="12" y2="16"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
        </div>
        <p class="empty-title">新建第一个短剧项目</p>
        <p class="empty-desc">从剧本到成片，AI 助力的短剧制作工作台</p>
      </div>
    </div>

    <DramaCoverGenerateModal
      v-if="coverDramaId"
      v-model:open="coverModalOpen"
      :drama-id="coverDramaId"
      :drama-title="coverDramaTitle"
      :initial-covers="coverInitialCovers"
      @applied="onCoverApplied"
    />

    <!-- Create Dialog -->
    <div v-if="showCreate" class="overlay" @click.self="showCreate = false">
      <div class="modal card">
        <div class="modal-header">
          <div class="modal-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <rect x="3" y="3" width="18" height="18" rx="3"/>
              <line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
          </div>
          <h2 class="modal-title">新建短剧项目</h2>
          <p class="modal-desc">输入项目基本信息，即可开始制作</p>
        </div>
        <form @submit.prevent="create" class="modal-form">
          <label class="field">
            <span class="field-label">项目名称 <span class="required">*</span></span>
            <input v-model="form.title" class="input" placeholder="例如：都市情感短剧《时光邮局》" required autofocus />
          </label>
          <div class="field-row">
            <label class="field">
              <span class="field-label">计划集数</span>
              <input v-model.number="form.total_episodes" class="input" type="number" min="1" max="100" />
            </label>
            <label class="field">
              <span class="field-label">视觉风格</span>
              <BaseSelect v-model="form.style" :options="styleSelectOptions" placeholder="选择风格" searchable />
            </label>
          </div>
          <label class="field">
            <span class="field-label">导演风格</span>
            <BaseSelect
              v-model="form.director_style"
              :options="directorStyleOptions"
              placeholder="选择导演风格"
            />
            <span v-if="selectedDirectorDesc" class="field-hint">{{ selectedDirectorDesc }}</span>
          </label>
          <div class="modal-actions">
            <button type="button" class="btn" @click="showCreate = false">取消</button>
            <button type="submit" class="btn btn-primary">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              创建项目
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Share Dialog -->
    <ScriptImportDialog v-model:open="showImport" @created="onImportCreated" />

    <div v-if="shareTarget" class="overlay" @click.self="closeShareModal">
      <div class="modal card share-modal">
        <div class="modal-header">
          <div class="modal-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </div>
          <h2 class="modal-title">共享项目</h2>
          <p class="modal-desc">
            将「{{ shareTarget.title }}」共享给其他团队后，对方可在项目列表中打开协作。
            <template v-if="shareOwnerTeamName">归属团队：{{ shareOwnerTeamName }}</template>
          </p>
        </div>

        <div class="share-body">
          <div v-if="shareLoading" class="share-empty dim">加载中…</div>
          <template v-else>
            <div class="share-section">
              <div class="field-label">已共享给</div>
              <div v-if="!shareTeams.length" class="share-empty dim">尚未共享给任何团队</div>
              <ul v-else class="share-list">
                <li v-for="t in shareTeams" :key="t.team_id" class="share-row">
                  <div class="share-row-main">
                    <span class="share-team-name">{{ t.team_name }}</span>
                    <span v-if="t.shared_at" class="share-meta dim">{{ fmtDate(t.shared_at) }}</span>
                  </div>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm share-remove"
                    :disabled="shareBusy"
                    @click="removeShare(t)"
                  >取消共享</button>
                </li>
              </ul>
            </div>

            <div class="share-section">
              <label class="field">
                <span class="field-label">添加团队</span>
                <div class="share-add-row">
                  <BaseSelect
                    v-model="shareSelectedTeamId"
                    class="share-select"
                    :options="shareTeamSelectOptions"
                    placeholder="选择要共享的团队"
                    searchable
                  />
                  <button
                    type="button"
                    class="btn btn-primary"
                    :disabled="shareBusy || !shareSelectedTeamId || !shareTeamSelectOptions.length"
                    @click="addShare"
                  >共享</button>
                </div>
                <span v-if="!shareTeamSelectOptions.length" class="field-hint">没有可添加的团队（可能已全部共享，或目录为空）</span>
              </label>
            </div>
          </template>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn" @click="closeShareModal">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { canvasAPI, dramaAPI, promptsAPI, teamsAPI, narrationAPI } from '~/composables/useApi'
import BaseSelect from '~/components/BaseSelect.vue'
import ScriptImportDialog from '~/components/ScriptImportDialog.vue'
import DramaCoverGenerateModal from '~/components/DramaCoverGenerateModal.vue'
import { dramaWorkbenchPath } from '~/utils/drama-entry.js'
import { mediaDisplayUrl } from '~/utils/media-url.js'
import { useAuth } from '~/composables/useAuth'

const { isAdmin } = useAuth()
const dramas = ref([])
const loading = ref(false)
const dramasLoaded = ref(false)
const DRAMA_LIST_CACHE_KEY = 'project-list-dramas-v2'
const showCreate = ref(false)
const showImport = ref(false)
const coverModalOpen = ref(false)
const coverDramaId = ref(0)
const coverDramaTitle = ref('')
const coverInitialCovers = ref({ '3:4': null, '4:3': null })
const form = ref({ title: '', total_episodes: 1, style: '', director_style: 'hongguo_director' })
const styles = ['realistic', 'anime', 'ghibli', 'cinematic', 'comic', 'watercolor']
const styleSelectOptions = computed(() => styles.map(s => ({ label: s, value: s })))
const directorStyles = ref([])
const directorStyleOptions = computed(() =>
  directorStyles.value.map(s => ({ label: s.label, value: s.id })),
)
const selectedDirectorDesc = computed(() =>
  directorStyles.value.find(s => s.id === form.value.director_style)?.description || '',
)

const shareTarget = ref(null)
const shareTeams = ref([])
const shareOwnerTeamId = ref(null)
const shareOwnerTeamName = ref('')
const shareDirectory = ref([])
const shareSelectedTeamId = ref(null)
const shareLoading = ref(false)
const shareBusy = ref(false)

const shareTeamSelectOptions = computed(() => {
  const sharedIds = new Set(shareTeams.value.map(t => Number(t.team_id)))
  const ownerId = Number(shareOwnerTeamId.value || 0)
  return shareDirectory.value
    .filter(t => {
      const id = Number(t.id)
      if (!id || id === ownerId) return false
      return !sharedIds.has(id)
    })
    .map(t => ({ label: t.name, value: t.id }))
})

function restoreDramasCache() {
  try {
    const raw = sessionStorage.getItem(DRAMA_LIST_CACHE_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.items) || !parsed.items.length) return false
    dramas.value = parsed.items
    dramasLoaded.value = true
    return true
  } catch {
    return false
  }
}

function persistDramasCache() {
  try {
    sessionStorage.setItem(DRAMA_LIST_CACHE_KEY, JSON.stringify({
      items: dramas.value,
      savedAt: Date.now(),
    }))
  } catch {
    // ignore
  }
}

async function refreshDramasInBackground() {
  try {
    const res = await dramaAPI.list({ pageSize: 200 })
    dramas.value = res.items || []
    dramasLoaded.value = true
    persistDramasCache()
  } catch {
    // keep cached list
  }
}

async function load() {
  if (dramasLoaded.value) {
    void refreshDramasInBackground()
    return
  }
  const fromCache = restoreDramasCache()
  if (fromCache) loading.value = false
  else loading.value = true
  try {
    const res = await dramaAPI.list({ pageSize: 200 })
    dramas.value = res.items || []
    dramasLoaded.value = true
    persistDramasCache()
  } catch (e) {
    if (!fromCache) toast.error(e.message)
  } finally {
    loading.value = false
  }
}

async function reloadList() {
  loading.value = true
  try {
    const res = await dramaAPI.list({ pageSize: 200 })
    dramas.value = res.items || []
    dramasLoaded.value = true
    persistDramasCache()
  } catch (e) {
    toast.error(e.message)
  } finally {
    loading.value = false
  }
}

function isNarrationProject(d) {
  return !!(d?.is_narration || d?.project_kind === 'narration' || d?.narration_job_id)
}

function canShowDelete(d) {
  if (isNarrationProject(d)) return !!isAdmin.value && !!d.can_delete
  return !!d.can_delete
}

function openDrama(d) {
  if (!d?.id) return
  if (isNarrationProject(d) && d.narration_job_id) {
    navigateTo(`/narration/${d.narration_job_id}`)
    return
  }
  navigateTo(dramaWorkbenchPath(d.id, d.episodes))
}

function openCoverModal(d) {
  if (!d?.id) return
  coverDramaId.value = Number(d.id)
  coverDramaTitle.value = d.title || ''
  coverInitialCovers.value = {
    '3:4': d.covers?.['3:4'] || d.cover_3_4 || d.cover_url || d.thumbnail || null,
    '4:3': d.covers?.['4:3'] || d.cover_4_3 || null,
  }
  coverModalOpen.value = true
}

function onCoverApplied(payload) {
  const target = dramas.value.find(x => Number(x.id) === Number(coverDramaId.value))
  if (!target) return
  const covers = {
    '3:4': payload?.covers?.['3:4'] || payload?.cover_3_4 || target.covers?.['3:4'] || null,
    '4:3': payload?.covers?.['4:3'] || payload?.cover_4_3 || target.covers?.['4:3'] || null,
  }
  target.covers = covers
  target.cover_3_4 = covers['3:4']
  target.cover_4_3 = covers['4:3']
  target.cover_url = payload?.cover_url || covers['3:4'] || covers['4:3']
  target.thumbnail = target.cover_url
  coverInitialCovers.value = { ...covers }
}

async function openDramaCanvas(d) {
  if (!d?.id) return
  if (isNarrationProject(d) && d.narration_job_id) {
    navigateTo(`/narration/${d.narration_job_id}`)
    return
  }
  try {
    const board = await canvasAPI.byDrama(d.id)
    navigateTo(`/canvas/${board.id}`)
  } catch (e) {
    toast.error(e.message || '打开画布失败')
  }
}

async function create() {
  if (!form.value.title?.trim()) return
  try {
    const d = await dramaAPI.create(form.value)
    showCreate.value = false
    navigateTo(dramaWorkbenchPath(d.id, d.episodes))
  } catch (e) {
    toast.error(e.message)
  }
}

async function onImportCreated() {
  await refreshDramasInBackground()
}

async function delDrama(d) {
  if (isNarrationProject(d)) {
    if (!isAdmin.value) {
      toast.error('仅平台管理员可删除解说漫')
      return
    }
    if (!confirm(`确定删除解说漫「${d.title}」？\n\n将从项目列表与解说工作流中移除。`)) return
    try {
      if (d.narration_job_id) {
        await narrationAPI.delete(d.narration_job_id)
      } else {
        await dramaAPI.del(d.id)
      }
      toast.success('已删除')
      reloadList()
    } catch (e) {
      toast.error(e.message)
    }
    return
  }
  const summary = d.content_summary || '无制作内容'
  if (!confirm(`确定删除空项目「${d.title}」？\n\n当前内容：${summary}\n\n删除后将从列表移除（仅允许无制作内容的项目）。`)) return
  try {
    await dramaAPI.del(d.id)
    toast.success('已删除')
    reloadList()
  } catch (e) {
    toast.error(e.message)
  }
}

async function archiveDrama(d) {
  const summary = d.content_summary || '含制作内容'
  const msg = d.can_delete
    ? `归档后将从列表隐藏，可随时恢复。\n\n当前内容：${summary}`
    : `该项目含制作内容，无法直接删除。\n\n${d.delete_block_reason || summary}\n\n是否改为归档？归档后从列表隐藏，内容仍保留。`
  if (!confirm(`归档「${d.title}」？\n\n${msg}`)) return
  try {
    await dramaAPI.archive(d.id)
    toast.success('已归档')
    reloadList()
  } catch (e) {
    toast.error(e.message)
  }
}

function syncShareTeamsToList(dramaId, teams) {
  const idx = dramas.value.findIndex(item => item.id === dramaId)
  if (idx < 0) return
  dramas.value[idx] = {
    ...dramas.value[idx],
    shared_teams: teams,
  }
  persistDramasCache()
}

async function openShareModal(d) {
  shareTarget.value = d
  shareTeams.value = Array.isArray(d.shared_teams) ? [...d.shared_teams] : []
  shareOwnerTeamId.value = d.team_id ?? d.teamId ?? null
  shareOwnerTeamName.value = d.owner_team_name || ''
  shareSelectedTeamId.value = null
  shareLoading.value = true
  try {
    const [shareRes, dirRes] = await Promise.all([
      dramaAPI.shares(d.id),
      teamsAPI.directory().catch((err) => {
        throw new Error(err?.message || '无权查看团队目录（需归属团队管理员）')
      }),
    ])
    if (!shareRes?.can_manage) {
      toast.error('仅归属团队管理员可管理共享')
      closeShareModal()
      return
    }
    shareTeams.value = shareRes.shared_teams || []
    shareOwnerTeamId.value = shareRes.owner_team_id ?? shareOwnerTeamId.value
    shareOwnerTeamName.value = shareRes.owner_team_name || shareOwnerTeamName.value
    shareDirectory.value = dirRes?.items || []
    syncShareTeamsToList(d.id, shareTeams.value)
  } catch (e) {
    toast.error(e?.message || '加载共享信息失败')
    closeShareModal()
  } finally {
    shareLoading.value = false
  }
}

function closeShareModal() {
  shareTarget.value = null
  shareTeams.value = []
  shareOwnerTeamId.value = null
  shareOwnerTeamName.value = ''
  shareSelectedTeamId.value = null
  shareBusy.value = false
}

async function addShare() {
  const drama = shareTarget.value
  const teamId = Number(shareSelectedTeamId.value)
  if (!drama?.id || !teamId) return
  shareBusy.value = true
  try {
    const res = await dramaAPI.addShare(drama.id, teamId)
    shareTeams.value = res?.shared_teams || shareTeams.value
    shareSelectedTeamId.value = null
    syncShareTeamsToList(drama.id, shareTeams.value)
    toast.success('已共享')
  } catch (e) {
    toast.error(e?.message || '共享失败')
  } finally {
    shareBusy.value = false
  }
}

async function removeShare(t) {
  const drama = shareTarget.value
  const teamId = Number(t?.team_id)
  if (!drama?.id || !teamId) return
  if (!confirm(`取消对「${t.team_name || `#${teamId}`}」的共享？`)) return
  shareBusy.value = true
  try {
    const res = await dramaAPI.removeShare(drama.id, teamId)
    shareTeams.value = res?.shared_teams || shareTeams.value.filter(item => Number(item.team_id) !== teamId)
    syncShareTeamsToList(drama.id, shareTeams.value)
    toast.success('已取消共享')
  } catch (e) {
    toast.error(e?.message || '取消共享失败')
  } finally {
    shareBusy.value = false
  }
}

function coverSrc(d) {
  const covers = d?.covers || {}
  const raw = covers['3:4'] || d?.cover_3_4 || d?.cover_url || d?.thumbnail || ''
  return mediaDisplayUrl(raw) || ''
}

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function getProgress(d) {
  if (!d.episodes?.length) return 0
  const scripted = d.episodes.filter(e => e.script_content || e.scriptContent || e.has_script).length
  return Math.round((scripted / d.episodes.length) * 100)
}

async function loadDirectorStyles() {
  try {
    const res = await promptsAPI.directorStyles()
    directorStyles.value = res.items || []
    if (res.default) form.value.director_style = res.default
  } catch {
    directorStyles.value = [
      { id: 'hongguo_director', label: '红果导演', description: '竖屏短剧节奏，默认推荐' },
      { id: 'super_director', label: '超级导演', description: '电影感叙事与戏剧张力' },
      { id: 'north_america_director', label: '北美导演', description: '好莱坞剧本与覆盖式分镜' },
    ]
  }
}

onMounted(() => {
  load()
  loadDirectorStyles()
})
</script>

<style scoped>
.page {
  padding: 28px 48px 40px;
  overflow-y: auto;
  height: 100%;
  animation: fadeUp 0.35s var(--ease-out) both;
}

/* Page Head */
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 28px;
}
.head-left { display: flex; flex-direction: column; gap: 4px; }
.page-head-actions { display: flex; align-items: center; gap: 10px; }
.page-title {
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-0);
}
.page-desc { font-size: 13px; color: var(--text-3); font-weight: 400; }

/* Grid：与画布一致，竖版 3:4 封面卡片 */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
  gap: 22px 16px;
}

/* Project Card */
.project-card {
  padding: 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: fadeUp 0.4s var(--ease-out) both;
  transition: transform 0.22s var(--ease-out), box-shadow 0.22s var(--ease-out), border-color 0.2s;
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}
.project-card:hover {
  border-color: transparent;
  box-shadow: none;
  transform: translateY(-3px);
}

.project-cover {
  position: relative;
  aspect-ratio: 3 / 4;
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-2);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-md, 0 8px 24px rgba(15, 23, 42, 0.08));
}
.project-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  display: block;
}
.project-cover-placeholder {
  width: 100%;
  height: 100%;
  background:
    linear-gradient(165deg, var(--bg-2) 0%, var(--bg-3) 48%, var(--bg-2) 100%);
}
.cover-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  opacity: 0;
  transition: opacity 0.18s ease;
  pointer-events: none;
  z-index: 1;
}
.cover-overlay .cover-gen-btn { pointer-events: auto; }
.project-card:hover .cover-overlay,
.project-cover:focus-within .cover-overlay { opacity: 1; }
.cover-overlay.is-empty {
  opacity: 1;
  background: transparent;
}
.cover-gen-btn {
  border: none;
  border-radius: 999px;
  padding: 9px 14px;
  font-size: 12px;
  font-weight: 700;
  color: #0b0d12;
  background: #fff;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35);
  cursor: pointer;
}
.cover-top {
  position: absolute;
  top: 10px;
  left: 10px;
  right: 84px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.card-body { padding: 10px 2px 0; flex: 1; display: flex; flex-direction: column; gap: 8px; }
.episode-badge {
  display: flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 700;
  color: #fff;
  letter-spacing: 0.04em;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
}
.episode-badge svg { color: #fff; }

.card-delete { opacity: 0; transition: opacity 0.15s; }
.card-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.92);
  opacity: 0;
  transition: opacity 0.15s;
}
.card-action { color: var(--text-2); }
.card-action:hover { color: var(--text-0); }
.card-delete:hover { color: var(--error); }
.project-card:hover .card-actions { opacity: 1; }
.project-card:hover .card-delete { opacity: 1; }

.project-title {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--text-0);
}
.project-owner {
  font-size: 11px;
  margin: 4px 0 0;
}
.share-badge {
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 999px;
  color: #fff;
  background: rgba(64, 120, 255, 0.85);
  border: none;
}
.share-owned-badge {
  color: #fff;
  background: rgba(14, 165, 233, 0.85);
}

.project-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.style-tag {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  background: var(--accent-bg);
  color: var(--accent-text);
  border-radius: 99px;
  border: 1px solid rgba(184,120,20,0.12);
}
.meta-item {
  display: flex; align-items: center; gap: 4px;
  font-size: 12px; color: var(--text-3);
}

.card-footer {
  padding: 8px 2px 0;
  border-top: none;
  display: flex;
  align-items: center;
  gap: 10px;
}
.progress-mini { flex: 1; }
.progress-mini-track {
  height: 3px; background: var(--bg-3);
  border-radius: 99px; overflow: hidden;
}
.progress-mini-fill {
  height: 100%;
  background: var(--accent-gradient);
  border-radius: 99px;
  transition: width 0.6s var(--ease-out);
}
.card-date { font-size: 11px; color: var(--text-3); white-space: nowrap; }
.card-footer-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}
.card-link-btn {
  border: none;
  background: transparent;
  color: var(--primary);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}
.card-link-btn:hover { text-decoration: underline; }

/* Loading Skeleton */
.loading-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
  gap: 22px 16px;
}
.skeleton-card {
  aspect-ratio: 3 / 4;
  border-radius: 12px;
  background: linear-gradient(90deg, var(--bg-2) 25%, var(--bg-hover) 50%, var(--bg-2) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border: none;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* Empty Card */
.empty-card {
  grid-column: 1 / -1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 56px 32px;
  cursor: pointer;
  border-style: dashed; border-width: 1.5px;
  text-align: center;
  transition: all 0.2s var(--ease-out);
  background: var(--bg-1);
}
.empty-card:hover {
  border-color: var(--accent);
  background: var(--accent-bg);
  transform: translateY(-2px);
}
.empty-icon {
  width: 56px; height: 56px; border-radius: var(--radius-lg);
  background: var(--bg-2);
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3);
  margin-bottom: 4px;
  transition: all 0.2s;
}
.empty-card:hover .empty-icon { background: var(--accent-bg); color: var(--accent); }
.empty-title { font-size: 14px; font-weight: 600; color: var(--text-1); }
.empty-desc { font-size: 12px; color: var(--text-3); max-width: 220px; line-height: 1.6; }

/* Modal */
.modal { padding: 32px; width: 460px; box-shadow: var(--shadow-elevated); animation: scaleIn 0.2s var(--ease-out); }
.modal-header { margin-bottom: 24px; display: flex; flex-direction: column; gap: 6px; }
.modal-icon {
  width: 44px; height: 44px; border-radius: var(--radius);
  background: var(--accent-bg); color: var(--accent);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 4px;
}
.modal-title { font-family: var(--font-display); font-size: 19px; font-weight: 700; }
.modal-desc { font-size: 13px; color: var(--text-3); }
.modal-form { display: flex; flex-direction: column; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; font-weight: 600; color: var(--text-1); }
.required { color: var(--error); }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.field-hint { font-size: 11px; color: var(--text-3); line-height: 1.5; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; padding-top: 6px; }

.share-modal { width: min(520px, calc(100vw - 32px)); }
.share-body { display: flex; flex-direction: column; gap: 18px; margin-bottom: 8px; }
.share-section { display: flex; flex-direction: column; gap: 8px; }
.share-empty { font-size: 13px; padding: 10px 0; }
.share-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.share-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-1);
}
.share-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.share-team-name { font-size: 13px; font-weight: 600; color: var(--text-0); }
.share-meta { font-size: 11px; }
.share-remove { color: var(--text-3); flex-shrink: 0; }
.share-remove:hover { color: var(--error); }
.share-add-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.share-select { flex: 1; min-width: 0; }

@media (max-width: 720px) {
  .grid, .loading-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 10px; }
}
@media (min-width: 900px) {
  .grid, .loading-grid { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
}
@media (min-width: 1280px) {
  .grid, .loading-grid { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
}
@media (min-width: 1600px) {
  .grid, .loading-grid { grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); }
}
</style>
