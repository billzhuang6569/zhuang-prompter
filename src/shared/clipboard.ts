// 统一的复制到剪贴板工具（§item1）。
//
// 桌面端（Electron）里 navigator.clipboard 常因非安全上下文（http://局域网 IP、
// 自定义协议）而静默失败，导致"点击大字网址却没有复制成功"。这里按三级降级：
//   1) Electron preload 暴露的原生桥 window.zhuangPrompter.writeClipboardText；
//   2) 安全上下文下的 navigator.clipboard.writeText；
//   3) 隐藏 <textarea> + document.execCommand("copy") 兜底。
// 任一成功即返回 true，全部失败返回 false（调用方据此提示"复制失败/请手动复制"）。

type ClipboardBridgeWindow = Window & {
  zhuangPrompter?: {
    writeClipboardText?: (value: string) => boolean | void | Promise<boolean | void>;
  };
};

export async function copyTextToClipboard(value: string): Promise<boolean> {
  if (!value) {
    return false;
  }

  try {
    const bridge = (window as ClipboardBridgeWindow).zhuangPrompter;
    if (bridge?.writeClipboardText) {
      await bridge.writeClipboardText(value);
      return true;
    }
  } catch {
    // 桥失败时继续尝试浏览器剪贴板 API。
  }

  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // 继续走选区兜底。
  }

  return copyWithSelection(value);
}

function copyWithSelection(value: string): boolean {
  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.readOnly = true;
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "-9999px";
  textArea.style.opacity = "0";
  textArea.style.pointerEvents = "none";
  document.body.appendChild(textArea);

  try {
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textArea.remove();
  }
}
