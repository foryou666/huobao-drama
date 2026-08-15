const devApiTarget = process.env.NUXT_DEV_API_TARGET || 'http://localhost:5679'

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
const buildMetaPath = join(rootDir, 'app/generated/build-meta.json')
let buildTime = ''
if (existsSync(buildMetaPath)) {
  try {
    buildTime = JSON.parse(readFileSync(buildMetaPath, 'utf8')).buildTime || ''
  } catch {
    buildTime = ''
  }
}

export default defineNuxtConfig({
  srcDir: 'app/',
  ssr: false,
  devtools: { enabled: false },
  devServer: {
    host: '0.0.0.0',
    port: 3013,
  },
  experimental: {
    appManifest: false,
    // ssr:false 时若仍生成/请求 _payload.json，静态托管会回退 HTML，客户端 JSON 解析失败 → 500
    payloadExtraction: false,
  },
  nitro: {
    prerender: {
      crawlLinks: false,
      routes: ['/'],
    },
  },
  app: {
    head: {
      title: '影光工场',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon.png' },
        { rel: 'shortcut icon', type: 'image/png', href: '/favicon.png' },
      ],
    },
  },
  vite: {
    server: {
      proxy: {
        '/api': {
          target: devApiTarget,
          changeOrigin: true,
          // Agent 分镜拆解等长任务可能超过默认代理超时
          timeout: 600_000,
          proxyTimeout: 600_000,
        },
        '/static': { target: devApiTarget, changeOrigin: true },
      },
    },
  },
  compatibilityDate: '2025-05-15',
  runtimeConfig: {
    public: {
      appVersion: pkg.version || '0.0.0',
      buildTime: buildTime || (process.env.NODE_ENV === 'development' ? 'dev' : ''),
    },
  },
})
