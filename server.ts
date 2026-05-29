import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import next from "next";
import { attachRoomWebSocketServer, broadcastRoomState } from "./src/server/realtime/room-ws";
import { handleRoomApi } from "./src/server/http/room-api";
import { getNetworkInfo, getServerHost, getServerPort, isHttpsEnabled } from "./src/server/network-info";

const port = getServerPort();
const host = getServerHost();
const httpsEnabled = isHttpsEnabled();
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

void app.prepare().then(() => {
  const requestListener = (req: IncomingMessage, res: ServerResponse) => {
    void handleRoomApi(req, res, broadcastRoomState).then((handled) => {
      if (!handled) {
        void handle(req, res);
      }
    });
  };

  const server = httpsEnabled
    ? createHttpsServer(
        {
          key: readFileSync(process.env.SSL_KEY_FILE ?? ".cert/local-key.pem"),
          cert: readFileSync(process.env.SSL_CERT_FILE ?? ".cert/local-cert.pem"),
        },
        requestListener,
      )
    : createHttpServer(requestListener);

  attachRoomWebSocketServer(server);

  server.listen(port, host, () => {
    const info = getNetworkInfo(port, host);
    console.log(`Zhuang Prompter ready (${httpsEnabled ? "HTTPS/WSS" : "HTTP/WS"}):`);
    for (const origin of info.origins) {
      console.log(`- ${origin.label}: ${origin.origin}`);
    }
  });
});
