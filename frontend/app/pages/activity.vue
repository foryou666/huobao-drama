<template>

  <div class="page">

    <div class="page-head">

      <div>

        <h1 class="page-title">工作记录</h1>

        <p class="page-desc">查看操作日志与积分消耗明细{{ scopeHint }}</p>

      </div>

      <div class="head-actions">

        <div class="balance-card">

          <span class="balance-label">当前积分</span>

          <span class="balance-value">{{ balance ?? '—' }}</span>

        </div>

        <NuxtLink v-if="rechargeEnabled" to="/recharge" class="btn btn-primary btn-sm recharge-link">充值</NuxtLink>

        <label v-if="canManageTeam && !isAdmin" class="toggle-all">

          <input v-model="showTeam" type="checkbox" @change="onScopeChange" />

          <span>查看团队</span>

        </label>

        <label v-if="isAdmin" class="toggle-all">

          <input v-model="showAll" type="checkbox" @change="onScopeChange" />

          <span>查看全员</span>

        </label>

        <select

          v-if="showMultiUser && teamMembers.length"

          v-model.number="filterUserId"

          class="member-filter"

          @change="reload"

        >

          <option :value="null">全部成员</option>

          <option v-for="m in teamMembers" :key="m.user_id" :value="m.user_id">

            {{ m.display_name || m.username }}

          </option>

        </select>

      </div>

    </div>



    <p v-if="rechargeSuccess" class="recharge-success-banner">充值成功，积分已到账，可在下方积分明细中查看。</p>



    <div class="record-tabs">

      <button type="button" class="record-tab" :class="{ active: tab === 'activity' }" @click="tab = 'activity'">操作记录</button>

      <button type="button" class="record-tab" :class="{ active: tab === 'credits' }" @click="tab = 'credits'">积分明细</button>

      <button v-if="activeTeamId" type="button" class="record-tab" :class="{ active: tab === 'stats' }" @click="tab = 'stats'">团队统计</button>

    </div>



    <div v-if="loading" class="dim">加载中…</div>



    <div v-else-if="tab === 'activity'">

      <div v-if="!activityItems.length" class="card empty-card">暂无操作记录</div>

      <div v-else class="log-table card">

        <table>

          <thead>

            <tr>

              <th>时间</th>

              <th v-if="showMultiUser">操作人</th>

              <th>操作</th>

              <th>说明</th>

              <th>消耗积分</th>

            </tr>

          </thead>

          <tbody>

            <tr v-for="row in activityItems" :key="row.id">

              <td class="mono dim">{{ fmtTime(row.created_at) }}</td>

              <td v-if="showMultiUser">{{ row.operator_name || row.display_name || row.username || '—' }}</td>

              <td><span class="tag">{{ actionLabel(row.action) }}</span></td>

              <td>{{ row.summary || '—' }}</td>

              <td class="mono" :class="row.credit_cost ? 'cost-negative' : 'dim'">{{ row.credit_cost ? `-${row.credit_cost}` : '—' }}</td>

            </tr>

          </tbody>

        </table>

      </div>

    </div>



    <div v-else-if="tab === 'stats'">

      <div class="stats-toolbar card">

        <div class="range-presets">

          <button type="button" class="btn btn-sm" :class="{ active: rangePreset === 7 }" @click="setRangePreset(7)">近 7 天</button>

          <button type="button" class="btn btn-sm" :class="{ active: rangePreset === 30 }" @click="setRangePreset(30)">近 30 天</button>

        </div>

        <div class="range-inputs">

          <input v-model="dateFrom" type="date" class="input input-sm" @change="onRangeChange" />

          <span class="dim">至</span>

          <input v-model="dateTo" type="date" class="input input-sm" @change="onRangeChange" />

        </div>

      </div>



      <div v-if="!teamStats" class="card empty-card">暂无统计数据</div>



      <template v-else>

        <div class="stats-summary">

          <div class="summary-card card">

            <span class="summary-label">积分消耗</span>

            <span class="summary-value cost-negative">{{ teamStats.summary.total_consumed }}</span>

            <span v-if="teamStats.summary.total_refunded" class="summary-hint">含退款 {{ teamStats.summary.total_refunded }}</span>

          </div>

          <div class="summary-card card">

            <span class="summary-label">积分充值</span>

            <span class="summary-value">{{ teamStats.summary.total_granted }}</span>

          </div>

          <div class="summary-card card">

            <span class="summary-label">操作次数</span>

            <span class="summary-value">{{ teamStats.summary.total_activities }}</span>

          </div>

          <div class="summary-card card">

            <span class="summary-label">活跃成员</span>

            <span class="summary-value">{{ teamStats.summary.active_members }}</span>

          </div>

          <div class="summary-card card">

            <span class="summary-label">图片 / 视频</span>

            <span class="summary-value">{{ teamStats.summary.total_images }} / {{ teamStats.summary.total_videos }}</span>

          </div>

        </div>



        <div class="card stats-panel">

          <div class="panel-title">每日工作量</div>

          <div class="daily-chart">

            <div v-for="day in teamStats.daily" :key="day.date" class="daily-bar-col" :title="`${day.date}\n操作 ${day.activities} · 消耗 ${day.credits_consumed}`">

              <div class="daily-bar-track">

                <div class="daily-bar-fill" :style="{ height: dailyBarHeight(day.activities) }"></div>

              </div>

              <span class="daily-bar-label">{{ day.date.slice(5) }}</span>

            </div>

          </div>

        </div>



        <div class="card stats-panel">

          <div class="panel-title">成员明细</div>

          <div class="log-table">

            <table>

              <thead>

                <tr>

                  <th>成员</th>

                  <th>余额</th>

                  <th>充值</th>

                  <th>净消耗</th>

                  <th>操作</th>

                  <th>项目/集</th>

                  <th>图片</th>

                  <th>视频</th>

                  <th>Agent</th>

                  <th>最近活跃</th>

                </tr>

              </thead>

              <tbody>

                <tr v-for="m in teamStats.members" :key="m.user_id">

                  <td>

                    <div class="member-name">{{ m.display_name || m.username }}</div>

                    <div class="dim member-role">{{ m.role }}</div>

                  </td>

                  <td class="mono">{{ m.credits_balance }}</td>

                  <td class="mono">{{ m.period.credits_granted }}</td>

                  <td class="mono cost-negative">{{ m.period.credits_consumed }}</td>

                  <td class="mono">{{ m.period.activity_count }}</td>

                  <td class="mono">{{ m.period.dramas_touched }} / {{ m.period.episodes_touched }}</td>

                  <td class="mono">{{ m.period.images }}</td>

                  <td class="mono">{{ m.period.videos }}</td>

                  <td class="mono">{{ m.period.agent_runs }}</td>

                  <td class="mono dim">{{ fmtTime(m.last_active_at) || '—' }}</td>

                </tr>

              </tbody>

            </table>

          </div>

        </div>

      </template>

    </div>



    <div v-else>

      <div v-if="!creditItems.length" class="card empty-card">暂无积分明细</div>

      <div v-else class="log-table card">

        <table>

          <thead>

            <tr>

              <th>时间</th>

              <th v-if="showMultiUser">操作人</th>

              <th>类型</th>

              <th>说明</th>

              <th>变动</th>

              <th>余额</th>

            </tr>

          </thead>

          <tbody>

            <tr v-for="row in creditItems" :key="row.id">

              <td class="mono dim">{{ fmtTime(row.created_at) }}</td>

              <td v-if="showMultiUser">{{ row.operator_name || row.display_name || row.username || '—' }}</td>

              <td><span class="tag">{{ row.action_label || row.action }}</span></td>

              <td>{{ row.summary || '—' }}</td>

              <td class="mono" :class="row.amount >= 0 ? 'cost-positive' : 'cost-negative'">{{ row.amount >= 0 ? `+${row.amount}` : row.amount }}</td>

              <td class="mono">{{ row.balance_after }}</td>

            </tr>

          </tbody>

        </table>

      </div>

    </div>

  </div>

</template>



<script setup>

import { activityAPI, creditsAPI, teamsAPI, ACTION_LABELS } from '~/composables/useApi'



const { isAdmin, refreshBalance } = useAuth()

const route = useRoute()
const router = useRouter()

const { canManageTeam, activeTeamId } = useTeam()
const { rechargeEnabled } = useRechargeAccess()

const loading = ref(false)

const tab = ref('activity')
const rechargeSuccess = ref(false)

const activityItems = ref([])

const creditItems = ref([])

const teamStats = ref(null)

const balance = ref(null)

const showAll = ref(false)

const showTeam = ref(false)

const filterUserId = ref(null)

const teamMembers = ref([])

const currentScope = ref('self')



function fmtDateInput(d) {

  const y = d.getFullYear()

  const m = String(d.getMonth() + 1).padStart(2, '0')

  const day = String(d.getDate()).padStart(2, '0')

  return `${y}-${m}-${day}`

}



const rangePreset = ref(7)

const dateTo = ref(fmtDateInput(new Date()))

const dateFrom = ref(fmtDateInput(new Date(Date.now() - 6 * 86400000)))



const showMultiUser = computed(() => showAll.value || showTeam.value || currentScope.value === 'team' || currentScope.value === 'all')

const scopeHint = computed(() => {

  if (showAll.value) return '（全员）'

  if (showTeam.value) return '（当前团队）'

  return ''

})



function actionLabel(action) {

  return ACTION_LABELS[action] || action

}



function fmtTime(s) {

  if (!s) return ''

  const d = new Date(s)

  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

}



function listParams() {

  const params = { limit: 100 }

  if (filterUserId.value) params.user_id = filterUserId.value

  if (isAdmin.value && showAll.value) params.all = true

  else if (showTeam.value) params.team = true

  return params

}



async function loadTeamMembers() {

  if (!activeTeamId.value || (!canManageTeam.value && !isAdmin.value)) {

    teamMembers.value = []

    return

  }

  try {

    const res = await teamsAPI.members(activeTeamId.value)

    teamMembers.value = res.items || []

  } catch {

    teamMembers.value = []

  }

}



async function loadBalance() {

  try {

    const res = await creditsAPI.balance()

    balance.value = res.balance

    await refreshBalance()

  } catch {

    balance.value = null

  }

}



async function loadActivity() {

  const res = await activityAPI.list(listParams())

  activityItems.value = res.items || []

  currentScope.value = res.scope || 'self'

}



async function loadCredits() {

  const res = await creditsAPI.transactions(listParams())

  creditItems.value = res.items || []

  currentScope.value = res.scope || 'self'

}



async function loadStats() {

  if (!activeTeamId.value) {

    teamStats.value = null

    return

  }

  const params = { date_from: dateFrom.value, date_to: dateTo.value }

  if (showMultiUser.value && filterUserId.value) params.user_id = filterUserId.value

  const res = await teamsAPI.stats(activeTeamId.value, params)

  teamStats.value = res

}



function setRangePreset(days) {

  rangePreset.value = days

  const to = new Date()

  const from = new Date(to.getTime() - (days - 1) * 86400000)

  dateTo.value = fmtDateInput(to)

  dateFrom.value = fmtDateInput(from)

  if (tab.value === 'stats') reload()

}



function onRangeChange() {

  rangePreset.value = 0

  if (tab.value === 'stats') reload()

}



function dailyBarHeight(count) {

  const max = Math.max(...(teamStats.value?.daily || []).map(d => d.activities), 1)

  return `${Math.max(4, Math.round((count / max) * 100))}%`

}



async function reload() {

  loading.value = true

  try {

    await Promise.all([loadBalance(), loadActivity(), loadCredits(), loadStats()])

  } catch {

    activityItems.value = []

    creditItems.value = []

    teamStats.value = null

  } finally {

    loading.value = false

  }

}



function onScopeChange() {

  if (showAll.value) showTeam.value = false

  if (showTeam.value) showAll.value = false

  filterUserId.value = null

  reload()

}



watch(tab, (value) => {

  if (value === 'stats') loadStats()

})



onMounted(async () => {

  const qTab = String(route.query.tab || '')
  if (qTab === 'credits' || qTab === 'stats' || qTab === 'activity') {
    tab.value = qTab
  }
  if (route.query.recharge === 'success') {
    rechargeSuccess.value = true
    const nextQuery = { ...route.query }
    delete nextQuery.recharge
    void router.replace({ query: nextQuery })
    setTimeout(() => { rechargeSuccess.value = false }, 5000)
  }

  await loadTeamMembers()

  await reload()

})

</script>



<style scoped>

.page {
  padding: 28px 32px;
  max-width: 1100px;
  margin: 0 auto;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
}

.page-head {

  display: flex;

  align-items: flex-start;

  justify-content: space-between;

  margin-bottom: 16px;

  gap: 16px;

}

.head-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

.recharge-link { text-decoration: none; white-space: nowrap; }

.page-title { font-family: var(--font-display); font-size: 24px; margin: 0 0 6px; }

.page-desc { margin: 0; font-size: 13px; color: var(--text-3); }

.balance-card {

  display: flex;

  flex-direction: column;

  align-items: flex-end;

  padding: 8px 12px;

  border-radius: 10px;

  border: 1px solid var(--border);

  background: var(--bg-1);

}

.balance-label { font-size: 11px; color: var(--text-dim); }

.balance-value { font-size: 18px; font-weight: 700; color: var(--accent-text); }

.toggle-all {

  display: flex;

  align-items: center;

  gap: 8px;

  font-size: 13px;

  color: var(--text-2);

  cursor: pointer;

}

.member-filter {

  min-width: 120px;

  padding: 6px 10px;

  border-radius: var(--radius);

  border: 1px solid var(--border);

  background: var(--bg-1);

  font-size: 12px;

  color: var(--text-1);

}

.record-tabs { display: flex; gap: 8px; margin-bottom: 16px; }

.recharge-success-banner {
  margin: 0 0 16px;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(102, 187, 106, 0.12);
  border: 1px solid rgba(102, 187, 106, 0.35);
  color: #81c784;
  font-size: 14px;
}

.record-tab {

  padding: 6px 14px;

  border-radius: 999px;

  border: 1px solid var(--border);

  background: var(--bg-1);

  cursor: pointer;

  font-size: 12px;

}

.record-tab.active {

  border-color: var(--accent);

  background: var(--accent-bg);

  color: var(--accent-text);

}

.log-table { overflow: auto; padding: 0; }

table { width: 100%; border-collapse: collapse; font-size: 13px; }

th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid var(--border); }

th { color: var(--text-3); font-weight: 500; font-size: 12px; }

.empty-card { padding: 48px; text-align: center; color: var(--text-3); }

.cost-negative { color: #ef5350; font-weight: 600; }

.cost-positive { color: #66bb6a; font-weight: 600; }

.stats-toolbar {

  display: flex;

  align-items: center;

  justify-content: space-between;

  gap: 12px;

  padding: 12px 16px;

  margin-bottom: 16px;

  flex-wrap: wrap;

}

.range-presets { display: flex; gap: 8px; }

.range-presets .btn.active {

  border-color: var(--accent);

  background: var(--accent-bg);

  color: var(--accent-text);

}

.range-inputs { display: flex; align-items: center; gap: 8px; }

.input-sm { padding: 6px 10px; font-size: 12px; min-width: 130px; }

.stats-summary {

  display: grid;

  grid-template-columns: repeat(5, minmax(0, 1fr));

  gap: 12px;

  margin-bottom: 16px;

}

.summary-card {

  padding: 14px 16px;

  display: flex;

  flex-direction: column;

  gap: 6px;

}

.summary-label { font-size: 12px; color: var(--text-3); }

.summary-value { font-size: 22px; font-weight: 700; font-family: var(--font-mono); }

.summary-hint { font-size: 11px; color: var(--text-3); }

.stats-panel { padding: 16px; margin-bottom: 16px; }

.panel-title { font-size: 13px; font-weight: 600; margin-bottom: 14px; }

.daily-chart {

  display: flex;

  align-items: flex-end;

  gap: 8px;

  min-height: 120px;

  overflow-x: auto;

  padding-bottom: 4px;

}

.daily-bar-col {

  display: flex;

  flex-direction: column;

  align-items: center;

  gap: 6px;

  min-width: 36px;

  flex: 1;

}

.daily-bar-track {

  width: 100%;

  height: 96px;

  border-radius: 6px;

  background: var(--bg-2);

  display: flex;

  align-items: flex-end;

  overflow: hidden;

}

.daily-bar-fill {

  width: 100%;

  background: linear-gradient(180deg, rgba(184,120,20,0.85), rgba(184,120,20,0.35));

  border-radius: 6px 6px 0 0;

  min-height: 4px;

}

.daily-bar-label { font-size: 10px; color: var(--text-3); font-family: var(--font-mono); }

.member-name { font-weight: 600; }

.member-role { font-size: 11px; }



@media (max-width: 900px) {

  .stats-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }

}

</style>

