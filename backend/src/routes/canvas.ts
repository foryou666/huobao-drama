import { Hono } from 'hono'
import { eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { getAuthUser, type AuthVariables } from '../middleware/auth.js'
import {
  assertDramaAdminAccess,
  assertDramaTeamAccess,
  loadDramaById,
  resolveActiveTeamId,
} from '../services/team-access.js'
import {
  createNoteNode,
  createOrRestoreBoard,
  ensureBoardFocusEpisode,
  ensureBoardForDrama,
  ensureBoardsForAccessibleDramas,
  getBoardByDramaId,
  getBoardById,
  getCanvasStudioContext,
  importNodes,
  listAccessibleBoards,
  listDramaPool,
  loadBoardDetailSynced,
  replaceBoardLayout,
  serializeBoardDetail,
  setBoardFocusEpisode,
  softDeleteNode,
  syncBoardFromDrama,
} from '../services/canvas-boards.js'
import {
  badRequest,
  created,
  notFound,
  now,
  success,
} from '../utils/response.js'
import { ensureMissingNarrationLinkedDramas } from '../services/narration-drama-link.js'

const app = new Hono<{ Variables: AuthVariables }>()

function loadBoardWithDrama(boardId: number) {
  const board = getBoardById(boardId)
  if (!board || board.deletedAt) return { board: null, drama: null }
  const drama = loadDramaById(board.dramaId)
  return { board, drama }
}

function assertBoardAccess(c: any, boardId: number) {
  const { board, drama } = loadBoardWithDrama(boardId)
  if (!board) return { board: null, drama: null, error: notFound(c, '画布不存在') }
  if (!drama || drama.deletedAt) {
    return { board, drama, error: notFound(c, '关联项目不存在或已删除') }
  }
  const denied = assertDramaTeamAccess(c, drama)
  if (denied) return { board, drama, error: denied }
  return { board, drama, error: null }
}

// GET /canvas/boards — 与项目列表同步：自动为缺失画布的项目补齐
app.get('/boards', async (c) => {
  const user = getAuthUser(c)
  const activeTeamId = resolveActiveTeamId(c, user)
  ensureMissingNarrationLinkedDramas({
    userId: user.role === 'admin' ? null : user.id,
    teamId: activeTeamId,
  })
  ensureBoardsForAccessibleDramas(user, activeTeamId)
  const items = await listAccessibleBoards(user, activeTeamId)
  return success(c, { items })
})

// POST /canvas/boards — 必须选项目；一剧一板（已存在则恢复/返回）
app.post('/boards', async (c) => {
  const user = getAuthUser(c)
  const body = await c.req.json().catch(() => ({}))
  const dramaId = Number(body.drama_id)
  if (!dramaId) return badRequest(c, '创建画布必须选择项目（drama_id）')

  const drama = loadDramaById(dramaId)
  if (!drama || drama.deletedAt) return notFound(c, '项目不存在')
  const denied = assertDramaTeamAccess(c, drama)
  if (denied) return denied

  const existing = getBoardByDramaId(dramaId)
  if (existing) {
    const detail = loadBoardDetailSynced(existing.id)
    return success(c, detail)
  }

  const title = String(body.title || '').trim() || `${drama.title} · 画布`
  const board = createOrRestoreBoard({
    dramaId,
    title,
    teamId: drama.teamId,
    createdBy: user.id,
  })
  syncBoardFromDrama(board.id, dramaId)
  return created(c, serializeBoardDetail(getBoardById(board.id)!))
})

// GET /canvas/boards/by-drama/:dramaId — get-or-create，并同步项目实体上板
app.get('/boards/by-drama/:dramaId', async (c) => {
  const user = getAuthUser(c)
  const dramaId = Number(c.req.param('dramaId'))
  const drama = loadDramaById(dramaId)
  if (!drama || drama.deletedAt) return notFound(c, '项目不存在')
  const denied = assertDramaTeamAccess(c, drama)
  if (denied) return denied

  const board = ensureBoardForDrama(drama, user.id, { syncNodes: false })
  const detail = loadBoardDetailSynced(board.id)
  return success(c, detail)
})

// GET /canvas/boards/:id — 打开时自动把项目缺失实体同步上板
app.get('/boards/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const { board, error } = assertBoardAccess(c, id)
  if (error) return error
  return success(c, loadBoardDetailSynced(board!.id))
})

// POST /canvas/boards/:id/sync — 手动同步「当前聚焦集」实体上板
app.post('/boards/:id/sync', async (c) => {
  const id = Number(c.req.param('id'))
  const { board, error } = assertBoardAccess(c, id)
  if (error) return error
  const body = await c.req.json().catch(() => ({}))
  const focusId = ensureBoardFocusEpisode(board!.id)
  const createdNodes = syncBoardFromDrama(board!.id, board!.dramaId, {
    reviveRemoved: body.revive_removed === true || body.reviveRemoved === true,
    episodeId: focusId,
  })
  return success(c, {
    ...serializeBoardDetail(getBoardById(board!.id)!),
    synced_count: createdNodes.length,
  })
})

// PATCH /canvas/boards/:id
app.patch('/boards/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const { board, drama, error } = assertBoardAccess(c, id)
  if (error) return error
  const body = await c.req.json().catch(() => ({}))
  const patch: Record<string, unknown> = { updatedAt: now() }
  if (body.title != null) {
    const title = String(body.title).trim()
    if (!title) return badRequest(c, '标题不能为空')
    patch.title = title
  }
  if (body.viewport != null) {
    patch.viewportJson = JSON.stringify(body.viewport)
  }
  const focusRaw = body.focus_episode_id ?? body.focusEpisodeId
  if (focusRaw !== undefined) {
    const focusId = Number(focusRaw)
    if (!focusId) return badRequest(c, 'focus_episode_id 无效')
    try {
      setBoardFocusEpisode(board!.id, focusId)
    } catch (err: any) {
      return badRequest(c, err?.message || '切换集失败')
    }
    // 切集后自动同步该集实体上板（不删其他集已存节点）
    syncBoardFromDrama(board!.id, board!.dramaId, { episodeId: focusId })
    return success(c, serializeBoardDetail(getBoardById(board!.id)!))
  }
  db.update(schema.canvasBoards).set(patch)
    .where(eq(schema.canvasBoards.id, board!.id)).run()
  return success(c, serializeBoardDetail(getBoardById(board!.id)!))
})

// DELETE /canvas/boards/:id — 仅删画布，不删项目
app.delete('/boards/:id', async (c) => {
  // 画布与项目 1:1 同步，不允许单独删除画布
  return badRequest(c, '画布与项目同步，请在项目列表中删除项目')
})

// GET /canvas/boards/:id/pool — 当前聚焦集的实体池
app.get('/boards/:id/pool', async (c) => {
  const id = Number(c.req.param('id'))
  const { board, error } = assertBoardAccess(c, id)
  if (error) return error
  const q = c.req.query('episode_id')
  const focusId = q != null && q !== ''
    ? Number(q)
    : ensureBoardFocusEpisode(board!.id)
  return success(c, listDramaPool(board!.dramaId, focusId))
})

// GET /canvas/boards/:id/studio — 画布生产线上下文（流水线步骤 + 资产完成度）
app.get('/boards/:id/studio', async (c) => {
  const id = Number(c.req.param('id'))
  const { board, error } = assertBoardAccess(c, id)
  if (error) return error
  const ctx = getCanvasStudioContext(board!.id)
  if (!ctx) return notFound(c, '画布不存在')
  return success(c, ctx)
})

// PUT /canvas/boards/:id/layout
app.put('/boards/:id/layout', async (c) => {
  const id = Number(c.req.param('id'))
  const { board, error } = assertBoardAccess(c, id)
  if (error) return error
  const body = await c.req.json().catch(() => ({}))
  try {
    const updated = replaceBoardLayout(
      board!.id,
      {
        viewport: body.viewport,
        nodes: body.nodes,
        edges: body.edges,
      },
      body.base_updated_at ?? body.baseUpdatedAt,
    )
    return success(c, serializeBoardDetail(updated))
  } catch (err: any) {
    if (err?.code === 409) {
      return c.json({ code: 409, message: err.message }, 409)
    }
    return badRequest(c, err?.message || '保存布局失败')
  }
})

// POST /canvas/boards/:id/nodes/import
app.post('/boards/:id/nodes/import', async (c) => {
  const id = Number(c.req.param('id'))
  const { board, error } = assertBoardAccess(c, id)
  if (error) return error
  const body = await c.req.json().catch(() => ({}))
  const refs = Array.isArray(body.refs) ? body.refs : []
  if (!refs.length) return badRequest(c, 'refs 不能为空')
  importNodes(board!.id, refs, board!.dramaId)
  return success(c, serializeBoardDetail(getBoardById(board!.id)!))
})

// POST /canvas/boards/:id/nodes/note
app.post('/boards/:id/nodes/note', async (c) => {
  const id = Number(c.req.param('id'))
  const { board, error } = assertBoardAccess(c, id)
  if (error) return error
  const body = await c.req.json().catch(() => ({}))
  createNoteNode(
    board!.id,
    String(body.text || ''),
    Number(body.x) || 120,
    Number(body.y) || 120,
  )
  return success(c, serializeBoardDetail(getBoardById(board!.id)!))
})

// DELETE /canvas/boards/:id/nodes/:nodeKey — 只删节点，不删项目实体
app.delete('/boards/:id/nodes/:nodeKey', async (c) => {
  const id = Number(c.req.param('id'))
  const nodeKey = String(c.req.param('nodeKey') || '')
  const { board, error } = assertBoardAccess(c, id)
  if (error) return error
  if (!softDeleteNode(board!.id, nodeKey)) return notFound(c, '节点不存在')
  return success(c, serializeBoardDetail(getBoardById(board!.id)!))
})

// GET /canvas/dramas-without-board — 创建弹窗：可选且尚未建板的项目
app.get('/dramas-without-board', async (c) => {
  const user = getAuthUser(c)
  const activeTeamId = resolveActiveTeamId(c, user)
  const boards = await listAccessibleBoards(user, activeTeamId)
  const taken = new Set(boards.map(b => Number(b.drama_id)))

  let dramas = db.select().from(schema.dramas)
    .where(isNull(schema.dramas.deletedAt)).all()
  if (activeTeamId != null) {
    const { dramaVisibleToTeam, getSharedDramaIdsByTeam } = await import('../services/drama-shares.js')
    const sharedIds = getSharedDramaIdsByTeam(activeTeamId)
    dramas = dramas.filter(d => dramaVisibleToTeam(d, activeTeamId, sharedIds))
  }

  const items = dramas
    .filter(d => !taken.has(d.id))
    .map(d => ({ id: d.id, title: d.title, status: d.status }))
  return success(c, { items })
})

export default app
