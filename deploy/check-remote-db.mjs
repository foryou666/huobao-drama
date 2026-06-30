import { Client } from 'ssh2'

const cfg = {
  host: process.env.DEPLOY_SSH_HOST || '8.160.163.57',
  username: process.env.DEPLOY_SSH_USER || 'root',
  password: process.env.DEPLOY_SSH_PASSWORD || '',
}

const conn = new Client()
conn.on('ready', () => {
  const cmd = `cd /opt/hongguoduanju/backend && node --input-type=module -e "
import Database from 'better-sqlite3';
import fs from 'fs';
const p = '../data/huobao_drama.db';
const st = fs.statSync(p);
const db = new Database(p, { readonly: true });
const q = (s) => db.prepare(s).get();
console.log(JSON.stringify({
  bytes: st.size,
  mtime: st.mtime.toISOString(),
  users: q('SELECT COUNT(*) c FROM users').c,
  dramas: q('SELECT COUNT(*) c FROM dramas').c,
  videos: q('SELECT COUNT(*) c FROM video_generations').c,
  images: q('SELECT COUNT(*) c FROM image_generations').c,
}));
"`
  conn.exec(cmd, (err, stream) => {
    if (err) throw err
    let out = ''
    stream.on('data', (d) => { out += d; process.stdout.write(d) })
    stream.stderr.on('data', (d) => process.stderr.write(d))
    stream.on('close', (code) => {
      conn.end()
      process.exit(code || 0)
    })
  })
})
conn.on('error', (e) => { console.error(e); process.exit(1) })
if (!cfg.password) { console.error('need DEPLOY_SSH_PASSWORD'); process.exit(1) }
conn.connect(cfg)
