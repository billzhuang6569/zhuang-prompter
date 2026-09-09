/* eslint-disable @typescript-eslint/no-require-imports */

const { app, BrowserWindow, dialog, ipcMain, session, shell } = require("electron");
const { spawn, execFile } = require("node:child_process");
const { createServer } = require("node:net");
const { get } = require("node:http");
const { join } = require("node:path");

// One server and one installed application should own the local rooms.
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) { app.quit(); }
app.on("second-instance", () => showMainWindow());

let mainWindow = null;
let serverProcess = null;
let serverOrigin = null;
function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
  else if (serverOrigin) createWindow(serverOrigin);
}

async function findAvailablePort(preferredPort) {
  for (let port = preferredPort; port < preferredPort + 20; port += 1) {
    if (await canListen(port)) {
      return port;
    }
  }
  throw new Error(`No available port near ${preferredPort}.`);
}

function canListen(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, "0.0.0.0");
  });
}

function waitForServer(origin, timeoutMs = 30_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = get(origin, (response) => {
        response.resume();
        resolve();
      });
      request.once("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error("The local server did not start in time."));
          return;
        }
        setTimeout(check, 300);
      });
      request.setTimeout(1000, () => {
        request.destroy();
      });
    };
    check();
  });
}

async function startLocalServer() {
  const port = await findAvailablePort(Number(process.env.PORT ?? 3000));
  const appPath = app.getAppPath();
  const serverEntry = join(appPath, ".desktop", "server", "server.cjs");
  const dataFile = process.env.ZHUANG_PROMPTER_STORE_FILE ?? join(app.getPath("userData"), "rooms.json");

  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: appPath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      HOST: "0.0.0.0",
      PORT: String(port),
      ZHUANG_PROMPTER_STORE_FILE: dataFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  serverProcess.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  serverProcess.once("exit", (code) => {
    if (code !== 0 && !app.isQuitting) {
      void dialog.showErrorBox("庄Sir的提词器启动失败", "本机服务已停止，请重新打开应用。");
      app.quit();
    }
  });

  const origin = `http://localhost:${port}`;
  await waitForServer(origin);
  return origin;
}

function createWindow(origin) {
  const preload = join(__dirname, "preload.cjs");

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#0b0b0b",
    title: "庄Sir的提词器",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin) || /^http:\/\/(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+):\d+/.test(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 900,
          backgroundColor: "#000000",
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload,
            sandbox: true,
          },
        },
      };
    }
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => { mainWindow = null; });
  void mainWindow.loadURL(origin);
}

ipcMain.handle("open-voice-browser", async (event) => {
  const url = new URL(event.sender.getURL());
  if (url.origin !== serverOrigin || url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || !/^\/room\/\d{6}\/control$/.test(url.pathname)) return false;
  if (process.platform !== "darwin") { await shell.openExternal(url.href); return true; }
  return new Promise(resolve => execFile("/usr/bin/open", ["-a", "Google Chrome", url.href], error => resolve(!error)));
});

app.whenReady().then(async () => {
  if (!ownsInstance) return;
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const url = webContents.getURL();
    const isLocal = url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:");
    callback(permission === "media" && isLocal);
  });

  try {
    const origin = await startLocalServer();
    serverOrigin = origin;
    createWindow(origin);
  } catch (error) {
    dialog.showErrorBox("庄Sir的提词器启动失败", error instanceof Error ? error.message : String(error));
    app.quit();
  }

  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
  serverProcess?.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
