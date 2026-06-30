# 线上部署与日常更新

## 目录

| 文件 | 说明 |
|------|------|
| `install-server.sh` | 首次在 Linux 服务器安装 Node、克隆代码、构建、systemd |
| `update.sh` | 日常 `git pull` + 构建 + 重启 |
| `hongguoduanju.service` | systemd 单元（`LOCAL_MEDIA_PREFER_DAYS=0` 始终 OSS） |
| `remote.mjs` | 从本机 Windows 远程执行/上传（密码用环境变量，勿提交） |

## 首次部署（从开发机）

```powershell
cd d:\java\hongguoduanju\deploy
npm install

# 1. 确保代码已 push 到 Gitee master
cd ..
git push origin master

# 2. 首次安装（约 10–20 分钟）
$env:DEPLOY_SSH_PASSWORD='你的SSH密码'
node deploy/remote.mjs install

# 3. 上传 .env 和数据库，并构建重启
node deploy/remote.mjs publish
```

## 日常更新（改完代码后）

```powershell
# 本机
git add -A && git commit -m "..." && git push origin master

# 远程更新（仅代码，不动 .env/db）
$env:DEPLOY_SSH_PASSWORD='你的SSH密码'
node deploy/remote.mjs exec "cd /opt/hongguoduanju && bash deploy/update.sh"
```

若同时改了 `.env` 或要同步数据库：

```powershell
node deploy/remote.mjs publish
```

## 服务器路径

- 应用：`/opt/hongguoduanju`
- 环境变量：`/opt/hongguoduanju/backend/.env`
- 数据：`/opt/hongguoduanju/data/`
- 服务：`systemctl status hongguoduanju`
- 日志：`journalctl -u hongguoduanju -f`

## 访问

- **对外端口：5679**（应用直接监听 `0.0.0.0:5679`，前后端一体）
- 访问地址：**http://你的服务器IP:5679**
- 阿里云安全组：入方向放行 **TCP 5679**（无需开放 80）
- `nginx.conf.example` 为可选方案，**当前未启用**（不经过 80 反代）

## 安全建议

- 部署完成后修改 root 密码，改用 SSH 密钥登录
- **勿将** `DEPLOY_SSH_PASSWORD` 写入 git
