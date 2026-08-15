import { eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { listCreditPricing } from './credits.js'
import { listTeamMembers } from './teams.js'

export interface TeamStatsOptions {
  teamId: number
  dateFrom?: string
  dateTo?: string
  userId?: number
}

export interface DailyWorkload {
  date: string
  activities: number
  credits_consumed: number
  images: number
  videos: number
  /** 净扣积分的视频次数（charge − refund） */
  videos_effective: number
  agent_runs: number
}

export interface MemberActionBreakdown {
  action: string
  label: string
  count: number
  credits: number
}

export interface MemberPeriodStats {
  credits_consumed: number
  credits_refunded: number
  credits_granted: number
  activity_count: number
  dramas_touched: number
  episodes_touched: number
  images: number
  /** 活动日志中的视频生成次数（含失败后退款） */
  videos: number
  /** 净扣积分的视频次数（成功扣费且未退回） */
  videos_effective: number
  agent_runs: number
  assistant_chats: number
}

export interface MemberStatsRow {
  user_id: number
  username: string
  display_name: string
  role: string
  credits_balance: number
  last_active_at: string | null
  period: MemberPeriodStats
  by_action: MemberActionBreakdown[]
  daily: DailyWorkload[]
}

const IMAGE_ACTION_PREFIXES = [
  'image.generate',
  'character.image',
  'scene.image',
  'storyboard.blocking',
  'grid.generate',
]

function formatDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function parseDateRange(dateFrom?: string, dateTo?: string) {
  const end = dateTo ? new Date(`${dateTo}T23:59:59.999`) : new Date()
  const start = dateFrom
    ? new Date(`${dateFrom}T00:00:00.000`)
    : new Date(end.getTime() - 6 * 86_400_000)
  return {
    from: start,
    to: end,
    date_from: formatDay(start),
    date_to: formatDay(end),
  }
}

function inRange(iso: string, from: Date, to: Date): boolean {
  const t = new Date(iso).getTime()
  return t >= from.getTime() && t <= to.getTime()
}

function dayKey(iso: string): string {
  return iso.slice(0, 10)
}

function isImageAction(action: string): boolean {
  return IMAGE_ACTION_PREFIXES.some(prefix => action === prefix || action.startsWith(`${prefix}.`))
    || action.startsWith('character.image')
    || action.startsWith('scene.image')
}

function isVideoAction(action: string): boolean {
  return action.startsWith('video.generate')
}

function emptyDailyRow(date: string): DailyWorkload {
  return {
    date,
    activities: 0,
    credits_consumed: 0,
    images: 0,
    videos: 0,
    videos_effective: 0,
    agent_runs: 0,
  }
}

function emptyDailyMap(): Map<string, DailyWorkload> {
  return new Map()
}

function bumpDaily(map: Map<string, DailyWorkload>, iso: string, patch: Partial<DailyWorkload>) {
  const key = dayKey(iso)
  const row = map.get(key) || emptyDailyRow(key)
  if (patch.activities) row.activities += patch.activities
  if (patch.credits_consumed != null) row.credits_consumed += patch.credits_consumed
  if (patch.images) row.images += patch.images
  if (patch.videos) row.videos += patch.videos
  if (patch.videos_effective != null) row.videos_effective += patch.videos_effective
  if (patch.agent_runs) row.agent_runs += patch.agent_runs
  map.set(key, row)
}

function fillDailyRange(map: Map<string, DailyWorkload>, from: string, to: string): DailyWorkload[] {
  const out: DailyWorkload[] = []
  const cursor = new Date(`${from}T00:00:00.000`)
  const end = new Date(`${to}T00:00:00.000`)
  while (cursor <= end) {
    const key = formatDay(cursor)
    out.push(map.get(key) || emptyDailyRow(key))
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

export function getTeamStats(opts: TeamStatsOptions) {
  const range = parseDateRange(opts.dateFrom, opts.dateTo)
  const members = listTeamMembers(opts.teamId)
  let targetMembers = members
  if (opts.userId) {
    targetMembers = members.filter(m => m.user_id === opts.userId)
  }
  const memberIds = targetMembers.map(m => m.user_id)
  if (!memberIds.length) {
    return {
      team_id: opts.teamId,
      date_from: range.date_from,
      date_to: range.date_to,
      summary: {
        total_consumed: 0,
        total_refunded: 0,
        total_granted: 0,
        total_activities: 0,
        active_members: 0,
        total_images: 0,
        total_videos: 0,
        total_videos_effective: 0,
        total_agent_runs: 0,
      },
      daily: fillDailyRange(emptyDailyMap(), range.date_from, range.date_to),
      members: [] as MemberStatsRow[],
    }
  }

  const pricing = new Map(listCreditPricing().map(item => [item.action, item.label]))
  const users = db.select().from(schema.users).where(inArray(schema.users.id, memberIds)).all()
  const userMap = new Map(users.map(u => [u.id, u]))

  const activities = db.select().from(schema.activityLogs)
    .where(inArray(schema.activityLogs.userId, memberIds))
    .all()
    .filter(row => inRange(row.createdAt, range.from, range.to))

  const transactions = db.select().from(schema.creditTransactions)
    .where(inArray(schema.creditTransactions.userId, memberIds))
    .all()
    .filter(row => inRange(row.createdAt, range.from, range.to))

  const teamDaily = emptyDailyMap()
  const memberRows: MemberStatsRow[] = []

  for (const member of targetMembers) {
    const userId = member.user_id
    const user = userMap.get(userId)
    const memberActs = activities.filter(a => a.userId === userId)
    const memberTx = transactions.filter(t => t.userId === userId)
    const memberDaily = emptyDailyMap()
    const actionMap = new Map<string, MemberActionBreakdown>()

    let creditsConsumed = 0
    let creditsRefunded = 0
    let creditsGranted = 0
    let images = 0
    let videos = 0
    let videoCharges = 0
    let videoRefunds = 0
    let agentRuns = 0
    let assistantChats = 0
    const dramaIds = new Set<number>()
    const episodeIds = new Set<number>()
    let lastActiveAt: string | null = null

    for (const tx of memberTx) {
      if (tx.type === 'charge') {
        const spent = Math.abs(tx.amount)
        creditsConsumed += spent
        bumpDaily(memberDaily, tx.createdAt, { credits_consumed: spent })
        bumpDaily(teamDaily, tx.createdAt, { credits_consumed: spent })
        const entry = actionMap.get(tx.action) || {
          action: tx.action,
          label: pricing.get(tx.action) || tx.action,
          count: 0,
          credits: 0,
        }
        entry.credits += spent
        actionMap.set(tx.action, entry)
        if (isVideoAction(tx.action) && spent > 0) {
          videoCharges += 1
          bumpDaily(memberDaily, tx.createdAt, { videos_effective: 1 })
          bumpDaily(teamDaily, tx.createdAt, { videos_effective: 1 })
        }
      } else if (tx.type === 'refund') {
        const refunded = Math.max(0, tx.amount)
        creditsRefunded += refunded
        creditsConsumed -= refunded
        bumpDaily(memberDaily, tx.createdAt, { credits_consumed: -refunded })
        bumpDaily(teamDaily, tx.createdAt, { credits_consumed: -refunded })
        const entry = actionMap.get(tx.action) || {
          action: tx.action,
          label: pricing.get(tx.action) || tx.action,
          count: 0,
          credits: 0,
        }
        entry.credits -= refunded
        actionMap.set(tx.action, entry)
        if (isVideoAction(tx.action) && refunded > 0) {
          videoRefunds += 1
          bumpDaily(memberDaily, tx.createdAt, { videos_effective: -1 })
          bumpDaily(teamDaily, tx.createdAt, { videos_effective: -1 })
        }
      } else if (tx.type === 'grant') {
        creditsGranted += Math.max(0, tx.amount)
      }
    }

    for (const act of memberActs) {
      bumpDaily(memberDaily, act.createdAt, { activities: 1 })
      bumpDaily(teamDaily, act.createdAt, { activities: 1 })
      if (!lastActiveAt || act.createdAt > lastActiveAt) lastActiveAt = act.createdAt
      if (act.dramaId) dramaIds.add(act.dramaId)
      if (act.episodeId) episodeIds.add(act.episodeId)

      const entry = actionMap.get(act.action) || {
        action: act.action,
        label: pricing.get(act.action) || act.action,
        count: 0,
        credits: 0,
      }
      entry.count += 1
      actionMap.set(act.action, entry)

      if (isImageAction(act.action)) {
        images += 1
        bumpDaily(memberDaily, act.createdAt, { images: 1 })
        bumpDaily(teamDaily, act.createdAt, { images: 1 })
      }
      if (isVideoAction(act.action)) {
        videos += 1
        bumpDaily(memberDaily, act.createdAt, { videos: 1 })
        bumpDaily(teamDaily, act.createdAt, { videos: 1 })
      }
      if (act.action === 'agent.run') {
        agentRuns += 1
        bumpDaily(memberDaily, act.createdAt, { agent_runs: 1 })
        bumpDaily(teamDaily, act.createdAt, { agent_runs: 1 })
      }
      if (act.action === 'assistant.chat') assistantChats += 1
    }

    const videosEffective = Math.max(0, videoCharges - videoRefunds)

    memberRows.push({
      user_id: userId,
      username: member.username,
      display_name: member.display_name || member.username,
      role: member.role,
      credits_balance: user?.creditsBalance ?? 0,
      last_active_at: lastActiveAt,
      period: {
        credits_consumed: creditsConsumed,
        credits_refunded: creditsRefunded,
        credits_granted: creditsGranted,
        activity_count: memberActs.length,
        dramas_touched: dramaIds.size,
        episodes_touched: episodeIds.size,
        images,
        videos,
        videos_effective: videosEffective,
        agent_runs: agentRuns,
        assistant_chats: assistantChats,
      },
      by_action: [...actionMap.values()]
        .sort((a, b) => b.credits - a.credits || b.count - a.count),
      daily: fillDailyRange(memberDaily, range.date_from, range.date_to).map(day => ({
        ...day,
        videos_effective: Math.max(0, day.videos_effective),
      })),
    })
  }

  memberRows.sort((a, b) => b.period.credits_consumed - a.period.credits_consumed
    || b.period.activity_count - a.period.activity_count)

  const summary = memberRows.reduce((acc, row) => {
    acc.total_consumed += row.period.credits_consumed
    acc.total_refunded += row.period.credits_refunded
    acc.total_granted += row.period.credits_granted
    acc.total_activities += row.period.activity_count
    if (row.period.activity_count > 0) acc.active_members += 1
    acc.total_images += row.period.images
    acc.total_videos += row.period.videos
    acc.total_videos_effective += row.period.videos_effective
    acc.total_agent_runs += row.period.agent_runs
    return acc
  }, {
    total_consumed: 0,
    total_refunded: 0,
    total_granted: 0,
    total_activities: 0,
    active_members: 0,
    total_images: 0,
    total_videos: 0,
    total_videos_effective: 0,
    total_agent_runs: 0,
  })

  const [team] = db.select().from(schema.teams).where(eq(schema.teams.id, opts.teamId)).all()

  return {
    team_id: opts.teamId,
    team_name: team?.name || '',
    date_from: range.date_from,
    date_to: range.date_to,
    summary,
    daily: fillDailyRange(teamDaily, range.date_from, range.date_to).map(day => ({
      ...day,
      videos_effective: Math.max(0, day.videos_effective),
    })),
    members: memberRows,
  }
}
