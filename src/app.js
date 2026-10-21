/* ============================================================
   VECTOR // 矢界防线 — application shell and meta progression.
   ============================================================ */
(function () {
  'use strict';

  const C = window.GEOTD_CONFIG;
  const U = window.GEOTD_UTIL;
  const GFX = window.GEOTD_GFX;
  const GAME = window.GEOTD_GAME;
  const SAVE_KEY = 'vector_geotd_save_v1';

  const BUILD_SHORT = {
    prism: '箭塔',
    gatling: '机炮',
    cannon: '重炮',
    laser: '激光',
    shock: '震荡',
    frost: '冰霜',
    tesla: '电弧',
    wall: '壁垒',
  };

  const BUILD_KEYS = {
    prism: '1',
    gatling: '2',
    cannon: '3',
    laser: '4',
    shock: '5',
    frost: '6',
    tesla: '7',
    wall: 'W',
  };

  const $ = function (id) {
    return document.getElementById(id);
  };

  const $$ = function (selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  };

  function gemSvg(cls) {
    return '<svg class="ico ' + (cls || 'ico-crystal') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 7 6-7 12L5 9z"/><path d="M5 9h14M12 3v18"/></svg>';
  }

  function goldSvg() {
    return '<svg class="ico ico-gold" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 9v6l8 6 8-6V9z"/><path d="M12 7v10M8 11h8"/></svg>';
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function defaultSave() {
    const skills = {};
    for (let i = 0; i < C.SKILLS.length; i++) skills[C.SKILLS[i].id] = 0;
    return {
      version: 1,
      gold: 0,
      skills: skills,
      unlocked: 1,
      bestStars: {},
      settings: { sound: true },
      tutorialSeen: false,
    };
  }

  function loadSave() {
    const defaults = defaultSave();
    let raw = null;
    try {
      raw = window.localStorage.getItem(SAVE_KEY);
    } catch (error) {
      raw = null;
    }
    if (!raw) return defaults;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return defaults;
      const merged = defaults;
      merged.gold = Math.max(0, Math.floor(Number(parsed.gold) || 0));
      merged.unlocked = U.clamp(Math.floor(Number(parsed.unlocked) || 1), 1, C.LEVELS.length);
      merged.tutorialSeen = !!parsed.tutorialSeen;
      merged.settings.sound = parsed.settings && parsed.settings.sound === false ? false : true;
      if (parsed.skills && typeof parsed.skills === 'object') {
        for (let i = 0; i < C.SKILLS.length; i++) {
          const id = C.SKILLS[i].id;
          merged.skills[id] = U.clamp(Math.floor(Number(parsed.skills[id]) || 0), 0, C.SKILL_MAX);
        }
      }
      if (parsed.bestStars && typeof parsed.bestStars === 'object') {
        for (let id = 1; id <= C.LEVELS.length; id++) {
          const stars = U.clamp(Math.floor(Number(parsed.bestStars[id]) || 0), 0, 3);
          if (stars > 0) merged.bestStars[id] = stars;
        }
      }
      let derivedUnlock = 1;
      for (let id = 1; id <= C.LEVELS.length; id++) {
        if (merged.bestStars[id]) derivedUnlock = Math.min(C.LEVELS.length, id + 1);
      }
      merged.unlocked = Math.max(merged.unlocked, derivedUnlock);
      return merged;
    } catch (error) {
      return defaults;
    }
  }

  const save = loadSave();
  const audio = new window.NeoAudio(save.settings.sound);

  let activeScreen = 'home';
  let currentGame = null;
  let currentLevelId = null;
  let gameSpeed = 1;
  let deploymentPromptShown = false;
  let skillsReturn = 'home';
  let resultAction = 'levels';
  let resultSummary = null;
  let autoPausedForRotation = false;
  let arenaToastTimer = 0;
  let legendTimer = 0;
  let levelIntroTimer = 0;
  let helpLastFocus = null;
  let lastFrame = performance.now();
  let globalToastEl = null;
  let globalToastTimer = 0;
  let onboardingPause = false;

  const els = {
    screens: {},
    ambient: $('ambient-canvas'),
    homeCore: $('home-core-canvas'),
    skillHero: $('skill-hero-canvas'),
    resultCanvas: $('result-canvas'),
    levelList: $('level-list'),
    skillList: $('skill-list'),
    buildHead: $('build-head'),
    buildCapacity: $('build-capacity'),
    buildCapacityCurrent: $('build-capacity-current'),
    buildCapacityTotal: $('build-capacity-total'),
    buildDock: $('build-dock'),
    buildDockCapacity: $('build-dock-capacity'),
    buildDockCost: $('build-dock-cost'),
    buildList: $('build-list'),
    gameCanvas: $('game-canvas'),
    arenaWrap: $('arena-wrap'),
    arenaFrame: $('arena-frame'),
    levelIntro: $('level-intro'),
    pauseOverlay: $('pause-overlay'),
    pauseBar: $('pause-bar'),
    pauseButton: $('btn-game-pause'),
    resultOverlay: $('result-overlay'),
    onboarding: $('onboarding'),
    helpModal: $('help-modal'),
    intelPanel: $('intel-panel'),
    intelContent: $('intel-content'),
    arenaToast: $('arena-toast'),
    waveBanner: $('wave-banner'),
    waveBannerKicker: $('wave-banner-kicker'),
    waveBannerTitle: $('wave-banner-title'),
    waveBannerSub: $('wave-banner-sub'),
    coreFill: $('hud-core-fill'),
    coreBar: document.querySelector('.hud-core-line'),
    coreValue: $('hud-core-value'),
    coreDelta: $('hud-core-delta'),
    coreStat: document.querySelector('.hud-inline-core'),
    crystals: $('hud-crystals'),
    crystalDelta: $('hud-crystal-delta'),
    wave: $('hud-wave'),
    waveStatus: $('wave-status'),
    waveStatusKicker: $('wave-status-kicker'),
    waveStatusValue: $('wave-status-value'),
    waveStatusProgress: $('wave-status-progress'),
    speedLabel: $('speed-label'),
    gameScreen: $('screen-game'),
    placementLegend: $('placement-legend'),
    skillsGoldBig: $('skills-gold-big'),
    helpEnemyList: $('help-enemy-list'),
  };

  ['home', 'levels', 'skills', 'game'].forEach(function (name) {
    els.screens[name] = $('screen-' + name);
  });

  /* ============================================================
     Ambient starfield
     ============================================================ */
  const ambient = (function () {
    const canvas = els.ambient;
    const ctx = canvas.getContext('2d');
    let w = 0;
    let h = 0;
    let dpr = 1;
    let stars = [];
    let constellations = [];
    let shards = [];
    let meteors = [];
    let nextMeteor = 3;

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      generate();
    }

    function generate() {
      const rng = U.mulberry32(U.hashString('ambient-' + Math.round(w) + 'x' + Math.round(h)));
      const count = Math.round((w * h) / 13500) + 52;
      stars = [];
      for (let i = 0; i < count; i++) {
        stars.push({
          x: rng() * w,
          y: rng() * h,
          r: 0.35 + rng() * (rng() > 0.93 ? 1.5 : 0.85),
          base: 0.1 + rng() * 0.35,
          phase: rng() * Math.PI * 2,
          speed: 0.2 + rng() * 1.1,
          warm: rng() > 0.9,
        });
      }
      constellations = [];
      for (let c = 0; c < 4; c++) {
        const px = 0.1 + rng() * 0.8;
        const py = 0.1 + rng() * 0.8;
        const nodes = [];
        for (let n = 0; n < 4; n++) {
          nodes.push({
            x: (px + (rng() - 0.5) * 0.18) * w,
            y: (py + (rng() - 0.5) * 0.2) * h,
          });
        }
        constellations.push(nodes);
      }
      shards = [];
      for (let i = 0; i < 8; i++) {
        shards.push({
          x: rng() * w,
          y: rng() * h,
          length: 12 + rng() * 42,
          angle: -0.6 + rng() * 0.3,
          speed: 1.5 + rng() * 3.5,
          phase: rng() * 10,
          alpha: 0.04 + rng() * 0.08,
        });
      }
      nextMeteor = 3 + Math.random() * 7;
    }

    function draw(time) {
      if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);
      ctx.save();

      // Faint drifting geometric architecture.
      const cx = w * 0.76;
      const cy = h * 0.2;
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = 'rgba(85, 210, 240, 0.055)';
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(time * 0.008 * (i + 1) + i * 0.7);
        ctx.beginPath();
        U.polygon(ctx, 0, 0, Math.min(w, h) * (0.24 + i * 0.07), i === 1 ? 3 : 6, i * 0.3);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.translate(w * 0.16, h * 0.78);
      ctx.rotate(-time * 0.01);
      ctx.strokeStyle = 'rgba(145, 110, 255, 0.06)';
      ctx.beginPath();
      U.polygon(ctx, 0, 0, Math.min(w, h) * 0.28, 4, Math.PI / 4);
      ctx.stroke();
      ctx.beginPath();
      U.polygon(ctx, 0, 0, Math.min(w, h) * 0.36, 4, 0);
      ctx.stroke();
      ctx.restore();

      // Constellation threads.
      for (let c = 0; c < constellations.length; c++) {
        const nodes = constellations[c];
        ctx.strokeStyle = 'rgba(94, 242, 255, 0.035)';
        ctx.lineWidth = 0.55;
        ctx.beginPath();
        for (let n = 0; n < nodes.length; n++) {
          if (n === 0) ctx.moveTo(nodes[n].x, nodes[n].y);
          else ctx.lineTo(nodes[n].x, nodes[n].y);
        }
        ctx.stroke();
        for (let n = 0; n < nodes.length; n++) {
          ctx.fillStyle = 'rgba(165, 240, 255, 0.16)';
          ctx.beginPath();
          ctx.arc(nodes[n].x, nodes[n].y, 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Stars.
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const twinkle = 0.72 + Math.sin(time * s.speed + s.phase) * 0.28;
        ctx.fillStyle = s.warm
          ? 'rgba(255, 210, 150,' + s.base * twinkle + ')'
          : 'rgba(165, 234, 255,' + s.base * twinkle + ')';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        if (s.r > 1.2) {
          ctx.strokeStyle = 'rgba(170, 240, 255,' + s.base * 0.25 * twinkle + ')';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(s.x - 4, s.y);
          ctx.lineTo(s.x + 4, s.y);
          ctx.moveTo(s.x, s.y - 4);
          ctx.lineTo(s.x, s.y + 4);
          ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = 'source-over';

      // Drifting orbital debris lines.
      for (let i = 0; i < shards.length; i++) {
        const sh = shards[i];
        const x = (sh.x + time * sh.speed * 4) % (w + 120) - 60;
        const y = sh.y + Math.sin(time * 0.14 + sh.phase) * 10;
        ctx.strokeStyle = 'rgba(117, 196, 225,' + sh.alpha + ')';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(sh.angle) * sh.length, y + Math.sin(sh.angle) * sh.length);
        ctx.stroke();
      }

      // Occasional meteors.
      if (time > nextMeteor) {
        meteors.push({
          x: w * (0.2 + Math.random() * 0.8),
          y: -20,
          vx: -160 - Math.random() * 200,
          vy: 120 + Math.random() * 110,
          life: 1.4,
          maxLife: 1.4,
        });
        nextMeteor = time + 5 + Math.random() * 12;
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.life -= 1 / 60;
        m.x += m.vx / 60;
        m.y += m.vy / 60;
        const a = Math.max(0, m.life / m.maxLife);
        const grad = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 0.16, m.y - m.vy * 0.16);
        grad.addColorStop(0, 'rgba(210,252,255,' + a * 0.5 + ')');
        grad.addColorStop(1, 'rgba(210,252,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x - m.vx * 0.16, m.y - m.vy * 0.16);
        ctx.stroke();
        if (m.life <= 0 || m.x < -100 || m.y > h + 100) meteors.splice(i, 1);
      }

      ctx.restore();
    }

    return { resize: resize, draw: draw };
  })();

  /* ============================================================
     Helpers and meta progression
     ============================================================ */
  function persist() {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch (error) {
      // Storage is a convenience; the game remains playable without it.
    }
  }

  function totalStars() {
    let total = 0;
    for (let id in save.bestStars) {
      if (Object.prototype.hasOwnProperty.call(save.bestStars, id)) total += save.bestStars[id] || 0;
    }
    return total;
  }

  function clearedCount() {
    let total = 0;
    for (let id = 1; id <= C.LEVELS.length; id++) {
      if ((save.bestStars[id] || 0) > 0) total++;
    }
    return total;
  }

  function computeMods() {
    return {
      baseHp: (save.skills.core || 0) * 15,
      crystalMult: 1 + (save.skills.crystal || 0) * 0.1,
      damageMult: 1 + (save.skills.overclock || 0) * 0.06,
      costMult: 1 - (save.skills.build || 0) * 0.05,
      enemySpeedMult: 1 - (save.skills.stasis || 0) * 0.03,
      repair: (save.skills.repair || 0) * 5,
      startCrystals: (save.skills.start || 0) * 30,
    };
  }

  function skillEffectText(skill, rank) {
    if (rank <= 0) return '尚未激活';
    if (skill.id === 'core') return '+' + rank * skill.per + ' 完整度';
    if (skill.id === 'repair') return '+' + rank * skill.per + ' / 波';
    if (skill.id === 'start') return '+' + rank * skill.per + ' 晶元';
    return '+' + rank * skill.per + '%';
  }

  function refreshMeta() {
    const gold = U.formatInt(save.gold);
    $$('[data-gold]').forEach(function (el) {
      el.textContent = gold;
    });
    $$('[data-stars]').forEach(function (el) {
      el.textContent = totalStars();
    });
    $$('[data-progress]').forEach(function (el) {
      el.textContent = clearedCount() + ' / ' + C.LEVELS.length;
    });
    $$('[data-sector-progress]').forEach(function (el) {
      el.textContent = pad2(Math.min(save.unlocked, C.LEVELS.length));
    });
    if (els.skillsGoldBig) els.skillsGoldBig.textContent = U.formatInt(save.gold);
    refreshSoundButtons();
  }

  function refreshSoundButtons() {
    $$('.sound-button').forEach(function (button) {
      button.classList.toggle('muted', !save.settings.sound);
      button.setAttribute('aria-label', save.settings.sound ? '关闭音效' : '开启音效');
    });
  }

  function toggleSound() {
    save.settings.sound = !save.settings.sound;
    audio.setEnabled(save.settings.sound);
    if (save.settings.sound) {
      audio.ensure();
      audio.play('ui');
    }
    persist();
    refreshSoundButtons();
  }

  function showScreen(name) {
    activeScreen = name;
    Object.keys(els.screens).forEach(function (key) {
      const screen = els.screens[key];
      screen.classList.toggle('active', key === name);
      screen.setAttribute('aria-hidden', key === name ? 'false' : 'true');
    });
    if (name === 'game') {
      requestAnimationFrame(fitArena);
    }
  }

  function showGlobalToast(message, type) {
    if (!globalToastEl) {
      globalToastEl = document.createElement('div');
      globalToastEl.className = 'global-toast';
      globalToastEl.setAttribute('role', 'status');
      globalToastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(globalToastEl);
    }
    globalToastEl.textContent = message;
    globalToastEl.className = 'global-toast show' + (type === 'error' ? ' error' : '') + (type === 'success' ? ' success' : '');
    clearTimeout(globalToastTimer);
    globalToastTimer = window.setTimeout(function () {
      globalToastEl.classList.remove('show');
    }, 2200);
  }

  function showArenaToast(message, type) {
    if (!els.arenaToast) return;
    clearTimeout(arenaToastTimer);
    els.arenaToast.textContent = message;
    els.arenaToast.className = 'arena-toast show' + (type === 'error' ? ' error' : '') + (type === 'reward' ? ' reward' : '') + (type === 'warning' ? ' warning' : '');
    arenaToastTimer = window.setTimeout(function () {
      els.arenaToast.classList.remove('show');
    }, 2300);
  }

  function showWaveBanner(info) {
    if (!info) return;
    els.waveBanner.classList.remove('show', 'boss');
    void els.waveBanner.offsetWidth;
    els.waveBannerKicker.textContent = info.hasBoss ? 'SINGULARITY SIGNAL' : 'INCOMING VECTOR';
    els.waveBannerTitle.textContent = 'WAVE ' + pad2(info.wave);
    els.waveBannerSub.textContent = info.hasBoss ? '终焉棱镜正在穿越航道' : '敌群进入坠落航道';
    if (info.hasBoss) els.waveBanner.classList.add('boss');
    els.waveBanner.classList.add('show');
  }

  function showLevelIntro(level) {
    clearTimeout(levelIntroTimer);
    $('intro-code').textContent = level.code;
    $('intro-title').textContent = level.name;
    $('intro-en').textContent = level.en;
    $('intro-intel').textContent = level.intel || '';
    els.levelIntro.classList.remove('show');
    void els.levelIntro.offsetWidth;
    els.levelIntro.classList.add('show');
    levelIntroTimer = window.setTimeout(function () {
      els.levelIntro.classList.remove('show');
    }, 2900);
  }

  function hideLevelIntro() {
    clearTimeout(levelIntroTimer);
    els.levelIntro.classList.remove('show');
  }

  function fitArena() {
    if (!els.arenaWrap || !els.arenaFrame) return;
    if (activeScreen !== 'game') return;
    const style = window.getComputedStyle(els.arenaWrap);
    const paddingX = parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0');
    const paddingY = parseFloat(style.paddingTop || '0') + parseFloat(style.paddingBottom || '0');
    const availableWidth = Math.max(80, els.arenaWrap.clientWidth - paddingX);
    const availableHeight = Math.max(80, els.arenaWrap.clientHeight - paddingY);
    els.arenaFrame.style.width = Math.floor(availableWidth) + 'px';
    els.arenaFrame.style.height = Math.floor(availableHeight) + 'px';
    if (currentGame) currentGame.resize();
  }

  /* ============================================================
     Level select
     ============================================================ */
  function starMarkup(count, accent) {
    let html = '';
    for (let i = 0; i < 3; i++) {
      html += '<span class="star-shape' + (i < count ? ' on' : '') + '"></span>';
    }
    void accent;
    return html;
  }

  function renderLevelList() {
    if (!els.levelList) return;
    const html = C.LEVELS.map(function (level) {
      const stars = save.bestStars[level.id] || 0;
      const locked = level.id > save.unlocked;
      const cleared = stars > 0;
      const isCurrent = !cleared && level.id === save.unlocked;
      const gates = (level.map.join('').match(/S/g) || []).length;
      let status = 'AVAILABLE';
      let statusClass = '';
      if (locked) {
        status = 'ENCRYPTED';
        statusClass = 'locked';
      } else if (cleared) {
        status = 'CLEARED';
        statusClass = 'cleared';
      } else if (isCurrent) {
        status = 'CURRENT VECTOR';
        statusClass = 'current';
      }
      let difficulty = '';
      for (let d = 0; d < 5; d++) {
        difficulty += '<i class="' + (d < level.difficulty ? 'on' : '') + '"></i>';
      }
      let side;
      if (locked) {
        side = '<span class="level-side-action lock-mark" aria-hidden="true"><svg class="ico" viewBox="0 0 24 24"><rect x="6" y="11" width="12" height="9" rx="1"/><path d="M9 11V8a3 3 0 0 1 6 0v3"/></svg></span>';
      } else if (cleared) {
        side = '<span class="level-side-action" aria-hidden="true"><span>✓</span></span>';
      } else {
        side = '<span class="level-side-action" aria-hidden="true"><span>›</span></span>';
      }
      return (
        '<button class="level-card ' + (locked ? 'locked' : '') + ' ' + (isCurrent ? 'current' : '') + ' ' + (cleared ? 'cleared' : '') + '"' +
        ' type="button" data-level="' + level.id + '"' + (locked ? ' disabled' : '') +
        ' style="--level-accent:' + level.accent + '"' +
        ' aria-label="' + (locked ? '未解锁星区 ' : '') + level.code + ' ' + level.name + '">' +
          '<span class="level-number">' + pad2(level.id) + '<small>SECTOR</small></span>' +
          '<span class="level-info">' +
            '<span class="level-topline"><span class="level-status ' + statusClass + '">' + status + '</span>' +
              '<span class="level-difficulty" aria-label="威胁等级 ' + level.difficulty + '">' + difficulty + '</span></span>' +
            '<span class="level-name"><b>' + level.name + '</b><small>' + level.en + '</small></span>' +
            '<span class="level-meta">' +
              '<span><span class="meta-gate">⌁</span>' + gates + ' 裂口</span>' +
              '<span>' + level.waves.length + ' 波次</span>' +
              '<span class="gold-reward">' + goldSvg() + '+' + level.gold + '</span>' +
            '</span>' +
          '</span>' +
          '<span class="level-side">' +
            '<span class="level-stars" aria-label="' + stars + ' 星">' + starMarkup(stars) + '</span>' +
            side +
          '</span>' +
        '</button>'
      );
    }).join('');
    els.levelList.innerHTML = html;
  }

  function openLevels() {
    if (activeScreen === 'game') destroyGame();
    renderLevelList();
    refreshMeta();
    showScreen('levels');
    audio.play('ui');
  }

  function startLevel(levelId) {
    const level = C.LEVELS[levelId - 1];
    if (!level) return;
    if (levelId > save.unlocked) {
      showGlobalToast('该星区尚未解锁', 'error');
      return;
    }
    destroyGame();
    closeHelp();
    els.pauseOverlay.classList.add('hidden');
    els.resultOverlay.classList.add('hidden');
    els.onboarding.classList.add('hidden');
    currentLevelId = levelId;
    gameSpeed = 1;
    deploymentPromptShown = false;
    els.gameScreen.style.setProperty('--game-accent', level.accent);
    els.gameScreen.style.setProperty('--accent', level.accent);
    $('hud-level-code').textContent = level.code;
    $('hud-level-name').textContent = level.name;
    $('hud-level-en').textContent = level.en;
    els.speedLabel.textContent = '×1';
    els.waveBanner.classList.remove('show', 'boss');
    els.arenaToast.classList.remove('show');
    els.placementLegend.classList.remove('show');
    clearTimeout(arenaToastTimer);
    clearTimeout(legendTimer);
    showScreen('game');
    fitArena();
    renderBuildDock();
    const canvas = els.gameCanvas;
    currentGame = new GAME.Game({
      level: level,
      mods: computeMods(),
      events: {
        onStats: handleStats,
        onPhase: handlePhase,
        onSelection: handleSelection,
        onWaveWarning: handleWaveWarning,
        onWaveStart: handleWaveStart,
        onWaveClear: handleWaveClear,
        onVictory: handleVictory,
        onDefeat: handleDefeat,
        onToast: function (payload) {
          if (!payload) return;
          showArenaToast(payload.message, payload.type);
        },
        onCrystalGain: function (payload) {
          animateCrystalGain(payload.amount);
        },
      },
      audio: audio,
      canvas: canvas,
    });
    currentGame.speed = gameSpeed;
    requestAnimationFrame(function () {
      fitArena();
      if (currentGame) {
        currentGame.resize();
        currentGame.refreshUI();
      }
    });
    updateHud(currentGame.getHudState());
    updateBuildSelection(null);
    renderIntel({ mode: 'none' });
    showLevelIntro(level);
    const seenTutorial = save.tutorialSeen;
    if (!seenTutorial) {
      currentGame.setPaused(true);
      onboardingPause = true;
      els.onboarding.classList.remove('hidden');
    } else {
      window.setTimeout(function () {
        if (
          currentGame &&
          currentLevelId === levelId &&
          activeScreen === 'game' &&
          !currentGame.paused &&
          currentGame.phase === 'prep' &&
          currentGame.currentWave === 0 &&
          currentGame.structures.length === 0 &&
          currentGame.prepRemaining > 3.5
        ) {
          showArenaToast('选择阵列部署 · 倒计时结束后自动发兵', 'info');
        }
      }, 1100);
    }
    audio.ensure();
  }

  function destroyGame() {
    if (currentGame) {
      currentGame.destroy();
      currentGame = null;
    }
    currentLevelId = null;
    clearTimeout(legendTimer);
    clearTimeout(arenaToastTimer);
    if (els.pauseOverlay) els.pauseOverlay.classList.add('hidden');
    if (els.pauseBar) els.pauseBar.classList.add('hidden');
    updatePauseButton(false);
    if (els.resultOverlay) els.resultOverlay.classList.add('hidden');
    if (els.onboarding) els.onboarding.classList.add('hidden');
    if (els.arenaToast) els.arenaToast.classList.remove('show');
    if (els.waveBanner) els.waveBanner.classList.remove('show', 'boss');
    if (els.placementLegend) els.placementLegend.classList.remove('show');
    resultSummary = null;
    onboardingPause = false;
  }

  /* ============================================================
     Game HUD / build dock / intel
     ============================================================ */
  function handleStats(state) {
    if (!currentGame) return;
    updateHud(state);
    updateBuildAffordability();
    if (
      !deploymentPromptShown &&
      !currentGame.paused &&
      currentGame.phase === 'prep' &&
      currentGame.currentWave === 0 &&
      currentGame.structures.length > 0 &&
      currentGame.prepRemaining > 3.5
    ) {
      deploymentPromptShown = true;
      showArenaToast('防线已建立 · 首波将在倒计时结束后自动来袭', 'info');
    }
  }

  function handlePhase(state) {
    updateHud(state);
    updateBuildAffordability();
    if (!currentGame) return;
    const info = currentGame.getSelectionInfo();
    if (info.mode === 'none') {
      renderIntel(info);
    }
    updateBuildSelection(state.selectedBuild);
  }

  function handleSelection(info) {
    renderIntel(info);
    updateBuildSelection(info.mode === 'build' ? info.type : null);
    if (info.mode === 'build') {
      els.placementLegend.classList.add('show');
      clearTimeout(legendTimer);
      legendTimer = window.setTimeout(function () {
        els.placementLegend.classList.remove('show');
      }, 4200);
    } else {
      els.placementLegend.classList.remove('show');
    }
  }

  function handleWaveWarning(info) {
    if (!currentGame || !info) return;
    const seconds = Math.max(1, Math.round(info.seconds || 3));
    showArenaToast('警报 · 第 ' + info.wave + ' 波将在 ' + seconds + ' 秒后自动来袭', 'warning');
  }

  function handleWaveStart(info) {
    if (!currentGame) return;
    hideLevelIntro();
    showWaveBanner(info);
    if (!currentGame.selectedBuild) {
      renderIntel({ mode: 'none' });
    }
  }

  function handleWaveClear(info) {
    if (!currentGame || !info) return;
    if (!info.hasNext) {
      showArenaToast('最终波已肃清 · 核心信号稳定', 'reward');
      return;
    }
    let message = '第 ' + info.wave + ' 波已肃清';
    if (info.repaired > 0) message += ' · 纳米修复 +' + info.repaired;
    message += ' · ' + Math.ceil(info.nextIn || currentGame.getHudState().prepRemaining) + ' 秒后自动来袭';
    showArenaToast(message, 'info');
  }

  function handleVictory(summary) {
    if (!summary) return;
    finishRun(true, summary);
  }

  function handleDefeat(summary) {
    if (!summary) return;
    finishRun(false, summary);
  }

  const hudMemory = { core: null, crystals: null, wave: null };
  let coreDeltaTimer = 0;

  function popHudValue(el) {
    if (!el) return;
    el.classList.remove('hud-value-pop');
    void el.offsetWidth;
    el.classList.add('hud-value-pop');
  }

  function updateHud(state) {
    if (!state) return;
    const ratio = U.clamp(state.baseHp / Math.max(1, state.baseMax), 0, 1);
    const coreNow = Math.max(0, Math.ceil(state.baseHp));
    if (els.coreValue && els.coreValue.textContent !== String(coreNow)) {
      els.coreValue.textContent = String(coreNow);
      popHudValue(els.coreValue);
      if (els.coreDelta && hudMemory.core != null && coreNow !== hudMemory.core) {
        const delta = coreNow - hudMemory.core;
        els.coreDelta.textContent = (delta > 0 ? '+' : '') + delta;
        els.coreDelta.classList.toggle('heal', delta > 0);
        els.coreDelta.classList.remove('show');
        void els.coreDelta.offsetWidth;
        els.coreDelta.classList.add('show');
        window.clearTimeout(coreDeltaTimer);
        coreDeltaTimer = window.setTimeout(function () { els.coreDelta.classList.remove('show'); }, 900);
      }
    }
    hudMemory.core = coreNow;
    els.coreFill.style.width = (ratio * 100).toFixed(1) + '%';
    if (els.coreBar) els.coreBar.classList.toggle('low', ratio < 0.34);
    if (els.coreStat) els.coreStat.classList.toggle('danger', ratio < 0.3);
    const crystalNow = U.formatInt(state.crystals);
    if (els.crystals && els.crystals.textContent !== crystalNow) {
      els.crystals.textContent = crystalNow;
      popHudValue(els.crystals);
    }
    hudMemory.crystals = state.crystals;
    const waveNow = Math.min(state.wave || 1, state.totalWaves) + '/' + state.totalWaves;
    if (els.wave && els.wave.textContent !== waveNow) {
      els.wave.textContent = waveNow;
      popHudValue(els.wave);
    }
    hudMemory.wave = state.wave;
    if (currentGame) {
      const speed = currentGame.speed;
      els.speedLabel.textContent = '×' + speed;
      const speedButton = document.querySelector('#btn-game-speed');
      if (speedButton) speedButton.classList.toggle('speed-boost', speed > 1);
    }
    const status = els.waveStatus;
    if (status) {
      const isPrep = state.phase === 'prep';
      const isLive = state.phase === 'wave';
      const isCleared = state.phase === 'victory-pending' || state.phase === 'victory';
      const isLost = state.phase === 'defeat';
      const seconds = isPrep ? Math.max(0, Math.ceil(Number(state.prepRemaining) || 0)) : 0;
      status.classList.toggle('prep', isPrep);
      status.classList.toggle('active', isLive);
      status.classList.toggle('imminent', isPrep && seconds > 0 && seconds <= 3);
      status.classList.toggle('cleared', isCleared);
      status.classList.toggle('lost', isLost);
      status.disabled = !isPrep || !!(currentGame && currentGame.paused);
      let statusTitle = '';
      if (isPrep && currentGame && !currentGame.paused) {
        const preview = currentGame.getNextWavePreview();
        const previewText = preview && preview.enemies.length
          ? preview.enemies.map(function (enemy) { return enemy.name + '×' + enemy.count; }).join(' · ')
          : '';
        statusTitle = previewText ? '下一波：' + previewText + ' · 点击立即发兵' : '点击立即发兵';
      }
      status.title = statusTitle;
      if (isPrep) {
        els.waveStatusKicker.textContent = '自动发兵';
        els.waveStatusValue.textContent = String(seconds).padStart(2, '0') + 's';
        const total = Math.max(1, Number(state.prepTotal) || 1);
        els.waveStatusProgress.style.width = (U.clamp(seconds / total, 0, 1) * 100).toFixed(1) + '%';
        status.setAttribute('aria-label', '第 ' + state.wave + ' 波将在 ' + seconds + ' 秒后自动来袭，点击立即发兵');
      } else if (isLive) {
        const remaining = Math.max(0, Number(state.waveRemaining != null ? state.waveRemaining : state.enemiesAlive) || 0);
        els.waveStatusKicker.textContent = '剩余敌军';
        els.waveStatusValue.textContent = String(remaining);
        status.setAttribute('aria-label', '第 ' + state.wave + ' 波交战中，剩余 ' + remaining + ' 个敌人');
      } else if (isCleared) {
        els.waveStatusKicker.textContent = '区域肃清';
        els.waveStatusValue.textContent = '—';
        status.setAttribute('aria-label', '区域已肃清');
      } else if (isLost) {
        els.waveStatusKicker.textContent = '核心失守';
        els.waveStatusValue.textContent = '—';
        status.setAttribute('aria-label', '核心已失守');
      }
    }
    updateBuildAffordability();
  }

  function renderBuildDock() {
    if (!els.buildList) return;
    const types = C.TOWER_ORDER.concat(['wall']);
    els.buildList.innerHTML = types.map(function (type) {
      const def = type === 'wall' ? C.WALL : C.TOWERS[type];
      return (
        '<button class="build-card' + (type === 'wall' ? ' wall' : '') + '" type="button" data-build="' + type + '"' +
        ' style="--card-color:' + def.color + '" aria-label="选择' + def.name + '" aria-pressed="false">' +
          '<span class="build-key">' + BUILD_KEYS[type] + '</span>' +
          '<canvas class="build-icon" width="64" height="64" aria-hidden="true"></canvas>' +
          '<span class="build-name">' + BUILD_SHORT[type] + '</span>' +
          '<span class="build-cost">' + gemSvg() + '<span class="build-cost-value">0</span></span>' +
        '</button>'
      );
    }).join('');
    $$('.build-card canvas', els.buildList).forEach(function (canvas) {
      GFX.towerIcon(canvas, canvas.parentNode.getAttribute('data-build'));
    });
    if (els.buildCapacityCurrent) els.buildCapacityCurrent.textContent = '0';
    if (els.buildCapacityTotal) els.buildCapacityTotal.textContent = String(C.TOWER_CAPACITY);
    updateBuildAffordability();
  }

  function updateBuildAffordability() {
    if (!currentGame || !els.buildList) return;
    const crystals = currentGame.crystals;
    let towerCount = 0;
    for (let i = 0; i < currentGame.structures.length; i++) {
      if (currentGame.structures[i].kind === 'tower') towerCount++;
    }
    const capacity = C.TOWER_CAPACITY;
    const capacityFull = towerCount >= capacity;
    const countText = String(towerCount);
    const totalText = String(capacity);
    if (els.buildCapacityCurrent && els.buildCapacityCurrent.textContent !== countText) {
      els.buildCapacityCurrent.textContent = countText;
    }
    if (els.buildCapacityTotal && els.buildCapacityTotal.textContent !== totalText) {
      els.buildCapacityTotal.textContent = totalText;
    }
    if (els.buildHead) els.buildHead.classList.toggle('full', capacityFull);
    let cheapest = Infinity;
    for (let i = 0; i < C.TOWER_ORDER.length; i++) {
      cheapest = Math.min(cheapest, currentGame.getBuildCost(C.TOWER_ORDER[i]));
    }
    if (!Number.isFinite(cheapest)) cheapest = 0;
    if (els.buildDock) {
      els.buildDock.classList.toggle('full', capacityFull);
      els.buildDock.classList.toggle('poor', crystals < cheapest);
      els.buildDock.setAttribute(
        'aria-label',
        '常驻建造栏，已建 ' + towerCount + ' 座，上限 ' + capacity + ' 座，最低费用 ' + cheapest + ' 晶元'
      );
    }
    if (els.buildDockCapacity) {
      const dockCapacity = towerCount + '/' + capacity;
      if (els.buildDockCapacity.textContent !== dockCapacity) {
        els.buildDockCapacity.textContent = dockCapacity;
      }
    }
    if (els.buildDockCost && els.buildDockCost.textContent !== String(cheapest)) {
      els.buildDockCost.textContent = String(cheapest);
    }
    if (els.buildCapacity) {
      const capacityLabel = '火力单元 ' + towerCount + ' / ' + capacity;
      if (els.buildCapacity.getAttribute('aria-label') !== capacityLabel) {
        els.buildCapacity.setAttribute('aria-label', capacityLabel);
      }
    }
    $$('.build-card', els.buildList).forEach(function (card) {
      const type = card.getAttribute('data-build');
      const cost = currentGame.getBuildCost(type);
      const value = card.querySelector('.build-cost-value');
      const blocked = type !== 'wall' && capacityFull;
      if (value) value.textContent = cost;
      card.classList.toggle('poor', crystals < cost);
      card.classList.toggle('capacity-full', blocked);
      card.setAttribute('aria-disabled', blocked ? 'true' : 'false');
      card.setAttribute(
        'aria-label',
        '选择' + (type === 'wall' ? C.WALL.name : C.TOWERS[type].name) + '，消耗 ' + cost + ' 晶元' +
          (blocked ? '，火力单元已满' : '')
      );
    });
  }

  function updateBuildSelection(type) {
    if (!els.buildList) return;
    $$('.build-card', els.buildList).forEach(function (card) {
      const active = card.getAttribute('data-build') === type;
      card.classList.toggle('selected', active);
      card.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function statChips(type, stats, nextStats) {
    if (!stats) return '';
    const chips = [];
    const primaryLabel = type === 'laser' ? 'DPS' : '伤害';
    const primary = type === 'laser' ? stats.dps : stats.damage;
    const nextPrimary = nextStats ? (type === 'laser' ? nextStats.dps : nextStats.damage) : null;
    if (primary != null) {
      let val = '<b>' + formatStat(primary) + '</b>';
      if (nextPrimary != null && Math.abs(nextPrimary - primary) > 0.01) {
        val += ' <span class="level-gain">→' + formatStat(nextPrimary) + '</span>';
      }
      chips.push('<span>' + primaryLabel + ' ' + val + '</span>');
    }
    if (type !== 'shock' && type !== 'laser') {
      chips.push('<span>射程 <b>' + stats.range.toFixed(1) + '</b></span>');
    } else if (type === 'laser') {
      chips.push('<span>射程 <b>' + stats.range.toFixed(1) + '</b></span>');
    } else {
      chips.push('<span>半径 <b>' + stats.range.toFixed(1) + '</b></span>');
    }
    if (type === 'prism') {
      chips.push('<span>齐射 <b>' + stats.shots + '</b></span>');
    } else if (type === 'gatling' || type === 'cannon') {
      chips.push('<span>间隔 <b>' + stats.cooldown.toFixed(2) + 's</b></span>');
    } else if (type === 'laser') {
      chips.push('<span>升温 <b>×' + stats.ramp.toFixed(1) + '</b></span>');
    } else if (type === 'shock') {
      chips.push('<span>减速 <b>' + Math.round(stats.slow * 100) + '%</b></span>');
    } else if (type === 'frost') {
      chips.push('<span>减速 <b>' + Math.round(stats.slow * 100) + '%</b></span>');
    } else if (type === 'tesla') {
      chips.push('<span>链锁 <b>' + stats.chains + '</b></span>');
    }
    return chips.join('');
  }

  function formatStat(value) {
    if (value >= 100) return String(Math.round(value));
    if (value >= 10) return String(Math.round(value * 10) / 10);
    return String(Math.round(value * 10) / 10);
  }

  function renderIntel(info) {
    if (!els.intelContent) return;
    if (els.gameScreen) {
      els.gameScreen.classList.toggle('show-intel', !!(info && info.mode !== 'none'));
    }
    if (!info || info.mode === 'none') {
      const state = currentGame ? currentGame.getHudState() : null;
      const preview = currentGame ? currentGame.getNextWavePreview() : null;
      let hint = '选择下方防御单元，点击高亮星格部署';
      let title = '防线待命';
      if (state && state.phase === 'wave') {
        hint = '点击已建造设施查看升级 · 击杀获得晶元';
        title = '交战协议运行中';
      } else if (state && state.phase === 'victory-pending') {
        hint = '最后的敌群信号正在消散';
        title = '信号归零';
      } else if (state && state.phase === 'prep') {
        const towerCount = currentGame ? currentGame.structures.length : 0;
        if (towerCount > 0) {
          title = state.currentWave === 0 ? '防线已建立' : '波次间歇';
          hint = '倒计时结束后自动发兵 · 留意顶部倒计时与警报';
        } else {
          hint = '选择下方防御单元部署 · 首波将在倒计时结束后自动来袭';
        }
      }
      let previewHtml = '';
      if (preview && preview.enemies.length) {
        const chips = preview.enemies.slice(0, 4).map(function (enemy) {
          return '<span class="enemy-chip shape-' + enemy.shape + (enemy.boss ? ' boss' : '') + '" style="color:' + enemy.color + '" title="' + enemy.name + ' × ' + enemy.count + '"><i></i>' + enemy.count + '</span>';
        }).join('');
        previewHtml = '<div class="next-wave-preview"><span class="next-wave-label">NEXT</span>' + chips + '</div>';
      }
      els.intelContent.innerHTML =
        '<div class="intel-default">' +
          '<div class="intel-command" aria-hidden="true"></div>' +
          '<div class="intel-default-copy"><strong>' + title + '</strong><span>' + hint + '</span></div>' +
          previewHtml +
        '</div>';
      return;
    }
    if (info.mode === 'build') {
      const costClass = info.canAfford ? '' : ' unaffordable';
      const capacityLabel = info.isWall ? '预览' : '单元 ' + info.towerCount + '/' + info.towerCapacity;
      els.intelContent.innerHTML =
        '<div class="intel-sigil" style="--intel-color:' + info.color + '"><canvas width="36" height="36"></canvas></div>' +
        '<div class="intel-copy">' +
          '<div class="intel-title-row"><strong>' + info.name + '</strong><span class="intel-level cost' + costClass + '">' + gemSvg() + info.cost + '</span><span class="intel-level">' + capacityLabel + '</span></div>' +
          '<div class="intel-sub">' + info.role + ' · ' + info.tagline + '</div>' +
          '<div class="intel-stats">' + (info.isWall ? '<span>阻挡通行 · 强制重寻路</span><span>不可被攻击</span>' : statChips(info.type, info.stats)) + '</div>' +
        '</div>' +
        '<div class="intel-actions"><button class="mini-button cancel" type="button" data-intel-action="cancel">取消</button></div>';
      const canvas = els.intelContent.querySelector('.intel-sigil canvas');
      GFX.towerIcon(canvas, info.type);
      return;
    }
    if (info.mode === 'structure' && info.isWall) {
      els.intelContent.innerHTML =
        '<div class="intel-sigil" style="--intel-color:' + info.color + '"><canvas width="36" height="36"></canvas></div>' +
        '<div class="intel-copy">' +
          '<div class="intel-title-row"><strong>' + info.name + '</strong><span class="intel-level">结构</span></div>' +
          '<div class="intel-sub">' + info.tagline + ' · 阻挡通行，无法被攻击</div>' +
          '<div class="intel-stats"><span>部署投入 <b>' + info.spent + '</b></span><span>可回收 <b>+' + info.sellValue + '</b></span></div>' +
        '</div>' +
        '<div class="intel-actions"><button class="mini-button sell" type="button" data-intel-action="sell" aria-label="回收壁垒，获得 ' + info.sellValue + ' 晶元"><span class="sell-label">回收</span>' + gemSvg() + '+' + info.sellValue + '</button></div>';
      const canvas = els.intelContent.querySelector('.intel-sigil canvas');
      GFX.towerIcon(canvas, 'wall');
      return;
    }
    if (info.mode === 'structure' && !info.isWall) {
      const maxed = info.maxed;
      const canUndo = !!info.canUndo;
      const upgradeLabel = maxed
        ? 'MAX'
        : '<span>升级</span>' + gemSvg() + info.upgradeCost;
      const sellLabel = canUndo ? '撤销' : '回收';
      const sellAria = canUndo
        ? '撤销部署，全额返还 ' + info.sellValue + ' 晶元'
        : '回收防御塔，获得 ' + info.sellValue + ' 晶元';
      els.intelContent.innerHTML =
        '<div class="intel-sigil' + (maxed ? ' level-max' : '') + '" style="--intel-color:' + info.color + '"><canvas width="36" height="36"></canvas></div>' +
        '<div class="intel-copy">' +
          '<div class="intel-title-row"><strong>' + info.name + '</strong><span class="intel-level' + (maxed ? ' max' : '') + '">LV.' + info.level + ' / ' + info.maxLevel + '</span></div>' +
          '<div class="intel-sub">' + info.role + ' · ' + info.special + '</div>' +
          '<div class="intel-stats">' + statChips(info.type, info.stats, info.nextStats) + '</div>' +
        '</div>' +
        '<div class="intel-actions">' +
          '<button class="mini-button upgrade' + (maxed ? ' maxed' : '') + '" type="button" data-intel-action="upgrade" aria-label="升级防御塔"' + (maxed ? ' disabled' : '') + '>' + upgradeLabel + '</button>' +
          '<button class="mini-button sell' + (canUndo ? ' undo' : '') + '" type="button" data-intel-action="sell" aria-label="' + sellAria + '"><span class="sell-label">' + sellLabel + '</span>' + gemSvg() + '+' + info.sellValue + '</button>' +
        '</div>';
      const canvas = els.intelContent.querySelector('.intel-sigil canvas');
      GFX.towerIcon(canvas, info.type);
    }
  }

  function animateCrystalGain(amount) {
    if (!amount || !els.crystalDelta) return;
    els.crystalDelta.textContent = '+' + amount;
    els.crystalDelta.classList.remove('show');
    void els.crystalDelta.offsetWidth;
    els.crystalDelta.classList.add('show');
  }

  /* ============================================================
     Skills screen
     ============================================================ */
  function renderSkills(flashId) {
    if (!els.skillList) return;
    els.skillsGoldBig.textContent = U.formatInt(save.gold);
    const html = C.SKILLS.map(function (skill) {
      const rank = save.skills[skill.id] || 0;
      const maxed = rank >= C.SKILL_MAX;
      const cost = maxed ? 0 : skill.costs[rank];
      const poor = !maxed && save.gold < cost;
      let pips = '';
      for (let i = 0; i < C.SKILL_MAX; i++) {
        pips += '<i class="' + (i < rank ? 'on' : '') + '"></i>';
      }
      const effect = skillEffectText(skill, rank);
      const nextEffect = maxed ? '' : '<span class="rank-next">下一阶 → ' + skillEffectText(skill, rank + 1) + '</span>';
      let button;
      if (maxed) {
        button = '<button class="skill-upgrade maxed" type="button" disabled><span class="skill-cost">MAX</span><small>满阶</small></button>';
      } else {
        button = '<button class="skill-upgrade' + (poor ? ' poor' : '') + '" type="button" data-skill="' + skill.id + '" data-cost="' + cost + '">' +
          '<span class="skill-cost">' + goldSvg() + U.formatInt(cost) + '</span>' +
          '<small>升级</small>' +
        '</button>';
      }
      return (
        '<article class="skill-card' + (maxed ? ' maxed' : '') + (flashId === skill.id ? ' flash' : '') + '" id="skill-card-' + skill.id + '" style="--skill-color:' + skill.color + '">' +
          '<div class="skill-icon-wrap"><canvas width="64" height="64" aria-hidden="true"></canvas></div>' +
          '<div class="skill-info">' +
            '<div class="skill-titleline"><h3>' + skill.name + '</h3><span>' + skill.en + '</span></div>' +
            '<p>' + skill.desc + '</p>' +
            '<div class="skill-current"><span>' + effect + '</span>' + nextEffect + '</div>' +
            '<div class="skill-rank-row"><div class="rank-pips">' + pips + '</div><span class="rank-value">' + rank + ' / ' + C.SKILL_MAX + '</span></div>' +
          '</div>' +
          button +
        '</article>'
      );
    }).join('');
    els.skillList.innerHTML = html;
    $$('.skill-card', els.skillList).forEach(function (card) {
      const id = card.id.replace('skill-card-', '');
      const skill = C.SKILLS.find(function (s) { return s.id === id; });
      const canvas = card.querySelector('.skill-icon-wrap canvas');
      if (skill && canvas) GFX.skillIcon(canvas, skill, save.skills[skill.id] || 0);
    });
  }

  function openSkills(returnTo) {
    skillsReturn = returnTo || 'home';
    renderSkills();
    refreshMeta();
    showScreen('skills');
    audio.play('ui');
  }

  function goBackFromSkills() {
    if (skillsReturn === 'result' && currentGame && resultSummary) {
      showScreen('game');
      requestAnimationFrame(fitArena);
      return;
    }
    if (skillsReturn === 'levels') {
      renderLevelList();
      refreshMeta();
      showScreen('levels');
      return;
    }
    showScreen('home');
    refreshMeta();
  }

  function buySkill(skillId) {
    const skill = C.SKILLS.find(function (s) { return s.id === skillId; });
    if (!skill) return;
    const rank = save.skills[skill.id] || 0;
    if (rank >= C.SKILL_MAX) return;
    const cost = skill.costs[rank];
    if (save.gold < cost) {
      showGlobalToast('金币不足 · 完成星区可获得金币', 'error');
      audio.play('error');
      const card = $('skill-card-' + skill.id);
      if (card) {
        card.classList.remove('deny');
        void card.offsetWidth;
        card.classList.add('deny');
      }
      return;
    }
    save.gold -= cost;
    save.skills[skill.id] = rank + 1;
    persist();
    audio.play('upgrade');
    renderSkills(skill.id);
    refreshMeta();
    showGlobalToast(skill.name + ' 已提升至 ' + (rank + 1) + ' 阶', 'success');
  }

  /* ============================================================
     Pause / results / onboarding
     ============================================================ */
  function pauseReadout() {
    if (!currentGame) return;
    const state = currentGame.getHudState();
    $('pause-wave').textContent = state.wave + ' / ' + state.totalWaves;
    $('pause-kills').textContent = U.formatInt(state.kills);
    $('pause-crystals').textContent = U.formatInt(state.crystals);
  }

  function updatePauseButton(paused) {
    if (!els.pauseButton) return;
    els.pauseButton.classList.toggle('is-paused', !!paused);
    els.pauseButton.setAttribute('aria-label', paused ? '继续作战' : '暂停作战');
  }

  function openPause() {
    if (!currentGame || activeScreen !== 'game') return;
    if (currentGame.phase === 'victory' || currentGame.phase === 'defeat' || currentGame.phase === 'victory-pending') return;
    if (!els.onboarding.classList.contains('hidden')) return;
    if (els.pauseBar && !els.pauseBar.classList.contains('hidden')) return;
    currentGame.setPaused(true);
    pauseReadout();
    if (els.pauseOverlay) els.pauseOverlay.classList.add('hidden');
    if (els.pauseBar) els.pauseBar.classList.remove('hidden');
    updatePauseButton(true);
    audio.play('ui');
  }

  function closePause(resume) {
    if (els.pauseBar) els.pauseBar.classList.add('hidden');
    if (els.pauseOverlay) els.pauseOverlay.classList.add('hidden');
    updatePauseButton(false);
    if (resume && currentGame) currentGame.setPaused(false);
  }

  function togglePause() {
    if (!currentGame || activeScreen !== 'game') return;
    if (els.pauseBar && !els.pauseBar.classList.contains('hidden')) {
      closePause(true);
      audio.play('ui');
    } else {
      openPause();
    }
  }

  function finishRun(success, summary) {
    if (!currentGame) return;
    const level = C.LEVELS[summary.levelId - 1];
    if (!level) return;
    let goldEarned = 0;
    let firstClear = false;
    let improved = false;
    if (success) {
      const previousStars = save.bestStars[level.id] || 0;
      firstClear = previousStars === 0;
      improved = summary.stars > previousStars;
      const base = firstClear ? level.gold : Math.floor(level.gold * 0.3);
      const bonus = firstClear ? Math.max(0, summary.stars - 1) * 15 : Math.max(0, summary.stars - previousStars) * 10;
      goldEarned = Math.max(0, Math.round(base + bonus));
      save.gold += goldEarned;
      save.bestStars[level.id] = Math.max(previousStars, summary.stars);
      save.unlocked = Math.max(save.unlocked, Math.min(C.LEVELS.length, level.id + 1));
      persist();
      refreshMeta();
      resultAction = level.id < C.LEVELS.length ? 'next' : 'levels';
    } else {
      resultAction = 'retry';
    }
    resultSummary = { level: level, summary: summary, gold: goldEarned, firstClear: firstClear, improved: improved };
    currentGame.setPaused(true);
    if (els.pauseBar) els.pauseBar.classList.add('hidden');
    if (els.pauseOverlay) els.pauseOverlay.classList.add('hidden');
    updatePauseButton(false);
    renderResult(resultSummary);
    els.resultOverlay.classList.remove('hidden');
    audio.play('ui');
  }

  function renderResult(result) {
    const level = result.level;
    const summary = result.summary;
    const success = summary.success;
    const stars = summary.stars || 0;
    $('result-card').style.setProperty('--result-accent', success ? level.accent : '#ff5d7a');
    $('result-kicker').textContent = success ? 'SECTOR SECURED' : 'CORE SIGNAL LOST';
    let title;
    if (!success) title = '防线失守';
    else if (stars === 3) title = '完美肃清';
    else if (stars === 2) title = '星区肃清';
    else title = '惨胜肃清';
    $('result-title').textContent = title;
    let copy;
    if (!success) copy = '核心信号中断。重新调整防御阵列，再次尝试这条航道。';
    else if (result.firstClear) copy = level.id === C.LEVELS.length ? '星图尽头，核心仍在燃烧。你守住了最后的矢界。' : '首次肃清，下一片星区航道已经解锁。';
    else copy = result.improved ? '再次肃清，并刷新了星芒评价。' : '再次肃清，获得部分回收金币。';
    $('result-copy').textContent = copy;
    let starsHtml = '';
    for (let i = 0; i < 3; i++) {
      starsHtml += '<span class="star-shape' + (i < stars ? ' on' : '') + '"></span>';
    }
    $('result-stars').innerHTML = starsHtml;
    $('result-waves').textContent = success ? summary.totalWaves + ' / ' + summary.totalWaves : Math.max(1, summary.currentWave) + ' / ' + summary.totalWaves;
    $('result-kills').textContent = U.formatInt(summary.kills);
    $('result-core').textContent = Math.round(summary.integrity * 100) + '%';
    $('result-time').textContent = U.formatTime(summary.time);
    const reward = $('reward-strip');
    if (success) {
      reward.classList.remove('defeat');
      reward.querySelector('span').textContent = result.firstClear ? '首次肃清奖励' : '重复肃清回收';
      $('result-gold').textContent = '+' + U.formatInt(result.gold);
    } else {
      reward.classList.add('defeat');
      reward.querySelector('span').textContent = '核心完整度归零 · 本次无奖励';
      $('result-gold').textContent = '0';
    }
    const primary = $('result-primary');
    const primaryCopy = primary.querySelector('.button-copy');
    if (!success) {
      primaryCopy.innerHTML = '<b>重新部署</b><small>RETRY</small>';
    } else if (resultAction === 'next') {
      primaryCopy.innerHTML = '<b>下一星区</b><small>CONTINUE</small>';
    } else {
      primaryCopy.innerHTML = '<b>返回星图</b><small>RETURN</small>';
    }
    $('result-skills').style.display = '';
    $('result-levels').style.display = '';
    GFX.drawResultSigil(els.resultCanvas, success, level.accent);
  }

  function onboardingClose() {
    if (!els.onboarding.classList.contains('hidden')) {
      els.onboarding.classList.add('hidden');
      if (!save.tutorialSeen) {
        save.tutorialSeen = true;
        persist();
      }
      if (currentGame) {
        currentGame.setPaused(false);
        currentGame.refreshUI();
        showArenaToast('建设阶段开始 · 首波将在倒计时结束后自动来袭', 'info');
      }
      onboardingPause = false;
      audio.play('ui');
    }
  }

  /* ============================================================
     Help
     ============================================================ */
  function buildHelpManual() {
    if (!els.helpEnemyList) return;
    const types = C.ENEMY_ORDER.filter(function (type) {
      return type !== 'shard';
    });
    els.helpEnemyList.innerHTML = types.map(function (type) {
      const def = C.ENEMIES[type];
      return (
        '<div class="enemy-manual-row" style="--enemy-color:' + def.color + '">' +
          '<canvas width="64" height="64" aria-hidden="true"></canvas>' +
          '<div class="enemy-manual-copy"><b>' + def.name + '<span>' + def.en + ' // ' + def.tag + '</span></b><p>' + def.desc + '</p></div>' +
        '</div>'
      );
    }).join('');
    $$('.enemy-manual-row canvas', els.helpEnemyList).forEach(function (canvas, index) {
      GFX.enemyIcon(canvas, types[index]);
    });
  }

  function openHelp() {
    helpLastFocus = document.activeElement;
    els.helpModal.classList.remove('hidden');
    $('help-close').focus();
    audio.play('ui');
  }

  function closeHelp() {
    if (!els.helpModal || els.helpModal.classList.contains('hidden')) return;
    els.helpModal.classList.add('hidden');
    if (helpLastFocus && document.contains(helpLastFocus)) {
      try { helpLastFocus.focus(); } catch (error) { /* noop */ }
    }
    helpLastFocus = null;
  }

  function helpOpen() {
    return els.helpModal && !els.helpModal.classList.contains('hidden');
  }

  function gameInputBlocked() {
    return helpOpen()
      || !els.pauseOverlay.classList.contains('hidden')
      || !els.resultOverlay.classList.contains('hidden')
      || !els.onboarding.classList.contains('hidden');
  }

  /* ============================================================
     Bind UI
     ============================================================ */
  function bindUI() {
    $('btn-deploy').addEventListener('click', openLevels);
    $('btn-skills-home').addEventListener('click', function () { openSkills('home'); });
    $('btn-help').addEventListener('click', openHelp);
    $$('[data-nav="home"]').forEach(function (button) {
      button.addEventListener('click', function () {
        showScreen('home');
        refreshMeta();
        audio.play('back');
      });
    });
    $('levels-skills-shortcut').addEventListener('click', function () { openSkills('levels'); });
    $('skills-back').addEventListener('click', goBackFromSkills);
    $('help-close').addEventListener('click', closeHelp);
    els.helpModal.querySelector('.overlay-scrim').addEventListener('click', closeHelp);
    $$('.sound-button').forEach(function (button) {
      button.addEventListener('click', toggleSound);
    });

    els.levelList.addEventListener('click', function (event) {
      const card = event.target.closest('.level-card');
      if (!card || card.disabled) return;
      const levelId = Number(card.getAttribute('data-level'));
      if (!levelId) return;
      audio.ensure();
      startLevel(levelId);
    });

    els.skillList.addEventListener('click', function (event) {
      const button = event.target.closest('[data-skill]');
      if (!button) return;
      buySkill(button.getAttribute('data-skill'));
    });

    els.buildList.addEventListener('click', function (event) {
      const card = event.target.closest('.build-card');
      if (!card || !currentGame) return;
      const type = card.getAttribute('data-build');
      audio.ensure();
      currentGame.selectBuild(type);
    });

    els.intelPanel.addEventListener('click', function (event) {
      const button = event.target.closest('[data-intel-action]');
      if (!button || !currentGame) return;
      const action = button.getAttribute('data-intel-action');
      if (action === 'cancel') currentGame.cancelSelection();
      else if (action === 'upgrade') currentGame.upgradeSelected();
      else if (action === 'sell') currentGame.sellSelected();
    });

    els.waveStatus.addEventListener('click', function () {
      if (!currentGame || currentGame.phase !== 'prep' || currentGame.paused) return;
      audio.ensure();
      currentGame.startWave();
    });

    els.pauseButton.addEventListener('click', togglePause);
    $('btn-pause-restart').addEventListener('click', function () {
      const id = currentLevelId;
      closePause(false);
      if (id) startLevel(id);
    });
    $('btn-pause-abandon').addEventListener('click', function () {
      closePause(false);
      openLevels();
    });
    $('btn-pause-manual').addEventListener('click', openHelp);

    els.gameScreen.addEventListener('contextmenu', function (event) {
      if (!currentGame) return;
      event.preventDefault();
      currentGame.cancelSelection();
    });

    $('btn-resume').addEventListener('click', function () {
      closePause(true);
      audio.play('ui');
    });
    $('btn-restart').addEventListener('click', function () {
      const id = currentLevelId;
      closePause(false);
      if (id) startLevel(id);
    });
    $('btn-abandon').addEventListener('click', function () {
      closePause(false);
      openLevels();
    });
    $('btn-pause-help').addEventListener('click', openHelp);
    $('btn-game-speed').addEventListener('click', function () {
      if (!currentGame) return;
      gameSpeed = gameSpeed === 1 ? 2 : gameSpeed === 2 ? 3 : 1;
      currentGame.setSpeed(gameSpeed);
      els.speedLabel.textContent = '×' + gameSpeed;
      audio.play('ui');
    });
    $('btn-onboarding-close').addEventListener('click', onboardingClose);

    $('result-primary').addEventListener('click', function () {
      if (!resultSummary) return;
      if (resultAction === 'next') {
        startLevel(resultSummary.level.id + 1);
      } else if (resultAction === 'retry') {
        startLevel(resultSummary.level.id);
      } else {
        openLevels();
      }
    });
    $('result-skills').addEventListener('click', function () {
      openSkills('result');
    });
    $('result-levels').addEventListener('click', openLevels);

    els.gameCanvas.addEventListener('pointerdown', function (event) {
      if (!currentGame || activeScreen !== 'game') return;
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      if (gameInputBlocked()) return;
      event.preventDefault();
      audio.ensure();
      if (event.pointerType === 'mouse') {
        const hover = currentGame.cellFromClient(event.clientX, event.clientY);
        currentGame.setHoverCell(hover.inside ? { x: hover.x, y: hover.y } : null);
      }
      const cell = currentGame.cellFromClient(event.clientX, event.clientY);
      if (!cell.inside) {
        currentGame.cancelSelection();
        return;
      }
      currentGame.handleTap({ x: cell.x, y: cell.y });
    });
    els.gameCanvas.addEventListener('pointermove', function (event) {
      if (!currentGame || activeScreen !== 'game') return;
      if (event.pointerType !== 'mouse') return;
      if (gameInputBlocked()) {
        currentGame.setHoverCell(null);
        return;
      }
      const cell = currentGame.cellFromClient(event.clientX, event.clientY);
      currentGame.setHoverCell(cell.inside ? { x: cell.x, y: cell.y } : null);
    });
    els.gameCanvas.addEventListener('pointerleave', function () {
      if (currentGame) currentGame.setHoverCell(null);
    });

    window.addEventListener('resize', function () {
      ambient.resize();
      fitArena();
      if (currentGame) currentGame.resize();
    });
    window.addEventListener('orientationchange', function () {
      window.setTimeout(fitArena, 180);
    });

    if (window.ResizeObserver) {
      const ro = new ResizeObserver(function () {
        fitArena();
      });
      ro.observe(els.arenaWrap);
    }

    if (window.matchMedia) {
      const rotateQuery = window.matchMedia('(orientation: landscape) and (max-height: 560px)');
      const handleRotateGate = function (event) {
        if (event.matches) {
          if (
            currentGame &&
            activeScreen === 'game' &&
            !currentGame.paused &&
            (currentGame.phase === 'wave' || currentGame.phase === 'prep')
          ) {
            autoPausedForRotation = true;
            currentGame.setPaused(true);
          }
        } else if (autoPausedForRotation) {
          autoPausedForRotation = false;
          if (currentGame && activeScreen === 'game') {
            if (els.resultOverlay.classList.contains('hidden') && !helpOpen()) {
              openPause();
            }
          }
        }
      };
      if (rotateQuery.addEventListener) rotateQuery.addEventListener('change', handleRotateGate);
      else if (rotateQuery.addListener) rotateQuery.addListener(handleRotateGate);
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && currentGame && activeScreen === 'game') {
        if (els.pauseBar && !els.pauseBar.classList.contains('hidden')) return;
        if (currentGame.phase !== 'wave' && currentGame.phase !== 'prep') return;
        if (!els.onboarding.classList.contains('hidden') || helpOpen()) return;
        openPause();
      }
    });

    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('pointerdown', function () {
      if (save.settings.sound) audio.ensure();
    }, { capture: true, passive: true });

    buildHelpManual();
    refreshMeta();
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      if (helpOpen()) {
        closeHelp();
        event.preventDefault();
        return;
      }
      if (!els.onboarding.classList.contains('hidden')) {
        onboardingClose();
        event.preventDefault();
        return;
      }
      if (activeScreen === 'game' && els.pauseBar && !els.pauseBar.classList.contains('hidden')) {
        closePause(true);
        event.preventDefault();
        return;
      }
      if (activeScreen === 'game' && els.resultOverlay.classList.contains('hidden')) {
        openPause();
        event.preventDefault();
        return;
      }
      if (activeScreen === 'levels' || activeScreen === 'skills') {
        if (activeScreen === 'skills') goBackFromSkills();
        else {
          showScreen('home');
          refreshMeta();
        }
        event.preventDefault();
      }
      return;
    }
    if (
      (event.key === 'p' || event.key === 'P') &&
      activeScreen === 'game' &&
      currentGame &&
      !helpOpen() &&
      els.onboarding.classList.contains('hidden') &&
      els.resultOverlay.classList.contains('hidden')
    ) {
      togglePause();
      event.preventDefault();
      return;
    }
    if (activeScreen !== 'game' || gameInputBlocked() || !currentGame) return;
    if (event.key >= '1' && event.key <= '7') {
      const type = C.TOWER_ORDER[Number(event.key) - 1];
      if (type) {
        currentGame.selectBuild(type);
        event.preventDefault();
      }
      return;
    }
    if (event.key === 'w' || event.key === 'W') {
      currentGame.selectBuild('wall');
      event.preventDefault();
      return;
    }
  }

  /* ============================================================
     Main loop
     ============================================================ */
  function loop(now) {
    const dt = Math.min(0.06, (now - lastFrame) / 1000);
    lastFrame = now;
    const time = now / 1000;
    ambient.draw(time);
    if (activeScreen === 'home') {
      GFX.drawHomeCore(els.homeCore, time);
    } else if (activeScreen === 'skills') {
      GFX.drawSkillMatrixHero(els.skillHero, time);
    }
    if (currentGame) {
      if (activeScreen === 'game') {
        currentGame.update(dt);
        currentGame.render(now);
      }
    }
    requestAnimationFrame(loop);
  }

  /* ============================================================
     Boot
     ============================================================ */
  function boot() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.25);
    els.homeCore.width = Math.round(220 * dpr);
    els.homeCore.height = Math.round(220 * dpr);
    els.skillHero.width = Math.round(160 * dpr);
    els.skillHero.height = Math.round(160 * dpr);
    ambient.resize();
    bindUI();
    refreshMeta();
    showScreen('home');
    requestAnimationFrame(loop);
  }

  // Small debug/testing surface. Does not affect normal play.
  window.__VECTOR = {
    get save() { return save; },
    get game() { return currentGame; },
    startLevel: startLevel,
    openLevels: openLevels,
    openSkills: openSkills,
    addGold: function (amount) {
      save.gold = Math.max(0, save.gold + Math.floor(amount || 0));
      persist();
      refreshMeta();
    },
    unlockAll: function () {
      save.unlocked = C.LEVELS.length;
      persist();
      refreshMeta();
    },
    setStars: function (levelId, stars) {
      save.bestStars[levelId] = U.clamp(Math.floor(stars || 0), 0, 3);
      save.unlocked = Math.max(save.unlocked, Math.min(C.LEVELS.length, levelId + 1));
      persist();
      refreshMeta();
    },
    spawnDebugWave: function () {
      if (currentGame) currentGame.startWave();
    },
  };

  boot();
})();
