/**
 * Wavelink Signaling Server (mesh, 5–6 peers OK)
 * - HTTPS server to provide index.html and upgrade to WebSocket.
 * - WS path: /ws
 */

// Final debugging version with microscopic logging in broadcast function.

const https = require("https");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

console.log("Server script starting...");

process.on("uncaughtException", (err, origin) => {
  console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.error("!!!!!!!!!! UNCAUGHT EXCEPTION !!!!!!!!!!!!!!");
  console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.error(`Caught exception: ${err}\n` + `Exception origin: ${origin}`);
  console.error(err.stack);
});

const PORT = 3001;
const WS_PATH = "/ws";
const MAX_ROOM_SIZE = 12;

let options;
try {
  console.log("Reading SSL certificate files...");
  options = {
    key: fs.readFileSync(path.join(__dirname, "..", "key.pem")),
    cert: fs.readFileSync(path.join(__dirname, "..", "cert.pem")),
  };
  console.log("SSL certificate files read successfully.");
} catch (e) {
  console.error(
    "\n!!! ERROR: Could not read SSL certificate files (key.pem, cert.pem) !!!"
  );
  process.exit(1);
}

const server = https.createServer(options, (req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    const indexPath = path.join(__dirname, "..", "index.html");
    fs.readFile(indexPath, (err, data) => {
      if (err) {
        console.error("HTTP Error: Could not read index.html:", err);
        res.writeHead(500);
        res.end("Error loading index.html");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocket.Server({ noServer: true, path: WS_PATH });

const rooms = new Map();
function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}

function broadcastRoom(roomId, data, exceptId = null) {
  const room = rooms.get(roomId);
  if (!room) {
    console.log(`BROADCAST: Broadcast failed, room ${roomId} does not exist.`);
    return;
  }
  console.log(
    `BROADCAST: Broadcasting '${data.type}' to room ${roomId} (size: ${
      room.size
    }). Except for ${exceptId || "none"}.`
  );

  for (const [cid, info] of room.entries()) {
    console.log(`--> BROADCAST LOOP: Checking client ${cid}.`);
    if (cid === exceptId) {
      console.log(`--> BROADCAST LOOP: Skipping ${cid} (it is the sender).`);
      continue;
    }

    if (info.ws.readyState === WebSocket.OPEN) {
      console.log(`--> BROADCAST LOOP: Sending to ${cid}...`);
      try {
        info.ws.send(JSON.stringify(data));
        console.log(`--> BROADCAST LOOP: Sent successfully to ${cid}.`);
      } catch (e) {
        console.error(
          `--> BROADCAST LOOP: FAILED to send to client ${cid}:`,
          e.message
        );
      }
    } else {
      console.log(
        `--> BROADCAST LOOP: SKIPPING send to client ${cid} because state is not OPEN (state: ${info.ws.readyState}).`
      );
    }
  }
  console.log(`BROADCAST: Broadcast for room ${roomId} finished.`);
}

function safeSend(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch (e) {
    console.error("SAFE_SEND Error:", e.message);
  }
}

function leave(ws, code = 1000, reason = "bye") {
  if (!ws._joined) return;
  const { roomId, clientId, name } = ws._joined;
  console.log(
    `LEAVE: Client ${clientId} (${name}) is leaving room ${roomId}. Reason: ${reason}`
  );
  const room = rooms.get(roomId);
  if (room) {
    room.delete(clientId);
    if (room.size === 0) {
      console.log(`LEAVE: Room ${roomId} is now empty, deleting.`);
      rooms.delete(roomId);
    }
  }
  broadcastRoom(
    roomId,
    { type: "peer-leave", roomId, clientId, name },
    clientId
  );
  ws._joined = null;
  try {
    ws.close(code, reason);
  } catch {}
}

wss.on("connection", (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`CONNECTION: New client connected from ${clientIp}`);
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (raw) => {
    try {
      console.log(`MESSAGE: Received raw message: ${raw}`);
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (e) {
        console.error(`MESSAGE Error: Failed to parse JSON:`, e.message);
        return;
      }

      if (msg.type === "join") {
        const roomId = String(msg.roomId || "").trim();
        const name = String(msg.name || "").trim() || "guest";
        if (!roomId) {
          return safeSend(ws, { type: "error", error: "roomId required" });
        }
        const room = getRoom(roomId);
        if (room.size >= MAX_ROOM_SIZE) {
          return safeSend(ws, { type: "full", roomId, max: MAX_ROOM_SIZE });
        }
        const clientId = genId();
        ws._joined = { roomId, clientId, name };
        room.set(clientId, { ws, name });
        console.log(
          `JOIN: Client ${clientId} (${name}) joined room ${roomId}.`
        );

        const peers = [...room.entries()]
          .filter(([cid]) => cid !== clientId)
          .map(([cid, info]) => ({ clientId: cid, name: info.name }));
        safeSend(ws, { type: "joined", roomId, clientId, name, peers });

        broadcastRoom(roomId, { type: 'peer-joined', roomId, clientId, name }, clientId);
        console.log(
          `JOIN: Finished processing 'join' message for ${clientId}.`
        );
        return;
      }

      if (!ws._joined) {
        return;
      }

      const { roomId, clientId } = ws._joined;

      if (msg.type === "leave") {
        return leave(ws, 1000, "manual leave");
      }

      if (msg.type === "offer" || msg.type === "answer" || msg.type === "ice") {
        const to = String(msg.to || "");
        console.log(`P2P: Forwarding '${msg.type}' from ${clientId} to ${to}`);
        const room = rooms.get(roomId);
        if (!room || !room.has(to)) return;
        const peer = room.get(to).ws;
        if (peer.readyState !== WebSocket.OPEN) return;
        const payload = { ...msg, from: clientId, roomId };
        safeSend(peer, payload);
        return;
      }
    } catch (e) {
      console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      console.error("!!!!!!!!!! UNCAUGHT ERROR IN ON_MESSAGE !!!!!!!!!!");
      console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      console.error(e);
    }
  });

  ws.on("close", (code, reason) => {
    console.log(
      `CLOSE: Client from ${clientIp} disconnected. Code: ${code}, Reason: ${String(
        reason
      )}`
    );
    leave(ws, code, `closed: ${reason}`);
  });

  ws.on("error", (err) => {
    console.error(
      `ERROR: An error occurred for client ${clientIp}:`,
      err.message
    );
    leave(ws, 1011, `error: ${err.message}`);
  });
});

server.on("upgrade", (req, socket, head) => {
  console.log(`UPGRADE: Received upgrade request for ${req.url}`);
  if (!req.url.startsWith(WS_PATH)) {
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

// Heartbeat temporarily disabled.

server.listen(PORT, "0.0.0.0", () => {
  console.log("----------------------------------------------------------");
  console.log(`✅ Server is ready and listening on https://0.0.0.0:${PORT}`);
  console.log("----------------------------------------------------------");
});
