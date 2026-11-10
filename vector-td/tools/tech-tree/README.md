# VECTOR 科技树编辑器（内部设计工具）

可视化编辑 VECTOR 科技树，并**直接导出 Markdown 文档**（总览 / 每棵树关系图与节点表 / 效果字典 / 校验）。

> **边界**：本目录是内部工具，**不随游戏发布**，不进入 `dist/`、`release/`，也不部署到线上。它只影响设计文档与策划讨论，不影响玩家可见内容。

## 来源与许可

- 上游项目：[CommanderFoo/skill-tree-planner](https://github.com/CommanderFoo/skill-tree-planner)（MIT，见 [LICENSE](LICENSE)）
- 引入时的上游版本：`49b9726`（2026-01-24，`--depth 1` 克隆）
- 相对上游的修改（都在文件头/说明里标注）：
  1. `index.html`：移除 Google Fonts 外链；标题与说明条改为 VECTOR；新增「载入初稿」「导出 MD」入口；挂载 `vector-loader.js` / `vector-export.js`；点数字段文案改为「能量核心」。
  2. `src/interactions.js`：**空白画布支持左键拖拽平移**（上游只支持中键 / 空格+左键）。
  3. `src/storage.js`：`localStorage` 键改为 `vector_tech_tree_planner_v1`。
  4. `src/styles.css`：字体栈换系统字体；追加说明条、导出提示、画布光标样式。
  5. 新增 `vector-loader.js`（自动载入初稿）、`vector-export.js`（浏览器导出 Markdown）、`vector-export-core.js`（共用导出核心）、`vector-tree.json`（初稿数据）、`export-md.js`（Node 校验/生成 CLI）、本 README。
- 上游其余代码未改动；MIT 许可与版权声明保留在 [LICENSE](LICENSE)。

## 快速开始

在**仓库根目录**启动静态服务器（ES module 需要 HTTP，不能双击 `file://`）：

```powershell
python -m http.server 5180 --bind 127.0.0.1
```

打开：<http://127.0.0.1:5180/vector-td/tools/tech-tree/>

- 首次打开（浏览器无本地存档）会自动载入 `vector-tree.json` 并「适应视图」。
- 之后打开会恢复上次编辑（浏览器 `localStorage`）。
- 想回到初稿：点顶部说明条右侧的 **载入初稿**（覆盖当前项目，有二次确认）。
- 画布操作：**左键拖拽空白处平移**、滚轮缩放、拖拽节点改位置、Shift+拖拽节点连线、`F` 适应视图。

## 科技树的结构是自由的

工具不预设“几棵树、几层、多少分支”，结构完全由数据决定：

- **单棵树 / 多棵树**都可以（顶部树选择器可切换、`＋` 新建树）。现在的 `vector-tree.json` 只是「7 棵塔树 + 1 棵跨局树」的演示初稿，可整体替换。
- 每棵树的节点、连线、层级、成本都可在编辑器里改；点满顺序由 `Prerequisite Logic`（AND / OR / SUM）决定。
- 导出器按数据生成 Markdown：树多就多几节，树少就少几节，不依赖固定分支名。
- 参考「亿万僵尸」的技能点架构时，建议保留：**单一技能点池 + 节点解锁链 + 有限的点数预算**；不要求照抄它的分支布局。

## 字段约定（重要）

工具的展示语义借下面的约定表达，`vector-export-core.js` 依赖它们（缺失时会降级并给出提醒，不会阻断导出）：

| 位置 | 约定 |
| --- | --- |
| 节点 ID | `<小写_序号>`，如 `prism_1`；文档显示为 `PRISM-1` |
| Node Settings → Meta Data | `branch=PRISM;tier=1;type=rule;effect=prism.precision` |
| `branch` | 分支代码；已知树会校验（塔树用塔代码，舰队核心用 EXP/MOD/FLT/ARC） |
| `tier` | 层级整数；**可省略**，省略时按前置深度推导 |
| `type` | `unlock` 解锁 / `rule` 规则 / `record` 档案 / `modifier` 数值（数值类默认提醒） |
| `effect` | 效果字典键；未登记会报错，空值只提醒 |
| Name / Description | 文档节点表的「名称 / 说明」列 |
| Tree Settings → Cost System | 选 **Skill Points**：点数就是**能量核心** |
| Tree Settings → 能量核心预算 | 这棵树可投入的能量核心上限 |
| 节点 Cost per Rank | 每阶消耗的能量核心，如 `2, 4` |
| Prerequisite Logic | `AND`（须）/ `OR`（或）/ `SUM`（合计） |

> 编辑器里的 `Type`（Passive/Active）字段不承载 VECTOR 语义，统一 `Passive` 即可；真实类型写在 Meta Data 的 `type=` 里。

## 导出 Markdown（两种方式）

**方式 A（推荐）**：编辑器工具栏点 **导出 MD**，浏览器直接下载 `科技树-YYYYMMDD-HHmm.md`。

**方式 B（命令行 / CI）**：

```powershell
# 只校验（有错误时退出码 1）
node vector-td/tools/tech-tree/export-md.js --check

# 生成到文件
node vector-td/tools/tech-tree/export-md.js --out tmp/科技树.md

# 写回文档的两个标记之间
node vector-td/tools/tech-tree/export-md.js --inject vector-td/docs/design/科技树.md
```

文档里用 `<!-- TECH-TREE:DATA:BEGIN -->` / `<!-- TECH-TREE:DATA:END -->` 包住数据段，`--inject` 只替换标记之间的内容。

生成内容：总览（每棵树节点数/成本/预算）、货币与预算、每棵树的关系图 + 节点表、效果字典、校验结果。

校验项：节点 ID 重复与格式、分支/类型/效果键登记、前置存在与层级（tier 必须更大）、循环依赖、`OR` 至少两个前置、成本阶数与上限一致、满树成本是否超出树的预算、`required_rank` 是否超过前置上限。

## 目录

| 文件 | 说明 |
| --- | --- |
| `index.html` / `src/` / `schemas/` | 上游编辑器（已打上述补丁） |
| `vector-loader.js` | 初稿自动载入、「载入初稿」按钮 |
| `vector-export.js` | 工具栏「导出 MD」按钮（浏览器端） |
| `vector-export-core.js` | 数据解析、校验、Markdown 生成（浏览器 / Node 共用） |
| `export-md.js` | Node CLI：`--check` / `--out` / `--inject` |
| `vector-tree.json` | 科技树数据（当前为演示初稿，可整体替换） |
| `package.json` | `type: module`，让 Node 直接运行 ESM 脚本 |
| `LICENSE` | 上游 MIT 许可 |

## 已知限制

- 界面是英文的（上游 UI）；VECTOR 语义通过 Meta Data 表达。
- 树的「能量核心预算」写在每棵树里；若最终采用**单一全局技能点池**，导出时以各树预算之和作为总预算，接入游戏时再统一成一个池。
- 分支名称 / 颜色 / 效果字典的展示配置维护在 `vector-export-core.js` 顶部；节点只引用效果键。
- 浏览器 `localStorage` 只存当前浏览器；换机器请用 Export / Import。
- 编辑器每个节点只能带一行 Meta Data；需要更多字段时先评估是否扩展上游字段，而不是继续塞约定。
- 触屏拖拽平移/拖节点未做（上游移动端支持不完整），当前以桌面操作为主。
- 本工具不检查「科技树是否值得做」；设计判断见文档与评审。
