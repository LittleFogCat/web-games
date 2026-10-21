/* Orthogonal battle grid, flow field pathfinding and build validation. */
(function () {
  'use strict';

  const C = window.GEOTD_CONFIG;
  const COLS = C.GRID.cols;
  const ROWS = C.GRID.rows;
  const INF = 65535;

  function indexOf(x, y) {
    return y * COLS + x;
  }

  class BattleGrid {
    constructor(levelDef) {
      this.level = levelDef;
      const map = C.parseLevel(levelDef);
      this.map = map;
      this.rocks = new Set();
      for (let i = 0; i < map.rocks.length; i++) {
        const r = map.rocks[i];
        this.rocks.add(this.key(r.x, r.y));
      }
      this.gates = map.gates.slice();
      this.base = { x: map.base.x, y: map.base.y };
      this.gateKeys = new Set();
      for (let i = 0; i < this.gates.length; i++) {
        this.gateKeys.add(this.key(this.gates[i].x, this.gates[i].y));
      }
      this.baseKey = this.key(this.base.x, this.base.y);
      this._pathCache = new Map();
      this._fieldCache = null;
      this._fieldCacheSig = null;
    }

    key(x, y) {
      return x + ',' + y;
    }

    inBounds(x, y) {
      return x >= 0 && y >= 0 && x < COLS && y < ROWS;
    }

    isRock(x, y) {
      return this.rocks.has(this.key(x, y));
    }

    isGate(x, y) {
      return this.gateKeys.has(this.key(x, y));
    }

    isBase(x, y) {
      return x === this.base.x && y === this.base.y;
    }

    isStaticBuildable(x, y) {
      if (!this.inBounds(x, y)) return false;
      if (this.isRock(x, y) || this.isGate(x, y) || this.isBase(x, y)) return false;
      return true;
    }

    structureSet(structures) {
      const set = new Set();
      for (let i = 0; i < structures.length; i++) {
        const s = structures[i];
        set.add(this.key(s.x, s.y));
      }
      return set;
    }

    signatureFor(structures) {
      if (!structures.length) return 'empty';
      return structures
        .map(function (s) {
          return s.x + ',' + s.y;
        })
        .sort()
        .join('|');
    }

    buildField(structures, extraKey) {
      const sig = this.signatureFor(structures) + (extraKey ? ('+' + extraKey) : '');
      if (this._fieldCacheSig === sig && this._fieldCache) return this._fieldCache;
      const blocked = new Set();
      this.rocks.forEach(function (key) {
        blocked.add(key);
      });
      for (let i = 0; i < structures.length; i++) {
        blocked.add(this.key(structures[i].x, structures[i].y));
      }
      if (extraKey) blocked.add(extraKey);

      const dist = new Uint16Array(COLS * ROWS);
      dist.fill(INF);
      const queue = new Int16Array(COLS * ROWS);
      let head = 0;
      let tail = 0;
      const baseIdx = indexOf(this.base.x, this.base.y);
      dist[baseIdx] = 0;
      queue[tail++] = baseIdx;

      while (head < tail) {
        const idx = queue[head++];
        const x = idx % COLS;
        const y = (idx / COLS) | 0;
        const d = dist[idx] + 1;
        const neighbours = [
          [x, y - 1],
          [x - 1, y],
          [x + 1, y],
          [x, y + 1],
        ];
        for (let n = 0; n < 4; n++) {
          const nx = neighbours[n][0];
          const ny = neighbours[n][1];
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          const nidx = indexOf(nx, ny);
          if (dist[nidx] !== INF) continue;
          if (blocked.has(this.key(nx, ny))) continue;
          dist[nidx] = d;
          queue[tail++] = nidx;
        }
      }

      this._fieldCache = dist;
      this._fieldCacheSig = sig;
      this._pathCache.clear();
      return dist;
    }

    distAt(field, x, y) {
      if (!this.inBounds(x, y)) return INF;
      return field[indexOf(x, y)];
    }

    pathFrom(field, start) {
      const startKey = this.key(start.x, start.y);
      if (this._pathCache.has(startKey)) return this._pathCache.get(startKey);
      if (this.distAt(field, start.x, start.y) === INF) return [];
      const path = [];
      let x = start.x;
      let y = start.y;
      let guard = 0;
      path.push({ x: x, y: y });
      while (!(x === this.base.x && y === this.base.y) && guard++ < COLS * ROWS * 2) {
        const d = this.distAt(field, x, y);
        let next = null;
        // Prefer downward travel, then right, left, up. Keeps lanes legible.
        const order = [
          [x, y + 1],
          [x + 1, y],
          [x - 1, y],
          [x, y - 1],
        ];
        for (let i = 0; i < order.length; i++) {
          const nx = order[i][0];
          const ny = order[i][1];
          if (!this.inBounds(nx, ny)) continue;
          if (this.distAt(field, nx, ny) === d - 1) {
            next = { x: nx, y: ny };
            break;
          }
        }
        if (!next) break;
        x = next.x;
        y = next.y;
        path.push({ x: x, y: y });
      }
      this._pathCache.set(startKey, path);
      return path;
    }

    routes(field) {
      const result = [];
      for (let i = 0; i < this.gates.length; i++) {
        result.push({
          gate: this.gates[i],
          path: this.pathFrom(field, this.gates[i]),
        });
      }
      return result;
    }

    cellOf(enemy) {
      return {
        x: Math.max(0, Math.min(COLS - 1, Math.floor(enemy.x))),
        y: Math.max(0, Math.min(ROWS - 1, Math.floor(enemy.y))),
      };
    }

    validateBuild(cell, structures, enemies) {
      if (!this.inBounds(cell.x, cell.y)) {
        return { ok: false, reason: '目标位于星域之外' };
      }
      if (!this.isStaticBuildable(cell.x, cell.y)) {
        if (this.isBase(cell.x, cell.y)) return { ok: false, reason: '不能覆盖防线核心' };
        if (this.isGate(cell.x, cell.y)) return { ok: false, reason: '星际裂口无法被覆盖' };
        if (this.isRock(cell.x, cell.y)) return { ok: false, reason: '小行星阻挡了部署' };
        return { ok: false, reason: '此坐标不可建造' };
      }
      const key = this.key(cell.x, cell.y);
      for (let i = 0; i < structures.length; i++) {
        if (structures[i].x === cell.x && structures[i].y === cell.y) {
          return { ok: false, reason: '该坐标已有设施' };
        }
      }
      const field = this.buildField(structures, key);
      for (let i = 0; i < this.gates.length; i++) {
        if (this.distAt(field, this.gates[i].x, this.gates[i].y) === INF) {
          return { ok: false, reason: '无法封死全部航线', field: field };
        }
      }
      for (let i = 0; i < enemies.length; i++) {
        const c = this.cellOf(enemies[i]);
        if (this.distAt(field, c.x, c.y) === INF) {
          return { ok: false, reason: '会困住场上敌军', field: field };
        }
      }
      return { ok: true, field: field };
    }
  }

  window.GEOTD_PATH = {
    BattleGrid: BattleGrid,
    COLS: COLS,
    ROWS: ROWS,
    INF: INF,
  };
})();
