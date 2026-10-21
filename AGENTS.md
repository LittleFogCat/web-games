# AGENTS.md

## 项目概览

- 名称：**VECTOR // 矢界防线**
- 类型：纯静态、竖屏深空塔防网页游戏
- 当前版本：**1.6.2**
- 线上地址：`https://xiaoniu.tech/games/vector-td/`
- 服务器目录：`/usr/local/compose/www/games-vector-td`

游戏使用 HTML + CSS + 原生 JavaScript，无构建系统、无框架、无外部图片或字体资源；所有几何图形由 Canvas 2D 程序化绘制。

## 本地运行

在项目根目录启动静态服务器：

```powershell
python -m http.server 5180 --bind 127.0.0.1
```

- 源码预览：`http://127.0.0.1:5180/`
- 打包产物预览：`http://127.0.0.1:5180/dist/`

不要直接双击 `index.html` 作为最终验证；必须通过 HTTP 检查相对资源和缓存行为。

## 目录结构

```text
index.html          页面结构、HUD、暂停条、建造栏、弹窗
styles.css          全部 UI、响应式、全屏布局与视觉状态
src/util.js         数学、格式化、缓动、随机数
src/config.js       防御塔/敌人/全局技能/10 个关卡波次数据
src/pathgrid.js     9×16 网格、障碍、出生门、核心、BFS 寻路、建造校验
src/game.js         战斗模拟、塔与敌人、波次、经济、撤销、结算
src/render.js       Canvas 背景、路径、塔、敌人、特效、范围、选择框
src/app.js          DOM 绑定、HUD、建造栏、暂停、关卡/技能界面、存档
screenshots/        README 用首页与实机截图
release/            静态部署包与 SHA-256
dist/               可直接部署的镜像目录
docs/prd/           UI/视觉评审文档
docs/deployment.md  游戏专属部署、备份、回滚与线上验证文档
docs/reference/     XiaoniuTech 运维文档快照
```

存档键：`vector_geotd_save_v1`（localStorage）。

## 核心玩法约束

- 10 个星区；每关 12–18 波。
- 7 种防御塔，每种 5 级；全局技能矩阵 7×5。
- 局内资源：晶元；元资源：金币。
- 防御塔上限 12 座，壁垒不占上限。
- 波次默认自动开始，顶部倒计时卡可点击立即发兵。
- 全额撤销只允许：**准备阶段最后放下的一座未升级塔**；其他情况回收 60%。
- 后期波次有额外生命/速度曲线；不能封死所有航线。
- 第 10 关最终波必须保留 Boss。

## 当前 UI 约定

- 主游戏页为**全屏 Canvas**，不再有占据布局的 header/footer。
- 顶部 HUD 是透明浮层；底部建造栏是常驻浮层。
- 建造栏始终显示 8 个栏位，并显示 `塔 x/12` 与最低费用。
- 暂停后左上按钮切换为**播放/恢复图标**。
- 暂停条只保留 `重开 / 星图 / 手册`，不再有「继续」按钮；恢复方式为播放图标、`P` 或 `Esc`。
- 暂停期间允许建造、升级、回收。
- 鼠标右键取消选择；左键建造或选中设施。
- HUD 语义色：友方/交互青色，资源金色，危险/核心告急红色，选中白色。
- 路径是发光通道 + 流动箭头；出生门为危险色；障碍物必须保持暗色、无发光。
- 移动端必须检查 320×568、390×667、390×844；不得出现横向溢出。

## 修改流程

1. 先读相关文件，避免整文件重写。
2. 修改后检查语法：

```powershell
Get-ChildItem src\*.js | ForEach-Object {
  node --check $_.FullName
  if ($LASTEXITCODE -ne 0) { throw "Syntax failed: $($_.Name)" }
}
```

3. 用 Playwright 做行为与布局回归：
   - 首页可见、正常选关、进入游戏。
   - Canvas 尺寸等于视口。
   - HUD/建造栏/暂停条不互相遮挡。
   - 建造、暂停建造、右键取消、容量上限、升级/回收。
   - 控制台无错误。
4. 更新版本号时，必须同步：
   - `index.html` 页脚 `BUILD x.y.z`
   - `styles.css?v=x.y.z`
   - 所有 `src/*.js?v=x.y.z`
   - `README.md` 包链接
   - `dist/README.md` 版本
   - `screenshots/home.png` 页脚截图
5. 生成新的静态包。

## 打包

将运行时文件复制到 `dist/`：

```text
index.html
styles.css
src/*.js
README.md
```

然后创建 `release/vector-td-v<version>-static.zip`，并生成对应 `.sha256`。不要包含测试产物、临时截图或服务器密钥。

## 部署

游戏专属部署文档：[docs/deployment.md](docs/deployment.md)。

服务器接入方式参考：

- 游戏专属部署文档：[docs/deployment.md](docs/deployment.md)
- 运维文档本地快照：[docs/reference/xiaoniuTech-ops.md](docs/reference/xiaoniuTech-ops.md)
- 原始位置：团队内部 XiaoniuTech 运维仓库的 `doc/ops/README.md`
- 连接参数：团队内部 `.env`（不要提交、输出或上传私钥）

部署目标：

```text
/usr/local/compose/www/games-vector-td
```

公网访问路径：

```text
https://xiaoniu.tech/games/vector-td/
```

Nginx 配置位于服务器：

```text
/usr/local/compose/conf/nginx/conf.d/vector-td.location
```

注意该目录使用 `alias` 映射，不要改成 `root`。静态目录是 `www` bind mount，覆盖文件后不需要重启 Nginx；如修改 Nginx 配置则需要检查/重载 Nginx。

部署前先备份旧目录，上传并校验新 `index.html` 与 `src/*.js`，再替换；替换后访问公网 URL 验证 `BUILD` 版本与资源 200。部署包与 `dist/` 必须保持一致。
