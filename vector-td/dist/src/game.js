/* ============================================================
   Battle simulation: mazing, towers, walls, waves, crystals.
   ============================================================ */
(function () {
  'use strict';

  const C = window.GEOTD_CONFIG;
  const U = window.GEOTD_UTIL;
  const P = window.GEOTD_PATH;
  /* 控制命中累积目标韧性：单敌可被控制的总时间有上限，控制流无法无限锁单。 */
  const CONTROL_TENACITY_GAIN = 0.12;
  const G = window.GEOTD_GAME || {};
  const TAU = Math.PI * 2;
  const DEFAULT_MODS = {
    baseHp: 0,
    crystalMult: 1,
    damageMult: 1,
    costMult: 1,
    enemySpeedMult: 1,
    repair: 0,
    startCrystals: 0,
    godMode: false,
    freeBuild: false,
  };

  const WAVE_HP_GROWTH = C.WAVE_HP_GROWTH || 1.015;

  const PREP_INITIAL = 20;
  const PREP_BETWEEN = 10;
  const PREP_WARNING_AT = 3;
  const FLOAT_LIFE = 1.1;
  const SELL_HINT_LIFE = 3.5;

  const TOWER_SPECIAL_LABELS = {
    prism: '齐射',
    gatling: '射速',
    cannon: '爆裂',
    laser: '升温',
    shock: '震荡',
    frost: '冻结',
    tesla: '链锁',
  };

  class Game {
    constructor(options) {
      this.level = options.level;
      this.mods = Object.assign({}, DEFAULT_MODS, options.mods || {});
      this.events = options.events || {};
      this.audio = options.audio || null;
      this.canvas = options.canvas;
      this.grid = new P.BattleGrid(this.level);
      this.structures = [];
      this.enemies = [];
      this.projectiles = [];
      this.effects = [];
      this.particles = [];
      this.floatTexts = [];
      this.field = this.grid.buildField(this.structures);
      this.routes = this.grid.routes(this.field);

      this.baseMax = Math.round(100 + (this.mods.baseHp || 0));
      this.baseHp = this.baseMax;
      this.crystals = Math.max(0, Math.round(this.level.startCrystals + (this.mods.startCrystals || 0)));
      this.crystalsEarned = 0;
      this.startCrystals = this.crystals;
      this.waveStartCrystals = this.crystals;
      this.waveStartBaseHp = this.baseHp;

      this.phase = 'prep';
      this.waveCursor = 0;
      this.currentWave = 0;
      this.totalWaves = this.level.waves.length;
      this.waveElapsed = 0;
      this.prepTotal = PREP_INITIAL;
      this.prepRemaining = PREP_INITIAL;
      this.prepWarningEmitted = false;
      this._lastPrepSecond = Math.ceil(PREP_INITIAL);
      this.spawnQueue = [];
      this.spawnPool = [];
      this._gateCursor = 0;
      this.kills = 0;
      this.leaked = 0;
      this.killsThisWave = 0;
      this.leaksThisWave = 0;
      this.combatTime = 0;
      this.clock = 0;

      this.selectedBuild = null;
      this.selectedStructure = null;
      this.lastBuiltStructure = null;
      this.hoverCell = null;
      this.placementError = null;
      this.toastCooldown = {};

      this.speed = 1;
      this.paused = false;
      this.disposed = false;
      this.resultSent = false;
      this.victoryTimer = 0;
      this.shake = 0;
      this.baseFlash = 0;
      this.uid = 1;
      this.dirty = true;

      this.renderer = new window.GEOTD_GFX.GameRenderer(this.canvas);
      this.renderer.setScene(this.level, this.grid);
      const self = this;
      requestAnimationFrame(function () {
        if (!self.disposed) self.resize();
      });
    }

    /* ------------------------------------------------------------
       UI-facing state
       ------------------------------------------------------------ */
    getHudState() {
      const displayWave = this.phase === 'prep'
        ? Math.min(this.waveCursor + 1, this.totalWaves)
        : Math.max(1, this.currentWave);
      return {
        phase: this.phase,
        paused: this.paused,
        speed: this.speed,
        baseHp: Math.max(0, Math.ceil(this.baseHp)),
        baseMax: this.baseMax,
        crystals: Math.floor(this.crystals),
        wave: displayWave,
        totalWaves: this.totalWaves,
        currentWave: this.currentWave,
        waveCursor: this.waveCursor,
        kills: this.kills,
        leaked: this.leaked,
        enemiesAlive: this.enemies.length,
        waveRemaining: this.phase === 'wave' ? this.enemies.length + this.spawnQueue.length : 0,
        towerCount: this._towerCount(),
        towerCapacity: C.TOWER_CAPACITY,
        prepRemaining: this.phase === 'prep' ? Math.max(0, this.prepRemaining) : 0,
        prepTotal: this.prepTotal,
        autoWave: true,
        waveActive: this.phase === 'wave',
        isLastWave: this.phase === 'prep' && this.waveCursor === this.totalWaves - 1,
        selectedBuild: this.selectedBuild,
        godMode: !!this.mods.godMode,
        freeBuild: !!this.mods.freeBuild,
      };
    }

    _towerCount() {
      let count = 0;
      for (let i = 0; i < this.structures.length; i++) {
        if (this.structures[i].kind === 'tower') count++;
      }
      return count;
    }

    getTowerStats(tower) {
      const def = C.TOWERS[tower.type];
      if (!def) return {};
      const base = def.levels[Math.min(C.TOWER_MAX_LEVEL, tower.level) - 1];
      const stats = Object.assign({}, base);
      if (typeof stats.damage === 'number') stats.damage = stats.damage * this.mods.damageMult;
      if (typeof stats.dps === 'number') stats.dps = stats.dps * this.mods.damageMult;
      return stats;
    }

    getBuildCost(type) {
      if (this.mods.freeBuild) return 0;
      const def = type === 'wall' ? C.WALL : C.TOWERS[type];
      if (!def) return 0;
      return Math.max(1, Math.round(def.cost * this.mods.costMult));
    }

    getUpgradeCost(structure) {
      if (!structure || structure.kind !== 'tower') return 0;
      if (structure.level >= this._towerMaxLevel(structure.type)) return 0;
      if (this.mods.freeBuild) return 0;
      const def = C.TOWERS[structure.type];
      const base = def.upgradeCosts[Math.max(0, structure.level - 1)];
      const tierMultiplier = C.UPGRADE_COST_MULTIPLIERS[Math.max(0, structure.level - 1)] || 1;
      return Math.max(1, Math.round(base * tierMultiplier * this.mods.costMult));
    }

    _towerMaxLevel(type) {
      const def = C.TOWERS[type];
      return (def && def.maxLevel) || C.TOWER_MAX_LEVEL;
    }

    _enemyRevealed(enemy) {
      if (!enemy || !enemy.def || !enemy.def.stealth) return true;
      for (let i = 0; i < this.structures.length; i++) {
        const beacon = this.structures[i];
        if (beacon.kind !== 'tower' || beacon.type !== 'beacon') continue;
        const def = C.TOWERS.beacon;
        if (!def) continue;
        const range = def.levels[Math.min(beacon.level || 1, def.levels.length) - 1].range;
        const dx = enemy.x - (beacon.x + 0.5);
        const dy = enemy.y - (beacon.y + 0.5);
        const reach = range + (enemy.def.radius || 0) * 0.35;
        if (dx * dx + dy * dy <= reach * reach) return true;
      }
      return false;
    }

    canUndoSale(structure) {
      return !!structure &&
        (structure.kind === 'tower' || structure.kind === 'wall') &&
        structure.level === 1 &&
        (this.phase === 'prep' || this.paused) &&
        this.lastBuiltStructure === structure;
    }

    getSellValue(structure) {
      if (!structure) return 0;
      const rate = this.canUndoSale(structure) ? 1 : 0.6;
      return Math.max(1, Math.floor((structure.spent || 0) * rate));
    }

    getSelectionInfo() {
      if (this.selectedBuild) {
        const type = this.selectedBuild;
        const isWall = type === 'wall';
        const def = isWall ? C.WALL : C.TOWERS[type];
        const cost = this.getBuildCost(type);
        const stats = isWall ? null : this._towerDisplayStats(type, 1);
        const towerCount = this._towerCount();
        const damage = isWall ? null : C.DAMAGE_TYPES[def.damageType] || null;
        return {
          mode: 'build',
          type: type,
          isWall: isWall,
          towerCount: towerCount,
          towerCapacity: C.TOWER_CAPACITY,
          capacityFull: !isWall && towerCount >= C.TOWER_CAPACITY,
          name: def.name,
          en: def.en,
          role: def.role,
          tagline: def.tagline,
          desc: def.desc,
          color: def.color,
          accent: def.accent || '#ffffff',
          cost: cost,
          canAfford: this.crystals >= cost,
          crystals: Math.floor(this.crystals),
          stats: stats,
          damageType: damage ? damage.id : null,
          damageTypeName: damage ? damage.name : null,
          damageTypeColor: damage ? damage.color : null,
          tags: def.tags || [],
          reveal: !isWall && !!def.reveal,
          revealRange: !isWall && def.reveal ? def.levels[0].range : 0,
          counter: def.counter || '',
          special: isWall ? '强制敌人重新寻路' : this._specialLabel(type, def.levels[0]),
        };
      }
      if (this.selectedStructure) {
        const s = this.selectedStructure;
        if (s.kind === 'wall') {
          return {
            mode: 'structure',
            isWall: true,
            type: 'wall',
            name: C.WALL.name,
            en: C.WALL.en,
            role: C.WALL.role,
            tagline: C.WALL.tagline,
            desc: C.WALL.desc,
            color: C.WALL.color,
            canUndo: this.canUndoSale(s),
            sellValue: this.getSellValue(s),
            spent: s.spent,
          };
        }
        const def = C.TOWERS[s.type];
        const maxLevel = this._towerMaxLevel(s.type);
        const maxed = s.level >= maxLevel;
        const upgradeCost = maxed ? 0 : this.getUpgradeCost(s);
        const damage = C.DAMAGE_TYPES[def.damageType] || null;
        return {
          mode: 'structure',
          isWall: false,
          type: s.type,
          name: def.name,
          en: def.en,
          role: def.role,
          tagline: def.tagline,
          desc: def.desc,
          color: def.color,
          accent: def.accent,
          level: s.level,
          tierName: (def.tierNames && def.tierNames[s.level - 1]) || '',
          maxLevel: maxLevel,
          stats: this._towerDisplayStats(s.type, s.level),
          nextStats: maxed ? null : this._towerDisplayStats(s.type, s.level + 1),
          damageType: damage ? damage.id : null,
          damageTypeName: damage ? damage.name : null,
          damageTypeColor: damage ? damage.color : null,
          tags: def.tags || [],
          reveal: !!def.reveal,
          revealRange: def.reveal ? def.levels[Math.min(s.level, def.levels.length) - 1].range : 0,
          counter: def.counter || '',
          special: this._specialLabel(s.type, this.getTowerStats(s)),
          nextSpecial: maxed ? null : this._specialLabel(s.type, C.TOWERS[s.type].levels[s.level]),
          upgradeCost: upgradeCost,
          canAffordUpgrade: !maxed && this.crystals >= upgradeCost,
          maxed: maxed,
          canUndo: this.canUndoSale(s),
          sellValue: this.getSellValue(s),
          spent: s.spent,
        };
      }
      return { mode: 'none' };
    }

    _towerDisplayStats(type, level) {
      const def = C.TOWERS[type];
      const base = def.levels[Math.min(this._towerMaxLevel(type), level) - 1];
      const stats = Object.assign({}, base);
      if (typeof stats.damage === 'number') stats.damage *= this.mods.damageMult;
      if (typeof stats.dps === 'number') stats.dps *= this.mods.damageMult;
      return stats;
    }

    _specialLabel(type, stats) {
      if (!stats) return '';
      if (type === 'beacon') return '侦测半径 ' + stats.range.toFixed(1);
      if (type === 'prism' && stats.shots > 1) return '×' + stats.shots + ' 齐射';
      if (type === 'gatling') return (1 / stats.cooldown).toFixed(1) + '/s';
      if (type === 'cannon') return '半径 ' + stats.splash.toFixed(2);
      if (type === 'laser') return '升温 ×' + stats.ramp.toFixed(1);
      if (type === 'shock') return '击退 ' + (stats.knockback || 0).toFixed(2) + ' 格';
      if (type === 'frost') return '-' + Math.round(stats.slow * 100) + '% · ' + stats.targets + ' 目标';
      if (type === 'tesla') return stats.chains + ' 链锁';
      return TOWER_SPECIAL_LABELS[type] || '';
    }

    getWavePreview(waveNumber) {
      const number = Math.max(1, Math.round(Number(waveNumber) || 0));
      if (!number || number > this.totalWaves) return null;
      const wave = this.level.waves[number - 1];
      if (!wave) return null;
      const counts = {};
      for (let i = 0; i < wave.groups.length; i++) {
        const group = wave.groups[i];
        counts[group.type] = (counts[group.type] || 0) + group.count;
      }
      const list = [];
      for (let i = 0; i < C.ENEMY_ORDER.length; i++) {
        const type = C.ENEMY_ORDER[i];
        if (!counts[type]) continue;
        const def = C.ENEMIES[type];
        list.push({
          type: type,
          count: counts[type],
          color: def.color,
          name: def.name,
          shape: def.shape,
          boss: !!def.boss,
          traits: (def.traits || []).slice(),
          shield: !!def.shield,
          stealth: !!def.stealth,
          tenacity: def.tenacity || 0,
          resist: def.resist || null,
        });
      }
      const threats = [];
      const seen = {};
      for (let i = 0; i < list.length; i++) {
        const traits = list[i].traits;
        for (let t = 0; t < traits.length; t++) {
          if (traits[t] === 'boss' || seen[traits[t]]) continue;
          seen[traits[t]] = true;
          const trait = C.TRAITS[traits[t]];
          if (trait) threats.push({ id: traits[t], name: trait.name, short: trait.short, color: trait.color });
        }
      }
      return {
        number: number,
        total: this.totalWaves,
        enemies: list,
        threats: threats,
        isBoss: list.some(function (entry) {
          return entry.boss;
        }),
      };
    }

    getNextWavePreview() {
      if (this.phase !== 'prep' || this.waveCursor >= this.totalWaves) return null;
      return this.getWavePreview(this.waveCursor + 1);
    }

    refreshUI() {
      this.dirty = true;
      this._flushStats();
      this._emitSelection();
    }

    /* ------------------------------------------------------------
       Input actions
       ------------------------------------------------------------ */
    selectBuild(type) {
      if (this.phase === 'victory' || this.phase === 'defeat') return;
      if (type && !C.TOWERS[type] && type !== 'wall') return;
      if (this.selectedBuild === type) {
        this.selectedBuild = null;
      } else {
        if (type && type !== 'wall' && this._towerCount() >= C.TOWER_CAPACITY) {
          this._toast('火力单元已达上限 · 回收现有防御塔后可重新部署', 'error');
          this._play('error');
          return;
        }
        this.selectedBuild = type || null;
        this.selectedStructure = null;
      }
      this._click();
      this._emitSelection();
      this._emitStats();
    }

    cancelSelection() {
      this.selectedBuild = null;
      this.selectedStructure = null;
      this._emitSelection();
      this._emitStats();
    }

    selectStructure(structure) {
      if (!structure) return;
      this.selectedStructure = structure;
      this.selectedBuild = null;
      this._click();
      this._emitSelection();
    }

    _selectStructureAt(cell) {
      const structure = this._structureAt(cell.x, cell.y);
      if (structure) {
        this.selectStructure(structure);
        return true;
      }
      return false;
    }

    _structureAt(x, y) {
      for (let i = 0; i < this.structures.length; i++) {
        if (this.structures[i].x === x && this.structures[i].y === y) return this.structures[i];
      }
      return null;
    }

    handleTap(cell) {
      if (this.phase === 'victory' || this.phase === 'defeat') return;
      if (!cell || !this.grid.inBounds(cell.x, cell.y)) {
        this.cancelSelection();
        return;
      }
      const struct = this._structureAt(cell.x, cell.y);
      if (struct) {
        this.selectStructure(struct);
        return;
      }
      if (this.selectedBuild) {
        this.tryBuild(cell.x, cell.y, this.selectedBuild);
        return;
      }
      if (this.grid.isRock(cell.x, cell.y)) {
        this._failPlacement(cell.x, cell.y, '小行星阻挡了部署');
        return;
      }
      if (this.selectedStructure) {
        this.cancelSelection();
      }
    }

    setHoverCell(cell) {
      this.hoverCell = cell;
    }

    tryBuild(x, y, type) {
      const buildType = type || this.selectedBuild;
      if (!buildType) return false;
      if (buildType !== 'wall' && this._towerCount() >= C.TOWER_CAPACITY) {
        this._failPlacement(x, y, '火力单元已达上限 · 可回收现有防御塔');
        return false;
      }
      const cost = this.getBuildCost(buildType);
      if (this.crystals < cost) {
        this._failPlacement(x, y, '晶元不足，无法部署');
        return false;
      }
      const cell = { x: x, y: y };
      if (this._structureAt(x, y)) {
        this._failPlacement(x, y, '该坐标已有设施');
        return false;
      }
      const check = this.grid.validateBuild(cell, this.structures, this.enemies);
      if (!check.ok) {
        this._failPlacement(x, y, check.reason);
        return false;
      }
      // Keep a clear gap around live units.
      for (let i = 0; i < this.enemies.length; i++) {
        const enemy = this.enemies[i];
        if (enemy.dead) continue;
        if (Math.floor(enemy.x) === x && Math.floor(enemy.y) === y) {
          this._failPlacement(x, y, '敌军正占据该坐标');
          return false;
        }
      }
      const def = buildType === 'wall' ? C.WALL : C.TOWERS[buildType];
      const structure = {
        uid: 's' + this.uid++,
        kind: buildType === 'wall' ? 'wall' : 'tower',
        type: buildType,
        x: x,
        y: y,
        level: 1,
        spent: cost,
        cooldown: 0.15,
        angle: -Math.PI / 2,
        recoil: 0,
        firing: 0,
        laserCharge: 0,
        laserIdle: 0,
        laserTargetId: null,
        beamFx: 0,
        idleSeed: Math.random() * TAU,
      };
      this.crystals -= cost;
      this.structures.push(structure);
      // Keep the last placement refundable in prep or while paused.
      this.lastBuiltStructure = structure;
      this._refreshPaths(true);
      this._addRing(x + 0.5, y + 0.5, def.color, 0.12, 0.62, 0.4, 1.2, true);
      this._burst(x + 0.5, y + 0.5, def.color, buildType === 'wall' ? 8 : 13, 0.7, 2.6, 0.035, true);
      this._play('build');
      if (this.selectedStructure === structure) this.selectedStructure = null;
      // One deployment per pick: keep the next tap from placing another copy.
      this.selectedBuild = null;
      this._emitSelection();
      this._emitStats();
      return true;
    }

    _failPlacement(x, y, reason) {
      this.placementError = { x: x, y: y, timer: 0.55 };
      this._toast(reason, 'error');
      this._play('error');
    }

    upgradeSelected() {
      const s = this.selectedStructure;
      if (!s || s.kind !== 'tower') return;
      const maxLevel = this._towerMaxLevel(s.type);
      if (s.level >= maxLevel) {
        this._toast('该节点已达到等级上限');
        return;
      }
      const cost = this.getUpgradeCost(s);
      if (this.crystals < cost) {
        this._toast('晶元不足，无法升级', 'error');
        this._play('error');
        return;
      }
      this.crystals -= cost;
      s.spent += cost;
      s.level += 1;
      if (this.lastBuiltStructure === s) this.lastBuiltStructure = null;
      this._addRing(s.x + 0.5, s.y + 0.5, C.TOWERS[s.type].accent, 0.1, 0.58, 0.5, 1.4, true);
      this._addRing(s.x + 0.5, s.y + 0.5, C.TOWERS[s.type].color, 0.05, 0.72, 0.55, 0.9, false);
      this._burst(s.x + 0.5, s.y + 0.5, C.TOWERS[s.type].color, 12, 0.5, 2.1, 0.03, true);
      this._float(s.x + 0.5, s.y + 0.2, 'LV.' + s.level, C.TOWERS[s.type].accent, true);
      this._play('upgrade');
      this._emitSelection();
      this._emitStats();
    }

    sellSelected() {
      const s = this.selectedStructure;
      if (!s) return;
      const undo = this.canUndoSale(s);
      const refund = this.getSellValue(s);
      this.structures = this.structures.filter(function (item) {
        return item !== s;
      });
      this.crystals += refund;
      if (this.lastBuiltStructure === s) this.lastBuiltStructure = null;
      this.selectedStructure = null;
      this._refreshPaths(true);
      if (s.kind === 'tower') {
        const color = undo ? '#7df4c6' : '#ffb45e';
        this._addRing(s.x + 0.5, s.y + 0.5, color, 0.1, 0.5, 0.35, 1, true);
        this._burst(s.x + 0.5, s.y + 0.5, color, 8, 0.5, 1.8, 0.03, true);
      }
      this._float(s.x + 0.5, s.y + 0.35, '+' + refund + ' ◇', undo ? '#7df4c6' : '#ffd35c', false, SELL_HINT_LIFE);
      this._play('sell');
      this._emitSelection();
      this._emitStats();
    }

    /* ------------------------------------------------------------
       Wave control
       ------------------------------------------------------------ */
    startWave() {
      if (this.paused || this.phase !== 'prep' || this.waveCursor >= this.totalWaves) return false;
      const wave = this.level.waves[this.waveCursor];
      const preview = this.getNextWavePreview();
      this.currentWave = this.waveCursor + 1;
      this.waveCursor += 1;
      // 波次起点快照：临时存档恢复时从本波开头重打，防止读档刷收入。
      this.waveStartCrystals = this.crystals;
      this.waveStartBaseHp = this.baseHp;
      this.phase = 'wave';
      this.waveElapsed = 0;
      this.prepRemaining = 0;
      this.prepWarningEmitted = true;
      this.spawnQueue = [];
      this.killsThisWave = 0;
      this.leaksThisWave = 0;
      let cursor = 0.9;
      for (let gi = 0; gi < wave.groups.length; gi++) {
        const group = wave.groups[gi];
        if (gi > 0) cursor += 0.75;
        for (let i = 0; i < group.count; i++) {
          const def = C.ENEMIES[group.type];
          let gateIndex = this._gateCursor++ % this.grid.gates.length;
          if (def && def.boss) gateIndex = Math.floor(this.grid.gates.length / 2);
          this.spawnQueue.push({
            time: cursor,
            type: group.type,
            gateIndex: gateIndex,
            hpMul: wave.hpMul || 1,
          });
          cursor += Math.max(0.1, group.gap);
        }
      }
      this._emit('onWaveStart', {
        wave: this.currentWave,
        total: this.totalWaves,
        preview: preview,
        hasBoss: wave.groups.some(function (g) {
          return C.ENEMIES[g.type] && C.ENEMIES[g.type].boss;
        }),
      });
      if (wave.groups.some(function (g) { return C.ENEMIES[g.type] && C.ENEMIES[g.type].boss; })) {
        this._play('boss');
      } else {
        this._play('wave');
      }
      this._emitPhase();
      this._emitStats();
      this._emitSelection();
      return true;
    }

    _spawnWaveEnemy(entry) {
      const def = C.ENEMIES[entry.type];
      if (!def) return;
      const gate = this.grid.gates[entry.gateIndex % this.grid.gates.length];
      const startX = gate.x + 0.5;
      const startY = gate.y + 0.5;
      const pathCells = this.grid.pathFrom(this.field, { x: gate.x, y: gate.y });
      const nodes = pathCells.slice(1).map(function (c) {
        return { x: c.x + 0.5, y: c.y + 0.5 };
      });
      const hpFactor = this.level.hpScale * (entry.hpMul || 1) * Math.pow(WAVE_HP_GROWTH, Math.max(0, this.currentWave - 1));
      const enemy = this._makeEnemy(entry.type, {
        x: startX,
        y: startY,
        nodes: nodes,
        hpFactor: hpFactor,
        waveNumber: this.currentWave,
      });
      this.enemies.push(enemy);
      this._addEffect({
        type: 'spawn',
        x: startX,
        y: startY,
        color: def.color,
        life: 0.35,
        maxLife: 0.35,
      });
      this._burst(startX, startY, def.color, def.boss ? 20 : 5, 0.3, 1.3, 0.028, true);
      if (def.boss) {
        this._toast('终焉棱镜已进入航道', 'error');
        this.shake = Math.max(this.shake, 9);
      }
      this._emitStats();
    }

    _makeEnemy(type, options) {
      const def = C.ENEMIES[type];
      const hpFactor = options.hpFactor != null
        ? options.hpFactor
        : this.level.hpScale * Math.pow(WAVE_HP_GROWTH, Math.max(0, this.currentWave - 1));
      const waveNumber = options.waveNumber || Math.max(1, this.currentWave);
      const lateProgress = U.clamp((waveNumber - 1) / Math.max(1, this.totalWaves - 1), 0, 1);
      const lateHpFactor = 1 + (this.level.lateWaveHp || 0) * lateProgress * lateProgress;
      const lateSpeedFactor = 1 + (this.level.lateWaveSpeed || 0) * lateProgress * lateProgress;
      const swarmHp = def.boss ? 1 : (C.SWARM_HP_SCALE || 1);
      const hp = Math.max(1, Math.round(def.hp * hpFactor * lateHpFactor * swarmHp));
      const shieldMax = def.shield ? Math.max(1, Math.round(hp * def.shield)) : 0;
      const speedVariance = 0.97 + Math.random() * 0.06;
      const speed = def.speed * this.level.speedScale * this.mods.enemySpeedMult * speedVariance * lateSpeedFactor;
      const swarmReward = def.boss ? 1 : (C.SWARM_REWARD_SCALE || 1);
      const reward = Math.max(1, Math.round(def.reward * this.level.rewardScale * (1 + Math.max(0, waveNumber - 1) * 0.012) * swarmReward));
      const damage = Math.max(1, Math.round(def.damage * (1 + (this.level.id - 1) * 0.060)));
      return {
        id: 'e' + this.uid++,
        type: type,
        def: def,
        x: options.x,
        y: options.y,
        nodes: options.nodes || [],
        hp: hp,
        maxHp: hp,
        shield: shieldMax,
        maxShield: shieldMax,
        shieldFlash: 0,
        shieldBroken: false,
        speed: speed,
        reward: reward,
        damage: damage,
        angle: Math.PI / 2,
        slowTenacity: def.tenacity || 0,
        kbTenacity: def.tenacity || 0,
        tenacityCap: (def.tenacity || 0) >= 1 ? 1 : 0.8,
        knockbackCd: 0,
        slowFactor: 0,
        slowTimer: 0,
        hitFlash: 0,
        spawnAnim: options.spawnAnim != null ? options.spawnAnim : 0,
        // Store the pre-curve factor so split children receive the late-wave curve exactly once.
        hpFactor: hpFactor,
        waveNumber: waveNumber,
        reroute: false,
        dead: false,
        leaked: false,
      };
    }

    _repathEnemy(enemy) {
      const cx = U.clamp(Math.floor(enemy.x), 0, P.COLS - 1);
      const cy = U.clamp(Math.floor(enemy.y), 0, P.ROWS - 1);
      const cells = this.grid.pathFrom(this.field, { x: cx, y: cy });
      if (!cells.length) {
        enemy.nodes = [];
        return;
      }
      enemy.nodes = cells.slice(1).map(function (c) {
        return { x: c.x + 0.5, y: c.y + 0.5 };
      });
    }

    _completeWave() {
      if (this.phase !== 'wave') return;
      const clearedWave = this.currentWave;
      const hasNext = this.waveCursor < this.totalWaves;
      let repaired = 0;
      // 纳米修复只奖励“干净的一波”：本波漏怪则不触发，避免用漏怪换输出、
      // 再用修复把核心血量刷回来的躺赢打法。
      if (this.mods.repair > 0 && this.leaksThisWave === 0) {
        const before = this.baseHp;
        this.baseHp = Math.min(this.baseMax, this.baseHp + this.mods.repair);
        repaired = Math.round(this.baseHp - before);
      }
      this._burst(
        this.grid.base.x + 0.5,
        this.grid.base.y + 0.5,
        this.level.accent,
        hasNext ? 14 : 28,
        0.3,
        2.2,
        0.035,
        true
      );
      let nextIn = 0;
      if (hasNext) {
        this.phase = 'prep';
        this.prepTotal = PREP_BETWEEN;
        this.prepRemaining = PREP_BETWEEN;
        this.prepWarningEmitted = false;
        this._lastPrepSecond = Math.ceil(PREP_BETWEEN);
        nextIn = PREP_BETWEEN;
      } else {
        this.phase = 'victory-pending';
        this.prepRemaining = 0;
        this.victoryTimer = 1.45;
      }
      this._emit('onWaveClear', {
        wave: clearedWave,
        total: this.totalWaves,
        hasNext: hasNext,
        repaired: repaired,
        nextIn: nextIn,
      });
      this._emitPhase();
      this._emitStats();
    }

    _finishVictory() {
      if (this.resultSent) return;
      this.resultSent = true;
      this.phase = 'victory';
      this._play('victory');
      this._emitPhase();
      this._emit('onVictory', this._buildSummary(true));
      this._emitStats();
    }

    _defeat() {
      if (this.resultSent) return;
      this.resultSent = true;
      this.phase = 'defeat';
      this._play('defeat');
      this._emitPhase();
      this._emit('onDefeat', this._buildSummary(false));
      this._emitStats();
    }

    _buildSummary(success) {
      const ratio = U.clamp(this.baseHp / this.baseMax, 0, 1);
      let stars = 0;
      if (success) {
        stars = ratio >= 0.8 ? 3 : ratio >= 0.4 ? 2 : 1;
      }
      return {
        success: success,
        levelId: this.level.id,
        levelName: this.level.name,
        baseHp: Math.max(0, this.baseHp),
        baseMax: this.baseMax,
        integrity: ratio,
        stars: stars,
        totalWaves: this.totalWaves,
        currentWave: this.currentWave,
        kills: this.kills,
        leaked: this.leaked,
        crystalsEarned: this.crystalsEarned,
        time: this.combatTime,
        startCrystals: this.startCrystals,
      };
    }

    /* ------------------------------------------------------------
       Simulation
       ------------------------------------------------------------ */
    update(realDelta) {
      if (this.disposed) return;
      const clamped = Math.min(realDelta, 0.07);
      if (this.paused) {
        // Paused only freezes combat; transient UI feedback keeps aging so
        // hints, selection flashes and sell readouts never linger on the map.
        this._updateVisuals(clamped);
        return;
      }
      let remaining = clamped * this.speed;
      const fixed = 1 / 60;
      let steps = 0;
      while (remaining > 0.00001 && steps < 16) {
        const dt = Math.min(fixed, remaining);
        this._step(dt);
        remaining -= dt;
        steps++;
      }
      this._flushStats();
    }

    _updateVisuals(dt) {
      this.shake = Math.max(0, this.shake - dt * 23);
      this.baseFlash = Math.max(0, this.baseFlash - dt * 2.8);
      if (this.placementError) {
        this.placementError.timer -= dt;
        if (this.placementError.timer <= 0) this.placementError = null;
      }
      this._updateEffects(dt);
      this._updateParticles(dt);
      this._updateFloatTexts(dt);
    }

    _step(dt) {
      this.clock += dt;
      this._updateVisuals(dt);
      this._updateTowerTimers(dt);

      if (this.phase === 'victory-pending') {
        this._updateProjectiles(dt);
        this.victoryTimer -= dt;
        if (this.victoryTimer <= 0) this._finishVictory();
        return;
      }
      if (this.phase === 'victory' || this.phase === 'defeat') {
        return;
      }

      if (this.phase === 'wave') {
        this.combatTime += dt;
        this.waveElapsed += dt;
        while (this.spawnQueue.length && this.spawnQueue[0].time <= this.waveElapsed) {
          this._spawnWaveEnemy(this.spawnQueue.shift());
        }
        for (let i = 0; i < this.enemies.length; i++) {
          const enemy = this.enemies[i];
          if (!enemy.dead && !enemy.leaked) this._updateEnemy(enemy, dt);
        }
        this.enemies = this.enemies.filter(function (enemy) {
          return !enemy.dead && !enemy.leaked;
        });
        this._updateTowers(dt);
        this._updateProjectiles(dt);
        if (this.phase === 'wave' && this.spawnQueue.length === 0 && this.enemies.length === 0) {
          this._completeWave();
        }
      } else {
        // Idle state: let towers sweep, and allow stray shots to finish their flight.
        this._updateTowers(dt, true);
        this._updateProjectiles(dt);
        if (this.phase === 'prep') this._updatePrep(dt);
      }
    }

    _updatePrep(dt) {
      this.prepRemaining = Math.max(0, this.prepRemaining - dt);
      const displaySecond = Math.ceil(this.prepRemaining);
      if (displaySecond !== this._lastPrepSecond) {
        this._lastPrepSecond = displaySecond;
        this.dirty = true;
      }
      if (!this.prepWarningEmitted && this.prepRemaining <= PREP_WARNING_AT) {
        this.prepWarningEmitted = true;
        this.dirty = true;
        const nextWave = Math.min(this.waveCursor + 1, this.totalWaves);
        this._play('warning');
        this.shake = Math.max(this.shake, 1.4);
        this._emit('onWaveWarning', {
          wave: nextWave,
          total: this.totalWaves,
          seconds: Math.max(1, Math.ceil(this.prepRemaining)),
        });
      }
      if (this.prepRemaining <= 0) {
        this.startWave();
      }
    }

    _updateTowerTimers(dt) {
      for (let i = 0; i < this.structures.length; i++) {
        const s = this.structures[i];
        if (s.kind !== 'tower') continue;
        s.cooldown = Math.max(0, s.cooldown - dt);
        s.recoil = Math.max(0, s.recoil - dt * 6.5);
        s.firing = Math.max(0, (s.firing || 0) - dt);
        s.beamFx = Math.max(0, (s.beamFx || 0) - dt);
        if (s.laserIdle > 0) s.laserIdle = Math.max(0, s.laserIdle - dt);
        if (!s.targetId) {
          s.angle = U.mutateAngle(s.angle, -Math.PI / 2 + Math.sin(this.clock * 0.7 + s.idleSeed) * 0.48, dt * 0.8);
        }
      }
    }

    _updateEnemy(enemy, dt) {
      // 击退位移（0.1s 快推）：期间覆盖正常移动，推完立即恢复前进。
      if (enemy.knockbackT > 0) {
        const kdt = Math.min(dt, enemy.knockbackT);
        enemy.x = U.clamp(enemy.x + enemy.kbDx * kdt, 0.15, P.COLS - 0.15);
        enemy.y = U.clamp(enemy.y + enemy.kbDy * kdt, 0.15, P.ROWS - 0.15);
        enemy.knockbackT -= kdt;
        return;
      }
      enemy.spawnAnim = Math.min(1, enemy.spawnAnim + dt * 4.5);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt * 7);
      enemy.shieldFlash = Math.max(0, (enemy.shieldFlash || 0) - dt * 5.5);
      if (enemy.slowBlocked > 0) enemy.slowBlocked = Math.max(0, enemy.slowBlocked - dt);
      if (enemy.knockbackCd > 0) enemy.knockbackCd = Math.max(0, enemy.knockbackCd - dt);
      if (enemy.slowTimer > 0) {
        enemy.slowTimer = Math.max(0, enemy.slowTimer - dt);
        if (enemy.slowTimer === 0) enemy.slowFactor = 0;
      }
      if (enemy.reroute) {
        enemy.reroute = false;
        this._repathEnemy(enemy);
      }
      let remaining = enemy.speed * (1 - enemy.slowFactor) * dt;
      let guard = 0;
      while (remaining > 0.000001 && guard++ < 12) {
        if (!enemy.nodes.length) {
          const atBase = this.grid.isBase(Math.floor(enemy.x), Math.floor(enemy.y));
          if (atBase) {
            this._leakEnemy(enemy);
            return;
          }
          this._repathEnemy(enemy);
          if (!enemy.nodes.length) {
            // Defensive fallback; this should not occur because building is validated.
            this._leakEnemy(enemy);
            return;
          }
        }
        const node = enemy.nodes[0];
        const dx = node.x - enemy.x;
        const dy = node.y - enemy.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= 0.00001) {
          enemy.nodes.shift();
          guard++;
          continue;
        }
        const targetAngle = Math.atan2(dy, dx);
        enemy.angle = U.mutateAngle(enemy.angle, targetAngle, dt * 12);
        if (distance <= remaining) {
          enemy.x = node.x;
          enemy.y = node.y;
          enemy.nodes.shift();
          remaining -= distance;
          if (!enemy.nodes.length) {
            if (this.grid.isBase(Math.floor(enemy.x), Math.floor(enemy.y)) || this._nearBase(enemy)) {
              this._leakEnemy(enemy);
              return;
            }
            this._repathEnemy(enemy);
            if (!enemy.nodes.length) {
              this._leakEnemy(enemy);
              return;
            }
          }
        } else {
          enemy.x += (dx / distance) * remaining;
          enemy.y += (dy / distance) * remaining;
          remaining = 0;
        }
      }
    }

    _nearBase(enemy) {
      const bx = this.grid.base.x + 0.5;
      const by = this.grid.base.y + 0.5;
      return Math.abs(enemy.x - bx) < 0.02 && Math.abs(enemy.y - by) < 0.02;
    }

    _leakEnemy(enemy) {
      if (enemy.leaked || enemy.dead) return;
      enemy.leaked = true;
      this.leaked++;
      this.leaksThisWave++;
      const damage = this.mods.godMode ? 0 : Math.max(1, enemy.damage);
      if (damage > 0) {
        this.baseHp = Math.max(0, this.baseHp - damage);
        this.baseFlash = Math.max(this.baseFlash, enemy.def.boss ? 1.25 : 1);
      }
      this.shake = Math.max(this.shake, enemy.def.boss ? 13 : 4.5);
      this._addRing(
        this.grid.base.x + 0.5,
        this.grid.base.y + 0.5,
        '#ff5d7a',
        0.1,
        enemy.def.boss ? 1.6 : 0.8,
        0.42,
        1.3,
        true
      );
      this._addRing(
        this.grid.base.x + 0.5,
        this.grid.base.y + 0.5,
        '#ffd0d8',
        0.24,
        enemy.def.boss ? 2.4 : 1.4,
        0.55,
        0.9,
        true
      );
      this._burst(
        this.grid.base.x + 0.5,
        this.grid.base.y + 0.5,
        '#ff5d7a',
        enemy.def.boss ? 20 : 7,
        0.5,
        2.1,
        0.035,
        true
      );
      this._float(
        this.grid.base.x + 0.5,
        this.grid.base.y - 0.1,
        this.mods.godMode ? 'GOD' : '-' + damage,
        this.mods.godMode ? '#7df4c6' : '#ff8a9c',
        enemy.def.boss || this.mods.godMode
      );
      this._play('leak');
      this._emitStats();
      if (this.baseHp <= 0) {
        this._defeat();
      }
    }

    _updateTowers(dt, idleOnly) {
      for (let i = 0; i < this.structures.length; i++) {
        const tower = this.structures[i];
        if (tower.kind !== 'tower') continue;
        const stats = this.getTowerStats(tower);
        const def = C.TOWERS[tower.type];
        if (tower.type === 'beacon') {
          tower.targetId = null;
          tower.firing = 0;
          continue;
        }
        if (idleOnly || this.phase !== 'wave') {
          tower.targetId = null;
          continue;
        }
        if (tower.type === 'laser') {
          this._updateLaser(tower, stats, def, dt);
          continue;
        }
        if (tower.type === 'shock') {
          if (tower.cooldown > 0) continue;
          // 冲击环外沿 0.5 格余量：在射程边界悬停的敌人也会被脉冲命中
          // （伤害 + 韧性成长），否则会在边界外永生振荡（软锁）。
          const targets = this._enemiesInRange(tower, stats.range + 0.5);
          if (!targets.length) {
            tower.targetId = null;
            continue;
          }
          this._fireShock(tower, stats, def, targets);
          continue;
        }
        if (tower.cooldown > 0) {
          tower.targetId = null;
          continue;
        }
        let targets;
        if (tower.type === 'frost') {
          targets = this._sortedTargetsInRange(tower, stats.range).slice(0, stats.targets || 1);
          if (!targets.length) {
            tower.targetId = null;
            continue;
          }
          this._fireFrost(tower, stats, def, targets);
          continue;
        }
        if (tower.type === 'tesla') {
          const primary = this._findTarget(tower, stats.range);
          if (!primary) {
            tower.targetId = null;
            continue;
          }
          this._fireTesla(tower, stats, def, primary);
          continue;
        }
        if (tower.type === 'prism') {
          const shots = stats.shots || 1;
          targets = [];
          const used = {};
          for (let s = 0; s < shots; s++) {
            const target = this._findTarget(tower, stats.range, used);
            if (target) {
              targets.push(target);
              used[target.id] = true;
            }
          }
          if (!targets.length) {
            tower.targetId = null;
            continue;
          }
          this._firePrism(tower, stats, def, targets);
          continue;
        }
        // Gatling and cannon.
        const target = this._findTarget(tower, stats.range);
        if (!target) {
          tower.targetId = null;
          continue;
        }
        if (tower.type === 'gatling') this._fireGatling(tower, stats, def, target);
        else if (tower.type === 'cannon') this._fireCannon(tower, stats, def, target);
      }
    }

    _towerCenter(tower) {
      return { x: tower.x + 0.5, y: tower.y + 0.5 };
    }

    _findTarget(tower, range, exclude) {
      const center = this._towerCenter(tower);
      let best = null;
      let bestScore = Infinity;
      for (let i = 0; i < this.enemies.length; i++) {
        const enemy = this.enemies[i];
        if (enemy.dead || enemy.leaked) continue;
        if (!this._enemyRevealed(enemy)) continue;
        if (exclude && exclude[enemy.id]) continue;
        const dx = enemy.x - center.x;
        const dy = enemy.y - center.y;
        const d2 = dx * dx + dy * dy;
        const reach = range + (enemy.def.radius || 0) * 0.5;
        if (d2 > reach * reach) continue;
        const ec = this.grid.cellOf(enemy);
        const toBase = this.grid.distAt(this.field, ec.x, ec.y);
        const score = (toBase === P.INF ? 999 : toBase) * 100 + Math.sqrt(d2);
        if (score < bestScore) {
          bestScore = score;
          best = enemy;
        }
      }
      return best;
    }

    _sortedTargetsInRange(tower, range) {
      const center = this._towerCenter(tower);
      const list = [];
      for (let i = 0; i < this.enemies.length; i++) {
        const enemy = this.enemies[i];
        if (enemy.dead || enemy.leaked) continue;
        if (!this._enemyRevealed(enemy)) continue;
        const dx = enemy.x - center.x;
        const dy = enemy.y - center.y;
        if (dx * dx + dy * dy <= (range + enemy.def.radius * 0.5) * (range + enemy.def.radius * 0.5)) {
          const ec = this.grid.cellOf(enemy);
          const toBase = this.grid.distAt(this.field, ec.x, ec.y);
          list.push({ enemy: enemy, rank: toBase === P.INF ? 999 : toBase });
        }
      }
      list.sort(function (a, b) {
        return a.rank - b.rank;
      });
      return list.map(function (item) {
        return item.enemy;
      });
    }

    _enemiesInRange(tower, range) {
      const center = this._towerCenter(tower);
      const list = [];
      for (let i = 0; i < this.enemies.length; i++) {
        const enemy = this.enemies[i];
        if (enemy.dead || enemy.leaked) continue;
        if (!this._enemyRevealed(enemy)) continue;
        const dx = enemy.x - center.x;
        const dy = enemy.y - center.y;
        const reach = range + enemy.def.radius * 0.4;
        if (dx * dx + dy * dy <= reach * reach) list.push(enemy);
      }
      return list;
    }

    _aim(tower, target) {
      const center = this._towerCenter(tower);
      tower.angle = Math.atan2(target.y - center.y, target.x - center.x);
      tower.targetId = target.id;
    }

    _firePrism(tower, stats, def, targets) {
      const center = this._towerCenter(tower);
      const primary = targets[0];
      this._aim(tower, primary);
      // 主副箭：主箭全额伤害打主目标；副箭仅在存在第二目标时发射，伤害较低。
      // 单目标时只射主箭（不把副箭砸在同一个目标上）。
      const damages = [stats.damage];
      if (stats.second) damages.push(stats.second);
      for (let i = 0; i < targets.length; i++) {
        const angle = Math.atan2(targets[i].y - center.y, targets[i].x - center.x);
        this.projectiles.push({
          type: 'arrow',
          x: center.x + Math.cos(angle) * 0.18,
          y: center.y + Math.sin(angle) * 0.18,
          target: targets[i],
          lastX: targets[i].x,
          lastY: targets[i].y,
          speed: 11.5,
          damage: damages[Math.min(i, damages.length - 1)],
          damageType: 'kinetic',
          color: def.accent,
          angle: angle,
          life: 3,
          tier: tower.level || 1,
          tower: tower,
        });
      }
      this._addMuzzle(center.x, center.y, tower.angle, def.accent, 0.55, tower.level);
      this._burst(center.x + Math.cos(tower.angle) * 0.25, center.y + Math.sin(tower.angle) * 0.25, def.color, 2, 0.2, 0.8, 0.02, true);
      tower.recoil = 1;
      tower.firing = 0.12;
      tower.cooldown = stats.cooldown;
      this._play('arrow');
    }

    _fireGatling(tower, stats, def, target) {
      const center = this._towerCenter(tower);
      this._aim(tower, target);
      const angle = Math.atan2(target.y - center.y, target.x - center.x) + (Math.random() - 0.5) * 0.04;
      this.projectiles.push({
        type: 'bullet',
        x: center.x + Math.cos(angle) * 0.2,
        y: center.y + Math.sin(angle) * 0.2,
        target: target,
        lastX: target.x,
        lastY: target.y,
        speed: 17,
        damage: stats.damage,
        damageType: 'kinetic',
        color: def.color,
        angle: angle,
        life: 2,
        tier: tower.level || 1,
        tower: tower,
      });
      this._addMuzzle(center.x + Math.cos(angle) * 0.26, center.y + Math.sin(angle) * 0.26, angle, def.accent, 0.4, tower.level);
      tower.recoil = 0.8;
      tower.firing = 0.1;
      tower.cooldown = stats.cooldown;
      this._play('gatling');
    }

    _fireCannon(tower, stats, def, target) {
      const center = this._towerCenter(tower);
      this._aim(tower, target);
      const angle = Math.atan2(target.y - center.y, target.x - center.x);
      this.projectiles.push({
        type: 'shell',
        x: center.x + Math.cos(angle) * 0.24,
        y: center.y + Math.sin(angle) * 0.24,
        target: target,
        lastX: target.x,
        lastY: target.y,
        speed: 6.2,
        damage: stats.damage,
        damageType: 'kinetic',
        color: def.color,
        angle: angle,
        splash: stats.splash,
        life: 4,
        spin: 0,
        tier: tower.level || 1,
        tower: tower,
      });
      this._addMuzzle(center.x + Math.cos(angle) * 0.32, center.y + Math.sin(angle) * 0.32, angle, def.accent, 0.9, tower.level);
      this._burst(center.x + Math.cos(angle) * 0.3, center.y + Math.sin(angle) * 0.3, def.color, 5, 0.2, 1.1, 0.028, true);
      tower.recoil = 1.2;
      tower.firing = 0.24;
      tower.cooldown = stats.cooldown;
      this.shake = Math.max(this.shake, 1.2);
      this._play('cannon');
    }

    _fireShock(tower, stats, def, targets) {
      const center = this._towerCenter(tower);
      tower.firing = 0.35;
      tower.cooldown = stats.cooldown;
      tower.angle = -Math.PI / 2;
      for (let i = 0; i < targets.length; i++) {
        const enemy = targets[i];
        this._damageEnemy(enemy, stats.damage, 'energy', tower);
        this._applyKnockback(enemy, stats.knockback || 0.4, tower, stats.range);
      }
      this._addRing(center.x, center.y, def.color, 0.16, stats.range, 0.44, 2, true, tower.level);
      this._addRing(center.x, center.y, def.accent, 0.05, stats.range * 0.72, 0.34, 1, false, tower.level);
      if ((tower.level || 1) >= 4) {
        this._addRing(center.x, center.y, def.accent, 0.02, stats.range * 1.05, 0.58, 0.7, false, tower.level);
      }
      this._burst(center.x, center.y, def.color, 9, 0.9, 2.4, 0.03, true);
      this.shake = Math.max(this.shake, 1.5);
      this._play('shock');
    }

    _fireFrost(tower, stats, def, targets) {
      const center = this._towerCenter(tower);
      this._aim(tower, targets[0]);
      for (let i = 0; i < targets.length; i++) {
        const enemy = targets[i];
        this._damageEnemy(enemy, stats.damage, 'cryo', tower);
        this._applySlow(enemy, stats.slow, stats.slowTime);
        this._addEffect({
          type: 'frostTrail',
          x1: center.x,
          y1: center.y,
          x2: enemy.x,
          y2: enemy.y,
          color: def.color,
          life: 0.22,
          maxLife: 0.22,
          tier: tower.level || 1,
        });
        this._burst(enemy.x, enemy.y, def.color, 3, 0.2, 0.7, 0.025, true);
      }
      this._addRing(center.x, center.y, def.accent, 0.08, 0.55, 0.32, 0.9, false);
      tower.recoil = 0.4;
      tower.firing = 0.16;
      tower.cooldown = stats.cooldown;
      this._play('frost');
    }

    _fireTesla(tower, stats, def, primary) {
      const center = this._towerCenter(tower);
      this._aim(tower, primary);
      const targets = [primary];
      const hit = {};
      hit[primary.id] = true;
      let current = primary;
      for (let i = 1; i < stats.chains; i++) {
        let next = null;
        let best = 2.1 * 2.1;
        for (let e = 0; e < this.enemies.length; e++) {
          const enemy = this.enemies[e];
          if (enemy.dead || enemy.leaked || hit[enemy.id]) continue;
          if (!this._enemyRevealed(enemy)) continue;
          const dx = enemy.x - current.x;
          const dy = enemy.y - current.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) {
            best = d2;
            next = enemy;
          }
        }
        if (!next) break;
        targets.push(next);
        hit[next.id] = true;
        current = next;
      }
      const points = [{ x: center.x, y: center.y }];
      for (let i = 0; i < targets.length; i++) {
        points.push({ x: targets[i].x, y: targets[i].y });
        const damage = stats.damage * Math.pow(stats.falloff, i);
        this._damageEnemy(targets[i], damage, 'energy', tower);
        this._burst(targets[i].x, targets[i].y, def.color, 3, 0.4, 1.2, 0.022, true);
      }
      const jagged = this._jaggedPath(points);
      this._addEffect({
        type: 'lightning',
        points: jagged,
        color: def.color,
        life: 0.16,
        maxLife: 0.16,
        width: 1.35,
        tier: tower.level || 1,
      });
      tower.recoil = 0.3;
      tower.firing = 0.18;
      tower.cooldown = stats.cooldown;
      this._play('tesla');
    }

    _jaggedPath(points) {
      const out = [];
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        out.push(a);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const segments = 3;
        for (let s = 1; s < segments; s++) {
          const t = s / segments;
          const jitter = (Math.random() - 0.5) * 0.2;
          out.push({
            x: U.lerp(a.x, b.x, t) + nx * jitter,
            y: U.lerp(a.y, b.y, t) + ny * jitter,
          });
        }
      }
      out.push(points[points.length - 1]);
      return out;
    }

    _updateLaser(tower, stats, def, dt) {
      const center = this._towerCenter(tower);
      let target = null;
      if (tower.laserTargetId) {
        for (let i = 0; i < this.enemies.length; i++) {
          if (this.enemies[i].id === tower.laserTargetId && !this.enemies[i].dead) {
            target = this.enemies[i];
            break;
          }
        }
        if (target) {
          if (!this._enemyRevealed(target)) {
            target = null;
          } else {
            const dx = target.x - center.x;
            const dy = target.y - center.y;
            if (dx * dx + dy * dy > (stats.range + target.def.radius) * (stats.range + target.def.radius)) {
              target = null;
            }
          }
        }
      }
      if (!target) {
        target = this._findTarget(tower, stats.range);
        if (target) {
          tower.laserTargetId = target.id;
          tower.laserCharge = 0;
        } else {
          tower.laserTargetId = null;
          tower.laserCharge = Math.max(0, tower.laserCharge - dt * 2.5);
          tower.targetId = null;
          return;
        }
      }
      this._aim(tower, target);
      tower.laserCharge = Math.min(1, tower.laserCharge + dt / 2.2);
      tower.firing = 0.12;
      const charge = 0.22 + 0.78 * tower.laserCharge;
      const dps = stats.dps * (1 + (stats.ramp - 1) * tower.laserCharge);
      this._damageEnemy(target, dps * dt, 'energy', tower, true);
      if (tower.beamFx <= 0) {
        this._addEffect({
          type: 'beam',
          x1: center.x,
          y1: center.y,
          x2: target.x,
          y2: target.y,
          color: def.color,
          life: 0.15,
          maxLife: 0.15,
          width: 1.2 + charge * 1.6,
          tier: tower.level || 1,
          charge: tower.laserCharge,
        });
        tower.beamFx = 0.08;
        this._play('laser');
      }
      if (Math.random() < dt * 7) {
        this._burst(target.x, target.y, def.accent, 2, 0.3, 1.2, 0.02, true);
      }
      tower._laserDps = dps;
    }

    _updateProjectiles(dt) {
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const p = this.projectiles[i];
        p.life -= dt;
        if (p.life <= 0) {
          this.projectiles.splice(i, 1);
          continue;
        }
        if (p.target && !p.target.dead && !p.target.leaked) {
          p.lastX = p.target.x;
          p.lastY = p.target.y;
        }
        const dx = p.lastX - p.x;
        const dy = p.lastY - p.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const step = p.speed * dt;
        if (distance > 0.0001) p.angle = Math.atan2(dy, dx);
        if (distance <= step + 0.06) {
          p.x = p.lastX;
          p.y = p.lastY;
          this._impactProjectile(p);
          this.projectiles.splice(i, 1);
        } else {
          p.x += (dx / distance) * step;
          p.y += (dy / distance) * step;
          if (p.type === 'shell') p.spin = (p.spin || 0) + dt * 8;
        }
      }
    }

    _impactProjectile(p) {
      if (p.type === 'shell') {
        const hits = [];
        for (let i = 0; i < this.enemies.length; i++) {
          const enemy = this.enemies[i];
          if (enemy.dead || enemy.leaked) continue;
          const dx = enemy.x - p.x;
          const dy = enemy.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= p.splash + enemy.def.radius * 0.3) {
            hits.push({ enemy: enemy, dist: dist });
          }
        }
        hits.sort(function (a, b) { return a.dist - b.dist; });
        // 溅射重做：最多命中最近 3 个目标，伤害随距离衰减（边缘 40%）——
        // 封顶"聚怪一锅端"的收益；单体重炮不受影响。
        const maxTargets = 3;
        for (let i = 0; i < Math.min(maxTargets, hits.length); i++) {
          const falloff = 1 - 0.6 * Math.min(1, hits[i].dist / Math.max(0.01, p.splash));
          this._damageEnemy(hits[i].enemy, p.damage * falloff, 'kinetic', p.tower);
        }
        this._addRing(p.x, p.y, p.color, 0.12, p.splash, 0.45, 2.2, true, p.tier);
        this._addRing(p.x, p.y, '#fff0cf', 0.04, p.splash * 0.55, 0.26, 1, false, p.tier);
        if ((p.tier || 1) >= 4) {
          this._addRing(p.x, p.y, p.color, 0.02, p.splash * 1.35, 0.62, 0.8, false, p.tier);
        }
        this._burst(p.x, p.y, p.color, 14, 0.9, 3.2, 0.035, true);
        this.shake = Math.max(this.shake, 2.8);
        this._play('hit');
      } else {
        if (p.target && !p.target.dead && !p.target.leaked) {
          const dist = U.dist(p.x, p.y, p.target.x, p.target.y);
          if (dist < 0.35) {
            this._damageEnemy(p.target, p.damage, p.damageType, p.tower);
          }
        }
        this._burst(p.x, p.y, p.color, 2, 0.15, 0.7, 0.02, true);
        this._play('hit');
      }
    }

    _applySlow(enemy, factor, duration) {
      if (!enemy || enemy.dead) return;
      if (!this._enemyRevealed(enemy)) return;
      // 韧性分轨道结算：减速与击退各自独立累积、独立减免。
      // 成长上限 0.8——重度削减但非绝对免疫；100% 免疫为终焉专属。
      const effective = factor * (1 - (enemy.slowTenacity || 0));
      if (!Number.isFinite(effective) || effective <= 0.001) {
        enemy.slowBlocked = 0.35;
        return;
      }
      if (effective >= enemy.slowFactor || enemy.slowTimer <= 0) {
        enemy.slowFactor = Math.max(enemy.slowFactor, effective);
      }
      enemy.slowTimer = Math.max(enemy.slowTimer, duration);
      // 控制命中累积对应轨道的韧性：同一敌人被反复减速会越来越抗减速。
      enemy.slowTenacity = Math.min(enemy.tenacityCap, (enemy.slowTenacity || 0) + CONTROL_TENACITY_GAIN);
    }

    _applyKnockback(enemy, distance, tower, pulseRange) {
      if (!enemy || enemy.dead || enemy.leaked) return;
      if (!this._enemyRevealed(enemy)) return;
      // 核心引力区：最后一段航道不受击退，防止震荡塔无限顶停敌群。
      const bx = this.grid.base.x + 0.5;
      const by = this.grid.base.y + 0.5;
      if (Math.hypot(enemy.x - bx, enemy.y - by) < 1.6) return;
      // 韧性按比例缩短击退距离；韧性 100% 完全免疫。
      const effective = distance * (1 - (enemy.kbTenacity || 0));
      if (effective <= 0.02) {
        enemy.slowBlocked = 0.35;
        return;
      }
      // 击退免疫窗：多座震荡塔错峰齐射时，无窗会让敌人永久振荡软锁（实测 120min 超时）。
      if ((enemy.knockbackCd || 0) > 0) return;
      enemy.knockbackCd = 0.9;
      // 位移上限：敌人不得被推出本塔脉冲可达范围（range + 0.4）——
      // 否则会在射程边界外 0.2 格相位锁定悬停，不吃伤害也不漏怪（软锁）。
      let back = Math.min(effective, 0.6);
      if (tower) {
        const td = Math.hypot(enemy.x - (tower.x + 0.5), enemy.y - (tower.y + 0.5));
        back = Math.min(back, Math.max(0, (pulseRange || 1.5) + 0.4 - td));
      }
      if (back <= 0.02) return;
      const nx = U.clamp(enemy.x - Math.cos(enemy.angle) * back, 0.15, P.COLS - 0.15);
      const ny = U.clamp(enemy.y - Math.sin(enemy.angle) * back, 0.15, P.ROWS - 0.15);
      // 击退是 0.1s 的快速位移（快推），不是让敌人慢慢走回去——
      // 推完立即恢复前进，避免敌人把大把时间浪费在"往回走"上。
      enemy.kbDx = (nx - enemy.x) / 0.1;
      enemy.kbDy = (ny - enemy.y) / 0.1;
      enemy.knockbackT = 0.1;
      // 击退命中累积击退轨道韧性，与减速轨道互不影响。
      enemy.kbTenacity = Math.min(enemy.tenacityCap, (enemy.kbTenacity || 0) + CONTROL_TENACITY_GAIN);
      this._burst(enemy.x, enemy.y, '#ffcf57', 5, 0.35, 1.4, 0.02, true);
    }

    _damageEnemy(enemy, amount, type, tower, continuous) {
      if (!enemy || enemy.dead || enemy.leaked) return 0;
      if (!this._enemyRevealed(enemy)) return 0;
      const incoming = Math.max(0.01, amount);
      const resist = enemy.def.resist || {};
      const resistMult = Math.max(0, 1 - (resist[type] || 0));
      let hpDamage = incoming * resistMult;

      if (enemy.shield > 0) {
        const typeDef = C.DAMAGE_TYPES[type] || { shield: 1 };
        const shieldMult = typeDef.shield || 1;
        const shieldDamage = incoming * shieldMult;
        const absorbed = Math.min(enemy.shield, shieldDamage);
        enemy.shield = Math.max(0, enemy.shield - absorbed);
        enemy.shieldFlash = Math.max(enemy.shieldFlash || 0, continuous ? 0.04 : 0.16);
        const overflow = Math.max(0, shieldDamage - absorbed);
        hpDamage = (overflow / shieldMult) * resistMult;
        if (enemy.shield <= 0 && !enemy.shieldBroken) {
          enemy.shieldBroken = true;
          this._shieldBreak(enemy);
        }
        if (hpDamage <= 0.0001) {
          enemy.hitFlash = Math.max(enemy.hitFlash, continuous ? 0.02 : 0.06);
          return 0;
        }
      }

      enemy.hp -= hpDamage;
      enemy.hitFlash = Math.max(enemy.hitFlash, continuous ? 0.02 : 0.08);
      if (!continuous && Math.random() < 0.28) {
        this._burst(enemy.x, enemy.y, enemy.def.color, 1, 0.2, 0.9, 0.018, false);
      }
      if (enemy.hp <= 0) {
        this._killEnemy(enemy, tower);
      }
      return hpDamage;
    }

    _shieldBreak(enemy) {
      enemy.shieldFlash = 0.4;
      this._addRing(enemy.x, enemy.y, '#6fe7ff', 0.08, 0.9, 0.44, 1.5, true);
      this._burst(enemy.x, enemy.y, '#6fe7ff', 11, 0.5, 2.4, 0.028, true);
      this._float(enemy.x, enemy.y - 0.12, '护盾破裂', '#9bfaff', false);
      this._play('shieldBreak');
    }

    _killEnemy(enemy, sourceTower) {
      if (enemy.dead) return;
      enemy.dead = true;
      const def = enemy.def;
      this.kills++;
      this.killsThisWave++;
      const crystalMult = this.mods.crystalMult || 1;
      const reward = Math.max(1, Math.round(enemy.reward * crystalMult));
      this.crystals += reward;
      this.crystalsEarned += reward;
      this._addRing(enemy.x, enemy.y, def.color, 0.05, def.boss ? 1.3 : 0.36, def.boss ? 0.65 : 0.32, def.boss ? 2.4 : 1, false);
      this._burst(enemy.x, enemy.y, def.color, def.boss ? 28 : 8, 0.3, def.boss ? 3.4 : 2, def.boss ? 0.05 : 0.028, true);
      if (def.boss) {
        this.shake = Math.max(this.shake, 10);
        this._float(enemy.x, enemy.y - 0.1, '终焉瓦解', '#ffe38a', true);
      } else if (reward >= 8 || Math.random() < 0.22) {
        this._float(enemy.x, enemy.y - 0.08, '+' + reward + ' ◇', '#9ffaff', false);
      }
      this._emit('onCrystalGain', { amount: reward, total: Math.floor(this.crystals) });
      this._play(def.boss ? 'victory' : reward >= 8 ? 'kill' : 'hit');
      if (def.split) {
        this._splitEnemy(enemy, def.split);
      }
      this._emitStats();
      void sourceTower;
    }

    _splitEnemy(enemy, split) {
      const shardDef = C.ENEMIES[split.type];
      if (!shardDef) return;
      const baseAngle = enemy.angle + Math.PI / 2;
      for (let i = 0; i < split.count; i++) {
        const offset = (i - (split.count - 1) / 2) * 0.12;
        const x = U.clamp(enemy.x + Math.cos(baseAngle) * offset, 0.15, P.COLS - 0.15);
        const y = U.clamp(enemy.y + Math.sin(baseAngle) * offset, 0.15, P.ROWS - 0.15);
        const child = this._makeEnemy(split.type, {
          x: x,
          y: y,
          nodes: [],
          hpFactor: enemy.hpFactor * 1.0,
          waveNumber: enemy.waveNumber,
          spawnAnim: 0.35,
        });
        this.enemies.push(child);
        this._addEffect({
          type: 'spawn',
          x: x,
          y: y,
          color: shardDef.color,
          life: 0.24,
          maxLife: 0.24,
        });
      }
      this._burst(enemy.x, enemy.y, '#ff9add', 8, 0.5, 2.2, 0.025, true);
      this._play('split');
    }

    _updateEffects(dt) {
      for (let i = this.effects.length - 1; i >= 0; i--) {
        const e = this.effects[i];
        e.life -= dt;
        if (e.life <= 0) this.effects.splice(i, 1);
      }
      if (this.effects.length > 360) this.effects.splice(0, this.effects.length - 360);
    }

    _updateParticles(dt) {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - dt * 1.7;
        p.vy *= 1 - dt * 1.7;
        if (p.gravity) p.vy += p.gravity * dt;
        if (p.life <= 0) this.particles.splice(i, 1);
      }
      if (this.particles.length > 520) this.particles.splice(0, this.particles.length - 520);
    }

    _updateFloatTexts(dt) {
      for (let i = this.floatTexts.length - 1; i >= 0; i--) {
        this.floatTexts[i].life -= dt;
        if (this.floatTexts[i].life <= 0) this.floatTexts.splice(i, 1);
      }
    }

    /* ------------------------------------------------------------
       Effects helpers
       ------------------------------------------------------------ */
    _addEffect(effect) {
      if (!effect.maxLife) effect.maxLife = effect.life;
      this.effects.push(effect);
    }

    _addRing(x, y, color, r0, r1, life, width, second, tier) {
      this._addEffect({
        type: 'ring',
        x: x,
        y: y,
        color: color,
        r0: r0,
        r1: r1,
        life: life,
        maxLife: life,
        width: width || 1,
        second: !!second,
        tier: tier || 1,
      });
    }

    _addMuzzle(x, y, angle, color, size, tier) {
      this._addEffect({
        type: 'muzzle',
        x: x + Math.cos(angle) * 0.1,
        y: y + Math.sin(angle) * 0.1,
        color: color,
        life: 0.1,
        maxLife: 0.1,
        size: size || 0.6,
        tier: tier || 1,
      });
    }

    _burst(x, y, color, count, minSpeed, maxSpeed, size, additive) {
      const n = Math.max(0, Math.round(count));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
        this.particles.push({
          x: x,
          y: y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          life: 0.3 + Math.random() * 0.4,
          maxLife: 0.7,
          size: size || 0.025,
          color: color,
          shape: additive && Math.random() > 0.5 ? 'diamond' : 'line',
          gravity: 0,
          alpha: 0.8,
        });
      }
    }

    _float(x, y, text, color, big, life) {
      const span = life || FLOAT_LIFE;
      this.floatTexts.push({
        x: x,
        y: y,
        text: text,
        color: color,
        life: span,
        maxLife: span,
        big: !!big,
      });
    }

    _toast(message, type) {
      this._emit('onToast', { message: message, type: type || 'info' });
    }

    _refreshPaths(reroute) {
      this.field = this.grid.buildField(this.structures);
      this.routes = this.grid.routes(this.field);
      if (reroute) {
        for (let i = 0; i < this.enemies.length; i++) {
          this.enemies[i].reroute = true;
        }
      }
    }

    _play(sound) {
      if (this.audio) this.audio.play(sound);
    }

    _click() {
      if (this.audio) this.audio.play('ui');
    }

    /* ------------------------------------------------------------
       Rendering / lifecycle
       ------------------------------------------------------------ */
    render(now) {
      if (this.disposed) return;
      this.renderer.draw(this, now / 1000);
    }

    resize() {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const hud = document.querySelector('.game-hud');
        const dock = document.getElementById('build-dock');
        let safeTop = 0;
        let safeBottom = 0;
        if (hud) {
          const hr = hud.getBoundingClientRect();
          safeTop = Math.max(0, hr.bottom - rect.top + 14);
        }
        if (dock) {
          const dr = dock.getBoundingClientRect();
          if (dr.height > 0) safeBottom = Math.max(0, rect.bottom - dr.top + 8);
        }
        this.renderer.resize(rect.width, rect.height, { top: safeTop, bottom: safeBottom });
      }
    }

    cellFromClient(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const gx = Math.floor((x - this.renderer.ox) / this.renderer.cell);
      const gy = Math.floor((y - this.renderer.oy) / this.renderer.cell);
      return {
        x: gx,
        y: gy,
        inside: this.grid.inBounds(gx, gy),
      };
    }

    setSpeed(speed) {
      this.speed = speed === 3 ? 3 : speed === 2 ? 2 : 1;
      this._emitStats();
    }

    setPaused(paused) {
      this.paused = !!paused;
      this._emitStats();
    }

    /* ------------------------------------------------------------
       Debug helpers (enabled by the debug panel only)
       ------------------------------------------------------------ */
    setGodMode(value) {
      this.mods.godMode = !!value;
      this._emitStats();
    }

    setFreeBuild(value) {
      this.mods.freeBuild = !!value;
      this._emitSelection();
      this._emitStats();
    }

    debugAddCrystals(amount) {
      const delta = Math.max(0, Math.round(amount || 0));
      this.crystals += delta;
      this._float(this.grid.base.x + 0.5, this.grid.base.y - 0.2, '+' + delta + ' ◇', '#9ffaff', true);
      this._emitStats();
      return this.crystals;
    }

    debugHealCore(amount) {
      const before = this.baseHp;
      this.baseHp = Math.min(this.baseMax, this.baseHp + Math.max(0, amount || 0));
      this._emitStats();
      return Math.round(this.baseHp - before);
    }

    debugKillAll() {
      if (this.phase !== 'wave') return 0;
      let killed = 0;
      let guard = 0;
      while (this.enemies.length && guard++ < 16) {
        const list = this.enemies.slice();
        for (let i = 0; i < list.length; i++) {
          const enemy = list[i];
          if (enemy.dead || enemy.leaked) continue;
          enemy.hp = 0;
          this._killEnemy(enemy, null);
          killed++;
        }
      }
      this.spawnQueue.length = 0;
      this.projectiles.length = 0;
      this.enemies = this.enemies.filter(function (enemy) {
        return !enemy.dead && !enemy.leaked;
      });
      this._emitStats();
      if (this.phase === 'wave' && this.enemies.length === 0) {
        this._completeWave();
      }
      return killed;
    }

    debugSpawn(type, count) {
      if (!C.ENEMIES[type]) return false;
      if (this.phase === 'victory' || this.phase === 'defeat') return false;
      if (this.phase !== 'wave') {
        this.phase = 'wave';
        this.currentWave = Math.max(1, this.currentWave || this.waveCursor || 1);
        this.prepRemaining = 0;
        this.prepWarningEmitted = true;
        this.spawnQueue = [];
        this.killsThisWave = 0;
        this.leaksThisWave = 0;
        this.waveElapsed = 0;
        this._emitPhase();
      }
      const n = U.clamp(Math.round(count || 1), 1, 60);
      const gates = this.grid.gates;
      for (let i = 0; i < n; i++) {
        const gate = gates[this._gateCursor++ % gates.length];
        const path = this.grid.pathFrom(this.field, gate);
        const nodes = path.slice(1).map(function (cell) {
          return { x: cell.x + 0.5, y: cell.y + 0.5 };
        });
        const hpFactor = this.level.hpScale * Math.pow(WAVE_HP_GROWTH, Math.max(0, this.currentWave - 1));
        const enemy = this._makeEnemy(type, {
          x: gate.x + 0.5,
          y: gate.y + 0.5,
          nodes: nodes,
          hpFactor: hpFactor,
          waveNumber: Math.max(1, this.currentWave),
          spawnAnim: 0.4,
        });
        this.enemies.push(enemy);
        this._burst(enemy.x, enemy.y, enemy.def.color, 4, 0.3, 1.2, 0.024, true);
      }
      this._emitStats();
      return true;
    }

    debugNextWave() {
      if (this.phase !== 'prep') return false;
      const wasPaused = this.paused;
      this.paused = false;
      this.prepRemaining = 0;
      const started = this.startWave();
      this.paused = wasPaused;
      this._emitStats();
      return started;
    }

    debugSetPrep(seconds) {
      if (this.phase !== 'prep') return false;
      const value = U.clamp(Number(seconds) || 0, 0, 120);
      this.prepRemaining = value;
      this.prepTotal = Math.max(1, value);
      this._lastPrepSecond = Math.ceil(value);
      this.prepWarningEmitted = false;
      this._emitStats();
      return true;
    }

    debugMaxTowers() {
      let count = 0;
      for (let i = 0; i < this.structures.length; i++) {
        const structure = this.structures[i];
        if (structure.kind !== 'tower' || structure.type === 'beacon') continue;
        const maxLevel = this._towerMaxLevel(structure.type);
        if (structure.level < maxLevel) {
          structure.level = maxLevel;
          count++;
        }
      }
      this._emitSelection();
      this._emitStats();
      return count;
    }

    debugWin() {
      if (this.resultSent) return false;
      this._finishVictory();
      return true;
    }

    debugLose() {
      if (this.resultSent) return false;
      this.baseHp = 0;
      this._defeat();
      return true;
    }

    debugStatus() {
      return {
        phase: this.phase,
        wave: this.currentWave,
        totalWaves: this.totalWaves,
        baseHp: Math.max(0, Math.ceil(this.baseHp)),
        baseMax: this.baseMax,
        crystals: Math.floor(this.crystals),
        enemies: this.enemies.length,
        towers: this._towerCount(),
        godMode: !!this.mods.godMode,
        freeBuild: !!this.mods.freeBuild,
      };
    }

    /* ------------------------------------------------------------
       对局临时存档：波次边界的可序列化快照（跨刷新续战）。
       波内敌人 / 弹道不入档——恢复时从当前波的开头重打；
       晶元与核心完整度同样取波次起点的值，避免读档刷资源。
       ------------------------------------------------------------ */
    exportSnapshot() {
      if (this.phase === 'victory' || this.phase === 'defeat') return null;
      const midWave = this.phase === 'wave' || (this.spawnQueue && this.spawnQueue.length > 0);
      return {
        v: 1,
        levelId: this.level.id,
        waveCursor: midWave ? Math.max(0, this.waveCursor - 1) : this.waveCursor,
        crystals: Math.max(0, Math.round(midWave ? this.waveStartCrystals : this.crystals)),
        baseHp: Math.max(1, Math.round(midWave ? this.waveStartBaseHp : this.baseHp)),
        kills: this.kills,
        leaked: this.leaked,
        structures: this.structures.map(function (s) {
          return { type: s.type, x: s.x, y: s.y, level: s.level };
        }),
      };
    }

    restoreSnapshot(data) {
      data = data || {};
      this.structures = [];
      const self = this;
      (data.structures || []).forEach(function (s) {
        const def = s.type === 'wall' ? C.WALL : C.TOWERS[s.type];
        if (!def) return;
        self.structures.push({
          uid: 's' + self.uid++,
          kind: s.type === 'wall' ? 'wall' : 'tower',
          type: s.type,
          x: s.x,
          y: s.y,
          level: U.clamp(Math.round(s.level || 1), 1, self._towerMaxLevel(s.type)),
          spent: 0,
          cooldown: 0.15,
          angle: -Math.PI / 2,
          recoil: 0,
          firing: 0,
          laserCharge: 0,
          laserIdle: 0,
          laserTargetId: null,
          beamFx: 0,
          idleSeed: Math.random() * TAU,
        });
      });
      this.field = this.grid.buildField(this.structures);
      this.routes = this.grid.routes(this.field);
      this.crystals = Math.max(0, Math.round(data.crystals || 0));
      this.baseHp = U.clamp(Math.round(data.baseHp || this.baseMax), 1, this.baseMax);
      this.waveCursor = U.clamp(Math.round(data.waveCursor || 0), 0, this.totalWaves);
      this.currentWave = this.waveCursor;
      this.kills = Math.max(0, Math.round(data.kills || 0));
      this.leaked = Math.max(0, Math.round(data.leaked || 0));
      this.killsThisWave = 0;
      this.leaksThisWave = 0;
      this.phase = 'prep';
      this.waveElapsed = 0;
      this.prepTotal = PREP_BETWEEN;
      this.prepRemaining = PREP_BETWEEN;
      this.prepWarningEmitted = false;
      this._lastPrepSecond = Math.ceil(PREP_BETWEEN);
      this.spawnQueue = [];
      this.spawnPool = [];
      this.waveStartCrystals = this.crystals;
      this.waveStartBaseHp = this.baseHp;
      this.projectiles.length = 0;
      this.effects.length = 0;
      this.particles.length = 0;
      this.floatTexts.length = 0;
      this.refreshUI();
      this._emitStats();
      this._emitPhase();
    }

    destroy() {
      this.disposed = true;
      this.enemies.length = 0;
      this.projectiles.length = 0;
      this.effects.length = 0;
      this.particles.length = 0;
    }

    /* ------------------------------------------------------------
       Event plumbing
       ------------------------------------------------------------ */
    _emit(name, payload) {
      if (this.disposed) return;
      const fn = this.events[name];
      if (typeof fn === 'function') {
        try {
          fn(payload);
        } catch (error) {
          console.error('[VECTOR] UI event failed:', name, error);
        }
      }
    }

    _emitSelection() {
      this._emit('onSelection', this.getSelectionInfo());
    }

    _emitStats() {
      this.dirty = true;
      this._flushStats();
    }

    _flushStats() {
      if (!this.dirty || this.disposed) return;
      this.dirty = false;
      this._emit('onStats', this.getHudState());
    }

    _emitPhase() {
      this._emit('onPhase', this.getHudState());
      this._emitSelection();
    }
  }

  G.Game = Game;
  G.TOWER_SPECIAL_LABELS = TOWER_SPECIAL_LABELS;
  window.GEOTD_GAME = G;
})();
