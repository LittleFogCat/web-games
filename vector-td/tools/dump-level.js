/* Dumps level geometry (cols/rows/rocks/gates/base) as JSON for the
   pixel-contrast check in tools/check-rock-contrast.py. Dev tool only. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = {};
function load(file) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'), { filename: file });
}
load('util.js');
load('config.js');
load('pathgrid.js');

const C = global.window.GEOTD_CONFIG;
const idx = parseInt(process.argv[2] || '2', 10);
const level = C.LEVELS[idx];
const grid = new global.window.GEOTD_PATH.BattleGrid(level);
const P = global.window.GEOTD_PATH;
const cellX = 432 / P.COLS;
const cellY = 768 / P.ROWS;
console.log(JSON.stringify({
  name: level.name,
  cols: P.COLS,
  rows: P.ROWS,
  cell: Math.min(432 / P.COLS, 768 / P.ROWS),
  rocks: grid.map.rocks,
  gates: grid.map.gates,
  base: grid.map.base,
}));
