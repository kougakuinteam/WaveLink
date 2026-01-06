# WaveLink 项目进度记录（PROJECT_STATUS）

更新时间：2026-01-06（JST）  
项目：/Users/kamikopu/Desktop/Important-data/WaveLink/wavelink_integrated

---

## 当前实现（已确认可运行）

- 登录 / 新规注册：页面可进入（当前为 Demo/mock 流程）
- 多人聊天：按房间（room）多人收发（WebSocket）
- 房间创建 / 加入：通过链接加入同一 room
- 通话：WebRTC P2P 1对1（设计目标）
- ngrok：前端已支持 ws/wss 自动切换（适配 https）

---

## 技术结构（来自实际扫描结果）

### 后端
- 入口：server.js
- 依赖：express@^5.1.0, ws@^8.18.3
- WebSocket 路径：`/ws`
- 逻辑关键词统计（参考用）：
  - room: 131 次
  - history: 12 次
  - broadcast: 8 次
- 已存在 1对1 限制相关关键词（YES）

### 前端
- 入口：index.html（内联脚本 1 个）
- index.html 长度：68621 chars
- WebRTC 相关：getUserMedia=YES, ontrack=YES
- audio 元素（首次匹配到的 id）：call-self-audio
- 脚本括号平衡检查：OK

---

## 已知问题（来自实际扫描/现象归类）

1. 加入房间逻辑仍存在 `prompt()`（YES）  
   - 可能导致“加入房间二次弹窗输入链接”与状态不一致

2. 使用了 `localStorage`（YES）  
   - 需要确认是否会出现“输入框空白仍加入上一次房间”的残留状态问题

3. 通话未完全成功（无对方声音）  
   - 需要确认：ontrack 是否触发、remote audio 是否绑定 srcObject、是否执行 audio.play()

4. UI 存在未使用/无功能按钮  
   - 例如发送旁的“+”等，容易造成演示误触与困惑

---

## 当前约束（产品方向）

- 聊天：多人
- 通话：P2P，仅支持 1对1（每个通话连接仅两端）
- 多个房间可并行存在；不同房间的 1对1 通话理论上可同时进行

---

## 数据库状态

- 当前：未使用数据库
- 聊天历史/房间状态等：推测为 server 内存存储（重启会丢失）

---

## 启动方式（记录）

### 本地
1) 进入目录：
- /Users/kamikopu/Desktop/Important-data/WaveLink/wavelink_integrated

2) 安装依赖：
- `npm i`

3) 启动：
- `node server.js`

4) 访问：
- `http://localhost:3000`

### ngrok（远程测试）
- `ngrok http 3000`
- 使用 ngrok 输出的 https 地址访问（WebSocket 走 wss）

---
