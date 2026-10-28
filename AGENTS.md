# AGENTS.md

本文件是仓库的**通用约定**，面向所有游戏。单个游戏的玩法、UI、版本号、打包和专属部署细节，放在该游戏目录下的 `AGENTS.md`：

- [vector-td/AGENTS.md](vector-td/AGENTS.md) — VECTOR // 矢界防线

## 仓库概览

- 仓库：**LittleFogCat/web-games**
- 类型：纯静态 Web 游戏集合
- 默认分支：`main`
- 线上入口：<https://xiaoniu.tech/games/>
- 组织方式：**每个游戏一个仓库根级目录**，互不依赖

## 游戏列表

| 游戏 | 目录 | 类型 | 线上地址 | 文档 |
| --- | --- | --- | --- | --- |
| VECTOR // 矢界防线 | [`vector-td/`](vector-td/) | 竖版深空塔防 | <https://xiaoniu.tech/games/vector-td/> | [开发约定](vector-td/AGENTS.md) · [游戏说明](vector-td/README.md) · [策划文档](vector-td/docs/design/游戏策划文档.md) · [单位图鉴](vector-td/docs/design/单位图鉴.md) |

新增游戏时在表格追加一行。版本号、玩法数值与 UI 约定以各游戏目录的 `AGENTS.md` 和 `README.md` 为准。

## 目录约定

```text
index.html                 游戏集合入口页
README.md                  游戏列表与仓库说明
AGENTS.md                  本文件：仓库通用约定
.gitignore                 隐私与临时文件忽略
vector-td/                 游戏目录（示例）
  AGENTS.md                该游戏的开发约定
  docs/                    该游戏专属文档（策划、图鉴、部署等）
  index.html
  ...
```

规则：

- 游戏目录名使用小写 kebab-case，例如 `vector-td/`、`neon-runner/`。
- 游戏目录必须自包含、可直接静态托管；不要依赖仓库根目录的运行时文件。
- 根目录只放集合入口和公共文档，不放某个游戏的源码与专属文档（策划文档、单位图鉴等一律放 `<game>/docs/`）。
- 新游戏必须同时更新：根 `index.html` 的入口卡片、根 `README.md` 的游戏列表、本文件的游戏表。
- 每个游戏目录应有自己的 `AGENTS.md`；根文件不写具体玩法数值和 UI 细节。

## 技术基线

- 优先 HTML + CSS + 原生 JavaScript，无框架、无构建步骤。
- 不依赖外部 CDN、图片、字体或音频；资源必须随仓库分发。
- 使用相对路径，保证部署在 `/games/<name>/` 这类子路径下仍可运行。
- 如需 `localStorage`，键名加游戏前缀，避免同域下多个游戏冲突。
- 面向移动端优先，至少检查 320×568、390×667、390×844，不得横向溢出。

## 本地运行

在仓库根目录启动静态服务器：

```powershell
python -m http.server 5180 --bind 127.0.0.1
```

- 集合页：<http://127.0.0.1:5180/>
- 单个游戏：`http://127.0.0.1:5180/<game>/`

必须通过 HTTP 验证，不要用 `file://` 双击页面作为最终结果；子路径、缓存和 MIME 行为只有 HTTP 下才真实。

## 新增游戏

1. 在根目录创建 `<game>/`，放入自包含的 `index.html` 与资源。
2. 在 `<game>/AGENTS.md` 写明玩法约束、UI 约定、版本与构建方式。
3. 更新根 `index.html`、`README.md`、本文件的游戏表。
4. 本地 HTTP 验证：入口可点、控制台无错误、移动端无溢出。
5. 如需发布包，在游戏目录内生成 `dist/`、`release/`；不要把测试产物或临时截图提交进去。
6. 部署到 `/usr/local/compose/www/games/<game>/`，验证公网 URL。

## 部署模型

所有游戏共用一个站点级 Nginx，**不需要为单个游戏新增配置**：

```text
宿主机 /usr/local/compose/www  →  容器 /usr/share/nginx/html
Nginx 容器：nginx（80/443）
配置目录：/usr/local/compose/conf/nginx
```

站点已有的兜底规则：

```nginx
root /usr/share/nginx/html;

location / {
    try_files $uri $uri/ /index.html;
}
```

因此只要游戏是 `www/games/<game>/` 下的真实目录，就能通过 `https://xiaoniu.tech/games/<game>/` 访问。

硬性约束：

- 不使用 `alias`，不使用软链；游戏必须落在 `www/games/<game>/` 真实目录内。
- 只替换静态文件不需要重启 Nginx；`www` 是 bind mount，文件立即生效。
- 只有修改 Nginx 配置本身才需要重载：

```bash
docker exec nginx nginx -s reload
```

- 以下情况才需要新增 `location`：新域名/端口、文件不在 `www` 下、前端 History 路由深链接、反代/WebSocket/鉴权、自定义 MIME（wasm/mjs）、特殊 CORS/CSP/缓存头。
- `try_files ... /index.html` 对缺失资源返回根 `index.html` + 200，不是 404；部署校验要看 `BUILD` 版本或文件内容，不能只看状态码。
- 部署前备份旧目录，先 staging 校验再原子替换；失败不要删除线上目录。
- **新包自动部署**：任务生成了新的版本化发布包并通过本地验证后，按该游戏的部署文档**自主完成部署，无需询问用户**——先在服务器备份旧目录，staging 校验通过再原子替换；部署后验证公网 `BUILD` 版本与资源 200，并更新该游戏 `docs/deployment.md` 的线上记录。校验失败必须停止，不能删除线上目录。

具体到 VECTOR 的上传、备份、回滚命令见 [vector-td/docs/deployment.md](vector-td/docs/deployment.md)。

## 隐私与提交

- 禁止提交 `.env`、SSH 私钥、证书私钥、服务器密码、API Key、访问令牌。
- 服务器连接参数只从团队内部配置读取，不写进仓库、不打印到日志。
- `.gitignore` 已覆盖常见密钥与本地文件；提交前仍要检查 `git status` 和暂存区 diff。
- 文档可以写部署路径，但不要写私钥路径、主机凭据或内网地址。

## Git 约定

- 直接提交到 `main`，不做无意义的强制推送。
- 提交信息使用 `type: summary`，例如 `feat: ...`、`fix: ...`、`docs: ...`、`chore: ...`。
- PowerShell 下 `git push` 可能因 stderr 输出返回非零退出码，但推送成功；以 `git ls-remote origin main` 和 `git log` 为准。
- **任务完成后自主推送**：任务完成并验证后，执行提交前检查——工作区与暂存区无隐私数据（密钥、凭据、令牌、内网地址），无测试产物、临时文件等垃圾文件（或已被 `.gitignore` 忽略）；检查通过后**无需再次询问**，只暂存本次任务相关文件，按上述提交信息规范 commit 并 push 到 `main`。与任务无关的本地改动保持不动，不要顺手提交。
