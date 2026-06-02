import { clearAuthSession, getAuthToken, getStoredUser, setAuthSession, type StoredUser } from '~/utils/auth-token'
import { api } from '~/composables/useApi'
import { useTeam } from '~/composables/useTeam'

const user = ref<StoredUser | null>(null)
const ready = ref(false)

export function useAuth() {
  const { syncFromUserPayload, resetTeams } = useTeam()
  const isAdmin = computed(() => user.value?.role === 'admin')
  const isLoggedIn = computed(() => Boolean(user.value))

  async function init() {
    const cached = getStoredUser()
    if (!cached) {
      user.value = null
      ready.value = true
      return
    }
    try {
      const me = await api.get<StoredUser & { teams?: import('~/composables/useTeam').TeamSummary[]; active_team_id?: number | null }>('/auth/me')
      user.value = {
        id: me.id,
        username: me.username,
        display_name: me.display_name || me.username,
        role: me.role,
        credits_balance: me.credits_balance,
      }
      syncFromUserPayload(me)
    } catch {
      clearAuthSession()
      resetTeams()
      user.value = null
    } finally {
      ready.value = true
    }
  }

  async function login(username: string, password: string) {
    const res = await api.post<{ token: string; user: StoredUser & { teams?: import('~/composables/useTeam').TeamSummary[]; active_team_id?: number | null } }>('/auth/login', { username, password })
    setAuthSession(res.token, res.user)
    user.value = res.user
    syncFromUserPayload(res.user)
  }

  function logout() {
    clearAuthSession()
    resetTeams()
    user.value = null
    navigateTo('/login')
  }

  async function refreshBalance() {
    if (!user.value) return
    try {
      const res = await api.get<{ balance: number }>('/credits/balance')
      user.value = { ...user.value, credits_balance: res.balance }
      const cached = getStoredUser()
      if (cached) setAuthSession(getAuthToken() || '', { ...cached, credits_balance: res.balance })
    } catch {}
  }

  return { user, ready, isAdmin, isLoggedIn, init, login, logout, refreshBalance }
}
