#!/usr/bin/env node
/**
 * VECTOR 科技树 · Markdown 生成器
 *
 * 读取 tools/tech-tree/vector-tree.json（Skill Tree Planner 项目格式），
 * 校验结构并生成「科技树.md」中的数据段（分支/资源/层级/关系图/节点表/效果字典/校验）。
 *
 * 用法（在仓库根目录）：
 *   node vector-td/tools/tech-tree/export-md.js --check
 *   node vector-td/tools/tech-tree/export-md.js --inject vector-td/docs/design/科技树.md
 *   node vector-td/tools/tech-tree/export-md.js              # 只打印到 stdout
 *
 * 无第三方依赖。
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SCRIPT_DIR = __dirname;
const DEFAULT_IN = path.join(SCRIPT_DIR, "vector-tree.json");
const MARK_BEGIN = "<!-- TECH-TREE:DATA:BEGIN -->";
const MARK_END = "<!-- TECH-TREE:DATA:END -->";

/* ---------------- 配置：分支与效果字典（单一事实源） ---------------- */

const BRANCHES = {
  EXP: { name: "远征许可", color: "#5fd7ff", desc: "开放远征、元素星域与威胁协议等玩法入口" },
  MOD: { name: "模块仓库", color: "#ff7ad9", desc: "扩充模块池、槽位与重构规则" },
  FLT: { name: "编队扩容", color: "#f5c451", desc: "增加编队位与预编队保存" },
  ARC: { name: "档案回廊", color: "#9d8cff", desc: "图鉴、称号与回廊记录等表达层内容" },
  LOG: { name: "后勤协议", color: "#5fffa8", desc: "结算与整备的效率规则" },
};

const NODE_TYPES = {
  unlock: { label: "解锁" },
  rule: { label: "规则" },
  record: { label: "档案" },
  modifier: { label: "数值" },
};

const EFFECTS = {
  "unlock.expedition": {
    name: "解锁远征",
    kind: "unlock",
    target: "远征 / 编队",
    impl: "save.unlocks.expedition；新字段需同步 defaultSave() 与 loadSaveData()",
  },
  "unlock.elemental": {
    name: "解锁元素星域",
    kind: "unlock",
    target: "元素星域",
    impl: "save.unlocks.elemental；需新立 baseline 后接入",
  },
  "unlock.abyss": {
    name: "解锁深渊远征",
    kind: "unlock",
    target: "深渊远征",
    impl: "save.unlocks.abyss；依赖 2.0 远征基线",
  },
  "unlock.threat": {
    name: "解锁威胁协议",
    kind: "unlock",
    target: "威胁协议",
    impl: "save.unlocks.threat；0–3 层协议开关",
  },
  "unlock.module.standard": {
    name: "开放标准模块池",
    kind: "unlock",
    target: "模块池",
    impl: "save.unlocks.moduleTier；模块数据见扩容策划书 §6.3",
  },
  "unlock.module.rare": {
    name: "开放稀有模块池",
    kind: "unlock",
    target: "模块池",
    impl: "save.unlocks.moduleTier",
  },
  "unlock.module.slot": {
    name: "模块槽位 +1",
    kind: "unlock",
    target: "模块槽位",
    impl: "局内模块槽位数读取 save.unlocks.moduleSlots",
  },
  "rule.module.reforge": {
    name: "模块重构",
    kind: "rule",
    target: "模块",
    impl: "局内规则标志（每局 1 次），不写入 computeMods",
  },
  "unlock.squad.slot2": {
    name: "第二编队",
    kind: "unlock",
    target: "编队",
    impl: "save.unlocks.squadSlots",
  },
  "unlock.squad.slot3": {
    name: "第三编队",
    kind: "unlock",
    target: "编队",
    impl: "save.unlocks.squadSlots",
  },
  "rule.squad.preset": {
    name: "预编队",
    kind: "rule",
    target: "编队",
    impl: "局外编队存档（localStorage 前缀 vector_），不进 combat",
  },
  "record.squad.archive": {
    name: "编队档案",
    kind: "record",
    target: "图鉴 / 档案",
    impl: "只读展示层；数据可并入 records_v1 体系",
  },
  "record.archive": {
    name: "回廊档案",
    kind: "record",
    target: "档案",
    impl: "记录回廊编成与成绩；不改变战斗数值",
  },
  "rule.protocol.tactical": {
    name: "战术协议",
    kind: "rule",
    target: "协议",
    impl: "3 星后抽取；协议星写入 save.protocolStars",
  },
  "record.title": {
    name: "称号陈列",
    kind: "record",
    target: "称号",
    impl: "展示层；称号解锁表独立于 save.skills",
  },
  "rule.archive.rank": {
    name: "档案评级",
    kind: "rule",
    target: "档案",
    impl: "按编成与漏怪结算；仅展示与统计，不改战力",
  },
  "rule.log.preview": {
    name: "战前预演",
    kind: "rule",
    target: "敌情",
    impl: "简报/敌情 UI 读取开关；不改动波次数据",
  },
  "rule.log.summary": {
    name: "结算清单",
    kind: "rule",
    target: "结算",
    impl: "结算页展示 records_v1 聚合数据；不新增存档",
  },
  "unlock.log.practice": {
    name: "演习模式",
    kind: "unlock",
    target: "模式",
    impl: "不结算金币/星级；需在 finishRun 前短路",
  },
};

/* ---------------- 工具函数 ---------------- */

function fail(message) {
  console.error("✗ " + message);
  process.exit(1);
}

function usage() {
  console.log(
    [
      "用法: node vector-td/tools/tech-tree/export-md.js [选项]",
      "",
      "  --in <file>      输入 JSON（默认 tools/tech-tree/vector-tree.json）",
      "  --tree <id>      指定 project.trees 中的树 id（默认取第一棵）",
      "  --check          只校验，不输出 Markdown；有错误时退出码 1",
      "  --inject <file>  把生成的数据段写入文档的两个标记之间",
      "  --out <file>     把生成的数据段写入独立文件",
      "  --quiet          不打印校验摘要",
      "  -h, --help       显示帮助",
      "",
      "数据约定：节点 metadata 形如",
      "  branch=EXP;tier=1;type=unlock;effect=unlock.expedition",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const options = {
    input: DEFAULT_IN,
    treeId: null,
    check: false,
    inject: null,
    output: null,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--in") options.input = argv[++i];
    else if (arg === "--tree") options.treeId = argv[++i];
    else if (arg === "--check") options.check = true;
    else if (arg === "--inject") options.inject = argv[++i];
    else if (arg === "--out") options.output = argv[++i];
    else if (arg === "--quiet") options.quiet = true;
    else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else fail("未知参数：" + arg);
  }
  return options;
}

function parseMeta(raw) {
  const meta = {};
  String(raw || "")
    .split(";")
    .forEach(function (part) {
      const text = part.trim();
      if (!text) return;
      const eq = text.indexOf("=");
      if (eq === -1) {
        meta.__extra = (meta.__extra || []).concat(text);
        return;
      }
      meta[text.slice(0, eq).trim()] = text.slice(eq + 1).trim();
    });
  return meta;
}

function displayId(id) {
  const match = /^([a-z]+)_(\d+)$/.exec(String(id));
  if (match) return match[1].toUpperCase() + "-" + Number(match[2]);
  return String(id).toUpperCase();
}

function inferBranch(node, meta) {
  if (meta.branch) return meta.branch.toUpperCase();
  const tag = (node.tags || []).find(function (item) {
    return String(item).indexOf("branch:") === 0;
  });
  if (tag) return tag.slice("branch:".length).toUpperCase();
  const match = /^([a-z]+)_\d+$/.exec(String(node.id));
  if (match) return match[1].toUpperCase();
  return "?";
}

function mdCell(text) {
  return String(text == null ? "" : text)
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-US");
}

function sortedBranches() {
  return Object.keys(BRANCHES);
}

function branchOrder(code) {
  const index = sortedBranches().indexOf(code);
  return index === -1 ? 999 : index;
}

function sortModels(models) {
  return models.slice().sort(function (a, b) {
    const branchDiff = branchOrder(a.branch) - branchOrder(b.branch);
    if (branchDiff !== 0) return branchDiff;
    const tierDiff = (a.tier || 0) - (b.tier || 0);
    if (tierDiff !== 0) return tierDiff;
    const aNum = Number((/^[a-z]+_(\d+)$/.exec(a.id) || [])[1] || 0);
    const bNum = Number((/^[a-z]+_(\d+)$/.exec(b.id) || [])[1] || 0);
    return aNum - bNum;
  });
}

/* ---------------- 载入与建模 ---------------- */

function loadProject(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    fail("读不到输入文件：" + file + "（" + err.message + "）");
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    fail("JSON 解析失败：" + err.message);
  }
  const project = data && data.project ? data.project : data;
  if (!project || !Array.isArray(project.trees)) fail("JSON 中缺少 project.trees");
  if (project.trees.length === 0) fail("project.trees 为空");
  return project;
}

function pickTree(project, treeId) {
  if (treeId) {
    const tree = project.trees.find(function (item) {
      return item.id === treeId;
    });
    if (!tree) fail("找不到树：" + treeId);
    return tree;
  }
  return project.trees[0];
}

function buildModels(tree) {
  const byId = new Map();
  tree.nodes.forEach(function (node) {
    byId.set(node.id, node);
  });

  const incoming = new Map();
  tree.nodes.forEach(function (node) {
    incoming.set(node.id, []);
  });
  (tree.connections || []).forEach(function (conn) {
    if (incoming.has(conn.to_node_id)) incoming.get(conn.to_node_id).push(conn);
  });

  const models = tree.nodes.map(function (node) {
    const meta = parseMeta(node.metadata);
    const tierValue = parseInt(meta.tier, 10);
    const model = {
      raw: node,
      id: node.id,
      display: displayId(node.id),
      name: node.name || "（未命名）",
      description: node.description || "",
      branch: inferBranch(node, meta),
      type: meta.type || "unlock",
      effect: meta.effect || "",
      tier: Number.isInteger(tierValue) ? tierValue : null,
      meta: meta,
      incoming: incoming.get(node.id) || [],
      logic: String(node.prerequisite_logic || "AND").toUpperCase(),
    };
    model.prereqModels = model.incoming
      .map(function (conn) {
        return modelsById(byId, conn.from_node_id);
      })
      .filter(Boolean);
    return model;
  });

  return { models: models, byId: byId };
}

function modelsById(byId, id) {
  const node = byId.get(id);
  if (!node) return null;
  return { raw: node, id: node.id, display: displayId(node.id) };
}

/* ---------------- 深度与环检测 ---------------- */

function computeDepth(models) {
  const byId = new Map();
  models.forEach(function (model) {
    byId.set(model.id, model);
  });
  const cache = new Map();
  const visiting = new Set();

  function depth(id) {
    if (cache.has(id)) return cache.get(id);
    const model = byId.get(id);
    if (!model) return 1;
    if (visiting.has(id)) return 1; // 环：交给环检测报告
    visiting.add(id);
    let best = 0;
    model.incoming.forEach(function (conn) {
      if (byId.has(conn.from_node_id)) best = Math.max(best, depth(conn.from_node_id));
    });
    visiting.delete(id);
    const value = best + 1;
    cache.set(id, value);
    return value;
  }

  models.forEach(function (model) {
    depth(model.id);
  });
  return cache;
}

function findCycles(models) {
  const byId = new Map();
  models.forEach(function (model) {
    byId.set(model.id, model);
  });
  const state = new Map();
  const cycleNodes = new Set();
  const cycles = [];

  function visit(id, stack) {
    const status = state.get(id) || 0;
    if (status === 2) return;
    if (status === 1) {
      const start = stack.indexOf(id);
      const cycle = stack.slice(start).concat(id);
      cycles.push(cycle);
      cycle.forEach(function (item) {
        cycleNodes.add(item);
      });
      return;
    }
    state.set(id, 1);
    const model = byId.get(id);
    if (model) {
      model.incoming.forEach(function (conn) {
        if (byId.has(conn.from_node_id)) visit(conn.from_node_id, stack.concat(id));
      });
    }
    state.set(id, 2);
  }

  models.forEach(function (model) {
    visit(model.id, []);
  });
  return { cycleNodes: cycleNodes, cycles: cycles };
}

/* ---------------- 校验 ---------------- */

function validate(tree, models) {
  const issues = [];
  const push = function (level, msg) {
    issues.push({ level: level, msg: msg });
  };
  const byId = new Map();
  models.forEach(function (model) {
    byId.set(model.id, model);
  });

  const resourceById = new Map();
  (tree.resources || []).forEach(function (res) {
    resourceById.set(res.id, res);
  });

  const seen = new Set();
  models.forEach(function (model) {
    if (seen.has(model.id)) push("error", "节点 ID 重复：" + model.id);
    seen.add(model.id);

    if (!/^[a-z]+_\d+$/.test(model.id)) {
      push("warn", "节点 ID 建议采用「分支小写_序号」格式（如 exp_1）：" + model.id);
    }
    if (!BRANCHES[model.branch]) push("error", model.display + " 分支代码未登记：" + model.branch);
    if (!NODE_TYPES[model.type]) push("error", model.display + " 节点类型未登记：" + model.type);
    if (model.type === "modifier") {
      push(
        "warn",
        model.display + " 是数值类节点：当前红线是「不做永久 +数值 的 meta 成长」，请确认它只改规则/资源而不是直接加战力"
      );
    }
    if (model.tier === null) push("error", model.display + " 缺少 tier（Meta Data 需包含 tier=N）");
    else if (model.tier < 1) push("error", model.display + " tier 必须 ≥1");
    if (!model.effect) push("warn", model.display + " 未绑定效果键");
    else if (!EFFECTS[model.effect]) push("error", model.display + " 效果键未在 export-md.js 效果字典登记：" + model.effect);

    const raw = model.raw;
    if (!(raw.max_rank >= 1)) push("error", model.display + " max_rank 必须 ≥1");
    if (!Array.isArray(raw.cost_per_rank) || raw.cost_per_rank.length === 0) {
      push("error", model.display + " 缺少 cost_per_rank");
    }
    if (!Array.isArray(raw.resource_costs)) {
      push("warn", model.display + " 缺少 resource_costs");
    } else {
      if (raw.resource_costs.length !== raw.max_rank) {
        push(
          "warn",
          model.display + " 资源成本阶数（" + raw.resource_costs.length + "）与上限（" + raw.max_rank + "）不一致"
        );
      }
      raw.resource_costs.forEach(function (rank, index) {
        (rank || []).forEach(function (cost) {
          if (!resourceById.has(cost.resource_id)) {
            push("error", model.display + " 第 " + (index + 1) + " 阶引用了未登记资源：" + cost.resource_id);
          }
          if (num(cost.amount) < 0) {
            push("error", model.display + " 第 " + (index + 1) + " 阶成本为负");
          }
        });
      });
    }

    model.incoming.forEach(function (conn) {
      const from = byId.get(conn.from_node_id);
      if (!from) {
        push("error", model.display + " 的前置节点不存在：" + conn.from_node_id);
        return;
      }
      if (model.tier !== null && from.tier !== null && from.tier >= model.tier) {
        push(
          "error",
          model.display + "（T" + model.tier + "）的前置 " + from.display + "（T" + from.tier + "）层级必须更低"
        );
      }
      if (num(conn.required_rank || 1) > num(from.raw.max_rank)) {
        push(
          "error",
          model.display + " 要求前置 " + from.display + " 达到 " + (conn.required_rank || 1) + " 阶，超过其上限"
        );
      }
    });

    if (model.incoming.length === 0 && model.tier !== null && model.tier > 1) {
      push("warn", model.display + " 是 T" + model.tier + " 但没有前置，会成为孤立起点");
    }
    if (model.logic === "OR" && model.incoming.length < 2) {
      push("warn", model.display + " 使用「或」逻辑但前置少于 2 个");
    }
  });

  // 环
  const cycleInfo = findCycles(models);
  if (cycleInfo.cycles.length > 0) {
    const shown = cycleInfo.cycles
      .slice(0, 5)
      .map(function (cycle) {
        return cycle.map(displayId).join(" → ");
      })
      .join("；");
    push("error", "存在循环依赖：" + shown);
  }

  // 深度一致性
  const depth = computeDepth(models);
  models.forEach(function (model) {
    const expected = depth.get(model.id) || 1;
    if (model.tier !== null && model.tier !== expected) {
      push(
        "warn",
        model.display + " tier=T" + model.tier + " 与前缀深度 T" + expected + " 不一致（改前置后请同步层级）"
      );
    }
  });

  // 分支覆盖
  sortedBranches().forEach(function (code) {
    const list = models.filter(function (model) {
      return model.branch === code;
    });
    if (list.length === 0) {
      push("info", "分支 " + code + "（" + BRANCHES[code].name + "）还没有节点");
    } else if (
      !list.some(function (model) {
        return model.tier === 1;
      })
    ) {
      push("warn", "分支 " + code + "（" + BRANCHES[code].name + "）缺少 T1 入口");
    }
  });

  // 资源与预算
  const totals = new Map();
  (tree.resources || []).forEach(function (res) {
    totals.set(res.id, 0);
  });
  models.forEach(function (model) {
    (model.raw.resource_costs || []).forEach(function (rank) {
      (rank || []).forEach(function (cost) {
        totals.set(cost.resource_id, (totals.get(cost.resource_id) || 0) + num(cost.amount));
      });
    });
  });
  (tree.resources || []).forEach(function (res) {
    const used = totals.get(res.id) || 0;
    const budget = num(res.pool && res.pool.total);
    if (budget > 0 && used > budget) {
      push("warn", "资源「" + res.name + "」满树成本 " + formatNumber(used) + " 超出预算 " + formatNumber(budget));
    }
  });

  if (tree.cost_mode && tree.cost_mode !== "resources") {
    push("warn", "tree.cost_mode 建议使用 resources（多资源成本模式）");
  }

  return { issues: issues, totals: totals, depth: depth, cycles: cycleInfo };
}

/* ---------------- Markdown 生成 ---------------- */

function typeLabel(type) {
  return (NODE_TYPES[type] || {}).label || type;
}

function logicLabel(logic) {
  if (logic === "OR") return "或";
  if (logic === "SUM") return "合计";
  return "须";
}

function costText(model, resourceNameById) {
  const ranks = model.raw.resource_costs || [];
  if (ranks.length === 0) return "—";
  const parts = ranks.map(function (rank) {
    return (rank || [])
      .map(function (cost) {
        return (resourceNameById.get(cost.resource_id) || cost.resource_id) + " " + num(cost.amount);
      })
      .join(" + ");
  });
  return parts.filter(Boolean).join(" / ") || "—";
}

function prereqText(model) {
  if (model.incoming.length === 0) return "—";
  return model.incoming
    .map(function (conn) {
      return displayId(conn.from_node_id);
    })
    .join(" + ");
}

function effectCell(model) {
  return model.effect ? "`" + model.effect + "`" : "—";
}

function buildMarkdown(tree, models, validation) {
  const issues = validation.issues;
  const sorted = sortModels(models);
  const resourceNameById = new Map();
  (tree.resources || []).forEach(function (res) {
    resourceNameById.set(res.id, res.name);
  });
  const maxTier = sorted.reduce(function (max, model) {
    return Math.max(max, model.tier || 0);
  }, 0);
  const lines = [];

  lines.push("## 3. 树数据");
  lines.push("");
  lines.push(
    "> 本节由 `vector-td/tools/tech-tree/export-md.js` 根据 `vector-tree.json` 自动生成，**请修改编辑器后重新生成，不要手改节点表**。"
  );
  lines.push("");

  // 3.1 分支
  lines.push("### 3.1 分支");
  lines.push("");
  lines.push("| 代码 | 分支 | 定位 | 节点数 |");
  lines.push("| --- | --- | --- | ---: |");
  sortedBranches().forEach(function (code) {
    const branch = BRANCHES[code];
    const count = sorted.filter(function (model) {
      return model.branch === code;
    }).length;
    lines.push("| " + code + " | " + branch.name + " | " + mdCell(branch.desc) + " | " + count + " |");
  });
  lines.push("");

  // 3.2 资源与预算
  lines.push("### 3.2 资源与预算");
  lines.push("");
  lines.push("| 资源 | 满树成本 | 预算 | 占用 |");
  lines.push("| --- | ---: | ---: | ---: |");
  (tree.resources || []).forEach(function (res) {
    const used = validation.totals.get(res.id) || 0;
    const budget = num(res.pool && res.pool.total);
    const ratio = budget > 0 ? Math.round((used / budget) * 100) + "%" : "—";
    lines.push(
      "| " + res.name + " | " + formatNumber(used) + " | " + (budget > 0 ? formatNumber(budget) : "不限") + " | " + ratio + " |"
    );
  });
  lines.push("");

  // 3.3 层级分布
  lines.push("### 3.3 层级分布");
  lines.push("");
  const branchKeys = sortedBranches().filter(function (code) {
    return sorted.some(function (model) {
      return model.branch === code;
    });
  });
  lines.push("| 层 \\ 分支 | " + branchKeys.map(function (code) {
    return BRANCHES[code].name + " " + code;
  }).join(" | ") + " |");
  lines.push("| --- | " + branchKeys.map(function () { return "---"; }).join(" | ") + " |");
  for (let tier = 1; tier <= maxTier; tier++) {
    const cells = branchKeys.map(function (code) {
      const ids = sorted
        .filter(function (model) {
          return model.branch === code && model.tier === tier;
        })
        .map(function (model) {
          return model.display;
        });
      return ids.length ? ids.join("<br>") : "—";
    });
    lines.push("| T" + tier + " | " + cells.join(" | ") + " |");
  }
  lines.push("");

  // 3.4 关系图
  lines.push("### 3.4 关系图");
  lines.push("");
  lines.push("```mermaid");
  lines.push("flowchart TB");
  let lastBranch = null;
  sorted.forEach(function (model) {
    if (model.branch !== lastBranch) {
      if (lastBranch !== null) lines.push("    end");
      const label = (BRANCHES[model.branch] || { name: model.branch }).name + " " + model.branch;
      lines.push("    subgraph " + model.branch + " [" + label + "]");
      lastBranch = model.branch;
    }
    lines.push(
      '        ' + mermaidId(model.id) + '["' + (model.display + " · " + model.name).replace(/"/g, "'") + '"]'
    );
  });
  if (lastBranch !== null) lines.push("    end");
  sorted.forEach(function (model) {
    model.incoming.forEach(function (conn) {
      const arrow = model.logic === "OR" ? " -.->|或| " : " --> ";
      lines.push("    " + mermaidId(conn.from_node_id) + arrow + mermaidId(model.id));
    });
  });
  lines.push("```");
  lines.push("");

  // 3.5 节点表
  lines.push("### 3.5 节点表");
  lines.push("");
  lines.push("| ID | 层 | 分支 | 名称 | 类型 | 前置 | 逻辑 | 成本 | 上限 | 效果键 | 说明 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- |");
  sorted.forEach(function (model) {
    const branchName = (BRANCHES[model.branch] || { name: model.branch }).name;
    lines.push(
      "| " +
        model.display +
        " | T" + (model.tier || 0) +
        " | " + branchName +
        " | " + mdCell(model.name) +
        " | " + typeLabel(model.type) +
        " | " + prereqText(model) +
        " | " + (model.incoming.length ? logicLabel(model.logic) : "—") +
        " | " + mdCell(costText(model, resourceNameById)) +
        " | " + num(model.raw.max_rank) +
        " | " + effectCell(model) +
        " | " + mdCell(model.description) +
        " |"
    );
  });
  lines.push("");

  // 3.6 效果字典
  lines.push("### 3.6 效果字典");
  lines.push("");
  lines.push("| 效果键 | 名称 | 类型 | 作用对象 | 落点 |");
  lines.push("| --- | --- | --- | --- | --- |");
  const usedEffects = [];
  sorted.forEach(function (model) {
    if (model.effect && usedEffects.indexOf(model.effect) === -1) usedEffects.push(model.effect);
  });
  usedEffects.forEach(function (key) {
    const effect = EFFECTS[key] || { name: "（未登记）", kind: "—", target: "—", impl: "—" };
    lines.push(
      "| `" + key + "` | " + mdCell(effect.name) + " | " + typeLabel(effect.kind) + " | " + mdCell(effect.target) + " | " + mdCell(effect.impl) + " |"
    );
  });
  if (usedEffects.length === 0) lines.push("| — | — | — | — | — |");
  lines.push("");

  // 3.7 校验
  const errors = issues.filter(function (issue) { return issue.level === "error"; });
  const warnings = issues.filter(function (issue) { return issue.level === "warn"; });
  const infos = issues.filter(function (issue) { return issue.level === "info"; });
  lines.push("### 3.7 校验");
  lines.push("");
  lines.push(
    "- 节点 " + models.length + " · 分支 " + sortedBranches().filter(function (code) {
      return models.some(function (model) { return model.branch === code; });
    }).length + " · 最大层级 T" + maxTier
  );
  lines.push("- 错误 " + errors.length + " · 提醒 " + warnings.length + " · 信息 " + infos.length);
  if (issues.length === 0) {
    lines.push("- 全部校验通过。");
  } else {
    lines.push("");
    issues.forEach(function (issue) {
      const prefix = issue.level === "error" ? "错误" : issue.level === "warn" ? "提醒" : "信息";
      lines.push("- **" + prefix + "**：" + issue.msg);
    });
  }
  lines.push("");

  return lines.join("\n");
}

function mermaidId(id) {
  return String(id).replace(/[^A-Za-z0-9_]/g, "_");
}

/* ---------------- 文件写入 ---------------- */

function injectIntoDocument(docPath, block) {
  let text;
  try {
    text = fs.readFileSync(docPath, "utf8");
  } catch (err) {
    fail("读不到目标文档：" + docPath + "（" + err.message + "）");
  }
  const begin = text.indexOf(MARK_BEGIN);
  const end = text.indexOf(MARK_END);
  if (begin === -1 || end === -1 || end < begin) {
    fail("目标文档缺少标记：" + MARK_BEGIN + " / " + MARK_END);
  }
  const head = text.slice(0, begin + MARK_BEGIN.length);
  const tail = text.slice(end);
  const next = head + "\n\n" + block.trim() + "\n\n" + tail;
  fs.writeFileSync(docPath, next, "utf8");
}

function writeOutput(file, block) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, block.trim() + "\n", "utf8");
}

/* ---------------- 主流程 ---------------- */

function main() {
  const options = parseArgs(process.argv.slice(2));
  const project = loadProject(options.input);
  const tree = pickTree(project, options.treeId);
  const built = buildModels(tree);
  const validation = validate(tree, built.models);
  const block = buildMarkdown(tree, built.models, validation);

  const errors = validation.issues.filter(function (issue) {
    return issue.level === "error";
  });
  const warnings = validation.issues.filter(function (issue) {
    return issue.level === "warn";
  });

  if (!options.quiet) {
    const resourceParts = [];
    const resourceNameById = new Map();
    (tree.resources || []).forEach(function (res) {
      resourceNameById.set(res.id, res.name);
      resourceParts.push(res.name + " " + formatNumber(validation.totals.get(res.id) || 0) + "/" + formatNumber(num(res.pool && res.pool.total)));
    });
    console.log(
      "[tech-tree] 节点 " + built.models.length + " · 错误 " + errors.length + " · 提醒 " + warnings.length +
        (resourceParts.length ? " · " + resourceParts.join("，") : "")
    );
    validation.issues
      .filter(function (issue) {
        return issue.level !== "info";
      })
      .slice(0, 20)
      .forEach(function (issue) {
        console.log("  - " + (issue.level === "error" ? "错误" : "提醒") + "：" + issue.msg);
      });
  }

  if (options.check) {
    if (errors.length > 0) process.exitCode = 1;
    return;
  }

  if (options.inject) {
    injectIntoDocument(options.inject, block);
    if (!options.quiet) console.log("[tech-tree] 已写入 " + options.inject);
  } else if (options.output) {
    writeOutput(options.output, block);
    if (!options.quiet) console.log("[tech-tree] 已写入 " + options.output);
  } else {
    process.stdout.write(block + "\n");
  }

  if (errors.length > 0) process.exitCode = 1;
}

main();
