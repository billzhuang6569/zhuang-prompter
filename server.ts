import { createServer } from "node:http";
import next from "next";
import { attachRoomWebSocketServer } from "./src/server/realtime/room-ws";
import { handleRoomApi } from "./src/server/http/room-api";
import { getNetworkInfo, getServerHost, getServerPort } from "./src/server/network-info";

const port = getServerPort();
const host = getServerHost();
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

void app.prepare().then(() => {
  const server = createServer((req, res) => {
    void handleRoomApi(req, res).then((handled) => {
      if (!handled) {
        void handle(req, res);
      }
    });
  });

  attachRoomWebSocketServer(server);

  server.listen(port, host, () => {
    const info = getNetworkInfo(port, host);
    console.log("Zhuang Prompter ready:");
    for (const origin of info.origins) {
      console.log(`- ${origin.label}: ${origin.origin}`);
    }
  });
});
