import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(root, 'backend', '.env')
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(line => line && !line.trim().startsWith('#'))
    .map(line => {
      const i = line.indexOf('=')
      if (i < 0) return [line.trim(), '']
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()]
    }),
)

const QILINGZE_API_KEY = process.argv[2] || process.env.QILINGZE_API_KEY
if (!QILINGZE_API_KEY) {
  console.error('用法: node deploy/apply-qilingze-image-online.mjs <QILINGZE_API_KEY>')
  process.exit(1)
}

const deployEnv = {
  ...process.env,
  DEPLOY_SSH_HOST: env.IP || process.env.DEPLOY_SSH_HOST,
  DEPLOY_SSH_USER: env.USER || env.URER || process.env.DEPLOY_SSH_USER,
  DEPLOY_SSH_PASSWORD: env.PASS || process.env.DEPLOY_SSH_PASSWORD,
  QILINGZE_API_KEY,
}

if (!deployEnv.DEPLOY_SSH_PASSWORD) {
  console.error('backend/.env 缺少 PASS')
  process.exit(1)
}

const remote = path.join(root, 'deploy', 'remote.mjs')

function run(args, label) {
  console.log(`\n========== ${label} ==========`)
  const res = spawnSync('node', [remote, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: deployEnv,
  })
  if (res.status !== 0) process.exit(res.status || 1)
}

const keyEscaped = QILINGZE_API_KEY.replace(/'/g, "'\\''")

run(['upload', 'deploy/remote-upsert-qilingze-config.cjs', '/opt/hongguoduanju/deploy/remote-upsert-qilingze-config.cjs'], 'upload db patch script')
run(['exec', `cd /opt/hongguoduanju/backend && QILINGZE_API_KEY='${keyEscaped}' DB_PATH=/opt/hongguoduanju/data/huobao_drama.db node ../deploy/remote-upsert-qilingze-config.cjs && rm -f /opt/hongguoduanju/deploy/remote-upsert-qilingze-config.cjs`], 'upsert qilingze as default image config')
run(['exec', 'systemctl restart hongguoduanju && sleep 2 && systemctl is-active hongguoduanju'], 'restart service')

console.log('\n启灵泽图片配置已更新为默认通道')
