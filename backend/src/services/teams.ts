import { eq, and } from 'drizzle-orm'
import { db, schema, getAppMeta, setAppMeta } from '../db/index.js'
import { now } from '../utils/response.js'

export type TeamRole = 'owner' | 'admin' | 'member'

export interface TeamSummary {
  id: number
  name: string
  role: TeamRole
  member_count: number
}

export interface TeamMemberRow {
  user_id: number
  username: string
  display_name: string
  role: TeamRole
  platform_role: string
  joined_at: string
}

export function getUserTeams(userId: number): TeamSummary[] {
  const memberships = db.select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, userId)).all()
  if (!memberships.length) return []

  const allTeams = db.select().from(schema.teams).all()
  const teamMap = new Map(allTeams.map(t => [t.id, t]))
  const memberCounts = new Map<number, number>()
  for (const row of db.select().from(schema.teamMembers).all()) {
    memberCounts.set(row.teamId, (memberCounts.get(row.teamId) || 0) + 1)
  }

  return memberships
    .map(m => {
      const team = teamMap.get(m.teamId)
      if (!team) return null
      return {
        id: team.id,
        name: team.name,
        role: m.role as TeamRole,
        member_count: memberCounts.get(team.id) || 0,
      }
    })
    .filter((item): item is TeamSummary => !!item)
}

export function userHasTeamAccess(userId: number, teamId: number): boolean {
  const [row] = db.select().from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.userId, userId), eq(schema.teamMembers.teamId, teamId)))
    .all()
  return !!row
}

export function getTeamMemberRole(userId: number, teamId: number): TeamRole | null {
  const [row] = db.select().from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.userId, userId), eq(schema.teamMembers.teamId, teamId)))
    .all()
  return row ? (row.role as TeamRole) : null
}

export function canManageTeamMembers(userId: number, teamId: number): boolean {
  const role = getTeamMemberRole(userId, teamId)
  return role === 'owner' || role === 'admin'
}

export function createTeam(name: string, ownerUserId: number) {
  const ts = now()
  const trimmed = String(name || '').trim() || '未命名团队'
  const res = db.insert(schema.teams).values({
    name: trimmed,
    createdAt: ts,
    updatedAt: ts,
  }).run()
  const teamId = Number(res.lastInsertRowid)
  db.insert(schema.teamMembers).values({
    teamId,
    userId: ownerUserId,
    role: 'owner',
    createdAt: ts,
  }).run()
  return teamId
}

export function updateTeamName(teamId: number, name: string): boolean {
  const trimmed = String(name || '').trim()
  if (!trimmed) return false
  const [team] = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).all()
  if (!team) return false
  db.update(schema.teams)
    .set({ name: trimmed, updatedAt: now() })
    .where(eq(schema.teams.id, teamId))
    .run()
  return true
}

export function addUserToTeam(teamId: number, userId: number, role: TeamRole = 'member') {
  const ts = now()
  const existing = getTeamMemberRole(userId, teamId)
  if (existing) return
  db.insert(schema.teamMembers).values({
    teamId,
    userId,
    role,
    createdAt: ts,
  }).run()
}

export function listTeamMembers(teamId: number): TeamMemberRow[] {
  const members = db.select().from(schema.teamMembers).where(eq(schema.teamMembers.teamId, teamId)).all()
  const users = db.select().from(schema.users).all()
  const userMap = new Map(users.map(u => [u.id, u]))
  return members.map(m => {
    const user = userMap.get(m.userId)
    return {
      user_id: m.userId,
      username: user?.username || '',
      display_name: user?.displayName || user?.username || '',
      role: m.role as TeamRole,
      platform_role: user?.role || 'user',
      joined_at: m.createdAt,
    }
  })
}

export function removeTeamMember(teamId: number, userId: number) {
  db.delete(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)))
    .run()
}

export function updateTeamMemberRole(teamId: number, userId: number, role: TeamRole) {
  db.update(schema.teamMembers)
    .set({ role })
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)))
    .run()
}

export function getDefaultTeamId(): number | null {
  const [team] = db.select().from(schema.teams).orderBy(schema.teams.id).all()
  return team?.id ?? null
}

export function ensureUserInDefaultTeam(userId: number) {
  const teams = getUserTeams(userId)
  if (teams.length) return teams[0].id
  let teamId = getDefaultTeamId()
  if (!teamId) teamId = createTeam('默认团队', userId)
  else addUserToTeam(teamId, userId, 'member')
  return teamId
}

export function migrateDefaultTeamIfNeeded() {
  if (getAppMeta('teams_default_migrated')) return

  const ts = now()
  const users = db.select().from(schema.users).all()
  let teamId = getDefaultTeamId()

  if (!teamId) {
    const ownerId = users.find(u => u.role === 'admin')?.id || users[0]?.id
    if (ownerId) {
      teamId = createTeam('默认团队', ownerId)
    } else {
      setAppMeta('teams_default_migrated', ts)
      return
    }
  }

  for (const user of users) {
    if (!userHasTeamAccess(user.id, teamId)) {
      addUserToTeam(teamId, user.id, user.role === 'admin' ? 'owner' : 'member')
    }
  }

  db.update(schema.dramas).set({ teamId, updatedAt: ts }).run()
  setAppMeta('teams_default_migrated', ts)
}
