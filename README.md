# LittleFogCat Web Games

个人 Web 游戏集合。每个游戏使用仓库根目录下的独立文件夹，便于继续添加新游戏。

## 游戏列表

### VECTOR // 矢界防线

纯静态、竖屏深空塔防网页游戏。Canvas 2D 程序化绘制，无框架、无构建、无外部美术资源。

- 目录：[`vector-td/`](vector-td/)
- 在线游玩：<https://xiaoniu.tech/games/vector-td/>
- 当前版本：1.6.2

[![VECTOR 矢界防线](vector-td/screenshots/gameplay.png)](vector-td/)

#### 玩法概要

- 10 个星区，每关 12–18 波
- 7 种防御塔 × 5 级，12 座防御塔上限
- 晶元局内建造，金币升级全局技能
- 塔与壁垒可重写敌人寻路，但不能封死航线
- 自动发兵，也可点击倒计时立即发兵
- 全屏战场、常驻建造栏、暂停期间可布防

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
- [游戏部署说明](vector-td/docs/deployment.md)
- [UI/视觉评审文档](vector-td/docs/prd/)