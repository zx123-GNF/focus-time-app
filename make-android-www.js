// 组装安卓 WebView 使用的 www 目录：页面 + sql.js（本地 SQLite 运行时）
const fs = require('fs');
const path = require('path');
const root = __dirname;
const pub = path.join(root, 'public');
const www = path.join(root, 'www');

fs.rmSync(www, { recursive: true, force: true });
fs.cpSync(pub, www, { recursive: true });

// sql.js 运行时
for (const f of ['sql-wasm.js', 'sql-wasm.wasm']) {
  fs.copyFileSync(path.join(root, 'node_modules', 'sql.js', 'dist', f), path.join(www, f));
}

// 在 app.js 之前加载本地数据层
const htmlPath = path.join(www, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace('<script src="app.js"></script>',
  '<script src="sql-wasm.js"></script>\n<script src="local-server.js"></script>\n<script src="app.js"></script>');
fs.writeFileSync(htmlPath, html);
console.log('www 构建完成:', fs.readdirSync(www).join(', '));
