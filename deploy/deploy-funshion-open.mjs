/**
 * 部署通道8 全员可见修复：后端 + 前端 dist
 * 用法: node deploy/deploy-funshion-open.mjs
 */
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv(filePath) {
  const out = {}
  if (!fs.existsSync(filePath)) return out
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return out
}

const env = {
  ...process.env,
  ...loadEnv(path.join(root, 'deploy', '.env')),
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      env,
      stdio: 'inherit',
      shell: true,
    })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))))
  })
}

await run('node', [
  'deploy/tmp-upload-backend-files.mjs',
  'backend/src/utils/funshion-access.ts',
  'backend/src/routes/auth.ts',
])
await run('node', ['deploy/remote.mjs', 'sync-frontend'])
console.log('done')
