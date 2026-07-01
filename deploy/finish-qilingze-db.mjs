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

const deployEnv = {
  ...process.env,
  DEPLOY_SSH_HOST: env.IP || process.env.DEPLOY_SSH_HOST,
  DEPLOY_SSH_USER: env.USER || env.URER || process.env.DEPLOY_SSH_USER,
  DEPLOY_SSH_PASSWORD: env.PASS || process.env.DEPLOY_SSH_PASSWORD,
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

run(['upload', 'deploy/remote-upsert-qilingze-config.cjs', '/opt/hongguoduanju/deploy/remote-upsert-qilingze-config.cjs'], 'upload db patch script')
run(['exec', 'cd /opt/hongguoduanju/backend && DB_PATH=/opt/hongguoduanju/data/huobao_drama.db node ../deploy/remote-upsert-qilingze-config.cjs && rm -f /opt/hongguoduanju/deploy/remote-upsert-qilingze-config.cjs'], 'upsert qilingze config')
run(['exec', 'systemctl restart hongguoduanju && sleep 2 && systemctl is-active hongguoduanju'], 'restart service')
run(['exec', `curl -sf http://127.0.0.1:5679/api/v1/images/studio/capabilities`], 'verify capabilities API')

console.log('\n启灵泽配置已写入线上数据库')
