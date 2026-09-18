#!/usr/bin/env bash
# =====================================================================
# 庄Sir的提词器 — 把仓库里的 nginx location 片段部署到发布服务器。
# 同步 deploy/prompter.locations.conf → 服务器
#   /etc/nginx/snippets/prompter.locations.conf
# 流程：上传到 /tmp → 备份远端旧片段 → install 就位 → nginx -t（失败自动回滚）
#       → 平滑 reload → 校验新片段已加载。
#
# 用法:  bash scripts/deploy-nginx-conf.sh
# 凭据:  从 deploy/secrets/server-ssh.env 读取（已 gitignore，切勿提交/打印）。
#
# 何时用：改了下载/更新 API（deploy/prompter.locations.conf）后用本脚本部署，
#         使 deploy/prompter.locations.conf 与服务器保持一致。
# =====================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

# shellcheck disable=SC1091
set -a; source deploy/secrets/server-ssh.env; set +a
: "${DEPLOY_SSH_HOST:?missing DEPLOY_SSH_HOST}"
: "${DEPLOY_SSH_USER:?missing DEPLOY_SSH_USER}"
: "${DEPLOY_SSH_PASSWORD:?missing DEPLOY_SSH_PASSWORD}"
export DEPLOY_SSH_PASSWORD
PORT="${DEPLOY_SSH_PORT:-22}"

LOCAL_CONF="deploy/prompter.locations.conf"
REMOTE_CONF="/etc/nginx/snippets/prompter.locations.conf"
STAMP="$(date +%Y%m%d-%H%M%S)"

[ -f "$LOCAL_CONF" ] || { echo "ERROR: missing $LOCAL_CONF"; exit 1; }

SSH_RUN=(expect deploy/lib/ssh-run.exp "$DEPLOY_SSH_HOST" "$DEPLOY_SSH_USER" "$PORT")
SCP_PUT=(expect deploy/lib/scp-put.exp "$DEPLOY_SSH_HOST" "$DEPLOY_SSH_USER" "$PORT")

echo "== 1) upload conf → /tmp =="
"${SCP_PUT[@]}" "$LOCAL_CONF" "/tmp/prompter.locations.conf"

echo "== 2) backup remote snippet (if exists) → ${REMOTE_CONF}.bak.${STAMP} =="
"${SSH_RUN[@]}" "if [ -f ${REMOTE_CONF} ]; then cp -a ${REMOTE_CONF} ${REMOTE_CONF}.bak.${STAMP} && echo BACKED_UP; else echo NO_PRIOR_FILE; fi"

echo "== 3) install new snippet → ${REMOTE_CONF} =="
"${SSH_RUN[@]}" "install -m 0644 /tmp/prompter.locations.conf ${REMOTE_CONF} && echo INSTALLED"

echo "== 4) nginx config test (auto-rollback on failure) =="
# rely on remote EXIT CODE; ssh-run.exp propagates it.
if ! "${SSH_RUN[@]}" "nginx -t"; then
  echo "ERROR: nginx -t failed. Rolling back to backup..."
  "${SSH_RUN[@]}" "if [ -f ${REMOTE_CONF}.bak.${STAMP} ]; then cp -a ${REMOTE_CONF}.bak.${STAMP} ${REMOTE_CONF} && echo ROLLED_BACK; else echo NO_BACKUP_TO_RESTORE; fi" || true
  "${SSH_RUN[@]}" "rm -f /tmp/prompter.locations.conf" || true
  exit 1
fi

echo "== 5) graceful reload =="
"${SSH_RUN[@]}" "(systemctl reload nginx 2>/dev/null || nginx -s reload) && echo NGINX_RELOADED"

echo "== 6) verify new route(s) are loaded (expect count >= 1) =="
"${SSH_RUN[@]}" "nginx -T 2>/dev/null | grep -c 'prompter/download/macos-x64'"

echo "== 7) cleanup remote tmp =="
"${SSH_RUN[@]}" "rm -f /tmp/prompter.locations.conf"

echo "NGINX CONF DEPLOY DONE"
