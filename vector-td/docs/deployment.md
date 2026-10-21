# VECTOR // 矢界防线 — 部署文档

本文是游戏项目自己的部署说明。游戏源码位于仓库的 `vector-td/` 目录；以下打包、上传和校验命令均在该目录内执行。部署方式来自团队内部 XiaoniuTech 运维文档，运维文档已在本地保留一份原样快照：[reference/xiaoniuTech-ops.md](reference/xiaoniuTech-ops.md)。

完整服务器接入文档仍以团队内部原文为准：

- 团队内部 XiaoniuTech 仓库的 `doc/ops/README.md`
- 本地快照：`docs/reference/xiaoniuTech-ops.md`
- 连接参数：团队内部 `backend/.env`
- 私钥：路径由内部连接配置中的 `ALIYUN_SSH_KEY_PATH` 指定；不要把私钥、`.env` 或 API Key 提交到仓库

不要把私钥、`.env` 内容、服务器密码或 API Key 提交到本仓库或静态部署目录。

## 1. 部署目标

```text
服务器目录：/usr/local/compose/www/games-vector-td
公网地址：https://xiaoniu.tech/games/vector-td/
Nginx 配置：/usr/local/compose/conf/nginx/conf.d/vector-td.location
```

Nginx 使用 `alias` 映射：

```nginx
location ^~ /games/vector-td/ {
    alias /usr/share/nginx/html/games-vector-td/;
    index index.html;
    try_files $uri $uri/index.html =404;
}
```

不要把它改成 `root`。该目录是 `www` bind mount 的一部分；**只覆盖静态文件不需要重启 Nginx**。只有修改 Nginx 配置时才需要额外检查并重载 Nginx。

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

推荐在 PowerShell 中解析 `.env` 后调用 `ssh`，避免把主机和密钥路径写进仓库。所有部署命令都要求公钥认证成功，并且当前用户能写入 `/usr/local/compose/www`。

## 3. 本地构建部署目录

项目的运行时不经过打包器，部署目录就是 `dist/`：

```powershell
Copy-Item index.html dist\index.html -Force
Copy-Item styles.css dist\styles.css -Force
Copy-Item src\*.js dist\src\ -Force
```

更新版本时必须同步：

- `index.html` 页脚 `BUILD x.y.z`
- `styles.css?v=x.y.z`
- 所有 `src/*.js?v=x.y.z`
- `README.md` 中的 release 链接
- `dist/README.md` 版本
- `screenshots/home.png` 页脚

生成 versioned zip：

```powershell
# 示例：v1.6.2
$zip = 'release\vector-td-v1.6.2-static.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  (Resolve-Path 'dist').Path,
  $zip,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)
(Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
```

## 4. 上传与替换

先在本地打 tar，避免把 `dist` 之外的文件带上服务器：

```powershell
$tar = Join-Path $env:TEMP 'vector-td-v1.6.2-deploy.tar.gz'
Push-Location dist
tar -czf $tar index.html styles.css src README.md .nojekyll
Pop-Location

scp -i $env:ALIYUN_SSH_KEY_PATH -P $env:ALIYUN_SSH_PORT `
  $tar root@$env:ALIYUN_SSH_IP:/tmp/vector-td-v1.6.2-deploy.tar.gz
```

服务器端流程：

```bash
set -e
TS=$(date +%Y%m%d-%H%M%S)
TARGET=/usr/local/compose/www/games-vector-td
NEW=/usr/local/compose/www/games-vector-td.new
BAK=/usr/local/compose/bak

mkdir -p "$BAK"
tar -czf "$BAK/games-vector-td-$TS.tar.gz" -C /usr/local/compose/www games-vector-td

rm -rf "$NEW"
mkdir -p "$NEW"
tar -xzf /tmp/vector-td-v1.6.2-deploy.tar.gz -C "$NEW"

# 替换前必须验证新目录，不要跳过
grep -q 'BUILD 1.6.2' "$NEW/index.html"
sha256sum "$NEW/index.html" "$NEW/src/app.js" "$NEW/src/render.js"

rm -rf "$TARGET"
mv "$NEW" "$TARGET"
chmod -R u+rwX,go+rX "$TARGET"
```

实际部署时校验 `index.html`、`styles.css`、`src/app.js`、`src/render.js`、`src/game.js` 的 SHA-256 与本地 `dist/` 一致；校验失败必须停止，不能删除线上目录。

## 5. 部署后验证

```bash
grep -m1 'BUILD ' /usr/local/compose/www/games-vector-td/index.html
curl -skS -o /dev/null -w '%{http_code}\n' https://127.0.0.1/games/vector-td/ -H 'Host: xiaoniu.tech'
curl -skS -o /dev/null -w '%{http_code}\n' 'https://127.0.0.1/games/vector-td/styles.css?v=1.6.2' -H 'Host: xiaoniu.tech'
```

浏览器验证：

```text
https://xiaoniu.tech/games/vector-td/?v=1.6.2
```

必须确认：

- 首页可见，页脚版本正确
- 可以正常选关进入游戏
- Canvas 尺寸等于视口
- 常驻建造栏、暂停条、HUD 没有互相遮挡
- 控制台无错误，静态资源无 404
- 资源带 `?v=` 版本参数，避免旧 JS/CSS 缓存

## 6. 回滚

每次部署前在 `/usr/local/compose/bak/` 生成旧目录压缩包：

```text
/usr/local/compose/bak/games-vector-td-YYYYMMDD-HHMMSS.tar.gz
```

回滚时先确认目标路径，再解压并替换：

```bash
TS=YYYYMMDD-HHMMSS
BACKUP=/usr/local/compose/bak/games-vector-td-$TS.tar.gz
TARGET=/usr/local/compose/www/games-vector-td
STAGE=/usr/local/compose/www/games-vector-td.rollback

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

- 只覆盖 `/usr/local/compose/www/games-vector-td/`。
- 不要动 `/usr/local/compose/www` 下的其他站点目录。
- 不要动 `/usr/local/compose/conf`、`docker-compose.yml`、`.env`，除非任务明确要求。
- 不要把 `backend/.env`、私钥、API Key 上传到 `www`。
- 静态目录是 bind mount；覆盖文件立即生效，但浏览器需要刷新或使用版本参数。

## 8. 当前线上记录

- 部署时间：2026-10-21
- 版本：1.6.2
- 目标：`/usr/local/compose/www/games-vector-td`
- 公网：`https://xiaoniu.tech/games/vector-td/`
- 备份：`/usr/local/compose/bak/games-vector-td-<timestamp>.tar.gz`
- 部署方式：静态 tar 上传 → 服务器备份 → staging 校验 → 原子替换
