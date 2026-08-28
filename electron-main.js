/**
 * 专注时光 - Electron 桌面应用入口
 * 启动时自动拉起本地服务（server.js，端口3000），再打开应用窗口。
 */
const { app, BrowserWindow, Menu, shell } = require('electron');
const http = require('http');

const PORT = 3000;
const URL_BASE = `http://localhost:${PORT}`;
let mainWindow = null;

/* 探测本地服务是否已经在跑 */
function serverAlive() {
  return new Promise((resolve) => {
    const req = http.get(`${URL_BASE}/`, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => { req.destroy(); resolve(false); });
  });
}

function waitServer(retries = 40) {
  return new Promise(async (resolve) => {
    for (let i = 0; i < retries; i++) {
      if (await serverAlive()) return resolve(true);
      await new Promise(r => setTimeout(r, 250));
    }
    resolve(false);
  });
}

async function ensureServer() {
  if (await serverAlive()) return true;   // 已有实例（比如命令行启动过）
  require('./server.js');                 // 同进程启动 SQLite 后端
  return waitServer();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 430,
    height: 840,
    minWidth: 360,
    minHeight: 640,
    title: '专注时光',
    backgroundColor: '#f2f4f8',
    autoHideMenuBar: true,
    icon: require('path').join(__dirname, 'public', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  Menu.setApplicationMenu(null);
  // 允许网页内的定位 / 通知权限申请（定位用于自动获取当地天气）
  mainWindow.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
    callback(['geolocation', 'notifications'].includes(permission));
  });
  mainWindow.loadURL(URL_BASE);

  // 外部链接（如天气数据源）交给系统浏览器，应用内不跳走
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(URL_BASE)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const ok = await ensureServer();
    if (!ok) {
      const { dialog } = require('electron');
      dialog.showErrorBox('专注时光', '本地服务启动失败（端口3000被占用？），请关闭占用该端口的程序后重试。');
      app.quit();
      return;
    }
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit(); // 关窗口即退出（SQLite 数据自动落盘）
  });
}
