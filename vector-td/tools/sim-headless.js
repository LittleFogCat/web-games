/* ============================================================
   Headless balance simulator for VECTOR // 矢界防线.

   Loads the real game modules (util/config/pathgrid/game) in a
   stubbed browser environment and runs a scripted bot through
   full campaigns. Used for balance verification only; not part
   of the shipped game.

   Usage:
     node tools/sim-headless.js                     # all levels, econ skills
     node tools/sim-headless.js --level 7           # single level
     node tools/sim-headless.js --skills none       # no global skills
     node tools/sim-headless.js --skills full       # all skills maxed
     node tools/sim-headless.js --tower gatling     # pure gatling instead of prism

   Bot strategy (v2, verified against L10):
     1. Greedy wall (barrier) placement that maximizes total path
        length -> funnels every rift into one shared corridor.
     2. Beacon policy: long corridors get a second beacon; the first is
        scored and upgraded for L2 radius 4.5 (L10-verified: this frees an
        attack slot vs two L1 beacons and keeps boss DPS healthy).
     3. Lasers open early for anti-mix levels — L10 waves 2-4 are a
        shield/ward/superArmor wall that mono-prism openings cannot
        survive on a realistic skill budget.
     4. Cheapest-first upgrades, surplus crystals into more walls.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

/* ---------- browser stubs ---------- */
const windowStub = {};
global.window = windowStub;
global.requestAnimationFrame = function () {};

function load(file) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
  // Eval in global scope so the IIFEs attach to our window stub.
  const vm = require('vm');
  vm.runInThisContext(code, { filename: file });
}

load('util.js');
load('config.js');
load('pathgrid.js');

const C = windowStub.GEOTD_CONFIG;
const P = windowStub.GEOTD_PATH;

/* Renderer stub: the Game constructor only builds it and calls setScene. */
windowStub.GEOTD_GFX = {
  GameRenderer: function () {
    this.setScene = function () {};
  },
};

const gameModule = fs.readFileSync(path.join(__dirname, '..', 'src', 'game.js'), 'utf8');
require('vm').runInThisContext(gameModule, { filename: 'game.js' });
const Game = windowStub.GEOTD_GAME.Game;

/* ---------- skill presets (mods mirror the global skill matrix) ---------- */
const SKILL_PRESETS = {
  /* 初始电容 + 晶体共振 + 建造协议，全部 5 阶（报告中的“经济优先”点法） */
  econ: { startCrystals: 125, crystalMult: 1.5, costMult: 0.75 },
  /* 经济三件套 + 武器超频（刷金币后的第二优先级） */
  econDmg: { startCrystals: 125, crystalMult: 1.5, costMult: 0.75, damageMult: 1.4 },
  /* 首达 L10 · 纯首通金币 ~1595G：crystal5+build5+start2+core2+overclock1+stasis1 */
  first10A: {
    baseHp: 40, crystalMult: 1.5, damageMult: 1.08, costMult: 0.75,
    enemySpeedMult: 0.96, startCrystals: 50,
  },
  /* 首达 L10 · 火力流 ~1700G：overclock5+crystal4+build3+core2+start2+stasis2 */
  first10B: {
    baseHp: 40, crystalMult: 1.4, damageMult: 1.4, costMult: 0.85,
    enemySpeedMult: 0.92, startCrystals: 50,
  },
  /* 首通 + 轻度刷重复通关 ~2995G：overclock5+crystal5+build5+stasis4+core3+start3+repair2 */
  farmed10: {
    baseHp: 60, crystalMult: 1.5, damageMult: 1.4, costMult: 0.75,
    enemySpeedMult: 0.84, repair: 12, startCrystals: 75,
  },
  /* 首通预算档（方案 6.3）：~2,290G = overclock5+crystal5+build4+core4，不重复刷 */
  firstBudget: {
    baseHp: 80, crystalMult: 1.5, damageMult: 1.4, costMult: 0.75,
    enemySpeedMult: 0.92, repair: 6, startCrystals: 0,
  },
  /* 骨灰级：首通 + 满星奖励（约 3,240G），不重复刷、不点纳米修复。 */
  ace: {
    baseHp: 100, crystalMult: 1.5, damageMult: 1.4, costMult: 0.75,
    enemySpeedMult: 0.88, startCrystals: 50,
  },
  /* 普通：首通 + 1 轮重复通关的适度刷金币，允许 1–2 阶修复作为容错。 */
  normal: {
    baseHp: 100, crystalMult: 1.5, damageMult: 1.4, costMult: 0.75,
    enemySpeedMult: 0.9, repair: 12, startCrystals: 75,
  },
  none: {},
  full: {
    baseHp: 100,
    crystalMult: 1.5,
    damageMult: 1.4,
    costMult: 0.75,
    enemySpeedMult: 0.8,
    repair: 30,
    startCrystals: 125,
  },
};

/* ---------- corridor bot ---------- */
function dist(field, x, y) {
  return P ? field[y * P.COLS + x] : 65535;
}

function corridorCells(grid, field) {
  const cells = new Set();
  const routes = grid.routes(field);
  for (const r of routes) {
    for (const c of r.path) cells.add(c.x + ',' + c.y);
  }
  return cells;
}

function totalPathLength(grid, field) {
  let total = 0;
  for (const r of grid.routes(field)) total += r.path.length;
  return total;
}

function buildableCells(grid) {
  const cells = [];
  for (let y = 0; y < P.ROWS; y++) {
    for (let x = 0; x < P.COLS; x++) {
      if (grid.isStaticBuildable(x, y)) cells.push({ x, y });
    }
  }
  return cells;
}

class CorridorBot {
  constructor(opts) {
    this.towerType = opts.towerType || 'prism';
    this.comp = opts.comp || 'mono';
    this.antiArmorSlots = opts.antiArmorSlots || 0;
    this.maxWallsPerPrep = 10;
    this.wallsBuiltTotal = 0;
    this.wallBudget = opts.wallBudget == null ? 70 : opts.wallBudget;
    this.wallsAfterTowers = opts.wallsAfterTowers || 0;
    this.minWalls = opts.minWalls || 0;
    this.wallDeadline = opts.wallDeadline || 99;
    this.beaconMinCoverage = opts.beaconMinCoverage || 1;
    this.beaconUpgradeAfter = opts.beaconUpgradeAfter || 0;
    this.minBeacons = opts.minBeacons || 1;
    this.beaconCoreBias = opts.beaconCoreBias || 0;
    this.beacons = opts.beacons || 1;
    this.levelHasStealth = opts.levelHasStealth || false;
    this.firstStealthWave = opts.firstStealthWave || Infinity;
    /* Test-archetype switches: the "brainless" build tiles attack towers and
       never uses walls or counter picks; "buildFirst" spends on quantity before
       quality, matching a player who only upgrades once slots run out. */
    this.useWalls = opts.useWalls !== false;
    this.buildFirst = !!opts.buildFirst;
    this.upgradeCheapestFirst = opts.upgradeCheapestFirst !== false;
    /* "Few but good" economies: hold the tower count down until the opening
       waves are past so income goes into levels instead of bodies. */
    this.earlyTowerCap = opts.earlyTowerCap || 0;
    this.earlyUntilWave = opts.earlyUntilWave || 0;
    this.upgradePolicy = opts.upgradePolicy || 'cheapest';
    this.upgradeMinTowers = opts.upgradeMinTowers || 0;
    this.counterBias = opts.counterBias || {};
    this.beaconMode = opts.beaconMode || 'greedy';
  }

  towerCapFor(game) {
    if (
      this.earlyTowerCap &&
      game.waveCursor + 1 <= this.earlyUntilWave &&
      this.earlyTowerCap < C.TOWER_CAPACITY
    ) {
      return this.earlyTowerCap;
    }
    return C.TOWER_CAPACITY;
  }

  towerDpsAt(type, level) {
    const def = C.TOWERS[type];
    if (!def || !def.levels || type === 'beacon') return 0;
    const stats = def.levels[level - 1];
    if (!stats) return 0;
    if (typeof stats.dps === 'number') return stats.dps;
    const shots = stats.shots || 1;
    const second = stats.second || 0;
    return ((stats.damage || 0) + second * (shots - 1)) / Math.max(0.01, stats.cooldown || 1);
  }

  countBeacons(game) {
    let n = 0;
    for (const s of game.structures) if (s.type === 'beacon') n++;
    return n;
  }

  beaconsNeeded(game) {
    if (!this.levelHasStealth) return 0;
    // Only invest in beacons once baseline DPS exists and stealth is near.
    if (game._towerCount() < 4 && game.waveCursor + 1 < this.firstStealthWave - 1) return 0;
    const grid = game.grid;
    const corridor = corridorCells(grid, grid.buildField(game.structures));
    // Long corridors want a second beacon; the L2 upgrade and the
    // 4.5-radius scoring below make the first one pull most of the weight.
    return corridor.size > 26 ? 2 : 1;
  }

  bestBeaconCell(game) {
    const grid = game.grid;
    const field = grid.buildField(game.structures);
    const corridor = corridorCells(grid, field);
    const range = 3.5 + 0.2; // score for the L1 radius it actually starts with
    let best = null;
    for (const cell of buildableCells(grid)) {
      if (game._structureAt(cell.x, cell.y)) continue;
      if (corridor.has(cell.x + ',' + cell.y)) continue;
      const check = grid.validateBuild(cell, game.structures, game.enemies);
      if (!check.ok) continue;
      let score = 0;
      for (const key of corridor) {
        const [cx, cy] = key.split(',').map(Number);
        if (Math.hypot(cx - cell.x, cy - cell.y) <= range) score++;
      }
      if (!best || score > best.score) best = { x: cell.x, y: cell.y, score };
    }
    return best;
  }

  /* Fair beacon coverage: score the minimum number of revealed cells across
     every rift route, not the total. A central beacon that touches all three
     lanes beats a corner beacon with more total cells on one lane. */
  routeRevealCoverage(game, extraCell) {
    const grid = game.grid;
    const field = grid.buildField(game.structures);
    const routes = grid.routes(field);
    const beacons = [];
    for (const s of game.structures) {
      if (s.type !== 'beacon') continue;
      const level = Math.max(1, Math.min(2, s.level || 1));
      beacons.push({
        x: s.x + 0.5,
        y: s.y + 0.5,
        range: C.TOWERS.beacon.levels[level - 1].range,
      });
    }
    if (extraCell) {
      beacons.push({
        x: extraCell.x + 0.5,
        y: extraCell.y + 0.5,
        range: C.TOWERS.beacon.levels[0].range,
      });
    }
    return routes.map(function (route) {
      let count = 0;
      for (const cell of route.path) {
        const cx = cell.x + 0.5;
        const cy = cell.y + 0.5;
        for (const b of beacons) {
          if (Math.hypot(cx - b.x, cy - b.y) <= b.range) {
            count++;
            break;
          }
        }
      }
      return count;
    });
  }

  bestBeaconCellFair(game) {
    const grid = game.grid;
    const field = grid.buildField(game.structures);
    const corridor = corridorCells(grid, field);
    const before = this.routeRevealCoverage(game, null);
    const beforeMin = Math.min.apply(null, before);
    let best = null;
    for (const cell of buildableCells(grid)) {
      if (game._structureAt(cell.x, cell.y)) continue;
      if (corridor.has(cell.x + ',' + cell.y)) continue;
      const check = grid.validateBuild(cell, game.structures, game.enemies);
      if (!check.ok) continue;
      const after = this.routeRevealCoverage(game, cell);
      const min = Math.min.apply(null, after);
      const total = after.reduce(function (a, b) { return a + b; }, 0);
      const gain = min - beforeMin;
      let score = min * 10000 + gain * 1000 + total;
      if (this.beaconCoreBias) {
        const bx = grid.base.x + 0.5;
        const by = grid.base.y + 0.5;
        const d = Math.hypot(cell.x + 0.5 - bx, cell.y + 0.5 - by);
        score += Math.max(0, 5 - d) * 2500 * this.beaconCoreBias;
      }
      if (!best || score > best.score) best = { x: cell.x, y: cell.y, score: score };
    }
    return best;
  }

  ensureFairBeacons(game) {
    const maxBeacons = Math.min(3, game.grid.gates.length);
    const minCells = game.grid.gates.length >= 3
      ? this.beaconMinCoverage
      : Math.min(this.beaconMinCoverage, 6);
    while (this.countBeacons(game) < maxBeacons) {
      const coverage = this.routeRevealCoverage(game, null);
      const enough = Math.min.apply(null, coverage) >= minCells && this.countBeacons(game) >= this.minBeacons;
      if (enough) break;
      const best = this.bestBeaconCellFair(game);
      if (!best || best.score <= 0) break;
      const cost = game.getBuildCost('beacon');
      if (game.crystals < cost) break;
      if (!game.tryBuild(best.x, best.y, 'beacon')) break;
    }
  }


  act(game) {
    if (game.phase !== 'prep') return;
    const grid = game.grid;
    const wallCost = game.getBuildCost('wall');
    const towerCost = game.getBuildCost(this.towerType);

    // 0. Stealth answer: beacons first, or stealth waves walk straight in.
    if (this.levelHasStealth && game._towerCount() < C.TOWER_CAPACITY) {
      if (this.beaconMode === 'fair') {
        const nextWave = game.waveCursor + 1;
        const stealthSoon = nextWave >= this.firstStealthWave - 1;
        if (stealthSoon || game._towerCount() >= 6) this.ensureFairBeacons(game);
      } else {
        let placed = true;
        while (placed && this.beaconsNeeded(game) > this.countBeacons(game)) {
          placed = false;
          const best = this.bestBeaconCell(game);
          if (!best || best.score <= 0) break;
          const cost = game.getBuildCost('beacon');
          if (game.crystals >= cost && game.tryBuild(best.x, best.y, 'beacon')) placed = true;
          else break;
        }
      }
    }

    // 1. Funnel: greedy wall placement while we can still afford the next towers.
    const reserve = towerCost * Math.min(3, Math.max(0, C.TOWER_CAPACITY - game._towerCount()));
    let wallsThisPrep = 0;
    while (
      this.useWalls &&
      !this.buildFirst &&
      game._towerCount() >= this.wallsAfterTowers &&
      game.crystals - wallCost >= reserve &&
      wallsThisPrep < this.maxWallsPerPrep &&
      this.wallsBuiltTotal < this.wallBudget
    ) {
      const best = this.bestWall(game);
      if (!best || best.gain < 2) break;
      if (!game.tryBuild(best.x, best.y, 'wall')) break;
      wallsThisPrep++;
      this.wallsBuiltTotal++;
    }

    // 2. Towers: best coverage cells until capacity. Mixed comp reserves
    //    laser slots vs armor/shield levels, prism fills the rest.
    const towerCap = this.towerCapFor(game);
    let placed = true;
    while (placed && game._towerCount() < towerCap) {
      placed = false;
      let type = this.nextTowerType(game);
      let cost = game.getBuildCost(type);
      // If the counter pick is unaffordable, fall back to a cheaper prism
      // instead of idling the economy — but only before the core line is up;
      // later, save for the counter pick rather than flooding prisms.
      if (game.crystals < cost && type !== 'prism' && game._towerCount() < 6) {
        type = 'prism';
        cost = game.getBuildCost(type);
      }
      const best = this.bestTowerCell(game, type);
      if (!best || best.score <= 0) break;
      if (game.crystals >= cost && game.tryBuild(best.x, best.y, type)) {
        placed = true;
      } else {
        break;
      }
    }

    // 2.5 Minimum funnel: some archetypes trade early upgrades for a longer
    //     corridor (the extreme "use every resource" line).
    if (
      this.useWalls &&
      !this.buildFirst &&
      this.wallsBuiltTotal < this.minWalls &&
      game.waveCursor + 1 <= this.wallDeadline
    ) {
      let guard = 0;
      while (
        game.crystals >= wallCost &&
        this.wallsBuiltTotal < this.minWalls &&
        guard++ < this.maxWallsPerPrep
      ) {
        const best = this.bestWall(game);
        if (!best || best.gain < 1) break;
        if (!game.tryBuild(best.x, best.y, 'wall')) break;
        this.wallsBuiltTotal++;
      }
    }

    // 3. Upgrades: beacon L2 FIRST (the 4.5 radius is stealth coverage the
    //    whole defense leans on — L9's wave-2 wraith leak kills the economy
    //    otherwise), then cheapest-first across towers.
    let upgraded = game._towerCount() >= this.upgradeMinTowers;
    while (upgraded) {
      upgraded = false;
      const beacon = game.structures.find(function (s) {
        return s.type === 'beacon' && (s.level || 1) < 2;
      });
      if (beacon && game._towerCount() >= this.beaconUpgradeAfter) {
        const bc = game.getUpgradeCost(beacon);
        if (bc > 0 && game.crystals >= bc) {
          game.selectedStructure = beacon;
          game.upgradeSelected();
          if (beacon.level >= 2) {
            upgraded = true;
            continue;
          }
        }
      }
      let target = null;
      let cost = Infinity;
      let bestScore = -Infinity;
      for (const s of game.structures) {
        if (s.kind !== 'tower') continue;
        if (s.level >= C.TOWER_MAX_LEVEL) continue;
        const c = game.getUpgradeCost(s);
        if (!(c > 0) || game.crystals < c) continue;
        if (this.upgradePolicy === 'value') {
          const gain = this.towerDpsAt(s.type, s.level + 1) - this.towerDpsAt(s.type, s.level);
          const score = (gain / c) * (this.counterBias[s.type] || 1);
          if (score > bestScore) {
            bestScore = score;
            cost = c;
            target = s;
          }
        } else if (c < cost) {
          cost = c;
          target = s;
        }
      }
      if (target) {
        game.selectedStructure = target;
        game.upgradeSelected();
        upgraded = game.crystals >= 0 && target.level > 0;
      }
    }

    // 4. Surplus -> more walls (longer path, more time in the kill zone).
    wallsThisPrep = 0;
    while (
      this.useWalls &&
      !this.buildFirst &&
      game._towerCount() >= this.wallsAfterTowers &&
      this.wallsBuiltTotal < this.wallBudget &&
      game.crystals >= wallCost &&
      wallsThisPrep < this.maxWallsPerPrep
    ) {
      const best = this.bestWall(game);
      if (!best || best.gain < 3) break;
      if (!game.tryBuild(best.x, best.y, 'wall')) break;
      wallsThisPrep++;
      this.wallsBuiltTotal++;
    }
  }

  bestWall(game) {
    const grid = game.grid;
    const field = grid.buildField(game.structures);
    const before = totalPathLength(grid, field);
    let best = null;
    for (const cell of buildableCells(grid)) {
      if (game._structureAt(cell.x, cell.y)) continue;
      const check = grid.validateBuild(cell, game.structures, game.enemies);
      if (!check.ok) continue;
      const gain = totalPathLength(grid, check.field) - before;
      if (!best || gain > best.gain) best = { x: cell.x, y: cell.y, gain };
    }
    return best;
  }

  nextTowerType(game) {
    if (this.comp === 'kMix') {
      // Pure-kinetic mix: open with 4 prisms (range + cheap), then
      // alternate gatling/prism — gatling wins DPS/crystal at I–III,
      // prism wins from IV (dual shot).
      if (game._towerCount() < 4) return this.towerType;
      return (game._towerCount() - 4) % 2 === 0 ? 'gatling' : this.towerType;
    }
    if (this.comp !== 'mixed') return this.towerType;
    // Establish baseline DPS first, then fill counter slots.
    if (game._towerCount() < 4) return this.towerType;
    const lasers = this.antiArmorSlots;
    let laserCount = 0;
    for (const s of game.structures) if (s.type === 'laser') laserCount++;
    if (laserCount < lasers) return 'laser';
    return this.towerType;
  }

  bestTowerCell(game, type) {
    type = type || this.towerType;
    const grid = game.grid;
    const field = grid.buildField(game.structures);
    const corridor = corridorCells(grid, field);
    const def = C.TOWERS[type];
    const range = def.levels[0].range + 0.2;
    const candidates = [];
    for (const cell of buildableCells(grid)) {
      if (game._structureAt(cell.x, cell.y)) continue;
      if (corridor.has(cell.x + ',' + cell.y)) continue;
      const check = grid.validateBuild(cell, game.structures, game.enemies);
      if (!check.ok) continue;
      let score = 0;
      for (const key of corridor) {
        const [cx, cy] = key.split(',').map(Number);
        const d = Math.hypot(cx - cell.x, cy - cell.y);
        if (d <= range) score++;
      }
      candidates.push({ x: cell.x, y: cell.y, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }
}

function levelUsesTrait(level, trait) {
  for (const wave of level.waves) {
    for (const group of wave.groups) {
      const def = C.ENEMIES[group.type];
      if (def && def.traits && def.traits.indexOf(trait) >= 0) return true;
    }
  }
  return false;
}

function firstWaveWithTrait(level, trait) {
  for (let i = 0; i < level.waves.length; i++) {
    for (const group of level.waves[i].groups) {
      const def = C.ENEMIES[group.type];
      if (def && def.traits && def.traits.indexOf(trait) >= 0) return i + 1;
    }
  }
  return Infinity;
}

/* ---------- runner ---------- */
function levelUsesStealth(level) {
  return levelUsesTrait(level, 'stealth');
}

function runLevel(levelIndex, skills, opts) {
  const level = C.LEVELS[levelIndex];
  let result = null;
  const waveReport = [];
  let waveStartHp = null;
  let waveMinHp = null;
  let firstDamageWave = null;
  let buildSpend = 0;
  let upgradeSpend = 0;
  let soldValue = 0;
  let beaconWave = null;
  let w10 = null;
  const game = new Game({
    level: level,
    mods: Object.assign({}, skills),
    canvas: {},
    events: {
      onVictory: (summary) => {
        result = { win: true, wave: summary.totalWaves, hp: summary.baseHp, baseMax: summary.baseMax };
      },
      onDefeat: (summary) => {
        result = { win: false, wave: summary.currentWave, hp: 0, baseMax: summary.baseMax };
      },
      onWaveStart: () => {
        waveStartHp = game.baseHp;
        waveMinHp = game.baseHp;
      },
      onWaveClear: (payload) => {
        const low = waveMinHp == null ? game.baseHp : waveMinHp;
        const loss = waveStartHp === null ? 0 : Math.max(0, waveStartHp - low);
        if (loss > 0 && firstDamageWave === null) firstDamageWave = payload.wave;
        waveReport.push({ wave: payload.wave, loss: loss });
        if (payload.wave === 10) {
          let invested = 0;
          for (const s of game.structures) invested += s.spent || 0;
          w10 = {
            crystals: Math.floor(game.crystals),
            towers: game._towerCount(),
            invested: invested,
            hpPct: Math.round((game.baseHp / game.baseMax) * 100),
          };
        }
      },
    },
  });
  /* Spend ledger: the archetype gates care about build-vs-upgrade allocation,
     not just the final board. */
  const origTryBuild = game.tryBuild.bind(game);
  game.tryBuild = function (x, y, type) {
    const cost = game.getBuildCost(type);
    const ok = origTryBuild(x, y, type);
    if (ok) {
      buildSpend += cost;
      if (type === 'beacon' && beaconWave === null) {
        beaconWave = game.phase === 'prep' ? game.waveCursor + 1 : Math.max(1, game.currentWave);
      }
    }
    return ok;
  };
  const origUpgrade = game.upgradeSelected.bind(game);
  game.upgradeSelected = function () {
    const s = game.selectedStructure;
    const before = s ? s.level : 0;
    const cost = s ? game.getUpgradeCost(s) : 0;
    origUpgrade();
    if (s && s.level > before) upgradeSpend += cost;
  };
  const origSell = game.sellSelected.bind(game);
  game.sellSelected = function () {
    const s = game.selectedStructure;
    const refund = s ? game.getSellValue(s) : 0;
    origSell();
    soldValue += refund;
  };
  const bot = new CorridorBot({
    towerType: opts.towerType,
    comp: opts.comp,
    beacons: opts.beacons,
    antiArmorSlots: opts.comp === 'mixed' && (levelUsesTrait(level, 'armor') || levelUsesTrait(level, 'shield')) ? (opts.lasers || 3) : 0,
    levelHasStealth: levelUsesStealth(level),
    firstStealthWave: firstWaveWithTrait(level, 'stealth'),
    useWalls: !opts.noWalls,
    buildFirst: !!opts.buildFirst,
    earlyTowerCap: opts.earlyTowerCap || 0,
    earlyUntilWave: opts.earlyUntilWave || 0,
    upgradePolicy: opts.upgradePolicy || 'cheapest',
    upgradeMinTowers: opts.upgradeMinTowers || 0,
    beaconMode: opts.beaconMode || 'greedy',
    counterBias: opts.counterBias || {},
    wallBudget: opts.wallBudget == null ? 70 : opts.wallBudget,
    wallsAfterTowers: opts.wallsAfterTowers || 0,
    beaconMinCoverage: opts.beaconMinCoverage || 1,
    beaconUpgradeAfter: opts.beaconUpgradeAfter || 0,
    minBeacons: opts.minBeacons || 1,
    beaconCoreBias: opts.beaconCoreBias || 0,
    minWalls: opts.minWalls || 0,
    wallDeadline: opts.wallDeadline || 99,
  });
  const origLeak = game._leakEnemy.bind(game);
  game._leakEnemy = function (enemy) {
    const type = enemy.def ? enemy.def.id : enemy.type;
    (game.leakLog = game.leakLog || []).push(type);
    (game.leakWaves = game.leakWaves || []).push(type + '@W' + game.currentWave);
    return origLeak(enemy);
  };
  game.paused = false;
  /* Track the lowest core HP reached (full-HP runs report minHpPct = 100). */
  let minHp = null;
  const origUpdate = game.update.bind(game);
  game.update = function (dt) {
    if (minHp === null || this.baseHp < minHp) minHp = this.baseHp;
    if (waveMinHp === null || this.baseHp < waveMinHp) waveMinHp = this.baseHp;
    return origUpdate(dt);
  };
  const dt = 1 / 30;
  let guard = 0;
  while (!result && guard < 4_000_000) {
    guard++;
    bot.act(game);
    game.update(dt);
    if (game.clock > 7200) break; // 2 sim-hours safety net
  }
  if (!result) {
    console.log("TIMEOUT DUMP: wave=" + game.currentWave + " clock=" + Math.round(game.clock) + "s");
    for (const e of game.enemies) {
      let nearest = null;
      for (const st of game.structures) {
        if (st.type !== 'shock') continue;
        const d = Math.hypot((st.x + 0.5) - e.x, (st.y + 0.5) - e.y);
        if (nearest === null || d < nearest) nearest = d;
      }
      console.log("  enemy " + e.type + " hp=" + Math.round(e.hp) + "/" + e.maxHp + " pos=" + e.x.toFixed(1) + "," + e.y.toFixed(1) +
        " slowT=" + (e.slowTenacity || 0).toFixed(2) + " kbT=" + (e.kbTenacity || 0).toFixed(2) +
        " nodes=" + e.nodes.length + " nearestShock=" + (nearest === null ? "none" : nearest.toFixed(2)) +
        " revealed=" + game._enemyRevealed(e));
    }
    console.log("  towers: " + game.structures.filter(s => s.kind === 'tower').map(st => st.type[0].toUpperCase() + st.level + "@" + st.x + "," + st.y).join(" "));
    result = { win: false, wave: game.currentWave, timeout: true, hp: game.baseHp, baseMax: game.baseMax };
  } else {
  }
  const compDump = {};
  for (const s of game.structures) { const k = s.type + ":L" + s.level; compDump[k] = (compDump[k] || 0) + 1; }
  console.log("BUILD:", JSON.stringify(compDump));
  const hud = game.getHudState();
  const leakTypes = {};
  for (const e of game.leakLog || []) leakTypes[e] = (leakTypes[e] || 0) + 1;
  const channels = {};
  for (const s of game.structures) {
    if (s.kind !== 'tower') continue;
    const def = C.TOWERS[s.type];
    if (def && def.damageType) channels[def.damageType] = true;
  }
  const totalSpend = buildSpend + upgradeSpend;
  return {
    win: result.win,
    levelId: level.id,
    wave: result.wave || hud.totalWaves,
    hpPct: Math.round((result.hp / game.baseMax) * 100),
    minHpPct: Math.round(((minHp === null ? game.baseMax : minHp) / game.baseMax) * 100),
    kills: game.kills,
    leaked: game.leaked,
    walls: bot.wallsBuiltTotal,
    towers: hud.towerCount,
    simMinutes: Math.round(game.clock / 60),
    leakTypes: Object.entries(leakTypes).map(([t, n]) => `${t}x${n}`).join(','),
    leakWaves: (game.leakWaves || []).join(','),
    waveReport,
    firstDamageWave,
    earned: game.crystalsEarned,
    buildSpend,
    upgradeSpend,
    soldValue,
    upgradeRatio: totalSpend > 0 ? upgradeSpend / totalSpend : 0,
    channels: Object.keys(channels),
    beaconWave,
    w10,
  };
}

function main() {
  const args = process.argv.slice(2);
  const get = (name, dflt) => {
    const i = args.indexOf('--' + name);
    return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
  };
  const levelArg = get('level', null);
  const skills = SKILL_PRESETS[get('skills', 'econ')] || SKILL_PRESETS.econ;
  const towerType = get('tower', 'prism');
  const comp = get('comp', 'mono');
  const lasers = parseInt(get('lasers', '3'), 10);
  const beacons = parseInt(get('beacons', '1'), 10);
  const runs = parseInt(get('runs', '3'), 10);
  const noWalls = args.indexOf('--no-walls') >= 0;
  const buildFirst = args.indexOf('--build-first') >= 0;
  const earlyTowerCap = parseInt(get('early-cap', '0'), 10);
  const earlyUntilWave = parseInt(get('early-until', '0'), 10);
  const upgradePolicy = get('upgrade', 'cheapest');
  const waveReport = args.indexOf('--waves') >= 0;

  const indices = levelArg
    ? [parseInt(levelArg, 10) - 1]
    : C.LEVELS.map((_, i) => i);

  console.log(`# sim: tower=${towerType} comp=${comp} lasers=${lasers} beacons=${beacons} skills=${get('skills', 'econ')} runs=${runs} walls=${noWalls ? 'no' : 'yes'} buildFirst=${buildFirst ? 'yes' : 'no'}`);
  console.log('| 关 | 结果 | 波次 | 完整度% | 最低完整度% | 击杀 | 漏怪 | 壁垒 | 塔 | 局内时长(min) |');
  console.log('|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const i of indices) {
    let win = 0;
    let hpSum = 0;
    const reportRuns = [];
    for (let r = 0; r < runs; r++) {
      const res = runLevel(i, skills, {
        towerType, comp, lasers, beacons, noWalls, buildFirst,
        earlyTowerCap, earlyUntilWave, upgradePolicy,
      });
      reportRuns.push(res);
      if (res.win) {
        win++;
        hpSum += res.hpPct;
      }
      console.log(
        `| L${i + 1} | run${r + 1} ${res.win ? '通关' : '失败'} | ${res.wave} | ${res.hpPct} | ${res.minHpPct} | ${res.kills} | ${res.leaked} | ${res.walls} | ${res.towers} | ${res.simMinutes} |${res.leakTypes ? ' 漏: ' + res.leakTypes : ''}`
      );
    }
    if (waveReport) {
      const best = reportRuns.find((r) => r.win) || reportRuns[0];
      console.log(`\n## L${i + 1} 逐波完整度损失（${best.win ? '通关局' : '代表局'}）`);
      console.log('| 波 | 完整度损失 |');
      console.log('|---:|---:|');
      for (const w of best.waveReport) {
        const bar = '#'.repeat(Math.min(40, Math.round(w.loss)));
        console.log(`| ${w.wave} | ${Math.round(w.loss)} ${bar} |`);
      }
    }
  }
}

if (require.main === module) main();

module.exports = {
  runLevel,
  SKILL_PRESETS,
  CorridorBot,
  levelUsesTrait,
  LEVELS: C.LEVELS,
  ENEMIES: C.ENEMIES,
  TOWERS: C.TOWERS,
};
