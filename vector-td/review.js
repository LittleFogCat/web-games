/* ============================================================
   VECTOR // REVIEW — internal replay dashboard.

   Reads the game's run records (`vector_geotd_records_v1`) and
   optional per-frame replay data, renders a data dashboard and
   plays the run back on the tactical grid.

   This page is a debug tool. It is only linked from the DEBUG
   panel and refuses to run outside local/debug contexts.
   ============================================================ */
(function () {
  'use strict';

  const C = window.GEOTD_CONFIG;
  const P = window.GEOTD_PATH;
  const RECORDS_KEY = 'vector_geotd_records_v1';
  const DEBUG_KEY = 'vector_geotd_debug_v1';

  const $ = function (id) { return document.getElementById(id); };
  const state = {
    runs: [],
    imported: new Set(),
    selectedId: null,
    playing: false,
    speed: 1,
    time: 0,
    maxTime: 1,
    frames: [],
    synthetic: false,
    grid: null,
    raf: 0,
    lastTs: 0,
  };
  const el = {};

  /* ---------------------------------------------------------- utilities */
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(seconds) {
    const s = Math.max(0, Math.round(seconds || 0));
    return Math.floor(s / 60) + ':' + pad2(s % 60);
  }
  function fmtNum(n) {
    if (n == null || !isFinite(n)) return '-';
    const v = Math.round(n * 10) / 10;
    return v.toLocaleString('zh-CN');
  }
  function pct(n) { return Math.round((n || 0) * 100) + '%'; }
  function levelOf(run) {
    return C.LEVELS && C.LEVELS[run.levelId - 1] ? C.LEVELS[run.levelId - 1] : null;
  }
  function enemyDef(index) {
    const id = C.ENEMY_ORDER[index];
    return id ? C.ENEMIES[id] : null;
  }
  function towerDef(type) {
    if (type === 'wall') return C.WALL;
    return C.TOWERS[type] || null;
  }
  function colorOf(type) {
    const def = towerDef(type);
    return def && def.color ? def.color : '#8aa6c8';
  }

  /* -------------------------------------------------------------- gate */
  function debugAllowed() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('debug') === '1' || params.get('debug') === 'true') return true;
    } catch (error) { /* ignore */ }
    const host = window.location.hostname;
    if (window.location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '') {
      return true;
    }
    try {
      return window.localStorage.getItem(DEBUG_KEY) === '1';
    } catch (error) {
      return false;
    }
  }

  /* ----------------------------------------------------------- records */
  function isRecord(value) {
    return value && typeof value === 'object' && value.v === 1 && value.levelId;
  }

  function normalizeRecord(raw) {
    if (!raw || typeof raw !== 'object' || !raw.levelId) return null;
    const record = Object.assign({}, raw);
    record.v = 1;
    record.levelId = parseInt(record.levelId, 10) || 1;
    const level = levelOf(record);
    record.levelCode = record.levelCode || (level ? level.code : 'E1L' + record.levelId);
    record.levelName = record.levelName || (level ? level.name : '');
    record.finishedAt = Number(record.finishedAt) || 0;
    record.startedAt = Number(record.startedAt) || record.finishedAt;
    record.coreHp = Number(record.coreHp) || 0;
    record.coreMax = Number(record.coreMax) || 100;
    record.integrity = record.integrity != null ? Number(record.integrity) : (record.coreHp / Math.max(1, record.coreMax));
    record.kills = Number(record.kills) || 0;
    record.leaked = Number(record.leaked) || 0;
    record.duration = Number(record.duration) || 0;
    record.stars = Number(record.stars) || 0;
    record.startCrystals = Number(record.startCrystals) || 0;
    record.crystalsEarned = Number(record.crystalsEarned) || 0;
    record.crystalsLeft = Number(record.crystalsLeft) || 0;
    record.goldEarned = Number(record.goldEarned) || 0;
    record.buildLog = Array.isArray(record.buildLog) ? record.buildLog : [];
    record.towers = Array.isArray(record.towers) ? record.towers : [];
    record.leaks = Array.isArray(record.leaks) ? record.leaks : [];
    record.waves = Array.isArray(record.waves) ? record.waves : [];
    if (record.replay && !Array.isArray(record.replay.frames)) record.replay = null;
    if (!record.id) {
      record.id = 'imp-' + (record.finishedAt || Date.now()) + '-' + record.levelId + '-' + Math.random().toString(36).slice(2, 7);
    }
    return record;
  }

  function loadLocal() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(RECORDS_KEY);
    } catch (error) {
      raw = null;
    }
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeRecord).filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  function mergeRuns(local, imported) {
    const map = new Map();
    local.forEach(function (run) { map.set(run.id, run); });
    imported.forEach(function (run) { map.set(run.id, run); });
    return Array.from(map.values()).sort(function (a, b) {
      return (b.finishedAt || 0) - (a.finishedAt || 0);
    });
  }

  /* ---------------------------------------------------------- rendering */
  function renderList() {
    el.runs.innerHTML = '';
    el.emptyList.classList.toggle('hidden', state.runs.length > 0);
    el.count.textContent = state.runs.length + ' 局';
    state.runs.forEach(function (run) {
      const win = run.result === 'victory';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rv-run' + (run.id === state.selectedId ? ' active' : '');
      button.dataset.id = run.id;
      const hasReplay = !!(run.replay && run.replay.frames && run.replay.frames.length);
      const date = run.finishedAt ? new Date(run.finishedAt) : null;
      const dateText = date ? (pad2(date.getMonth() + 1) + '/' + pad2(date.getDate()) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes())) : '';
      button.innerHTML =
        '<span class="rv-run-top">' +
          '<span class="rv-run-level">' + escapeHtml(run.levelCode) + '</span>' +
          '<span class="rv-run-result ' + (win ? 'win' : 'lose') + '">' + (win ? (run.stars ? '★'.repeat(run.stars) : '通关') : '失败') + '</span>' +
          (hasReplay ? '<span class="rv-run-badge replay">帧</span>' : '') +
          (state.imported.has(run.id) ? '<span class="rv-run-badge">导入</span>' : '') +
        '</span>' +
        '<span class="rv-run-meta">' + dateText + '</span>' +
        '<span class="rv-run-meta">核心 ' + Math.round(run.coreHp) + '/' + Math.round(run.coreMax) + '</span>' +
        '<span class="rv-run-meta">' + fmtTime(run.duration) + ' · 漏 ' + run.leaked + '</span>';
      button.addEventListener('click', function () { selectRun(run.id); });
      el.runs.appendChild(button);
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function stat(label, value, cls) {
    return '<div class="rv-stat"><div class="rv-stat-label">' + escapeHtml(label) + '</div>' +
      '<div class="rv-stat-value ' + (cls || '') + '">' + value + '</div></div>';
  }

  function skillsText(run) {
    const skills = run.initialSkills || {};
    const ranks = ['core', 'crystal', 'overclock', 'build', 'stasis', 'repair', 'start'];
    const names = { core: '核心', crystal: '晶体', overclock: '超频', build: '建造', stasis: '静滞', repair: '修复', start: '起始' };
    if (ranks.some(function (k) { return typeof skills[k] === 'number' && skills[k] > 0; })) {
      return ranks.filter(function (k) { return skills[k] > 0; }).map(function (k) {
        return names[k] + skills[k];
      }).join(' · ') || '未加点';
    }
    const mods = [];
    if (typeof skills.crystalMult === 'number') mods.push('晶元×' + skills.crystalMult.toFixed(2));
    if (typeof skills.damageMult === 'number') mods.push('伤害×' + skills.damageMult.toFixed(2));
    if (typeof skills.costMult === 'number') mods.push('费用×' + skills.costMult.toFixed(2));
    if (typeof skills.enemySpeedMult === 'number') mods.push('敌速×' + skills.enemySpeedMult.toFixed(2));
    if (typeof skills.startCrystals === 'number' && skills.startCrystals) mods.push('起手+' + skills.startCrystals);
    return mods.join(' · ') || '-';
  }

  function renderSummary(run) {
    const win = run.result === 'victory';
    const core = Math.round(run.coreHp) + '<small>/' + Math.round(run.coreMax) + '</small>';
    el.summary.innerHTML =
      stat('关卡', escapeHtml(run.levelCode + ' ' + (run.levelName || '')), 'cyan') +
      stat('结果', win ? ('通关' + (run.stars ? ' ' + '★'.repeat(run.stars) : '')) : '失败', win ? 'win' : 'lose') +
      stat('核心', core + '<small> ' + pct(run.integrity) + '</small>', run.integrity >= 1 ? 'win' : '') +
      stat('用时', fmtTime(run.duration)) +
      stat('击杀 / 漏怪', run.kills + ' / ' + run.leaked) +
      stat('晶元', run.crystalsLeft + '<small> 余</small>', 'gold') +
      stat('金币', (run.goldEarned || 0) + '<small> +</small>', 'gold') +
      stat('技能', escapeHtml(skillsText(run))) +
      stat('模式', run.debug ? 'DEBUG' : '正式') +
      stat('回放', (run.replay && run.replay.frames && run.replay.frames.length) ? (run.replay.frames.length + ' 帧') : '无逐帧');
  }

  function renderDamage(run) {
    const rows = (run.towers || []).slice().sort(function (a, b) { return (b.damage || 0) - (a.damage || 0); });
    if (!rows.length) {
      el.damage.innerHTML = '<p class="rv-muted">没有逐塔数据。</p>';
      return;
    }
    const max = Math.max(1, rows[0].damage || 0);
    const duration = Math.max(1, run.duration || 1);
    el.damage.innerHTML = rows.map(function (tower) {
      const def = towerDef(tower.type);
      const name = def ? def.name : tower.type;
      const ratio = clamp((tower.damage || 0) / max, 0, 1);
      const dps = (tower.damage || 0) / duration;
      return '<div class="rv-dmg-row">' +
        '<span class="rv-dmg-swatch" style="background:' + colorOf(tower.type) + '"></span>' +
        '<div class="rv-dmg-main">' +
          '<div class="rv-dmg-top"><span class="rv-dmg-name">' + escapeHtml(name) + ' Lv' + (tower.level || 1) +
            (tower.sold ? ' <span class="rv-dmg-sold">(回收)</span>' : '') +
            ' <span class="rv-muted">(' + tower.x + ',' + tower.y + ')</span></span>' +
            '<span class="rv-dmg-num">' + fmtNum(tower.damage) + '</span></div>' +
          '<div class="rv-dmg-bar"><div class="rv-dmg-fill" style="width:' + (ratio * 100).toFixed(1) + '%"></div></div>' +
          '<div class="rv-dmg-sub">盾 ' + fmtNum(tower.shieldDamage) + ' · 杀 ' + (tower.kills || 0) + ' · DPS ' + dps.toFixed(1) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderBuild(run) {
    const log = (run.buildLog || []).slice().sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
    el.buildCount.textContent = log.length + ' 条';
    if (!log.length) {
      el.build.innerHTML = '<p class="rv-muted">没有建造日志。</p>';
      return;
    }
    const rows = log.map(function (entry) {
      const def = entry.type === 'wall' ? C.WALL : C.TOWERS[entry.type];
      const name = def ? def.name : entry.type;
      const actionKey = entry.action === 'upgrade' ? 'upgrade' : entry.action === 'sell' ? 'sell' : 'build';
      const action = actionKey === 'build' ? '建造' : actionKey === 'upgrade' ? '升级' : '回收';
      const cost = actionKey === 'sell' ? ('+' + (entry.refund || 0)) : ('-' + (entry.cost || 0));
      return '<tr>' +
        '<td>' + fmtTime(entry.t || 0) + '</td>' +
        '<td class="num">' + (entry.wave || '-') + '</td>' +
        '<td class="' + actionKey + '">' + action + '</td>' +
        '<td>' + escapeHtml(name) + '</td>' +
        '<td class="num">Lv' + (entry.level || 1) + '</td>' +
        '<td class="num">' + (entry.x != null ? entry.x + ',' + entry.y : '-') + '</td>' +
        '<td class="num">' + cost + '</td>' +
      '</tr>';
    }).join('');
    el.build.innerHTML = '<table class="rv-table"><thead><tr>' +
      '<th>时间</th><th class="num">波</th><th>动作</th><th>设施</th><th class="num">等级</th><th class="num">坐标</th><th class="num">费用</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderLeaks(run) {
    const leaks = run.leaks || [];
    el.leakCount.textContent = leaks.length + ' 只';
    if (!leaks.length) {
      el.leaks.innerHTML = '<p class="rv-muted">没有漏怪。</p>';
      return;
    }
    const rows = leaks.map(function (leak) {
      return '<tr>' +
        '<td>' + fmtTime(leak.t || 0) + '</td>' +
        '<td class="num">' + (leak.wave || '-') + '</td>' +
        '<td class="leak">' + escapeHtml(leak.name || leak.type || '-') + '</td>' +
        '<td class="num">' + (leak.damage || 0) + '</td>' +
        '<td class="num">' + (leak.coreHp != null ? leak.coreHp : '-') + '</td>' +
      '</tr>';
    }).join('');
    el.leaks.innerHTML = '<table class="rv-table"><thead><tr>' +
      '<th>时间</th><th class="num">波</th><th>敌人</th><th class="num">核心伤害</th><th class="num">剩余</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  /* ------------------------------------------------------------- frames */
  function syntheticFrames(run) {
    const frames = [];
    let t = 0;
    let kills = 0;
    let leaks = 0;
    frames.push({ t: 0, w: 1, hp: run.coreMax || 100, cr: run.startCrystals || 0, k: 0, l: 0, e: [] });
    (run.waves || []).forEach(function (wave) {
      t += Number(wave.duration) || 0;
      kills = Number(wave.cumKills != null ? wave.cumKills : (kills + (wave.kills || 0)));
      leaks = Number(wave.cumLeaks != null ? wave.cumLeaks : (leaks + (wave.leaks || 0)));
      frames.push({
        t: Math.round(t * 10) / 10,
        w: wave.wave || frames.length,
        hp: wave.endCoreHp != null ? wave.endCoreHp : run.coreHp,
        cr: wave.endCrystals != null ? wave.endCrystals : run.crystalsLeft,
        k: kills,
        l: leaks,
        e: [],
      });
    });
    if (frames.length === 1) frames[0].t = Math.max(1, run.duration || 1);
    return frames;
  }

  function prepareFrames(run) {
    const replay = run.replay;
    if (replay && Array.isArray(replay.frames) && replay.frames.length) {
      state.frames = replay.frames.slice().sort(function (a, b) { return a.t - b.t; });
      state.synthetic = false;
    } else {
      state.frames = syntheticFrames(run);
      state.synthetic = true;
    }
    state.maxTime = Math.max(1, state.frames[state.frames.length - 1].t || run.duration || 1);
    state.time = 0;
  }

  function frameAt(time) {
    const frames = state.frames;
    if (!frames.length) return null;
    let lo = 0;
    let hi = frames.length - 1;
    let best = frames[0];
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].t <= time + 1e-6) { best = frames[mid]; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best;
  }

  function structuresAt(run, time) {
    const log = (run.buildLog || []).slice().sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
    if (!log.length) {
      return (run.towers || []).filter(function (s) { return !s.sold; }).map(function (s) {
        return { type: s.type, level: s.level || 1, x: s.x, y: s.y, kind: s.type === 'wall' ? 'wall' : 'tower' };
      });
    }
    const list = [];
    for (const entry of log) {
      if ((entry.t || 0) > time + 1e-6) break;
      if (entry.action === 'build') {
        list.push({ type: entry.type, level: entry.level || 1, x: entry.x, y: entry.y, kind: entry.kind || (entry.type === 'wall' ? 'wall' : 'tower') });
      } else if (entry.action === 'upgrade') {
        const target = list.find(function (s) { return s.x === entry.x && s.y === entry.y; });
        if (target) target.level = entry.level || target.level;
      } else if (entry.action === 'sell') {
        const index = list.findIndex(function (s) { return s.x === entry.x && s.y === entry.y; });
        if (index >= 0) list.splice(index, 1);
      }
    }
    return list;
  }

  /* --------------------------------------------------------------- arena */
  function resizeCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, width: width, height: height };
  }

  function drawArena() {
    if (!el.canvas || !state.selectedId) return;
    const run = state.runs.find(function (r) { return r.id === state.selectedId; });
    const level = run && levelOf(run);
    if (!run || !level) return;
    const surface = resizeCanvas(el.canvas);
    const ctx = surface.ctx;
    const w = surface.width;
    const h = surface.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#03070d';
    ctx.fillRect(0, 0, w, h);

    const cell = Math.min(w / 9, h / 16);
    const ox = (w - cell * 9) / 2;
    const oy = (h - cell * 16) / 2;
    if (!state.grid || state.grid.level !== level) state.grid = new P.BattleGrid(level);
    const grid = state.grid;
    const parsed = C.parseLevel(level);
    const rocks = new Set(parsed.rocks.map(function (r) { return r.x + ',' + r.y; }));
    const gates = new Set(parsed.gates.map(function (g) { return g.x + ',' + g.y; }));
    const base = parsed.base;
    const structures = structuresAt(run, state.time);

    let pathCells = new Set();
    try {
      const field = grid.buildField(structures.map(function (s) { return { x: s.x, y: s.y }; }));
      const routes = grid.routes(field);
      routes.forEach(function (route) {
        route.path.forEach(function (c) { pathCells.add(c.x + ',' + c.y); });
      });
    } catch (error) { /* old/invalid layout: draw without a path */ }

    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 9; x++) {
        const px = ox + x * cell;
        const py = oy + y * cell;
        const key = x + ',' + y;
        ctx.fillStyle = 'rgba(12, 22, 38, 0.55)';
        ctx.fillRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
        if (pathCells.has(key)) {
          ctx.fillStyle = 'rgba(94, 242, 255, 0.10)';
          ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
          ctx.strokeStyle = 'rgba(94, 242, 255, 0.22)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 1.5, py + 1.5, cell - 3, cell - 3);
        }
        if (rocks.has(key)) {
          ctx.fillStyle = '#1b2638';
          ctx.strokeStyle = 'rgba(150, 180, 215, 0.35)';
          ctx.beginPath();
          ctx.moveTo(px + cell * 0.2, py + cell * 0.7);
          ctx.lineTo(px + cell * 0.42, py + cell * 0.2);
          ctx.lineTo(px + cell * 0.8, py + cell * 0.28);
          ctx.lineTo(px + cell * 0.88, py + cell * 0.74);
          ctx.lineTo(px + cell * 0.5, py + cell * 0.88);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    gates.forEach(function (key) {
      const parts = key.split(',').map(Number);
      const px = ox + parts[0] * cell;
      const py = oy + parts[1] * cell;
      ctx.fillStyle = 'rgba(255, 93, 122, 0.85)';
      ctx.fillRect(px + cell * 0.22, py + cell * 0.22, cell * 0.56, cell * 0.56);
    });
    if (base) {
      const px = ox + base.x * cell;
      const py = oy + base.y * cell;
      ctx.fillStyle = 'rgba(94, 242, 255, 0.9)';
      ctx.beginPath();
      ctx.moveTo(px + cell * 0.5, py + cell * 0.18);
      ctx.lineTo(px + cell * 0.82, py + cell * 0.5);
      ctx.lineTo(px + cell * 0.5, py + cell * 0.82);
      ctx.lineTo(px + cell * 0.18, py + cell * 0.5);
      ctx.closePath();
      ctx.fill();
    }

    structures.forEach(function (structure) {
      const px = ox + structure.x * cell;
      const py = oy + structure.y * cell;
      if (structure.kind === 'wall' || structure.type === 'wall') {
        ctx.fillStyle = 'rgba(138, 166, 200, 0.55)';
        ctx.fillRect(px + cell * 0.12, py + cell * 0.12, cell * 0.76, cell * 0.76);
        ctx.strokeStyle = 'rgba(223, 239, 255, 0.5)';
        ctx.strokeRect(px + cell * 0.12, py + cell * 0.12, cell * 0.76, cell * 0.76);
        return;
      }
      const def = towerDef(structure.type);
      const color = colorOf(structure.type);
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px + cell * 0.5, py + cell * 0.5, cell * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (structure.type === 'beacon') {
        ctx.strokeStyle = 'rgba(94, 242, 255, 0.3)';
        ctx.beginPath();
        ctx.arc(px + cell * 0.5, py + cell * 0.5, cell * 0.45, 0, Math.PI * 2);
        ctx.stroke();
      }
      const lv = clamp(structure.level || 1, 1, 5);
      ctx.fillStyle = '#03070d';
      ctx.font = 'bold ' + Math.max(7, Math.round(cell * 0.28)) + 'px ' + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(lv), px + cell * 0.5, py + cell * 0.52);
    });

    const frame = frameAt(state.time);
    if (frame && !state.synthetic) {
      (frame.e || []).forEach(function (entry) {
        const def = enemyDef(entry[0]);
        if (!def) return;
        const ex = ox + entry[1] * cell;
        const ey = oy + entry[2] * cell;
        const hp = entry[4] ? clamp(entry[3] / entry[4], 0, 1) : 1;
        const radius = Math.max(2, (def.radius || 0.22) * cell);
        ctx.globalAlpha = entry[6] && !entry[7] ? 0.45 : 1;
        ctx.fillStyle = def.color || '#ffffff';
        ctx.beginPath();
        ctx.arc(ex, ey, radius, 0, Math.PI * 2);
        ctx.fill();
        if (entry[6] && !entry[7]) {
          ctx.setLineDash([2, 3]);
          ctx.strokeStyle = def.color || '#ffffff';
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (entry[5] > 0) {
          ctx.strokeStyle = 'rgba(111, 231, 255, 0.8)';
          ctx.beginPath();
          ctx.arc(ex, ey, radius + 2, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(ex - radius, ey - radius - 4, radius * 2, 2.5);
        ctx.fillStyle = hp > 0.5 ? '#7df4c6' : hp > 0.2 ? '#ffcf6e' : '#ff5d7a';
        ctx.fillRect(ex - radius, ey - radius - 4, radius * 2 * hp, 2.5);
      });
    }

    const hudFrame = frame || { w: 0, hp: run.coreMax, cr: run.startCrystals };
    ctx.fillStyle = 'rgba(5, 10, 18, 0.78)';
    ctx.fillRect(ox + 4, oy + 4, cell * 4.2, cell * 1.45);
    ctx.fillStyle = '#d8e8f7';
    ctx.font = '600 ' + Math.max(9, Math.round(cell * 0.3)) + 'px ' + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(run.levelCode, ox + 8, oy + 7);
    ctx.fillStyle = '#7d93ab';
    ctx.font = Math.max(8, Math.round(cell * 0.24)) + 'px ' + getComputedStyle(document.body).fontFamily;
    ctx.fillText('W' + (hudFrame.w || '-') + ' · ' + fmtTime(state.time), ox + 8, oy + cell * 0.55);
    ctx.fillStyle = '#5ef2ff';
    ctx.fillText('核心 ' + Math.round(hudFrame.hp) + '/' + Math.round(run.coreMax), ox + 8, oy + cell * 0.95);
    ctx.fillStyle = '#ffcf6e';
    ctx.fillText('晶元 ' + Math.round(hudFrame.cr || 0), ox + cell * 2.15, oy + cell * 0.95);
  }

  /* ---------------------------------------------------------------- chart */
  function drawChart() {
    if (!el.chart || !state.selectedId) return;
    const run = state.runs.find(function (r) { return r.id === state.selectedId; });
    if (!run) return;
    const surface = resizeCanvas(el.chart);
    const ctx = surface.ctx;
    const w = surface.width;
    const h = surface.height;
    ctx.clearRect(0, 0, w, h);
    const padL = 40;
    const padR = 52;
    const padT = 16;
    const padB = 24;
    const plotW = Math.max(1, w - padL - padR);
    const plotH = Math.max(1, h - padT - padB);
    const waves = run.waves || [];
    const points = [];
    points.push({ x: 0, core: (run.coreMax || 100) / Math.max(1, run.coreMax || 100), crystals: run.startCrystals || 0 });
    waves.forEach(function (wave, index) {
      points.push({
        x: (index + 1) / Math.max(1, waves.length),
        core: (wave.endCoreHp != null ? wave.endCoreHp : run.coreHp) / Math.max(1, run.coreMax || 100),
        crystals: wave.endCrystals != null ? wave.endCrystals : run.crystalsLeft,
        leak: (wave.leaks || 0) > 0,
        wave: wave.wave,
      });
    });
    const maxCrystals = Math.max(1, run.crystalsEarned || run.crystalsLeft || 0, run.startCrystals || 0);
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.12)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + plotH * (i / 4);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.35)';
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();
    ctx.fillStyle = '#7d93ab';
    ctx.font = '10px ' + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const y = padT + plotH * (i / 4);
      ctx.fillText(Math.round(100 - i * 25) + '%', padL - 6, y);
    }
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const y = padT + plotH * (i / 4);
      ctx.fillStyle = 'rgba(255, 207, 110, 0.75)';
      ctx.fillText(Math.round(maxCrystals * (1 - i / 4)), padL + plotW + 6, y);
    }
    if (points.length > 1) {
      ctx.strokeStyle = '#5ef2ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      points.forEach(function (p, i) {
        const x = padL + p.x * plotW;
        const y = padT + (1 - clamp(p.core, 0, 1)) * plotH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 207, 110, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      points.forEach(function (p, i) {
        const x = padL + p.x * plotW;
        const y = padT + (1 - clamp(p.crystals / maxCrystals, 0, 1)) * plotH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      points.forEach(function (p) {
        if (!p.leak) return;
        const x = padL + p.x * plotW;
        ctx.fillStyle = '#ff5d7a';
        ctx.beginPath();
        ctx.arc(x, padT + plotH - 4, 2.6, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    const cursor = clamp(state.time / Math.max(1, state.maxTime), 0, 1);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padL + cursor * plotW, padT);
    ctx.lineTo(padL + cursor * plotW, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#7d93ab';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('核心', padL + 2, padT + plotH + 16);
    ctx.fillStyle = '#ffcf6e';
    ctx.fillText('晶元', padL + 40, padT + plotH + 16);
  }

  /* ------------------------------------------------------------- playback */
  function updatePlaybackUI() {
    if (!el.seek) return;
    el.seek.max = String(state.maxTime);
    el.seek.value = String(state.time);
    el.time.textContent = fmtTime(state.time) + ' / ' + fmtTime(state.maxTime);
    el.play.textContent = state.playing ? '❚❚ 暂停' : '▶ 播放';
    el.speed.textContent = state.speed + '×';
    el.arenaNote.textContent = state.synthetic ? '旧记录：仅波次 / 建造时间线' : (state.frames.length + ' 帧逐秒回放');
    drawArena();
    drawChart();
  }

  function tick(ts) {
    if (!state.playing) return;
    if (!state.lastTs) state.lastTs = ts;
    const dt = Math.min(0.2, (ts - state.lastTs) / 1000);
    state.lastTs = ts;
    state.time = Math.min(state.maxTime, state.time + dt * state.speed);
    if (state.time >= state.maxTime) {
      state.playing = false;
      state.lastTs = 0;
      updatePlaybackUI();
      return;
    }
    updatePlaybackUI();
    state.raf = requestAnimationFrame(tick);
  }

  function play() {
    if (state.time >= state.maxTime) state.time = 0;
    state.playing = true;
    state.lastTs = 0;
    cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(tick);
    updatePlaybackUI();
  }

  function pause() {
    state.playing = false;
    state.lastTs = 0;
    cancelAnimationFrame(state.raf);
    updatePlaybackUI();
  }

  function selectRun(id) {
    const run = state.runs.find(function (r) { return r.id === id; });
    if (!run) return;
    pause();
    state.selectedId = id;
    renderList();
    el.empty.classList.add('hidden');
    el.content.classList.remove('hidden');
    renderSummary(run);
    renderDamage(run);
    renderBuild(run);
    renderLeaks(run);
    prepareFrames(run);
    renderList();
    updatePlaybackUI();
  }

  /* ---------------------------------------------------------------- import */
  function ingestObject(value) {
    const list = [];
    if (Array.isArray(value)) {
      value.forEach(function (item) { list.push(item); });
    } else if (value && Array.isArray(value.records)) {
      value.records.forEach(function (item) { list.push(item); });
    } else if (value && value.record) {
      list.push(value.record);
    } else if (value && value.v === 1) {
      list.push(value);
    }
    const added = [];
    for (const item of list) {
      const record = normalizeRecord(item);
      if (!record) continue;
      state.imported.add(record.id);
      added.push(record);
    }
    if (!added.length) return 0;
    state.runs = mergeRuns(loadLocal(), added);
    renderList();
    if (!state.selectedId && added.length) selectRun(added[0].id);
    return added.length;
  }

  function readFiles(files) {
    Array.from(files || []).forEach(function (file) {
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const parsed = JSON.parse(String(reader.result));
          const count = ingestObject(parsed);
          if (!count) {
            alert('文件里没有可识别的闯关记录：' + file.name);
          }
        } catch (error) {
          alert('JSON 解析失败：' + file.name);
        }
      };
      reader.readAsText(file);
    });
  }

  /* ----------------------------------------------------------------- init */
  function cache() {
    el.runs = $('rv-runs');
    el.emptyList = $('rv-empty-list');
    el.count = $('rv-count');
    el.empty = $('rv-empty');
    el.content = $('rv-content');
    el.summary = $('rv-summary');
    el.canvas = $('rv-canvas');
    el.chart = $('rv-chart');
    el.damage = $('rv-damage');
    el.build = $('rv-build');
    el.buildCount = $('rv-build-count');
    el.leaks = $('rv-leaks');
    el.leakCount = $('rv-leak-count');
    el.play = $('rv-play');
    el.speed = $('rv-speed');
    el.seek = $('rv-seek');
    el.time = $('rv-time');
    el.reset = $('rv-reset');
    el.arenaNote = $('rv-arena-note');
    el.file = $('rv-file');
    el.refresh = $('rv-refresh');
    el.gate = $('rv-gate');
  }

  function bind() {
    el.play.addEventListener('click', function () { state.playing ? pause() : play(); });
    el.speed.addEventListener('click', function () {
      state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 4 : 1;
      updatePlaybackUI();
    });
    el.seek.addEventListener('input', function () {
      state.time = clamp(parseFloat(el.seek.value) || 0, 0, state.maxTime);
      updatePlaybackUI();
    });
    el.reset.addEventListener('click', function () {
      pause();
      state.time = 0;
      updatePlaybackUI();
    });
    el.refresh.addEventListener('click', function () {
      state.runs = mergeRuns(loadLocal(), state.runs.filter(function (r) { return state.imported.has(r.id); }));
      renderList();
      if (state.selectedId && !state.runs.some(function (r) { return r.id === state.selectedId; })) {
        state.selectedId = null;
        el.content.classList.add('hidden');
        el.empty.classList.remove('hidden');
      }
    });
    el.file.addEventListener('change', function () {
      readFiles(el.file.files);
      el.file.value = '';
    });
    window.addEventListener('resize', function () { drawArena(); drawChart(); });
    document.addEventListener('keydown', function (event) {
      if (event.target && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        state.playing ? pause() : play();
      }
    });
  }

  function init() {
    cache();
    if (!debugAllowed()) {
      el.gate.classList.remove('hidden');
      return;
    }
    bind();
    state.runs = loadLocal();
    renderList();
    if (state.runs.length) {
      selectRun(state.runs[0].id);
    } else {
      el.empty.classList.remove('hidden');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
