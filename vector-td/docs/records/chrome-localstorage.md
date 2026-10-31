# 从 Chrome / Edge Local Storage 读取闯关记录

游戏中每局结算会把记录写入当前源的：

```text
localStorage['vector_geotd_records_v1']
```

游戏不再提供本地记录服务，也不会上传任何数据。需要离线分析时，按本文从浏览器配置里读取。

> 本方法会复制浏览器 Local Storage 数据库到 `tmp/` 下，并在临时 Chrome 配置里打开游戏源读取数据。临时副本用完必须删除，不要提交到仓库。

## 1. 找到 Local Storage 数据库

Chrome：

```text
%LOCALAPPDATA%\Google\Chrome\User Data\Default\Local Storage\leveldb
%LOCALAPPDATA%\Google\Chrome\User Data\Profile 1\Local Storage\leveldb
```

Edge：

```text
%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Local Storage\leveldb
```

先按最新修改时间确认是哪个配置：

```powershell
Get-ChildItem "$env:LOCALAPPDATA\Google\Chrome\User Data" -Directory |
  ForEach-Object {
    $ldb = Join-Path $_.FullName 'Local Storage\leveldb'
    if (Test-Path $ldb) {
      $last = Get-ChildItem $ldb -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
      [pscustomobject]@{ Profile = $_.Name; LastWrite = $last.LastWriteTime; Path = $ldb }
    }
  } | Format-Table -AutoSize
```

Chrome / Edge 可以保持运行；如果复制失败，再关闭浏览器重试。

## 2. 复制数据库到临时配置

`leveldb` 目录里既有 `.log` 也有 `.ldb`。Chrome 会做压实，记录可能已经在压缩块里，所以**不要只读 `.log`，也不要用文本搜索硬解**；把整个目录交给 Chrome 自己读。

```powershell
$src = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Local Storage\leveldb"
$profile = Join-Path (Get-Location) 'tmp\records-profile'
$dest = Join-Path $profile 'Default\Local Storage\leveldb'

if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }
New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
robocopy $src $dest /E /R:0 /W:0 /XF LOCK | Out-Null
```

`robocopy` 返回 1 表示文件已复制，属于正常。`LOCK` 是运行中浏览器的锁文件，跳过即可。

## 3. 用临时 Chrome 读取对应 origin

`localStorage` 按 origin 隔离，必须打开记录实际产生的地址。常见来源：

- `http://127.0.0.1:5180/vector-td/`
- `http://localhost:5180/vector-td/`
- `http://127.0.0.1:8787/vector-td/`（如果曾用记录服务托管）
- `https://xiaoniu.tech/games/vector-td/`

把下面脚本保存为 `tmp/read-chrome-records.js`，在**仓库根目录**运行：

```js
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = path.resolve('tmp/records-profile');
const KEY = 'vector_geotd_records_v1';
const OUT = path.resolve('tmp/records/records.json');
const ORIGINS = [
  'http://127.0.0.1:5180/vector-td/',
  'http://localhost:5180/vector-td/',
  'http://127.0.0.1:8787/vector-td/',
  'http://localhost:8787/vector-td/',
  'https://xiaoniu.tech/games/vector-td/',
];

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  const page = context.pages()[0] || await context.newPage();
  let found = [];
  let foundOrigin = null;

  for (const url of ORIGINS) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
      await page.waitForTimeout(400);
      const raw = await page.evaluate((key) => localStorage.getItem(key), KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        found = parsed;
        foundOrigin = url;
        break;
      }
    } catch (error) {
      console.log(url, 'skip:', error.message.split('\n')[0]);
    }
  }
  await context.close();

  if (!found.length) {
    console.log('没有找到记录。确认记录是在本机这个浏览器配置里产生的。');
    process.exitCode = 1;
    return;
  }

  // 与已有数据按 id 合并，保留最新 100 条。
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch (error) { /* 首次运行 */ }
  const merged = new Map();
  for (const record of [].concat(existing, found)) {
    if (record && record.id && record.levelId) merged.set(record.id, record);
  }
  const records = [...merged.values()]
    .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))
    .slice(0, 100);
  fs.writeFileSync(OUT, JSON.stringify(records, null, 2));

  console.log('origin:', foundOrigin);
  console.log('新读取:', found.length, '合并后:', records.length);
  for (const r of records.slice(0, 5)) {
    console.log(r.id, 'L' + r.levelId, r.result, r.stars + '星', Math.round(r.duration || 0) + 's');
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

运行：

```powershell
node tmp\read-chrome-records.js
```

输出会合并进 `tmp/records/records.json`，调试面板的「导出记录 JSON」也可以作为备用手段。

## 4. 清理

```powershell
Remove-Item -Recurse -Force tmp\records-profile
Remove-Item -Force tmp\read-chrome-records.js
```

`tmp/` 已被 `.gitignore` 忽略，不会进入仓库。复制出来的浏览器配置包含你的本地站点数据，必须删除，不要上传或提交。

## 注意事项

- **origin 要对**：同一份记录在 `127.0.0.1:5180`、`localhost:5180`、`xiaoniu.tech` 下互不相通；脚本会依次尝试常见 origin。
- **Chrome 压实**：`.log` 可能在运行中被合并进 `.ldb`；不要手动解析 LevelDB 文件，交给临时 Chrome 读。
- **落盘时机**：只有结算时才会写入记录；对局中刷新或放弃不会产生记录。刚结算完通常已经落盘，若读不到可等几秒再复制。
- **多配置**：Chrome / Edge 可能有多个 Profile，按 `leveldb` 最近修改时间选择。
- **隐私**：临时配置只用于读取 `vector_geotd_records_v1`，读完立即删除；不要把整个 `leveldb` 留在仓库或 `tmp/` 之外。
