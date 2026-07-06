/**
 * 远程 SSH 执行 / SFTP 上传（密码通过环境变量 DEPLOY_SSH_PASSWORD，勿写入仓库）
 * 用法:
 *   DEPLOY_SSH_HOST=8.160.163.57 DEPLOY_SSH_USER=root DEPLOY_SSH_PASSWORD=*** node deploy/remote.mjs exec "uname -a"
 *   DEPLOY_SSH_PASSWORD=*** node deploy/remote.mjs upload backend/.env /opt/hongguoduanju/backend/.env
 *   DEPLOY_SSH_PASSWORD=*** node deploy/remote.mjs publish
 *   DEPLOY_SSH_PASSWORD=*** node deploy/remote.mjs pull
 *   PULL_STATIC=1 DEPLOY_SSH_PASSWORD=*** node deploy/remote.mjs pull-static
 */
import fs from 'fs'
import path from 'path'
import { Client } from 'ssh2'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const cfg = {
  host: process.env.DEPLOY_SSH_HOST || '8.160.163.57',
  port: Number(process.env.DEPLOY_SSH_PORT || 22),
  username: process.env.DEPLOY_SSH_USER || 'root',
  password: process.env.DEPLOY_SSH_PASSWORD || '',
}

const APP_DIR = process.env.DEPLOY_APP_DIR || '/opt/hongguoduanju'

function connect() {
  if (!cfg.password) {
    console.error('请设置环境变量 DEPLOY_SSH_PASSWORD')
    process.exit(1)
  }
  return new Promise((resolve, reject) => {
    const conn = new Client()
    conn.on('ready', () => resolve(conn))
    conn.on('error', reject)
    conn.connect({ ...cfg, readyTimeout: 30000 })
  })
}

function exec(conn, command, { timeout = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    conn.exec(command, (err, stream) => {
      if (err) return reject(err)
      const timer = setTimeout(() => {
        stream.close()
        reject(new Error(`timeout after ${timeout}ms`))
      }, timeout)
      stream.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve({ stdout, stderr })
        else reject(new Error(`exit ${code}\n${stderr || stdout}`))
      })
      stream.on('data', (d) => { stdout += d; process.stdout.write(d) })
      stream.stderr.on('data', (d) => { stderr += d; process.stderr.write(d) })
    })
  })
}

function uploadFile(conn, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err)
      const abs = path.isAbsolute(localPath) ? localPath : path.join(root, localPath)
      if (!fs.existsSync(abs)) return reject(new Error(`local missing: ${abs}`))
      const remoteDir = path.posix.dirname(remotePath.replace(/\\/g, '/'))
      sftp.mkdir(remoteDir, { mode: 0o755 }, () => {
        sftp.fastPut(abs, remotePath, (putErr) => {
          sftp.end()
          if (putErr) reject(putErr)
          else resolve()
        })
      })
    })
  })
}

function downloadFile(conn, remotePath, localPath) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err)
      const abs = path.isAbsolute(localPath) ? localPath : path.join(root, localPath)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      sftp.fastGet(remotePath.replace(/\\/g, '/'), abs, (getErr) => {
        sftp.end()
        if (getErr) reject(getErr)
        else resolve(abs)
      })
    })
  })
}

function backupLocalIfExists(relPath) {
  const abs = path.join(root, relPath)
  if (!fs.existsSync(abs)) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = path.join(root, 'data', 'backups', `pull-${stamp}`)
  fs.mkdirSync(backupDir, { recursive: true })
  const dest = path.join(backupDir, path.basename(relPath))
  fs.copyFileSync(abs, dest)
  console.log(`  本地备份: ${dest}`)
}

async function syncFrontendDist(conn) {
  const { spawn } = await import('child_process')
  const os = await import('os')
  console.log('==> 本地构建 frontend/dist')
  await new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'generate:dist'], {
      cwd: path.join(root, 'frontend'),
      stdio: 'inherit',
      shell: true,
    })
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`frontend build exit ${code}`)))
  })
  const tmpTar = path.join(os.tmpdir(), `frontend-dist-${Date.now()}.tgz`)
  await new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-czf', tmpTar, '-C', path.join(root, 'frontend'), 'dist'], { stdio: 'inherit', shell: false })
    tar.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`tar exit ${code}`)))
  })
  console.log('==> 上传 frontend/dist')
  await uploadFile(conn, tmpTar, '/tmp/frontend-dist.tgz')
  fs.unlinkSync(tmpTar)
  await exec(conn, `
    cd ${APP_DIR}/frontend && rm -rf dist && tar -xzf /tmp/frontend-dist.tgz && rm -f /tmp/frontend-dist.tgz
  `)
}

/** 仅同步 backend/src（跳过 npm ci，适合小改动） */
async function syncBackendSrc(conn) {
  const { spawn } = await import('child_process')
  const os = await import('os')
  const tmpTar = path.join(os.tmpdir(), `backend-src-${Date.now()}.tgz`)
  await new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-czf', tmpTar, '-C', path.join(root, 'backend'), 'src'], { stdio: 'inherit', shell: false })
    tar.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`tar exit ${code}`)))
  })
  await uploadFile(conn, tmpTar, '/tmp/backend-src.tgz')
  fs.unlinkSync(tmpTar)
  await exec(conn, `cd ${APP_DIR}/backend && tar -xzf /tmp/backend-src.tgz && rm -f /tmp/backend-src.tgz`)
}

/** 本机打包上传代码（排除 node_modules / static 大文件） */
async function syncCode(conn) {
  const { spawn } = await import('child_process')
  const os = await import('os')
  const tmpTar = path.join(os.tmpdir(), `hongguoduanju-${Date.now()}.tgz`)
  console.log('==> 本地打包', root)
  await new Promise((resolve, reject) => {
    const tar = spawn('tar', [
      '-czf', tmpTar,
      '--exclude=node_modules',
      '--exclude=.git',
      '--exclude=frontend/.nuxt',
      '--exclude=frontend/.output',
      '--exclude=data/static',
      '--exclude=data/huobao_drama.db',
      '--exclude=data/huobao_drama.db-wal',
      '--exclude=data/huobao_drama.db-shm',
      '--exclude=deploy/node_modules',
      '-C', root, '.',
    ], { stdio: 'inherit', shell: false })
    tar.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`tar exit ${code}`)))
  })

  console.log('==> 上传代码包')
  await uploadFile(conn, tmpTar, '/tmp/hongguoduanju-src.tgz')
  fs.unlinkSync(tmpTar)

  await exec(conn, `
    mkdir -p ${APP_DIR} && cd ${APP_DIR} &&
    tar -xzf /tmp/hongguoduanju-src.tgz &&
    rm -f /tmp/hongguoduanju-src.tgz &&
    cd backend && npm ci &&
    cd ../frontend && npm ci && npm run generate:dist &&
    cd ../backend && npx playwright-core install chromium || true &&
    npx playwright-core install-deps chromium || true
  `, { timeout: 3600000 })
}

async function uploadDatabase(conn) {
  const dbLocal = path.join(root, 'data', 'huobao_drama.db')
  if (!fs.existsSync(dbLocal)) {
    console.log('本地无 data/huobao_drama.db，跳过')
    return
  }

  console.log('\n==> 停止服务并上传数据库')
  await exec(conn, 'systemctl stop hongguoduanju || true')

  try {
    const { spawnSync } = await import('child_process')
    spawnSync('node', ['-e', `
      const Database = require('better-sqlite3');
      const db = new Database(${JSON.stringify(dbLocal)});
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    `], { cwd: path.join(root, 'backend'), stdio: 'inherit', shell: true })
  } catch {
    /* 尽力 checkpoint */
  }

  const mb = (fs.statSync(dbLocal).size / 1024 / 1024).toFixed(1)
  console.log(`上传 huobao_drama.db (${mb} MB)`)
  await uploadFile(conn, dbLocal, `${APP_DIR}/data/huobao_drama.db`)

  await exec(conn, `
    rm -f ${APP_DIR}/data/huobao_drama.db-wal ${APP_DIR}/data/huobao_drama.db-shm
    systemctl start hongguoduanju
    sleep 2
  `)
}

async function publish(conn) {
  console.log('\n==> 上传 backend/.env')
  await uploadFile(conn, 'backend/.env', `${APP_DIR}/backend/.env`)

  await uploadDatabase(conn)

  console.log('\n==> 服务器更新部署（可选）')
  try {
    await exec(conn, `sed -i 's/\\r$//' ${APP_DIR}/deploy/*.sh 2>/dev/null; chmod +x ${APP_DIR}/deploy/*.sh && APP_DIR=${APP_DIR} bash ${APP_DIR}/deploy/update.sh`, { timeout: 900000 })
  } catch (err) {
    console.warn('update.sh 跳过:', err.message)
    await exec(conn, 'systemctl restart hongguoduanju')
  }
}

async function prepareRemoteDbBackup(conn) {
  const remoteTmp = '/tmp/huobao_pull.db'
  await exec(conn, `
    cd ${APP_DIR}/backend && node --input-type=module -e "
      import Database from 'better-sqlite3';
      const src = '${APP_DIR}/data/huobao_drama.db';
      const dst = '${remoteTmp}';
      const db = new Database(src, { readonly: true });
      await db.backup(dst);
      db.close();
      console.log('backup ok');
    "
  `, { timeout: 300000 })
  return remoteTmp
}

async function pullFromServer(conn, { withStatic = false } = {}) {
  console.log('==> 从服务器拉取配置与数据库')
  console.log(`    服务器: ${cfg.username}@${cfg.host}:${APP_DIR}`)

  const items = [
    { remote: `${APP_DIR}/backend/.env`, local: 'backend/.env' },
    { remote: `${APP_DIR}/configs/config.yaml`, local: 'configs/config.yaml' },
  ]

  for (const item of items) {
    backupLocalIfExists(item.local)
    console.log(`\n下载 ${item.remote}`)
    const saved = await downloadFile(conn, item.remote, item.local)
    const kb = (fs.statSync(saved).size / 1024).toFixed(1)
    console.log(`  -> ${saved} (${kb} KB)`)
  }

  console.log('\n==> 备份并下载数据库（在线 backup，不停服）')
  backupLocalIfExists('data/huobao_drama.db')
  const remoteDb = await prepareRemoteDbBackup(conn)
  const dbLocal = await downloadFile(conn, remoteDb, 'data/huobao_drama.db')
  const mb = (fs.statSync(dbLocal).size / 1024 / 1024).toFixed(1)
  console.log(`  -> ${dbLocal} (${mb} MB)`)
  await exec(conn, `rm -f ${remoteDb}`)

  const seedDir = path.join(root, 'data', 'seed')
  fs.mkdirSync(seedDir, { recursive: true })
  backupLocalIfExists('data/seed/huobao_drama.db')
  fs.copyFileSync(dbLocal, path.join(seedDir, 'huobao_drama.db'))
  console.log('  -> 已同步到 data/seed/huobao_drama.db')

  if (withStatic) {
    console.log('\n==> 下载 data/static（可能很大，请耐心等待）')
    const remoteTar = '/tmp/hongguoduanju-static.tgz'
    await exec(conn, `tar -czf ${remoteTar} -C ${APP_DIR}/data static`, { timeout: 3600000 })
    const localTar = path.join(root, 'data', 'backups', 'server-static.tgz')
    fs.mkdirSync(path.dirname(localTar), { recursive: true })
    await downloadFile(conn, remoteTar, localTar)
    await exec(conn, `rm -f ${remoteTar}`)
    const { spawnSync } = await import('child_process')
    if (process.platform === 'win32') {
      spawnSync('tar', ['-xzf', localTar, '-C', path.join(root, 'data')], { stdio: 'inherit' })
    } else {
      spawnSync('tar', ['-xzf', localTar, '-C', path.join(root, 'data')], { stdio: 'inherit' })
    }
    console.log('  -> 已解压到 data/static/')
  } else {
    console.log('\n跳过 data/static（默认）。媒体多在 OSS；若需本地文件可运行:')
    console.log('  PULL_STATIC=1 DEPLOY_SSH_PASSWORD=*** node deploy/remote.mjs pull-static')
  }

  console.log('\n==> 拉取完成。请重启本地 backend 使配置生效。')
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  const conn = await connect()
  try {
    if (cmd === 'exec') {
      await exec(conn, args.join(' '), { timeout: 900000 })
    } else if (cmd === 'upload') {
      await uploadFile(conn, args[0], args[1])
      console.log('uploaded', args[0], '->', args[1])
    } else if (cmd === 'upload-db') {
      await uploadDatabase(conn)
    } else if (cmd === 'publish') {
      await publish(conn)
    } else if (cmd === 'pull' || cmd === 'pull-static') {
      await pullFromServer(conn, { withStatic: cmd === 'pull-static' || process.env.PULL_STATIC === '1' })
    } else if (cmd === 'install') {
      const script = fs.readFileSync(path.join(root, 'deploy', 'install-server.sh'), 'utf8')
      const b64 = Buffer.from(script).toString('base64')
      await exec(conn, `echo ${b64} | base64 -d > /tmp/install-hg.sh && chmod +x /tmp/install-hg.sh && APP_DIR=${APP_DIR} bash /tmp/install-hg.sh`, { timeout: 1800000 })
    } else if (cmd === 'bootstrap') {
      console.log('==> 安装系统依赖与 Node')
      await exec(conn, `
        export DEBIAN_FRONTEND=noninteractive
        if command -v apt-get >/dev/null; then
          apt-get update -qq && apt-get install -y -qq git curl ca-certificates build-essential python3 tar
          apt-get install -y -qq ffmpeg || true
          curl -fsSL https://deb.nodesource.com/setup_22.x | bash - || true
          apt-get install -y -qq nodejs || true
        elif command -v dnf >/dev/null || command -v yum >/dev/null; then
          (command -v dnf >/dev/null && dnf install -y git curl ca-certificates gcc-c++ make python3 tar) ||
          yum install -y git curl ca-certificates gcc-c++ make python3 tar
          (command -v dnf >/dev/null && dnf install -y nodejs npm) || yum install -y nodejs npm || true
        fi
        if ! command -v node >/dev/null; then
          curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
          (command -v dnf >/dev/null && dnf install -y nodejs) || yum install -y nodejs
        fi
        node -v && npm -v
        mkdir -p ${APP_DIR}/data/static
      `, { timeout: 600000 })
      await syncCode(conn)
      await exec(conn, `
        cp ${APP_DIR}/deploy/hongguoduanju.service /etc/systemd/system/hongguoduanju.service
        systemctl daemon-reload && systemctl enable hongguoduanju && systemctl restart hongguoduanju
      `)
      console.log('\n==> bootstrap 完成，请运行 publish 上传 .env 和数据库')
    } else if (cmd === 'sync-frontend') {
      await syncFrontendDist(conn)
      await exec(conn, 'systemctl restart hongguoduanju')
    } else if (cmd === 'sync-backend-src') {
      await syncBackendSrc(conn)
      await exec(conn, 'systemctl restart hongguoduanju')
    } else if (cmd === 'sync-code') {
      await syncCode(conn)
      await exec(conn, `systemctl restart hongguoduanju`)
    } else {
      console.log('commands: exec | upload | upload-db | publish | pull | pull-static | install | bootstrap | sync-code | sync-frontend | sync-backend-src | sync-video-posters')
      process.exit(1)
    }
  } finally {
    conn.end()
  }
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
