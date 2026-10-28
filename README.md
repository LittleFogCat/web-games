# LittleFogCat Web Games

个人 Web 游戏集合。每个游戏使用仓库根目录下的独立文件夹，便于继续添加新游戏。

## 游戏列表

### VECTOR // 矢界防线

纯静态、竖屏深空塔防网页游戏。Canvas 2D 程序化绘制，无框架、无构建、无外部美术资源。

- 目录：[`vector-td/`](vector-td/)
- 在线游玩：<https://xiaoniu.tech/games/vector-td/>
- 当前版本：0.14.0-dev

[![VECTOR 矢界防线](vector-td/screenshots/gameplay.png)](vector-td/)

#### 玩法概要

- 10 个星区，每关 14–20 波
- 7 种攻击塔 × 5 级 + 不可升级的灯塔，12 座防御塔上限
- 动能 / 能量 / 低温三大伤害通道；护盾、霸体、隐匿、物免、魔免等敌人特性
- 五级塔拥有独立轮廓、光环、卫星与弹道特效
- 晶元局内建造，金币升级全局技能
- 塔与壁垒可重写敌人寻路，但不能封死航线
- 自动发兵，也可点击倒计时立即发兵；暂停时点击会恢复作战并立即发兵
- 全屏战场、常驻建造栏、暂停期间可布防；每关进入时默认暂停
- 暂停时 HUD 中间图标查看本波次敌情；返回主界面保留当前局并继续作战
- 手机进入关卡自动全屏，支持刘海安全区、竖屏锁定与屏幕常亮；可添加到主屏幕以独立应用启动
- 全局技能可重置并全额返还金币
- 顶部 HUD 透明化：核心完整度按需浮现，受击/低血量有方向警告
- 本地开发环境默认开启可视化调试模式，初始赠送 10000 金币

## 仓库结构

```text
index.html               游戏集合入口页（可静态托管）
README.md                游戏集合说明
AGENTS.md                仓库通用约定（所有游戏）
.gitignore               隐私与临时文件忽略规则
vector-td/               当前游戏：源码、dist、release、截图与文档
  AGENTS.md              游戏专属开发约定
```

后续新增游戏直接在根目录建立独立文件夹，例如：

```text
vector-td/
another-game/
```

## 本地预览

在仓库根目录启动静态服务器：

```powershell
python -m http.server 5180 --bind 127.0.0.1
```

打开：

- 游戏集合页：`http://127.0.0.1:5180/`
- 游戏源码：`http://127.0.0.1:5180/vector-td/`
- 部署镜像：`http://127.0.0.1:5180/vector-td/dist/`

## 文档

- [游戏说明](vector-td/README.md)
- [仓库通用约定](AGENTS.md)
- [游戏开发约定](vector-td/AGENTS.md)
- [游戏策划文档](docs/游戏策划文档.md)
- [单位图鉴](docs/单位图鉴.md)
- [游戏部署说明](vector-td/docs/deployment.md)
- [UI/视觉评审文档](vector-td/docs/prd/)