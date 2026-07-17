/**
 * Build storyai-3d-director-desk and copy into frontend/public/director-3d
 */
import { cpSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vendorDir = path.join(root, 'vendor', 'storyai-3d-director-desk')
const vendorDist = path.join(vendorDir, 'dist')
const publicTarget = path.join(root, 'frontend', 'public', 'director-3d')

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
    },
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (!existsSync(path.join(vendorDir, 'package.json'))) {
  console.error('Missing vendor/storyai-3d-director-desk — clone or extract the repo first.')
  process.exit(1)
}

const nodeModules = path.join(vendorDir, 'node_modules')
if (!existsSync(nodeModules)) {
  console.log('==> npm install (director-3d vendor)')
  run('npm', ['install', '--no-audit', '--no-fund'], vendorDir)
}

console.log('==> npm run build (director-3d)')
run('npm', ['run', 'build'], vendorDir)

if (!existsSync(vendorDist)) {
  console.error('Build did not produce vendor/storyai-3d-director-desk/dist')
  process.exit(1)
}

rmSync(publicTarget, { recursive: true, force: true })
cpSync(vendorDist, publicTarget, { recursive: true })
console.log(`Synced ${vendorDist} -> ${publicTarget}`)
