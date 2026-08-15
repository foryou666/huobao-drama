import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound, created } from '../utils/response.js'
import { getAuthUser } from '../middleware/auth.js'
import { assertDramaAdminAccess, assertDramaTeamAccess } from '../services/team-access.js'
import {
  previewScriptImport,
  commitScriptImport,
  startScriptImportExtract,
  listScriptImportAssets,
  generateScriptImportImages,
  getScriptImportStatus,
} from '../services/script-import.js'

const app = new Hono()

// POST /script-import/preview — 检测「第N集」并返回分集预览（不落库）
app.post('/preview', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  let text = String(body.script_text || body.text || '').trim()

  if (!text && body.file_base64) {
    try {
      text = Buffer.from(String(body.file_base64), 'base64').toString('utf8').trim()
    } catch {
      return badRequest(c, '文件解码失败')
    }
  }

  if (!text) return badRequest(c, '请粘贴或上传剧本正文')

  const result = previewScriptImport(text)
  if (!result.ok) return badRequest(c, result.reason || '无法分集')
  return success(c, result)
})

// POST /script-import/commit — 确认分集后创建项目并写入各集
app.post('/commit', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const result = commitScriptImport(c, {
      title: body.title,
      script_text: body.script_text || body.text || '',
      style: body.style,
      director_style: body.director_style,
      image_config_id: body.image_config_id,
      video_config_id: body.video_config_id,
      audio_config_id: body.audio_config_id,
      episodes: Array.isArray(body.episodes) ? body.episodes : undefined,
    })
    return created(c, result)
  } catch (err: any) {
    return badRequest(c, err?.message || '导入失败')
  }
})

// GET /script-import/:dramaId/status
app.get('/:dramaId/status', (c) => {
  const dramaId = Number(c.req.param('dramaId'))
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  if (!drama) return notFound(c, '项目不存在')
  const denied = assertDramaTeamAccess(c, drama)
  if (denied) return denied
  const status = getScriptImportStatus(dramaId)
  return success(c, status)
})

// POST /script-import/:dramaId/extract — 后台按集提取资产（仅文字）
app.post('/:dramaId/extract', (c) => {
  const dramaId = Number(c.req.param('dramaId'))
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  if (!drama) return notFound(c, '项目不存在')
  const denied = assertDramaAdminAccess(c, drama)
  if (denied) return denied
  try {
    startScriptImportExtract(dramaId, getAuthUser(c))
    return success(c, getScriptImportStatus(dramaId))
  } catch (err: any) {
    return badRequest(c, err?.message || '无法开始提取')
  }
})

// GET /script-import/:dramaId/assets — 提取结果预览
app.get('/:dramaId/assets', (c) => {
  const dramaId = Number(c.req.param('dramaId'))
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  if (!drama) return notFound(c, '项目不存在')
  const denied = assertDramaTeamAccess(c, drama)
  if (denied) return denied
  return success(c, {
    ...listScriptImportAssets(dramaId),
    script_import: getScriptImportStatus(dramaId)?.script_import || null,
  })
})

// POST /script-import/:dramaId/generate-images — 确认后生成缺图
app.post('/:dramaId/generate-images', async (c) => {
  const dramaId = Number(c.req.param('dramaId'))
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  if (!drama) return notFound(c, '项目不存在')
  const denied = assertDramaAdminAccess(c, drama)
  if (denied) return denied
  const body = await c.req.json().catch(() => ({}))
  try {
    const result = await generateScriptImportImages(c, dramaId, {
      character_ids: body.character_ids,
      scene_ids: body.scene_ids,
      prop_ids: body.prop_ids,
      only_missing: body.only_missing !== false,
    })
    if (result.error) return result.error
    return success(c, result)
  } catch (err: any) {
    return badRequest(c, err?.message || '生图失败')
  }
})

export default app
