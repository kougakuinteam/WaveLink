const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'wavelink',
  connectionLimit: Number(process.env.DB_POOL || 5),
  charset: 'utf8mb4',
});

async function execute(sql, params){
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function ensureRoom(roomUrl, name){
  const roomName = name || 'room-' + roomUrl;
  const sql = `
    INSERT INTO wl_ChatRoom (room_url, name, created_at)
    VALUES (?, ?, NOW())
    ON DUPLICATE KEY UPDATE name=VALUES(name)
  `;
  await execute(sql, [roomUrl, roomName]);
}

async function insertMessage(roomUrl, senderMail, content, createdAt){
  const sql = `
    INSERT INTO wl_Messages (room_url, sender_mail, content, created_at)
    VALUES (?, ?, ?, ?)
  `;
  await execute(sql, [roomUrl, senderMail, content, createdAt]);
}

async function fetchMessages(roomUrl, limit){
  const lim = Number(limit || 200);
  const sql = `
    SELECT sender_mail, content, created_at
    FROM wl_Messages
    WHERE room_url = ?
    ORDER BY created_at DESC
    LIMIT ?
  `;
  const rows = await execute(sql, [roomUrl, lim]);
  return rows.reverse().map(r => ({
    user: r.sender_mail,
    text: r.content,
    ts: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  }));
}

async function createUser(mail, name, passwordHash, iconUrl){
  const sql = `
    INSERT INTO wl_Users (mail, name, password_hash, icon_url, room_url, created_at)
    VALUES (?, ?, ?, ?, NULL, NOW())
  `;
  await execute(sql, [mail, name, passwordHash, iconUrl || null]);
}

async function findUserByMail(mail){
  const sql = `
    SELECT mail, name, password_hash, icon_url, room_url, created_at
    FROM wl_Users
    WHERE mail = ?
    LIMIT 1
  `;
  const rows = await execute(sql, [mail]);
  return rows[0] || null;
}

async function updateUserRoom(mail, roomUrl){
  const sql = `
    UPDATE wl_Users
    SET room_url = ?
    WHERE mail = ?
  `;
  await execute(sql, [roomUrl, mail]);
}

async function updateUserProfile(oldMail, newMail, name, passwordHash){
  const fields = ['mail = ?', 'name = ?'];
  const params = [newMail, name];
  if(passwordHash){
    fields.push('password_hash = ?');
    params.push(passwordHash);
  }
  params.push(oldMail);
  const sql = `
    UPDATE wl_Users
    SET ${fields.join(', ')}
    WHERE mail = ?
  `;
  const rows = await execute(sql, params);
  return rows?.affectedRows || 0;
}

module.exports = {
  ensureRoom,
  insertMessage,
  fetchMessages,
  createUser,
  findUserByMail,
  updateUserRoom,
  updateUserProfile,
};
