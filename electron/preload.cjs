/* eslint-disable @typescript-eslint/no-require-imports */

const { clipboard, contextBridge } = require("electron");

contextBridge.exposeInMainWorld("zhuangPrompter", {
  writeClipboardText(value) {
    clipboard.writeText(String(value ?? ""));
    return true;
  },
});
