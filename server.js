/**
 * 时间管理 APP - 本地服务
 * 零依赖：使用 Node.js 内置的 http 与 node:sqlite（数据统一存储在本机 SQLite 文件 time.db）
 * 启动：node server.js  （或双击 start.bat）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = 3000;
const DB_PATH = path.join(__dirname, 'time.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------------- 数据库初始化 ---------------- */
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '用户',
  avatar TEXT NOT NULL DEFAULT '🙂',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS focus_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS focus_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  task_name TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  remark TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  tier INTEGER NOT NULL DEFAULT 2,          -- 1紧急(红) 2中等(黄) 3悠闲(绿)
  start_time TEXT NOT NULL,                  -- 开始时间
  deadline TEXT NOT NULL,                    -- 最迟时间
  note TEXT DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'mixed',        -- 兼容字段（喝水/睡觉已分列存储）
  enabled INTEGER NOT NULL DEFAULT 0,
  enabled_sleep INTEGER NOT NULL DEFAULT 0,  -- 睡觉提醒开关
  interval_min INTEGER DEFAULT 60,           -- 喝水间隔(分钟)
  bedtime TEXT DEFAULT '23:00',              -- 睡觉提醒时间
  water_count INTEGER NOT NULL DEFAULT 0,    -- 今日喝水杯数
  water_date TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS usage_permission (
  user_id INTEGER PRIMARY KEY,
  granted INTEGER NOT NULL DEFAULT 0,
  granted_at TEXT
);

CREATE TABLE IF NOT EXISTS app_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  app_name TEXT NOT NULL,
  minutes REAL NOT NULL DEFAULT 0,
  date TEXT NOT NULL DEFAULT (date('now','localtime'))
);
`);

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}

/* 预置两个账号（首次启动自动创建） */
function seedUsers() {
  const accounts = [
    { phone: '13800000001', password: '123456', name: '阿泽' },
    { phone: '13900000002', password: '123456', name: '备用号' },
  ];
  const stmt = db.prepare('SELECT id FROM users WHERE phone = ?');
  for (const acc of accounts) {
    if (!stmt.get(acc.phone)) {
      const salt = crypto.randomBytes(8).toString('hex');
      db.prepare('INSERT INTO users (phone, password_hash, salt, name) VALUES (?,?,?,?)')
        .run(acc.phone, hashPassword(acc.password, salt), salt, acc.name);
    }
  }
}
seedUsers();

/* ---------------- 工具 ---------------- */
function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });
}

function getUser(req) {
  const cookies = req.headers.cookie || '';
  const m = /token=([^;]+)/.exec(cookies);
  if (!m) return null;
  const row = db.prepare(
    `SELECT u.id, u.phone, u.name, u.avatar FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
  ).get(m[1]);
  return row || null;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------------- API 路由 ---------------- */
const routes = [];
function route(method, pattern, handler) {
  // /api/focus/sessions/:id  -> 正则
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:[^/]+/g, (k) => { keys.push(k.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
}

/* ---- 登录注册 ---- */
route('POST', '/api/login', async (req, res, user, body) => {
  const { phone, password } = body;
  if (!phone || !password) return json(res, 400, { error: '请输入手机号和密码' });
  const u = db.prepare('SELECT * FROM users WHERE phone = ?').get(String(phone).trim());
  if (!u || u.password_hash !== hashPassword(password, u.salt)) {
    return json(res, 401, { error: '手机号或密码错误' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, u.id);
  res.setHeader('Set-Cookie', `token=${token}; Path=/; HttpOnly; Max-Age=2592000`);
  json(res, 200, { ok: true, user: { id: u.id, phone: u.phone, name: u.name, avatar: u.avatar } });
});

route('POST', '/api/register', async (req, res, user, body) => {
  const { phone, password, name } = body;
  if (!/^1\d{10}$/.test(String(phone || ''))) return json(res, 400, { error: '请输入正确的11位手机号' });
  if (!password || String(password).length < 6) return json(res, 400, { error: '密码至少6位' });
  if (db.prepare('SELECT id FROM users WHERE phone = ?').get(phone)) {
    return json(res, 409, { error: '该手机号已注册' });
  }
  const salt = crypto.randomBytes(8).toString('hex');
  const info = db.prepare('INSERT INTO users (phone, password_hash, salt, name) VALUES (?,?,?,?)')
    .run(String(phone).trim(), hashPassword(password, salt), salt, name || '用户');
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, info.lastInsertRowid);
  res.setHeader('Set-Cookie', `token=${token}; Path=/; HttpOnly; Max-Age=2592000`);
  const u = db.prepare('SELECT id, phone, name, avatar FROM users WHERE id = ?').get(info.lastInsertRowid);
  json(res, 200, { ok: true, user: u });
});

route('POST', '/api/logout', async (req, res) => {
  const m = /token=([^;]+)/.exec(req.headers.cookie || '');
  if (m) db.prepare('DELETE FROM sessions WHERE token = ?').run(m[1]);
  res.setHeader('Set-Cookie', 'token=; Path=/; Max-Age=0');
  json(res, 200, { ok: true });
});

route('GET', '/api/me', async (req, res, user) => json(res, 200, { user }));

/* ---- 我的：修改资料 ---- */
route('POST', '/api/profile', async (req, res, user, body) => {
  const name = (body.name || '').trim();
  const avatar = body.avatar;
  if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.slice(0, 20), user.id);
  if (avatar) db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(String(avatar).slice(0, 200000), user.id);
  json(res, 200, { ok: true });
});

route('POST', '/api/phone', async (req, res, user, body) => {
  const { phone, password } = body;
  if (!/^1\d{10}$/.test(String(phone || ''))) return json(res, 400, { error: '手机号格式不正确' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  if (!password || u.password_hash !== hashPassword(password, u.salt)) {
    return json(res, 401, { error: '密码验证失败' });
  }
  if (db.prepare('SELECT id FROM users WHERE phone = ?').get(phone)) {
    return json(res, 409, { error: '该手机号已被占用' });
  }
  db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, user.id);
  json(res, 200, { ok: true });
});

/* ---- 专注 ---- */
route('GET', '/api/focus/items', async (req, res, user) => {
  json(res, 200, { items: db.prepare('SELECT * FROM focus_items WHERE user_id = ? ORDER BY id').all(user.id) });
});

route('POST', '/api/focus/items', async (req, res, user, body) => {
  const name = (body.name || '').trim();
  if (!name) return json(res, 400, { error: '名称不能为空' });
  const info = db.prepare('INSERT INTO focus_items (user_id, name) VALUES (?,?)').run(user.id, name.slice(0, 30));
  json(res, 200, { ok: true, id: info.lastInsertRowid });
});

route('DELETE', '/api/focus/items/:id', async (req, res, user, body, params) => {
  db.prepare('DELETE FROM focus_items WHERE id = ? AND user_id = ?').run(params.id, user.id);
  json(res, 200, { ok: true });
});

route('POST', '/api/focus/sessions', async (req, res, user, body) => {
  const { task_name, duration_sec, started_at } = body;
  const dur = Math.max(0, Math.round(Number(duration_sec) || 0));
  if (!task_name || dur <= 0) return json(res, 400, { error: '数据不完整' });
  db.prepare('INSERT INTO focus_sessions (user_id, task_name, duration_sec, started_at) VALUES (?,?,?,?)')
    .run(user.id, String(task_name).slice(0, 30), dur, started_at || new Date().toISOString());
  json(res, 200, { ok: true });
});

route('GET', '/api/focus/sessions', async (req, res, user) => {
  const todayRows = db.prepare(
    `SELECT task_name, SUM(duration_sec) AS total FROM focus_sessions
     WHERE user_id = ? AND date(ended_at) = date('now','localtime') GROUP BY task_name ORDER BY total DESC`
  ).all(user.id);
  const recent = db.prepare(
    `SELECT id, task_name, duration_sec, ended_at FROM focus_sessions
     WHERE user_id = ? ORDER BY ended_at DESC LIMIT 10`
  ).all(user.id);
  const week = db.prepare(
    `SELECT date(ended_at) AS d, SUM(duration_sec) AS total FROM focus_sessions
     WHERE user_id = ? AND ended_at >= datetime('now','localtime','-6 days') GROUP BY date(ended_at) ORDER BY d`
  ).all(user.id);
  json(res, 200, { today: todayRows, recent, week });
});

/* ---- 联系人 ---- */
route('GET', '/api/contacts', async (req, res, user) => {
  json(res, 200, { contacts: db.prepare('SELECT * FROM contacts WHERE user_id = ? ORDER BY id DESC').all(user.id) });
});

route('POST', '/api/contacts', async (req, res, user, body) => {
  const name = (body.name || '').trim();
  const phone = (body.phone || '').trim();
  if (!name || !phone) return json(res, 400, { error: '姓名和手机号必填' });
  if (!/^1\d{10}$/.test(phone)) return json(res, 400, { error: '手机号格式不正确' });
  // 通过手机号添加：若该手机号是本应用注册用户，则备注为"本应用用户"
  const exists = db.prepare('SELECT name FROM users WHERE phone = ?').get(phone);
  const remark = body.remark || (exists ? `本应用用户（${exists.name}）` : '');
  const info = db.prepare('INSERT INTO contacts (user_id, name, phone, remark) VALUES (?,?,?,?)')
    .run(user.id, name.slice(0, 20), phone, String(remark).slice(0, 100));
  json(res, 200, { ok: true, id: info.lastInsertRowid });
});

route('DELETE', '/api/contacts/:id', async (req, res, user, body, params) => {
  db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?').run(params.id, user.id);
  json(res, 200, { ok: true });
});

/* ---- 日程 ---- */
route('GET', '/api/schedules', async (req, res, user) => {
  json(res, 200, { schedules: db.prepare('SELECT * FROM schedules WHERE user_id = ? ORDER BY deadline ASC').all(user.id) });
});

route('POST', '/api/schedules', async (req, res, user, body) => {
  const title = (body.title || '').trim();
  const tier = parseInt(body.tier, 10);
  const { start_time, deadline } = body;
  if (!title) return json(res, 400, { error: '请输入任务名称' });
  if (![1, 2, 3].includes(tier)) return json(res, 400, { error: '请选择紧张程度' });
  if (!start_time || !deadline) return json(res, 400, { error: '请选择开始时间和最迟时间' });
  if (deadline < start_time) return json(res, 400, { error: '最迟时间不能早于开始时间' });
  const info = db.prepare(
    'INSERT INTO schedules (user_id, title, tier, start_time, deadline, note) VALUES (?,?,?,?,?,?)'
  ).run(user.id, title.slice(0, 50), tier, start_time, deadline, (body.note || '').slice(0, 200));
  json(res, 200, { ok: true, id: info.lastInsertRowid });
});

route('POST', '/api/schedules/:id/toggle', async (req, res, user, body, params) => {
  db.prepare('UPDATE schedules SET done = 1 - done WHERE id = ? AND user_id = ?').run(params.id, user.id);
  json(res, 200, { ok: true });
});

route('DELETE', '/api/schedules/:id', async (req, res, user, body, params) => {
  db.prepare('DELETE FROM schedules WHERE id = ? AND user_id = ?').run(params.id, user.id);
  json(res, 200, { ok: true });
});

/* ---- 提醒（喝水 / 睡觉）---- */
route('GET', '/api/reminders', async (req, res, user) => {
  let r = db.prepare('SELECT * FROM reminders WHERE user_id = ?').get(user.id);
  if (!r) {
    db.prepare('INSERT INTO reminders (user_id, water_date) VALUES (?,?)').run(user.id, today());
    r = db.prepare('SELECT * FROM reminders WHERE user_id = ?').get(user.id);
  }
  if (r.water_date !== today()) { // 跨天重置喝水计数
    db.prepare('UPDATE reminders SET water_count = 0, water_date = ? WHERE user_id = ?').run(today(), user.id);
    r.water_count = 0; r.water_date = today();
  }
  json(res, 200, { reminder: r });
});

route('POST', '/api/reminders', async (req, res, user, body) => {
  db.prepare('SELECT * FROM reminders WHERE user_id = ?').get(user.id) ||
    db.prepare('INSERT INTO reminders (user_id) VALUES (?)').run(user.id);
  const fields = [];
  const vals = [];
  for (const k of ['enabled', 'enabled_sleep', 'interval_min', 'bedtime', 'water_count']) {
    if (body[k] !== undefined) { fields.push(`${k} = ?`); vals.push(body[k]); }
  }
  if (fields.length) {
    vals.push(user.id);
    db.prepare(`UPDATE reminders SET ${fields.join(', ')} WHERE user_id = ?`).run(...vals);
  }
  json(res, 200, { ok: true });
});

route('POST', '/api/reminders/drink', async (req, res, user) => {
  db.prepare('SELECT * FROM reminders WHERE user_id = ?').get(user.id) ||
    db.prepare('INSERT INTO reminders (user_id, water_date) VALUES (?,?)').run(user.id, today());
  db.prepare('UPDATE reminders SET water_count = water_count + 1 WHERE user_id = ?').run(user.id);
  const r = db.prepare('SELECT water_count FROM reminders WHERE user_id = ?').get(user.id);
  json(res, 200, { ok: true, water_count: r.water_count });
});

/* ---- 使用统计 ---- */
route('GET', '/api/usage', async (req, res, user) => {
  const perm = db.prepare('SELECT granted FROM usage_permission WHERE user_id = ?').get(user.id);
  const apps = db.prepare(
    `SELECT app_name, SUM(minutes) AS minutes FROM app_usage
     WHERE user_id = ? AND date = date('now','localtime') GROUP BY app_name ORDER BY minutes DESC`
  ).all(user.id);
  const week = db.prepare(
    `SELECT date, SUM(minutes) AS minutes FROM app_usage
     WHERE user_id = ? AND date >= date('now','localtime','-6 days') GROUP BY date ORDER BY date`
  ).all(user.id);
  json(res, 200, { granted: !!(perm && perm.granted), apps, week });
});

route('POST', '/api/usage/permission', async (req, res, user, body) => {
  db.prepare(
    `INSERT INTO usage_permission (user_id, granted, granted_at) VALUES (?,?,datetime('now','localtime'))
     ON CONFLICT(user_id) DO UPDATE SET granted = excluded.granted, granted_at = excluded.granted_at`
  ).run(user.id, body.granted ? 1 : 0);
  json(res, 200, { ok: true });
});

route('POST', '/api/usage/report', async (req, res, user, body) => {
  const apps = Array.isArray(body.apps) ? body.apps : [];
  for (const a of apps) {
    const name = String(a.app_name || '').slice(0, 30);
    const min = Number(a.minutes) || 0;
    if (!name || min <= 0) continue;
    const row = db.prepare(
      `SELECT id FROM app_usage WHERE user_id = ? AND app_name = ? AND date = date('now','localtime')`
    ).get(user.id, name);
    if (row) db.prepare('UPDATE app_usage SET minutes = MAX(minutes, ?) WHERE id = ?').run(min, row.id);
    else db.prepare('INSERT INTO app_usage (user_id, app_name, minutes) VALUES (?,?,?)').run(user.id, name, min);
  }
  json(res, 200, { ok: true });
});

route('POST', '/api/usage/seed-demo', async (req, res, user) => {
  // 浏览器无法读取手机系统各 APP 的真实时长（安卓原生版可用 UsageStatsManager 实现），
  // 此处填充一份示例数据用于演示界面效果。
  const demo = { '微信': 86, '抖音': 64, 'B站': 47, '浏览器': 35, 'QQ': 22, '音乐': 18, '淘宝': 12 };
  const stmt = db.prepare(
    `INSERT INTO app_usage (user_id, app_name, minutes) VALUES (?,?,?)
     ON CONFLICT DO NOTHING`
  );
  for (const [name, min] of Object.entries(demo)) {
    const exists = db.prepare(
      `SELECT id FROM app_usage WHERE user_id = ? AND app_name = ? AND date = date('now','localtime')`
    ).get(user.id, name);
    if (!exists) db.prepare('INSERT INTO app_usage (user_id, app_name, minutes) VALUES (?,?,?)').run(user.id, name, min);
  }
  json(res, 200, { ok: true });
});

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
};
function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ---------------- 服务入口 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const user = getUser(req);
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(pathname);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => params[k] = m[i + 1]);
    const body = req.method === 'POST' || req.method === 'PUT' ? await parseBody(req) : {};
    if (!['/api/login', '/api/register'].includes(pathname) && !user) {
      return json(res, 401, { error: '请先登录' });
    }
    try { return await r.handler(req, res, user, body, params); }
    catch (e) { console.error(e); return json(res, 500, { error: '服务器内部错误' }); }
  }
  json(res, 404, { error: '接口不存在' });
});

server.listen(PORT, () => {
  console.log('========================================');
  console.log('  时间管理 APP 已启动');
  console.log(`  请用浏览器打开: http://localhost:${PORT}`);
  console.log('  账号1: 13800000001  密码: 123456');
  console.log('  账号2: 13900000002  密码: 123456');
  console.log('  按 Ctrl+C 可停止服务');
  console.log('========================================');
});
