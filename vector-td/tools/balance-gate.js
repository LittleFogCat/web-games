/* ============================================================
   VECTOR 三档玩家验收矩阵（策划工作流门禁）

   把「骨灰级 / 普通 / 无脑」三种玩家契约变成可重复执行的脚本：

     node tools/balance-gate.js                 # 全关 · 每档 1 局
     node tools/balance-gate.js --runs 3        # 每档 3 局（默认种子不同）
     node tools/balance-gate.js --levels 4,7,10 # 只跑采样关
     node tools/balance-gate.js --arch brute    # 只跑一档

   门禁：
     ace    ：不刷金币、不点修复；必须「通关 + 核心从未掉血」
     normal ：懂克制、适度刷金币；必须通关（允许掉血/漏怪）
     brute  ：只铺棱镜（必要灯塔），满技能；L4 起必须无法通关

   退出码 0 = 全部门禁通过；1 = 有未通过项。输出可直接贴进验证记录。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const sim = require('./sim-headless.js');

const ARCHETYPES = {
  ace: {
    label: '骨灰级',
    contract: '合法经济 · 不刷金币 · 不点修复 · 一命无伤',
    skills: 'ace',
    bot: {
      comp: 'mixed',
      noWalls: false,
      wallBudget: 70,
      upgradePolicy: 'value',
      earlyTowerCap: 8,
      earlyUntilWave: 6,
      beaconMinCoverage: 10,
      minBeacons: 2,
      beaconCoreBias: 1,
      minWalls: 10,
      wallDeadline: 20,
      beaconMode: 'fair',
    },
  },
  normal: {
    label: '普通',
    contract: '懂克制 · 适度刷金币 · 正常通关',
    skills: 'normal',
    bot: {
      comp: 'mixed',
      noWalls: false,
      wallBudget: 2,
      wallsAfterTowers: 6,
      beaconMinCoverage: 12,
      beaconUpgradeAfter: 6,
      upgradePolicy: 'value',
      earlyTowerCap: 12,
      earlyUntilWave: 8,
      beaconMode: 'fair',
    },
  },
  brute: {
    label: '无脑',
    contract: '只铺棱镜（必要灯塔）· 满技能 · L4 起不能通关',
    skills: 'full',
    bot: {
      comp: 'mono',
      noWalls: true,
      buildFirst: true,
      lasers: 0,
    },
  },
};

/* Weighted trait profile of a level's spawns, used to give the "understands
   counters" bots a composition that matches the level's actual questions. */
function levelProfile(level) {
  const p = { shield: 0, armor: 0, ward: 0, split: 0, stealth: 0, total: 0 };
  for (const wave of level.waves) {
    for (const group of wave.groups) {
      const def = sim.ENEMIES[group.type];
      if (!def) continue;
      p.total += group.count;
      for (const trait of def.traits || []) {
        if (p[trait] != null) p[trait] += group.count;
      }
    }
  }
  return p;
}

function counterLoadout(profile) {
  const antiKinetic = profile.shield + profile.armor;
  const antiEnergy = profile.ward;
  // 0–6 lasers: more against shields/armor, fewer against magic-immune waves.
  const total = Math.max(1, profile.total);
  let lasers = 3;
  if (antiKinetic > 0) {
    lasers = 3 + Math.round((antiKinetic / total) * 6);
    lasers = Math.max(4, Math.min(6, lasers));
  } else if (antiEnergy > 0) {
    lasers = 2;
  }
  const bias = {};
  if (antiKinetic > 0) bias.laser = 1.8;
  if (antiEnergy > 0) {
    bias.prism = 1.6;
    bias.cannon = 1.25;
  }
  if (profile.split > profile.total * 0.12) bias.cannon = Math.max(bias.cannon || 1, 1.4);
  return { lasers, counterBias: bias };
}

/* Gate semantics are intentionally different per archetype:
   ace/normal must succeed on (most) seeds; brute must fail on every seed. */
function requiredWins(runs, arch) {
  if (arch === 'brute') return 0;
  return Math.ceil(runs * (2 / 3));
}

function evaluate(arch, levelIndex, runs, seedBase) {
  const def = ARCHETYPES[arch];
  const level = sim.LEVELS[levelIndex];
  const profile = levelProfile(level);
  const loadout = arch === 'brute' ? { lasers: 0, counterBias: {} } : counterLoadout(profile);
  const bot = Object.assign({}, def.bot, loadout);
  const results = [];
  for (let r = 0; r < runs; r++) {
    const seed = seedBase + levelIndex * 1009 + r * 7919;
    const res = withSeed(seed, () =>
      sim.runLevel(levelIndex, sim.SKILL_PRESETS[def.skills], Object.assign(
        { towerType: 'prism', beacons: 1 },
        bot
      ))
    );
    res.seed = seed;
    results.push(res);
  }

  const wins = results.filter((r) => r.win).length;
  const noHits = results.filter((r) => r.win && r.minHpPct === 100).length;
  const need = requiredWins(runs, arch);

  let pass;
  if (arch === 'brute') {
    // Tutorial sectors may be cleared by anyone; from L4 on, zero wins.
    pass = level.id <= 3 ? wins >= need : wins === 0;
  } else if (arch === 'ace') {
    pass = noHits >= need;
  } else {
    pass = wins >= need;
  }

  const best = results.slice().sort((a, b) => {
    if (a.win !== b.win) return a.win ? -1 : 1;
    return b.minHpPct - a.minHpPct;
  })[0];

  return { arch, level: level.id, pass, wins, noHits, runs, need, results, best };
}

function withSeed(seed, fn) {
  const original = Math.random;
  let state = seed >>> 0;
  Math.random = function () {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

function fmtRun(arch, r) {
  if (r.win) {
    const tag = r.minHpPct === 100 ? '无伤' : '通关';
    return `${tag} ${r.minHpPct}%`;
  }
  return `W${r.wave} 失败`;
}

function fmtDetail(arch, r) {
  if (arch === 'brute' && r.win) {
    if (r.level <= 3) return `教学可过 ${r.minHpPct}%`;
    return `通关 ${r.minHpPct}%（应失败）`;
  }
  if (arch === 'ace' && r.win && r.minHpPct < 100) {
    return `通关但掉血至 ${r.minHpPct}%（第 ${r.firstDamageWave || '?'} 波首次掉血）`;
  }
  const leaks = r.leakTypes ? ` 漏: ${r.leakTypes}` : '';
  return `${fmtRun(arch, r)}${leaks}`;
}

function main() {
  const args = process.argv.slice(2);
  const get = (name, dflt) => {
    const i = args.indexOf('--' + name);
    return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
  };
  const archList = get('arch', 'ace,normal,brute').split(',').filter((a) => ARCHETYPES[a]);
  const levelArg = get('levels', null);
  const levelIndices = levelArg
    ? levelArg.split(',').map((n) => parseInt(n, 10) - 1)
    : sim.LEVELS.map((_, i) => i);
  const runs = Math.max(1, parseInt(get('runs', '1'), 10));
  const seedBase = parseInt(get('seed', '20261030'), 10);
  const jsonPath = get('json', null);
  const mdPath = get('markdown', null);

  const started = new Date();
  const rows = [];
  for (const i of levelIndices) {
    const row = { level: sim.LEVELS[i].id, name: sim.LEVELS[i].name, arch: {} };
    for (const arch of archList) {
      row.arch[arch] = evaluate(arch, i, runs, seedBase);
    }
    rows.push(row);
  }

  // The brute contract is "cannot finish the campaign", which is sequential:
  // the first failed sector blocks every later one, so later wins are moot.
  let bruteBlock = null;
  for (const row of rows) {
    if (row.level < 4) continue;
    const e = row.arch.brute;
    if (e && e.wins === 0) {
      bruteBlock = row.level;
      break;
    }
  }

  const lines = [];
  lines.push('# VECTOR 三档玩家验收矩阵');
  lines.push('');
  lines.push(`> 生成：${started.toISOString()} · 每档 ${runs} 局 · 种子基 ${seedBase} · 命令：\`node tools/balance-gate.js${args.length ? ' ' + args.join(' ') : ''}\``);
  lines.push('>');
  for (const arch of archList) {
    const a = ARCHETYPES[arch];
    lines.push(`> ${a.label}：${a.contract}`);
  }
  lines.push('');
  lines.push('| 关 | ' + archList.map((a) => ARCHETYPES[a].label + '（' + (a === 'brute' ? '阻断' : a === 'ace' ? '无伤' : '通关') + '）').join(' | ') + ' |');
  lines.push('|---:|' + archList.map(() => '---').join('|') + '|');
  for (const row of rows) {
    const cells = archList.map((arch) => {
      const e = row.arch[arch];
      if (arch === 'brute') {
        if (!bruteBlock) return `未阻断 · ${fmtDetail(arch, e.best)}`;
        if (row.level > bruteBlock) return '未到达（已被前关阻断）';
        if (row.level === bruteBlock) return `阻断 · ${fmtDetail(arch, e.best)}`;
        return `允许 · ${fmtDetail(arch, e.best)}`;
      }
      return `${e.pass ? 'PASS' : 'FAIL'} · ${fmtDetail(arch, e.best)}`;
    });
    lines.push(`| L${row.level} ${row.name} | ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push('## 门禁汇总');
  lines.push('');
  const summary = [];
  for (const arch of archList) {
    if (arch === 'brute') {
      summary.push(bruteBlock
        ? `${ARCHETYPES[arch].label} 战役阻断于 L${bruteBlock} ✅`
        : `${ARCHETYPES[arch].label} 全战役通关 ❌`);
      continue;
    }
    const ok = rows.filter((r) => r.arch[arch].pass).length;
    summary.push(`${ARCHETYPES[arch].label} ${ok}/${rows.length}${ok === rows.length ? ' ✅' : ' ❌'}`);
  }
  lines.push(summary.join(' · '));
  lines.push('');

  const failures = [];
  for (const row of rows) {
    for (const arch of archList) {
      const e = row.arch[arch];
      if (arch === 'brute') {
        if (!bruteBlock && row.level >= 4) {
          failures.push(`- 无脑 L${row.level}：${fmtDetail(arch, e.best)}（战役未被阻断）`);
        }
        continue;
      }
      if (!e.pass) {
        failures.push(`- ${ARCHETYPES[arch].label} L${row.level}：${fmtDetail(arch, e.best)}（${e.wins}/${e.runs} 通关，${e.noHits}/${e.runs} 无伤，需 ${e.need}）`);
      }
    }
  }
  if (failures.length) {
    lines.push('## 未通过项');
    lines.push('');
    lines.push(...failures);
    lines.push('');
    lines.push('> 调参前先读 `docs/persona/游戏策划.md` 的「失败签名 → 杠杆」表；一次只改一个维度。');
  } else {
    lines.push('## 结论');
    lines.push('');
    lines.push('三档门禁全部通过。仍需按工作流做 1× 手测与三尺寸回归，才能把结论写成「已验证」。');
  }
  lines.push('');

  const text = lines.join('\n');
  console.log(text);
  if (mdPath) fs.writeFileSync(path.resolve(mdPath), text, 'utf8');
  if (jsonPath) {
    const payload = {
      generatedAt: started.toISOString(),
      runs,
      seedBase,
      bruteBlock,
      archetypes: Object.fromEntries(archList.map((a) => [a, ARCHETYPES[a]])),
      rows: rows.map((row) => ({
        level: row.level,
        name: row.name,
        arch: Object.fromEntries(archList.map((a) => {
          const e = row.arch[a];
          return [a, {
            pass: e.pass, wins: e.wins, noHits: e.noHits, need: e.need,
            runs: e.results.map((r) => ({
              seed: r.seed, win: r.win, wave: r.wave, minHpPct: r.minHpPct,
              hpPct: r.hpPct, leaked: r.leaked, firstDamageWave: r.firstDamageWave,
              earned: r.earned, buildSpend: r.buildSpend, upgradeSpend: r.upgradeSpend,
              upgradeRatio: r.upgradeRatio, channels: r.channels, towers: r.towers,
              beaconWave: r.beaconWave, w10: r.w10, leakTypes: r.leakTypes,
              leakWaves: r.leakWaves,
            })),
          }];
        })),
      })),
    };
    fs.writeFileSync(path.resolve(jsonPath), JSON.stringify(payload, null, 2), 'utf8');
  }

  const aceNormalPass = rows.every((row) => archList
    .filter((a) => a !== 'brute')
    .every((a) => row.arch[a].pass));
  const brutePass = !archList.includes('brute') || bruteBlock != null;
  const allPass = aceNormalPass && brutePass;
  process.exitCode = allPass ? 0 : 1;
}

if (require.main === module) main();

module.exports = { ARCHETYPES, counterLoadout, levelProfile };
