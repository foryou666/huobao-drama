/**
 * 将 Nuxt generate 产物 (.output/public) 同步到 backend 托管目录 (frontend/dist)
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const source = path.join(projectRoot, 'frontend', '.output', 'public')
const target = path.join(projectRoot, 'frontend', 'dist')

if (!fs.existsSync(source)) {
  console.error(`未找到构建产物: ${source}`)
  console.error('请先运行: cd frontend && npm run generate')
  process.exit(1)
}

fs.rmSync(target, { recursive: true, force: true })
fs.cpSync(source, target, { recursive: true })
console.log(`已同步前端静态资源 -> ${target}`)
