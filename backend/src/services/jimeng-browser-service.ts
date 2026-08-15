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
]

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'font', 'stylesheet', 'media'])
const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000
const BDMS_READY_TIMEOUT_MS = 30_000
const JIMENG_HOME = `${JIMENG_BASE_URL}/ai-tool/generate?type=video`
const FETCH_MAX_ATTEMPTS = 2

interface BrowserSession {
  context: BrowserContext
  page: Page
  lastUsed: number
  idleTimer: ReturnType<typeof setTimeout> | null
  /** 进行中的 evaluate 数量；>0 时禁止 idle 关闭 */
  inFlight: number
}

function sessionKey(session: JimengWebSession): string {
  const raw = session.cookie?.trim() || session.sessionId || 'default'
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

function isClosedBrowserError(err: unknown): boolean {
  const message = String((err as Error)?.message || err || '')
  return /Target page, context or browser has been closed|Browser has been closed|Session closed|Protocol error.*Target closed/i.test(message)
}

function isPageAlive(page: Page | null | undefined): boolean {
  try {
    return !!page && !page.isClosed()
  } catch {
    return false
  }
}

class JimengBrowserService {
  private browser: Browser | null = null
  private sessions = new Map<string, BrowserSession>()
  private launching: Promise<Browser> | null = null
  /** 同一 Session 串行化，避免共用 page.evaluate 互相踩踏 */
  private fetchChains = new Map<string, Promise<unknown>>()
  private createChains = new Map<string, Promise<BrowserSession>>()

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
      const launchOptions: Parameters<typeof chromium.launch>[0] = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
        ],
      }
      const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim()
      if (executablePath) launchOptions.executablePath = executablePath

      try {
        this.browser = await chromium.launch(launchOptions)
      } catch (err: any) {
        const message = String(err?.message || err || '')
        if (/libatk|shared libraries|chrome-headless-shell/i.test(message)) {
          throw new Error(
            'Playwright Chromium 缺少系统依赖。请在服务器 backend 目录执行: npx playwright-core install-deps chromium',
          )
        }
        throw err
      }
      this.browser.on('disconnected', () => {
        this.browser = null
        for (const session of this.sessions.values()) {
          if (session.idleTimer) clearTimeout(session.idleTimer)
        }
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
      const current = this.sessions.get(key)
      if (!current || current !== session) return
      if (current.inFlight > 0) {
        this.resetIdleTimer(key, current)
        return
      }
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
      inFlight: 0,
    }
    this.resetIdleTimer(key, created)
    this.sessions.set(key, created)
    return created
  }

  private async getOrCreateSession(session: JimengWebSession, forceNew = false): Promise<BrowserSession> {
    const key = sessionKey(session)
    if (!forceNew) {
      const existing = this.sessions.get(key)
      if (existing && isPageAlive(existing.page)) {
        this.resetIdleTimer(key, existing)
        return existing
      }
      if (existing) {
        await this.closeSession(key)
      }
    } else {
      await this.closeSession(key)
    }

    const pending = this.createChains.get(key)
    if (pending) return pending

    const creating = this.createSession(key, session).finally(() => {
      if (this.createChains.get(key) === creating) this.createChains.delete(key)
    })
    this.createChains.set(key, creating)
    return creating
  }

  private async closeSession(key: string) {
    const session = this.sessions.get(key)
    if (!session) return
    if (session.idleTimer) clearTimeout(session.idleTimer)
    this.sessions.delete(key)
    try {
      await session.context.close()
    } catch { /* ignore */ }
  }

  private async runEvaluate(
    browserSession: BrowserSession,
    url: string,
    options: {
      method?: string
      headers?: Record<string, string>
      body?: string
    },
  ) {
    return browserSession.page.evaluate(
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
  }

  private async fetchOnce(
    session: JimengWebSession,
    url: string,
    options: {
      method?: string
      headers?: Record<string, string>
      body?: string
    },
    forceNewSession: boolean,
  ): Promise<any> {
    const key = sessionKey(session)
    const browserSession = await this.getOrCreateSession(session, forceNewSession)
    browserSession.inFlight += 1
    this.resetIdleTimer(key, browserSession)
    try {
      if (!isPageAlive(browserSession.page)) {
        throw new Error('Target page, context or browser has been closed')
      }
      const result = await this.runEvaluate(browserSession, url, options)

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
    } finally {
      browserSession.inFlight = Math.max(0, browserSession.inFlight - 1)
      if (this.sessions.get(key) === browserSession) {
        this.resetIdleTimer(key, browserSession)
      }
    }
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
    const prev = this.fetchChains.get(key) || Promise.resolve()
    const run = prev.catch(() => {}).then(async () => {
      let lastError: unknown
      for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt++) {
        try {
          return await this.fetchOnce(session, url, options, attempt > 1)
        } catch (err) {
          lastError = err
          if (!isClosedBrowserError(err) || attempt >= FETCH_MAX_ATTEMPTS) {
            throw err
          }
          await this.closeSession(key)
        }
      }
      throw lastError
    })
    this.fetchChains.set(key, run)
    try {
      return await run
    } finally {
      if (this.fetchChains.get(key) === run) this.fetchChains.delete(key)
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
