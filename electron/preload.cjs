/* eslint-disable @typescript-eslint/no-require-imports */

const { clipboard, contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zhuangPrompter", {
  openVoiceBrowser() { return ipcRenderer.invoke("open-voice-browser"); },
  writeClipboardText(value) {
    clipboard.writeText(String(value ?? ""));
    return true;
  },
});
