const TEAM_KEY = 'hg_active_team_id'

export function getActiveTeamId(): number | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(TEAM_KEY)
  if (!raw) return null
  const id = Number(raw)
  return id > 0 ? id : null
}

export function setActiveTeamId(id: number | null) {
  if (typeof localStorage === 'undefined') return
  if (id == null) localStorage.removeItem(TEAM_KEY)
  else localStorage.setItem(TEAM_KEY, String(id))
}

export function clearActiveTeamId() {
  setActiveTeamId(null)
}
