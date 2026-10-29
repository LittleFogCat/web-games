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
  const DEBUG_KEY = 'vector_geotd_debug_v1';
  const DEBUG_GOLD_KEY = 'vector_geotd_debug_gold_v1';
  const DEBUG_GOLD_AMOUNT = 10000;

  const BUILD_SHORT = {
    prism: '箭塔',
    gatling: '机炮',
    cannon: '重炮',
    laser: '激光',
    shock: '震荡',
    frost: '冰霜',
    tesla: '电弧',
    beacon: '灯塔',
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
    beacon: '8',
    wall: 'W',
  };

  const $ = function (id) {
    return document.getElementById(id);
  };

  const $$ = function (selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  };

  function gemSvg(cls) {
    return '<svg class="ico ' + (cls || 'ico-crystal') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.8 6.6 3.4 11.4 5.2 21h3.6l.9-9.6z" fill="#2b93d6"/><path d="M17.2 6.2 20.6 10.9 18.8 21h-3.6l-.9-10.1z" fill="#2b93d6"/><path d="M12 1.4 16.6 8 14.7 21H9.3L7.4 8z" fill="#56c4f7"/><path d="M12 1.4 7.4 8 9.3 21h2.2z" fill="#d2f7ff"/></svg>';
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
      seenTraits: {},
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
      if (parsed.seenTraits && typeof parsed.seenTraits === 'object') {
        Object.keys(C.TRAITS).forEach(function (id) {
          if (parsed.seenTraits[id]) merged.seenTraits[id] = true;
        });
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

  function detectDebugMode() {
    try {
      const params = new URLSearchParams(window.location.search);
      const flag = params.get('debug');
      if (flag === '1' || flag === 'true' || flag === 'on') return true;
      if (flag === '0' || flag === 'false' || flag === 'off') return false;
      const stored = window.localStorage.getItem(DEBUG_KEY);
      if (stored === '1') return true;
      if (stored === '0') return false;
    } catch (error) {
      // Fall through to the local-host heuristic.
    }
    const host = window.location.hostname;
    return window.location.protocol === 'file:' ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '';
  }

  const debug = {
    enabled: detectDebugMode(),
    godMode: false,
    freeBuild: false,
    panelOpen: false,
  };

  // Debug command line (REPL) state. Lives outside #debug-body so panel
  // re-renders never wipe history or the log.
  const debugCli = { history: [], historyIndex: -1 };

  /* ============================================================
     Immersive shell: fullscreen API, standalone PWA mode, viewport
     height and wake lock. Mobile is the primary target: the browser
     chrome should disappear the moment a sector starts.
     ============================================================ */
  const IMMERSIVE_KEY = 'vector_geotd_immersive_v1';
  const IMMERSIVE_TOUCH = (function () {
    try {
      return window.matchMedia('(pointer: coarse)').matches;
    } catch (error) {
      return false;
    }
  })();
  const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  // Capture this before any requestFullscreen(): while a normal tab is
  // fullscreen, `display-mode` also reads "fullscreen" and would
  // otherwise be mistaken for an installed app.
  const LAUNCHED_STANDALONE = (function () {
    try {
      if (window.navigator.standalone === true) return true;
      return !!(window.matchMedia &&
        window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches);
    } catch (error) {
      return false;
    }
  })();

  function immersiveUrlOverride() {
    try {
      const flag = new URLSearchParams(window.location.search).get('immersive');
      if (flag === '1' || flag === 'true' || flag === 'on') return true;
      if (flag === '0' || flag === 'false' || flag === 'off') return false;
    } catch (error) {
      // Ignore malformed query strings.
    }
    return null;
  }

  const IMMERSIVE_OVERRIDE = immersiveUrlOverride();

  function loadImmersivePreference() {
    if (IMMERSIVE_OVERRIDE !== null) return IMMERSIVE_OVERRIDE;
    try {
      const stored = window.localStorage.getItem(IMMERSIVE_KEY);
      if (stored === '1') return true;
      if (stored === '0') return false;
    } catch (error) {
      // Storage is optional; fall through to the device default.
    }
    return IMMERSIVE_TOUCH;
  }

  const immersive = {
    pref: loadImmersivePreference(),
    active: false,
    wakeLock: null,
    requestedExit: false,
  };

  function fullscreenSupported() {
    const el = document.documentElement;
    return typeof el.requestFullscreen === 'function' ||
      typeof el.webkitRequestFullscreen === 'function' ||
      typeof el.msRequestFullscreen === 'function';
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
  }

  function standaloneLaunch() {
    return LAUNCHED_STANDALONE;
  }

  function setImmersivePreference(value) {
    immersive.pref = !!value;
    try {
      window.localStorage.setItem(IMMERSIVE_KEY, value ? '1' : '0');
    } catch (error) {
      // Preference is best-effort.
    }
  }

  function refreshImmersiveButtons() {
    document.body.classList.toggle('is-immersive', immersive.active);
    const installed = standaloneLaunch();
    $$('.immersive-toggle').forEach(function (button) {
      button.classList.toggle('immersive-on', immersive.active);
      button.classList.toggle('hidden', installed);
      button.setAttribute('aria-pressed', immersive.active ? 'true' : 'false');
    });
    const homeButton = $('home-immersive');
    if (homeButton) {
      homeButton.setAttribute('aria-label', immersive.active ? '退出全屏沉浸模式' : '进入全屏沉浸模式');
      homeButton.title = immersive.active ? '退出全屏' : '全屏沉浸';
    }
    const pauseButton = $('btn-pause-immersive');
    if (pauseButton) {
      pauseButton.setAttribute('aria-label', immersive.active ? '退出全屏' : '进入全屏');
      pauseButton.title = immersive.active ? '退出全屏' : '全屏';
    }
  }

  function syncViewportHeight() {
    const vv = window.visualViewport;
    const height = vv && vv.height > 0 ? vv.height : window.innerHeight;
    if (!(height > 0)) return;
    document.documentElement.style.setProperty('--app-height', Math.round(height) + 'px');
  }

  let viewportSyncFrame = 0;

  function scheduleViewportSync() {
    if (viewportSyncFrame) return;
    viewportSyncFrame = window.requestAnimationFrame(function () {
      viewportSyncFrame = 0;
      syncViewportHeight();
      ambient.resize();
      if (activeScreen === 'game') fitArena();
    });
  }

  function lockPortrait() {
    if (!IMMERSIVE_TOUCH || !window.screen || !window.screen.orientation) return;
    const orientation = window.screen.orientation;
    if (typeof orientation.lock !== 'function') return;
    try {
      const result = orientation.lock('portrait');
      if (result && typeof result.catch === 'function') result.catch(function () {});
    } catch (error) {
      // Orientation lock is unavailable on most desktop and iOS browsers.
    }
  }

  function unlockOrientation() {
    if (!window.screen || !window.screen.orientation) return;
    if (typeof window.screen.orientation.unlock !== 'function') return;
    try {
      window.screen.orientation.unlock();
    } catch (error) {
      // Ignore unsupported unlock calls.
    }
  }

  function requestWakeLock() {
    if (!('wakeLock' in navigator) || immersive.wakeLock) return;
    if (!immersive.active && !IMMERSIVE_TOUCH) return;
    if (activeScreen !== 'game' || !currentGame || currentGame.paused) return;
    if (document.visibilityState !== 'visible') return;
    try {
      navigator.wakeLock.request('screen').then(function (lock) {
        immersive.wakeLock = lock;
        lock.addEventListener('release', function () {
          if (immersive.wakeLock === lock) immersive.wakeLock = null;
        });
      }).catch(function () {
        // Wake lock can be denied by power saving settings.
      });
    } catch (error) {
      // Older browsers expose no wake lock.
    }
  }

  function releaseWakeLock() {
    const lock = immersive.wakeLock;
    immersive.wakeLock = null;
    if (!lock || typeof lock.release !== 'function') return;
    try {
      lock.release();
    } catch (error) {
      // The lock may already be gone.
    }
  }

  function showImmersiveHint() {
    if (standaloneLaunch()) return;
    if (IS_IOS) {
      showGlobalToast('iPhone / iPad：分享 → 添加到主屏幕，即可全屏启动', 'info', 5600);
    } else {
      showGlobalToast('当前浏览器不支持网页全屏，请使用系统浏览器全屏', 'error', 3600);
    }
  }

  function enterImmersive(options) {
    const silent = !!(options && options.silent);
    if (standaloneLaunch()) {
      immersive.active = true;
      refreshImmersiveButtons();
      return Promise.resolve(true);
    }
    if (fullscreenElement()) return Promise.resolve(true);
    if (!fullscreenSupported()) {
      if (silent) {
        if (IS_IOS && !immersive.hintShown) {
          immersive.hintShown = true;
          showImmersiveHint();
        }
      } else {
        showImmersiveHint();
      }
      return Promise.resolve(false);
    }
    const el = document.documentElement;
    let result = null;
    try {
      if (typeof el.requestFullscreen === 'function') result = el.requestFullscreen({ navigationUI: 'hide' });
      else if (typeof el.webkitRequestFullscreen === 'function') result = el.webkitRequestFullscreen();
      else if (typeof el.msRequestFullscreen === 'function') result = el.msRequestFullscreen();
    } catch (error) {
      result = null;
    }
    return Promise.resolve(result).then(function () {
      // Some embedded browsers resolve the request without dispatching
      // fullscreenchange; sync once so the HUD/class state is correct.
      syncImmersiveState();
      return true;
    }).catch(function () {
      if (!silent) showImmersiveHint();
      return false;
    });
  }

  function exitImmersive() {
    if (!fullscreenElement()) return;
    immersive.requestedExit = true;
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (typeof exit !== 'function') return;
    try {
      const result = exit.call(document);
      if (result && typeof result.then === 'function') {
        result.then(syncImmersiveState).catch(function () {});
      } else {
        window.setTimeout(syncImmersiveState, 60);
      }
    } catch (error) {
      // Ignore browsers that reject the exit call.
    }
  }

  function toggleImmersive() {
    if (immersive.active) {
      setImmersivePreference(false);
      if (standaloneLaunch()) {
        showGlobalToast('当前已通过主屏幕应用模式全屏运行', 'info', 3200);
      } else {
        exitImmersive();
      }
    } else {
      setImmersivePreference(true);
      enterImmersive();
    }
    audio.play('ui');
  }

  function maybeAutoImmersive() {
    if (immersive.active || standaloneLaunch()) return;
    if (!immersive.pref) return;
    if (!IMMERSIVE_TOUCH && IMMERSIVE_OVERRIDE !== true) return;
    // Must run inside the tap that starts the level so the browser
    // treats it as a user gesture.
    enterImmersive({ silent: true });
  }

  function syncImmersiveState() {
    const active = !!fullscreenElement() || standaloneLaunch();
    if (active === immersive.active) {
      refreshImmersiveButtons();
      return;
    }
    immersive.active = active;
    if (!active) {
      if (!immersive.requestedExit) {
        // The player left fullscreen with the system gesture / Esc.
        setImmersivePreference(false);
      }
      immersive.requestedExit = false;
      unlockOrientation();
      releaseWakeLock();
    } else {
      immersive.requestedExit = false;
      lockPortrait();
      requestWakeLock();
    }
    refreshImmersiveButtons();
    syncViewportHeight();
    ambient.resize();
    if (activeScreen === 'game') fitArena();
    if (currentGame) currentGame.resize();
  }

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
  let waveIntelTimer = 0;
  let resetArmTimer = 0;
  let resetArmed = false;
  let levelIntroTimer = 0;
  let helpLastFocus = null;
  let lastFrame = performance.now();
  let globalToastEl = null;
  let globalToastTimer = 0;
  let onboardingPause = false;
  let pendingTraitTraits = [];

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
    pauseBar: $('pause-actions'),
    hud: document.querySelector('.game-hud'),
    pauseButton: $('btn-game-pause'),
    traitBriefing: $('trait-briefing'),
    traitBriefingTitle: $('trait-briefing-title'),
    traitBriefingLead: $('trait-briefing-lead'),
    traitBriefingList: $('trait-briefing-list'),
    traitBriefingClose: $('btn-trait-close'),
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
    coreValue: $('hud-core-value'),
    coreDelta: $('hud-core-delta'),
    coreReadout: $('core-readout'),
    coreAlert: $('core-alert'),
    coreAlertTitle: $('core-alert-title'),
    coreAlertSub: $('core-alert-sub'),
    crystals: $('hud-crystals'),
    crystalDelta: $('hud-crystal-delta'),
    wave: $('hud-wave'),
    waveStatus: $('wave-status'),
    waveStatusKicker: $('wave-status-kicker'),
    waveStatusValue: $('wave-status-value'),
    waveStatusProgress: $('wave-status-progress'),
    waveIntel: $('wave-intel'),
    waveIntelBody: $('wave-intel-body'),
    waveIntelKicker: $('wave-intel-kicker'),
    waveIntelClose: $('wave-intel-close'),
    speedLabel: $('speed-label'),
    gameScreen: $('screen-game'),
    placementLegend: $('placement-legend'),
    skillsGoldBig: $('skills-gold-big'),
    skillsReset: $('btn-skills-reset'),
    skillResetLabel: $('skill-reset-label'),
    skillResetRefund: $('skill-reset-refund'),
    helpEnemyList: $('help-enemy-list'),
    helpTowerList: $('help-tower-list'),
    helpTraitList: $('help-trait-list'),
    debugPanel: $('debug-panel'),
    debugBody: $('debug-body'),
    debugFab: $('debug-fab'),
    debugHud: $('btn-game-debug'),
    debugBadge: $('hud-debug-badge'),
    debugClose: $('debug-close'),
    debugCliLog: $('debug-cli-log'),
    debugCliForm: $('debug-cli-form'),
    debugCliInput: $('debug-cli-input'),
  };

  ['home', 'levels', 'skills', 'game'].forEach(function (name) {
    els.screens[name] = $('screen-' + name);
  });

  // Brief only the traits that are actually introduced by a level, not the
  // baseline armor/weakness carried by early enemies.
  const TRAIT_BRIEFING_ORDER = ['split', 'energyResist', 'shield', 'stealth', 'ward', 'tenacity', 'boss'];
  const TRAIT_INTRO_LEVELS = (function () {
    const intro = {};
    for (let i = 0; i < C.LEVELS.length; i++) {
      const level = C.LEVELS[i];
      for (let w = 0; w < level.waves.length; w++) {
        const groups = level.waves[w].groups || [];
        for (let g = 0; g < groups.length; g++) {
          const enemy = C.ENEMIES[groups[g].type];
          if (!enemy || !enemy.traits) continue;
          for (let t = 0; t < enemy.traits.length; t++) {
            const id = enemy.traits[t];
            if (TRAIT_BRIEFING_ORDER.indexOf(id) < 0) continue;
            if (!intro[id] || level.id < intro[id]) intro[id] = level.id;
          }
        }
      }
    }
    return intro;
  })();

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
      baseHp: (save.skills.core || 0) * 20,
      crystalMult: 1 + (save.skills.crystal || 0) * 0.1,
      damageMult: 1 + (save.skills.overclock || 0) * 0.08,
      costMult: 1 - (save.skills.build || 0) * 0.05,
      enemySpeedMult: 1 - (save.skills.stasis || 0) * 0.04,
      repair: (save.skills.repair || 0) * 6,
      startCrystals: (save.skills.start || 0) * 25,
      godMode: debug.enabled && debug.godMode,
      freeBuild: debug.enabled && debug.freeBuild,
    };
  }

  function skillEffectText(skill, rank) {
    if (rank <= 0) return '尚未激活';
    if (skill.id === 'core') return '+' + rank * skill.per + ' 完整度';
    if (skill.id === 'repair') return '+' + rank * skill.per + ' / 波';
    if (skill.id === 'start') return '+' + rank * skill.per + ' 晶元';
    // Reduction skills (建造协议 / 静滞场域) must display a minus sign.
    if (skill.id === 'build' || skill.id === 'stasis') return '-' + rank * skill.per + '%';
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

  function grantDebugGold() {
    if (!debug.enabled) return 0;
    let granted = false;
    try {
      granted = window.localStorage.getItem(DEBUG_GOLD_KEY) === '1';
    } catch (error) {
      granted = false;
    }
    if (granted) return 0;
    try {
      window.localStorage.setItem(DEBUG_GOLD_KEY, '1');
    } catch (error) {
      // The grant still applies for this session when storage is unavailable.
    }
    save.gold += DEBUG_GOLD_AMOUNT;
    persist();
    refreshMeta();
    return DEBUG_GOLD_AMOUNT;
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
    updateDebugChrome();
    updateResumeUI();
  }

  function refreshGameLayout() {
    if (activeScreen !== 'game') return;
    window.requestAnimationFrame(function () {
      fitArena();
      if (currentGame) currentGame.resize();
    });
  }

  function suspendedRunInfo() {
    if (!currentGame || activeScreen === 'game') return null;
    if (!els.resultOverlay || !els.resultOverlay.classList.contains('hidden')) return null;
    if (currentGame.phase === 'victory' || currentGame.phase === 'defeat') return null;
    const level = C.LEVELS[(currentLevelId || 1) - 1];
    if (!level) return null;
    const state = currentGame.getHudState();
    return {
      level: level,
      wave: Math.max(1, state.wave || 1),
      total: state.totalWaves,
      running: state.phase === 'wave',
    };
  }

  function updateResumeUI() {
    const info = suspendedRunInfo();
    const buttons = [$('btn-home-resume'), $('btn-levels-resume')];
    buttons.forEach(function (button) {
      if (button) button.classList.toggle('hidden', !info);
    });
    if (!info) return;
    const meta = info.level.code + ' ' + info.level.name + ' · 第 ' + info.wave + ' / ' + info.total + ' 波 · ' + (info.running ? '交战中' : '待发兵');
    $$('[data-resume-title]').forEach(function (node) {
      node.textContent = '继续作战';
    });
    $$('[data-resume-meta]').forEach(function (node) {
      node.textContent = meta;
    });
    buttons.forEach(function (button) {
      if (button) button.setAttribute('aria-label', '继续作战：' + info.level.name + '，第 ' + info.wave + ' 波');
    });
  }

  function suspendCurrentRun() {
    if (!currentGame) return false;
    currentGame.setPaused(true);
    hidePauseBar();
    hideWaveIntel();
    updatePauseButton(true);
    releaseWakeLock();
    return true;
  }

  function resumeSuspendedRun() {
    if (!currentGame) {
      openLevels();
      return;
    }
    closeDebugPanel();
    closeHelp();
    hideWaveIntel();
    showScreen('game');
    fitArena();
    window.requestAnimationFrame(function () {
      fitArena();
      if (!currentGame) return;
      currentGame.resize();
      currentGame.refreshUI();
      updateHud(currentGame.getHudState());
      updateBuildAffordability();
      renderIntel({ mode: 'none' });
      if (currentGame.paused) openPause();
      else hidePauseBar();
    });
    audio.ensure();
    audio.play('ui');
  }

  function traitBriefingsForLevel(levelId) {
    return TRAIT_BRIEFING_ORDER.filter(function (id) {
      return TRAIT_INTRO_LEVELS[id] === levelId && !save.seenTraits[id];
    }).map(function (id) {
      return C.TRAITS[id];
    });
  }

  function maybeShowTraitBriefing() {
    if (!pendingTraitTraits.length || !els.traitBriefing) return;
    if (!els.onboarding.classList.contains('hidden')) return;
    if (!els.resultOverlay.classList.contains('hidden')) return;
    const level = C.LEVELS[(currentLevelId || 1) - 1];
    const traits = pendingTraitTraits.slice();
    if (els.traitBriefingTitle) {
      els.traitBriefingTitle.textContent = traits.length > 1 ? '新特性 × ' + traits.length : '新特性 · ' + traits[0].name;
    }
    if (els.traitBriefingLead) {
      els.traitBriefingLead.textContent = level && level.intel
        ? level.intel
        : '本星区出现新的敌人特性。先读简报，再调整防御阵列。';
    }
    if (els.traitBriefingList) {
      els.traitBriefingList.innerHTML = traits.map(function (trait) {
        return (
          '<div class="trait-brief-item" style="--trait-color:' + trait.color + '">' +
            '<span class="trait-brief-badge" aria-hidden="true">' + trait.short + '</span>' +
            '<div class="trait-brief-copy">' +
              '<b>' + trait.name + '</b>' +
              '<p>' + trait.desc + '</p>' +
              '<span class="trait-brief-counter">克制：<b>' + trait.counter + '</b></span>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    }
    els.traitBriefing.classList.remove('hidden');
    if (currentGame) {
      currentGame.setPaused(true);
      showPauseBar();
    }
    audio.play('warning');
  }

  function closeTraitBriefing() {
    if (!els.traitBriefing || els.traitBriefing.classList.contains('hidden')) return;
    pendingTraitTraits.forEach(function (trait) {
      save.seenTraits[trait.id] = true;
    });
    pendingTraitTraits = [];
    persist();
    els.traitBriefing.classList.add('hidden');
    refreshGameLayout();
    audio.play('ui');
  }

  /* ============================================================
     Debug mode
     ============================================================ */
  function updateDebugChrome() {
    document.body.classList.toggle('debug-enabled', debug.enabled);
    if (els.debugBadge) els.debugBadge.classList.toggle('hidden', !debug.enabled);
    if (els.debugFab) {
      els.debugFab.classList.toggle('hidden', !debug.enabled);
      els.debugFab.textContent = debug.panelOpen ? 'CLOSE' : 'DEBUG';
    }
    if (els.debugHud) {
      els.debugHud.classList.toggle('hidden', !debug.enabled || activeScreen !== 'game');
    }
    if (debug.panelOpen) renderDebugPanel();
  }

  function setDebugMode(enabled) {
    debug.enabled = !!enabled;
    let granted = 0;
    if (!debug.enabled) {
      debug.godMode = false;
      debug.freeBuild = false;
      if (currentGame) {
        currentGame.setGodMode(false);
        currentGame.setFreeBuild(false);
      }
      closeDebugPanel();
    } else {
      granted = grantDebugGold();
    }
    try {
      window.localStorage.setItem(DEBUG_KEY, debug.enabled ? '1' : '0');
    } catch (error) {
      // Debug preference is optional.
    }
    updateDebugChrome();
    renderLevelList();
    refreshMeta();
    renderDebugPanel();
    if (debug.enabled) {
      showGlobalToast(granted ? '调试模式已开启 · 已赠送 ' + U.formatInt(granted) + ' 金币' : '调试模式已开启', 'success');
    } else {
      showGlobalToast('调试模式已关闭', 'info');
    }
  }

  function openDebugPanel() {
    if (!debug.enabled) return;
    debug.panelOpen = true;
    renderDebugPanel();
    if (els.debugCliLog && !els.debugCliLog.childNodes.length) {
      debugCliPrint('[VECTOR CLI] 调试命令行就绪，输入 help 查看命令。', 'muted');
    }
    if (els.debugPanel) els.debugPanel.classList.remove('hidden');
    updateDebugChrome();
    audio.play('ui');
  }

  function closeDebugPanel() {
    debug.panelOpen = false;
    if (els.debugPanel) els.debugPanel.classList.add('hidden');
    updateDebugChrome();
  }

  function toggleDebugPanel() {
    if (debug.panelOpen) closeDebugPanel();
    else openDebugPanel();
  }

  function debugLevelButtons() {
    return C.LEVELS.map(function (level) {
      const active = currentLevelId === level.id;
      return (
        '<button class="debug-level' + (active ? ' active' : '') + '" type="button" data-debug-level="' + level.id + '">' +
          '<b>' + pad2(level.id) + '</b><small>' + level.name + '</small>' +
        '</button>'
      );
    }).join('');
  }

  function debugEnemyButtons() {
    return C.ENEMY_ORDER.filter(function (type) {
      return type !== 'shard';
    }).map(function (type) {
      const def = C.ENEMIES[type];
      return (
        '<button class="debug-enemy" type="button" data-debug-spawn="' + type + '" style="--enemy-color:' + def.color + '" title="' + def.name + ' · ' + def.tag + '">' +
          '<i></i><span>' + def.name + '</span>' +
        '</button>'
      );
    }).join('');
  }

  function renderDebugPanel() {
    if (!els.debugBody) return;
    if (!debug.enabled) {
      els.debugBody.innerHTML = '';
      return;
    }
    const game = currentGame;
    const disabled = game ? '' : ' disabled';
    const state = game ? game.getHudState() : null;
    const status = game ? game.debugStatus() : null;
    const statusHtml = status
      ? (
        '<div class="debug-stat"><span>阶段</span><b>' + status.phase + '</b></div>' +
        '<div class="debug-stat"><span>波次</span><b>' + status.wave + ' / ' + status.totalWaves + '</b></div>' +
        '<div class="debug-stat"><span>核心</span><b>' + status.baseHp + ' / ' + status.baseMax + '</b></div>' +
        '<div class="debug-stat"><span>晶元</span><b>' + U.formatInt(status.crystals) + '</b></div>' +
        '<div class="debug-stat"><span>敌军</span><b>' + status.enemies + '</b></div>' +
        '<div class="debug-stat"><span>防御塔</span><b>' + status.towers + '</b></div>'
      )
      : '<p class="debug-note">尚未进入战斗。选择上方关卡即可直达任意星区。</p>';
    let skillTotal = 0;
    for (let i = 0; i < C.SKILLS.length; i++) skillTotal += save.skills[C.SKILLS[i].id] || 0;
    const levelInfo = state
      ? '第 ' + state.wave + ' / ' + state.totalWaves + ' 波'
      : (currentLevelId ? 'SECTOR ' + pad2(currentLevelId) : '星图待命');
    els.debugBody.innerHTML =
      '<section class="debug-section">' +
        '<h4>关卡直达 <span>' + levelInfo + '</span></h4>' +
        '<div class="debug-levels">' + debugLevelButtons() + '</div>' +
        '<div class="debug-actions">' +
          '<button type="button" data-debug-action="unlock-all">解锁全部星区</button>' +
          '<button type="button" data-debug-action="add-gold">+1000 金币</button>' +
        '</div>' +
      '</section>' +
      '<section class="debug-section">' +
        '<h4>技能加点 <span>' + skillTotal + ' / ' + (C.SKILLS.length * C.SKILL_MAX) + '</span></h4>' +
        '<div class="debug-actions">' +
          '<button type="button" data-debug-action="max-skills">全技能 5 阶</button>' +
          '<button type="button" data-debug-action="reset-skills">技能清零</button>' +
        '</div>' +
        '<p class="debug-note">调试模式初始赠送 10000 金币；技能升级按正常费用消耗，可在技能矩阵重置并全额返还。</p>' +
      '</section>' +
      '<section class="debug-section">' +
        '<h4>局内控制</h4>' +
        '<div class="debug-toggles">' +
          '<button type="button" class="debug-toggle" data-debug-toggle="god" aria-pressed="' + (debug.godMode ? 'true' : 'false') + '">无敌核心</button>' +
          '<button type="button" class="debug-toggle" data-debug-toggle="free" aria-pressed="' + (debug.freeBuild ? 'true' : 'false') + '">免费建造 / 升级</button>' +
        '</div>' +
        '<div class="debug-actions">' +
          '<button type="button" data-debug-action="add-crystals"' + disabled + '>+500 晶元</button>' +
          '<button type="button" data-debug-action="heal-core"' + disabled + '>修复核心 +50</button>' +
          '<button type="button" data-debug-action="max-towers"' + disabled + '>攻击塔 5 级</button>' +
          '<button type="button" data-debug-action="prep-30"' + disabled + '>准备时间 30s</button>' +
        '</div>' +
        '<div class="debug-actions">' +
          '<button type="button" data-debug-action="next-wave"' + disabled + '>立即发兵</button>' +
          '<button type="button" data-debug-action="kill-all"' + disabled + '>清空敌军</button>' +
          '<button type="button" class="danger" data-debug-action="win"' + disabled + '>直接胜利</button>' +
          '<button type="button" class="danger" data-debug-action="lose"' + disabled + '>直接失败</button>' +
        '</div>' +
      '</section>' +
      '<section class="debug-section">' +
        '<h4>测试敌群 <span>×5</span></h4>' +
        '<div class="debug-enemies">' + debugEnemyButtons() + '</div>' +
        '<p class="debug-note">在局内点击生成 5 个测试单位；准备阶段点击会自动进入交战。</p>' +
      '</section>' +
      '<section class="debug-section">' +
        '<h4>实时状态</h4>' +
        '<div class="debug-status" id="debug-status">' + statusHtml + '</div>' +
        '<p class="debug-note">快捷键：Ctrl + Shift + D 开关调试模式；?debug=1 强制开启。</p>' +
      '</section>';
    refreshDebugStatus();
  }

  function refreshDebugStatus() {
    if (!debug.panelOpen || !debug.enabled) return;
    const target = $('debug-status');
    if (!target) return;
    if (!currentGame) {
      target.innerHTML = '<p class="debug-note">尚未进入战斗。选择上方关卡即可直达任意星区。</p>';
      return;
    }
    const s = currentGame.debugStatus();
    target.innerHTML =
      '<div class="debug-stat"><span>阶段</span><b>' + s.phase + '</b></div>' +
      '<div class="debug-stat"><span>波次</span><b>' + s.wave + ' / ' + s.totalWaves + '</b></div>' +
      '<div class="debug-stat"><span>核心</span><b>' + s.baseHp + ' / ' + s.baseMax + '</b></div>' +
      '<div class="debug-stat"><span>晶元</span><b>' + U.formatInt(s.crystals) + '</b></div>' +
      '<div class="debug-stat"><span>敌军</span><b>' + s.enemies + '</b></div>' +
      '<div class="debug-stat"><span>防御塔</span><b>' + s.towers + '</b></div>';
  }

  /* ============================================================
     Debug command line (REPL)
     Lives outside #debug-body so panel re-renders keep the log.
     ============================================================ */
  function debugCliPrint(text, cls) {
    if (!els.debugCliLog) return;
    const line = document.createElement('div');
    line.className = 'debug-cli-line' + (cls ? ' ' + cls : '');
    line.textContent = text;
    els.debugCliLog.appendChild(line);
    while (els.debugCliLog.childNodes.length > 120) {
      els.debugCliLog.removeChild(els.debugCliLog.firstChild);
    }
    els.debugCliLog.scrollTop = els.debugCliLog.scrollHeight;
  }

  function debugCliExec(raw) {
    const input = String(raw || '').trim();
    if (!input) return;
    debugCli.history.push(input);
    if (debugCli.history.length > 50) debugCli.history.shift();
    debugCli.historyIndex = -1;
    debugCliPrint('> ' + input, 'input');
    try {
      const result = debugCliRun(input);
      if (result) debugCliPrint(result, 'out');
    } catch (error) {
      debugCliPrint('ERR: ' + (error && error.message ? error.message : String(error)), 'error');
    }
  }

  function debugCliRun(raw) {
    const parts = raw.split(/\s+/);
    const cmd = (parts[0] || '').toLowerCase();
    const args = parts.slice(1);
    const num = function (i, fallback) {
      const value = Number(args[i]);
      return Number.isFinite(value) ? value : fallback;
    };
    const game = currentGame;
    const needGame = function () {
      if (!game) throw new Error('尚未进入战斗，先用 level <id> 进入星区');
      return game;
    };
    const flag = function (i, current) {
      const value = arg(i);
      if (value === 'on' || value === '1' || value === 'true') return true;
      if (value === 'off' || value === '0' || value === 'false') return false;
      return !current;
    };
    function arg(i) { return (args[i] || '').toLowerCase(); }

    switch (cmd) {
      case 'help':
        return [
          '可用命令：',
          '  status               当前局摘要',
          '  gold [n]             金币 +n（默认 1000）',
          '  crystals [n]         晶元 +n（默认 500）',
          '  heal [n]             核心修复 +n（默认 50）',
          '  spawn <type> [n]     生成敌群（默认 5）',
          '  towers               攻击塔全部升满',
          '  wave                 立即发下一波',
          '  kill                 清空敌军',
          '  win / lose           直接判定胜负',
          '  god [on|off]         无敌核心（缺省切换）',
          '  free [on|off]        免费建造（缺省切换）',
          '  skill <id> <rank>    设置技能阶数（0-' + C.SKILL_MAX + '）',
          '  skills max|reset     全技能满阶 / 清零',
          '  unlock               解锁全部星区',
          '  level <id>           直达星区（1-' + C.LEVELS.length + '）',
          '  speed <1|2|3>        战斗倍速',
          '  clear                清空本日志',
        ].join('\n');
      case 'status': {
        if (!game) return '尚未进入战斗。';
        const s = game.debugStatus();
        return '阶段 ' + s.phase + ' · 波次 ' + s.wave + '/' + s.totalWaves +
          ' · 核心 ' + s.baseHp + '/' + s.baseMax +
          ' · 晶元 ' + U.formatInt(s.crystals) +
          ' · 敌军 ' + s.enemies + ' · 防御塔 ' + s.towers;
      }
      case 'gold': {
        const amount = Math.floor(num(0, 1000));
        if (amount <= 0) return '金额需为正数。';
        save.gold += amount;
        persist();
        refreshMeta();
        showGlobalToast('金币 +' + amount, 'success');
        return '金币 +' + amount + '（当前 ' + U.formatInt(save.gold) + '）';
      }
      case 'crystals': case 'c': {
        needGame();
        const amount = Math.max(0, Math.floor(num(0, 500)));
        const total = game.debugAddCrystals(amount);
        showGlobalToast('晶元 +' + amount, 'success');
        return '晶元 +' + amount + '（当前 ' + U.formatInt(total) + '）';
      }
      case 'heal': {
        needGame();
        const healed = game.debugHealCore(num(0, 50));
        showGlobalToast('核心修复 +' + healed, 'success');
        return '核心修复 +' + healed;
      }
      case 'spawn': {
        needGame();
        const type = arg(0);
        if (!type || !C.ENEMIES[type] || type === 'shard') {
          return '未知敌人类型：' + (type || '(空)') + '。可用：' + C.ENEMY_ORDER.filter(function (t) { return t !== 'shard'; }).join(', ');
        }
        const count = num(1, 5);
        const ok = game.debugSpawn(type, count);
        refreshDebugStatus();
        return ok ? '已生成 ' + count + ' 个 ' + C.ENEMIES[type].name : '生成失败（战斗已结束）';
      }
      case 'towers': {
        needGame();
        const count = game.debugMaxTowers();
        showGlobalToast('已将 ' + count + ' 座攻击塔升满（灯塔不参与）', 'success');
        return '已升满 ' + count + ' 座攻击塔。';
      }
      case 'wave': {
        needGame();
        const started = game.debugNextWave();
        return started ? '已立即发兵。' : '当前无法发兵（仅准备阶段可用）。';
      }
      case 'kill': {
        needGame();
        const killed = game.debugKillAll();
        refreshDebugStatus();
        return '已清除 ' + killed + ' 个敌军。';
      }
      case 'win': {
        needGame();
        return game.debugWin() ? '判定胜利。' : '战斗已有结果。';
      }
      case 'lose': {
        needGame();
        return game.debugLose() ? '判定失败。' : '战斗已有结果。';
      }
      case 'god': {
        needGame();
        debug.godMode = flag(0, debug.godMode);
        game.setGodMode(debug.godMode);
        renderDebugPanel();
        return '无敌核心：' + (debug.godMode ? 'ON' : 'OFF');
      }
      case 'free': {
        needGame();
        debug.freeBuild = flag(0, debug.freeBuild);
        game.setFreeBuild(debug.freeBuild);
        renderDebugPanel();
        return '免费建造：' + (debug.freeBuild ? 'ON' : 'OFF');
      }
      case 'skill': {
        const id = arg(0);
        if (!id || !save.skills.hasOwnProperty(id)) {
          return '未知技能 id。可用：' + C.SKILLS.map(function (s) { return s.id; }).join(', ');
        }
        const rank = U.clamp(Math.floor(num(1, C.SKILL_MAX)), 0, C.SKILL_MAX);
        save.skills[id] = rank;
        persist();
        refreshMeta();
        renderSkills();
        renderDebugPanel();
        return '技能 ' + id + ' → ' + rank + ' 阶。';
      }
      case 'skills': {
        const mode = arg(0) || 'max';
        if (mode === 'reset') {
          debugSetAllSkills(0);
          return '全部技能已清零并返还金币。';
        }
        if (mode === 'max') {
          debugSetAllSkills(C.SKILL_MAX);
          return '全部技能已提升至 ' + C.SKILL_MAX + ' 阶。';
        }
        return '用法：skills max|reset';
      }
      case 'unlock': {
        save.unlocked = C.LEVELS.length;
        persist();
        refreshMeta();
        renderLevelList();
        showGlobalToast('已解锁全部星区', 'success');
        return '已解锁全部 ' + C.LEVELS.length + ' 个星区。';
      }
      case 'level': {
        const levelId = Math.floor(num(0, 0));
        if (!C.LEVELS[levelId - 1]) return '星区编号需为 1-' + C.LEVELS.length + '。';
        startLevel(levelId);
        return '进入 SECTOR ' + pad2(levelId) + ' · ' + C.LEVELS[levelId - 1].name;
      }
      case 'speed': {
        const value = Math.floor(num(0, 1));
        if (value !== 1 && value !== 2 && value !== 3) return '倍速仅支持 1 / 2 / 3。';
        gameSpeed = value;
        if (currentGame) currentGame.setSpeed(value);
        els.speedLabel.textContent = '×' + value;
        return '战斗倍速 ×' + value;
      }
      case 'clear': {
        if (els.debugCliLog) els.debugCliLog.innerHTML = '';
        return null;
      }
      default:
        return '未知命令：' + cmd + '。输入 help 查看命令。';
    }
  }

  function bindDebugCli() {
    if (els.debugCliForm) {
      els.debugCliForm.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!debug.enabled) return;
        const input = els.debugCliInput;
        if (!input) return;
        debugCliExec(input.value);
        input.value = '';
        input.focus();
      });
    }
    if (els.debugCliInput) {
      els.debugCliInput.addEventListener('keydown', function (event) {
        // Escape bubbles up so the document handler can still close the panel.
        if (event.key === 'Escape') return;
        // Keep battlefield shortcuts (P / W / 1-9 / Space) out of the CLI.
        event.stopPropagation();
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          if (!debugCli.history.length) return;
          if (debugCli.historyIndex === -1) debugCli.historyIndex = debugCli.history.length;
          debugCli.historyIndex = U.clamp(
            debugCli.historyIndex + (event.key === 'ArrowUp' ? -1 : 1),
            0,
            debugCli.history.length
          );
          const entry = debugCli.historyIndex === debugCli.history.length
            ? ''
            : debugCli.history[debugCli.historyIndex];
          if (els.debugCliInput) els.debugCliInput.value = entry;
        }
      });
    }
  }

  function debugSetAllSkills(rank) {
    for (let i = 0; i < C.SKILLS.length; i++) {
      save.skills[C.SKILLS[i].id] = U.clamp(rank, 0, C.SKILL_MAX);
    }
    persist();
    refreshMeta();
    renderSkills();
  }

  function handleDebugAction(action, target) {
    if (!debug.enabled) return;
    if (action === 'unlock-all') {
      save.unlocked = C.LEVELS.length;
      persist();
      refreshMeta();
      renderLevelList();
      showGlobalToast('已解锁全部星区', 'success');
    } else if (action === 'add-gold') {
      save.gold += 1000;
      persist();
      refreshMeta();
      showGlobalToast('金币 +1000', 'success');
    } else if (action === 'max-skills') {
      debugSetAllSkills(C.SKILL_MAX);
      showGlobalToast('全部技能已提升至 5 阶', 'success');
    } else if (action === 'reset-skills') {
      debugSetAllSkills(0);
      showGlobalToast('技能已重置', 'info');
    } else if (action === 'add-crystals' && currentGame) {
      currentGame.debugAddCrystals(500);
      showGlobalToast('晶元 +500', 'success');
    } else if (action === 'heal-core' && currentGame) {
      const healed = currentGame.debugHealCore(50);
      showGlobalToast('核心修复 +' + healed, 'success');
    } else if (action === 'max-towers' && currentGame) {
      const count = currentGame.debugMaxTowers();
      showGlobalToast('已将 ' + count + ' 座攻击塔提升至 5 级（灯塔不参与）', 'success');
    } else if (action === 'prep-30' && currentGame) {
      currentGame.debugSetPrep(30);
      showGlobalToast('准备时间已设为 30 秒', 'info');
    } else if (action === 'next-wave' && currentGame) {
      const started = currentGame.debugNextWave();
      showGlobalToast(started ? '已立即发兵' : '当前无法发兵（战斗已开始或已结束）', started ? 'success' : 'error');
    } else if (action === 'kill-all' && currentGame) {
      const killed = currentGame.debugKillAll();
      showGlobalToast('已清除 ' + killed + ' 个敌军', 'success');
    } else if (action === 'win' && currentGame) {
      currentGame.debugWin();
      closeDebugPanel();
      return;
    } else if (action === 'lose' && currentGame) {
      currentGame.debugLose();
      closeDebugPanel();
      return;
    }
    renderDebugPanel();
    refreshDebugStatus();
    if (target) target.blur();
  }

  function showGlobalToast(message, type, duration) {
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
    }, duration || 2200);
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
    syncIntelPanelHeight();
    if (currentGame) currentGame.resize();
  }

  // The selection detail sheet takes over the build-bar footprint; match its
  // height exactly so it can never rise into the lower grid rows.
  function syncIntelPanelHeight() {
    if (!els.intelPanel || !els.buildDock) return;
    const height = Math.round(els.buildDock.getBoundingClientRect().height);
    if (height > 0) els.intelPanel.style.setProperty('--intel-h', height + 'px');
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
      const locked = level.id > save.unlocked && !debug.enabled;
      const cleared = stars > 0;
      const isCurrent = !cleared && level.id === save.unlocked;
      const gates = (level.map.join('').match(/S/g) || []).length;
      let status = 'AVAILABLE';
      let statusClass = '';
      if (locked) {
        status = 'ENCRYPTED';
        statusClass = 'locked';
      } else if (debug.enabled) {
        status = 'DEBUG ACCESS';
        statusClass = 'debug';
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
    if (activeScreen === 'game') {
      const canSuspend = !!currentGame &&
        els.resultOverlay.classList.contains('hidden') &&
        currentGame.phase !== 'victory' &&
        currentGame.phase !== 'defeat' &&
        els.onboarding.classList.contains('hidden');
      if (canSuspend) suspendCurrentRun();
      else destroyGame();
    }
    renderLevelList();
    refreshMeta();
    showScreen('levels');
    audio.play('ui');
  }

  function startLevel(levelId) {
    const level = C.LEVELS[levelId - 1];
    if (!level) return;
    if (levelId > save.unlocked && !debug.enabled) {
      showGlobalToast('该星区尚未解锁', 'error');
      return;
    }
    maybeAutoImmersive();
    closeDebugPanel();
    destroyGame();
    closeHelp();
    pendingTraitTraits = traitBriefingsForLevel(level.id);
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
    hideWaveIntel();
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
    resetCoreFeedback();
    if (els.gameScreen && currentGame.grid) {
      const cols = (C.GRID && C.GRID.cols) || 9;
      els.gameScreen.style.setProperty('--core-x', String((currentGame.grid.base.x + 0.5) / cols));
    }
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
    const seenTutorial = save.tutorialSeen || debug.enabled;
    // Every level opens paused so the first wave never starts before the
    // player has had a chance to look over the map.
    currentGame.setPaused(true);
    updatePauseButton(true);
    if (!seenTutorial) {
      onboardingPause = true;
      els.onboarding.classList.remove('hidden');
    } else {
      showPauseBar();
      maybeShowTraitBriefing();
    }
    audio.ensure();
  }

  function destroyGame() {
    if (currentGame) {
      currentGame.destroy();
      currentGame = null;
    }
    currentLevelId = null;
    resetCoreFeedback();
    clearTimeout(legendTimer);
    clearTimeout(arenaToastTimer);
    if (els.pauseOverlay) els.pauseOverlay.classList.add('hidden');
    if (els.pauseBar) els.pauseBar.classList.add('hidden');
    if (els.gameScreen) els.gameScreen.classList.remove('hud-paused');
    updatePauseButton(false);
    if (els.resultOverlay) els.resultOverlay.classList.add('hidden');
    if (els.onboarding) els.onboarding.classList.add('hidden');
    if (els.arenaToast) els.arenaToast.classList.remove('show');
    if (els.waveBanner) els.waveBanner.classList.remove('show', 'boss');
    if (els.placementLegend) els.placementLegend.classList.remove('show');
    hideWaveIntel();
    resultSummary = null;
    onboardingPause = false;
    pendingTraitTraits = [];
    if (els.traitBriefing) els.traitBriefing.classList.add('hidden');
    releaseWakeLock();
    updateResumeUI();
  }

  /* ============================================================
     Game HUD / build dock / intel
     ============================================================ */
  function handleStats(state) {
    if (!currentGame) return;
    updateHud(state);
    updateBuildAffordability();
    refreshDebugStatus();
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
    hideWaveIntel();
    showWaveBanner(info);
    if (!currentGame.selectedBuild) {
      renderIntel({ mode: 'none' });
    }
  }

  function handleWaveClear(info) {
    if (!currentGame || !info) return;
    hideWaveIntel();
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
  const coreWarn = { danger: false, critical: false };
  let coreDeltaTimer = 0;
  let coreRevealTimer = 0;
  let coreAlertTimer = 0;

  function popHudValue(el) {
    if (!el) return;
    el.classList.remove('hud-value-pop');
    void el.offsetWidth;
    el.classList.add('hud-value-pop');
  }

  // The core readout is transient by design: it appears on damage, stays while the
  // core is in danger, and can be summoned on demand by tapping the core.
  function revealCoreStatus(showDetail) {
    if (!currentGame || !els.coreReadout) return;
    els.coreReadout.classList.add('is-revealed');
    window.clearTimeout(coreRevealTimer);
    coreRevealTimer = window.setTimeout(function () {
      if (els.coreReadout) els.coreReadout.classList.remove('is-revealed');
    }, 3200);
    if (!showDetail) return;
    const state = currentGame.getHudState();
    const integrity = Math.round(U.clamp(state.baseHp / Math.max(1, state.baseMax), 0, 1) * 100);
    showArenaToast(
      '核心完整度 ' + Math.max(0, Math.ceil(state.baseHp)) + ' / ' + state.baseMax +
        ' · ' + integrity + '% · 累计漏怪 ' + state.leaked,
      integrity < 30 ? 'warning' : 'info'
    );
    audio.play('ui');
  }

  function flashCoreAlert(lost) {
    if (!els.coreAlert) return;
    if (els.coreAlertTitle) els.coreAlertTitle.textContent = '核心受击';
    if (els.coreAlertSub) els.coreAlertSub.textContent = '−' + Math.max(1, Math.round(lost));
    els.coreAlert.classList.remove('show');
    void els.coreAlert.offsetWidth;
    els.coreAlert.classList.add('show');
    window.clearTimeout(coreAlertTimer);
    coreAlertTimer = window.setTimeout(function () {
      if (els.coreAlert) els.coreAlert.classList.remove('show');
    }, 1000);
  }

  function resetCoreFeedback() {
    window.clearTimeout(coreRevealTimer);
    window.clearTimeout(coreAlertTimer);
    coreWarn.danger = false;
    coreWarn.critical = false;
    hudMemory.core = null;
    if (els.coreReadout) els.coreReadout.classList.remove('is-revealed', 'is-danger', 'is-critical');
    if (els.coreAlert) els.coreAlert.classList.remove('show');
    if (els.gameScreen) els.gameScreen.classList.remove('core-danger', 'core-critical');
  }

  function updateHud(state) {
    if (!state) return;
    const ratio = U.clamp(state.baseHp / Math.max(1, state.baseMax), 0, 1);
    const coreNow = Math.max(0, Math.ceil(state.baseHp));
    const danger = ratio < 0.3;
    const critical = ratio < 0.1;
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
    if (hudMemory.core != null && coreNow < hudMemory.core) {
      flashCoreAlert(hudMemory.core - coreNow);
      revealCoreStatus(false);
      if (critical && !coreWarn.critical) audio.play('critical');
      else if (danger && !coreWarn.danger) audio.play('warning');
    }
    if (!danger) coreWarn.danger = false;
    if (!critical) coreWarn.critical = false;
    if (danger) coreWarn.danger = true;
    if (critical) coreWarn.critical = true;
    hudMemory.core = coreNow;
    if (els.coreFill) els.coreFill.style.width = (ratio * 100).toFixed(1) + '%';
    if (els.coreReadout) {
      els.coreReadout.classList.toggle('is-danger', danger);
      els.coreReadout.classList.toggle('is-critical', critical);
    }
    if (els.gameScreen) {
      els.gameScreen.classList.toggle('core-danger', danger);
      els.gameScreen.classList.toggle('core-critical', critical);
    }
    const crystalNow = U.formatInt(state.crystals);
    if (els.crystals) {
      const crystalDigits = String(Math.floor(state.crystals)).length;
      els.crystals.classList.toggle('is-long', crystalDigits >= 4);
      els.crystals.classList.toggle('is-dense', crystalDigits >= 5);
      if (els.hud) els.hud.classList.toggle('crystal-long', crystalDigits >= 4);
    }
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
      const paused = !!(currentGame && currentGame.paused);
      status.classList.toggle('prep', isPrep);
      status.classList.toggle('active', isLive);
      status.classList.toggle('imminent', isPrep && !paused && seconds > 0 && seconds <= 3);
      status.classList.toggle('cleared', isCleared);
      status.classList.toggle('lost', isLost);
      status.disabled = !(isPrep || isLive);
      let statusTitle = '';
      if (isPrep && currentGame) {
        const summary = previewSummary(currentGame.getNextWavePreview());
        const action = paused ? ' · 点击立即发兵并恢复作战' : ' · 点击立即发兵';
        statusTitle = summary.names
          ? '下一波：' + summary.names + (summary.traits ? ' · 特性：' + summary.traits : '') + action
          : '点击立即发兵';
      } else if (isLive && currentGame) {
        const summary = previewSummary(currentGame.getWavePreview(state.wave));
        const action = paused ? ' · 点击恢复作战' : ' · 交战中';
        statusTitle = summary.names
          ? '第 ' + state.wave + ' 波：' + summary.names + (summary.traits ? ' · 特性：' + summary.traits : '') + action
          : (paused ? '点击恢复作战' : '交战中');
      }
      status.title = statusTitle;
      if (isPrep) {
        els.waveStatusKicker.textContent = paused ? '待发兵' : '自动发兵';
        els.waveStatusValue.textContent = paused ? '发兵' : String(seconds).padStart(2, '0') + 's';
        const total = Math.max(1, Number(state.prepTotal) || 1);
        els.waveStatusProgress.style.width = (U.clamp(seconds / total, 0, 1) * 100).toFixed(1) + '%';
        status.setAttribute('aria-label', paused
          ? '第 ' + state.wave + ' 波待发兵，点击立即发兵并恢复作战'
          : '第 ' + state.wave + ' 波将在 ' + seconds + ' 秒后自动来袭，点击立即发兵');
      } else if (isLive) {
        const remaining = Math.max(0, Number(state.waveRemaining != null ? state.waveRemaining : state.enemiesAlive) || 0);
        els.waveStatusKicker.textContent = paused ? '已暂停' : '剩余';
        els.waveStatusValue.textContent = String(remaining);
        status.setAttribute('aria-label', paused
          ? '第 ' + state.wave + ' 波已暂停，剩余 ' + remaining + ' 个敌人，点击恢复作战'
          : '第 ' + state.wave + ' 波交战中，剩余 ' + remaining + ' 个敌人');
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
    syncIntelPanelHeight();
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
    if (type === 'beacon') {
      let rangeChip = '侦测半径 <b>' + stats.range.toFixed(1) + '</b>';
      if (nextStats && Math.abs(nextStats.range - stats.range) > 0.01) {
        rangeChip += ' <span class="level-gain">→' + nextStats.range.toFixed(1) + '</span>';
      }
      chips.push('<span>' + rangeChip + '</span>');
      chips.push('<span>占用 1 塔位</span>');
      return chips.join('');
    }
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
      chips.push('<span>击退 <b>' + (stats.knockback || 0).toFixed(2) + ' 格</b></span>');
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

  function intelTagMarkup(info) {
    if (!info) return '';
    const tags = [];
    if (info.damageTypeName) {
      tags.push('<span class="intel-tag damage" style="--tag-color:' + info.damageTypeColor + '">' + info.damageTypeName + '</span>');
    }
    const rawTags = info.tags || [];
    for (let i = 0; i < rawTags.length; i++) {
      const tag = rawTags[i];
      if (tag === info.damageTypeName) continue;
      tags.push('<span class="intel-tag' + (tag === '反隐' ? ' detect' : '') + '">' + tag + '</span>');
    }
    if (!tags.length) return '';
    return '<div class="intel-tags">' + tags.join('') + '</div>';
  }

  function previewSummary(preview) {
    if (!preview || !preview.enemies.length) return { names: '', traits: '' };
    return {
      names: preview.enemies.map(function (enemy) { return enemy.name + '×' + enemy.count; }).join(' · '),
      traits: (preview.threats || []).map(function (threat) { return threat.name; }).join(' / '),
    };
  }

  function enemyChipsHtml(preview, limit) {
    if (!preview || !preview.enemies.length) return '';
    const max = Math.max(1, limit || preview.enemies.length);
    return preview.enemies.slice(0, max).map(function (enemy) {
      const traitDefs = (enemy.traits || []).map(function (id) {
        return C.TRAITS[id];
      }).filter(Boolean);
      const traitMark = traitDefs.slice(0, 2).map(function (trait) {
        return '<em class="trait-mark" style="--trait-color:' + trait.color + '">' + trait.short + '</em>';
      }).join('');
      const traitNames = traitDefs.map(function (trait) { return trait.name; }).join(' / ');
      const title = enemy.name + ' × ' + enemy.count + (traitNames ? ' · ' + traitNames : '');
      return '<span class="enemy-chip shape-' + enemy.shape + (enemy.boss ? ' boss' : '') + (traitDefs.length ? ' has-traits' : '') + '" style="color:' + enemy.color + '" title="' + title + '"><i></i>' + enemy.count + traitMark + '</span>';
    }).join('');
  }

  function waveThreatsHtml(preview) {
    if (!preview || !preview.threats || !preview.threats.length) return '';
    return '<div class="next-wave-threats">' + preview.threats.map(function (threat) {
      return '<span style="--trait-color:' + threat.color + '">' + threat.name + '</span>';
    }).join('') + '</div>';
  }

  function setPauseIntelExpanded(expanded) {
    const button = $('btn-pause-intel');
    if (button) button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function hideWaveIntel() {
    window.clearTimeout(waveIntelTimer);
    waveIntelTimer = 0;
    if (els.waveIntel) els.waveIntel.classList.remove('show');
    setPauseIntelExpanded(false);
  }

  function showWaveIntel(options) {
    if (!currentGame || !els.waveIntel || !els.waveIntelBody) return;
    const duration = options && options.duration ? options.duration : 7000;
    const number = currentGame.phase === 'wave' ? Math.max(1, currentGame.currentWave) : currentGame.waveCursor + 1;
    const preview = currentGame.getWavePreview(number);
    if (!preview || !preview.enemies.length) {
      hideWaveIntel();
      return;
    }
    const summary = previewSummary(preview);
    const traitNames = preview.threats.length
      ? preview.threats.map(function (threat) { return threat.name; }).join(' / ')
      : '无特殊特性';
    window.clearTimeout(arenaToastTimer);
    if (els.arenaToast) els.arenaToast.classList.remove('show');
    if (els.waveIntelKicker) els.waveIntelKicker.textContent = 'WAVE ' + pad2(preview.number);
    els.waveIntelBody.innerHTML =
      '<p class="wave-intel-summary">' + summary.names + '</p>' +
      '<div class="next-wave-preview wave-intel-chips"><span class="next-wave-label">COUNT</span>' + enemyChipsHtml(preview) + '</div>' +
      '<p class="wave-intel-traits">特性：' + traitNames + '</p>';
    els.waveIntel.classList.add('show');
    setPauseIntelExpanded(true);
    window.clearTimeout(waveIntelTimer);
    waveIntelTimer = window.setTimeout(hideWaveIntel, duration);
    audio.play('ui');
  }

  function togglePauseIntel() {
    if (!currentGame || !els.pauseBar || els.pauseBar.classList.contains('hidden')) return;
    if (els.waveIntel && els.waveIntel.classList.contains('show')) hideWaveIntel();
    else showWaveIntel({ duration: 7000 });
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
        previewHtml = '<div class="next-wave-preview"><span class="next-wave-label">NEXT</span>' + enemyChipsHtml(preview, 5) + waveThreatsHtml(preview) + '</div>';
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
          intelTagMarkup(info) +
          '<div class="intel-stats">' + (info.isWall ? '<span>阻挡通行 · 强制重寻路</span><span>不可被攻击</span>' : statChips(info.type, info.stats)) + '</div>' +
          (info.counter ? '<div class="intel-counter">克制：' + info.counter + '</div>' : '') +
        '</div>' +
        '<div class="intel-actions"><button class="mini-button cancel" type="button" data-intel-action="cancel">取消</button></div>';
      const canvas = els.intelContent.querySelector('.intel-sigil canvas');
      GFX.towerIcon(canvas, info.type);
      return;
    }
    if (info.mode === 'structure' && info.isWall) {
      const canUndo = !!info.canUndo;
      const sellLabel = canUndo ? '撤销' : '回收';
      const sellAria = canUndo
        ? '撤销部署，全额返还 ' + info.sellValue + ' 晶元'
        : '回收壁垒，获得 ' + info.sellValue + ' 晶元';
      els.intelContent.innerHTML =
        '<div class="intel-sigil" style="--intel-color:' + info.color + '"><canvas width="36" height="36"></canvas></div>' +
        '<div class="intel-copy">' +
          '<div class="intel-title-row"><strong>' + info.name + '</strong><span class="intel-level">结构</span></div>' +
          '<div class="intel-sub">' + info.tagline + ' · 阻挡通行，无法被攻击</div>' +
          '<div class="intel-stats"><span>部署投入 <b>' + info.spent + '</b></span><span>' + (canUndo ? '可全额撤销' : '可回收') + ' <b>+' + info.sellValue + '</b></span></div>' +
        '</div>' +
        '<div class="intel-actions"><button class="mini-button sell' + (canUndo ? ' undo' : '') + '" type="button" data-intel-action="sell" aria-label="' + sellAria + '"><span class="sell-label">' + sellLabel + '</span>' + gemSvg() + '+' + info.sellValue + '</button></div>';
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
          '<div class="intel-sub">' + info.role + (info.tierName ? ' · ' + info.tierName : '') + ' · ' + info.special + '</div>' +
          intelTagMarkup(info) +
          '<div class="intel-stats">' + statChips(info.type, info.stats, info.nextStats) + '</div>' +
          (info.counter ? '<div class="intel-counter">克制：' + info.counter + '</div>' : '') +
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
    const debugNote = $('skills-debug-note');
    if (debugNote) debugNote.classList.toggle('hidden', !debug.enabled);
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
    updateSkillReset();
  }

  function skillRefundTotal() {
    let total = 0;
    for (let i = 0; i < C.SKILLS.length; i++) {
      const skill = C.SKILLS[i];
      const rank = save.skills[skill.id] || 0;
      for (let r = 0; r < rank; r++) total += skill.costs[r] || 0;
    }
    return total;
  }

  function updateSkillReset() {
    if (!els.skillsReset) return;
    const refund = skillRefundTotal();
    const armed = resetArmed && refund > 0;
    if (els.skillResetRefund) els.skillResetRefund.textContent = U.formatInt(refund);
    els.skillsReset.disabled = refund <= 0;
    els.skillsReset.classList.toggle('confirming', armed);
    if (els.skillResetLabel) els.skillResetLabel.textContent = armed ? '再次点击确认' : '重置技能';
    els.skillsReset.setAttribute('aria-label', refund > 0
      ? (armed ? '再次点击确认重置技能，返还 ' + refund + ' 金币' : '重置技能矩阵，返还 ' + refund + ' 金币')
      : '当前没有可重置的技能');
  }

  function disarmSkillReset() {
    resetArmed = false;
    window.clearTimeout(resetArmTimer);
    resetArmTimer = 0;
    updateSkillReset();
  }

  function resetSkills() {
    const refund = skillRefundTotal();
    if (refund <= 0) return 0;
    for (let i = 0; i < C.SKILLS.length; i++) save.skills[C.SKILLS[i].id] = 0;
    save.gold += refund;
    persist();
    refreshMeta();
    resetArmed = false;
    window.clearTimeout(resetArmTimer);
    resetArmTimer = 0;
    renderSkills();
    return refund;
  }

  function openSkills(returnTo) {
    skillsReturn = returnTo || 'home';
    disarmSkillReset();
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

  function showPauseBar() {
    if (els.pauseBar) els.pauseBar.classList.remove('hidden');
    if (els.gameScreen) els.gameScreen.classList.add('hud-paused');
    updatePauseButton(true);
    hideWaveIntel();
  }

  function hidePauseBar() {
    if (els.pauseBar) els.pauseBar.classList.add('hidden');
    if (els.gameScreen) els.gameScreen.classList.remove('hud-paused');
    updatePauseButton(false);
    hideWaveIntel();
  }

  function maybeShowDeployPrompt() {
    if (!currentGame || deploymentPromptShown) return;
    if (currentGame.phase !== 'prep' || currentGame.currentWave !== 0 || currentGame.structures.length > 0) return;
    if (currentGame.prepRemaining <= 3.5) return;
    deploymentPromptShown = true;
    showArenaToast('选择阵列部署 · 倒计时结束后自动发兵', 'info');
  }

  function openPause() {
    if (!currentGame || activeScreen !== 'game') return;
    if (currentGame.phase === 'victory' || currentGame.phase === 'defeat' || currentGame.phase === 'victory-pending') return;
    if (!els.onboarding.classList.contains('hidden')) return;
    if (els.pauseBar && !els.pauseBar.classList.contains('hidden')) return;
    currentGame.setPaused(true);
    pauseReadout();
    releaseWakeLock();
    if (els.pauseOverlay) els.pauseOverlay.classList.add('hidden');
    showPauseBar();
    audio.play('ui');
  }

  function closePause(resume) {
    hidePauseBar();
    if (resume && currentGame) {
      currentGame.setPaused(false);
      currentGame.refreshUI();
      maybeShowDeployPrompt();
      requestWakeLock();
    }
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
      if (debug.enabled) {
        resultAction = level.id < C.LEVELS.length ? 'next' : 'levels';
      } else {
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
      }
    } else {
      resultAction = 'retry';
    }
    resultSummary = { level: level, summary: summary, gold: goldEarned, firstClear: firstClear, improved: improved, debug: debug.enabled };
    currentGame.setPaused(true);
    hidePauseBar();
    if (els.pauseOverlay) els.pauseOverlay.classList.add('hidden');
    renderResult(resultSummary);
    els.resultOverlay.classList.remove('hidden');
    audio.play('ui');
  }

  function renderResult(result) {
    const level = result.level;
    const summary = result.summary;
    const success = summary.success;
    const isDebug = !!result.debug;
    const stars = summary.stars || 0;
    $('result-card').style.setProperty('--result-accent', success ? level.accent : '#ff5d7a');
    $('result-card').classList.toggle('debug-run', isDebug);
    $('result-kicker').textContent = isDebug ? 'DEBUG RUN // NOT RECORDED' : success ? 'SECTOR SECURED' : 'CORE SIGNAL LOST';
    let title;
    if (!success) title = isDebug ? '调试失守' : '防线失守';
    else if (isDebug) title = '调试肃清';
    else if (stars === 3) title = '完美肃清';
    else if (stars === 2) title = '星区肃清';
    else title = '惨胜肃清';
    $('result-title').textContent = title;
    let copy;
    if (isDebug) copy = '调试模式运行的战斗不会写入星图进度、星级或金币。可直接从调试面板跳转下一关。';
    else if (!success) copy = '核心信号中断。重新调整防御阵列，再次尝试这条航道。';
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
    reward.classList.toggle('debug', isDebug);
    if (isDebug) {
      reward.classList.remove('defeat');
      reward.querySelector('span').textContent = '调试运行 · 不计入进度与金币';
      $('result-gold').textContent = '0';
    } else if (success) {
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
        currentGame.setPaused(true);
        currentGame.refreshUI();
        showPauseBar();
        maybeShowTraitBriefing();
        showArenaToast('部署阶段 · 点击左上播放键开始作战', 'info');
      }
      onboardingPause = false;
      audio.play('ui');
    }
  }

  /* ============================================================
     Help
     ============================================================ */
  function buildHelpManual() {
    if (els.helpTowerList) {
      const types = C.TOWER_ORDER.concat(['wall']);
      els.helpTowerList.innerHTML = types.map(function (type) {
        const def = type === 'wall' ? C.WALL : C.TOWERS[type];
        const damage = def.damageType ? C.DAMAGE_TYPES[def.damageType] : null;
        const tags = (def.tags || []).map(function (tag) {
          return '<span>' + tag + '</span>';
        }).join('');
        return (
          '<div class="tower-manual-row" style="--tower-color:' + def.color + '">' +
            '<canvas width="64" height="64" aria-hidden="true"></canvas>' +
            '<div class="tower-manual-copy">' +
              '<b>' + def.name + '<span>' + def.en + ' // ' + def.role + '</span></b>' +
              '<p>' + def.desc + '</p>' +
              '<div class="manual-tags">' + tags + (damage ? '<span style="--tag-color:' + damage.color + '">' + damage.name + '</span>' : '') + '</div>' +
              '<small>克制：' + (def.counter || '—') + '</small>' +
            '</div>' +
          '</div>'
        );
      }).join('');
      $$('.tower-manual-row canvas', els.helpTowerList).forEach(function (canvas, index) {
        GFX.towerIcon(canvas, types[index]);
      });
    }
    if (els.helpTraitList) {
      els.helpTraitList.innerHTML = Object.keys(C.TRAITS).map(function (id) {
        const trait = C.TRAITS[id];
        return (
          '<div class="trait-manual-row" style="--trait-color:' + trait.color + '">' +
            '<span class="trait-swatch">' + trait.short + '</span>' +
            '<div class="trait-manual-copy">' +
              '<b>' + trait.name + '</b>' +
              '<p>' + trait.desc + '</p>' +
              '<small>克制：' + trait.counter + '</small>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    }
    if (!els.helpEnemyList) return;
    const types = C.ENEMY_ORDER.filter(function (type) {
      return type !== 'shard';
    });
    els.helpEnemyList.innerHTML = types.map(function (type) {
      const def = C.ENEMIES[type];
      const traits = (def.traits || []).map(function (id) {
        const trait = C.TRAITS[id];
        if (!trait) return '';
        return '<span style="--tag-color:' + trait.color + '">' + trait.name + '</span>';
      }).join('');
      return (
        '<div class="enemy-manual-row" style="--enemy-color:' + def.color + '">' +
          '<canvas width="64" height="64" aria-hidden="true"></canvas>' +
          '<div class="enemy-manual-copy"><b>' + def.name + '<span>' + def.en + ' // ' + def.tag + '</span></b><p>' + def.desc + '</p>' +
            '<div class="manual-tags">' + traits + '</div>' +
            '<small>克制：' + (def.counter || '—') + '</small>' +
          '</div>' +
        '</div>'
      );
    }).join('');
    $$('.enemy-manual-row canvas', els.helpEnemyList).forEach(function (canvas, index) {
      GFX.enemyIcon(canvas, types[index]);
    });
  }

  function openHelp() {
    helpLastFocus = document.activeElement;
    const debugSection = $('help-debug-section');
    if (debugSection) debugSection.classList.toggle('hidden', !debug.enabled);
    document.body.classList.add('help-open');
    els.helpModal.classList.remove('hidden');
    $('help-close').focus();
    audio.play('ui');
  }

  function closeHelp() {
    if (!els.helpModal || els.helpModal.classList.contains('hidden')) return;
    els.helpModal.classList.add('hidden');
    document.body.classList.remove('help-open');
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
      || !els.onboarding.classList.contains('hidden')
      || !els.traitBriefing.classList.contains('hidden');
  }

  /* ============================================================
     Bind UI
     ============================================================ */
  function debugToggle(flag) {
    if (!debug.enabled) return;
    if (flag === 'god') {
      debug.godMode = !debug.godMode;
      if (currentGame) currentGame.setGodMode(debug.godMode);
    } else if (flag === 'free') {
      debug.freeBuild = !debug.freeBuild;
      if (currentGame) currentGame.setFreeBuild(debug.freeBuild);
    }
    renderDebugPanel();
    refreshDebugStatus();
  }

  function handleDebugClick(event) {
    const levelButton = event.target.closest('[data-debug-level]');
    if (levelButton) {
      const levelId = Number(levelButton.getAttribute('data-debug-level'));
      if (levelId) {
        audio.ensure();
        startLevel(levelId);
      }
      return;
    }
    const spawnButton = event.target.closest('[data-debug-spawn]');
    if (spawnButton) {
      if (!currentGame) {
        showGlobalToast('请先进入一个关卡再生成测试敌群', 'error');
        return;
      }
      const type = spawnButton.getAttribute('data-debug-spawn');
      currentGame.debugSpawn(type, 5);
      refreshDebugStatus();
      return;
    }
    const toggleButton = event.target.closest('[data-debug-toggle]');
    if (toggleButton) {
      debugToggle(toggleButton.getAttribute('data-debug-toggle'));
      return;
    }
    const actionButton = event.target.closest('[data-debug-action]');
    if (actionButton && !actionButton.disabled) {
      handleDebugAction(actionButton.getAttribute('data-debug-action'), actionButton);
    }
  }

  function bindUI() {
    $('btn-deploy').addEventListener('click', openLevels);
    $('btn-skills-home').addEventListener('click', function () { openSkills('home'); });
    $('btn-help').addEventListener('click', openHelp);
    if (els.debugFab) els.debugFab.addEventListener('click', toggleDebugPanel);
    if (els.debugHud) els.debugHud.addEventListener('click', toggleDebugPanel);
    if (els.debugClose) els.debugClose.addEventListener('click', closeDebugPanel);
    if (els.debugPanel) els.debugPanel.addEventListener('click', handleDebugClick);
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
    $$('.immersive-toggle').forEach(function (button) {
      button.addEventListener('click', toggleImmersive);
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

    if (els.skillsReset) {
      els.skillsReset.addEventListener('click', function () {
        const refund = skillRefundTotal();
        if (refund <= 0) return;
        if (!resetArmed) {
          resetArmed = true;
          updateSkillReset();
          window.clearTimeout(resetArmTimer);
          resetArmTimer = window.setTimeout(function () {
            resetArmed = false;
            resetArmTimer = 0;
            updateSkillReset();
          }, 3800);
          audio.play('ui');
          return;
        }
        const refunded = resetSkills();
        audio.play('sell');
        showGlobalToast('技能已重置 · 返还 ' + U.formatInt(refunded) + ' 金币', 'success');
      });
    }

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
      if (!currentGame) return;
      audio.ensure();
      const paused = !!currentGame.paused;
      if (currentGame.phase === 'prep') {
        // The card is also the "send wave" control: tapping it while the
        // level is paused must resume the battle and release the wave.
        if (paused) closePause(true);
        if (currentGame.phase === 'prep') currentGame.startWave();
        return;
      }
      if (currentGame.phase === 'wave' && paused) closePause(true);
    });

    if (els.waveIntelClose) {
      els.waveIntelClose.addEventListener('click', function () {
        hideWaveIntel();
        audio.play('ui');
      });
    }

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
    $('btn-pause-intel').addEventListener('click', togglePauseIntel);
    $('btn-trait-close').addEventListener('click', closeTraitBriefing);
    $('btn-home-resume').addEventListener('click', resumeSuspendedRun);
    $('btn-levels-resume').addEventListener('click', resumeSuspendedRun);

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
      if (currentGame.grid.isBase(cell.x, cell.y)) {
        if (currentGame.selectedBuild) currentGame.cancelSelection();
        revealCoreStatus(true);
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
      syncViewportHeight();
      ambient.resize();
      fitArena();
      if (currentGame) currentGame.resize();
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', scheduleViewportSync);
      window.visualViewport.addEventListener('scroll', scheduleViewportSync, { passive: true });
    }
    ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'].forEach(function (name) {
      document.addEventListener(name, syncImmersiveState);
    });
    window.addEventListener('orientationchange', function () {
      window.setTimeout(function () {
        syncViewportHeight();
        fitArena();
        if (currentGame) currentGame.resize();
      }, 180);
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
      if (document.hidden) {
        releaseWakeLock();
        if (currentGame && activeScreen === 'game') {
          if (els.pauseBar && !els.pauseBar.classList.contains('hidden')) return;
          if (currentGame.phase !== 'wave' && currentGame.phase !== 'prep') return;
          if (!els.onboarding.classList.contains('hidden') || helpOpen()) return;
          openPause();
        }
      } else {
        requestWakeLock();
      }
    });

    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('pointerdown', function () {
      if (save.settings.sound) audio.ensure();
    }, { capture: true, passive: true });

    bindDebugCli();
    buildHelpManual();
    refreshMeta();
  }

  function isTextEntryTarget(target) {
    if (!target || !target.tagName) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function handleKeydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'd' || event.key === 'D')) {
      event.preventDefault();
      setDebugMode(!debug.enabled);
      return;
    }
    if (
      (event.key === ' ' || event.key === 'Spacebar') &&
      !event.repeat &&
      activeScreen === 'game' &&
      currentGame &&
      !debug.panelOpen &&
      !helpOpen() &&
      els.onboarding.classList.contains('hidden') &&
      els.traitBriefing.classList.contains('hidden') &&
      els.resultOverlay.classList.contains('hidden') &&
      els.pauseOverlay.classList.contains('hidden') &&
      !isTextEntryTarget(event.target)
    ) {
      // Space is reserved for pause/resume on the battlefield; stop it from
      // activating the focused HUD control or scrolling the page.
      event.preventDefault();
      togglePause();
      return;
    }
    if (event.key === 'Escape') {
      if (debug.panelOpen) {
        closeDebugPanel();
        event.preventDefault();
        return;
      }
      if (helpOpen()) {
        closeHelp();
        event.preventDefault();
        return;
      }
      if (!els.traitBriefing.classList.contains('hidden')) {
        closeTraitBriefing();
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
      !isTextEntryTarget(event.target) &&
      els.onboarding.classList.contains('hidden') &&
      els.traitBriefing.classList.contains('hidden') &&
      els.resultOverlay.classList.contains('hidden')
    ) {
      togglePause();
      event.preventDefault();
      return;
    }
    if (activeScreen !== 'game' || gameInputBlocked() || !currentGame || isTextEntryTarget(event.target)) return;
    if (event.key >= '1' && event.key <= String(C.TOWER_ORDER.length)) {
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
    syncViewportHeight();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.25);
    els.homeCore.width = Math.round(220 * dpr);
    els.homeCore.height = Math.round(220 * dpr);
    els.skillHero.width = Math.round(160 * dpr);
    els.skillHero.height = Math.round(160 * dpr);
    ambient.resize();
    bindUI();
    syncImmersiveState();
    grantDebugGold();
    refreshMeta();
    showScreen('home');
    updateDebugChrome();
    if (debug.enabled) {
      console.info('[VECTOR] Debug mode enabled. Toggle with Ctrl+Shift+D or ?debug=1.');
    }
    requestAnimationFrame(loop);
  }

  // Small debug/testing surface. Does not affect normal play.
  window.__VECTOR = {
    get save() { return save; },
    get game() { return currentGame; },
    get immersive() {
      return {
        active: immersive.active,
        pref: immersive.pref,
        supported: fullscreenSupported(),
        standalone: standaloneLaunch(),
        fullscreen: !!fullscreenElement(),
        wakeLock: !!immersive.wakeLock,
      };
    },
    toggleImmersive: toggleImmersive,
    enterImmersive: function () { return enterImmersive(); },
    exitImmersive: exitImmersive,
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
    debug: {
      get enabled() { return debug.enabled; },
      enable: function () { setDebugMode(true); },
      disable: function () { setDebugMode(false); },
      toggle: function () { setDebugMode(!debug.enabled); },
      get state() { return { enabled: debug.enabled, godMode: debug.godMode, freeBuild: debug.freeBuild, panelOpen: debug.panelOpen }; },
      status: function () { return currentGame ? currentGame.debugStatus() : null; },
      maxSkills: function () { debugSetAllSkills(C.SKILL_MAX); },
      resetSkills: function () { debugSetAllSkills(0); },
      setSkill: function (id, rank) {
        if (!save.skills.hasOwnProperty(id)) return false;
        save.skills[id] = U.clamp(Math.floor(rank || 0), 0, C.SKILL_MAX);
        persist();
        refreshMeta();
        renderSkills();
        return true;
      },
      godMode: function (value) {
        debug.godMode = !!value;
        if (currentGame) currentGame.setGodMode(debug.godMode);
        renderDebugPanel();
        return debug.godMode;
      },
      freeBuild: function (value) {
        debug.freeBuild = !!value;
        if (currentGame) currentGame.setFreeBuild(debug.freeBuild);
        renderDebugPanel();
        return debug.freeBuild;
      },
      addCrystals: function (amount) {
        if (!currentGame) return null;
        return currentGame.debugAddCrystals(amount || 500);
      },
      healCore: function (amount) {
        if (!currentGame) return null;
        return currentGame.debugHealCore(amount || 50);
      },
      spawn: function (type, count) {
        if (!currentGame) return false;
        return currentGame.debugSpawn(type, count || 5);
      },
      win: function () { if (currentGame) currentGame.debugWin(); },
      lose: function () { if (currentGame) currentGame.debugLose(); },
      killAll: function () { if (currentGame) currentGame.debugKillAll(); },
      nextWave: function () { if (currentGame) currentGame.debugNextWave(); },
      maxTowers: function () { if (currentGame) currentGame.debugMaxTowers(); },
    },
  };

  // Console entry point: F12 -> debug() opens the debug panel with the CLI.
  // Silent no-op in production (debug mode off) to keep normal play clean.
  window.debug = function () {
    if (!debug.enabled) {
      console.info(
        '[VECTOR] 调试模式未开启。本地环境默认开启；线上可用 ?debug=1 或 Ctrl + Shift + D 临时开启（调试战斗不写入正式进度）。'
      );
      return null;
    }
    openDebugPanel();
    return {
      enabled: debug.enabled,
      godMode: debug.godMode,
      freeBuild: debug.freeBuild,
      panelOpen: debug.panelOpen,
      exec: function (command) { debugCliExec(command); },
    };
  };

  boot();
})();
