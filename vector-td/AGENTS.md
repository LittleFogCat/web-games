# AGENTS.md — VECTOR // 矢界防线

本文件只写 `vector-td/` 的游戏专属约定。仓库级规则（目录结构、部署模型、隐私、Git）见 [../AGENTS.md](../AGENTS.md)。

## 概览

- 仓库：**LittleFogCat/web-games**
- 游戏目录：`vector-td/`
- 当前版本：**0.14.5-dev**（平衡性调整 · 控制机制重做）；进行中基线：**0.14.5-dev**；旧线 1.13.1 已归档，见 [扩容机制报告](docs/design/游戏扩容机制报告.md)
- 线上地址：<https://xiaoniu.tech/games/vector-td/>
- 集合页：<https://xiaoniu.tech/games/>
- 服务器目录：`/usr/local/compose/www/games/vector-td`
- 存档键：`vector_geotd_save_v1`（localStorage）

游戏使用 HTML + CSS + 原生 JavaScript，无构建系统、无框架、无外部图片或字体资源；所有几何图形由 Canvas 2D 程序化绘制。

## 开发基线（强制）

- 功能开发以 `docs/baseline/baseline_<version>.md` 为唯一范围依据；当前基线见 [baseline_log.md](docs/baseline/baseline_log.md)。
- 开始任何功能 / 平衡 / UI 任务前，先读当前基线文档与日志；只做“范围”内的事项。
- 基线文档的“验收标准”是完成定义；未全部通过不得标记 `accepted`。
- 每次进展、范围或验收变化，必须同时更新：
  1. 对应 `baseline_<version>.md` 的状态、进度、完成记录；
  2. `baseline_log.md` 的进度表与“最后更新”。
- 完成基线：同步版本号 / `BUILD` / `?v=` / `dist` / `release` / 部署 / 文档；在基线文档与日志标记 `accepted` 后，才能开始下一基线。
- 范围变更先改文档再写代码；禁止“代码先行、文档后补”。
- 未验收不启动下一基线；紧急修复走 patch 版本并登记。

## 本地运行

在**仓库根目录**启动静态服务器：

```powershell
python -m http.server 5180 --bind 127.0.0.1
```

- 游戏源码：`http://127.0.0.1:5180/vector-td/`
- 部署镜像：`http://127.0.0.1:5180/vector-td/dist/`

不要在 `vector-td` 里直接双击 `index.html` 作为最终验证；必须通过 HTTP 检查相对资源和缓存行为。

## 目录结构

```text
vector-td/
  AGENTS.md                 本文件：游戏开发约定
  README.md                 玩法、操作与项目说明
  index.html                页面结构、HUD、暂停图标、建造栏、弹窗
  manifest.json             PWA 清单：fullscreen 启动、竖屏、主题色与图标
  icons/                    应用图标（192/512/maskable 与 Apple Touch Icon）
  styles.css                全部 UI、响应式、全屏布局与视觉状态
  src/util.js               数学、格式化、缓动、随机数
  src/config.js             防御塔/敌人/伤害类型/特性/全局技能/10 个关卡波次数据
  src/pathgrid.js           9×16 网格、障碍、出生门、核心、BFS 寻路、建造校验
  src/game.js               战斗模拟、护盾/抗性/隐匿/韧性、塔与敌人、波次、经济、调试 API
  src/render.js             Canvas 背景、路径、五级塔体、特性敌人、弹道、特效、范围、选择框
  src/app.js                DOM 绑定、HUD、建造栏、暂停、关卡/技能界面、存档、调试面板
  screenshots/              README 用首页与实机截图
  release/                  静态部署包与 SHA-256
  dist/                     可直接部署的镜像目录
  docs/deployment.md        游戏专属部署、备份、回滚与线上验证文档
  docs/baseline/            开发基线与进度日志（每个基线一个文档）
  docs/design/              策划总案、单位图鉴与扩容文档
  docs/prd/                 UI/视觉评审文档
  docs/reference/           XiaoniuTech 运维文档快照
```

## 核心玩法约束

- 10 个星区；每关 14–20 波。
- 7 座攻击塔各 5 级，外加可升阶一次的灯塔（60 晶元建造、125 晶元升阶，半径 3.5→4.5）；防御塔上限 12 座（含灯塔）。全局技能矩阵 7×5。
- 三大伤害类型：动能 / 能量 / 低温；护盾对能量 ×1.9、动能 ×0.45、低温 ×0.9。护盾溢出不浪费：破盾一击的超出部分按原倍率折算回生命值。
- 敌人特性：护盾、物免、魔免、能抗、能量易伤、韧性、隐匿、分裂、终焉。韧性按比例减免减速与击退（铁壁 80%、终焉棱镜 100% 完全免疫）；震荡塔附带击退（0.1s 快速位移，推完敌人立即恢复前进），每个敌人有 1.3s 击退冷却，核心周围 1.6 格为击退免疫区；控制命中会累积目标韧性（+12%/次，对局内持续），控制总时间有天然上限。
- 反隐：只有灯塔的侦测半径能揭示隐匿；其他塔不再自带反隐。
- 局内资源：晶元；元资源：金币。
- 波次默认自动开始，顶部倒计时卡可点击立即发兵；**暂停时点击该卡会同时恢复作战并立即发兵**。交战中点击该卡不再弹出敌情，敌情只在暂停时通过 HUD 中间的「敌情」图标查看。
- **进入关卡时默认处于暂停状态**，点击左上播放键、`P`、`Esc` 或 `Space` 才开始倒计时。
- 全额撤销只允许：**准备阶段或暂停期间最后放下的一座未升级设施（防御塔或壁垒）**；其他情况回收 60%。
- **全局技能矩阵支持重置**，重置后所有技能回到 0 阶并全额返还已投入金币。
- 后期波次有额外生命/速度曲线；不能封死所有航线。
- **波次人口与补偿必须成对调整**：提高 `WAVE_POPULATION_SCALE` / 追加波后，必须同步调整 `SWARM_HP_SCALE` 与 `SWARM_REWARD_SCALE`，使各关总有效 HP 与总晶元收入相对旧曲线只小幅增长（目标 ≤10%）；Boss 不参与人口补偿，最终波必须保留 Boss。
- 第 10 关最终波必须保留 Boss。
- 五级塔必须有肉眼可分辨的轮廓 / 光环 / 弹道差异，不能只靠星星数量。
- 调试模式默认只在本地环境开启；调试模式初始赠送 **10000 金币**（每个浏览器档案一次），技能升级不再免费；调试战斗不得写入正式进度、星级或金币。

## 当前 UI 约定

- 主游戏页为**全屏 Canvas**，不再有占据布局的 header/footer。
- 顶部 HUD 是**透明渐变浮层**：不得恢复实色横向背景条，只允许局部暗色渐变与文字阴影保证可读性。
- HUD 只常驻必要信息：蓝色水晶矿图标 + 金色晶元数值（居左）、波次与倒计时、倍速、音量（居右）；关卡标题不在 HUD 常驻，只在关卡 intro 与星图出现。
- 核心完整度**默认不常驻显示**：受击时短暂浮现数值与受击方向提示，低于 30% 持续红色警示，低于 10% 进一步强化红光与音效；点击战场底部核心可查看完整度与漏怪统计。战场底部的核心实体与能量环必须保留。
- 底部建造栏是常驻浮层，背景保持可读但不抢战场；普通卡片弱化，选中、悬停、资源不足时才突出。
- 建造栏始终显示 9 个栏位（7 攻击塔 + 灯塔 + 壁垒），并显示 `塔 x/12` 与最低费用；**选中建造卡片或设施时，详情面板接管建造栏所在的底部条带（与建造栏同宽、同底、同高），不得向战场网格延伸**。取消、部署成功或点击空白处后恢复 9 栏建造栏。
- 暂停后左上按钮切换为**播放/恢复图标**；暂停按钮独立成圆形控件，不与资源数值混排。
- 关卡进入即暂停；HUD 分组固定为：暂停键 + 晶元居左，波次卡 + 倍速 + 音量居右。暂停时**不显示独立暂停条**、不隐藏倍速/音量，只在中间剩余区域显示 `重开 / 星图 / 敌情 / 全屏` 四个纯图标按钮（`aria-label` / `title` 提供标签）。暂停/恢复不得改变左右两组的位置、HUD 高度或战场尺寸，网格不得缩放、下移。恢复方式为左上播放图标、`P`、`Esc` 或 `Space`。
- 暂停期间允许建造、升级、回收；暂停中最后部署的未升级设施（防御塔或壁垒）可原价撤销。
- 顶部波次块只负责发兵 / 恢复：准备阶段点击立即发兵，暂停时点击同时恢复作战并立即发兵；交战中点击不再弹出敌情。敌情只在暂停时通过 HUD 中间的「敌情」图标展开为 HUD 下方的浮层（敌人数量 + 特性徽章 + 特性名称），浮层不得改变战场尺寸，可关闭并自动收起。
- **续战**：暂停后返回星图或主界面不得销毁当前局；星图与首页显示「继续作战」，恢复后沿用原防线、晶元、波次与暂停状态。只有开始新关卡、胜负结算后才销毁当前局。
- **新特性简报**：首次进入引入新特性的星区时弹出简报（分裂 / 能抗 / 护盾 / 隐匿 / 魔免 / 韧性 / 终焉），展示特性说明与克制建议，并写入 `save.seenTraits`；已读后不重复。简报必须暂停战场，且排在首次部署协议之后。
- **单次部署**：任何设施放置成功后必须清空 `selectedBuild` 与建造栏高亮，避免一次选中连续放置；放置失败时保留选中以便重试。
- 移动端建造栏的 9 个名称与费用不得被卡片高度或 `overflow` 裁切；320×568 下也要完整显示。
- 鼠标右键取消选择；左键建造或选中设施。
- HUD 语义色：友方/交互青色，资源金色，危险/核心告急红色，选中白色。
- 路径是低亮度发光通道 + 低频流动粒子 + 每三格一个方向箭头；不要恢复高密度固定箭头。出生门为危险色；障碍物（小行星）必须是**清晰可辨的实心岩体**：实色填充 + 明确轮廓 + 裂纹纹理，亮度明显高于星空背景（目标对比 ≥4×），但**不得使用发光/阴影**，与青色发光的可交互元素明确区分。
- 敌人特性必须有独立视觉：护盾泡/盾条、韧性角括号、隐匿虚线折射、特性徽章；敌人、核心受击与当前选中设施应保持高于路径的视觉优先级。
- 调试面板只在调试模式显示；游戏内入口为 HUD 的 `DBG`，正式环境不显示，首页为顶部 `DEBUG`。
- 移动端必须检查 320×568、390×667、390×844；不得出现横向溢出。
- **移动端沉浸式全屏**：手机进入关卡时默认自动请求 Fullscreen；首页右上角与暂停时 HUD 中间的 `全屏` 图标可随时切换。`#app` 高度使用 `--app-height`（visualViewport）兜底，不能回退到会被 Safari 工具栏撑开的 `100vh`。全屏/独立应用模式下 `#app` 取消 560px 宽度上限（桌面全屏上限 720px），战场不得保留 1px 边缝。
- Fullscreen 状态必须同步到 `body.is-immersive`、按钮 `aria-pressed` / `aria-label`；进入时尝试竖屏锁定与 Wake Lock，离开/暂停/切后台时释放。iPhone Safari 不支持网页 Fullscreen API，只能提示「分享 → 添加到主屏幕」，并以 `display: fullscreen` 的 PWA 清单提供全屏启动。

## 修改流程

0. **改 UTF-8 文本的纪律**：不要用 PowerShell 的 `Get-Content | Set-Content` / `Set-Content`（PS 5.1 默认 ANSI 编码）修改含中文的 HTML/MD/JS——会把整文件写成乱码（0.14.1 事故根源）。用编辑工具，或 `[IO.File]::ReadAllText/WriteAllText` 显式 UTF-8，或 Python 字节级替换。改动后检查 `U+FFFD`（`\xef\xbf\xbd`）计数必须为 0。
1. 先读相关文件，避免整文件重写。
2. 修改后检查语法：

```powershell
Get-ChildItem vector-td\src\*.js | ForEach-Object {
  node --check $_.FullName
  if ($LASTEXITCODE -ne 0) { throw "Syntax failed: $($_.Name)" }
}
```

3. 用 Playwright 做行为与布局回归：
   - 首页可见、正常选关、进入游戏。
   - Canvas 尺寸等于视口。
   - HUD / 建造栏 / 暂停图标不互相遮挡。
   - 建造、暂停建造、右键取消、容量上限、升级/回收。
   - 控制台无错误。
4. 更新版本号时，必须同步：
   - `vector-td/index.html` 页脚 `BUILD x.y.z`
   - `vector-td/styles.css?v=x.y.z`
   - `vector-td/src/*.js?v=x.y.z`
   - `vector-td/README.md` 包链接
   - `vector-td/dist/README.md` 版本
   - `vector-td/screenshots/home.png` 页脚截图
   - `vector-td/screenshots/tower-tiers.png` / `enemy-traits.png`（视觉变化时）
   - `docs/design/` 策划文档与单位图鉴（数值 / 机制变化时）
5. 生成新的静态包。

## 打包

在 `vector-td/` 内，将运行时文件复制到 `dist/`：

```text
index.html
manifest.json
icons/
styles.css
src/*.js
README.md
```

然后创建 `release/vector-td-v<version>-static.zip`，并生成对应 `.sha256`。不要包含测试产物、临时截图或服务器密钥。

## 部署

游戏专属部署文档：[docs/deployment.md](docs/deployment.md)。

```text
服务器目录：/usr/local/compose/www/games/vector-td
公网地址：  https://xiaoniu.tech/games/vector-td/
```

`vector-td` 是 `www/games/` 下的**真实目录**，由主站 `location / { try_files $uri $uri/ /index.html; }` 直接服务；不是软链，也不使用 `alias`。新增或替换静态文件不需要改 Nginx、不需要 reload；只有修改 Nginx 配置本身才需要检查并重载。

部署前先备份旧目录，上传并校验新 `index.html` 与 `src/*.js`，再替换；替换后访问公网 URL 验证 `BUILD` 版本与资源 200。部署包与 `dist/` 必须保持一致。

## 调试接口

控制台开发入口（不属于正常玩法）：

```js
debug()                             // F12 控制台调用：打开调试面板；调试模式关闭时静默返回 null 并提示
window.__VECTOR.game                // 当前战斗实例
window.__VECTOR.save                // 存档对象
window.__VECTOR.immersive           // 全屏 / PWA / Wake Lock 状态
window.__VECTOR.toggleImmersive()   // 切换全屏沉浸
window.__VECTOR.addGold(500)        // 增加金币
window.__VECTOR.unlockAll()         // 解锁全部星区
window.__VECTOR.debug.enabled       // 调试模式状态
window.__VECTOR.debug.maxSkills()   // 全技能 5 阶
window.__VECTOR.debug.setSkill('core', 5)  // 指定技能阶数
window.__VECTOR.debug.spawn('wraith', 5)   // 生成测试敌群
window.__VECTOR.debug.win() / lose()       // 直接判定胜负
window.__VECTOR.debug.status()             // 当前局内摘要
```

调试面板底部有命令行（REPL），支持 ↑/↓ 历史回溯，命令：`help` / `status` / `gold` / `crystals` / `heal` / `spawn` / `towers` / `wave` / `kill` / `win` / `lose` / `god` / `free` / `skill` / `skills` / `unlock` / `level` / `speed` / `clear`；面板打开后命令输入拥有键盘焦点保护（在输入框打字不会触发 `P`/`W`/数字键等战场快捷键，`Esc` 仍可关闭面板）。

调试模式默认在 `localhost` / `127.0.0.1` / `file://` 开启；可用 `?debug=1` / `?debug=0` 或 `Ctrl + Shift + D` 强制切换。调试战斗不写入正式进度。

## 文档维护

- 策划总案：`docs/design/游戏策划文档.md`
- 单位图鉴：`docs/design/单位图鉴.md`
- 开发基线：`docs/baseline/baseline_log.md`
- 修改塔 / 敌人 / 关卡数值后，必须同步这两份文档中的相关表格与“首次出现”信息。
