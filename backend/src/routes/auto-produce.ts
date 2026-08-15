import { Hono } from 'hono'
import { badRequest, created, success } from '../utils/response.js'
import { getAuthUser } from '../middleware/auth.js'
import {
  createAutoProduceJob,
  getAutoProduceJob,
  listAutoProduceJobs,
} from '../services/auto-produce.js'

const app = new Hono()

/** POST /auto-produce/jobs — 创建一键出片任务 */
app.post('/jobs', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const title = String(body.title || '').trim()
  const scriptText = String(body.script_text || body.scriptText || '').trim()
  if (!title) return badRequest(c, '请填写项目名称')
  if (!scriptText) return badRequest(c, '请粘贴剧本内容')

  try {
    const job = createAutoProduceJob(c, {
      title,
      script_text: scriptText,
      options: {
        clipCount: body.clip_count ?? body.clipCount,
        durationSec: body.duration_sec ?? body.durationSec,
        aspectRatio: body.aspect_ratio ?? body.aspectRatio,
        dialogueLock: body.dialogue_lock ?? body.dialogueLock,
        generateImages: body.generate_images ?? body.generateImages,
        directorStyle: body.director_style ?? body.directorStyle,
      },
    })
    return created(c, job)
  } catch (err: any) {
    return badRequest(c, err?.message || '创建任务失败')
  }
})

/** GET /auto-produce/jobs — 我的任务列表 */
app.get('/jobs', async (c) => {
  const user = getAuthUser(c)
  if (!user) return badRequest(c, '未登录')
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') || 20)))
  return success(c, { items: listAutoProduceJobs(user.id, limit) })
})

/** GET /auto-produce/jobs/:id */
app.get('/jobs/:id', async (c) => {
  const user = getAuthUser(c)
  if (!user) return badRequest(c, '未登录')
  const job = getAutoProduceJob(c.req.param('id'), user.id)
  if (!job) return badRequest(c, '任务不存在')
  return success(c, job)
})

export default app
