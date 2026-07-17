import { serve } from '@hono/node-server'
import 'dotenv/config'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

import dramas from './routes/dramas.js'
import episodes from './routes/episodes.js'
import storyboards from './routes/storyboards.js'
import scenes from './routes/scenes.js'
import characters from './routes/characters.js'
import images from './routes/images.js'
import videos from './routes/videos.js'
import jimeng from './routes/jimeng.js'
import xyq from './routes/xyq.js'
import doubaoTraining from './routes/doubao-training.js'
import upload from './routes/upload.js'
import aiConfigs, { aiProviders } from './routes/aiConfigs.js'
import agentConfigs from './routes/agentConfigs.js'
import agent from './routes/agent.js'
import compose from './routes/compose.js'
import merge from './routes/merge.js'
import grid from './routes/grid.js'
import skills from './routes/skills.js'
import prompts from './routes/prompts.js'
import webhooks from './routes/webhooks.js'
import aiVoices from './routes/aiVoices.js'
import { requestLogger, errorHandler } from './middleware/logger.js'
import { requireAuth, type AuthVariables } from './middleware/auth.js'
import auth from './routes/auth.js'
import users from './routes/users.js'
import activity from './routes/activity.js'
import portraits from './routes/portraits.js'
import assistant from './routes/assistant.js'
import credits from './routes/credits.js'
import assets from './routes/assets.js'
import media from './routes/media.js'
import teams from './routes/teams.js'
import payments from './routes/payments.js'
import repaint from './routes/repaint.js'
import narration from './routes/narration.js'
import tts from './routes/tts.js'
import subtitleRemover from './routes/subtitle-remover.js'
import canvas from './routes/canvas.js'
import { applyCreditPricingDefaultsIfNeeded, clampVideoCreditPricingToMinimum, applyXyqCreditPricingMigration, applyImage12CreditPricingMigration, applyNanoBanana2CreditPricingMigration, applyApimartImageCreditPricingMigration, applyApimartImageResolutionPricingMigration, migrateApimartPricingDisplayLabel, restoreVideoCreditPricingAfterFlat12 } from './services/credits.js'
import { migrateDefaultTeamIfNeeded } from './services/teams.js'
import { migrateChengmengBaseUrlIfNeeded, migrateChengmengApiKeyIfNeeded, migrateChengmengModelIdsIfNeeded } from './services/chengmeng-migrate.js'
import { resumeProcessingVideoTasks } from './services/video-generation.js'
import { resumeProcessingImageTasks } from './services/image-generation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

const app = new Hono()

function isAllowedOrigin(origin: string) {
  if (!origin) return true
  try {
    const url = new URL(origin)
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true
    if (url.hostname === 'ai.weikuaiche.cn' || url.hostname.endsWith('.weikuaiche.cn')) return true
    // 私有网段：10.x / 172.16-31.x / 192.168.x
    if (/^10\./.test(url.hostname)) return true
    if (/^192\.168\./.test(url.hostname)) return true
    const m = url.hostname.match(/^172\.(\d+)\./)
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true
  } catch { /* ignore */ }
  return false
}

// Middleware
app.use('*', cors({
  origin: (origin) => (isAllowedOrigin(origin) ? origin : 'http://localhost:3013'),
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization', 'X-Team-Id'],
}))
app.use('*', requestLogger)
app.use('*', errorHandler)

// Health check
app.get('/api/v1/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

// API routes
const api = new Hono<{ Variables: AuthVariables }>()

// Public
api.route('/auth', auth)
api.route('/payments', payments)

// Protected
api.use('/*', requireAuth)
api.route('/users', users)
api.route('/teams', teams)
api.route('/activity-logs', activity)
api.route('/portraits', portraits)
api.route('/dramas', dramas)
api.route('/episodes', episodes)
api.route('/storyboards', storyboards)
api.route('/scenes', scenes)
api.route('/characters', characters)
api.route('/credits', credits)
api.route('/assets', assets)
api.route('/media', media)
api.route('/images', images)
api.route('/jimeng', jimeng)
api.route('/xyq', xyq)
api.route('/doubao-training', doubaoTraining)
api.route('/videos', videos)
api.route('/repaint', repaint)
api.route('/narration', narration)
api.route('/tts', tts)
api.route('/subtitle-remover', subtitleRemover)
api.route('/canvas', canvas)
api.route('/upload', upload)
api.route('/ai-configs', aiConfigs)
api.route('/ai-providers', aiProviders)
api.route('/agent-configs', agentConfigs)
api.route('/agent', agent)
api.route('/assistant', assistant)
api.route('/compose', compose)
api.route('/merge', merge)
api.route('/grid', grid)
api.route('/skills', skills)
api.route('/prompts', prompts)
api.route('/ai-voices', aiVoices)

app.route('/api/v1', api)

// Webhook callbacks (Vidu, etc.) - outside /api/v1
app.route('/webhooks', webhooks)

// Serve static files (storage)
app.use('/static/*', serveStatic({ root: path.join(projectRoot, 'data') }))

// Serve frontend (production build)
const distPath = path.join(projectRoot, 'frontend', 'dist')
app.use('*', serveStatic({ root: distPath }))
app.get('*', serveStatic({ root: distPath, path: 'index.html' }))

const port = Number(process.env.PORT || 5679)
const host = process.env.HOST || '0.0.0.0'
applyCreditPricingDefaultsIfNeeded()
applyImage12CreditPricingMigration()
applyNanoBanana2CreditPricingMigration()
applyApimartImageCreditPricingMigration()
applyApimartImageResolutionPricingMigration()
migrateApimartPricingDisplayLabel()
restoreVideoCreditPricingAfterFlat12()
clampVideoCreditPricingToMinimum()
applyXyqCreditPricingMigration()
migrateDefaultTeamIfNeeded()
migrateChengmengBaseUrlIfNeeded()
migrateChengmengModelIdsIfNeeded()
migrateChengmengApiKeyIfNeeded()
resumeProcessingVideoTasks()
resumeProcessingImageTasks()

function getLanAddresses() {
  const addrs: string[] = []
  for (const iface of Object.values(os.networkInterfaces())) {
    if (!iface) continue
    for (const item of iface) {
      if (item.family === 'IPv4' && !item.internal) addrs.push(item.address)
    }
  }
  return addrs
}

console.log(`🚀 红果短剧 TS server on http://localhost:${port}`)
for (const ip of getLanAddresses()) {
  console.log(`   局域网: http://${ip}:${port}`)
}
serve({ fetch: app.fetch, port, hostname: host })
