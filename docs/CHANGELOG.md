# 更新日志 CHANGELOG

本文件记录每次正式发布（打 `v*.*.*` tag、部署到服务器 `channels/stable`）的版本。
发布流程见 [`docs/RELEASE.md`](./RELEASE.md)，工作区规则见 [`docs/WORKSPACE.md`](./WORKSPACE.md)。

格式：`## X.Y.Z — YYYY-MM-DD`，其下列出面向用户的改动。版本号与 `package.json`、`manifest.json`、GitHub tag 一致。

---

## 0.1.9 — 2026-09-18

**面向用户**
- 修复 0.1.8 全平台一启动即崩溃的问题（`A JavaScript error occurred in the main process / Error: Cannot find module 'ms'`）。0.1.8 四端安装包因该缺陷均无法启动，请升级到 0.1.9。
- 功能与 0.1.8 一致：覆盖 Apple Silicon 与 Intel(x64) 两种架构 Mac；Windows（x64 / ARM64）不变；沿用 Mac 拖拽安装、Windows 应用内更新与拍摄保护。

**发布链路 / 修复细节**
- 根因：pnpm 默认隔离式 `node_modules` 布局下，electron-builder 未把传递依赖 `ms`（`electron-updater → builder-util-runtime → debug → ms`）收进包，导致主进程启动同步 `require` 失败。因 `node_modules` 内容与 CPU 架构无关，缺陷影响 0.1.8 全部四个平台包。
- 修复：新增根目录 `.npmrc`（`node-linker=hoisted`），让 pnpm 生成 npm 扁平式 `node_modules`，electron-builder 得以完整收录全部传递依赖。改动最小化，`pnpm-lock.yaml` 不变。已本地 `pnpm dist:dir` 打包验证：新包内含顶层 `node_modules/ms`，崩溃 require 链在打包目录中逐级解析成功。
- 服务器 `channels/stable` 由 `releases/0.1.8` 原子切换到 `releases/0.1.9`（0.1.8 损坏包保留在 `releases/` 仅作记录，不再被 stable 指向）。
- sourceCommit：见 tag `v0.1.9`。

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
