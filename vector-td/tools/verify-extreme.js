/* ============================================================
   Extreme-mixed no-damage regression.

   Proves that a deliberately mixed board (kinetic + energy + cryo,
   two beacons, walls) still clears the changed sectors without the
   core taking a single point — i.e. the front-pressure pass did not
   invalidate the intended "answer" build.

   Contract: ACE skills (no nano repair), 3 fixed seeds per level,
   every run must be WIN with minHpPct = 100.

   Usage (from the repository root):
     node vector-td/tools/verify-extreme.js
     node vector-td/tools/verify-extreme.js --levels=7,8 --runs=3
   ============================================================ */
'use strict';

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

const levels = (arg('levels', '7,8')).split(',').map((n) => parseInt(n, 10));
const runs = Math.max(1, parseInt(arg('runs', '3'), 10));

/* Extreme mixed: every damage channel + every function slot.
   Beacons first (stealth), then coverage-driven placement; walls
   extend the corridor; upgrades go to damage-per-crystal only. */
const bot = {
  towerType: 'prism',
  comp: 'extreme',
  beacons: 2,
  noWalls: false,
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
};

let failed = 0;
console.log('| 关 | 种子 | 结果 | 完整度 | 最低 | 漏怪 | 塔 | 通道 |');
console.log('|---:|---:|---|---:|---:|---|---:|---|');
for (const id of levels) {
  const index = id - 1;
  for (let r = 0; r < runs; r++) {
    const seed = 20261030 + index * 1009 + r * 7919;
    const originalLog = console.log;
    console.log = () => {};
    let res;
    try {
      res = withSeed(seed, () => sim.runLevel(index, sim.SKILL_PRESETS.ace, Object.assign({}, bot)));
    } finally {
      console.log = originalLog;
    }
    const ok = res.win && res.minHpPct === 100;
    if (!ok) failed++;
    const build = Object.entries(res.build || {}).map(([k, n]) => `${k}x${n}`).join(' ');
    console.log(
      `| L${id} | ${r} | ${ok ? 'PASS' : 'FAIL'} ${res.win ? 'WIN' : 'LOSE'} W${res.wave} | ` +
      `${res.hpPct}% | ${res.minHpPct}% | ${res.leakTypes || '-'} | ${res.towers} | ${(res.channels || []).join('+')} |`
    );
    if (r === 0) console.log(`|  |  | build: ${build} |  |  |  |  |  |`);
  }
}
console.log('');
console.log(failed === 0
  ? `ALL PASS: ${levels.length} level(s) x ${runs} seed(s), core never damaged.`
  : `FAILED: ${failed} run(s) took core damage.`);
process.exitCode = failed === 0 ? 0 : 1;
