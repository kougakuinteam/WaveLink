## 数据库状态

- 当前：未使用数据库
- 聊天历史/房间状态等：推测为 server 内存存储（重启会丢失）

---

## 启动方式（记录）

### 本地

1. 进入目录：

- /Users/kamikopu/Desktop/Important-data/WaveLink/wavelink_integrated

2. 安装依赖：

- `npm i`

3. 启动：

- `node server.js`

4. 访问：

- `http://localhost:3000`

5. 登入mySQL：

cd /Users/kamikopu/Desktop/Important-data/WaveLink/wavelink_integrated
export DB_HOST=127.0.0.1
export DB_PORT=8889
export DB_USER=root
export DB_PASSWORD=root
export DB_NAME=wavelink
node server.js

- `USE wavelink;`
- `SELECT message_id, room_url, sender_mail, content, created_at`
- `FROM wl_Messages`
- `ORDER BY message_id DESC;`

### ngrok（远程测试）

- `ngrok http 3000`
- 使用 ngrok 输出的 https 地址访问（WebSocket 走 wss）

---
