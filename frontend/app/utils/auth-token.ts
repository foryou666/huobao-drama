const TOKEN_KEY = 'hg_auth_token'
const USER_KEY = 'hg_auth_user'

export interface StoredUser {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'user'
  credits_balance?: number
  can_use_funshion?: boolean
}

export function getAuthToken(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function setAuthSession(token: string, user: StoredUser) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function getStoredUser(): StoredUser | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredUser
  } catch {
    return null
  }
}

export function clearAuthSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('hg_active_team_id')
  }
}
