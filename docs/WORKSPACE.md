# 工作区规则（所有 thread 必读）

本文件定义本工作区的**协作与文档规则**。任何 thread（人或 AI）在本仓库做优化、修复、发布前，先读本文件与 [`docs/RELEASE.md`](./RELEASE.md)。

## 0. 工作区位置（重要）

- 本项目的**唯一正确工作目录**：`/Users/billzhuang/Documents/AI Workspace/codex/zhuangsir-prompter`
- **不要**在 `/Users/billzhuang/Documents/庄Sir的提词器` 下工作（那是旧的/无关目录）。
- 某些 shell 会把 cwd 重置到错误目录；每条命令前显式 `cd "/Users/billzhuang/Documents/AI Workspace/codex/zhuangsir-prompter" && …`。

## 1. 硬性约束（不可违反）

1. **不要替换 `/Applications` 里的已安装版本**——那是用户现场使用/回退用的稳定版。本地构建产物只放在 `release/`（已 gitignore）。
2. **保护 `rooms.json`**（用户数据）。不要删除、覆盖或提交它。App 更新前会自动备份为 `rooms.json.before-update.bak`。
3. **机密永不进仓库**。服务器 SSH 凭据只存在 `deploy/secrets/`（已 gitignore）。见 §4。
4. **`main` 与线上版本保持一致**。日常改动在 `feat/*` 分支；发布通过打 `v*.*.*` tag 触发 CI（见 `docs/RELEASE.md`）。**一旦 App 被正式发布到 SERVER（`channels/stable` 已切到新版并线上验证通过），就把该版本对应的最新代码同步到 `main`**（干净时快进，否则合并），使 **SERVER 更新源 / 下载地址 / GitHub Releases / GitHub 源码四者版本一致**。发布完成前不要把未发布代码推到 `main`。
5. **不提交 `docs/plans/`**（本地工作计划，已按约定不纳入版本库）。
6. **验收不等于编译通过**。合入前跑完整闸门：`npx tsc --noEmit`、`pnpm lint`、`pnpm test:contracts`（见 §3）。

## 2. 目录与文档职责

| 路径 | 作用 | 是否提交 |
|---|---|---|
| `docs/WORKSPACE.md` | 本文件：工作区规则（本文件是规则的唯一来源） | 是 |
| `docs/RELEASE.md` | 发布/更新链路 runbook（构建→CI→上传→切换→验证→App 内更新测试）。目标输出格式=四平台：mac arm64 + mac x64(Intel) + win x64 + win arm64 | 是 |
| `docs/CHANGELOG.md` | 每次发布的版本记录 | 是 |
| `docs/release-packaging.md` | electron-builder 打包细节参考（含 pnpm 依赖收集陷阱） | 是 |
| `pnpm-workspace.yaml` | **`nodeLinker: hoisted`（CI 的 pnpm 11 认这个，决定线上产物能否收全传递依赖 `ms`）** + 构建脚本审批 `allowBuilds`/`ignoredBuiltDependencies`。勿删 nodeLinker、勿删审批。见 RELEASE.md §打包陷阱 | 是 |
| `.npmrc` | `node-linker=hoisted`（仅本机 pnpm 10 认；pnpm 11 忽略）。保留但不决定线上产物 | 是 |
| `docs/landing-page/` | 官网（独立 Vercel 部署，不属于 App 发布链路） | 否（gitignore） |
| `docs/plans/` | 本地工作计划草稿 | 否（gitignore） |
| `deploy/prompter.locations.conf` | 服务器 nginx location 映射（真实来源）；下载短链路由 `/prompter/download/{macos-arm64,macos-x64,windows-x64,windows-arm64}` | 是 |
| `scripts/deploy-nginx-conf.sh` | 部署 `deploy/prompter.locations.conf` 到服务器 nginx snippet（备份→测试→reload→校验），改下载/更新 API 后用它 | 是 |
| `deploy/lib/*.exp` | 密码认证的 ssh/scp expect 助手 | 是 |
| `deploy/secrets/` | 服务器凭据（机密） | **否（gitignore）** |
| `scripts/prepare-public-release.mjs` | 打发布包 `release/public/<version>/` | 是 |
| `scripts/deploy-release.sh` | 发布"最后一公里"：上传 + 原子切换指针 | 是 |
| `release/` | 本地构建产物 | 否（gitignore） |

## 3. 验收闸门（改代码后必跑）

```bash
cd "/Users/billzhuang/Documents/AI Workspace/codex/zhuangsir-prompter"
npx tsc --noEmit          # 0 error
pnpm lint                 # 0 error（3 个既有 <img> logo warning 可接受）
pnpm test:contracts       # 全绿
```

需要现场自测时构建未打包版本：`pnpm dist:dir`，从 `release/mac-arm64/庄Sir的提词器.app` 启动（首启会下载 swc，属正常）。

**发布相关改动（改依赖 / 改打包配置 / 发版）额外一关**：本机默认 pnpm 10，与 CI 的 pnpm 11 行为不同（`.npmrc` 的 `node-linker` pnpm 11 不认）。打 tag 前用 CI 相同版本复现，确认扁平化布局收全传递依赖：
```bash
corepack pnpm@11.1.0 install --frozen-lockfile   # 退出 0
ls -d node_modules/ms node_modules/debug         # 真实目录，非 .pnpm symlink
```
这是 0.1.8/0.1.9 启动即崩（`Cannot find module 'ms'`）的根因，详见 `docs/RELEASE.md` §打包陷阱。

## 4. 服务器凭据的读取位置

- 文件：`deploy/secrets/server-ssh.env`（已 gitignore，切勿提交/打印到日志）。
- 读取：`set -a; source deploy/secrets/server-ssh.env; set +a`
- 提供：`DEPLOY_SSH_HOST` / `DEPLOY_SSH_USER` / `DEPLOY_SSH_PASSWORD` / `DEPLOY_SSH_PORT` / `DEPLOY_REMOTE_ROOT`
- 该服务器是 `bill-api.whatonearth.work` 的源站，磁盘根 `/mnt/pictshare/zhuang-prompter/`。
- 若本机 DNS 把 `bill-api.whatonearth.work` 解析到 `198.18.x.x` 等假 IP，那是本机代理的 fake-IP，不影响；源站以 `DEPLOY_SSH_HOST` 为准。

## 5. 每个 thread 的工作流程

1. 读 `docs/WORKSPACE.md` + `docs/RELEASE.md`。
2. 在 `feat/*` 分支上改动；小步提交。
3. 跑 §3 闸门。
4. 需发布时：按 `docs/RELEASE.md` 打 tag→CI→下载→打包→部署→验证→App 内更新测试。
5. **发布并线上验证通过后**：把该版本的最新代码同步到 `main`（见 §1.4），保证四端版本一致。
6. 若发布链路本身有变化：**同步更新 `docs/RELEASE.md`**，并在 `docs/CHANGELOG.md` 记录版本。
7. 机密只从 `deploy/secrets/` 读，绝不写入代码/文档/日志/提交。
