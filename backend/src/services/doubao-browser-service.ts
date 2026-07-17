import { createHash } from 'crypto'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { DOUBAO_TRAINING_CREATE_VIDEO_URL } from '../constants/doubao-training.js'
import type { DoubaoTrainingSession } from './doubao-training-session.js'
import { parseDoubaoCookiesForBrowser } from '../utils/doubao-cookie.js'

/** 与官网「创建视频」页一致，签名/风控上下文更贴近真实提交 */
const DOUBAO_HOME = DOUBAO_TRAINING_CREATE_VIDEO_URL
const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000
const BDMS_READY_TIMEOUT_MS = 30_000

interface BrowserSession {
  context: BrowserContext
  page: Page
  lastUsed: number
  idleTimer: ReturnType<typeof setTimeout> | null
}

function sessionKey(session: DoubaoTrainingSession): string {
  const raw = session.cookie?.trim() || session.sessionId || 'default'
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

class DoubaoBrowserService {
  private browser: Browser | null = null
  private sessions = new Map<string, BrowserSession>()
  private launching: Promise<Browser> | null = null

  private async loadPlaywright() {
    try {
      return await import('playwright-core')
    } catch {
      throw new Error(
        '未安装 playwright-core。请在 backend 目录执行: npm install && npx playwright-core install chromium',
      )
    }
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser
    if (this.launching) return this.launching
    this.launching = (async () => {
      const { chromium } = await this.loadPlaywright()
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run'],
      })
      this.browser.on('disconnected', () => {
        this.browser = null
        this.sessions.clear()
      })
      return this.browser
    })()
    try {
      return await this.launching
    } finally {
      this.launching = null
    }
  }

  private resetIdleTimer(key: string, session: BrowserSession) {
    session.lastUsed = Date.now()
    if (session.idleTimer) clearTimeout(session.idleTimer)
    session.idleTimer = setTimeout(() => {
      this.closeSession(key).catch(() => {})
    }, SESSION_IDLE_TIMEOUT_MS)
  }

  private async createSession(key: string, session: DoubaoTrainingSession): Promise<BrowserSession> {
    const browser = await this.ensureBrowser()
    const cookie = session.cookie?.trim()
    if (!cookie) {
      throw new Error('豆包 Session 缺少完整 Cookie，无法启动浏览器签名')
    }

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'zh-CN',
    })
    await context.addCookies(parseDoubaoCookiesForBrowser(cookie))
    const page = await context.newPage()
    await page.goto(DOUBAO_HOME, { waitUntil: 'domcontentloaded', timeout: 45_000 })

    try {
      await page.waitForFunction(() => {
        const w = window as any
        return !!w.bdms?.init || !!w.byted_acrawler || !String(window.fetch).includes('[native code]')
      }, { timeout: BDMS_READY_TIMEOUT_MS })
    } catch { /* continue */ }

    const created: BrowserSession = { context, page, lastUsed: Date.now(), idleTimer: null }
    this.resetIdleTimer(key, created)
    this.sessions.set(key, created)
    return created
  }

  private async getSession(session: DoubaoTrainingSession): Promise<BrowserSession> {
    const key = sessionKey(session)
    const existing = this.sessions.get(key)
    if (existing) {
      this.resetIdleTimer(key, existing)
      return existing
    }
    return this.createSession(key, session)
  }

  private async closeSession(key: string) {
    const session = this.sessions.get(key)
    if (!session) return
    if (session.idleTimer) clearTimeout(session.idleTimer)
    try { await session.context.close() } catch { /* ignore */ }
    this.sessions.delete(key)
  }

  async fetch(
    session: DoubaoTrainingSession,
    url: string,
    options: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ ok: boolean; status: number; text: string; error?: string }> {
    const browserSession = await this.getSession(session)
    const result = await browserSession.page.evaluate(
      async ({ targetUrl, reqOptions }) => {
        try {
          const res = await fetch(targetUrl, {
            method: reqOptions.method || 'POST',
            headers: reqOptions.headers || {},
            body: reqOptions.body,
            credentials: 'include',
          })
          const text = await res.text()
          return { ok: res.ok, status: res.status, text }
        } catch (err: any) {
          return { ok: false, status: 0, text: '', error: err?.message || String(err) }
        }
      },
      {
        targetUrl: url,
        reqOptions: {
          method: options.method || 'POST',
          headers: options.headers || {},
          body: options.body,
        },
      },
    )
    if (result.error) throw new Error(result.error)
    return result
  }
}

export const doubaoBrowserService = new DoubaoBrowserService()
