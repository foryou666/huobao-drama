import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, '.output', 'public')
const target = path.join(root, 'dist')
const nuxtClientDir = path.join(root, '.nuxt', 'dist', 'client', '_nuxt')

if (!existsSync(source)) {
  console.error('Missing .output/public — run `npm run generate` first.')
  process.exit(1)
}

function listAssetDir(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
}

function resolveSpaEntryAssets() {
  const assetDirs = [
    path.join(target, '_nuxt'),
    nuxtClientDir,
  ]

  let entryCss = ''
  let entryJs = ''
  let largestJs = { name: '', size: 0 }

  for (const dir of assetDirs) {
    for (const name of listAssetDir(dir)) {
      const full = path.join(dir, name)
      if (name.startsWith('entry.') && name.endsWith('.css')) entryCss = name
      if (name.endsWith('.js')) {
        const size = statSync(full).size
        if (size > largestJs.size) largestJs = { name, size }
      }
    }
  }

  entryJs = largestJs.name
  if (!entryJs) {
    throw new Error('Unable to locate SPA entry JS in build output')
  }

  return {
    css: entryCss ? [`/_nuxt/${entryCss}`] : [],
    js: `/_nuxt/${entryJs}`,
  }
}

function isBrokenSpaHtml(html) {
  return html.includes('@vite/client')
    || html.includes('node_modules/nuxt/dist/app/entry.js')
}

function isMissingSpaEntry(html, assets) {
  const entry = assets.js.replace(/^\//, '')
  return !html.includes(`src="${assets.js}"`)
    && !html.includes(`src="/${entry}"`)
    && !html.includes(`href="${assets.js}"`)
}

function patchSpaHtml(html, assets) {
  const title = html.match(/<title>[^<]*<\/title>/)?.[0] || '<title>红果短剧</title>'
  const nuxtConfig = html.match(/<script>window\.__NUXT__=[\s\S]*?<\/script>/)?.[0] || ''
  const nuxtData = html.match(/<script type="application\/json" data-nuxt-data[\s\S]*?<\/script>/)?.[0] || ''
  const unhead = html.match(/<script id="unhead:payload"[\s\S]*?<\/script>/)?.[0] || ''
  const icons = [...html.matchAll(/<link rel="(?:icon|shortcut icon)"[^>]*>/g)].map(match => match[0]).join('\n')
  const cssLinks = assets.css.map(href => `<link rel="stylesheet" href="${href}" crossorigin>`).join('\n')

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${title}
${cssLinks}
<link rel="modulepreload" as="script" crossorigin href="${assets.js}">
<script type="module" src="${assets.js}" crossorigin></script>
${icons}
${unhead}</head><body><div id="__nuxt"></div><div id="teleports"></div>
${nuxtConfig}
${nuxtData}</body></html>`
}

function patchHtmlFiles(dir, assets) {
  let patched = 0
  for (const name of listAssetDir(dir)) {
    if (name === 'director-3d') continue
    const full = path.join(dir, name)
    if (name.endsWith('.html')) {
      const html = readFileSync(full, 'utf8')
      if (!isBrokenSpaHtml(html) && !isMissingSpaEntry(html, assets)) continue
      writeFileSync(full, patchSpaHtml(html, assets))
      patched += 1
      continue
    }
    if (statSync(full).isDirectory()) {
      patched += patchHtmlFiles(full, assets)
    }
  }
  return patched
}

rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })

const assets = resolveSpaEntryAssets()
const patched = patchHtmlFiles(target, assets)

const directorDeskPublic = path.join(root, 'public', 'director-3d')
const directorDeskTarget = path.join(target, 'director-3d')
if (existsSync(directorDeskPublic)) {
  cpSync(directorDeskPublic, directorDeskTarget, { recursive: true })
  console.log(`Copied 3D director desk -> ${directorDeskTarget}`)
}

console.log(`Synced ${source} -> ${target}`)
console.log(`Patched SPA HTML (${assets.js}) in ${patched} file(s)`)

// 纯 SPA：只保留根 index.html，避免 /tts/index.html 等带 prerender 元数据导致客户端 500
function removeNestedSpaHtml(dir) {
  let removed = 0
  for (const name of listAssetDir(dir)) {
    if (name === 'director-3d' || name === '_nuxt') continue
    const full = path.join(dir, name)
    if (!statSync(full).isDirectory()) continue
    const nested = path.join(full, 'index.html')
    if (existsSync(nested)) {
      rmSync(nested)
      removed += 1
    }
    removed += removeNestedSpaHtml(full)
  }
  return removed
}

const removed = removeNestedSpaHtml(target)
if (removed > 0) console.log(`Removed ${removed} nested route index.html (SPA fallback to /index.html)`)
