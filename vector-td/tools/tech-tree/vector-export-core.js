/**
 * VECTOR 科技树 · 导出核心（浏览器与 Node 共用，无 DOM / 无 fs 依赖）
 *
 * 职责：
 * 1. 定义科技树的展示配置：树元信息、分支名称、效果字典；
 * 2. 把编辑器项目（Skill Tree Planner 格式）解析成节点模型；
 * 3. 校验结构（层级、前置、环、预算、效果键等）；
 * 4. 生成 Markdown（总览 / 每棵树的关系图与节点表 / 效果字典 / 校验）。
 *
 * 货币：能量核心（唯一科技货币；节点按阶消耗，写入 cost_per_rank）。
 */

/* ---------------- 展示配置 ---------------- */

export const CURRENCY = {
  name: "能量核心",
  note: "唯一科技货币；每个节点按阶消耗，写入编辑器的 Cost per Rank",
};

export const TREE_META = {
  prism_tree: {
    label: "棱镜箭塔",
    short: "PRISM",
    role: "单体 · 动能",
    color: "#5fd7ff",
    branches: ["PRISM"],
    desc: "廉价远程基线；棱镜 IV 起可同时锁定两个目标。",
  },
  gatling_tree: {
    label: "矢量机炮",
    short: "GATLING",
    role: "持续 · 动能",
    color: "#7dd3fc",
    branches: ["GATLING"],
    desc: "近距离持续单体火力，依靠预热层数堆伤害。",
  },
  cannon_tree: {
    label: "引力重炮",
    short: "CANNON",
    role: "范围 · 动能",
    color: "#f5c451",
    branches: ["CANNON"],
    desc: "范围爆发与分裂体处理，落点控制是核心。",
  },
  laser_tree: {
    label: "相干激光",
    short: "LASER",
    role: "持续 · 能量",
    color: "#ff7ad9",
    branches: ["LASER"],
    desc: "高能光束，破盾主力；升温与散热构成节奏。",
  },
  shock_tree: {
    label: "谐振震荡",
    short: "SHOCK",
    role: "近域 · 能量",
    color: "#c084fc",
    branches: ["SHOCK"],
    desc: "近域群伤与击退，韧性单位会让控制收益骤降。",
  },
  frost_tree: {
    label: "熵减冻结",
    short: "FROST",
    role: "控制 · 低温",
    color: "#67e8f9",
    branches: ["FROST"],
    desc: "伤害最低但减速不可替代；高韧性单位是天然克制。",
  },
  tesla_tree: {
    label: "链式电弧",
    short: "TESLA",
    role: "连锁 · 能量",
    color: "#a78bfa",
    branches: ["TESLA"],
    desc: "连锁清群与破盾，链数越多越依赖站位密度。",
  },
  fleet_tree: {
    label: "舰队核心",
    short: "FLEET",
    role: "跨局 · 解锁",
    color: "#5fffa8",
    branches: ["EXP", "MOD", "FLT", "ARC"],
    desc: "跨局横向解锁：远征许可、模块仓库、编队扩容、档案回廊。",
  },
};

export const BRANCH_META = {
  EXP: { label: "远征许可", desc: "开放远征与威胁协议等玩法入口" },
  MOD: { label: "模块仓库", desc: "扩充模块池与槽位" },
  FLT: { label: "编队扩容", desc: "增加编队位" },
  ARC: { label: "档案回廊", desc: "档案、称号与演习等表达层内容" },
};

export const NODE_TYPES = {
  unlock: { label: "解锁" },
  rule: { label: "规则" },
  record: { label: "档案" },
  modifier: { label: "数值" },
};

export const EFFECTS = {
  // 棱镜
  "prism.precision": { name: "精准射击", kind: "rule", target: "棱镜", impl: "每 3 次射击替换为 1 次 1.5× 冲击（2 阶 1.8×）" },
  "prism.split": { name: "分光", kind: "rule", target: "棱镜", impl: "副箭优先锁定未被主箭锁定的目标" },
  "prism.refract": { name: "折射追击", kind: "rule", target: "棱镜", impl: "击杀后下一发弹道折射至最近敌人" },
  // 机炮
  "gatling.spinup": { name: "枪管预热", kind: "rule", target: "机炮", impl: "对同一目标连续射击伤害递增，换目标清空" },
  "gatling.belt": { name: "弹链扩容", kind: "rule", target: "机炮", impl: "换目标不清空预热层数" },
  "gatling.splash": { name: "破片弹", kind: "rule", target: "机炮", impl: "每第 10 发造成小范围溅射" },
  // 重炮
  "cannon.crater": { name: "引力弹坑", kind: "rule", target: "重炮", impl: "落点留下 1.2 格减速场，持续 2 秒" },
  "cannon.collapse": { name: "引力坍塌", kind: "rule", target: "重炮", impl: "命中护盾时额外拉拽 0.3 格" },
  "cannon.double": { name: "二段爆破", kind: "rule", target: "重炮", impl: "范围伤害分两段结算，第二段延后 0.4 秒" },
  // 激光
  "laser.overcharge": { name: "过载击穿", kind: "rule", target: "激光", impl: "升温满时对护盾额外加成" },
  "laser.cooling": { name: "散热循环", kind: "rule", target: "激光", impl: "停火后升温衰减更慢，持续输出更稳" },
  "laser.pierce": { name: "贯穿光束", kind: "rule", target: "激光", impl: "升温满时光束贯穿直线上所有目标" },
  // 震荡
  "shock.directed": { name: "定向冲击", kind: "rule", target: "震荡", impl: "击退方向沿路径切线，减少推离航道" },
  "shock.resonance": { name: "共振腔", kind: "rule", target: "震荡", impl: "每次击退提升下一发范围 8%，最多 3 层" },
  "shock.collapse": { name: "坍缩", kind: "rule", target: "震荡", impl: "被击退撞到障碍或边界时额外伤害" },
  // 冻结
  "frost.deepfreeze": { name: "深冷剂", kind: "rule", target: "冻结", impl: "减速幅度上限提高" },
  "frost.brittle": { name: "脆化", kind: "rule", target: "冻结", impl: "被减速目标受到的动能伤害提高" },
  "frost.absolute": { name: "绝对零度", kind: "rule", target: "冻结", impl: "减速叠满后短暂定身 0.5 秒" },
  // 电弧
  "tesla.extrachain": { name: "富兰克林线圈", kind: "rule", target: "电弧", impl: "链数 +1" },
  "tesla.rebound": { name: "感生电流", kind: "rule", target: "电弧", impl: "链末端回弹一次，伤害衰减" },
  "tesla.storm": { name: "电弧风暴", kind: "rule", target: "电弧", impl: "每 12 次链击释放一次环状电弧" },
  // 跨局
  "unlock.expedition": { name: "解锁远征", kind: "unlock", target: "远征", impl: "save.unlocks.expedition；新字段需同步 defaultSave / loadSaveData" },
  "unlock.module": { name: "模块仓库", kind: "unlock", target: "模块池", impl: "save.unlocks.moduleTier" },
  "unlock.squad": { name: "编队扩容", kind: "unlock", target: "编队位", impl: "save.unlocks.squadSlots" },
  "unlock.threat": { name: "威胁协议", kind: "unlock", target: "威胁协议", impl: "save.unlocks.threat" },
  "record.archive": { name: "档案回廊", kind: "record", target: "档案", impl: "复用 records_v1 聚合，不新增存储" },
  "unlock.practice": { name: "演习模式", kind: "unlock", target: "模式", impl: "不结算金币/星级；需在 finishRun 前短路" },
};

/* ---------------- 通用工具 ---------------- */

export function displayId(id) {
  const match = /^([a-z]+)_(\d+)$/.exec(String(id));
  return match ? match[1].toUpperCase() + "-" + Number(match[2]) : String(id).toUpperCase();
}

export function parseMetadata(raw) {
  const meta = {};
  String(raw || "")
    .split(";")
    .forEach((part) => {
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

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-US");
}

function mdCell(text) {
  return String(text == null ? "" : text)
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

function typeLabel(type) {
  return (NODE_TYPES[type] || {}).label || type;
}

function logicLabel(logic) {
  if (logic === "OR") return "OR";
  if (logic === "SUM") return "SUM";
  return "AND";
}

function mermaidId(id) {
  return String(id).replace(/[^A-Za-z0-9_]/g, "_");
}

function treeMeta(tree) {
  return (
    TREE_META[tree.id] || {
      label: tree.name || tree.id,
      short: String(tree.id || "?").toUpperCase(),
      role: "",
      color: "#94a3b8",
      branches: null,
      desc: tree.description || "",
    }
  );
}

/* ---------------- 建模 ---------------- */

function computeDepths(models) {
  const byId = new Map();
  models.forEach((model) => byId.set(model.id, model));
  const cache = new Map();
  const visiting = new Set();

  function depth(id) {
    if (cache.has(id)) return cache.get(id);
    const model = byId.get(id);
    if (!model) return 1;
    if (visiting.has(id)) return 1; // 环交给环检测
    visiting.add(id);
    let best = 0;
    model.incoming.forEach((conn) => {
      if (byId.has(conn.from_node_id)) best = Math.max(best, depth(conn.from_node_id));
    });
    visiting.delete(id);
    const value = best + 1;
    cache.set(id, value);
    return value;
  }

  models.forEach((model) => depth(model.id));
  return cache;
}

function findCycles(models) {
  const byId = new Map();
  models.forEach((model) => byId.set(model.id, model));
  const state = new Map();
  const cycles = [];

  function visit(id, stack) {
    const status = state.get(id) || 0;
    if (status === 2) return;
    if (status === 1) {
      const start = stack.indexOf(id);
      const cycle = stack.slice(start).concat(id);
      cycles.push(cycle);
      return;
    }
    state.set(id, 1);
    const model = byId.get(id);
    if (model) {
      model.incoming.forEach((conn) => {
        if (byId.has(conn.from_node_id)) visit(conn.from_node_id, stack.concat(id));
      });
    }
    state.set(id, 2);
  }

  models.forEach((model) => visit(model.id, []));
  return cycles;
}

export function normalizeProject(raw) {
  return raw && raw.project ? raw.project : raw;
}

/**
 * 解析整个项目，返回每棵树的节点模型与全局校验问题。
 * @param {object} raw 项目或 { version, project }
 * @returns {{project:object, trees:Array, issues:Array, stats:object}}
 */
export function analyzeProject(raw) {
  const project = normalizeProject(raw);
  const issues = [];
  const push = (level, msg) => issues.push({ level, msg });
  const trees = [];
  const seenIds = new Map();

  if (!project || !Array.isArray(project.trees) || project.trees.length === 0) {
    push("error", "项目里没有任何技能树");
    return { project, trees, issues, stats: { nodeCount: 0, cost: 0, budget: 0 } };
  }

  project.trees.forEach((tree) => {
    const meta = treeMeta(tree);
    const incoming = new Map();
    (tree.nodes || []).forEach((node) => incoming.set(node.id, []));
    (tree.connections || []).forEach((conn) => {
      if (incoming.has(conn.to_node_id)) incoming.get(conn.to_node_id).push(conn);
    });

    const models = (tree.nodes || []).map((node) => {
      const metaData = parseMetadata(node.metadata);
      const tierValue = parseInt(metaData.tier, 10);
      const model = {
        raw: node,
        id: node.id,
        display: displayId(node.id),
        name: node.name || "（未命名）",
        description: node.description || "",
        branch: (metaData.branch || meta.short || "?").toUpperCase(),
        type: metaData.type || "unlock",
        effect: metaData.effect || "",
        tier: Number.isInteger(tierValue) ? tierValue : null,
        logic: String(node.prerequisite_logic || "AND").toUpperCase(),
        incoming: incoming.get(node.id) || [],
        cost: 0,
        maxRank: num(node.max_rank) || 1,
      };
      const costs = Array.isArray(node.cost_per_rank) ? node.cost_per_rank : [];
      model.cost = costs.reduce((sum, value) => sum + num(value), 0);
      return model;
    });

    const byId = new Map();
    models.forEach((model) => byId.set(model.id, model));
    const timeLabel = (model) => meta.label + " · " + model.display;
    const depth = computeDepths(models);

    models.forEach((model) => {
      if (!/^[a-z]+_\d+$/.test(model.id)) {
        push("warn", timeLabel(model) + " 的 ID 建议使用「小写_序号」，如 prism_1");
      }
      if (seenIds.has(model.id)) {
        push("error", "节点 ID 重复： " + model.id + "（出现在 " + seenIds.get(model.id) + " 与 " + meta.label + "）");
      } else {
        seenIds.set(model.id, meta.label);
      }
      if (meta.branches && !meta.branches.includes(model.branch)) {
        push("error", timeLabel(model) + " 分支代码未登记：" + model.branch);
      }
      if (!NODE_TYPES[model.type]) push("warn", timeLabel(model) + " 节点类型未登记，按「规则」展示：" + model.type);
      if (model.type === "modifier") {
        push("warn", timeLabel(model) + " 是数值类节点：当前科技树以规则/解锁为主，纯数值加成需单独评审");
      }
      if (model.tier === null) {
        model.tier = depth.get(model.id) || 1;
        model.tierDerived = true;
        push("info", timeLabel(model) + " 未写 tier，已按前置深度推导为 T" + model.tier);
      } else if (model.tier < 1) {
        push("error", timeLabel(model) + " 的 tier 必须 ≥1");
      }
      if (!model.effect) push("warn", timeLabel(model) + " 未绑定效果键");
      else if (!EFFECTS[model.effect]) push("error", timeLabel(model) + " 效果键未登记：" + model.effect);

      if (!(model.maxRank >= 1)) push("error", timeLabel(model) + " max_rank 必须 ≥1");
      if (!Array.isArray(model.raw.cost_per_rank) || model.raw.cost_per_rank.length === 0) {
        push("error", timeLabel(model) + " 缺少 cost_per_rank");
      } else if (model.raw.cost_per_rank.length !== model.maxRank) {
        push("warn", timeLabel(model) + " 成本阶数（" + model.raw.cost_per_rank.length + "）与上限（" + model.maxRank + "）不一致");
      }

      model.incoming.forEach((conn) => {
        const from = byId.get(conn.from_node_id);
        if (!from) {
          push("error", timeLabel(model) + " 的前置节点不存在：" + conn.from_node_id);
          return;
        }
        if (model.tier !== null && from.tier !== null && from.tier >= model.tier) {
          push("error", timeLabel(model) + "（T" + model.tier + "）的前置 " + from.display + "（T" + from.tier + "）层级必须更低");
        }
        if (num(conn.required_rank || 1) > num(from.raw.max_rank)) {
          push("error", timeLabel(model) + " 要求前置 " + from.display + " 达到 " + (conn.required_rank || 1) + " 阶，超过其上限");
        }
      });
      if (model.incoming.length === 0 && model.tier !== null && model.tier > 1) {
        push("warn", timeLabel(model) + " 是 T" + model.tier + " 但没有前置");
      }
      if (model.logic === "OR" && model.incoming.length < 2) {
        push("warn", timeLabel(model) + " 使用「或」逻辑但前置少于 2 个");
      }
    });

    models.forEach((model) => {
      if (model.tierDerived) return;
      const expected = depth.get(model.id) || 1;
      if (model.tier !== null && model.tier !== expected) {
        push("warn", timeLabel(model) + " tier=T" + model.tier + " 与前置深度 T" + expected + " 不一致");
      }
    });

    const cycles = findCycles(models);
    if (cycles.length > 0) {
      const shown = cycles
        .slice(0, 5)
        .map((cycle) => cycle.map(displayId).join(" → "))
        .join("；");
      push("error", meta.label + " 存在循环依赖：" + shown);
    }

    const budget = num(tree.point_pool && tree.point_pool.total);
    const cost = models.reduce((sum, model) => sum + model.cost, 0);
    if (models.length === 0) {
      push("info", meta.label + " 还没有节点");
    } else if (budget > 0 && cost > budget) {
      push("warn", meta.label + " 满树成本 " + formatNumber(cost) + " 超出预算 " + formatNumber(budget));
    }
    if (models.length > 0 && !models.some((model) => model.tier === 1)) {
      push("warn", meta.label + " 缺少 T1 入口");
    }

    trees.push({
      tree,
      meta,
      models: models.slice().sort((a, b) => {
        if ((a.tier || 0) !== (b.tier || 0)) return (a.tier || 0) - (b.tier || 0);
        const aNum = Number((/^[a-z]+_(\d+)$/.exec(a.id) || [])[1] || 0);
        const bNum = Number((/^[a-z]+_(\d+)$/.exec(b.id) || [])[1] || 0);
        return aNum - bNum;
      }),
      budget,
      cost,
    });
  });

  const stats = {
    nodeCount: trees.reduce((sum, item) => sum + item.models.length, 0),
    cost: trees.reduce((sum, item) => sum + item.cost, 0),
    budget: trees.reduce((sum, item) => sum + item.budget, 0),
  };

  return { project, trees, issues, stats };
}


function localStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return (
    now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) +
    " " + pad(now.getHours()) + ":" + pad(now.getMinutes())
  );
}

/* ---------------- 校验摘要 ---------------- */

export function summarizeIssues(issues) {
  return {
    errors: issues.filter((issue) => issue.level === "error"),
    warnings: issues.filter((issue) => issue.level === "warn"),
    infos: issues.filter((issue) => issue.level === "info"),
  };
}

/* ---------------- Markdown 生成 ---------------- */

function effectCell(model) {
  return model.effect ? "`" + model.effect + "`" : "—";
}

function prereqText(model) {
  if (model.incoming.length === 0) return "—";
  return model.incoming.map((conn) => displayId(conn.from_node_id)).join(" + ");
}

function costText(model) {
  const ranks = Array.isArray(model.raw.cost_per_rank) ? model.raw.cost_per_rank : [];
  if (ranks.length === 0) return "—";
  return ranks.map((value) => CURRENCY.name + " " + num(value)).join(" / ");
}

function branchLabel(treeEntry, model) {
  if (treeEntry.meta.branches && treeEntry.meta.branches.includes(model.branch)) {
    const branch = BRANCH_META[model.branch];
    return branch ? branch.label : treeEntry.meta.label;
  }
  return treeEntry.meta.label;
}

function renderOverview(analysis) {
  const lines = [];
  lines.push("## 1. 总览");
  lines.push("");
  lines.push("| 树 | 主题 | 节点 | 满树成本 | 预算 | 占用 |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: |");
  analysis.trees.forEach((entry) => {
    const ratio = entry.budget > 0 ? Math.round((entry.cost / entry.budget) * 100) + "%" : "—";
    lines.push(
      "| " +
        entry.meta.label +
        " | " +
        mdCell(entry.meta.role) +
        " | " +
        entry.models.length +
        " | " +
        formatNumber(entry.cost) +
        " | " +
        (entry.budget > 0 ? formatNumber(entry.budget) : "不限") +
        " | " +
        ratio +
        " |"
    );
  });
  lines.push("");
  lines.push(
    "- 合计：" +
      analysis.stats.nodeCount +
      " 个节点 · 满树成本 " +
      formatNumber(analysis.stats.cost) +
      " " +
      CURRENCY.name +
      " · 总预算 " +
      formatNumber(analysis.stats.budget) +
      " " +
      CURRENCY.name
  );
  lines.push("");
  return lines;
}

function renderCurrency() {
  return [
    "## 2. 货币与预算",
    "",
    "- **" + CURRENCY.name + "**：" + CURRENCY.note + "。",
    "- 金币与旧科技点已废弃，全部科技投入统一走能量核心。",
    "- 每棵树的预算写在编辑器的 Tree Settings → 能量核心预算（本工具按树的预算汇总为总预算）。",
    "- 控制在总预算内意味着「点亮全部节点」需要取舍；文档不假设玩家能点满。",
    "",
  ];
}

function renderTreeSection(entry, index) {
  const lines = [];
  const number = index + 3; // 总览=1，货币=2，树从 3 开始
  const role = entry.meta.role ? " · " + entry.meta.role : "";
  lines.push("## " + number + ". " + entry.meta.label + "（" + entry.meta.short + role + "）");
  lines.push("");
  if (entry.meta.desc) {
    lines.push("> " + entry.meta.desc);
    lines.push("");
  }
  lines.push("```mermaid");
  lines.push("flowchart TB");
  entry.models.forEach((model) => {
    lines.push(
      "    " + mermaidId(model.id) + '["' + (model.display + " · " + model.name).replace(/"/g, "'") + '"]'
    );
  });
  entry.models.forEach((model) => {
    model.incoming.forEach((conn) => {
      const arrow = model.logic === "OR" ? " -.->|或| " : " --> ";
      lines.push("    " + mermaidId(conn.from_node_id) + arrow + mermaidId(model.id));
    });
  });
  lines.push("```");
  lines.push("");
  lines.push("| ID | 层 | 分支 | 名称 | 类型 | 前置 | 逻辑 | 成本 | 上限 | 效果键 | 说明 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- |");
  entry.models.forEach((model) => {
    lines.push(
      "| " +
        model.display +
        " | T" + (model.tier || 0) +
        " | " + mdCell(branchLabel(entry, model)) +
        " | " + mdCell(model.name) +
        " | " + typeLabel(model.type) +
        " | " + prereqText(model) +
        " | " + (model.incoming.length ? logicLabel(model.logic) : "—") +
        " | " + mdCell(costText(model)) +
        " | " + model.maxRank +
        " | " + effectCell(model) +
        " | " + mdCell(model.description) +
        " |"
    );
  });
  lines.push("");
  return lines;
}

function renderEffects(analysis, number) {
  const lines = [];
  lines.push("## " + number + ". 效果字典");
  lines.push("");
  lines.push("| 效果键 | 名称 | 类型 | 作用对象 | 规则 |");
  lines.push("| --- | --- | --- | --- | --- |");
  const used = [];
  analysis.trees.forEach((entry) => {
    entry.models.forEach((model) => {
      if (model.effect && !used.includes(model.effect)) used.push(model.effect);
    });
  });
  used.forEach((key) => {
    const effect = EFFECTS[key] || { name: "（未登记）", kind: "—", target: "—", impl: "—" };
    lines.push(
      "| `" + key + "` | " + mdCell(effect.name) + " | " + typeLabel(effect.kind) + " | " + mdCell(effect.target) + " | " + mdCell(effect.impl) + " |"
    );
  });
  if (used.length === 0) lines.push("| — | — | — | — | — |");
  lines.push("");
  return lines;
}

function renderValidation(analysis, number) {
  const lines = [];
  const { errors, warnings, infos } = summarizeIssues(analysis.issues);
  lines.push("## " + number + ". 校验");
  lines.push("");
  lines.push("- 错误 " + errors.length + " · 提醒 " + warnings.length + " · 信息 " + infos.length);
  if (analysis.issues.length === 0) {
    lines.push("- 全部校验通过。");
  } else {
    lines.push("");
    analysis.issues.forEach((issue) => {
      const prefix = issue.level === "error" ? "错误" : issue.level === "warn" ? "提醒" : "信息";
      lines.push("- **" + prefix + "**：" + issue.msg);
    });
  }
  lines.push("");
  return lines;
}

/**
 * 生成完整 Markdown。
 * @param {object} raw 项目或 { version, project }
 * @param {{generatedAt?:string, source?:string}} options
 * @returns {{markdown:string, analysis:object}}
 */
export function generateMarkdown(raw, options = {}) {
  const analysis = analyzeProject(raw);
  const stamp = options.generatedAt || localStamp();
  const lines = [];
  lines.push("# VECTOR 科技树（草案）");
  lines.push("");
  lines.push(
    "> 由 `vector-td/tools/tech-tree/` 编辑器导出 · 生成时间 " +
      stamp +
      " · 货币：" +
      CURRENCY.name +
      " · " +
      analysis.trees.length +
      " 棵树 / " +
      analysis.stats.nodeCount +
      " 个节点"
  );
  lines.push(">");
  lines.push("> 数据源：`vector-tree.json`（编辑器 Export）。改节点请改编辑器后重新导出，不要手改本文件。");
  lines.push("");
  lines.push(...renderOverview(analysis));
  lines.push(...renderCurrency());
  analysis.trees.forEach((entry, index) => {
    lines.push(...renderTreeSection(entry, index));
  });
  lines.push(...renderEffects(analysis, analysis.trees.length + 3));
  lines.push(...renderValidation(analysis, analysis.trees.length + 4));
  return { markdown: lines.join("\n"), analysis };
}
