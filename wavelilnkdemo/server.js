const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const app = express();

// ✅ 静态文件：把 index.html 放在当前目录或子目录都行，这里用根目录
app.use(express.static(path.join(__dirname)));
app.get('/health', (_,res)=>res.send('ok'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// 房间结构：rooms: Map<roomId, Map<clientId, ws>>
const rooms = new Map();
let idSeq = 1; // 简单分配一个自增 id

// 心跳：清理僵尸连接（浏览器睡眠/断网）
const HEARTBEAT_INTERVAL = 30000; // 30s 发一次 ping
const HEARTBEAT_TIMEOUT  = 45000; // 45s 判定为超时

setInterval(()=>{
  const now = Date.now();
  wss.clients.forEach(ws=>{
    if(ws.isAlive === false){ try{ ws.terminate(); }catch{} return; }
    if(ws.lastPong && now - ws.lastPong > HEARTBEAT_TIMEOUT){ ws.isAlive=false; try{ ws.terminate(); }catch{} return; }
    ws.isAlive = true; try{ ws.ping(); }catch{}
  });
}, HEARTBEAT_INTERVAL);

wss.on('connection', (ws)=>{
  ws.id = 'c'+(idSeq++);
  ws.isAlive = true; ws.lastPong = Date.now(); ws.roomId = null;

  ws.on('pong', ()=>{ ws.lastPong = Date.now(); ws.isAlive=true; });

  ws.on('message', (buf)=>{
    let msg; try{ msg = JSON.parse(buf.toString()); }catch{ return; }
    switch(msg.type){
      case 'join': {
        const roomId = String(msg.roomId||''); if(!roomId) return;
        ws.roomId = roomId; const room = ensureRoom(roomId);
        // 1) 把“已经在房的人”先告诉新人（只有新人会发起 offer）
        const existingPeers = Array.from(room.keys());
        safeSend(ws, { type:'joined', clientId: ws.id, existingPeers });
        // 2) 把新人放进房
        room.set(ws.id, ws);
        // 3) 告诉其他人：有人来了（老成员只创建 PC，不主动 offer）
        broadcast(roomId, { type:'peer-joined', clientId: ws.id }, ws.id);
        console.log(`[room ${roomId}] + ${ws.id} 加入；现有人数：${room.size}`);
        break;
      }
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        const to = msg.to; const room = rooms.get(ws.roomId); if(!room) return;
        const target = room.get(to);
        if(target && target.readyState===WebSocket.OPEN){ safeSend(target, { ...msg, from: ws.id }); }
        break;
      }
      case 'leave': {
        handleDisconnect(ws, '客户端 leave');
        break;
      }
      default: break;
    }
  });

  ws.on('close', ()=> handleDisconnect(ws, 'WS close'));
  ws.on('error', ()=> handleDisconnect(ws, 'WS error'));
});

function ensureRoom(roomId){ if(!rooms.has(roomId)) rooms.set(roomId, new Map()); return rooms.get(roomId); }
function safeSend(ws, obj){ try{ ws && ws.readyState===WebSocket.OPEN && ws.send(JSON.stringify(obj)); }catch{} }
function broadcast(roomId, payload, excludeId=null){ const room=rooms.get(roomId); if(!room) return; const data=JSON.stringify(payload); for(const [cid,sock] of room){ if(cid===excludeId) continue; if(sock.readyState===WebSocket.OPEN){ sock.send(data); } } }

function handleDisconnect(ws, reason){
  const roomId = ws.roomId; ws.roomId = null; if(!roomId) return;
  const room = rooms.get(roomId); if(!room) return;
  if(room.has(ws.id)) room.delete(ws.id);
  broadcast(roomId, { type:'peer-left', clientId: ws.id }, ws.id);
  if(room.size===0) rooms.delete(roomId);
  console.log(`[room ${roomId}] - ${ws.id} 离开(${reason})；剩余：${room.size}`);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log('Server listening on http://localhost:'+PORT));