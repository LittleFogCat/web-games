# VECTOR // 矢界防线 — 部署文档

本文是游戏项目自己的部署说明。游戏源码位于仓库的 `vector-td/` 目录；以下打包、上传和校验命令均在该目录内执行。部署方式参考团队内部 XiaoniuTech 仓库（本机为 `D:\code\XiaoniuTech`）：服务器接入读 `backend/.env`，运维约定读 `doc/ops/README.md`；本仓库只保留一份原样快照：[reference/xiaoniuTech-ops.md](reference/xiaoniuTech-ops.md)。

完整服务器接入文档仍以团队内部原文为准：

- 团队内部 XiaoniuTech 仓库的 `doc/ops/README.md`
- 本地快照：`docs/reference/xiaoniuTech-ops.md`
- 连接参数：团队内部 `backend/.env`
- 私钥：路径由内部连接配置中的 `ALIYUN_SSH_KEY_PATH` 指定；当前 `.env` 未写该项时，使用本机已配置的阿里云部署密钥。不要把私钥、`.env` 或 API Key 提交到仓库

不要把私钥、`.env` 内容、服务器密码或 API Key 提交到本仓库或静态部署目录。

## 1. 部署目标

```text
游戏实际目录：/usr/local/compose/www/games/vector-td
游戏 URL：    https://xiaoniu.tech/games/vector-td/
游戏集合页：  https://xiaoniu.tech/games/
```

`vector-td` 是 `www/games/` 下的真实目录，不是软链。由主站的 `location / { try_files $uri $uri/ /index.html; }` 直接服务，不使用 `alias`。

旧的 `vector-td.location` 已禁用并备份到：

```text
/usr/local/compose/bak/vector-td.location.disabled.<timestamp>
```

只覆盖静态文件不需要重启 Nginx；把游戏目录放进 `www/games/` 也不需要新增 Nginx 配置。只有修改 Nginx 配置本身才需要检查并重载 Nginx。

## 2. 连接服务器

从团队内部 XiaoniuTech 连接配置（`backend/.env`）读取以下变量，不要打印值：

```text
ALIYUN_SSH_IP
ALIYUN_SSH_PORT
ALIYUN_SSH_KEY_PATH
```

连接命令：

```bash
ssh -i "$ALIYUN_SSH_KEY_PATH" -p "$ALIYUN_SSH_PORT" root@"$ALIYUN_SSH_IP"
```

推荐在 PowerShell 中解析 `.env` 后调用 `ssh`，避免把主机和密钥路径写进仓库。当前 `backend/.env` 只包含 `ALIYUN_SSH_IP`、`ALIYUN_SSH_PORT`，没有 `ALIYUN_SSH_KEY_PATH`；实际部署时使用本机默认阿里云密钥，或从团队配置中读取该变量。所有部署命令都要求公钥认证成功，并且当前用户能写入 `/usr/local/compose/www`。

## 3. 本地构建部署目录

项目的运行时不经过打包器，部署目录就是 `dist/`：

```powershell
Copy-Item index.html dist\index.html -Force
Copy-Item styles.css dist\styles.css -Force
Copy-Item src\*.js dist\src\ -Force
Copy-Item manifest.json dist\manifest.json -Force
Copy-Item icons dist\icons -Recurse -Force
```

PWA 清单使用 `manifest.json`（而不是 `.webmanifest`），让站点级 Nginx 默认以 `application/json` 返回；`.webmanifest` 在本站会被兜底为 `application/octet-stream`，Chrome 可能因此忽略清单。如果以后改回 `.webmanifest`，必须先为 Nginx 配置 `application/manifest+json` MIME 并 reload。

更新版本时必须同步：

- `index.html` 页脚 `BUILD x.y.z`
- `styles.css?v=x.y.z`
- 所有 `src/*.js?v=x.y.z`
- `README.md` 中的 release 链接
- `dist/README.md` 版本
- `screenshots/home.png` 页脚

生成 versioned zip：

```powershell
# 示例：v0.14.0-dev
$zip = 'release\vector-td-v0.14.0-dev-static.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  (Resolve-Path 'dist').Path,
  $zip,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)
(Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
```

Windows 的 `ZipFile.CreateFromDirectory` 可能把条目写成 `src\app.js` 这类反斜杠路径，Linux/macOS 解压会出现异常文件名。发布包建议用 Python `zipfile` 或 7-Zip 生成 POSIX 路径；当前 `release/vector-td-v0.14.0-dev-static.zip` 使用 Python 生成并校验（16 个条目，无 `dist/` 前缀）。

## 4. 上传与替换

先在本地打 tar，避免把 `dist` 之外的文件带上服务器：

```powershell
$tar = Join-Path $env:TEMP 'vector-td-v0.14.0-dev-deploy.tar.gz'
Push-Location dist
tar -czf $tar index.html styles.css manifest.json icons src README.md .nojekyll
Pop-Location

scp -i $env:ALIYUN_SSH_KEY_PATH -P $env:ALIYUN_SSH_PORT `
  $tar root@$env:ALIYUN_SSH_IP:/tmp/vector-td-v0.14.0-dev-deploy.tar.gz
```

服务器端流程：

```bash
set -e
TS=$(date +%Y%m%d-%H%M%S)
TARGET=/usr/local/compose/www/games/vector-td
NEW=/usr/local/compose/www/games/vector-td.new
BAK=/usr/local/compose/bak

mkdir -p "$BAK"
tar -czf "$BAK/vector-td-$TS.tar.gz" -C "$TARGET" .

rm -rf "$NEW"
mkdir -p "$NEW"
tar -xzf /tmp/vector-td-v0.14.0-dev-deploy.tar.gz -C "$NEW"

# 替换前必须验证新目录，不要跳过
grep -q 'BUILD 0.14.0-dev' "$NEW/index.html"
sha256sum "$NEW/index.html" "$NEW/src/app.js" "$NEW/src/render.js"

rm -rf "$TARGET"
mv "$NEW" "$TARGET"
chmod -R u+rwX,go+rX "$TARGET"
```

实际部署时校验 `index.html`、`styles.css`、`src/app.js`、`src/render.js`、`src/game.js` 的 SHA-256 与本地 `dist/` 一致；校验失败必须停止，不能删除线上目录。

## 5. 部署后验证

```bash
grep -m1 'BUILD ' /usr/local/compose/www/games/vector-td/index.html
curl -skS -o /dev/null -w '%{http_code}\n' https://127.0.0.1/games/vector-td/ -H 'Host: xiaoniu.tech'
curl -skS -o /dev/null -w '%{http_code}\n' 'https://127.0.0.1/games/vector-td/styles.css?v=0.14.0-dev' -H 'Host: xiaoniu.tech'
```

浏览器验证：

```text
https://xiaoniu.tech/games/vector-td/?v=0.14.0-dev
```

必须确认：

- 首页可见，页脚版本正确
- 可以正常选关进入游戏
- Canvas 尺寸等于视口
- 常驻建造栏、暂停图标、HUD 没有互相遮挡
- 控制台无错误，静态资源无 404
- 资源带 `?v=` 版本参数，避免旧 JS/CSS 缓存

## 6. 回滚

每次部署前在 `/usr/local/compose/bak/` 生成旧目录压缩包：

```text
/usr/local/compose/bak/vector-td-YYYYMMDD-HHMMSS.tar.gz
```

回滚时先确认目标路径，再解压并替换：

```bash
TS=YYYYMMDD-HHMMSS
BACKUP=/usr/local/compose/bak/vector-td-$TS.tar.gz
TARGET=/usr/local/compose/www/games/vector-td
STAGE=/usr/local/compose/www/games/vector-td.rollback

test -s "$BACKUP"
rm -rf "$STAGE"
mkdir -p "$STAGE"
tar -xzf "$BACKUP" -C "$STAGE"
test -s "$STAGE/index.html"
rm -rf "$TARGET"
mv "$STAGE" "$TARGET"
chmod -R u+rwX,go+rX "$TARGET"
```

回滚同样只覆盖静态目录，不需要重启 Nginx。

## 7. 部署边界

- 只覆盖 `/usr/local/compose/www/games/vector-td/`。
- **不要对单个游戏执行 XiaoniuTech 的 `script/install.sh`、`script/deploy.sh` 或 `docker compose down/up`**：那会全量覆盖 `/usr/local/compose` 的 frontend / backend / conf，并重启整站容器。静态游戏只需要替换 `www/games/<game>/`。
- 这个目录是真实目录，不是软链；不要把它改成指向旧 `games-vector-td` 的链接。
- 不要动 `/usr/local/compose/www` 下的其他站点目录。
- 不要动 `/usr/local/compose/conf`、`docker-compose.yml`、`.env`，除非任务明确要求。
- 不要把 `backend/.env`、私钥、API Key 上传到 `www`。
- 静态目录是 bind mount；覆盖文件立即生效，但浏览器需要刷新或使用版本参数。

## 8. 当前线上记录

### 0.14.3-dev（当前）

- 部署时间：2026-10-29 01:23（调试面板字号可读性放大；补丁线收尾）
- 版本：**0.14.3-dev**
- 目标：`/usr/local/compose/www/games/vector-td`（真实目录）
- 公网：`https://xiaoniu.tech/games/vector-td/`
- 备份：`/usr/local/compose/bak/vector-td-20261029-012310.tar.gz`（220K）
- 发布包：`release/vector-td-v0.14.3-dev-static.zip`，SHA-256 `1cf75e42fc9ca217664312dd21f7244cd455dd1d7ddc372cef85fd292101ccd3`（16 个条目，POSIX 路径，Python zipfile 生成）
- 部署方式：静态 tar 上传 → 服务器备份 → staging 校验（`BUILD 0.14.3-dev`、16 个文件、index/styles/app/render/game 五文件 SHA-256 与本地一致、`manifest.json` 存在、无嵌套 `icons/icons`、无 U+FFFD）→ 原子替换
- 线上验证：服务器本机 Host 头验证 `page 200 text/html`、`css 200 text/css`、`app 200 application/javascript`；公网页脚 `BUILD 0.14.3-dev`
- 内容摘要：调试面板字号整体放大约 1.6 倍（标题 12px、按钮 11.5px、状态 11–12.5px、命令行输入 13px/日志 12px、标题区 17px），面板宽度 336px→380px（移动端仍受 `calc(100vw - 20px)` 约束），380px 以下基准字号 9px→12px；Playwright 回归 15 项通过（REPL、生成敌群、无敌、canvas 等宽、三档视口无溢出、生产环境静默）

### 0.14.2-dev（上一版）

- 部署时间：2026-10-29 00:55（调试面板命令行 REPL + `debug()` 控制台入口；无玩法数值改动）
- 版本：**0.14.2-dev**
- 目标：`/usr/local/compose/www/games/vector-td`（真实目录）
- 公网：`https://xiaoniu.tech/games/vector-td/`
- 备份：`/usr/local/compose/bak/vector-td-20261029-005436.tar.gz`
- 发布包：`release/vector-td-v0.14.2-dev-static.zip`，SHA-256 `064a1b508963f160a572747763c98761b37ca63c9f23e6829fb8bb00e3b81a12`（16 个条目，POSIX 路径，Python zipfile 生成）
- 部署方式：静态 tar 上传 → 服务器备份 → staging 校验（`BUILD 0.14.2-dev`、16 个文件、index/styles/app/render/game 五文件 SHA-256 与本地一致、`manifest.json` 存在、无嵌套 `icons/icons`、`index.html` 无 U+FFFD）→ 原子替换
- 线上验证：服务器本机 Host 头验证 `page 200 text/html`、`css 200 text/css`、`app 200 application/javascript`、`manifest 200 application/json`；公网页脚 `BUILD 0.14.2-dev`
- 内容摘要：调试面板底部新增命令行（`help/status/gold/crystals/heal/spawn/towers/wave/kill/win/lose/god/free/skill/skills/unlock/level/speed/clear`，↑/↓ 历史，日志上限 120 行）；控制台 `debug()` 入口（调试模式关闭时静默返回 `null` 并提示，不弹 UI）；命令输入拥有战场快捷键焦点保护（输入框内打字不触发 `P`/`W`/数字键/Space，`Esc` 仍可关闭面板）

### 0.14.1-dev（上一版）

- 部署时间：2026-10-28 22:41（平衡修正 + 小行星可见性 + 灯塔可升阶 + 技能减价文案修复）
- 版本：**0.14.1-dev**
- 目标：`/usr/local/compose/www/games/vector-td`（真实目录）
- 公网：`https://xiaoniu.tech/games/vector-td/`
- 备份：`/usr/local/compose/bak/vector-td-20261028-224009.tar.gz`
- 发布包：`release/vector-td-v0.14.1-dev-static.zip`，SHA-256 `a55ea5d4055ad97b4d6f3b0631ee8f0a460a6b96e1a279d3a10303fffc225d54`（16 个条目，POSIX 路径，Python zipfile 生成）
- 修正重部署：2026-10-28 23:00 发现首次部署的 `index.html` 被本地 ANSI 编码误写损坏（106 处 U+FFFD，中文乱码）；从 v0.14.0 发布包恢复纯净版并字节级重放两处修改（版本号、灯塔文案）后重新部署；staging 增加"无 U+FFFD"校验；备份 `vector-td-20261028-230057.tar.gz`（损坏版）与更早的 `vector-td-20261028-224009.tar.gz`
- 部署方式：静态 tar 上传 → 服务器备份 → staging 校验（`BUILD 0.14.1-dev`、16 个文件、index/styles/config/game/render/app 六文件 SHA-256 与本地一致、manifest 存在、无嵌套 `icons/icons`）→ 原子替换
- 线上验证：服务器本机 Host 头验证 `page 200 text/html`、`css 200 text/css`、`game.js / config.js 200 application/javascript`、`manifest 200 application/json`；页脚 `BUILD 0.14.1-dev`
- 内容摘要：重棱物免 40%、铁壁物免 65%/生命 380、首领动能抗性 25%/护盾 50%、盾卫护盾 65%、护盾倍率 动 0.45/能 1.9、波次 HP 成长 1.035；小行星实心岩体化（对比 6.57×）；灯塔可升阶（125 晶元、半径 4.5）；建造协议/静滞场域技能显示为负号

### 0.14.0-dev（上一版）

- 部署时间：2026-10-28 16:53（开发线版本号重置；无玩法改动）
- 版本：**0.14.0-dev**
- 目标：`/usr/local/compose/www/games/vector-td`（真实目录）
- 公网：`https://xiaoniu.tech/games/vector-td/`
- 备份：`/usr/local/compose/bak/vector-td-20261028-165340.tar.gz`
- 发布包：`release/vector-td-v0.14.0-dev-static.zip`，SHA-256 `dfbe6bd121b4627e4ea168eb79de008cc8e7083ddf6888a4b1f626de693b9a6f`（16 个条目，POSIX 路径）
- 部署方式：静态 tar 上传 → 服务器备份 → staging 校验（`BUILD 0.14.0-dev`、16 个文件 SHA-256 与本地一致、`manifest.json` 存在、无嵌套 `icons/icons`）→ 原子替换
- 集合页：2026-10-28 17:09 同步 `/usr/local/compose/www/games/index.html`，移除页脚版本号（仅保留 `MORE GAMES COMING`）；备份 `/usr/local/compose/bak/games-index-20261028-170954.html`
- 线上验证：服务器本机 Host 头验证 `page 200 text/html`、`css 200 text/css`、`app 200 application/javascript`、`manifest 200 application/json`；页脚 `BUILD 0.14.0-dev`；公网抓取页面同样返回 `BUILD 0.14.0-dev`

### 1.13.1（上一版）

- 部署时间：2026-10-28 01:25（v1.13.1；01:19 为 v1.13.0，00:44 为 v1.12.4，23:04 为 v1.12.3，22:48 为 v1.12.2，22:03 为 v1.12.1，21:40 为 v1.12.0，20:42 为 v1.11.0，02:10–02:19 为 v1.10.0 迭代记录）
- 版本：1.13.1
- 目标：`/usr/local/compose/www/games/vector-td`（真实目录）
- 公网：`https://xiaoniu.tech/games/vector-td/`
- 集合页：`https://xiaoniu.tech/games/`
- 备份：`/usr/local/compose/bak/vector-td-20261028-012513.tar.gz`（上一版：`vector-td-20261028-011911.tar.gz`）
- 发布包：`release/vector-td-v1.13.1-static.zip`，SHA-256 `27e3fdfd17b1e696f5e52865eceba8ba7485750a58b6bfb03a9b9d47ca36085c`（16 个条目，POSIX 路径）
- 部署方式：按 XiaoniuTech `doc/ops/README.md` 的连接方式，从 `backend/.env` 读取 `ALIYUN_SSH_IP` / `ALIYUN_SSH_PORT`（本机 `.env` 未配置 `ALIYUN_SSH_KEY_PATH`，使用本机默认阿里云密钥）；静态 tar 上传 → 服务器备份 → staging 校验（16 个文件 SHA-256 全部匹配、`BUILD 1.13.1`、`pause-actions` 存在、`manifest.json` 存在、无旧 `.webmanifest`、无嵌套 `icons/icons`）→ 原子替换
- 线上验证：公网页脚 `BUILD 1.13.1`；`styles.css?v=1.13.1`（`text/css`）、`src/app.js?v=1.13.1`（`application/javascript`）、`manifest.json?v=1.13.1`（`application/json`）与 4 个图标均 200，无 4xx/5xx；Playwright 公网 v1.13.1 回归通过（第 1 关 14 波、首波 10 只侦察机；非 Boss 侦察机 HP 16 / 击杀 2 晶元、Boss 4080 HP / 189 晶元不受人口补偿影响；第 10 关 20 波且 Boss 仍在最终波；暂停图标 28×28 / 320 下 23×23、敌情图标为圆圈感叹号、暂停前后 `renderer.oy` 一致、暂停发兵、建造后取消选中、星图/主界面续战、新特性简报、桌面全屏、iOS 降级）；控制台无错误
