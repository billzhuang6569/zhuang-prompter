# 更新日志 CHANGELOG

本文件记录每次正式发布（打 `v*.*.*` tag、部署到服务器 `channels/stable`）的版本。
发布流程见 [`docs/RELEASE.md`](./RELEASE.md)，工作区规则见 [`docs/WORKSPACE.md`](./WORKSPACE.md)。

格式：`## X.Y.Z — YYYY-MM-DD`，其下列出面向用户的改动。版本号与 `package.json`、`manifest.json`、GitHub tag 一致。

---

## 0.1.12 — 2026-09-19

**面向用户**
- 修复 **Intel(x64) Mac** 与 **ARM64 Windows** 安装包安装后启动失败：打开 App 后左上角出现窗口但点其他功能无反应，约 30 秒后弹出「庄Sir的提词器启动失败 / The local server did not start in time（本机服务未能及时启动）」。0.1.11 的这两个平台安装包受此问题影响,请升级到 0.1.12。
- **Apple Silicon Mac 与 x64 Windows 不受影响**（0.1.11 在这两个平台工作正常，可继续使用或升级）。
- 功能不变：沿用 Mac 拖拽安装、Windows 应用内更新与拍摄保护；文稿与房间数据始终留在本机。

**发布链路 / 修复细节**
- 根因：Intel Mac 与 ARM64 Windows 在**异构 runner 上交叉构建**（Intel Mac 在 arm64 的 `macos-latest`、ARM64 Windows 在 x64 的 `windows-latest`）。`pnpm install --frozen-lockfile` 默认只装 **runner 自身架构**的平台相关原生依赖,导致 x64 Mac 包里装进了 `@next/swc-darwin-arm64`（arm64 的 `.node`）而**没有 x64 版本**。x64 的 Electron 进程以 node 模式启动本机服务时 `dlopen` 该 arm64 `.node` 卡死 → Next.js 生产服务器起不来 → 触发 `waitForServer` 30 秒超时 → 启动失败弹窗。
- 雪上加霜：0.1.11 修 `ms` 崩溃时新增的 `scripts/ensure-app-deps.cjs`（`afterPack`）**架构盲**,反而把错误架构的闭包又复制进包里。
- 修复分两部分:①`pnpm-workspace.yaml` 新增 `supportedArchitectures`（os: darwin+win32、cpu: x64+arm64），令源码树装齐全部平台/架构的原生库,交叉构建时目标架构的 `.node` 可用;②`scripts/ensure-app-deps.cjs` 改为**架构感知**——只按目标架构复制原生包、剥离错误架构的,并新增**硬校验闸门**:打包时若目标架构的 `@next/swc-*` `.node` 缺失即让构建失败（本可拦下本次 bug）。
- 本地验证:交叉构建的 x64 Mac 包中仅含 x86_64 原生库（`swc-darwin-x64`/`sharp-darwin-x64`，无 arm64 残留），Rosetta 下本机服务约 6 秒启动并返回 HTTP 200（旧包会卡到 30 秒超时）。
- 服务器 `channels/stable`：由 `releases/0.1.11` 原子切换到 `releases/0.1.12`（0.1.11 保留作回退）。
- sourceCommit：见 tag `v0.1.12`。

## 0.1.11 — 2026-09-18

**面向用户**
- 彻底修复启动即崩溃（`A JavaScript error occurred in the main process / Error: Cannot find module 'ms'`）。0.1.8 / 0.1.9 / 0.1.10 四端安装包均因该缺陷无法启动，请升级到 0.1.11。
- 功能不变：覆盖 Apple Silicon 与 Intel(x64) 两种架构 Mac；Windows（x64 / ARM64）不变；沿用 Mac 拖拽安装、Windows 应用内更新与拍摄保护。

**发布链路 / 修复细节**
- 根因分两层：①源码 `node_modules` 需扁平化（`pnpm-workspace.yaml` 的 `nodeLinker: hoisted`，0.1.10 已具备）；②**即便扁平，electron-builder 依赖收集器仍会在打包阶段非确定性漏包**——0.1.10 的源码树在 CI 与本机都正确，CI 却依旧漏掉 `ms` + 50 个包（本地复现不出），导致 0.1.10 的 CI 安装包同样崩溃、**从未部署到 `channels/stable`**（stable 一直停在 0.1.8）。
- 0.1.11 真正修复：新增 `scripts/ensure-app-deps.cjs`（`build.afterPack`），打包后按源码依赖树重算生产闭包、补齐安装包内被收集器漏掉的成员（保留 pnpm 嵌套结构），并**强制校验**关键运行时依赖，缺失即让构建失败，杜绝静默产出坏包。钩子在真实 electron-builder 流水线中已验证会修复漏包（本机干净构建也曾观测到漏 ~6 个包被补回）。
- `nodeLinker: hoisted`（`pnpm-workspace.yaml`，pnpm 11 生效）与 `.npmrc` 的 `node-linker=hoisted`（本地 pnpm 10）均保留——它们保证源码树完整，是 afterPack 修复的前提。
- 服务器 `channels/stable`：由 `releases/0.1.8` 原子切换到 `releases/0.1.11`（0.1.8 保留作回退；0.1.9 / 0.1.10 损坏包保留在 `releases/` 仅作记录，从未被 stable 指向）。
- sourceCommit：见 tag `v0.1.11`。

## 0.1.10 — 2026-09-18（已废弃：CI 产物仍缺 `ms`，从未部署，请勿使用）

- 尝试用 `pnpm-workspace.yaml` 的 `nodeLinker: hoisted` 修复 0.1.8/0.1.9 的 `Cannot find module 'ms'` 崩溃。该设置确实让**源码** `node_modules` 扁平化（本机构建产物含 `ms`），但 **CI 的 electron-builder 收集器在打包阶段非确定性漏包**：同一 commit 的 CI 产物依旧缺 `ms`（含 Intel `mac-x64` DMG），四端仍会启动即崩溃。因此 0.1.10 **从未部署到服务器 `channels/stable`**（stable 仍停在 0.1.8）。已由 0.1.11（afterPack 钩子兜底）取代，详见上。

## 0.1.9 — 2026-09-18（已废弃：修复无效，请勿使用）

- 尝试用 `.npmrc`（`node-linker=hoisted`）修复 0.1.8 的 `Cannot find module 'ms'` 崩溃，但该设置不被 CI 的 pnpm 11.1.0 读取，四端产物依旧缺失 `ms`、启动即崩溃。**从未部署到服务器 `channels/stable`**（stable 仍停在 0.1.8，直到 0.1.10）。已由 0.1.10 取代，详见上。

## 0.1.8 — 2026-09-18

**面向用户**
- 新增 Intel(x64) 芯片 Mac 安装包：Intel Mac 用户可直接下载对应 DMG 并获得 App 内更新提示。
- macOS 现覆盖 Apple Silicon 与 Intel 两种架构；Windows（x64 / ARM64）不变。
- 沿用 Mac 拖拽安装、Windows 应用内更新与拍摄保护。
- 官网新增 Intel 下载入口。

**发布链路**
- CI 由 4 平台矩阵构建：mac arm64 + mac x64(Intel) + win x64 + win arm64（Intel DMG 在 `macos-latest` 上以 `electron-builder --mac --x64` 交叉构建，run artifact 新增 `desktop-mac-x64`，落到 `release/mac-x64/` 以避开 `latest-mac.yml` 冲突）。
- 新增 `scripts/deploy-nginx-conf.sh` 与 `/prompter/download/macos-x64` 下载路由；发布前用该脚本同步 `deploy/prompter.locations.conf` 到服务器。
- sourceCommit：`ea2221043ade10929be7026209930b6ad1b7846b`（tag `v0.1.8`）。

## 0.1.7 — 2026-09-17

**面向用户**
- 优化提词器「加入」体验：短链统一为 `play.local:3000`，并修复点击复制。
- 短链 / 局域网访问进入干净的播放端入口（项目画册直达播放端 + 房间号加入）。
- 控制端邀请弹窗改为短链 + 二维码。
- 控制端工具栏紧贴标题行。
- 修复主页顶部黑底异常。
- 沿用 Mac 拖拽安装、Windows 应用内更新与拍摄保护。

**发布链路**
- CI run `35232351004`（tag `v0.1.7`）构建 macOS arm64 + Windows x64 / arm64 三平台。
- 服务器 `channels/stable` 由 `releases/0.1.6` 原子切换到 `releases/0.1.7`。
- 下载 API：`/prompter/releases/latest.json`；Windows 更新源：`/prompter/updates/stable/windows-<arch>/latest.yml`。
- sourceCommit：`71b6288b8a3e2b497c56fa75b6b1d4e39653f65f`。

## 0.1.6 — 2026-09-09

- 全新阅读中线品牌 Logo，统一 Mac、Windows 与应用内视觉。
- 保留 App 内更新和拍摄保护；官网新增主控、热点与多屏同步交互演示。
- （此前版本 0.1.4 / 0.1.5 亦在服务器 `releases/` 保留，可秒级回退。）
