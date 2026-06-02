import { api } from '~/composables/useApi'
import { getActiveTeamId, setActiveTeamId, clearActiveTeamId } from '~/utils/team-context'

export interface TeamSummary {
  id: number
  name: string
  role: 'owner' | 'admin' | 'member'
  member_count: number
}

export interface TeamMemberSummary {
  user_id: number
  username: string
  display_name: string
  role: string
}

const teams = ref<TeamSummary[]>([])
const activeTeamId = ref<number | null>(null)
const activeTeamMembers = ref<TeamMemberSummary[]>([])

export function useTeam() {
  const activeTeam = computed(() => teams.value.find(t => t.id === activeTeamId.value) ?? null)
  const activeTeamMemberNames = computed(() =>
    activeTeamMembers.value
      .map(m => m.display_name || m.username)
      .filter(Boolean),
  )
  const canManageTeam = computed(() => {
    const role = activeTeam.value?.role
    return role === 'owner' || role === 'admin'
  })

  async function loadActiveTeamMembers() {
    if (!activeTeamId.value) {
      activeTeamMembers.value = []
      return
    }
    try {
      const res = await api.get<{ items: TeamMemberSummary[] }>(`/teams/${activeTeamId.value}/members`)
      activeTeamMembers.value = res.items || []
    } catch {
      activeTeamMembers.value = []
    }
  }

  function syncFromUserPayload(payload: { teams?: TeamSummary[]; active_team_id?: number | null }) {
    if (payload.teams?.length) teams.value = payload.teams
    const stored = getActiveTeamId()
    const validStored = stored && payload.teams?.some(t => t.id === stored) ? stored : null
    const next = validStored ?? payload.active_team_id ?? payload.teams?.[0]?.id ?? null
    activeTeamId.value = next
    if (next) setActiveTeamId(next)
    loadActiveTeamMembers()
  }

  function selectTeam(id: number) {
    if (!teams.value.some(t => t.id === id)) return
    activeTeamId.value = id
    setActiveTeamId(id)
    loadActiveTeamMembers()
  }

  async function refreshTeams() {
    const res = await api.get<{ items: TeamSummary[]; active_team_id: number | null }>('/teams')
    teams.value = res.items || []
    const stored = getActiveTeamId()
    const validStored = stored && teams.value.some(t => t.id === stored) ? stored : null
    const next = validStored ?? res.active_team_id ?? teams.value[0]?.id ?? null
    activeTeamId.value = next
    if (next) setActiveTeamId(next)
    await loadActiveTeamMembers()
  }

  function resetTeams() {
    teams.value = []
    activeTeamId.value = null
    activeTeamMembers.value = []
    clearActiveTeamId()
  }

  return {
    teams,
    activeTeamId,
    activeTeam,
    activeTeamMembers,
    activeTeamMemberNames,
    canManageTeam,
    syncFromUserPayload,
    selectTeam,
    refreshTeams,
    loadActiveTeamMembers,
    resetTeams,
  }
}
