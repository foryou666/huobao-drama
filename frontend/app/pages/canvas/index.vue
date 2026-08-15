<template>
  <div class="page">
    <div class="page-head">
      <div class="head-left">
        <h1 class="page-title">画布</h1>
        <p class="page-desc">竖版 3:4 封面 · {{ items.length }} 部短剧</p>
      </div>
      <NuxtLink to="/" class="btn">前往项目列表</NuxtLink>
    </div>

    <div v-if="loading" class="poster-grid">
      <div v-for="i in 6" :key="i" class="poster-card skeleton" />
    </div>

    <div v-else class="poster-grid">
      <article
        v-for="item in items"
        :key="item.id"
        class="poster-card"
        @click="openBoard(item)"
      >
        <div class="poster-cover">
          <img
            v-if="coverOf(item, '3:4')"
            :src="coverSrc(coverOf(item, '3:4'))"
            :alt="item.drama_title || item.title"
            class="poster-img"
            loading="lazy"
          />
          <div v-else class="poster-placeholder" aria-hidden="true" />

          <div class="poster-top">
            <span class="episode-badge">{{ isNarrationProject(item) ? '解说漫' : `${episodeCount(item)} 集` }}</span>
            <span v-if="isNarrationProject(item)" class="share-badge">解说</span>
            <span v-else-if="item.is_shared_project" class="share-badge">共享</span>
            <span
              v-else-if="item.shared_teams?.length"
              class="share-badge owned"
              :title="(item.shared_teams || []).map(t => t.team_name).join('、')"
            >已共享 {{ item.shared_teams.length }}</span>
          </div>

          <div class="poster-top-right">
            <button
              v-if="item.can_manage_drama || item.can_manage"
              type="button"
              class="share-action"
              title="共享给其他团队"
              @click.stop="openShareModal(item)"
            >
              <Share2 :size="13" />
            </button>
            <span class="poster-nodes">{{ item.node_count || 0 }} 节点</span>
          </div>

          <div class="poster-overlay" :class="{ 'is-empty': !coverOf(item, '3:4') }">
            <button
              type="button"
              class="poster-cover-btn"
              @click.stop="openCoverModal(item)"
            >
              {{ coverOf(item, '3:4') ? '封面查看' : '生成封面' }}
            </button>
          </div>
        </div>

        <div class="poster-meta">
          <h3 class="poster-title">{{ item.drama_title || item.title }}</h3>
          <p v-if="item.is_shared_project && item.owner_team_name" class="poster-owner">
            来自 {{ item.owner_team_name }}
          </p>
          <div class="poster-stats">
            <span v-if="item.drama_style" class="style-tag">{{ item.drama_style }}</span>
            <span class="stat-item" title="角色数量">
              <Users :size="12" />
              {{ item.character_count ?? 0 }}
            </span>
            <span class="stat-item" title="场景数量">
              <ImageIcon :size="12" />
              {{ item.scene_count ?? 0 }}
            </span>
          </div>
          <div class="poster-foot">
            <div class="progress-mini">
              <div class="progress-mini-track">
                <div class="progress-mini-fill" :style="{ width: getProgress(item) + '%' }" />
              </div>
            </div>
            <span class="poster-date">{{ fmtDate(item.updated_at) }}</span>
          </div>
        </div>
      </article>

      <div v-if="!items.length" class="empty-block">
        <p class="dim">还没有项目。新建项目后会自动出现在这里。</p>
        <NuxtLink to="/" class="btn btn-primary" style="margin-top:14px">前往新建项目</NuxtLink>
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

    <div v-if="shareTarget" class="overlay" @click.self="closeShareModal">
      <div class="modal card share-modal">
        <div class="modal-header">
          <h2 class="modal-title">共享项目</h2>
          <p class="modal-desc">
            将「{{ shareTarget.drama_title || shareTarget.title }}」共享给其他团队后，对方可在项目列表与画布中打开协作。
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
                    class="btn btn-ghost btn-sm"
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
import { computed, onMounted, ref } from 'vue'
import { Image as ImageIcon, Share2, Users } from 'lucide-vue-next'
import { canvasAPI, dramaAPI, teamsAPI } from '~/composables/useApi'
import { mediaDisplayUrl } from '~/utils/media-url.js'
import { toast } from 'vue-sonner'

const router = useRouter()
const loading = ref(true)
const items = ref([])
const coverModalOpen = ref(false)
const coverDramaId = ref(0)
const coverDramaTitle = ref('')
const coverInitialCovers = ref({ '3:4': null, '4:3': null })

const shareTarget = ref(null)
const shareTeams = ref([])
const shareDirectory = ref([])
const shareOwnerTeamId = ref(null)
const shareOwnerTeamName = ref('')
const shareSelectedTeamId = ref(null)
const shareLoading = ref(false)
const shareBusy = ref(false)

const shareTeamSelectOptions = computed(() => {
  const taken = new Set(shareTeams.value.map(t => Number(t.team_id)))
  const ownerId = Number(shareOwnerTeamId.value)
  return (shareDirectory.value || [])
    .filter(t => {
      const id = Number(t.id || t.team_id)
      if (!id || taken.has(id)) return false
      if (ownerId && id === ownerId) return false
      return true
    })
    .map(t => ({
      label: t.name || t.team_name || `#${t.id}`,
      value: Number(t.id || t.team_id),
    }))
})

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

function coverSrc(raw) {
  return mediaDisplayUrl(raw) || ''
}

function coverOf(item, ratio) {
  const covers = item?.covers || {}
  if (ratio === '3:4') return covers['3:4'] || item?.cover_3_4 || item?.cover_url || item?.thumbnail || ''
  if (ratio === '4:3') return covers['4:3'] || item?.cover_4_3 || ''
  return ''
}

function episodeCount(item) {
  if (Array.isArray(item?.episodes)) return item.episodes.length
  return Number(item?.episode_count || 0)
}

function getProgress(item) {
  const eps = item?.episodes || []
  if (!eps.length) return 0
  const scripted = eps.filter(e => e.script_content || e.scriptContent || e.has_script).length
  return Math.round((scripted / eps.length) * 100)
}

async function load() {
  loading.value = true
  try {
    const res = await canvasAPI.list()
    items.value = res?.items || []
  } catch (err) {
    toast.error(err?.message || '加载画布失败')
  } finally {
    loading.value = false
  }
}

function isNarrationProject(item) {
  return !!(item?.is_narration || item?.project_kind === 'narration' || item?.narration_job_id)
}

function openBoard(item) {
  if (isNarrationProject(item) && item.narration_job_id) {
    router.push(`/narration/${item.narration_job_id}`)
    return
  }
  router.push(`/canvas/${item.id}`)
}

function openCoverModal(item) {
  const dramaId = Number(item.drama_id)
  if (!dramaId) return
  coverDramaId.value = dramaId
  coverDramaTitle.value = item.drama_title || item.title || ''
  coverInitialCovers.value = {
    '3:4': coverOf(item, '3:4') || null,
    '4:3': coverOf(item, '4:3') || null,
  }
  coverModalOpen.value = true
}

function onCoverApplied(payload) {
  const target = items.value.find(x => x.drama_id === coverDramaId.value)
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

function syncShareTeamsToList(dramaId, teams) {
  const target = items.value.find(x => Number(x.drama_id) === Number(dramaId))
  if (!target) return
  target.shared_teams = Array.isArray(teams) ? [...teams] : []
}

async function openShareModal(item) {
  const dramaId = Number(item.drama_id)
  if (!dramaId) return
  shareTarget.value = item
  shareTeams.value = Array.isArray(item.shared_teams) ? [...item.shared_teams] : []
  shareOwnerTeamName.value = item.owner_team_name || ''
  shareOwnerTeamId.value = null
  shareSelectedTeamId.value = null
  shareLoading.value = true
  try {
    const [shareRes, dirRes] = await Promise.all([
      dramaAPI.shares(dramaId),
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
    shareOwnerTeamId.value = shareRes.owner_team_id ?? null
    shareOwnerTeamName.value = shareRes.owner_team_name || shareOwnerTeamName.value
    shareDirectory.value = dirRes?.items || []
    syncShareTeamsToList(dramaId, shareTeams.value)
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
  shareDirectory.value = []
  shareOwnerTeamId.value = null
  shareOwnerTeamName.value = ''
  shareSelectedTeamId.value = null
  shareBusy.value = false
}

async function addShare() {
  const item = shareTarget.value
  const dramaId = Number(item?.drama_id)
  const teamId = Number(shareSelectedTeamId.value)
  if (!dramaId || !teamId) return
  shareBusy.value = true
  try {
    const res = await dramaAPI.addShare(dramaId, teamId)
    shareTeams.value = res?.shared_teams || shareTeams.value
    shareSelectedTeamId.value = null
    syncShareTeamsToList(dramaId, shareTeams.value)
    toast.success('已共享')
  } catch (e) {
    toast.error(e?.message || '共享失败')
  } finally {
    shareBusy.value = false
  }
}

async function removeShare(t) {
  const item = shareTarget.value
  const dramaId = Number(item?.drama_id)
  const teamId = Number(t?.team_id)
  if (!dramaId || !teamId) return
  if (!confirm(`取消对「${t.team_name || `#${teamId}`}」的共享？`)) return
  shareBusy.value = true
  try {
    const res = await dramaAPI.removeShare(dramaId, teamId)
    shareTeams.value = res?.shared_teams || shareTeams.value.filter(row => Number(row.team_id) !== teamId)
    syncShareTeamsToList(dramaId, shareTeams.value)
    toast.success('已取消共享')
  } catch (e) {
    toast.error(e?.message || '取消共享失败')
  } finally {
    shareBusy.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.page {
  width: 100%;
  max-width: none;
  margin: 0;
  align-self: stretch;
  box-sizing: border-box;
  padding: 24px 28px 56px;
  min-height: 100%;
  background: #0b0d12;
  color: #f3f5f9;
}
.page-head {
  width: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}
.page-title { margin: 0; font-size: 1.55rem; letter-spacing: 0.02em; color: #fff; }
.page-desc { margin: 6px 0 0; color: rgba(255, 255, 255, 0.55); font-size: 0.9rem; }
.page :deep(.btn) {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
  color: #e8ecf4;
}
.page :deep(.btn:hover) {
  background: rgba(255, 255, 255, 0.14);
}
.page :deep(.btn-primary) {
  background: #3b82f6;
  border-color: #3b82f6;
  color: #fff;
}

.poster-grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
  gap: 22px 16px;
}

.poster-card {
  cursor: pointer;
  border: none;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: transform 0.18s ease;
}
.poster-card:hover { transform: translateY(-3px); }
.poster-card.skeleton {
  aspect-ratio: 3 / 4;
  border-radius: 12px;
  background: linear-gradient(110deg, #171a22 20%, #222735 40%, #171a22 60%);
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite linear;
}
@keyframes shimmer {
  to { background-position: -200% 0; }
}

.poster-cover {
  position: relative;
  aspect-ratio: 3 / 4;
  border-radius: 12px;
  overflow: hidden;
  background: #151922;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}
.poster-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  display: block;
}
.poster-placeholder {
  width: 100%;
  height: 100%;
  background:
    linear-gradient(165deg, #2a3144 0%, #141820 48%, #0a0d14 100%);
}

.poster-top {
  position: absolute;
  top: 10px;
  left: 10px;
  right: 88px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.poster-top-right {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
}
.episode-badge,
.share-badge,
.poster-nodes {
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
}
.share-badge { background: rgba(64, 120, 255, 0.85); }
.share-badge.owned { background: rgba(56, 189, 248, 0.8); }
.share-action {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  cursor: pointer;
}
.share-action:hover { background: rgba(59, 130, 246, 0.85); }

.poster-overlay {
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
.poster-overlay .poster-cover-btn { pointer-events: auto; }
.poster-card:hover .poster-overlay,
.poster-cover:focus-within .poster-overlay { opacity: 1; }
.poster-overlay.is-empty {
  opacity: 1;
  background: transparent;
}

.poster-cover-btn {
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

.poster-meta { padding: 0 2px; display: flex; flex-direction: column; gap: 6px; }
.poster-title {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 650;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.94);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.poster-owner {
  margin: 0;
  font-size: 0.76rem;
  color: rgba(255, 255, 255, 0.48);
}
.poster-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.style-tag {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.78);
  background: rgba(255, 255, 255, 0.08);
}
.stat-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.62);
}
.poster-foot {
  display: flex;
  align-items: center;
  gap: 10px;
}
.progress-mini { flex: 1; min-width: 0; }
.progress-mini-track {
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.progress-mini-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #3b82f6, #60a5fa);
}
.poster-date {
  flex-shrink: 0;
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.42);
}

.empty-block {
  grid-column: 1 / -1;
  padding: 56px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  color: rgba(255, 255, 255, 0.55);
}

.overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(8, 10, 16, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.share-modal {
  width: min(520px, 100%);
  padding: 20px;
  background: #12151c;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e8ecf4;
}
.modal-header { margin-bottom: 14px; }
.modal-title { margin: 0; font-size: 1.15rem; }
.modal-desc { margin: 6px 0 0; font-size: 0.85rem; color: rgba(255, 255, 255, 0.55); }
.share-body { display: flex; flex-direction: column; gap: 16px; }
.share-section { display: flex; flex-direction: column; gap: 8px; }
.field-label { font-size: 12px; font-weight: 650; color: rgba(255, 255, 255, 0.7); }
.share-empty { font-size: 13px; }
.share-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.share-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
}
.share-team-name { font-weight: 600; }
.share-meta { font-size: 12px; margin-left: 8px; }
.share-add-row { display: flex; gap: 8px; align-items: center; }
.share-select { flex: 1; min-width: 0; }
.modal-actions { margin-top: 16px; display: flex; justify-content: flex-end; }
.dim { color: rgba(255, 255, 255, 0.48); }

@media (max-width: 720px) {
  .page { padding: 16px 12px 40px; }
  .poster-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 10px; }
}
@media (min-width: 900px) {
  .poster-grid { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
}
@media (min-width: 1280px) {
  .poster-grid { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
}
@media (min-width: 1600px) {
  .poster-grid { grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); }
}
</style>
