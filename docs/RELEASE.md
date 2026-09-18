# 发布 / 更新链路 Runbook

本文件是**唯一权威的发布流程**。任何 thread 发布新版本都按此执行。先读 [`docs/WORKSPACE.md`](./WORKSPACE.md)。

工作目录：`/Users/billzhuang/Documents/AI Workspace/codex/zhuangsir-prompter`（每条命令前 `cd`）。

---

## 全景

```
改代码 → 打 tag v X.Y.Z → GitHub Actions 构建 4 平台
   → 本地 gh run download 拉产物 → prepare-public-release.mjs 打包
   → deploy-release.sh 上传+原子切换 stable 指针 → 验证 API → 旧版 App 内更新自测
```

- **下载链接 API**：`https://bill-api.whatonearth.work/prompter/releases/latest.json`（= 服务器 `channels/stable/manifest.json`）。
- **Windows 应用内更新**：electron-updater 读 `…/prompter/updates/stable/windows-<arch>/latest.yml`。
- **macOS 更新**：installer-handoff——App 读 `releases/latest.json`，按 sha256 校验后下载 DMG，用户拖入 Applications（Mac 不读 latest-mac.yml）。

---

## 平台构建职责（重要）

**Windows 安装包只能在 Windows 上构建**（本 Mac 无 wine/docker，无法本地产出 win exe）。
标准做法：打 `v*.*.*` tag，`.github/workflows/release.yml` 用 **4 平台矩阵**（mac/arm64、mac/x64、win/x64、win/arm64）构建。其中 mac 有两个构建都跑在 `macos-latest`(arm64) runner 上：arm64 为原生构建；x64(Intel) 为交叉构建，命令 `electron-builder --mac --x64` 并设 `CSC_IDENTITY_AUTO_DISCOVERY=false`。产物同时：
- 作为 **run artifacts**（`desktop-mac-arm64` / `desktop-mac-x64` / `desktop-win-x64` / `desktop-win-arm64`，**含 `latest*.yml`**）；
- 作为 **GitHub Release 资产**（dmg/zip/exe/blockmap，**不含 yml**）。

发布取 **run artifacts**（含 yml）。注意：两个 mac 构建都产出同名 `latest-mac.yml`（相互冲突），因此 mac x64 必须下载到独立目录 `release/mac-x64/`；两个 win 的 `latest.yml` 同理分目录不冲突。

---

## 步骤

### 0. 前置
- 已在 `feat/*` 分支完成改动并跑过验收闸门（见 WORKSPACE.md §3）。
- `package.json` 的 `version` 已改为目标版本（如 `0.1.7`）并提交。
- `gh auth status` 已登录。
- 发布前查远端确认版本号未被占用：
  ```bash
  git ls-remote --tags origin | grep vX.Y.Z   # 应为空
  ```

### 1. 更新发布说明
`scripts/prepare-public-release.mjs` 里的 `releaseNotes` 字段改为本次版本的实际改动（它会进 manifest，App 更新提示会显示）。

### 2. 打 tag 触发 CI
```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z" <commit>
git push origin vX.Y.Z
```
（tag 推送不等于 push main；这是发布唯一入口。会创建公开 GitHub Release。）

监控：
```bash
gh run list --limit 3
gh run view <run-id> --json status,conclusion,jobs -q '.status+" "+(.conclusion//"")'
```

### 3. 下载 CI 产物并落到 prepare 期望的路径
```bash
gh run download <run-id> --dir /tmp/ci-X.Y.Z
# mac（用 CI 产物，保证 bill-api 与 GitHub Release 一致）
cp -f /tmp/ci-X.Y.Z/desktop-mac-arm64/zhuang-prompter-X.Y.Z-mac-arm64.dmg          release/
cp -f /tmp/ci-X.Y.Z/desktop-mac-arm64/zhuang-prompter-X.Y.Z-mac-arm64.dmg.blockmap release/
cp -f /tmp/ci-X.Y.Z/desktop-mac-arm64/zhuang-prompter-X.Y.Z-mac-arm64.zip          release/
cp -f /tmp/ci-X.Y.Z/desktop-mac-arm64/zhuang-prompter-X.Y.Z-mac-arm64.zip.blockmap release/
cp -f /tmp/ci-X.Y.Z/desktop-mac-arm64/latest-mac.yml                               release/
# mac x64 (Intel)（分目录，避免 latest-mac.yml 冲突）
mkdir -p release/mac-x64
cp -f /tmp/ci-X.Y.Z/desktop-mac-x64/* release/mac-x64/
# win x64 / arm64（分目录，各自 latest.yml）
mkdir -p release/win-x64 release/win-arm64
cp -f /tmp/ci-X.Y.Z/desktop-win-x64/*   release/win-x64/
cp -f /tmp/ci-X.Y.Z/desktop-win-arm64/* release/win-arm64/
```

### 4. 打发布包
```bash
node scripts/prepare-public-release.mjs
# → release/public/X.Y.Z/ ：manifest.json、SHA256SUMS、四平台 exe/dmg + 别名（含 mac x64 的 macos-x64.dmg）+ blockmap、updater/<key>/latest*.yml
# 本地自检：
cd release/public/X.Y.Z && shasum -a 256 -c SHA256SUMS && cd -
```

### 5. 部署到服务器（最后一公里）
```bash
bash scripts/deploy-release.sh X.Y.Z
```
脚本行为（幂等、可回退）：打包 tar → 若 `releases/X.Y.Z` 已存在则中止 → 记录当前 stable 指向（回退用）→ scp 上传 → 服务器解包到 `releases/X.Y.Z` 并 `sha256sum -c` → **原子切换** `channels/stable -> ../releases/X.Y.Z` → `nginx -t` + reload → 清理 → 打印线上 manifest 版本。

凭据从 `deploy/secrets/server-ssh.env` 读（见 WORKSPACE.md §4）。

### 5b. 部署/更新 nginx 下载路由（改了 API 才需要）
每当 `deploy/prompter.locations.conf` 变化（例如本次新增 `macos-x64` 下载路由），用它同步到服务器：
```bash
bash scripts/deploy-nginx-conf.sh
```
脚本行为：备份远端现有 snippet → scp 上传 → 安装到 `/etc/nginx/snippets/prompter.locations.conf` → `nginx -t`（失败自动回退）→ reload → 校验 `macos-x64` 路由已加载。凭据同样从 `deploy/secrets/server-ssh.env` 读。
**0.1.8 发布必须运行一次**，`macos-x64` 下载路由才会上线。

### 6. 线上验证
```bash
curl -s https://bill-api.whatonearth.work/prompter/releases/latest.json | grep -m1 version
curl -sI https://bill-api.whatonearth.work/prompter/downloads/X.Y.Z/zhuang-prompter-X.Y.Z-mac-arm64.dmg | head -1
curl -sI https://bill-api.whatonearth.work/prompter/downloads/X.Y.Z/zhuang-prompter-X.Y.Z-mac-x64.dmg  | head -1
curl -s  https://bill-api.whatonearth.work/prompter/updates/stable/windows-x64/latest.yml   | grep -m1 version
curl -s  https://bill-api.whatonearth.work/prompter/updates/stable/windows-arm64/latest.yml | grep -m1 version
# 4 个下载短链均可解析（新增 macos-x64）
for k in macos-arm64 macos-x64 windows-x64 windows-arm64; do curl -sI "https://bill-api.whatonearth.work/prompter/download/$k" | head -1; done
```
（若本机 DNS 走假 IP，改从服务器上 `curl 127.0.0.1 -H 'Host: bill-api.whatonearth.work'` 或直接看 `channels/stable/manifest.json`。）

### 7. App 内更新自测（旧版升到新版）
- **Windows**：装旧版 → 启动 30s 后自动检查（>24h 才自动；也可从 App 内触发）→ 下载 → `quitAndInstall` → 确认稿件保留。隔离引擎测试见 `scripts/fixtures/windows-update-main.cjs`。
- **macOS**：装旧版 → App 检查到新版 → 下载 DMG（sha256 校验）→ 打开 → 拖入 Applications → 重启 → 确认稿件保留。
- 更新前 `rooms.json` 会自动备份为 `rooms.json.before-update.bak`。

### 8. 同步 main（版本一致）
线上验证通过后，把本次发布对应的最新代码同步到 `main`，使 **SERVER 更新源 / 下载地址 / GitHub Releases / GitHub 源码四者一致**（规则见 WORKSPACE.md §1.4）：
```bash
git checkout main && git merge --ff-only <feat 分支>   # 干净时快进；否则改用普通 merge
git push origin main
git push origin <feat 分支>                             # 顺带把工作分支推上去备份
```
（`v*.*.*` tag 已在步骤 2 推送。）

### 9. 收尾
- 在 `docs/CHANGELOG.md` 记录本次发布。
- 若链路本身有变化，更新本文件。
- 官网若有下载入口变化（如本次新增 Intel 下载），更新 `landing-page/index.html` 并部署：`cd landing-page && vercel deploy --prod`；随后确认两个 Mac 下载入口（Apple Silicon 与 Intel）均解析到新版本。
- 清理 `/tmp/ci-X.Y.Z`、`/tmp/zhuang-prompter-X.Y.Z.tar.gz`。

---

## 服务器目录结构

```
/mnt/pictshare/zhuang-prompter/
├── incoming/                     # 上传暂存（可选）
├── releases/
│   ├── 0.1.5/  0.1.6/  X.Y.Z/    # 每版一个不可变包（含 updater/ 子目录）
└── channels/
    └── stable -> ../releases/X.Y.Z   # 原子切换的指针（发布即改这个软链）
```
nginx 映射见 `deploy/prompter.locations.conf`（改动后用 `scripts/deploy-nginx-conf.sh` 同步到服务器，见步骤 5b）。

## 回退
```bash
set -a; source deploy/secrets/server-ssh.env; set +a
expect deploy/lib/ssh-run.exp "$DEPLOY_SSH_HOST" "$DEPLOY_SSH_USER" "${DEPLOY_SSH_PORT:-22}" \
  "cd /mnt/pictshare/zhuang-prompter/channels && ln -sfn ../releases/<上一个稳定版> .stable.new && mv -Tf .stable.new stable && readlink stable"
```
旧版本包仍在 `releases/`，切回指针即可（秒级、无需重传）。

## 已知技术债（P5，非阻塞）
- `prepare-public-release.mjs` 的 `sourceWorkingTree` 仍硬编码 `true`；`package.json` `build.publish.url` 为扁平 `updates/stable/`，与运行时 `updates/stable/windows-<arch>/` 不一致（因 CI `--publish never` 而无害）。将来统一。
