import { createHash } from 'crypto'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { JIMENG_BASE_URL } from '../constants/jimeng-web.js'
import type { JimengWebSession } from './jimeng-web-session.js'
import { parseJimengCookiesForBrowser } from '../utils/jimeng-cookie.js'

const SCRIPT_WHITELIST_DOMAINS = [
  'vlabstatic.com',
  'bytescm.com',
  'jianying.com',
  'byteimg.com',
  'bytetos.com',
  'byteimg.com',
]

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'font', 'stylesheet', 'media'])
const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000
const BDMS_READY_TIMEOUT_MS = 30_000
const JIMENG_HOME = `${JIMENG_BASE_URL}/ai-tool/generate?type=video`

interface BrowserSession {
  context: BrowserContext
  page: Page
  lastUsed: number
  idleTimer: ReturnType<typeof setTimeout> | null
}

function sessionKey(session: JimengWebSession): string {
  const raw = session.cookie?.trim() || session.sessionId || 'default'
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

class JimengBrowserService {
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
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
        ],
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

  private async createSession(key: string, session: JimengWebSession): Promise<BrowserSession> {
    const browser = await this.ensureBrowser()
    const cookie = session.cookie?.trim()
    if (!cookie) {
      throw new Error('即梦 Session 缺少 Cookie，无法启动浏览器签名')
    }

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'zh-CN',
    })

    await context.addCookies(parseJimengCookiesForBrowser(cookie))

    await context.route('**/*', route => {
      const request = route.request()
      const resourceType = request.resourceType()
      const url = request.url()
      if (BLOCKED_RESOURCE_TYPES.has(resourceType)) return route.abort()
      if (resourceType === 'script') {
        const allowed = SCRIPT_WHITELIST_DOMAINS.some(domain => url.includes(domain))
        if (!allowed) return route.abort()
      }
      return route.continue()
    })

    const page = await context.newPage()
    await page.goto(JIMENG_HOME, { waitUntil: 'domcontentloaded', timeout: 30_000 })

    try {
      await page.waitForFunction(() => {
        const w = window as any
        return !!w.bdms?.init
          || !!w.byted_acrawler
          || !String(window.fetch).includes('[native code]')
      }, { timeout: BDMS_READY_TIMEOUT_MS })
    } catch {
      // bdms 偶发加载慢，仍尝试签名
    }

    const created: BrowserSession = {
      context,
      page,
      lastUsed: Date.now(),
      idleTimer: null,
    }
    this.resetIdleTimer(key, created)
    this.sessions.set(key, created)
    return created
  }

  private async getSession(session: JimengWebSession): Promise<BrowserSession> {
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
    try {
      await session.context.close()
    } catch { /* ignore */ }
    this.sessions.delete(key)
  }

  async fetch(
    session: JimengWebSession,
    url: string,
    options: {
      method?: string
      headers?: Record<string, string>
      body?: string
    },
  ): Promise<any> {
    const key = sessionKey(session)
    let browserSession = await this.getSession(session)

    try {
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
            return { ok: res.ok, status: res.status, text, finalUrl: res.url }
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

      if (result.error) {
        throw new Error(`浏览器签名请求失败: ${result.error}`)
      }

      let payload: any
      try {
        payload = JSON.parse(result.text)
      } catch {
        throw new Error(`即梦浏览器响应非 JSON (${result.status}): ${result.text.slice(0, 200)}`)
      }

      return payload
    } catch (err) {
      await this.closeSession(key)
      throw err
    }
  }

  async close() {
    for (const key of [...this.sessions.keys()]) {
      await this.closeSession(key)
    }
    if (this.browser) {
      try {
        await this.browser.close()
      } catch { /* ignore */ }
      this.browser = null
    }
  }
}

export const jimengBrowserService = new JimengBrowserService()
