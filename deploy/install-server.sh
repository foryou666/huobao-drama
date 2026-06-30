#!/usr/bin/env bash
# 首次在 Linux 服务器上运行（root 或 sudo）
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/hongguoduanju}"
REPO_URL="${REPO_URL:-https://gitee.com/jinglingxiansheng/hongguoduanju.git}"
NODE_MAJOR="${NODE_MAJOR:-22}"

echo "==> 安装系统依赖"
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git curl ca-certificates build-essential python3 tar
  apt-get install -y -qq ffmpeg || true
elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
  (command -v dnf >/dev/null && dnf install -y git curl ca-certificates gcc-c++ make python3 tar) ||
  yum install -y git curl ca-certificates gcc-c++ make python3 tar
else
  echo "请手动安装: git curl tar build-essential"
fi

echo "==> 安装 Node.js ${NODE_MAJOR}.x"
if ! command -v node >/dev/null 2>&1; then
  if command -v apt-get >/dev/null; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y -qq nodejs
  else
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    (command -v dnf >/dev/null && dnf install -y nodejs) || yum install -y nodejs
  fi
fi
node -v
npm -v

echo "==> 克隆/更新代码 ${APP_DIR}"
mkdir -p "$(dirname "$APP_DIR")"
if [[ -d "${APP_DIR}/.git" ]]; then
  cd "$APP_DIR" && git fetch origin && git reset --hard origin/master
else
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

echo "==> 安装依赖 & 构建前端"
cd "$APP_DIR/backend" && npm ci
cd "$APP_DIR/frontend" && npm ci && npm run generate:dist

echo "==> Playwright Chromium（即梦通道需要）"
cd "$APP_DIR/backend" && npx playwright-core install chromium || true
if command -v apt-get >/dev/null 2>&1; then
  cd "$APP_DIR/backend" && npx playwright-core install-deps chromium || true
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y atk at-spi2-atk at-spi2-core cups-libs libdrm libXcomposite libXdamage libXfixes libXrandr libxkbcommon mesa-libgbm pango alsa-lib nss nspr libXScrnSaver libXtst gtk3 || true
fi

mkdir -p "$APP_DIR/data/static"

if [[ ! -f "$APP_DIR/backend/.env" ]]; then
  cp "$APP_DIR/backend/.env.example" "$APP_DIR/backend/.env" 2>/dev/null || true
  echo "请编辑 ${APP_DIR}/backend/.env 后重启服务"
fi

echo "==> systemd"
cp "$APP_DIR/deploy/hongguoduanju.service" /etc/systemd/system/hongguoduanju.service
systemctl daemon-reload
systemctl enable hongguoduanju
systemctl restart hongguoduanju

echo "==> 完成。状态:"
systemctl status hongguoduanju --no-pager || true
