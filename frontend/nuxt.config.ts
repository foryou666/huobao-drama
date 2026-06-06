const devApiTarget = process.env.NUXT_DEV_API_TARGET || 'http://localhost:5679'

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
  },
  app: {
    head: {
      title: '红果短剧',
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
})
