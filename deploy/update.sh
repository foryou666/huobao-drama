#!/usr/bin/env bash
# 线上日常更新：在服务器 /opt/hongguoduanju 执行
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/hongguoduanju}"
BRANCH="${BRANCH:-master}"

cd "$APP_DIR"

if [[ -d .git ]]; then
  echo "==> git pull (${BRANCH})"
  git fetch origin
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
else
  echo "==> 非 git 仓库，跳过 git pull（请从本机运行: node deploy/remote.mjs sync-code）"
fi

echo "==> backend npm ci"
cd "$APP_DIR/backend" && npm ci

echo "==> frontend build"
cd "$APP_DIR/frontend" && npm ci && npm run generate:dist

echo "==> restart"
systemctl restart hongguoduanju
sleep 2
systemctl status hongguoduanju --no-pager || true
echo "==> 更新完成 $(date -Iseconds)"
