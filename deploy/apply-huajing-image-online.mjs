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

const HUAJING_API_KEY = process.env.HUAJING_API_KEY
if (!HUAJING_API_KEY) {
  console.error('请设置环境变量 HUAJING_API_KEY')
  process.exit(1)
}

const deployEnv = {
  ...process.env,
  DEPLOY_SSH_HOST: env.IP || process.env.DEPLOY_SSH_HOST,
  DEPLOY_SSH_USER: env.USER || env.URER || process.env.DEPLOY_SSH_USER,
  DEPLOY_SSH_PASSWORD: env.PASS || process.env.DEPLOY_SSH_PASSWORD,
  HUAJING_API_KEY,
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

run(['upload', 'deploy/remote-upsert-huajing-image-config.cjs', '/opt/hongguoduanju/deploy/remote-upsert-huajing-image-config.cjs'], 'upload db patch script')
run(['exec', `cd /opt/hongguoduanju/backend && HUAJING_API_KEY='${HUAJING_API_KEY.replace(/'/g, "'\\''")}' DB_PATH=/opt/hongguoduanju/data/huobao_drama.db node ../deploy/remote-upsert-huajing-image-config.cjs && rm -f /opt/hongguoduanju/deploy/remote-upsert-huajing-image-config.cjs`], 'upsert huajing image config')
run(['exec', 'systemctl restart hongguoduanju'], 'restart service')
run(['exec', 'sleep 2 && systemctl is-active hongguoduanju'], 'check service')

console.log('\n花镜图片配置已写入线上数据库（默认生图通道）')
