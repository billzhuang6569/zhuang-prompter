/* eslint-disable @typescript-eslint/no-require-imports */

const { clipboard, contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zhuangPrompter", {
  updateAction(action, value) { return ipcRenderer.invoke("update-action", action, value); },
  onUpdateState(listener) { const handler = (_event, state) => listener(state); ipcRenderer.on("update-state", handler); return () => ipcRenderer.removeListener("update-state", handler); },
  openVoiceBrowser() { return ipcRenderer.invoke("open-voice-browser"); },
  writeClipboardText(value) {
    clipboard.writeText(String(value ?? ""));
    return true;
  },
});
