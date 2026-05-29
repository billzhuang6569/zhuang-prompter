# 本地局域网使用链路

## 当前链路

这台 Mac 是本地房间服务器。控制端、播放端都连接到同一个 HTTP/WebSocket 服务；需要麦克风时，使用 HTTPS/WSS 开发模式。

```text
控制端浏览器
  -> https://本机IP:3000/room/{roomCode}/control
  -> wss://本机IP:3000/ws/rooms/{roomCode}
  -> 这台 Mac 上的庄Sir的提词器服务
  -> wss://本机IP:3000/ws/rooms/{roomCode}
  -> 播放端浏览器
```

## 端口如何暴露到局域网

服务默认监听 `0.0.0.0:3000`，不是只监听 `localhost`。这意味着同一个 Wi-Fi 或同一个热点里的其他设备，可以通过 `https://本机IP:3000` 访问。

首次使用 HTTPS 开发模式：

```bash
brew install mkcert
pnpm cert:trust
pnpm cert:local
pnpm dev:https
```

`pnpm cert:trust` 需要在普通终端里输入一次 Mac 管理员密码，用来信任 mkcert 的本地 CA。`pnpm cert:local` 会把本机和当前局域网 IP 写入 `.cert/local-cert.pem`。如果更换 Wi-Fi、热点或 IP，重新运行一次。

首页会显示检测到的局域网入口，例如：

```text
https://192.168.10.12:3000
```

其他电脑打开：

```text
https://192.168.10.12:3000/room/{roomCode}/player
```

即可作为播放端进入。

## 常见检查

- 两台设备需要在同一个 Wi-Fi 或同一个热点下。
- 控制端不要把 `localhost` 链接发给其他设备，`localhost` 只代表设备自己。
- macOS 第一次弹出“允许传入网络连接”时需要允许。
- 如果打不开，先确认首页显示的局域网 IP 是否和当前 Wi-Fi/热点一致。
- 如果 3000 端口被占用，可以用 `PORT=3100 pnpm dev` 换端口，其他设备也要使用同一个端口。
- 开发模式下，Next.js 会限制局域网设备请求开发资源。本项目会自动把当前 Mac 的 IPv4 局域网地址加入 `allowedDevOrigins`；如果换网后异常，重启 `pnpm dev` 让配置重新读取新 IP。
