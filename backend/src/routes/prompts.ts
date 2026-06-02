import { Hono } from 'hono'
import { success } from '../utils/response.js'
import { DIRECTOR_STYLE_META } from '../prompts/director-styles.js'

const app = new Hono()

// GET /prompts/director-styles
app.get('/director-styles', (c) => {
  return success(c, { items: DIRECTOR_STYLE_META, default: 'hongguo_director' })
})

export default app
