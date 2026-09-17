#!/usr/bin/env bash
# =====================================================================
# 庄Sir的提词器 — 发布"最后一公里"：把 release/public/<version>/ 上传到
# 发布服务器并原子切换 channels/stable 指针，使下载 API 与 App 内更新返回该版本。
#
# 前置：先本地产出 release/public/<version>/（见 docs/RELEASE.md 步骤）。
# 凭据：从 deploy/secrets/server-ssh.env 读取（该文件已 gitignore，切勿提交）。
#
# 用法:  bash scripts/deploy-release.sh <version>
# 例:    bash scripts/deploy-release.sh 0.1.7
#
# 服务器目录结构（幂等、可回退）:
#   releases/<version>/        不可变发布包（本脚本上传）
#   channels/stable -> ../releases/<version>   原子切换的指针
# 回退：ssh 到服务器执行  ln -sfn ../releases/<旧版本> channels/stable
# =====================================================================
set -euo pipefail

VERSION="${1:?usage: deploy-release.sh <version>}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

# shellcheck disable=SC1091
set -a; source deploy/secrets/server-ssh.env; set +a
: "${DEPLOY_SSH_HOST:?missing DEPLOY_SSH_HOST}"
: "${DEPLOY_SSH_USER:?missing DEPLOY_SSH_USER}"
: "${DEPLOY_SSH_PASSWORD:?missing DEPLOY_SSH_PASSWORD}"
export DEPLOY_SSH_PASSWORD
PORT="${DEPLOY_SSH_PORT:-22}"
ROOT="${DEPLOY_REMOTE_ROOT:-/mnt/pictshare/zhuang-prompter}"
BUNDLE="release/public/${VERSION}"

[ -f "${BUNDLE}/manifest.json" ] || { echo "ERROR: missing ${BUNDLE}/manifest.json — run scripts/prepare-public-release.mjs first"; exit 1; }

SSH_RUN=(expect deploy/lib/ssh-run.exp "$DEPLOY_SSH_HOST" "$DEPLOY_SSH_USER" "$PORT")
SCP_PUT=(expect deploy/lib/scp-put.exp "$DEPLOY_SSH_HOST" "$DEPLOY_SSH_USER" "$PORT")
TAR="/tmp/zhuang-prompter-${VERSION}.tar.gz"

echo "== 1) pack bundle → ${TAR} =="
tar -czf "$TAR" -C release/public "$VERSION"
ls -la "$TAR"

echo "== 2) guard: refuse if releases/${VERSION} already exists on server =="
# NOTE: rely on the remote EXIT CODE, not on grepping stdout. ssh-run.exp runs ssh
# over a pty, so expect's `spawn` line and the tty echo the remote command back to
# stdout — any sentinel string in the command (e.g. "EXISTS") would be matched by
# grep on the echo, not the real result. `test -e` exits 0 if the path exists.
if "${SSH_RUN[@]}" "test -e ${ROOT}/releases/${VERSION}" >/dev/null 2>&1; then
  echo "ERROR: ${ROOT}/releases/${VERSION} already exists on server. Aborting (won't overwrite an immutable release)."; exit 1
fi

echo "== 3) record current stable target (for rollback) =="
"${SSH_RUN[@]}" "readlink ${ROOT}/channels/stable || true"

echo "== 4) upload tarball → /tmp =="
"${SCP_PUT[@]}" "$TAR" "/tmp/"

echo "== 5) extract → releases/${VERSION} + verify SHA256SUMS =="
"${SSH_RUN[@]}" "set -e; cd ${ROOT}/releases && tar -xzf /tmp/$(basename "$TAR") && cd ${VERSION} && sha256sum -c SHA256SUMS && echo CHECKSUM_OK"

echo "== 6) atomic stable pointer swap → releases/${VERSION} =="
"${SSH_RUN[@]}" "set -e; cd ${ROOT}/channels && ln -sfn ../releases/${VERSION} .stable.new && mv -Tf .stable.new stable && echo -n 'stable -> ' && readlink stable"

echo "== 7) nginx config test + graceful reload =="
"${SSH_RUN[@]}" "if command -v nginx >/dev/null 2>&1; then nginx -t && (systemctl reload nginx 2>/dev/null || nginx -s reload) && echo NGINX_RELOADED; else echo 'nginx not in PATH; symlink swap is enough (no-store + no open_file_cache)'; fi"

echo "== 8) cleanup remote tmp =="
"${SSH_RUN[@]}" "rm -f /tmp/$(basename "$TAR")"

echo "== 9) verify live manifest version on server =="
"${SSH_RUN[@]}" "grep -m1 '\"version\"' ${ROOT}/channels/stable/manifest.json"

rm -f "$TAR"
echo "DEPLOY DONE for ${VERSION}"
