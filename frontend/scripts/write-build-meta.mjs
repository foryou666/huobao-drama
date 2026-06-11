import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const outDir = path.join(root, 'app', 'generated')
const buildTime = new Date().toISOString().replace('T', ' ').slice(0, 19)

mkdirSync(outDir, { recursive: true })
writeFileSync(
  path.join(outDir, 'build-meta.json'),
  `${JSON.stringify({ version: pkg.version || '0.0.0', buildTime }, null, 2)}\n`,
)

console.log(`Build meta: v${pkg.version} @ ${buildTime}`)
