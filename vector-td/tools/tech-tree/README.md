# VECTOR 科技树编辑器（内部设计工具）

可视化编辑 VECTOR 科技树初稿，并把数据生成为 [`docs/design/科技树.md`](../../docs/design/科技树.md) 里的表格与关系图。

> **边界**：本目录是内部工具，**不随游戏发布**，不进入 `dist/`、`release/`，也不部署到线上。它只影响设计文档与策划讨论，不影响玩家可见内容。

## 来源与许可

- 上游项目：[CommanderFoo/skill-tree-planner](https://github.com/CommanderFoo/skill-tree-planner)（MIT，见 [LICENSE](LICENSE)）
- 本仓库引入时的上游版本：`49b9726`（2026-01-24，`--depth 1` 克隆）
- 相对上游的修改：
  1. `index.html`：移除 Google Fonts 外链（本仓库不依赖外部 CDN / 字体）；标题改为 VECTOR；新增 VECTOR 说明条与「载入初稿」按钮；挂载 `vector-loader.js`。
  2. `src/storage.js`：`localStorage` 键改为 `vector_tech_tree_planner_v1`（避免与同域其它页面冲突）。
  3. `src/styles.css`：字体栈换成本机系统字体（含中文回退）；追加说明条样式。
  4. 新增 `vector-loader.js`（首次打开自动载入初稿）、`vector-tree.json`（VECTOR 初稿数据）、`export-md.js`（Markdown 生成器）、本 README。
- 上游其余代码未改动；MIT 许可与版权声明保留在 [LICENSE](LICENSE)。

## 快速开始

在**仓库根目录**启动静态服务器（ES module 需要 HTTP，不能双击 `file://`）：

```powershell
python -m http.server 5180 --bind 127.0.0.1
```

打开：<http://127.0.0.1:5180/vector-td/tools/tech-tree/>

- 首次打开（浏览器无本地存档）会自动载入 `vector-tree.json` 并「适应视图」。
- 之后打开会恢复你上次的编辑（浏览器 `localStorage`）。
- 想回到初稿：点顶部说明条右侧的 **载入初稿**（会覆盖当前项目，有二次确认）。

## 字段约定（重要）

编辑器本身是通用的技能树工具，VECTOR 的科技树语义借下面的约定表达，`export-md.js` 依赖它们：

| 位置 | 约定 |
| --- | --- |
| 节点 ID | `<分支小写>_<序号>`，如 `exp_1`；文档中显示为 `EXP-1` |
| Node Settings → Meta Data | `branch=EXP;tier=1;type=unlock;effect=unlock.expedition` |
| `branch` | `EXP` / `MOD` / `FLT` / `ARC` / `LOG`（见 `export-md.js` 的 `BRANCHES`） |
| `tier` | 层级整数，必须与前置深度一致；前置的 tier 必须更小 |
| `type` | `unlock` 解锁 / `rule` 规则 / `record` 档案 / `modifier` 数值（红线：慎用数值类） |
| `effect` | 效果字典键，必须在 `export-md.js` 的 `EFFECTS` 登记，否则校验报错 |
| 名字 / Description | 文档节点表的「名称 / 说明」列 |
| Tree Settings → Cost System | 选 **Resources**；资源池 `Total` 即预算 |
| 每种资源的 Total | `金币 3000` / `残片 400` / `星核 300`（当前初稿口径） |
| 节点 Resource Costs per Rank | 每阶成本；`Max Rank` 与阶数必须一致 |
| Prerequisite Logic | `AND`（须）/ `OR`（或）/ `SUM`（合计） |
| 连线 | 用 Connect Nodes 或 Shift+拖拽；`required_rank` 表示前置需要的等级 |

> 编辑器里的 `Type`（Passive/Active）字段不承载 VECTOR 语义，统一 `Passive` 即可；真实类型写在 Meta Data 的 `type=` 里。

## 工作流：改树 → 生成文档

1. 在编辑器里增删节点、连线、成本，确认「校验面板 / 警告」没有异常。
2. 点 **Export** 导出 JSON，用导出的内容**覆盖** `vector-tree.json`（保持该文件为初稿）。
3. 回到**仓库根目录**执行：

```powershell
# 只校验（有错误时退出码为 1）
node vector-td/tools/tech-tree/export-md.js --check

# 把数据段写入文档的两个标记之间
node vector-td/tools/tech-tree/export-md.js --inject vector-td/docs/design/科技树.md

# 只看输出（不写文件）
node vector-td/tools/tech-tree/export-md.js
```

4. 文档中 `<!-- TECH-TREE:DATA:BEGIN -->` 与 `<!-- TECH-TREE:DATA:END -->` 之间的内容会被整段替换；标记之外的框架文字请手写维护。

生成器会校验：节点/分支/类型/效果键是否登记、前置是否更低层级、是否存在环、tier 与前置深度是否一致、资源是否超出预算、OR 逻辑前置数量等。

## 目录

| 文件 | 说明 |
| --- | --- |
| `index.html` / `src/` | 上游编辑器（已打上述补丁） |
| `vector-loader.js` | 初稿自动载入、「载入初稿」按钮 |
| `vector-tree.json` | VECTOR 科技树初稿（编辑器项目格式，唯一数据源） |
| `export-md.js` | JSON → Markdown 数据段 + 校验（无依赖） |
| `schemas/` | 上游 JSON Schema，字段参考 |
| `LICENSE` | 上游 MIT 许可 |

## 已知限制

- 界面是英文的；本仓库未做中文化（避免长期维护上游改动）。
- 分支名称、颜色、效果字典的「名称 / 类型 / 落点」维护在 `export-md.js` 顶部常量里；节点只引用效果键。等树稳定后再考虑搬进 JSON。
- 浏览器 `localStorage` 只存当前浏览器；换机器请用 Export / Import。
- 编辑器每节点只能带一行 Meta Data；需要更多字段时先评估是否扩展上游字段，而不是塞更多约定。
- 本工具不检查「科技树是否值得做」；设计判断见文档 §1 与 §8。
