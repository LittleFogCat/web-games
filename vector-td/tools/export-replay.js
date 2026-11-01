/* ============================================================
   Export one headless-sim run as a review-compatible record.

   The review page (`review.html`) can import this JSON directly:
   "导入 JSON" -> pick the exported file.

   Usage (from the repository root):
     node vector-td/tools/export-replay.js --level=7 --out=tmp/l7.json
     node vector-td/tools/export-replay.js --level=7 --comp=extreme --skills=ace
     node vector-td/tools/export-replay.js --level=10 --comp=mixed --lasers=5 --skills=ace
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const sim = require('./sim-headless.js');

const args = process.argv.slice(2);
function arg(name, dflt) {
  const hit = args.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
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
  try { return fn(); } finally { Math.random = original; }
}

const levelId = parseInt(arg('level', '7'), 10);
const levelIndex = levelId - 1;
const level = sim.LEVELS[levelIndex];
if (!level) {
  console.error('Unknown level: ' + levelId);
  process.exit(1);
}
const comp = arg('comp', 'extreme');
const skillsName = arg('skills', 'ace');
const skills = sim.SKILL_PRESETS[skillsName];
if (!skills) {
  console.error('Unknown skill preset: ' + skillsName + ' (use ' + Object.keys(sim.SKILL_PRESETS).join(', ') + ')');
  process.exit(1);
}
const seed = parseInt(arg('seed', '20261030'), 10) + levelIndex * 1009;
const out = path.resolve(process.cwd(), arg('out', 'tmp/replay-L' + levelId + '.json'));

const bot = {
  towerType: 'prism',
  comp,
  beacons: parseInt(arg('beacons', '2'), 10),
  lasers: parseInt(arg('lasers', '5'), 10),
  noWalls: arg('no-walls', '0') === '1',
  buildFirst: false,
  upgradePolicy: 'value',
  wallBudget: 90,
  wallsAfterTowers: 6,
  minWalls: 10,
  wallDeadline: 20,
  beaconMinCoverage: 10,
  minBeacons: 2,
  beaconUpgradeAfter: 6,
  beaconMode: 'fair',
  captureReplay: true,
};

const result = withSeed(seed, () => sim.runLevel(levelIndex, skills, bot));
const stars = result.win ? (result.minHpPct >= 80 ? 3 : result.minHpPct >= 40 ? 2 : 1) : 0;
const now = Date.now();
const record = {
  v: 1,
  id: 'sim-' + now + '-L' + levelId,
  finishedAt: now,
  startedAt: now - Math.round((result.combatTime || 0) * 1000),
  levelId: levelId,
  levelCode: result.levelCode,
  levelName: result.levelName,
  result: result.win ? 'victory' : 'defeat',
  stars: stars,
  integrity: result.hpPct / 100,
  coreHp: result.baseHp,
  coreMax: result.baseMax,
  totalWaves: result.totalWaves,
  wavesCleared: result.win ? result.totalWaves : Math.max(0, result.currentWave - 1),
  currentWave: result.currentWave,
  kills: result.kills,
  leaked: result.leaked,
  duration: result.combatTime,
  startCrystals: result.startCrystals,
  crystalsEarned: result.crystalsEarned,
  crystalsLeft: result.crystals,
  goldEarned: 0,
  firstClear: false,
  debug: true,
  initialSkills: skills,
  buildLog: result.buildLog,
  towers: result.towerRecords,
  leaks: result.leakLog,
  waves: result.waveStats,
  replay: { v: 1, interval: 1, frames: result.replay },
};

const payload = {
  kind: 'vector-replay',
  exportedAt: new Date(now).toISOString(),
  source: { tool: 'sim-headless', level: levelId, comp: comp, skills: skillsName, seed: seed },
  build: result.build,
  channels: result.channels,
  record: record,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(payload, null, 2));
console.log('Wrote ' + out);
console.log(
  'L' + levelId + ' ' + (result.win ? 'WIN' : 'LOSE') + ' W' + result.wave +
  ' hp=' + result.hpPct + '% min=' + result.minHpPct + '%' +
  ' leaked=' + result.leaked + ' frames=' + record.replay.frames.length +
  ' towers=' + record.towers.length + ' build=' + JSON.stringify(result.build)
);
