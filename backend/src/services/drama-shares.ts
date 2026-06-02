import { eq, and } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { userHasTeamAccess, canManageTeamMembers } from './teams.js'
import type { AuthUser } from '../middleware/auth.js'

export interface DramaShareRow {
  team_id: number
  team_name: string
  shared_at: string
}

export function getSharesByDramaId(dramaId: number): DramaShareRow[] {
  const shares = db.select().from(schema.dramaTeamShares)
    .where(eq(schema.dramaTeamShares.dramaId, dramaId)).all()
  const teams = db.select().from(schema.teams).all()
  const teamMap = new Map(teams.map(t => [t.id, t.name]))
  return shares.map(s => ({
    team_id: s.teamId,
    team_name: teamMap.get(s.teamId) || `#${s.teamId}`,
    shared_at: s.createdAt,
  }))
}

export function getSharedTeamIds(dramaId: number): number[] {
  return db.select().from(schema.dramaTeamShares)
    .where(eq(schema.dramaTeamShares.dramaId, dramaId))
    .all()
    .map(s => s.teamId)
}

export function isDramaSharedWithTeam(dramaId: number, teamId: number): boolean {
  const [row] = db.select().from(schema.dramaTeamShares)
    .where(and(
      eq(schema.dramaTeamShares.dramaId, dramaId),
      eq(schema.dramaTeamShares.teamId, teamId),
    ))
    .all()
  return !!row
}

export function getSharedDramaIdsByTeam(teamId: number): Set<number> {
  const rows = db.select().from(schema.dramaTeamShares)
    .where(eq(schema.dramaTeamShares.teamId, teamId)).all()
  return new Set(rows.map(r => r.dramaId))
}

export function dramaVisibleToTeam(
  drama: { id: number; teamId: number | null },
  teamId: number,
  sharedIds?: Set<number>,
): boolean {
  if (drama.teamId === teamId) return true
  if (sharedIds) return sharedIds.has(drama.id)
  return isDramaSharedWithTeam(drama.id, teamId)
}

export function userCanAccessDrama(
  drama: { id: number; teamId: number | null },
  user: AuthUser,
): boolean {
  if (user.role === 'admin') return true
  if (drama.teamId && userHasTeamAccess(user.id, drama.teamId)) return true
  const sharedTeamIds = getSharedTeamIds(drama.id)
  return sharedTeamIds.some(tid => userHasTeamAccess(user.id, tid))
}

export function userCanManageDrama(
  drama: { teamId: number | null },
  user: AuthUser,
): boolean {
  if (user.role === 'admin') return true
  if (!drama.teamId) return false
  return canManageTeamMembers(user.id, drama.teamId)
}

export function userCanManageDramaShares(
  drama: { teamId: number | null },
  user: AuthUser,
): boolean {
  return userCanManageDrama(drama, user)
}

export function userCanDeleteDrama(
  drama: { teamId: number | null },
  user: AuthUser,
): boolean {
  return userCanManageDrama(drama, user)
}

export function shareDramaWithTeam(
  dramaId: number,
  teamId: number,
  ownerTeamId: number | null,
) {
  if (!teamId || teamId === ownerTeamId) return
  if (isDramaSharedWithTeam(dramaId, teamId)) return
  db.insert(schema.dramaTeamShares).values({
    dramaId,
    teamId,
    createdAt: now(),
  }).run()
}

export function unshareDramaFromTeam(dramaId: number, teamId: number) {
  db.delete(schema.dramaTeamShares)
    .where(and(
      eq(schema.dramaTeamShares.dramaId, dramaId),
      eq(schema.dramaTeamShares.teamId, teamId),
    ))
    .run()
}

export function listAllTeamsDirectory(): { id: number; name: string }[] {
  return db.select({ id: schema.teams.id, name: schema.teams.name })
    .from(schema.teams)
    .all()
}

export function getOwnerTeamName(teamId: number | null): string | null {
  if (!teamId) return null
  const [team] = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).all()
  return team?.name ?? null
}
