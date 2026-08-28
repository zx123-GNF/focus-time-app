/**
 * 本地数据层（安卓 APP 内置版）
 * 手机上没有 Node 服务，这里用 sql.js（SQLite 的 WebAssembly 版）在应用内部
 * 实现与电脑版 server.js 完全相同的 API，数据仍以 SQLite 格式存在手机本地。
 * 仅在 Capacitor 原生环境下启用（window.LocalAPI.enabled = true）。
 */
(function () {
  const enabled = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  window.LocalAPI = { enabled, ready: false, _db: null };

  const LS_KEY = 'focustime_sqlite_db';
  const LS_UID = 'focustime_uid';

  /* ---------- 工具 ---------- */
  function nowStr() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  function todayStr() {
    return nowStr().slice(0, 10);
  }
  async function sha256(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function randSalt() {
    const a = new Uint8Array(8); crypto.getRandomValues(a);
    return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ---------- 数据库装载与持久化 ---------- */
  async function loadDB() {
    const SQL = await initSqlJs({ locateFile: f => f });
    let db;
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      const bin = Uint8Array.from(atob(saved), c => c.charCodeAt(0));
      db = new SQL.Database(bin);
    } else {
      db = new SQL.Database();
      createSchema(db);
      await seed(db);
      persist(db);
    }
    window.LocalAPI._db = db;
    window.LocalAPI.ready = true;
  }

  function createSchema(db) {
    db.run(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, salt TEXT NOT NULL, name TEXT NOT NULL DEFAULT '用户',
      avatar TEXT NOT NULL DEFAULT '🙂', created_at TEXT NOT NULL);
    CREATE TABLE focus_items (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE focus_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, task_name TEXT NOT NULL,
      duration_sec INTEGER NOT NULL, started_at TEXT NOT NULL, ended_at TEXT NOT NULL);
    CREATE TABLE contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL,
      phone TEXT NOT NULL, remark TEXT DEFAULT '', created_at TEXT NOT NULL);
    CREATE TABLE schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL,
      tier INTEGER NOT NULL DEFAULT 2, start_time TEXT NOT NULL, deadline TEXT NOT NULL, note TEXT DEFAULT '',
      done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL DEFAULT 'mixed',
      enabled INTEGER NOT NULL DEFAULT 0, enabled_sleep INTEGER NOT NULL DEFAULT 0, interval_min INTEGER DEFAULT 60,
      bedtime TEXT DEFAULT '23:00', water_count INTEGER NOT NULL DEFAULT 0, water_date TEXT DEFAULT '');
    CREATE TABLE usage_permission (user_id INTEGER PRIMARY KEY, granted INTEGER NOT NULL DEFAULT 0, granted_at TEXT);
    CREATE TABLE app_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, app_name TEXT NOT NULL,
      minutes REAL NOT NULL DEFAULT 0, date TEXT NOT NULL);
    `);
  }

  async function seed(db) {
    const now = nowStr();
    for (const acc of [
      { phone: '13800000001', name: '阿泽' },
      { phone: '13900000002', name: '备用号' },
    ]) {
      const salt = randSalt();
      const hash = await sha256(salt + '123456');
      db.run('INSERT INTO users (phone, password_hash, salt, name, created_at) VALUES (?,?,?,?,?)',
        [acc.phone, hash, salt, acc.name, now]);
    }
  }

  let saveTimer = null;
  function persist(db, immediate) {
    const doSave = () => {
      try {
        const data = db.export();
        let bin = '';
        for (const b of data) bin += String.fromCharCode(b);
        localStorage.setItem(LS_KEY, btoa(bin));
      } catch (e) { console.error('本地数据保存失败', e); }
    };
    clearTimeout(saveTimer);
    if (immediate) doSave(); else saveTimer = setTimeout(doSave, 300);
  }

  /* ---------- 查询辅助 ---------- */
  function all(db, sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }
  function get(db, sql, params = []) { return all(db, sql, params)[0] || null; }
  function run(db, sql, params = []) {
    db.run(sql, params);
    const r = all(db, 'SELECT last_insert_rowid() AS id')[0];
    return { lastInsertRowid: r ? r.id : null };
  }

  function currentUser() {
    const uid = parseInt(localStorage.getItem(LS_UID) || '0', 10);
    if (!uid) return null;
    return get(db(), 'SELECT id, phone, name, avatar FROM users WHERE id = ?', [uid]);
  }
  function db() { return window.LocalAPI._db; }
  function needUser() {
    const u = currentUser();
    if (!u) throw new Error('请先登录');
    return u;
  }

  /* ---------- API 实现 ---------- */
  const handlers = {
    'POST /api/login': async (b) => {
      if (!b.phone || !b.password) throw new Error('请输入手机号和密码');
      const u = get(db(), 'SELECT * FROM users WHERE phone = ?', [String(b.phone).trim()]);
      const hash = u ? await sha256(u.salt + b.password) : '';
      if (!u || u.password_hash !== hash) throw new Error('手机号或密码错误');
      localStorage.setItem(LS_UID, String(u.id));
      return { ok: true, user: { id: u.id, phone: u.phone, name: u.name, avatar: u.avatar } };
    },
    'POST /api/register': async (b) => {
      if (!/^1\d{10}$/.test(String(b.phone || ''))) throw new Error('请输入正确的11位手机号');
      if (!b.password || String(b.password).length < 6) throw new Error('密码至少6位');
      if (get(db(), 'SELECT id FROM users WHERE phone = ?', [b.phone])) throw new Error('该手机号已注册');
      const salt = randSalt();
      const hash = await sha256(salt + b.password);
      const info = run(db(), 'INSERT INTO users (phone, password_hash, salt, name, created_at) VALUES (?,?,?,?,?)',
        [String(b.phone).trim(), hash, salt, b.name || '用户', nowStr()]);
      localStorage.setItem(LS_UID, String(info.lastInsertRowid));
      persist(db(), true);
      const u = get(db(), 'SELECT id, phone, name, avatar FROM users WHERE id = ?', [info.lastInsertRowid]);
      return { ok: true, user: u };
    },
    'POST /api/logout': async () => { localStorage.removeItem(LS_UID); return { ok: true }; },
    'GET /api/me': async () => ({ user: currentUser() }),

    'POST /api/profile': async (b) => {
      const u = needUser();
      if (b.name) run(db(), 'UPDATE users SET name = ? WHERE id = ?', [String(b.name).trim().slice(0, 20), u.id]);
      if (b.avatar) run(db(), 'UPDATE users SET avatar = ? WHERE id = ?', [String(b.avatar).slice(0, 200000), u.id]);
      persist(db());
      return { ok: true };
    },
    'POST /api/phone': async (b) => {
      const u = needUser();
      if (!/^1\d{10}$/.test(String(b.phone || ''))) throw new Error('手机号格式不正确');
      const full = get(db(), 'SELECT * FROM users WHERE id = ?', [u.id]);
      const hash = await sha256(full.salt + (b.password || ''));
      if (full.password_hash !== hash) throw new Error('密码验证失败');
      if (get(db(), 'SELECT id FROM users WHERE phone = ?', [b.phone])) throw new Error('该手机号已被占用');
      run(db(), 'UPDATE users SET phone = ? WHERE id = ?', [b.phone, u.id]);
      persist(db());
      return { ok: true };
    },

    'GET /api/focus/items': async () => {
      const u = needUser();
      return { items: all(db(), 'SELECT * FROM focus_items WHERE user_id = ? ORDER BY id', [u.id]) };
    },
    'POST /api/focus/items': async (b) => {
      const u = needUser();
      const name = (b.name || '').trim();
      if (!name) throw new Error('名称不能为空');
      const info = run(db(), 'INSERT INTO focus_items (user_id, name, created_at) VALUES (?,?,?)', [u.id, name.slice(0, 30), nowStr()]);
      persist(db());
      return { ok: true, id: info.lastInsertRowid };
    },
    'DELETE /api/focus/items/': async (b, path) => {
      const u = needUser();
      run(db(), 'DELETE FROM focus_items WHERE id = ? AND user_id = ?', [Number(path.split('/').pop()), u.id]);
      persist(db());
      return { ok: true };
    },
    'POST /api/focus/sessions': async (b) => {
      const u = needUser();
      const dur = Math.max(0, Math.round(Number(b.duration_sec) || 0));
      if (!b.task_name || dur <= 0) throw new Error('数据不完整');
      run(db(), 'INSERT INTO focus_sessions (user_id, task_name, duration_sec, started_at, ended_at) VALUES (?,?,?,?,?)',
        [u.id, String(b.task_name).slice(0, 30), dur, b.started_at || nowStr(), nowStr()]);
      persist(db());
      return { ok: true };
    },
    'GET /api/focus/sessions': async () => {
      const u = needUser();
      return {
        today: all(db(), `SELECT task_name, SUM(duration_sec) AS total FROM focus_sessions
          WHERE user_id = ? AND substr(ended_at,1,10) = ? GROUP BY task_name ORDER BY total DESC`, [u.id, todayStr()]),
        recent: all(db(), 'SELECT id, task_name, duration_sec, ended_at FROM focus_sessions WHERE user_id = ? ORDER BY ended_at DESC LIMIT 10', [u.id]),
        week: all(db(), `SELECT substr(ended_at,1,10) AS d, SUM(duration_sec) AS total FROM focus_sessions
          WHERE user_id = ? AND ended_at >= datetime('now','-6 days') GROUP BY substr(ended_at,1,10) ORDER BY d`, [u.id]),
      };
    },

    'GET /api/contacts': async () => {
      const u = needUser();
      return { contacts: all(db(), 'SELECT * FROM contacts WHERE user_id = ? ORDER BY id DESC', [u.id]) };
    },
    'POST /api/contacts': async (b) => {
      const u = needUser();
      const name = (b.name || '').trim(), phone = (b.phone || '').trim();
      if (!name || !phone) throw new Error('姓名和手机号必填');
      if (!/^1\d{10}$/.test(phone)) throw new Error('手机号格式不正确');
      const exists = get(db(), 'SELECT name FROM users WHERE phone = ?', [phone]);
      const remark = b.remark || (exists ? `本应用用户（${exists.name}）` : '');
      const info = run(db(), 'INSERT INTO contacts (user_id, name, phone, remark, created_at) VALUES (?,?,?,?,?)',
        [u.id, name.slice(0, 20), phone, String(remark).slice(0, 100), nowStr()]);
      persist(db());
      return { ok: true, id: info.lastInsertRowid };
    },
    'DELETE /api/contacts/': async (b, path) => {
      const u = needUser();
      run(db(), 'DELETE FROM contacts WHERE id = ? AND user_id = ?', [Number(path.split('/').pop()), u.id]);
      persist(db());
      return { ok: true };
    },

    'GET /api/schedules': async () => {
      const u = needUser();
      return { schedules: all(db(), 'SELECT * FROM schedules WHERE user_id = ? ORDER BY deadline ASC', [u.id]) };
    },
    'POST /api/schedules': async (b) => {
      const u = needUser();
      const title = (b.title || '').trim();
      const tier = parseInt(b.tier, 10);
      if (!title) throw new Error('请输入任务名称');
      if (![1, 2, 3].includes(tier)) throw new Error('请选择紧张程度');
      if (!b.start_time || !b.deadline) throw new Error('请选择开始时间和最迟时间');
      if (b.deadline < b.start_time) throw new Error('最迟时间不能早于开始时间');
      const info = run(db(), 'INSERT INTO schedules (user_id, title, tier, start_time, deadline, note, created_at) VALUES (?,?,?,?,?,?,?)',
        [u.id, title.slice(0, 50), tier, b.start_time, b.deadline, (b.note || '').slice(0, 200), nowStr()]);
      persist(db());
      return { ok: true, id: info.lastInsertRowid };
    },
    'POST /api/schedules/': async (b, path) => {
      const u = needUser();
      const id = Number(path.split('/')[3]);
      if (path.endsWith('/toggle')) {
        run(db(), 'UPDATE schedules SET done = 1 - done WHERE id = ? AND user_id = ?', [id, u.id]);
      } else {
        run(db(), 'DELETE FROM schedules WHERE id = ? AND user_id = ?', [id, u.id]);
      }
      persist(db());
      return { ok: true };
    },

    'GET /api/reminders': async () => {
      const u = needUser();
      let r = get(db(), 'SELECT * FROM reminders WHERE user_id = ?', [u.id]);
      if (!r) {
        run(db(), 'INSERT INTO reminders (user_id, water_date, type) VALUES (?,?,?)', [u.id, todayStr(), 'mixed']);
        r = get(db(), 'SELECT * FROM reminders WHERE user_id = ?', [u.id]);
      }
      if (r.water_date !== todayStr()) {
        run(db(), 'UPDATE reminders SET water_count = 0, water_date = ? WHERE user_id = ?', [todayStr(), u.id]);
        r.water_count = 0; r.water_date = todayStr();
      }
      persist(db());
      return { reminder: r };
    },
    'POST /api/reminders/drink': async () => {
      const u = needUser();
      if (!get(db(), 'SELECT id FROM reminders WHERE user_id = ?', [u.id])) {
        run(db(), 'INSERT INTO reminders (user_id, water_date, type) VALUES (?,?,?)', [u.id, todayStr(), 'mixed']);
      }
      run(db(), 'UPDATE reminders SET water_count = water_count + 1 WHERE user_id = ?', [u.id]);
      persist(db());
      const r = get(db(), 'SELECT water_count FROM reminders WHERE user_id = ?', [u.id]);
      return { ok: true, water_count: r.water_count };
    },
    'POST /api/reminders': async (b) => {
      const u = needUser();
      if (!get(db(), 'SELECT id FROM reminders WHERE user_id = ?', [u.id])) {
        run(db(), 'INSERT INTO reminders (user_id, water_date, type) VALUES (?,?,?)', [u.id, todayStr(), 'mixed']);
      }
      const fields = [], vals = [];
      for (const k of ['enabled', 'enabled_sleep', 'interval_min', 'bedtime', 'water_count']) {
        if (b[k] !== undefined) { fields.push(`${k} = ?`); vals.push(b[k]); }
      }
      if (fields.length) {
        vals.push(u.id);
        run(db(), `UPDATE reminders SET ${fields.join(', ')} WHERE user_id = ?`, vals);
        persist(db());
      }
      return { ok: true };
    },

    'GET /api/usage': async () => {
      const u = needUser();
      const perm = get(db(), 'SELECT granted FROM usage_permission WHERE user_id = ?', [u.id]);
      return {
        granted: !!(perm && perm.granted),
        apps: all(db(), `SELECT app_name, SUM(minutes) AS minutes FROM app_usage
          WHERE user_id = ? AND date = ? GROUP BY app_name ORDER BY minutes DESC`, [u.id, todayStr()]),
        week: all(db(), `SELECT date, SUM(minutes) AS minutes FROM app_usage
          WHERE user_id = ? AND date >= date('now','-6 days') GROUP BY date ORDER BY date`, [u.id]),
      };
    },
    'POST /api/usage/permission': async (b) => {
      const u = needUser();
      run(db(), `INSERT INTO usage_permission (user_id, granted, granted_at) VALUES (?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET granted = excluded.granted, granted_at = excluded.granted_at`,
        [u.id, b.granted ? 1 : 0, nowStr()]);
      persist(db());
      return { ok: true };
    },
    'POST /api/usage/report': async (b) => {
      const u = needUser();
      for (const a of (Array.isArray(b.apps) ? b.apps : [])) {
        const name = String(a.app_name || '').slice(0, 30);
        const min = Number(a.minutes) || 0;
        if (!name || min <= 0) continue;
        const row = get(db(), 'SELECT id FROM app_usage WHERE user_id = ? AND app_name = ? AND date = ?', [u.id, name, todayStr()]);
        if (row) run(db(), 'UPDATE app_usage SET minutes = MAX(minutes, ?) WHERE id = ?', [min, row.id]);
        else run(db(), 'INSERT INTO app_usage (user_id, app_name, minutes, date) VALUES (?,?,?,?)', [u.id, name, min, todayStr()]);
      }
      persist(db());
      return { ok: true };
    },
    'POST /api/usage/seed-demo': async () => {
      const u = needUser();
      const demo = { '微信': 86, '抖音': 64, 'B站': 47, '浏览器': 35, 'QQ': 22, '音乐': 18, '淘宝': 12 };
      for (const [name, min] of Object.entries(demo)) {
        const exists = get(db(), 'SELECT id FROM app_usage WHERE user_id = ? AND app_name = ? AND date = ?', [u.id, name, todayStr()]);
        if (!exists) run(db(), 'INSERT INTO app_usage (user_id, app_name, minutes, date) VALUES (?,?,?,?)', [u.id, name, min, todayStr()]);
      }
      persist(db());
      return { ok: true };
    },
  };

  /* 统一入口：handle('POST', '/api/login', body) -> {ok, data} */
  window.LocalAPI.handle = async function (method, path, body) {
    if (!window.LocalAPI.ready) await loadDB();
    // DELETE /api/xxx/:id
    let key = method + ' ' + path;
    let h = handlers[key];
    if (!h && (method === 'DELETE' || (method === 'POST' && path.split('/').length > 4))) {
      const base = method === 'DELETE' ? method + ' ' + path.replace(/\/[^/]+$/, '/') : method + ' ' + path.split('/').slice(0, 4).join('/') + '/';
      h = handlers[base];
      if (h) return { ok: true, data: await h(body || {}, path) };
    }
    if (!h) throw new Error('接口不存在: ' + path);
    const data = await h(body || {});
    return { ok: true, data };
  };

  loadDB().catch(e => console.error('本地数据库初始化失败', e));
})();
