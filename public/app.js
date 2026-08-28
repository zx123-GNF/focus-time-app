/* 专注时光 - 前端逻辑 */
const API = '';
let me = null;

/* ================= 工具 ================= */
async function api(path, method = 'GET', body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opt.body = JSON.stringify(body);
  const r = await fetch(API + path, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || '请求失败');
  return data;
}

function $(id) { return document.getElementById(id); }
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  show('toast');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide('toast'), 2200);
}

function fmtDur(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function fmtMin(sec) {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}小时${m % 60}分` : `${m}分钟`;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ================= 登录 ================= */
function switchLoginTab(which) {
  $('tab-login').classList.toggle('active', which === 'login');
  $('tab-register').classList.toggle('active', which === 'register');
  $('btn-submit-login').textContent = which === 'login' ? '登 录' : '注 册';
  $('reg-name').classList.toggle('hidden', which === 'login');
  $('btn-submit-login').dataset.mode = which;
  hide('login-error');
}

function loginError(msg) { $('login-error').textContent = msg; show('login-error'); }

async function submitLogin() {
  const mode = $('btn-submit-login').dataset.mode || 'login';
  const phone = $('login-phone').value.trim();
  const password = $('login-password').value;
  if (!phone || !password) return loginError('请输入手机号和密码');
  try {
    const body = { phone, password };
    if (mode === 'register') body.name = $('reg-name').value.trim();
    const data = await api(mode === 'login' ? '/api/login' : '/api/register', 'POST', body);
    onLoginSuccess(data.user);
  } catch (e) { loginError(e.message); }
}

async function quickLogin(phone, password) {
  try {
    const data = await api('/api/login', 'POST', { phone, password });
    onLoginSuccess(data.user);
  } catch (e) { toast(e.message); }
}

function onLoginSuccess(user) {
  me = user;
  hide('login-view');
  show('main-view');
  switchTab('home');
  renderMine();
  initFocusPage();
  loadReminders();
  loadContacts();
  requestLocationWeather();
  loadUsage();
  startReminderLoop();
}

async function logout() {
  await api('/api/logout', 'POST').catch(() => {});
  location.reload();
}

/* ================= 底部导航 ================= */
const PAGE_TITLE = { home: '首页', focus: '专注', schedule: '计划日程', usage: '使用统计', mine: '我的' };
let currentPage = 'home';

function switchTab(page) {
  currentPage = page;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  show('page-' + page);
  $('header-title').textContent = PAGE_TITLE[page];
  // 切换对应板块的主题背景
  const mv = $('main-view');
  mv.classList.remove('bg-home', 'bg-focus', 'bg-schedule', 'bg-usage', 'bg-mine');
  mv.classList.add('bg-' + page);
  if (page === 'focus') refreshFocusSummary();
  if (page === 'usage') loadUsage();
  if (page === 'schedule') loadSchedules();
  if (page === 'home') { loadReminders(); loadContacts(); if (!geoAskedThisSession) requestLocationWeather(); }
  trackTabEnter(page);
}

/* ===== 本应用内各页面的真实使用时长（上报到使用统计） ===== */
let tabEnterTime = Date.now();
const tabSeconds = {};   // 本地累计
function trackTabEnter(page) {
  const now = Date.now();
  const dur = (now - tabEnterTime) / 1000;
  if (dur > 2) tabSeconds[currentPage] = (tabSeconds[currentPage] || 0) + dur;
  tabEnterTime = now;
}
setInterval(() => { // 每60秒把本应用使用时长上报一次
  const apps = Object.entries(tabSeconds).map(([name, sec]) => ({ app_name: `本应用·${PAGE_TITLE[name] || name}`, minutes: sec / 60 }));
  if (!apps.length) return;
  for (const k in tabSeconds) delete tabSeconds[k];
  api('/api/usage/report', 'POST', { apps }).catch(() => {});
}, 60000);
window.addEventListener('beforeunload', () => {
  trackTabEnter('__end__');
  const apps = Object.entries(tabSeconds).map(([name, sec]) => ({ app_name: `本应用·${PAGE_TITLE[name] === undefined ? name : PAGE_TITLE[name]}`, minutes: sec / 60 }));
  if (apps.length) navigator.sendBeacon?.('/api/usage/report', new Blob([JSON.stringify({ apps })], { type: 'application/json' }));
});

/* ================= 首页：天气 ================= */
const WEATHER_CODES = {
  0: ['晴', '☀️'], 1: ['大致晴朗', '🌤️'], 2: ['多云', '⛅'], 3: ['阴', '☁️'],
  45: ['雾', '🌫️'], 48: ['雾凇', '🌫️'], 51: ['小毛雨', '🌦️'], 53: ['毛雨', '🌦️'], 55: ['大毛雨', '🌧️'],
  61: ['小雨', '🌧️'], 63: ['中雨', '🌧️'], 65: ['大雨', '⛈️'], 66: ['冻雨', '🌨️'], 67: ['强冻雨', '🌨️'],
  71: ['小雪', '🌨️'], 73: ['中雪', '🌨️'], 75: ['大雪', '❄️'], 77: ['雪粒', '❄️'],
  80: ['小阵雨', '🌦️'], 81: ['阵雨', '🌧️'], 82: ['强阵雨', '⛈️'],
  85: ['小阵雪', '🌨️'], 86: ['大阵雪', '❄️'], 95: ['雷雨', '⛈️'], 96: ['雷雨伴冰雹', '⛈️'], 99: ['强雷雨伴冰雹', '⛈️'],
};

let geoAskedThisSession = false;

/* 进入应用后向用户申请定位权限：定位成功 → 反查城市 → 拉取当地天气 */
function requestLocationWeather() {
  if (geoAskedThisSession) return;
  geoAskedThisSession = true;
  if (!('geolocation' in navigator)) { loadWeather(); return; }
  $('weather-city').textContent = '定位中...';
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    localStorage.setItem('weather_lat', latitude);
    localStorage.setItem('weather_lon', longitude);
    localStorage.removeItem('weather_city');
    // 坐标反查城市名（BigDataCloud 免费客户端反地理编码，无需密钥）
    let city = '当前位置';
    try {
      const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=zh`);
      const d = await r.json();
      city = d.city || d.locality || d.principalSubdivision || city;
      localStorage.setItem('weather_city', city);
    } catch {}
    await loadWeather();
    toast(`📍 已定位：${city}`);
  }, () => {
    // 用户拒绝或定位失败：回退到上次城市 / 默认城市
    toast('未授权定位，显示默认城市（点天气卡片可手动换城市）');
    loadWeather();
  }, { timeout: 10000, maximumAge: 600000 });
}

async function loadWeather() {
  const lat = localStorage.getItem('weather_lat'), lon = localStorage.getItem('weather_lon'),
        city = localStorage.getItem('weather_city');
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat ?? 39.9042}&longitude=${lon ?? 116.4074}&current=temperature_2m,relative_humidity_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto`);
    const d = await r.json();
    const code = d.current.weather_code;
    const [desc, icon] = WEATHER_CODES[code] || ['未知', '🌡️'];
    $('weather-city').textContent = city || (lat ? '当前位置' : '北京');
    $('weather-temp').textContent = Math.round(d.current.temperature_2m);
    $('weather-desc').textContent = `${desc} ${icon}`;
    $('weather-icon').textContent = icon;
    $('weather-humidity').textContent = d.current.relative_humidity_2m;
    $('weather-max').textContent = Math.round(d.daily.temperature_2m_max[0]);
    $('weather-min').textContent = Math.round(d.daily.temperature_2m_min[0]);
  } catch { $('weather-desc').textContent = '天气加载失败'; }
}

async function manualRefreshWeather() {
  const city = prompt('请输入城市名（如：北京 / 上海 / 广州）', localStorage.getItem('weather_city') || '北京');
  if (!city) return;
  try {
    const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`);
    const gd = await g.json();
    if (!gd.results || !gd.results.length) return toast('未找到该城市');
    const { latitude, longitude, name } = gd.results[0];
    localStorage.setItem('weather_lat', latitude);
    localStorage.setItem('weather_lon', longitude);
    localStorage.setItem('weather_city', name);
    loadWeather();
  } catch { toast('城市查询失败'); }
}

/* ================= 首页：提醒 ================= */
let reminderState = null;

async function loadReminders() {
  const { reminder } = await api('/api/reminders');
  reminderState = reminder;
  $('water-count').textContent = `今日已喝 ${reminder.water_count} 杯`;
  $('water-toggle').checked = !!reminder.enabled;
  $('water-interval').value = String(reminder.interval_min || 60);
  $('water-interval-show').textContent = reminder.interval_min || 60;
  sleepEnabledLocal = !!reminder.enabled_sleep;
  $('sleep-toggle').checked = sleepEnabledLocal;
  $('bedtime').value = reminder.bedtime || '23:00';
  $('bedtime-show').textContent = reminder.bedtime || '23:00';
}

async function drinkWater() {
  const { water_count } = await api('/api/reminders/drink', 'POST');
  $('water-count').textContent = `今日已喝 ${water_count} 杯`;
  if (water_count === 8) toast('🎉 今日8杯水达成！');
}

async function saveWaterSetting() {
  const enabled = $('water-toggle').checked ? 1 : 0;
  const interval_min = parseInt($('water-interval').value, 10);
  await api('/api/reminders', 'POST', { enabled, interval_min });
  if (reminderState) reminderState.enabled = enabled;
  $('water-interval-show').textContent = interval_min;
  if (enabled) {
    askNotificationPermission();
    toast(`喝水提醒已开启，每${interval_min}分钟提醒一次`);
  }
}

async function saveSleepSetting() {
  const bedtime = $('bedtime').value || '23:00';
  const sleepEnabled = $('sleep-toggle').checked ? 1 : 0;
  // 用 interval_min 存不了睡觉，单独存 type 字段：这里用 bedtime 字段 + 独立开关标志位写进 enabled 位运算
  await api('/api/reminders', 'POST', { bedtime, enabled_sleep: sleepEnabled });
  $('bedtime-show').textContent = bedtime;
  if (sleepEnabled) { askNotificationPermission(); toast(`睡觉提醒已开启：每晚 ${bedtime}`); }
}

/* 提醒循环：每30秒检查一次是否该提醒 */let lastWaterAt = Date.now();
function startReminderLoop() {
  setInterval(async () => {
    const now = new Date();
    // 喝水提醒
    if (reminderState && reminderState.enabled) {
      const intervalMs = (reminderState.interval_min || 60) * 60000;
      if (Date.now() - lastWaterAt >= intervalMs) {
        lastWaterAt = Date.now();
        notify('💧 喝水提醒', '该喝一杯水啦，记得休息一下眼睛～');
        toast('💧 该喝水啦！');
      }
    }
    // 睡觉提醒
    if (sleepEnabledLocal) {
      const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (hm === (reminderState?.bedtime || '23:00') && !window.__sleepAlertedToday) {
        window.__sleepAlertedToday = true;
        notify('🌙 睡觉提醒', '夜深了，早点休息，明天继续加油！');
        alert('🌙 睡觉时间到啦，早点休息哦！');
      }
    }
  }, 30000);
}
let sleepEnabledLocal = false;

/* 通知权限 */
async function askNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch {}
  }
}
function openNotificationPermission() {
  askNotificationPermission().then(() => {
    const p = 'Notification' in window ? Notification.permission : 'unsupported';
    toast(p === 'granted' ? '✅ 通知权限已开启' : p === 'denied' ? '通知权限被拒绝，可在浏览器设置中重新开启' : '当前环境不支持通知');
  });
}
function notify(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body }); } catch {}
  }
}

/* ================= 首页：每日一言 ================= */
const QUOTES = [
  '把时间用在思考上是最能节省时间的事情。',
  '不积跬步，无以至千里；不积小流，无以成江海。',
  '你怎样过一天，就怎样过一生。',
  '专注是走向卓越的唯一捷径。',
  '今天不想跑，所以才去跑，这才是长跑者的思维。',
  '种一棵树最好的时间是十年前，其次是现在。',
  '自律不是束缚，而是通往自由的阶梯。',
  '每一个不曾起舞的日子，都是对生命的辜负。',
];
$('daily-quote').textContent = '「 ' + QUOTES[new Date().getDate() % QUOTES.length] + ' 」';

/* ================= 首页：联系人 ================= */
const CONTACT_AVATARS = ['😀','😎','🤓','🐱','🦊','🐻','🐼','🌻','🍀','⭐'];
function avatarFor(name) { return CONTACT_AVATARS[[...name].reduce((a, c) => a + c.codePointAt(0), 0) % CONTACT_AVATARS.length]; }

async function loadContacts() {
  const { contacts } = await api('/api/contacts');
  const box = $('contact-list');
  if (!contacts.length) {
    box.innerHTML = '<div class="empty-tip">还没有联系人，点击右上角 + 通过手机号添加</div>';
    return;
  }
  box.innerHTML = contacts.map(c => `
    <div class="contact-item">
      <div class="contact-avatar">${esc(avatarFor(c.name))}</div>
      <div class="contact-info">
        <div class="contact-name">${esc(c.name)}</div>
        <div class="contact-phone">${esc(c.phone)}</div>
        ${c.remark ? `<div class="contact-remark">${esc(c.remark)}</div>` : ''}
      </div>
      <button class="contact-del" onclick="delContact(${c.id})">✕</button>
    </div>`).join('');
}

function openContactModal() { show('contact-modal'); }
function closeModal(id) { hide(id); }

async function saveContact() {
  const name = $('contact-name').value.trim();
  const phone = $('contact-phone').value.trim();
  const remark = $('contact-remark').value.trim();
  if (!name || !phone) return toast('姓名和手机号必填');
  try {
    await api('/api/contacts', 'POST', { name, phone, remark });
    hide('contact-modal');
    $('contact-name').value = ''; $('contact-phone').value = ''; $('contact-remark').value = '';
    toast('联系人已添加');
    loadContacts();
  } catch (e) { toast(e.message); }
}

async function delContact(id) {
  if (!confirm('确定删除该联系人吗？')) return;
  await api(`/api/contacts/${id}`, 'DELETE');
  loadContacts();
}

/* ================= 专注页 ================= */
const PRESET_TASKS = ['数学', '英语', 'vibe coding'];
let focusItems = [];      // 自定义项
let selectedTask = null;  // 当前选中的专注事情
let focusTimer = null;    // interval
let focusSeconds = 0;     // 已专注秒数
let focusRunning = false;
let focusStartedAt = null;
const RING_CYCLE = 25 * 60; // 进度环每25分钟一圈

async function initFocusPage() {
  try {
    const { items } = await api('/api/focus/items');
    focusItems = items.map(i => i.name);
  } catch { focusItems = []; }
  renderTaskBar();
  refreshFocusSummary();
}

function renderTaskBar() {
  const bar = $('focus-task-bar');
  const chips = [];
  for (const t of [...PRESET_TASKS, ...focusItems]) {
    const isCustom = focusItems.includes(t);
    chips.push(`<div class="task-chip ${selectedTask === t ? 'active' : ''}" onclick="selectTask('${esc(t).replace(/'/g, "\\'")}')">
      ${esc(t)}${isCustom ? `<span class="chip-del" onclick="delTask(event, '${esc(t).replace(/'/g, "\\'")}')">✕</span>` : ''}
    </div>`);
  }
  chips.push(`<div class="task-chip custom-add" onclick="show('custom-task-modal')">＋ 自定义</div>`);
  bar.innerHTML = chips.join('');
}

function selectTask(t) {
  selectedTask = t;
  $('focus-task-now').textContent = `专注中：${t}`;
  renderTaskBar();
}

async function delTask(e, t) {
  e.stopPropagation();
  const { items } = await api('/api/focus/items');
  const item = items.find(i => i.name === t);
  if (item) await api(`/api/focus/items/${item.id}`, 'DELETE');
  focusItems = focusItems.filter(x => x !== t);
  if (selectedTask === t) { selectedTask = null; $('focus-task-now').textContent = '未选择'; }
  renderTaskBar();
}

async function saveCustomTask() {
  const name = $('custom-task-name').value.trim();
  if (!name) return toast('请输入名称');
  try {
    await api('/api/focus/items', 'POST', { name });
    hide('custom-task-modal');
    $('custom-task-name').value = '';
    focusItems.push(name);
    renderTaskBar();
    selectTask(name);
    toast(`已添加「${name}」`);
  } catch (e) { toast(e.message); }
}

function toggleFocus() {
  if (!selectedTask) return toast('请先选择一个专注事情');
  if (!focusRunning) {
    focusRunning = true;
    if (focusSeconds === 0) focusStartedAt = new Date().toISOString();
    $('btn-focus-start').textContent = '暂停';
    $('btn-focus-start').classList.add('pause');
    show('btn-focus-done');
    $('focus-state').textContent = '专注中...保持住！';
    focusTimer = setInterval(() => {
      focusSeconds++;
      $('focus-time').textContent = fmtDur(focusSeconds);
      // 进度环：每25分钟一圈
      const C = 628;
      $('ring-progress').style.strokeDashoffset = C - C * ((focusSeconds % RING_CYCLE) / RING_CYCLE);
    }, 1000);
  } else {
    focusRunning = false;
    clearInterval(focusTimer);
    $('btn-focus-start').textContent = '继续';
    $('btn-focus-start').classList.remove('pause');
    $('focus-state').textContent = '已暂停';
  }
}

async function finishFocus() {
  clearInterval(focusTimer);
  if (focusSeconds < 5) {
    toast('本次专注太短，未保存');
    resetFocusUI();
    return;
  }
  try {
    await api('/api/focus/sessions', 'POST', {
      task_name: selectedTask, duration_sec: focusSeconds, started_at: focusStartedAt,
    });
    toast(`✅ 已保存：${selectedTask} 专注 ${fmtMin(focusSeconds)}`);
  } catch (e) { toast('保存失败：' + e.message); }
  resetFocusUI();
  refreshFocusSummary();
}

function resetFocusUI() {
  focusRunning = false; focusSeconds = 0; focusStartedAt = null;
  clearInterval(focusTimer);
  $('focus-time').textContent = '00:00';
  $('focus-state').textContent = '准备开始';
  $('btn-focus-start').textContent = '开始专注';
  $('btn-focus-start').classList.remove('pause');
  hide('btn-focus-done');
  $('ring-progress').style.strokeDashoffset = 628;
}

async function refreshFocusSummary() {
  try {
    const { today, recent } = await api('/api/focus/sessions');
    const box = $('focus-today-list');
    if (!today.length) {
      box.innerHTML = '<div class="empty-tip">今天还没有专注记录，开始第一次专注吧！</div>';
    } else {
      const total = today.reduce((a, r) => a + r.total, 0);
      box.innerHTML =
        `<div class="focus-today-row"><b>合计</b><b style="color:var(--primary)">${fmtMin(total)}</b></div>` +
        today.map(r => `<div class="focus-today-row"><span>${esc(r.task_name)}</span><span>${fmtMin(r.total)}</span></div>`).join('') +
        (recent.length ? `<div class="focus-today-row"><span class="muted">最近一次</span><span class="muted">${esc(recent[0].task_name)} · ${esc(recent[0].ended_at.slice(5, 16))}</span></div>` : '');
    }
  } catch {}
}

/* ================= 计划日程 ================= */
const TIERS = {
  1: { name: '紧急', color: 'var(--red)' },
  2: { name: '中等', color: 'var(--orange)' },
  3: { name: '悠闲', color: 'var(--green)' },
};
let schedules = [];
let pickedTier = 0;

async function loadSchedules() {
  const { schedules: list } = await api('/api/schedules');
  schedules = list;
  renderSchedules();
}

function renderSchedules() {
  const box = $('tier-groups');
  const now = new Date();
  let html = '';
  for (const tier of [1, 2, 3]) {
    const list = schedules.filter(s => s.tier === tier);
    const done = list.filter(s => s.done).length;
    html += `<div class="tier-header">
      <span class="tier-dot" style="background:${TIERS[tier].color}"></span>
      ${TIERS[tier].name} <span class="tier-count">${done}/${list.length} 已完成</span>
    </div>`;
    if (!list.length) {
      html += `<div class="empty-tip" style="padding:10px 0">暂无「${TIERS[tier].name}」任务</div>`;
      continue;
    }
    for (const s of list) {
      const overdue = !s.done && s.deadline < now.toISOString().slice(0, 16);
      html += `<div class="sch-item tier-${s.tier}">
        <div class="sch-top">
          <button class="sch-check ${s.done ? 'done' : ''}" onclick="toggleSchedule(${s.id})">${s.done ? '✓' : ''}</button>
          <span class="sch-title ${s.done ? 'done' : ''}">${esc(s.title)}</span>
          <span class="sch-badge tier-${s.tier}">${TIERS[s.tier].name}</span>
          <button class="sch-del" onclick="delSchedule(${s.id})">🗑</button>
        </div>
        <div class="sch-meta">
          ⏰ ${esc(s.start_time.replace('T', ' '))} → ${esc(s.deadline.replace('T', ' '))}
          ${overdue ? '<span class="sch-overdue">（已超期）</span>' : ''}
          ${s.note ? `<br><span class="sch-note">📝 ${esc(s.note)}</span>` : ''}
        </div>
      </div>`;
    }
  }
  box.innerHTML = html;
}

function openScheduleModal() {
  pickedTier = 0;
  document.querySelectorAll('.tier-opt').forEach(o => o.classList.remove('selected'));
  const n = new Date(); n.setMinutes(n.getMinutes() - n.getTimezoneOffset());
  $('sch-start').value = n.toISOString().slice(0, 16);
  const d = new Date(Date.now() + 86400000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  $('sch-deadline').value = d.toISOString().slice(0, 16);
  $('sch-title').value = ''; $('sch-note').value = '';
  show('schedule-modal');
}

function pickTier(t) {
  pickedTier = t;
  document.querySelectorAll('.tier-opt').forEach(o => o.classList.toggle('selected', +o.dataset.tier === t));
}

async function saveSchedule() {
  const title = $('sch-title').value.trim();
  if (!title) return toast('请输入任务名称');
  if (!pickedTier) return toast('请选择时间紧张程度');
  try {
    await api('/api/schedules', 'POST', {
      title, tier: pickedTier,
      start_time: $('sch-start').value,
      deadline: $('sch-deadline').value,
      note: $('sch-note').value.trim(),
    });
    hide('schedule-modal');
    toast('任务已添加');
    loadSchedules();
  } catch (e) { toast(e.message); }
}

async function toggleSchedule(id) {
  await api(`/api/schedules/${id}/toggle`, 'POST');
  loadSchedules();
}

async function delSchedule(id) {
  if (!confirm('确定删除该任务吗？')) return;
  await api(`/api/schedules/${id}`, 'DELETE');
  loadSchedules();
}

/* ================= 使用统计 ================= */
async function requestUsagePermission() {
  show('perm-modal');
}
async function grantUsagePermission() {
  hide('perm-modal');
  await api('/api/usage/permission', 'POST', { granted: true });
  await api('/api/usage/seed-demo', 'POST').catch(() => {});
  toast('✅ 权限已获取');
  loadUsage();
}
async function denyUsagePermission() {
  hide('perm-modal');
  await api('/api/usage/permission', 'POST', { granted: false });
  toast('已拒绝授权，应用使用统计将不可用');
  loadUsage();
}

async function loadUsage() {
  const { granted, apps, week } = await api('/api/usage');
  if (!granted) {
    show('usage-perm-box'); hide('usage-content');
    return;
  }
  hide('usage-perm-box'); show('usage-content');
  const total = apps.reduce((a, r) => a + r.minutes, 0);
  $('usage-total').textContent = Math.round(total);
  const max = Math.max(...apps.map(a => a.minutes), 1);
  $('usage-apps').innerHTML = apps.length
    ? apps.map(a => `
      <div class="usage-app-row">
        <div class="usage-app-top"><span>${esc(a.app_name)}</span><span>${Math.round(a.minutes)} 分钟 · ${Math.round(a.minutes / (total || 1) * 100)}%</span></div>
        <div class="usage-bar-bg"><div class="usage-bar" style="width:${(a.minutes / max * 100).toFixed(1)}%"></div></div>
      </div>`).join('')
    : '<div class="empty-tip">暂无数据，稍后再来看看</div>';

  // 近7天（用本地日期与数据库 localtime 日期对齐）
  const localKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const found = week.find(w => w.date === localKey(d));
    days.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, minutes: found ? found.minutes : 0 });
  }
  const wmax = Math.max(...days.map(d => d.minutes), 1);
  $('usage-week').innerHTML = days.map(d => `
    <div class="usage-week-col">
      <span class="usage-week-val">${Math.round(d.minutes)}</span>
      <div class="usage-week-bar" style="height:${Math.max(4, d.minutes / wmax * 88)}px"></div>
      <span class="usage-week-label">${d.label}</span>
    </div>`).join('');
}

/* ================= 我的 ================= */
const AVATAR_CHOICES = ['🙂','😎','🤓','🥰','🦊','🐱','🐼','🚀','🌟','🍀','🎓','💻'];

function renderMine() {
  if (!me) return;
  $('profile-name').textContent = me.name;
  $('profile-phone').textContent = me.phone;
  const av = $('profile-avatar');
  if (String(me.avatar).startsWith('data:image')) {
    av.innerHTML = `<img src="${me.avatar}">`;
  } else {
    av.textContent = me.avatar || '🙂';
  }
}

async function editName() {
  const name = prompt('请输入新昵称', me.name);
  if (!name || !name.trim()) return;
  await api('/api/profile', 'POST', { name: name.trim() });
  me.name = name.trim();
  renderMine();
  toast('昵称已更新');
}

function changeAvatar() {
  const choice = prompt(
    '更换头像：\n输入序号选择emoji：\n' + AVATAR_CHOICES.map((a, i) => `${i + 1}.${a}`).join('  ') +
    '\n或输入 img: 开头的图片URL'
  );
  if (!choice) return;
  if (/^\d+$/.test(choice.trim()) && AVATAR_CHOICES[+choice - 1]) {
    me.avatar = AVATAR_CHOICES[+choice - 1];
    api('/api/profile', 'POST', { avatar: me.avatar }).then(() => { renderMine(); toast('头像已更新'); });
  } else if (choice.startsWith('img:')) {
    me.avatar = choice.slice(4);
    api('/api/profile', 'POST', { avatar: me.avatar }).then(() => { renderMine(); toast('头像已更新'); });
  }
}

async function changePhone() {
  const phone = prompt('请输入新手机号（11位）');
  if (!phone) return;
  const password = prompt('请输入当前密码以验证');
  if (!password) return;
  try {
    await api('/api/phone', 'POST', { phone: phone.trim(), password });
    me.phone = phone.trim();
    renderMine();
    toast('手机号已更改');
  } catch (e) { toast(e.message); }
}

/* ================= 启动 ================= */
(async function boot() {
  try {
    const { user } = await api('/api/me');
    if (user) { onLoginSuccess(user); return; }
  } catch {}
  show('login-view');
})();
