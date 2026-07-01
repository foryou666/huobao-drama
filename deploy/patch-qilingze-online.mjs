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

run(['exec', 'systemctl is-active hongguoduanju'], 'precheck service')
run(['exec', `cd /opt/hongguoduanju/backend && node -e "const D=require('better-sqlite3');const d=new D('../data/huobao_drama.db',{readonly:true});console.log(JSON.stringify(d.prepare(\\\"SELECT id,name,provider,priority,is_active FROM ai_service_configs WHERE service_type='image' ORDER BY priority DESC\\\").all()));"`], 'image configs before')

run(['sync-backend-src'], 'sync backend/src only')
run(['sync-frontend'], 'sync frontend/dist only')

run(['upload', 'deploy/remote-upsert-qilingze-config.cjs', '/opt/hongguoduanju/deploy/remote-upsert-qilingze-config.cjs'], 'upload db patch script')
run(['exec', 'cd /opt/hongguoduanju/backend && DB_PATH=/opt/hongguoduanju/data/huobao_drama.db node ../deploy/remote-upsert-qilingze-config.cjs && rm -f /opt/hongguoduanju/deploy/remote-upsert-qilingze-config.cjs'], 'upsert qilingze config')

run(['exec', 'systemctl restart hongguoduanju'], 'restart service')
run(['exec', 'sleep 2 && systemctl is-active hongguoduanju && curl -sf http://127.0.0.1:5679/api/v1/images/studio/capabilities'], 'verify capabilities API')

console.log('\n完成：仅同步功能代码 + 启灵泽配置（未上传 .env / 未覆盖整库）')
