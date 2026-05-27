import { createServer } from "node:http";
import next from "next";
import { attachRoomWebSocketServer } from "./src/server/realtime/room-ws";
import { handleRoomApi } from "./src/server/http/room-api";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
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

  server.listen(port, () => {
    console.log(`Zhuang Prompter ready at http://localhost:${port}`);
  });
});
