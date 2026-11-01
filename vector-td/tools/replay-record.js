/* ============================================================
   Replay a real player's recorded build order in the headless
   simulator, so balance changes can be checked against an actual
   human board instead of a bot archetype.

   The record comes from the game's internal run record
   (`vector_geotd_records_v1`, exported as JSON). See
   docs/records/chrome-localstorage.md for extraction.

   Usage (from the repository root):
     node vector-td/tools/replay-record.js
     node vector-td/tools/replay-record.js --records=tmp/records/records.json
     node vector-td/tools/replay-record.js --level=7
     node vector-td/tools/replay-record.js --min-level=4

   What-if knobs (all optional, applied before replaying):
     --add="7:18:juggernaut:4,8:18:juggernaut:10"
         Add/remove units in a specific wave (1-based wave number).
     --set="7:hpScale:1.95"
         Override a level scalar (hpScale, lateWaveHp, rewardScale, ...).
     --scale="8:1.2"
         Multiply every non-boss group count in a level.

   The tool never writes to the game; it only simulates.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(name, dflt) {
  const hit = args.find((a) => a === '--' + name || a.startsWith('--' + name + '='));
  if (!hit) return dflt;
  if (hit === '--' + name) return true;
  return hit.slice(name.length + 3);
}

/* ---------- load the real game modules in a browser stub ---------- */
const windowStub = {};
global.window = windowStub;
global.requestAnimationFrame = function () {};
function load(file) {
  const code = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8');
  require('vm').runInThisContext(code, { filename: file });
}
load('util.js');
load('config.js');
load('pathgrid.js');
windowStub.GEOTD_GFX = {
  GameRenderer: function () { this.setScene = function () {}; },
};
require('vm').runInThisContext(
  fs.readFileSync(path.join(ROOT, 'src', 'game.js'), 'utf8'),
  { filename: 'game.js' }
);
const C = windowStub.GEOTD_CONFIG;
const Game = windowStub.GEOTD_GAME.Game;

/* ---------- records ---------- */
const recordsPath = path.resolve(
  process.cwd(),
  String(arg('records', path.join(ROOT, '..', 'tmp', 'records', 'records.json')))
);
if (!fs.existsSync(recordsPath)) {
  console.error('Records not found: ' + recordsPath);
  console.error('Export from the DEBUG panel or extract with docs/records/chrome-localstorage.md.');
  process.exit(1);
}
const records = JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
const levelFilter = arg('level', null);
const minLevel = parseInt(arg('min-level', '1'), 10);

/* ---------- optional what-if patches ---------- */
function findLevel(id) {
  return C.LEVELS.find((l) => l.id === parseInt(id, 10));
}
function applyPatches() {
  const add = arg('add', null);
  if (add) {
    for (const item of String(add).split(',')) {
      const [lid, waveNo, type, delta] = item.split(':');
      const level = findLevel(lid);
      const wave = level && level.waves[parseInt(waveNo, 10) - 1];
      if (!wave) continue;
      const group = wave.groups.find((g) => g.type === type);
      if (group) group.count = Math.max(1, group.count + parseInt(delta, 10));
      else wave.groups.push({ type, count: Math.max(1, parseInt(delta, 10)), gap: 0.85 });
    }
  }
  const set = arg('set', null);
  if (set) {
    for (const item of String(set).split(',')) {
      const [lid, key, value] = item.split(':');
      const level = findLevel(lid);
      if (level) level[key] = parseFloat(value);
    }
  }
  const scale = arg('scale', null);
  if (scale) {
    for (const item of String(scale).split(',')) {
      const [lid, factor] = item.split(':');
      const level = findLevel(lid);
      if (!level) continue;
      const f = parseFloat(factor);
      for (const wave of level.waves) {
        for (const group of wave.groups) {
          if (group.type === 'boss') continue;
          group.count = Math.max(1, Math.round(group.count * f));
        }
      }
    }
  }
}
applyPatches();

/* ---------- replay ---------- */
function modsFor(skills) {
  return {
    baseHp: (skills.core || 0) * 20,
    crystalMult: 1 + (skills.crystal || 0) * 0.1,
    damageMult: 1 + (skills.overclock || 0) * 0.08,
    costMult: 1 - (skills.build || 0) * 0.05,
    enemySpeedMult: 1 - (skills.stasis || 0) * 0.04,
    repair: (skills.repair || 0) * 6,
    startCrystals: (skills.start || 0) * 25,
  };
}

function replay(record) {
  const level = C.LEVELS.find((l) => l.id === record.levelId);
  if (!level) return null;
  const entries = record.buildLog.slice().sort((a, b) => (a.t || 0) - (b.t || 0));
  let cursor = 0;
  let result = null;
  const game = new Game({
    level,
    mods: modsFor(record.initialSkills || {}),
    canvas: {},
    events: {
      onVictory: (s) => { result = { win: true, wave: s.totalWaves, hp: s.baseHp }; },
      onDefeat: (s) => { result = { win: false, wave: s.currentWave, hp: 0 }; },
    },
  });
  game.paused = false;

  function apply(entry) {
    if (entry.action === 'build') return !!game.tryBuild(entry.x, entry.y, entry.type);
    if (entry.action === 'upgrade') {
      const s = game._structureAt(entry.x, entry.y);
      if (!s || s.level >= entry.level) return !!s;
      game.selectedStructure = s;
      game.upgradeSelected();
      return s.level >= entry.level;
    }
    if (entry.action === 'sell') {
      const s = game._structureAt(entry.x, entry.y);
      if (!s) return false;
      game.selectedStructure = s;
      game.sellSelected();
      return true;
    }
    return true;
  }

  const dt = 1 / 30;
  const pending = [];
  let guard = 0;
  while (!result && guard++ < 4_000_000) {
    // Record timestamps are combat time (prep excluded).
    while (cursor < entries.length && game.combatTime >= (entries[cursor].t || 0) - 1e-6) {
      pending.push(entries[cursor++]);
    }
    for (let i = 0; i < pending.length;) {
      const entry = pending[i];
      entry.retries = (entry.retries || 0) + 1;
      if (apply(entry)) pending.splice(i, 1);
      else if (entry.retries > 30 * 120) pending.splice(i, 1);
      else i++;
    }
    game.update(dt);
    if (game.clock > 7200) break;
  }

  const hpPct = Math.round((game.baseHp / game.baseMax) * 100);
  const leakTypes = {};
  for (const entry of game.leakLog || []) {
    const type = typeof entry === 'string' ? entry : entry.type;
    leakTypes[type] = (leakTypes[type] || 0) + 1;
  }
  return {
    level: record.levelId,
    win: !!result && result.win,
    wave: result ? result.wave : game.currentWave,
    hpPct,
    leaked: game.leaked,
    leakTypes,
    clock: Math.round(game.clock),
    kills: game.kills,
    earned: Math.round(game.crystalsEarned),
    crystalsLeft: Math.round(game.crystals),
    build: game.structures.map((s) => `${s.type}:L${s.level}`).join(','),
  };
}

/* ---------- run ---------- */
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
  try { return fn(); } finally { Math.random = original; }
}

const seed = arg('seed', null);
const rows = [];
for (const record of records) {
  if (levelFilter && record.levelId !== parseInt(levelFilter, 10)) continue;
  if (record.levelId < minLevel) continue;
  const out = seed
    ? withSeed(parseInt(seed, 10) + record.levelId * 1009, () => replay(record))
    : replay(record);
  if (out) rows.push({ record, out });
}

if (!rows.length) {
  console.log('No matching records in ' + recordsPath);
  process.exit(0);
}
console.log('| 关 | 记录 | 回放 | 波次 | 完整度 | 漏怪 | 用时 | 结余晶元 |');
console.log('|---|---|---|---:|---:|---:|---:|---:|');
for (const { record, out } of rows.sort((a, b) => a.record.levelId - b.record.levelId)) {
  const leaks = Object.entries(out.leakTypes).map(([t, n]) => `${t}x${n}`).join(',') || '-';
  console.log(
    `| L${out.level} | ${record.result}/${record.stars}★ | ${out.win ? 'WIN' : 'LOSE'} W${out.wave} | ` +
    `${out.wave} | ${out.hpPct}% | ${leaks} | ${Math.round(out.clock / 60)}min | ${out.crystalsLeft} |`
  );
}
