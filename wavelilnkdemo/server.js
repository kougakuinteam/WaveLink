// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/** rooms: { roomId: Map<clientId, ws> } */
const rooms = new Map();

function ensureRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}

function broadcast(roomId, exceptClientId, msgObj) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(msgObj);
  for (const [cid, socket] of room.entries()) {
    if (cid !== exceptClientId && socket.readyState === WebSocket.OPEN) {
      socket.send(data);
    }
  }
}

wss.on('connection', (ws) => {
  let roomId = null;
  let clientId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      roomId = msg.roomId;
      clientId = msg.clientId;
      const room = ensureRoom(roomId);

      // 先把现有成员列表发给新加入者
      const existingPeers = Array.from(room.keys());
      ws.send(JSON.stringify({ type: 'existingPeers', peers: existingPeers }));

      // 加入房间
      room.set(clientId, ws);

      // 通知其他人：有新成员加入
      broadcast(roomId, clientId, { type: 'peer-joined', clientId });
      return;
    }

    // 纯中转：offer/answer/candidate/leave
    if (['offer', 'answer', 'candidate', 'leave'].includes(msg.type)) {
      const room = rooms.get(roomId);
      if (!room) return;
      const target = room.get(msg.to);
      if (target && target.readyState === WebSocket.OPEN) {
        target.send(JSON.stringify({ ...msg, from: clientId }));
      }
    }
  });

  ws.on('close', () => {
    if (!roomId || !clientId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.delete(clientId);
    // 通知剩余成员：有人离开
    broadcast(roomId, clientId, { type: 'peer-left', clientId });
    if (room.size === 0) rooms.delete(roomId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
});
