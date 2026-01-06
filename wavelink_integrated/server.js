const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const app = express();
app.use(express.static(path.join(__dirname)));
app.get('/health', (_, res) => res.send('ok'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

/**
 * room state:
 * rooms: Map<roomId, { clients: Map<clientId, ws>, voice: Map<clientId, ws>, history: Array }>
 * - clients: everyone in chat room (multi)
 * - voice: participants currently in 1:1 voice session (max 2)
 */
const rooms = new Map();
let idSeq = 1;

const MAX_VOICE_PEERS = 2;

// helper
function ensureRoom(roomId){
  if(!rooms.has(roomId)){
    rooms.set(roomId, { clients:new Map(), voice:new Map(), history:[] });
  }
  return rooms.get(roomId);
}

function safeSend(ws, obj){
  try{
    if(ws && ws.readyState === WebSocket.OPEN){
      ws.send(JSON.stringify(obj));
    }
  }catch(e){}
}

function broadcast(roomId, payload, excludeId=null, scope='clients'){
  const room = rooms.get(roomId);
  if(!room) return;
  const targetMap = scope === 'voice' ? room.voice : room.clients;
  const data = JSON.stringify(payload);
  for(const [cid, sock] of targetMap){
    if(excludeId && cid === excludeId) continue;
    if(sock.readyState === WebSocket.OPEN) sock.send(data);
  }
}

// heartbeat
const HEARTBEAT_INTERVAL = 30000;
const HEARTBEAT_TIMEOUT = 45000;
setInterval(() => {
  const now = Date.now();
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch {}
      return;
    }
    if (ws.lastPong && now - ws.lastPong > HEARTBEAT_TIMEOUT) {
      ws.isAlive = false;
      try { ws.terminate(); } catch {}
      return;
    }
    ws.isAlive = true;
    try { ws.ping(); } catch {}
  });
}, HEARTBEAT_INTERVAL);

wss.on('connection', (ws) => {
  ws.id = 'c' + (idSeq++);
  ws.isAlive = true;
  ws.lastPong = Date.now();
  ws.roomId = null;

  ws.on('pong', () => { ws.lastPong = Date.now(); ws.isAlive = true; });

  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    switch (msg.type) {
      // join chat room (multi)
      case 'join': {
        const roomId = String(msg.roomId || '').trim();
        const mode = String(msg.mode || 'chat');

        if (!roomId) return;
        const room = ensureRoom(roomId);

        // always join clients (multi)
        if(ws.roomId && ws.roomId !== roomId){
          // auto-leave previous room (clients + voice)
          leaveRoom(ws, 'switch-room');
        }
        ws.roomId = roomId;
        room.clients.set(ws.id, ws);

        safeSend(ws, { type:'joined', clientId: ws.id, roomId, mode });

        // auto send history for chat joins
        if(mode !== 'voice1to1'){
          safeSend(ws, { type:'history-data', roomId, items: room.history });
        }

        // notify other chat clients
        broadcast(roomId, { type:'peer-joined', clientId: ws.id, roomId, mode }, ws.id, 'clients');
        console.log(`[room ${roomId}] + ${ws.id} joined(${mode}); clients=${room.clients.size} voice=${room.voice.size}`);
        break;
      }

      // request history explicitly
      case 'history': {
        const roomId = String(msg.roomId || ws.roomId || '').trim();
        if(!roomId) return;
        const room = ensureRoom(roomId);
        safeSend(ws, { type:'history-data', roomId, items: room.history });
        break;
      }

      // chat message -> store + broadcast to chat clients
      case 'chat': {
        const roomId = String(ws.roomId || msg.roomId || '').trim();
        if(!roomId) return;
        const room = ensureRoom(roomId);

        const user = String(msg.user || 'anon').slice(0, 64);
        const text = String(msg.text || '');
        if(!text.trim()) return;

        const item = { user, text, ts: Date.now() };
        room.history.push(item);
        if(room.history.length > 200) room.history.shift();

        broadcast(roomId, { type:'chat', roomId, item }, null, 'clients');
        break;
      }

      // enter 1:1 voice session in this room
      case 'voice-join': {
        const roomId = String(ws.roomId || msg.roomId || '').trim();
        if(!roomId) return;
        const room = ensureRoom(roomId);

        // ensure ws.roomId for signaling + cleanup on close
        if(ws.roomId && ws.roomId !== roomId){
          leaveRoom(ws, 'switch-room');
        }
        ws.roomId = roomId;

        if(room.voice.has(ws.id)){
          safeSend(ws, { type:'voice-joined', roomId, clientId: ws.id, existingPeers: Array.from(room.voice.keys()).filter(x=>x!==ws.id) });
          return;
        }

        if(room.voice.size >= MAX_VOICE_PEERS){
          safeSend(ws, { type:'room-full', roomId, size: room.voice.size });
          return;
        }

        room.voice.set(ws.id, ws);
        safeSend(ws, { type:'voice-joined', roomId, clientId: ws.id, existingPeers: Array.from(room.voice.keys()).filter(x=>x!==ws.id) });
        broadcast(roomId, { type:'voice-peer-joined', roomId, clientId: ws.id }, ws.id, 'voice');
        console.log(`[room ${roomId}] voice + ${ws.id}; voice=${room.voice.size}`);
        break;
      }

      case 'voice-leave': {
        const roomId = String(ws.roomId || msg.roomId || '').trim();
        if(!roomId) return;
        const room = rooms.get(roomId);
        if(!room) return;
        if(room.voice.has(ws.id)){
          room.voice.delete(ws.id);
          broadcast(roomId, { type:'voice-peer-left', roomId, clientId: ws.id }, ws.id, 'voice');
          console.log(`[room ${roomId}] voice - ${ws.id}; voice=${room.voice.size}`);
        }
        break;
      }

      // webrtc signaling within voice peers
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        const roomId = String(ws.roomId || msg.roomId || '').trim();
        const to = String(msg.to || '').trim();
        if(!roomId || !to) return;
        const room = rooms.get(roomId);
        if(!room) return;
        const target = room.voice.get(to); // only voice peers can receive signaling
        if (target && target.readyState === WebSocket.OPEN) {
          safeSend(target, { ...msg, from: ws.id, roomId });
        }
        break;
      }

      case 'leave': {
        leaveRoom(ws, 'client leave');
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => leaveRoom(ws, 'ws close'));
  ws.on('error', () => leaveRoom(ws, 'ws error'));
});

function leaveRoom(ws, reason){
  const roomId = ws.roomId;
  ws.roomId = null;
  if(!roomId) return;

  const room = rooms.get(roomId);
  if(!room) return;

  const wasClient = room.clients.delete(ws.id);
  const wasVoice = room.voice.delete(ws.id);

  if(wasClient){
    broadcast(roomId, { type:'peer-left', clientId: ws.id, roomId }, ws.id, 'clients');
  }
  if(wasVoice){
    broadcast(roomId, { type:'voice-peer-left', clientId: ws.id, roomId }, ws.id, 'voice');
  }

  if(room.clients.size === 0 && room.voice.size === 0){
    rooms.delete(roomId);
  }

  console.log(`[room ${roomId}] - ${ws.id} left(${reason}); clients=${room.clients.size} voice=${room.voice.size}`);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server listening on http://localhost:' + PORT));
