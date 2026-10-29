/* ============================================================
   Procedural neon geometry renderer. No image assets are used.
   ============================================================ */
(function () {
  'use strict';

  const C = window.GEOTD_CONFIG;
  const U = window.GEOTD_UTIL;
  const PS = window.GEOTD_PATH;
  const TAU = Math.PI * 2;
  const COLS = C.GRID.cols;
  const ROWS = C.GRID.rows;
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SEM = Object.freeze({
    friendly: '#2ee6d6',
    resource: '#ffb547',
    threat: '#ff5a4d',
    select: '#ffffff',
  });

  function hexA(color, alpha) {
    return U.hexToRgba(color, alpha);
  }

  function lineGlow(ctx, color, width) {
    ctx.strokeStyle = hexA(color, 0.16);
    ctx.lineWidth = Math.max(3, width * 4.2);
    ctx.stroke();
    ctx.strokeStyle = hexA(color, 0.9);
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function setCanvasPixels(canvas, w, h, dpr) {
    const d = dpr || Math.min(window.devicePixelRatio || 1, 2.25);
    canvas.width = Math.max(1, Math.round(w * d));
    canvas.height = Math.max(1, Math.round(h * d));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    return ctx;
  }

  function cellCenter(x, y) {
    return { x: x + 0.5, y: y + 0.5 };
  }

  function pointAtCell(cell, x, y) {
    return { x: cell.ox + (x + 0.5) * cell.cell, y: cell.oy + (y + 0.5) * cell.cell };
  }

  /* ============================================================
     BATTLE RENDERER
     ============================================================ */
  class GameRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
      this.dpr = 1;
      this.w = 0;
      this.h = 0;
      this.cell = 32;
      this.ox = 0;
      this.oy = 0;
      this.safeTop = 0;
      this.safeBottom = 0;
      this.level = null;
      this.grid = null;
      this.bg = null;
      this.motes = [];
      this.twinkles = [];
      this.reducedMotion = reducedMotion;
    }

    setScene(level, grid) {
      this.level = level;
      this.grid = grid;
      if (this.w > 0) this._buildBackground();
    }

    resize(width, height, insets) {
      if (!width || !height) return;
      const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
      const safeTop = Math.max(0, Number(insets && insets.top) || 0);
      const safeBottom = Math.max(0, Number(insets && insets.bottom) || 0);
      if (
        Math.abs(width - this.w) < 0.5 &&
        Math.abs(height - this.h) < 0.5 &&
        Math.abs(safeTop - this.safeTop) < 0.5 &&
        Math.abs(safeBottom - this.safeBottom) < 0.5 &&
        this.bg &&
        this.dpr === nextDpr
      ) {
        return;
      }
      this.w = width;
      this.h = height;
      this.safeTop = safeTop;
      this.safeBottom = safeBottom;
      this.dpr = nextDpr;
      const pw = Math.max(1, Math.round(width * this.dpr));
      const ph = Math.max(1, Math.round(height * this.dpr));
      if (this.canvas.width !== pw || this.canvas.height !== ph) {
        this.canvas.width = pw;
        this.canvas.height = ph;
      }
      const availableHeight = Math.max(1, height - safeTop - safeBottom);
      this.cell = Math.min(width / COLS, availableHeight / ROWS);
      this.ox = (width - this.cell * COLS) / 2;
      this.oy = safeTop + (availableHeight - this.cell * ROWS) / 2;
      this._buildBackground();
    }

    _buildBackground() {
      if (!this.level || !this.grid || !this.w || !this.h) return;
      const width = this.w;
      const height = this.h;
      const pw = Math.max(1, Math.round(width * this.dpr));
      const ph = Math.max(1, Math.round(height * this.dpr));
      const bg = document.createElement('canvas');
      bg.width = pw;
      bg.height = ph;
      const ctx = bg.getContext('2d', { alpha: false });
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const rng = U.mulberry32(U.hashString(this.level.code + '-backdrop'));
      const acc = this.level.accent;
      const acc2 = this.level.accent2;
      const cell = this.cell;
      const ox = this.ox;
      const oy = this.oy;

      // Deep space wash.
      const baseGrad = ctx.createLinearGradient(0, 0, width * 0.5, height);
      baseGrad.addColorStop(0, '#030a13');
      baseGrad.addColorStop(0.45, '#030711');
      baseGrad.addColorStop(1, '#01050c');
      ctx.fillStyle = baseGrad;
      ctx.fillRect(0, 0, width, height);

      // Nebula bloom.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const blooms = [
        { x: 0.81, y: 0.09, r: 0.62, c: acc, a: 0.085 },
        { x: 0.08, y: 0.46, r: 0.46, c: acc2, a: 0.065 },
        { x: 0.56, y: 0.92, r: 0.48, c: acc, a: 0.035 },
      ];
      for (let b = 0; b < blooms.length; b++) {
        const bloom = blooms[b];
        const g = ctx.createRadialGradient(
          width * bloom.x,
          height * bloom.y,
          0,
          width * bloom.x,
          height * bloom.y,
          width * bloom.r
        );
        g.addColorStop(0, hexA(bloom.c, bloom.a));
        g.addColorStop(0.48, hexA(bloom.c, bloom.a * 0.32));
        g.addColorStop(1, hexA(bloom.c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();

      // A planet rim and distant orbital lines.
      ctx.save();
      ctx.strokeStyle = hexA(acc, 0.09);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(width * 1.05, height * 0.15, width * 0.62, Math.PI * 0.54, Math.PI * 1.18);
      ctx.stroke();
      ctx.strokeStyle = hexA(acc2, 0.07);
      ctx.beginPath();
      ctx.ellipse(width * 0.78, height * 0.22, width * 0.46, width * 0.15, -0.42, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(width * 0.2, height * 0.74, width * 0.54, width * 0.21, 0.55, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(196,246,255,0.055)';
      ctx.beginPath();
      ctx.arc(width * 1.05, height * 0.15, width * 0.59, Math.PI * 0.56, Math.PI * 1.16);
      ctx.stroke();
      ctx.restore();

      // Background stars, some with cross flares.
      this.twinkles = [];
      const starCount = Math.round((width * height) / 5600) + 38;
      for (let i = 0; i < starCount; i++) {
        const sx = rng() * width;
        const sy = rng() * height;
        const big = rng() > 0.9;
        const size = big ? 1 + rng() * 0.9 : 0.35 + rng() * 0.75;
        const alpha = 0.12 + rng() * (big ? 0.45 : 0.26);
        ctx.fillStyle = big ? hexA(acc, alpha * 0.8) : 'rgba(203,239,255,' + alpha + ')';
        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, TAU);
        ctx.fill();
        if (big) {
          const flare = size * 4.5;
          ctx.strokeStyle = hexA(acc, alpha * 0.3);
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(sx - flare, sy);
          ctx.lineTo(sx + flare, sy);
          ctx.moveTo(sx, sy - flare);
          ctx.lineTo(sx, sy + flare);
          ctx.stroke();
        }
        if (i % 9 === 0) {
          this.twinkles.push({
            nx: sx / width,
            ny: sy / height,
            size: big ? 1.6 : 1,
            phase: rng() * TAU,
            speed: 0.35 + rng() * 0.65,
            color: i % 18 === 0 ? acc2 : 'rgba(205,247,255,1)',
          });
        }
      }

      // Board grid.
      ctx.save();
      ctx.translate(ox, oy);
      ctx.lineWidth = 0.55;
      ctx.strokeStyle = 'rgba(118,212,245,0.028)';
      for (let x = 0; x <= COLS; x++) {
        ctx.beginPath();
        ctx.moveTo(x * cell, 0);
        ctx.lineTo(x * cell, ROWS * cell);
        ctx.stroke();
      }
      for (let y = 0; y <= ROWS; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * cell);
        ctx.lineTo(COLS * cell, y * cell);
        ctx.stroke();
      }
      // Stronger three-cell guides.
      ctx.strokeStyle = 'rgba(118,212,245,0.045)';
      ctx.lineWidth = 0.7;
      for (let x = 0; x <= COLS; x += 3) {
        ctx.beginPath();
        ctx.moveTo(x * cell, 0);
        ctx.lineTo(x * cell, ROWS * cell);
        ctx.stroke();
      }
      for (let y = 1; y < ROWS; y += 4) {
        ctx.beginPath();
        ctx.moveTo(0, y * cell);
        ctx.lineTo(COLS * cell, y * cell);
        ctx.stroke();
      }
      // Registration crosses inside every cell.
      ctx.strokeStyle = 'rgba(155,233,255,0.04)';
      ctx.lineWidth = 0.5;
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const cx = (x + 0.5) * cell;
          const cy = (y + 0.5) * cell;
          const len = cell * 0.035;
          ctx.beginPath();
          ctx.moveTo(cx - len, cy);
          ctx.lineTo(cx + len, cy);
          ctx.moveTo(cx, cy - len);
          ctx.lineTo(cx, cy + len);
          ctx.stroke();
        }
      }
      ctx.restore();

      // Asteroid clusters: irregular hollow polygons, seeded to the level.
      const rockRng = U.mulberry32(U.hashString(this.level.code + '-rocks'));
      const rockCenters = {};
      for (let i = 0; i < this.grid.map.rocks.length; i++) {
        const rock = this.grid.map.rocks[i];
        rockCenters[rock.x + ',' + rock.y] = true;
      }
      ctx.save();
      ctx.translate(ox, oy);
      // Lines linking touching asteroids: clusters must read as one landmass.
      ctx.strokeStyle = hexA(acc2, 0.22);
      ctx.lineWidth = 1.2;
      Object.keys(rockCenters).forEach(function (key) {
        const parts = key.split(',');
        const rx = Number(parts[0]);
        const ry = Number(parts[1]);
        if (rockCenters[rx + 1 + ',' + ry]) {
          ctx.beginPath();
          ctx.moveTo((rx + 0.5) * cell, (ry + 0.5) * cell);
          ctx.lineTo((rx + 1.5) * cell, (ry + 0.5) * cell);
          ctx.stroke();
        }
        if (rockCenters[rx + ',' + (ry + 1)]) {
          ctx.beginPath();
          ctx.moveTo((rx + 0.5) * cell, (ry + 0.5) * cell);
          ctx.lineTo((rx + 0.5) * cell, (ry + 1.5) * cell);
          ctx.stroke();
        }
      });
      for (let i = 0; i < this.grid.map.rocks.length; i++) {
        const rock = this.grid.map.rocks[i];
        const cx = (rock.x + 0.5) * cell + (rockRng() - 0.5) * cell * 0.08;
        const cy = (rock.y + 0.5) * cell + (rockRng() - 0.5) * cell * 0.08;
        const radius = cell * (0.36 + rockRng() * 0.1);
        const sides = 6 + Math.floor(rockRng() * 3);
        const rot = rockRng() * TAU;
        const points = [];
        for (let p = 0; p < sides; p++) {
          const angle = rot + (p / sides) * TAU;
          const rr = radius * (0.8 + rockRng() * 0.35);
          points.push({ x: cx + Math.cos(angle) * rr, y: cy + Math.sin(angle) * rr });
        }
        const grad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.35, radius * 0.1, cx, cy, radius * 1.15);
        grad.addColorStop(0, 'rgba(58, 48, 84, 0.98)');
        grad.addColorStop(1, 'rgba(24, 21, 40, 0.98)');
        ctx.beginPath();
        for (let p = 0; p < points.length; p++) {
          if (p === 0) ctx.moveTo(points[p].x, points[p].y);
          else ctx.lineTo(points[p].x, points[p].y);
        }
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(178, 150, 216, 0.55)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        // Inner facet.
        ctx.beginPath();
        for (let p = 0; p < points.length; p += 2) {
          const px = cx + (points[p].x - cx) * 0.48;
          const py = cy + (points[p].y - cy) * 0.48;
          if (p === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = 'rgba(168, 138, 208, 0.3)';
        ctx.lineWidth = 0.7;
        ctx.stroke();
        // Cracks read as terrain, not interactable infrastructure.
        ctx.strokeStyle = 'rgba(168, 138, 208, 0.32)';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        for (let k = 0; k < 2; k++) {
          const point = points[(k * 3 + 1) % points.length];
          const sx = cx + (point.x - cx) * 0.12;
          const sy = cy + (point.y - cy) * 0.12;
          const ex = cx + (point.x - cx) * 0.82;
          const ey = cy + (point.y - cy) * 0.82;
          ctx.moveTo(sx, sy);
          ctx.lineTo((sx + ex) / 2 + radius * 0.12, (sy + ey) / 2 - radius * 0.08);
          ctx.lineTo(ex, ey);
        }
        ctx.stroke();
        // A tiny glint.
        ctx.fillStyle = 'rgba(180, 144, 222, 0.2)';
        ctx.beginPath();
        ctx.arc(cx + radius * 0.25, cy - radius * 0.35, 0.8, 0, TAU);
        ctx.fill();
      }
      ctx.restore();

      // Edge coordinate ticks and frame detail.
      ctx.save();
      ctx.translate(ox, oy);
      ctx.strokeStyle = 'rgba(146,224,246,0.14)';
      ctx.lineWidth = 0.8;
      for (let y = 1; y < ROWS; y += 4) {
        ctx.beginPath();
        ctx.moveTo(0, y * cell);
        ctx.lineTo(4, y * cell);
        ctx.moveTo(COLS * cell, y * cell);
        ctx.lineTo(COLS * cell - 4, y * cell);
        ctx.stroke();
      }
      for (let x = 1; x < COLS; x += 3) {
        ctx.beginPath();
        ctx.moveTo(x * cell, 0);
        ctx.lineTo(x * cell, 4);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(143,207,226,0.22)';
      ctx.font = '5px "Cascadia Mono", monospace';
      ctx.fillText(this.level.code, 7, ROWS * cell - 6);
      ctx.textAlign = 'right';
      ctx.fillText('VECTOR // DEFENSE GRID', COLS * cell - 7, ROWS * cell - 6);
      ctx.textAlign = 'left';
      ctx.restore();

      // Static top and bottom light washes.
      const topWash = ctx.createLinearGradient(0, 0, 0, height * 0.2);
      topWash.addColorStop(0, hexA(acc, 0.06));
      topWash.addColorStop(1, hexA(acc, 0));
      ctx.fillStyle = topWash;
      ctx.fillRect(0, 0, width, height * 0.2);
      const bottomWash = ctx.createLinearGradient(0, height * 0.8, 0, height);
      bottomWash.addColorStop(0, 'rgba(1,5,11,0)');
      bottomWash.addColorStop(1, 'rgba(1,5,11,0.58)');
      ctx.fillStyle = bottomWash;
      ctx.fillRect(0, height * 0.8, width, height * 0.2);

      this.bg = bg;

      // Drifting space dust.
      const rng2 = U.mulberry32(U.hashString(this.level.code + '-motes'));
      this.motes = [];
      for (let i = 0; i < 27; i++) {
        this.motes.push({
          nx: rng2(),
          ny: rng2(),
          r: 0.4 + rng2() * 1.2,
          phase: rng2() * TAU,
          speed: 0.06 + rng2() * 0.18,
          drift: 0.3 + rng2() * 0.8,
          color: i % 4 === 0 ? acc2 : acc,
          alpha: 0.1 + rng2() * 0.26,
        });
      }
    }

    draw(game, time) {
      if (!this.bg) this._buildBackground();
      if (!this.bg) return;
      const ctx = this.ctx;
      const dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      if (!this.level) return;
      const canShake = !this.reducedMotion;
      const shakeX = canShake && game.shake ? (Math.random() - 0.5) * game.shake : 0;
      const shakeY = canShake && game.shake ? (Math.random() - 0.5) * game.shake : 0;
      ctx.save();
      ctx.translate(shakeX, shakeY);

      ctx.drawImage(this.bg, 0, 0, this.w, this.h);
      this._drawTwinkles(ctx, time);
      this._drawMotes(ctx, time);
      this._drawRoutes(ctx, game, time);
      this._drawBuildGuide(ctx, game, time);
      this._drawRanges(ctx, game, time);
      this._drawCore(ctx, game, time);
      this._drawGates(ctx, game, time);
      this._drawWalls(ctx, game, time);
      this._drawTowers(ctx, game, time);
      this._drawEnemies(ctx, game, time);
      this._drawProjectiles(ctx, game, time);
      this._drawEffects(ctx, game, time);
      this._drawParticles(ctx, game);
      this._drawFloatTexts(ctx, game);
      this._drawPlacement(ctx, game, time);
      this._drawSelectionBrackets(ctx, game, time);
      this._drawPlacementError(ctx, game);
      this._drawBaseFlash(ctx, game);

      ctx.restore();
    }

    _drawTwinkles(ctx, time) {
      const acc = this.level.accent;
      for (let i = 0; i < this.twinkles.length; i++) {
        const star = this.twinkles[i];
        const x = star.nx * this.w;
        const y = star.ny * this.h;
        const alpha = 0.1 + (Math.sin(time * star.speed + star.phase) * 0.5 + 0.5) * 0.4;
        ctx.fillStyle = star.color === 'rgba(205,247,255,1)' ? 'rgba(205,247,255,' + alpha + ')' : hexA(acc, alpha);
        ctx.beginPath();
        ctx.arc(x, y, star.size, 0, TAU);
        ctx.fill();
      }
    }

    _drawMotes(ctx, time) {
      const w = this.w;
      const h = this.h;
      for (let i = 0; i < this.motes.length; i++) {
        const mote = this.motes[i];
        const x = (mote.nx * w + Math.sin(time * mote.speed + mote.phase) * 12 + time * mote.drift) % (w + 20) - 10;
        const y = (mote.ny * h + Math.cos(time * mote.speed * 0.7 + mote.phase) * 8) % h;
        ctx.fillStyle = hexA(mote.color, mote.alpha);
        ctx.beginPath();
        ctx.arc(x, y, mote.r, 0, TAU);
        ctx.fill();
      }
    }

    _drawRoutes(ctx, game, time) {
      if (!game.routes || !game.routes.length) return;
      const cell = this.cell;
      const ox = this.ox;
      const oy = this.oy;
      const color = SEM.friendly;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let r = 0; r < game.routes.length; r++) {
        const path = game.routes[r].path;
        if (!path || path.length < 2) continue;
        const trace = function () {
          ctx.beginPath();
          for (let i = 0; i < path.length; i++) {
            const px = ox + (path[i].x + 0.5) * cell;
            const py = oy + (path[i].y + 0.5) * cell;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
        };

        // Deep channel recess so the lane reads as part of the floor.
        trace();
        ctx.strokeStyle = 'rgba(1, 7, 12, 0.9)';
        ctx.lineWidth = cell * 0.62;
        ctx.stroke();

        // Cyan rim and soft bloom around the channel. Kept deliberately dim so live
        // combat (enemies, tracers, the core) stays the brightest thing on screen.
        trace();
        ctx.strokeStyle = hexA(color, 0.1);
        ctx.lineWidth = cell * 0.56;
        ctx.shadowColor = hexA(color, 0.22);
        ctx.shadowBlur = cell * 0.22;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Inner darker runway with a faint cyan wash.
        trace();
        ctx.strokeStyle = 'rgba(5, 23, 32, 0.94)';
        ctx.lineWidth = cell * 0.42;
        ctx.stroke();
        trace();
        ctx.strokeStyle = hexA(color, 0.035);
        ctx.lineWidth = cell * 0.38;
        ctx.stroke();

        // Flowing direction dashes.
        trace();
        ctx.setLineDash([cell * 0.2, cell * 0.64]);
        ctx.lineDashOffset = -time * cell * 0.65;
        ctx.strokeStyle = hexA(color, 0.34);
        ctx.lineWidth = 1.5;
        ctx.shadowColor = color;
        ctx.shadowBlur = 4.5;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;

        // Low-brightness flow motes carry the direction on their own, letting the
        // fixed chevrons thin out to every third cell.
        const segments = [];
        let totalLength = 0;
        for (let i = 1; i < path.length; i++) {
          const ax = ox + (path[i - 1].x + 0.5) * cell;
          const ay = oy + (path[i - 1].y + 0.5) * cell;
          const bx = ox + (path[i].x + 0.5) * cell;
          const by = oy + (path[i].y + 0.5) * cell;
          const length = Math.hypot(bx - ax, by - ay);
          if (length <= 0.01) continue;
          segments.push({ ax: ax, ay: ay, bx: bx, by: by, start: totalLength, length: length });
          totalLength += length;
        }
        if (totalLength > 0) {
          const spacing = Math.max(cell * 1.7, 11);
          const moteCount = U.clamp(Math.round(totalLength / spacing), 2, 16);
          const moteRadius = Math.max(0.85, cell * 0.028);
          let segIndex = 0;
          let prevTravelled = -1;
          for (let m = 0; m < moteCount; m++) {
            const travelled = (time * cell * 0.5 + (m / moteCount) * totalLength + r * cell * 0.8) % totalLength;
            if (travelled < prevTravelled) segIndex = 0;
            prevTravelled = travelled;
            while (segIndex < segments.length - 1 && travelled > segments[segIndex].start + segments[segIndex].length) {
              segIndex++;
            }
            const seg = segments[segIndex];
            const local = U.clamp((travelled - seg.start) / seg.length, 0, 1);
            const px = seg.ax + (seg.bx - seg.ax) * local;
            const py = seg.ay + (seg.by - seg.ay) * local;
            ctx.fillStyle = hexA(color, 0.2 + Math.sin(local * Math.PI) * 0.16);
            ctx.beginPath();
            ctx.arc(px, py, moteRadius, 0, TAU);
            ctx.fill();
          }
        }

        // Fixed chevrons show unambiguous direction at every third cell.
        for (let i = 3; i < path.length; i += 3) {
          const prev = path[i - 1];
          const cur = path[i];
          const nx = cur.x - prev.x;
          const ny = cur.y - prev.y;
          if (nx === 0 && ny === 0) continue;
          const angle = Math.atan2(ny, nx);
          const pulse = Math.sin(time * 2.8 - i * 0.72 + r * 1.6) * 0.5 + 0.5;
          const px = ox + (cur.x + 0.5) * cell;
          const py = oy + (cur.y + 0.5) * cell;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(angle);
          ctx.strokeStyle = hexA(color, 0.1 + pulse * 0.2);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(-cell * 0.065, -cell * 0.095);
          ctx.lineTo(cell * 0.055, 0);
          ctx.lineTo(-cell * 0.065, cell * 0.095);
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();
    }

    _drawBuildGuide(ctx, game, time) {
      if (!game.selectedBuild) return;
      const structures = game.structures;
      const occupied = {};
      for (let i = 0; i < structures.length; i++) {
        occupied[structures[i].x + ',' + structures[i].y] = structures[i];
      }
      const color = SEM.friendly;
      const cell = this.cell;
      const ox = this.ox;
      const oy = this.oy;
      ctx.save();
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (!game.grid.isStaticBuildable(x, y) || occupied[x + ',' + y]) continue;
          const alpha = 0.28 + (Math.sin(time * 1.4 + (x * 1.7 + y * 0.9)) * 0.5 + 0.5) * 0.24;
          const px = ox + (x + 0.5) * cell;
          const py = oy + (y + 0.5) * cell;
          const r = cell * 0.12;
          const b = cell * 0.34;
          ctx.strokeStyle = hexA(color, alpha);
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(px - b, py - b + r);
          ctx.lineTo(px - b, py - b);
          ctx.lineTo(px - b + r, py - b);
          ctx.moveTo(px + b - r, py - b);
          ctx.lineTo(px + b, py - b);
          ctx.lineTo(px + b, py - b + r);
          ctx.moveTo(px + b, py + b - r);
          ctx.lineTo(px + b, py + b);
          ctx.lineTo(px + b - r, py + b);
          ctx.moveTo(px - b + r, py + b);
          ctx.lineTo(px - b, py + b);
          ctx.lineTo(px - b, py + b - r);
          ctx.stroke();
          ctx.setLineDash([2, cell * 0.14]);
          ctx.strokeStyle = hexA(color, alpha * 0.58);
          ctx.lineWidth = 0.7;
          ctx.strokeRect(px - b, py - b, b * 2, b * 2);
          ctx.setLineDash([]);
          ctx.strokeStyle = hexA(color, alpha * 0.9);
          ctx.lineWidth = 1;
          const plus = cell * 0.055;
          ctx.beginPath();
          ctx.moveTo(px - plus, py);
          ctx.lineTo(px + plus, py);
          ctx.moveTo(px, py - plus);
          ctx.lineTo(px, py + plus);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    _drawRangeCircle(ctx, cx, cy, radius, color, time, alpha) {
      if (!radius) return;
      const fill = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius);
      fill.addColorStop(0, hexA(color, 0.09 * alpha));
      fill.addColorStop(0.7, hexA(color, 0.055 * alpha));
      fill.addColorStop(1, hexA(color, 0.13 * alpha));
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TAU);
      ctx.fill();
      ctx.save();
      ctx.strokeStyle = hexA(color, 0.82 * alpha);
      ctx.lineWidth = 1.6;
      ctx.shadowColor = hexA(color, 0.45);
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TAU);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = hexA(color, 0.26 * alpha);
      ctx.lineWidth = 0.8;
      ctx.setLineDash([cellDash(this.cell), this.cell * 0.26]);
      ctx.lineDashOffset = -time * this.cell * 0.26;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.96, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    _drawRanges(ctx, game, time) {
      if (game.selectedStructure && game.selectedStructure.kind === 'tower') {
        const tower = game.selectedStructure;
        const stats = game.getTowerStats(tower);
        const cx = this.ox + (tower.x + 0.5) * this.cell;
        const cy = this.oy + (tower.y + 0.5) * this.cell;
        this._drawRangeCircle(ctx, cx, cy, stats.range * this.cell, SEM.friendly, time, 1);
      }
    }

    _drawCore(ctx, game, time) {
      const cell = this.cell;
      const cx = this.ox + (game.grid.base.x + 0.5) * cell;
      const cy = this.oy + (game.grid.base.y + 0.5) * cell;
      const ratio = U.clamp(game.baseHp / game.baseMax, 0, 1);
      const danger = ratio < 0.32;
      const color = danger ? SEM.threat : SEM.friendly;
      const r = cell * 0.43;
      const pulse = 1 + Math.sin(time * 2.4) * 0.035;
      // A leak disturbs the core's energy rings instead of adding more UI chrome.
      const flash = U.clamp(game.baseFlash || 0, 0, 1);
      const ringJitter = flash > 0 ? Math.sin(time * 42) * flash * cell * 0.022 : 0;

      // Breathing outer halo anchors the defence objective.
      const breath = Math.sin(time * 1.8) * 0.5 + 0.5;
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * (1.05 + breath * 0.1));
      halo.addColorStop(0, hexA(color, 0.16 + breath * 0.04));
      halo.addColorStop(0.5, hexA(color, 0.055));
      halo.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * (1.05 + breath * 0.1), 0, TAU);
      ctx.fill();

      ctx.strokeStyle = hexA(color, 0.1 + breath * 0.14);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * (0.92 + breath * 0.08), 0, TAU);
      ctx.stroke();

      ctx.save();
      ctx.translate(cx, cy);

      // Arms reaching toward the core.
      ctx.strokeStyle = hexA(color, 0.25);
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 1.55, Math.sin(a) * r * 1.55);
        ctx.lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
        ctx.stroke();
      }

      // Rotating broken rings.
      ctx.save();
      ctx.rotate(time * 0.28);
      ctx.strokeStyle = hexA(color, 0.42 + flash * 0.3);
      ctx.lineWidth = 1 + flash * 0.6;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.25 + flash * cell * 0.07 + ringJitter, (i / 5) * TAU, (i / 5) * TAU + 0.68);
        ctx.stroke();
      }
      ctx.restore();

      // Health ring, 12 segments.
      for (let i = 0; i < 12; i++) {
        const start = -Math.PI / 2 + (i / 12) * TAU + 0.055;
        const lit = i / 12 < ratio;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.05 + ringJitter, start, start + TAU / 12 - 0.12);
        ctx.strokeStyle = lit ? hexA(color, 0.74 + flash * 0.24) : 'rgba(83,111,126,0.17)';
        ctx.lineWidth = 2 + flash;
        ctx.stroke();
      }

      // Outer diamond platform.
      ctx.fillStyle = 'rgba(3,10,17,0.95)';
      ctx.beginPath();
      U.polygon(ctx, 0, 0, r * 0.9, 4, Math.PI / 4);
      ctx.fill();
      ctx.strokeStyle = hexA(color, 0.38);
      ctx.lineWidth = 1.1;
      ctx.stroke();

      // Inner rotating hex.
      ctx.save();
      ctx.rotate(-time * 0.4);
      ctx.strokeStyle = hexA(color, 0.46);
      ctx.lineWidth = 1.1;
      U.polygon(ctx, 0, 0, r * 0.66, 6, Math.PI / 6);
      ctx.stroke();
      ctx.restore();

      // Core crystal.
      ctx.save();
      ctx.scale(pulse, pulse);
      const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.58);
      coreGrad.addColorStop(0, hexA(color, 0.9));
      coreGrad.addColorStop(0.34, hexA(color, 0.25));
      coreGrad.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.58, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(232,255,255,0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      U.polygon(ctx, 0, 0, r * 0.28, 4, time * 0.8);
      ctx.stroke();
      ctx.fillStyle = hexA(color, 0.2);
      ctx.fill();
      ctx.fillStyle = 'rgba(232,255,255,0.88)';
      ctx.beginPath();
      ctx.arc(0, 0, 1.25, 0, TAU);
      ctx.fill();
      ctx.restore();

      // Shield arc.
      ctx.strokeStyle = hexA(color, 0.18);
      ctx.lineWidth = 0.9;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.65, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = hexA(color, 0.46);
      ctx.font = '5px "Cascadia Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('CORE', 0, r * 1.42);
      ctx.restore();
    }

    _drawGates(ctx, game, time) {
      const cell = this.cell;
      for (let i = 0; i < game.grid.gates.length; i++) {
        const gate = game.grid.gates[i];
        const cx = this.ox + (gate.x + 0.5) * cell;
        const cy = this.oy + (gate.y + 0.55) * cell;
        const color = i % 2 === 1 ? '#ff8a4d' : SEM.threat;
        ctx.save();
        ctx.translate(cx, cy);
        const pulse = (Math.sin(time * 2.6 + i * 2.1) * 0.5 + 0.5) * 0.2;
        const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, cell * 0.8);
        halo.addColorStop(0, hexA(color, 0.16 + pulse * 0.4));
        halo.addColorStop(1, hexA(color, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, 0, cell * 0.8, 0, TAU);
        ctx.fill();

        // Expanding warning ripple.
        const ringT = (time * 0.55 + i * 0.37) % 1;
        ctx.strokeStyle = hexA(color, (1 - ringT) * 0.28);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(0, 0, cell * (0.32 + ringT * 0.62), 0, TAU);
        ctx.stroke();

        ctx.save();
        ctx.rotate(time * 0.22 + i);
        ctx.strokeStyle = hexA(color, 0.36);
        ctx.lineWidth = 0.9;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, cell * 0.36, 0, TAU);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.rotate(-time * 0.45 + i * 0.7);
        ctx.strokeStyle = hexA(color, 0.7);
        ctx.lineWidth = 1.2;
        U.polygon(ctx, 0, 0, cell * 0.245, 4, 0);
        ctx.stroke();
        ctx.strokeStyle = hexA(color, 0.28);
        U.polygon(ctx, 0, 0, cell * 0.155, 4, Math.PI / 4);
        ctx.stroke();
        ctx.restore();

        ctx.strokeStyle = hexA(color, 0.5);
        ctx.lineWidth = 1.15;
        ctx.beginPath();
        ctx.arc(0, 0, cell * 0.3, Math.PI * 0.12, Math.PI * 0.7);
        ctx.stroke();

        const arrowOffset = (time * 15 + i * 8) % (cell * 0.6);
        ctx.strokeStyle = hexA(color, 0.36);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-2.5, -cell * 0.14 + arrowOffset);
        ctx.lineTo(0, -cell * 0.08 + arrowOffset);
        ctx.lineTo(2.5, -cell * 0.14 + arrowOffset);
        ctx.stroke();
        ctx.restore();
      }
    }

    _drawWalls(ctx, game, time) {
      const cell = this.cell;
      const walls = game.structures.filter(function (s) {
        return s.kind === 'wall';
      });
      if (!walls.length) return;
      const byPos = {};
      for (let i = 0; i < walls.length; i++) byPos[walls[i].x + ',' + walls[i].y] = walls[i];
      ctx.save();
      // Adjacent braces.
      ctx.strokeStyle = 'rgba(127,176,215,0.15)';
      ctx.lineWidth = 1;
      for (let i = 0; i < walls.length; i++) {
        const wall = walls[i];
        const cx = this.ox + (wall.x + 0.5) * cell;
        const cy = this.oy + (wall.y + 0.5) * cell;
        if (byPos[wall.x + 1 + ',' + wall.y]) {
          ctx.beginPath();
          ctx.moveTo(cx + cell * 0.32, cy);
          ctx.lineTo(cx + cell * 0.68, cy);
          ctx.stroke();
        }
        if (byPos[wall.x + ',' + (wall.y + 1)]) {
          ctx.beginPath();
          ctx.moveTo(cx, cy + cell * 0.32);
          ctx.lineTo(cx, cy + cell * 0.68);
          ctx.stroke();
        }
      }
      for (let i = 0; i < walls.length; i++) {
        const wall = walls[i];
        const selected = game.selectedStructure === wall;
        this._drawWall(ctx, wall, time, selected);
      }
      ctx.restore();
    }

    _drawWall(ctx, wall, time, selected) {
      const cell = this.cell;
      const cx = this.ox + (wall.x + 0.5) * cell;
      const cy = this.oy + (wall.y + 0.5) * cell;
      const color = C.WALL.color;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = 'rgba(4,12,21,0.86)';
      ctx.strokeStyle = hexA(color, selected ? 0.8 : 0.4);
      ctx.lineWidth = selected ? 1.2 : 0.9;
      const r = cell * 0.29;
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.72);
      ctx.lineTo(-r * 0.72, -r);
      ctx.lineTo(r * 0.72, -r);
      ctx.lineTo(r, -r * 0.72);
      ctx.lineTo(r, r * 0.72);
      ctx.lineTo(r * 0.72, r);
      ctx.lineTo(-r * 0.72, r);
      ctx.lineTo(-r, r * 0.72);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = hexA(color, 0.26);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, -r * 0.55);
      ctx.lineTo(r * 0.55, r * 0.55);
      ctx.moveTo(r * 0.55, -r * 0.55);
      ctx.lineTo(-r * 0.55, r * 0.55);
      ctx.stroke();
      ctx.strokeStyle = hexA(color, 0.62);
      ctx.lineWidth = 1;
      U.polygon(ctx, 0, 0, r * 0.46, 4, time * 0.06);
      ctx.stroke();
      ctx.fillStyle = hexA(color, 0.3);
      ctx.beginPath();
      ctx.arc(0, 0, 1.2, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    _drawTowers(ctx, game, time) {
      for (let i = 0; i < game.structures.length; i++) {
        const tower = game.structures[i];
        if (tower.kind !== 'tower') continue;
        this._drawTower(ctx, tower, game, time);
      }
    }

    _towerPalette(tower) {
      const def = C.TOWERS[tower.type];
      return {
        color: def.color,
        accent: def.accent,
      };
    }

    _drawTower(ctx, tower, game, time) {
      const cell = this.cell;
      const cx = this.ox + (tower.x + 0.5) * cell;
      const cy = this.oy + (tower.y + 0.5) * cell;
      const def = C.TOWERS[tower.type];
      const color = def.color;
      const accent = def.accent;
      const selected = game.selectedStructure === tower;
      const level = tower.level || 1;
      const maxLevel = def.maxLevel || C.TOWER_MAX_LEVEL;
      const scale = cell / 37;
      const recoil = tower.recoil || 0;
      const seed = tower.idleSeed || 0;
      const isBeacon = tower.type === 'beacon';

      ctx.save();
      ctx.translate(cx, cy);

      if (selected) {
        ctx.strokeStyle = hexA(SEM.select, 0.78);
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 3]);
        ctx.lineDashOffset = -time * 10;
        ctx.strokeRect(-cell * 0.41, -cell * 0.41, cell * 0.82, cell * 0.82);
        ctx.setLineDash([]);
      }

      // Coloured ground glow. High-tier towers cast a wider, brighter pool.
      const glowR = cell * (0.56 + level * 0.028);
      const ground = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR);
      ground.addColorStop(0, hexA(color, 0.10 + level * 0.022));
      ground.addColorStop(0.55, hexA(color, 0.04 + level * 0.012));
      ground.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = ground;
      ctx.beginPath();
      ctx.arc(0, 0, glowR, 0, TAU);
      ctx.fill();

      // Tier-specific floor circuitry: rings, ticks and orbit nodes.
      this._drawTowerTierGround(ctx, color, accent, time, level, cell, seed);
      if (isBeacon) {
        this._drawBeaconAura(ctx, color, accent, time, def.levels[Math.min(level, def.levels.length) - 1].range * cell);
      }

      // Shared platform.
      ctx.fillStyle = 'rgba(3,10,17,0.94)';
      ctx.strokeStyle = hexA(color, 0.42 + level * 0.025);
      ctx.lineWidth = 1.05;
      U.polygon(ctx, 0, 0, cell * 0.33, 6, Math.PI / 6);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = hexA(color, 0.17);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(0, 0, cell * 0.4, 0, TAU);
      ctx.stroke();
      if (level >= 2) {
        ctx.strokeStyle = hexA(color, 0.22 + level * 0.02);
        ctx.lineWidth = 0.9;
        U.polygon(ctx, 0, 0, cell * 0.285, 6, Math.PI / 6);
        ctx.stroke();
      }
      if (level >= 3) {
        ctx.strokeStyle = hexA(accent, 0.22);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(0, 0, cell * 0.36, -time * 0.4, -time * 0.4 + 3.6);
        ctx.stroke();
      }

      // Level pips under the platform. The beacon shows one pip per tier.
      if (isBeacon) {
        for (let i = 0; i < Math.min(level, 2); i++) {
          ctx.fillStyle = hexA(accent, 0.85);
          ctx.save();
          ctx.translate((i - (level - 1) * 0.5) * 6, cell * 0.34);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-1.6, -1.6, 3.2, 3.2);
          ctx.restore();
        }
      } else {
        for (let i = 0; i < 5; i++) {
          const pipColor = i < level ? hexA(i === 4 ? accent : color, 0.8) : 'rgba(116,153,172,0.18)';
          ctx.fillStyle = pipColor;
          ctx.save();
          ctx.translate(-cell * 0.14 + i * cell * 0.07, cell * 0.34);
          ctx.rotate(Math.PI / 4);
          const size = i === 4 && level >= 5 ? 1.4 : 1.1;
          ctx.fillRect(-size, -size, size * 2, size * 2);
          ctx.restore();
        }
      }

      // A selected, upgradeable tower gets an explicit gold upgrade chevron.
      if (selected && level < maxLevel && game.crystals >= game.getUpgradeCost(tower)) {
        const bob = Math.sin(time * 3.2 + tower.x) * 1.4;
        ctx.save();
        ctx.translate(0, -cell * 0.54 + bob);
        ctx.strokeStyle = hexA(SEM.resource, 0.92);
        ctx.lineWidth = 1.5;
        ctx.shadowColor = SEM.resource;
        ctx.shadowBlur = 7;
        ctx.beginPath();
        ctx.moveTo(-4.2, 2.4);
        ctx.lineTo(0, -1.2);
        ctx.lineTo(4.2, 2.4);
        ctx.moveTo(-4.2, 7.2);
        ctx.lineTo(0, 3.6);
        ctx.lineTo(4.2, 7.2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.scale(scale, scale);
      if (level >= 5) {
        ctx.strokeStyle = hexA(accent, 0.3);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(0, 0, 16.5, 0, TAU);
        ctx.stroke();
      }

      // High tiers get a restrained neon bloom around the body.
      if (level >= 4) {
        ctx.shadowColor = hexA(accent, 0.7);
        ctx.shadowBlur = level >= 5 ? 11 : 6;
      }

      switch (tower.type) {
        case 'prism':
          this._drawPrismTower(ctx, tower, color, accent, time, recoil, level);
          break;
        case 'gatling':
          this._drawGatlingTower(ctx, tower, color, accent, time, recoil, level);
          break;
        case 'cannon':
          this._drawCannonTower(ctx, tower, color, accent, time, recoil, level);
          break;
        case 'laser':
          this._drawLaserTower(ctx, tower, color, accent, time, recoil, level);
          break;
        case 'shock':
          this._drawShockTower(ctx, tower, color, accent, time, recoil, level);
          break;
        case 'frost':
          this._drawFrostTower(ctx, tower, color, accent, time, recoil, level);
          break;
        case 'tesla':
          this._drawTeslaTower(ctx, tower, color, accent, time, recoil, level);
          break;
        case 'beacon':
          this._drawBeaconTower(ctx, tower, color, accent, time, recoil, level);
          break;
      }
      ctx.shadowBlur = 0;

      this._drawTowerTierCrown(ctx, color, accent, time, level, seed, tower);
      ctx.restore();
      ctx.restore();
    }

    _drawTowerTierGround(ctx, color, accent, time, level, cell, seed) {
      if (level <= 1) return;
      // Level 2: a simple stabiliser ring.
      ctx.save();
      ctx.strokeStyle = hexA(color, 0.16 + level * 0.025);
      ctx.lineWidth = 0.9;
      ctx.setLineDash([cell * 0.045, cell * 0.07]);
      ctx.lineDashOffset = -time * 12;
      ctx.beginPath();
      ctx.arc(0, 0, cell * 0.455, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

      // Level 3: cardinal calibration ticks.
      if (level >= 3) {
        ctx.strokeStyle = hexA(accent, 0.28);
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          const a = time * 0.25 + i * TAU / 4 + seed * 0.2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * cell * 0.46, Math.sin(a) * cell * 0.46);
          ctx.lineTo(Math.cos(a) * cell * 0.51, Math.sin(a) * cell * 0.51);
          ctx.stroke();
        }
      }

      // Level 4: a counter-rotating broken orbit.
      if (level >= 4) {
        ctx.rotate(-time * 0.24 + seed);
        ctx.strokeStyle = hexA(accent, 0.24);
        ctx.lineWidth = 0.8;
        for (let i = 0; i < 4; i++) {
          const a = i * TAU / 4;
          ctx.beginPath();
          ctx.arc(0, 0, cell * 0.47, a + 0.18, a + 0.95);
          ctx.stroke();
        }
      }

      // Level 5: an eight-point halo with orbiting nodes.
      if (level >= 5) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 2.4 + seed);
        ctx.rotate(time * 0.16);
        ctx.strokeStyle = hexA(accent, 0.13 + pulse * 0.13);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, cell * (0.505 + pulse * 0.018), 0, TAU);
        ctx.stroke();
        for (let i = 0; i < 8; i++) {
          const a = i * TAU / 8;
          ctx.save();
          ctx.translate(Math.cos(a) * cell * 0.5, Math.sin(a) * cell * 0.5);
          ctx.rotate(a + Math.PI / 4);
          ctx.fillStyle = hexA(accent, 0.28 + pulse * 0.2);
          ctx.fillRect(-1.1, -1.1, 2.2, 2.2);
          ctx.restore();
        }
      }
      ctx.restore();
    }

    _drawTowerTierCrown(ctx, color, accent, time, level, seed, tower) {
      if (level <= 2) return;
      // Level 3: broken halo.
      ctx.save();
      ctx.rotate(-time * 0.35 + seed);
      ctx.strokeStyle = hexA(accent, 0.18 + level * 0.03);
      ctx.lineWidth = 0.85;
      for (let i = 0; i < 3; i++) {
        const a = i * TAU / 3;
        ctx.beginPath();
        ctx.arc(0, 0, 17.4, a, a + 1.05);
        ctx.stroke();
      }
      ctx.restore();

      // Level 4: orbital stabiliser nodes.
      if (level >= 4) {
        const nodes = 3;
        for (let i = 0; i < nodes; i++) {
          const a = time * 0.75 + i * TAU / nodes + seed;
          const px = Math.cos(a) * 18;
          const py = Math.sin(a) * 18;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(a);
          ctx.fillStyle = hexA(accent, 0.78);
          ctx.fillRect(-1.3, -1.3, 2.6, 2.6);
          ctx.strokeStyle = hexA(color, 0.4);
          ctx.lineWidth = 0.7;
          ctx.strokeRect(-2.8, -2.8, 5.6, 5.6);
          ctx.restore();
        }
      }

      // Level 5: a five-point crown and a distinct charge core.
      if (level >= 5) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 2.8 + seed);
        ctx.save();
        ctx.rotate(Math.PI / 2 + Math.sin(time * 0.45 + seed) * 0.15);
        ctx.strokeStyle = hexA(accent, 0.4 + pulse * 0.18);
        ctx.lineWidth = 0.9;
        U.starPath(ctx, 0, 0, 21.5, 15.5, 5, 0);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = hexA(accent, 0.16 + pulse * 0.2);
        ctx.beginPath();
        ctx.arc(0, 0, 3.2 + pulse * 1.4, 0, TAU);
        ctx.fill();
      }
      if (level >= 2) {
        // Roman tier numeral keeps the upgrade ladder readable at phone scale.
        const numerals = ['', 'I', 'II', 'III', 'IV', 'V'];
        ctx.fillStyle = hexA(accent, 0.62);
        ctx.font = '4.6px "Cascadia Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(numerals[level] || '', 0, 21.8);
      }
      void tower;
    }

    _drawBeaconAura(ctx, color, accent, time, range) {
      if (range <= 0) return;
      ctx.save();
      // Faint permanent detection boundary.
      ctx.strokeStyle = hexA(color, 0.13);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 7]);
      ctx.lineDashOffset = -time * 9;
      ctx.beginPath();
      ctx.arc(0, 0, range, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

      // A sweeping scan wedge makes the reveal radius readable without text.
      ctx.save();
      ctx.rotate(time * 0.52);
      const sweep = ctx.createLinearGradient(0, 0, range, 0);
      sweep.addColorStop(0, hexA(color, 0.22));
      sweep.addColorStop(0.55, hexA(color, 0.08));
      sweep.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = sweep;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, range, -0.2, 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Broken inner ring.
      ctx.rotate(-time * 0.28);
      ctx.strokeStyle = hexA(accent, 0.3);
      ctx.lineWidth = 0.9;
      for (let i = 0; i < 3; i++) {
        const a = i * TAU / 3;
        ctx.beginPath();
        ctx.arc(0, 0, range * 0.86, a + 0.2, a + 1.0);
        ctx.stroke();
      }
      ctx.restore();
    }

    _drawBeaconTower(ctx, tower, color, accent, time, recoil, level) {
      // Rotating outer housing.
      ctx.save();
      ctx.rotate(time * 0.28);
      ctx.strokeStyle = hexA(color, 0.75);
      ctx.lineWidth = 1.15;
      U.polygon(ctx, 0, 0, 10.5, 6, 0);
      ctx.stroke();
      ctx.strokeStyle = hexA(accent, 0.34);
      ctx.lineWidth = 0.7;
      U.polygon(ctx, 0, 0, 13, 6, 0);
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6;
        ctx.fillStyle = hexA(accent, 0.7);
        ctx.fillRect(Math.cos(a) * 11.7 - 0.7, Math.sin(a) * 11.7 - 0.7, 1.4, 1.4);
      }
      ctx.restore();

      // Beacon lantern. The upgraded tier (远侦) runs a brighter core
      // inside a second focusing ring.
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.6);
      const upgraded = level >= 2;
      ctx.fillStyle = hexA(color, 0.16 + pulse * (upgraded ? 0.18 : 0.12));
      ctx.beginPath();
      ctx.arc(0, 0, upgraded ? 8.4 : 7.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = hexA(accent, 0.55 + pulse * 0.25);
      ctx.lineWidth = 1;
      U.polygon(ctx, 0, 0, 5.4, 4, time * 0.45);
      ctx.stroke();
      ctx.fillStyle = hexA(accent, 0.55 + pulse * 0.35);
      ctx.beginPath();
      ctx.arc(0, 0, (2.2 + pulse * 0.9) * (upgraded ? 1.25 : 1), 0, TAU);
      ctx.fill();
      if (upgraded) {
        ctx.strokeStyle = hexA(accent, 0.42);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, TAU);
        ctx.stroke();
      }

      // Four short light vanes.
      const vaneOuter = upgraded ? 13.5 : 11.5;
      for (let i = 0; i < 4; i++) {
        const a = time * 0.55 + i * TAU / 4;
        ctx.strokeStyle = hexA(accent, 0.3 + pulse * 0.28);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 6.5, Math.sin(a) * 6.5);
        ctx.lineTo(Math.cos(a) * vaneOuter, Math.sin(a) * vaneOuter);
        ctx.stroke();
      }
      void recoil;
    }

    _drawPrismTower(ctx, tower, color, accent, time, recoil, level) {
      // Central rotating crystal.
      ctx.save();
      ctx.rotate(tower.angle || Math.PI / 2);
      ctx.fillStyle = 'rgba(4,14,22,0.95)';
      ctx.strokeStyle = hexA(color, 0.8);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-4, -4.5);
      ctx.lineTo(3, -8.5);
      ctx.lineTo(8, 0);
      ctx.lineTo(3, 8.5);
      ctx.lineTo(-4, 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = hexA(accent, 0.62);
      ctx.beginPath();
      ctx.moveTo(3, -8.5);
      ctx.lineTo(8, 0);
      ctx.lineTo(3, 8.5);
      ctx.stroke();
      // Arrow barrel.
      const back = recoil * 3;
      ctx.strokeStyle = hexA(accent, 0.92);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(2 - back, 0);
      ctx.lineTo(15 - back, 0);
      ctx.stroke();
      ctx.fillStyle = hexA(accent, 0.9);
      ctx.beginPath();
      ctx.moveTo(19 - back, 0);
      ctx.lineTo(13 - back, -3.2);
      ctx.lineTo(14 - back, 0);
      ctx.lineTo(13 - back, 3.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // Side fins.
      ctx.strokeStyle = hexA(color, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-7, 7);
      ctx.lineTo(-13, 12);
      ctx.moveTo(7, 7);
      ctx.lineTo(13, 12);
      ctx.stroke();
      if (level >= 2) {
        ctx.strokeStyle = hexA(color, 0.6);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(-8.5, 2);
        ctx.lineTo(-13.5, 5.2);
        ctx.moveTo(8.5, 2);
        ctx.lineTo(13.5, 5.2);
        ctx.stroke();
        U.polygon(ctx, 0, 0, 6.2, 4, Math.PI / 4);
        ctx.strokeStyle = hexA(accent, 0.5);
        ctx.stroke();
      }
      if (level >= 3) {
        // Twin crystal pods on the flanks.
        for (let side = -1; side <= 1; side += 2) {
          ctx.save();
          ctx.translate(side * 10.5, 0);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = hexA(color, 0.18);
          ctx.strokeStyle = hexA(accent, 0.72);
          ctx.lineWidth = 0.9;
          ctx.fillRect(-2.6, -2.6, 5.2, 5.2);
          ctx.strokeRect(-2.6, -2.6, 5.2, 5.2);
          ctx.restore();
        }
      }
      if (level >= 4) {
        ctx.fillStyle = hexA(accent, 0.55);
        ctx.fillRect(-14, -2, 2, 4);
        ctx.fillRect(12, -2, 2, 4);
        ctx.strokeStyle = hexA(accent, 0.36);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(0, 0, 13.5, -2.4, -0.75);
        ctx.stroke();
      }
      if (level >= 5) {
        // A halo of orbiting shards.
        for (let i = 0; i < 3; i++) {
          const a = time * 1.05 + i * TAU / 3;
          ctx.save();
          ctx.translate(Math.cos(a) * 15.5, Math.sin(a) * 15.5);
          ctx.rotate(a + Math.PI / 4);
          ctx.fillStyle = hexA(accent, 0.85);
          ctx.fillRect(-1.5, -1.5, 3, 3);
          ctx.restore();
        }
        ctx.strokeStyle = hexA(accent, 0.55);
        ctx.beginPath();
        ctx.arc(0, 0, 2.2 + Math.sin(time * 3) * 0.5, 0, TAU);
        ctx.stroke();
      }
    }

    _drawGatlingTower(ctx, tower, color, accent, time, recoil, level) {
      ctx.save();
      ctx.rotate(tower.angle || Math.PI / 2);
      // Housing.
      ctx.fillStyle = 'rgba(4,13,22,0.96)';
      ctx.strokeStyle = hexA(color, 0.75);
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(-8, -9);
      ctx.lineTo(4, -8);
      ctx.lineTo(9, -4);
      ctx.lineTo(9, 4);
      ctx.lineTo(4, 8);
      ctx.lineTo(-8, 9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      const spin = time * (tower.firing ? 11 : 1.8);
      for (let i = -1; i <= 1; i++) {
        const y = i * 4.1;
        ctx.strokeStyle = hexA(accent, i === 0 ? 0.9 : 0.56);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(5 - recoil * 3, y);
        ctx.lineTo(18 - recoil * 3, y);
        ctx.stroke();
      }
      ctx.strokeStyle = hexA(color, 0.38);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(0, 0, 6.5, spin, spin + Math.PI * 1.4);
      ctx.stroke();
      ctx.fillStyle = hexA(accent, 0.7);
      ctx.beginPath();
      ctx.arc(5 - recoil * 3, 0, 1.1, 0, TAU);
      ctx.fill();
      if (level >= 2) {
        // Barrel shroud ring.
        ctx.strokeStyle = hexA(accent, 0.55);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.ellipse(10.5 - recoil * 3, 0, 2.2, 7.2, 0, 0, TAU);
        ctx.stroke();
      }
      if (level >= 3) {
        // Ammo drum and belt.
        ctx.strokeStyle = hexA(color, 0.55);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.arc(-5.5, 0, 4.2, 0.3, Math.PI * 1.7);
        ctx.stroke();
        ctx.fillStyle = hexA(accent, 0.3);
        for (let i = 0; i < 4; i++) {
          const a = i * TAU / 4 + time * 0.8;
          ctx.fillRect(-5.5 + Math.cos(a) * 3.2 - 0.5, Math.sin(a) * 3.2 - 0.5, 1, 1);
        }
      }
      ctx.restore();
      if (level >= 2) {
        ctx.strokeStyle = hexA(color, 0.36);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(0, 0, 11.5, -0.7, 0.8);
        ctx.stroke();
      }
      if (level >= 3) {
        ctx.strokeStyle = hexA(color, 0.3);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(0, 0, 14, 1.1, 2.6);
        ctx.stroke();
      }
      if (level >= 4) {
        ctx.strokeStyle = hexA(color, 0.38);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, 15, Math.PI * 0.12, Math.PI * 0.45);
        ctx.stroke();
        for (let i = 0; i < 4; i++) {
          const a = time * 0.9 + i * TAU / 4;
          ctx.fillStyle = hexA(accent, 0.62);
          ctx.fillRect(Math.cos(a) * 14.2 - 0.7, Math.sin(a) * 14.2 - 0.7, 1.4, 1.4);
        }
      }
      if (level >= 5) {
        // Spinning heat-sink cage.
        ctx.save();
        ctx.rotate(time * 0.6);
        ctx.strokeStyle = hexA(accent, 0.36);
        ctx.lineWidth = 0.75;
        for (let i = 0; i < 3; i++) {
          const a = i * TAU / 3;
          ctx.beginPath();
          ctx.arc(0, 0, 17, a, a + 1.2);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    _drawCannonTower(ctx, tower, color, accent, time, recoil, level) {
      ctx.save();
      ctx.rotate(tower.angle || Math.PI / 2);
      // Heavy barrel.
      const back = recoil * 5;
      ctx.fillStyle = 'rgba(5,14,19,0.98)';
      ctx.strokeStyle = hexA(color, 0.8);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(2 - back, -6);
      ctx.lineTo(19 - back, -4);
      ctx.lineTo(19 - back, 4);
      ctx.lineTo(2 - back, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = hexA(accent, 0.7);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(17 - back, -6);
      ctx.lineTo(17 - back, 6);
      ctx.stroke();
      ctx.strokeStyle = hexA(color, 0.32);
      ctx.beginPath();
      ctx.moveTo(4, -3);
      ctx.lineTo(13, -2);
      ctx.moveTo(4, 3);
      ctx.lineTo(13, 2);
      ctx.stroke();
      ctx.restore();
      // Turret ring.
      ctx.strokeStyle = hexA(color, 0.55);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(0, 0, 9.5, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = hexA(accent, 0.4);
      ctx.beginPath();
      ctx.arc(0, 0, 7, -0.8 + time * 0.2, 1.5 + time * 0.2);
      ctx.stroke();
      if (level >= 2) {
        ctx.strokeStyle = hexA(accent, 0.48);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(15.5, -4.5);
        ctx.lineTo(15.5, 4.5);
        ctx.moveTo(12.5, -4.2);
        ctx.lineTo(12.5, 4.2);
        ctx.stroke();
      }
      if (level >= 3) {
        // Loader arm and recoil rail.
        ctx.strokeStyle = hexA(color, 0.5);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-8, -5);
        ctx.lineTo(-13, -9);
        ctx.lineTo(-13, -1);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = hexA(color, 0.16);
        ctx.fill();
      }
      if (level >= 4) {
        // Side armour blocks.
        ctx.fillStyle = hexA(accent, 0.22);
        ctx.strokeStyle = hexA(color, 0.55);
        ctx.lineWidth = 0.8;
        for (let side = -1; side <= 1; side += 2) {
          ctx.beginPath();
          ctx.moveTo(side * 7, -8.5);
          ctx.lineTo(side * 11, -6.5);
          ctx.lineTo(side * 11, 6.5);
          ctx.lineTo(side * 7, 8.5);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
      if (level >= 5) {
        // Gravitational orbit rings.
        ctx.save();
        ctx.rotate(-time * 0.4);
        ctx.strokeStyle = hexA(accent, 0.32);
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.ellipse(0, 0, 17, 7.5, 0.2, 0.2, 5.9);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(0, 0, 17, 7.5, -0.2, 3.5, 9.1);
        ctx.stroke();
        ctx.restore();
        for (let i = 0; i < 3; i++) {
          const a = time * 0.9 + i * TAU / 3;
          ctx.fillStyle = hexA(accent, 0.78);
          ctx.save();
          ctx.translate(Math.cos(a) * 15, Math.sin(a) * 7);
          ctx.rotate(a);
          ctx.fillRect(-1.4, -1.4, 2.8, 2.8);
          ctx.restore();
        }
        ctx.fillStyle = hexA(accent, 0.7);
        ctx.fillRect(-12, -1, 3, 2);
        ctx.fillRect(11, -1, 3, 2);
      }
    }

    _drawLaserTower(ctx, tower, color, accent, time, recoil, level) {
      const charge = tower.laserCharge || 0;
      ctx.save();
      ctx.rotate(tower.angle || Math.PI / 2);
      // Prongs.
      ctx.strokeStyle = hexA(color, 0.7);
      ctx.lineWidth = 1.35;
      ctx.beginPath();
      ctx.moveTo(-7, -10);
      ctx.lineTo(5, -6);
      ctx.lineTo(9 - recoil * 2, -3);
      ctx.moveTo(-7, 10);
      ctx.lineTo(5, 6);
      ctx.lineTo(9 - recoil * 2, 3);
      ctx.stroke();
      ctx.strokeStyle = hexA(accent, 0.45);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(1, 0, 7.5, -1.1, 1.1);
      ctx.stroke();
      if (level >= 2) {
        ctx.strokeStyle = hexA(color, 0.4);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(1, 0, 10.5, -0.85, 0.85);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(1, 0, 10.5, Math.PI - 0.85, Math.PI + 0.85);
        ctx.stroke();
      }
      ctx.restore();

      if (level >= 3) {
        // Focusing fins around the emitter.
        ctx.strokeStyle = hexA(accent, 0.45);
        ctx.lineWidth = 0.9;
        for (let i = 0; i < 4; i++) {
          const a = i * TAU / 4 + Math.PI / 4;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 10, Math.sin(a) * 10);
          ctx.lineTo(Math.cos(a) * 14, Math.sin(a) * 14);
          ctx.stroke();
        }
      }
      if (level >= 4) {
        for (let side = -1; side <= 1; side += 2) {
          ctx.fillStyle = hexA(color, 0.24);
          ctx.strokeStyle = hexA(accent, 0.7);
          ctx.lineWidth = 0.8;
          ctx.save();
          ctx.translate(side * 13.5, 0);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-2, -2, 4, 4);
          ctx.strokeRect(-2, -2, 4, 4);
          ctx.restore();
        }
      }

      // Rotating prism.
      ctx.save();
      ctx.rotate(time * 0.9);
      ctx.strokeStyle = hexA(accent, 0.9);
      ctx.lineWidth = 1.2;
      U.polygon(ctx, 0, 0, 6.4, 4, 0);
      ctx.stroke();
      ctx.fillStyle = hexA(color, 0.22 + charge * 0.5);
      ctx.fill();
      if (level >= 4) {
        ctx.rotate(Math.PI / 4);
        U.polygon(ctx, 0, 0, 8.4, 4, 0);
        ctx.strokeStyle = hexA(color, 0.5);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = hexA(accent, 0.55 + charge * 0.4);
      ctx.beginPath();
      ctx.arc(0, 0, 1.4 + charge, 0, TAU);
      ctx.fill();
      if (level >= 5) {
        ctx.strokeStyle = hexA(color, 0.42);
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, TAU);
        ctx.stroke();
        for (let i = 0; i < 3; i++) {
          const a = -time * 0.7 + i * TAU / 3;
          ctx.fillStyle = hexA(accent, 0.7);
          ctx.beginPath();
          ctx.arc(Math.cos(a) * 15, Math.sin(a) * 15, 1.2, 0, TAU);
          ctx.fill();
        }
      }
    }

    _drawShockTower(ctx, tower, color, accent, time, recoil, level) {
      const pulse = (Math.sin(time * 2.2) * 0.5 + 0.5) * 1.5;
      ctx.strokeStyle = hexA(color, 0.26 + pulse * 0.06);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(0, 0, 15 + pulse, 0, TAU);
      ctx.stroke();
      ctx.save();
      ctx.rotate(time * 0.35);
      ctx.strokeStyle = hexA(color, 0.62);
      ctx.lineWidth = 1;
      U.polygon(ctx, 0, 0, 10.5, 3, 0);
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.rotate(-time * 0.55);
      ctx.strokeStyle = hexA(accent, 0.74);
      ctx.lineWidth = 1.15;
      U.polygon(ctx, 0, 0, 7.2, 6, 0);
      ctx.stroke();
      ctx.fillStyle = hexA(color, 0.2 + (tower.firing ? 0.34 : 0.1));
      ctx.beginPath();
      ctx.arc(0, 0, 4.2, 0, TAU);
      ctx.fill();
      if (level >= 2) {
        ctx.strokeStyle = hexA(accent, 0.5);
        ctx.lineWidth = 0.85;
        U.polygon(ctx, 0, 0, 4.2, 6, Math.PI / 6);
        ctx.stroke();
      }
      if (level >= 4) {
        ctx.strokeStyle = hexA(color, 0.55);
        ctx.lineWidth = 1.1;
        U.polygon(ctx, 0, 0, 2.4, 3, Math.PI / 2);
        ctx.stroke();
      }
      ctx.restore();
      const ticks = level >= 3 ? 6 : 4;
      for (let i = 0; i < ticks; i++) {
        const a = (i / ticks) * TAU + time * 0.1;
        ctx.strokeStyle = hexA(accent, 0.35);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 11.5, Math.sin(a) * 11.5);
        ctx.lineTo(Math.cos(a) * (level >= 3 ? 15 : 14), Math.sin(a) * (level >= 3 ? 15 : 14));
        ctx.stroke();
      }
      if (level >= 2) {
        ctx.strokeStyle = hexA(color, 0.24);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(0, 0, 16.5 + Math.sin(time * 1.7) * 0.8, 0.2, 2.9);
        ctx.stroke();
      }
      if (level >= 4) {
        ctx.save();
        ctx.rotate(time * 0.4);
        ctx.strokeStyle = hexA(accent, 0.3);
        ctx.lineWidth = 0.7;
        for (let i = 0; i < 3; i++) {
          const a = i * TAU / 3;
          ctx.beginPath();
          ctx.arc(0, 0, 12.5, a, a + 0.7);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (level >= 5) {
        ctx.strokeStyle = hexA(accent, 0.4);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(0, 0, 16, 0.4, 2.1);
        ctx.stroke();
        for (let i = 0; i < 4; i++) {
          const a = -time * 0.6 + i * TAU / 4;
          ctx.fillStyle = hexA(accent, 0.62);
          ctx.fillRect(Math.cos(a) * 17.5 - 1, Math.sin(a) * 17.5 - 1, 2, 2);
        }
      }
    }

    _drawFrostTower(ctx, tower, color, accent, time, recoil, level) {
      const spokes = level >= 3 ? 8 : 6;
      ctx.save();
      ctx.rotate(time * 0.32);
      for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * TAU;
        ctx.strokeStyle = hexA(i % 2 === 0 ? color : accent, 0.72);
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 3, Math.sin(a) * 3);
        ctx.lineTo(Math.cos(a) * 13, Math.sin(a) * 13);
        ctx.stroke();
        ctx.save();
        ctx.translate(Math.cos(a) * 12, Math.sin(a) * 12);
        ctx.rotate(Math.PI / 4);
        ctx.strokeRect(-2.2, -2.2, 4.4, 4.4);
        if (level >= 4) {
          ctx.strokeStyle = hexA(accent, 0.4);
          ctx.strokeRect(-3.6, -3.6, 7.2, 7.2);
        }
        ctx.restore();
      }
      ctx.strokeStyle = hexA(color, 0.52);
      U.polygon(ctx, 0, 0, 8.5, 6, Math.PI / 6);
      ctx.stroke();
      if (level >= 2) {
        ctx.strokeStyle = hexA(accent, 0.42);
        ctx.lineWidth = 0.8;
        U.polygon(ctx, 0, 0, 11.5, 6, Math.PI / 6);
        ctx.stroke();
      }
      if (level >= 5) {
        ctx.strokeStyle = hexA(accent, 0.3);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(0, 0, 16.5, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = hexA(accent, 0.2 + Math.sin(time * 2) * 0.03);
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = hexA(color, 0.22);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(0, 0, 15.5, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      if (level >= 3) {
        ctx.strokeStyle = hexA(accent, 0.24);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(0, 0, 17, Math.PI * 1.1, Math.PI * 1.85);
        ctx.stroke();
      }
      if (level >= 4) {
        for (let i = 0; i < 3; i++) {
          const a = -time * 0.8 + i * TAU / 3;
          ctx.fillStyle = hexA(accent, 0.68);
          ctx.save();
          ctx.translate(Math.cos(a) * 15.2, Math.sin(a) * 15.2);
          ctx.rotate(a);
          ctx.fillRect(-1.4, -1.4, 2.8, 2.8);
          ctx.restore();
        }
      }
      if (level >= 5) {
        for (let i = 0; i < 6; i++) {
          const a = time * 0.7 + (i / 6) * TAU;
          ctx.fillStyle = hexA(accent, 0.6);
          ctx.beginPath();
          ctx.arc(Math.cos(a) * 17, Math.sin(a) * 17, 1.2, 0, TAU);
          ctx.fill();
        }
      }
    }

    _drawTeslaTower(ctx, tower, color, accent, time, recoil, level) {
      const arms = level >= 2 ? 4 : 3;
      ctx.strokeStyle = hexA(color, 0.68);
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      U.polygon(ctx, 0, 0, 13, 3, Math.PI / 2 + time * 0.12);
      ctx.stroke();
      for (let i = 0; i < arms; i++) {
        const a = Math.PI / 2 + (i / arms) * TAU + time * 0.12;
        const px = Math.cos(a) * 9.8;
        const py = Math.sin(a) * 9.8;
        ctx.strokeStyle = hexA(color, 0.52);
        ctx.beginPath();
        ctx.moveTo(px * 0.6, py * 0.6);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.fillStyle = hexA(accent, 0.8);
        ctx.beginPath();
        ctx.arc(px, py, 1.2, 0, TAU);
        ctx.fill();
        if (level >= 4) {
          ctx.strokeStyle = hexA(accent, 0.32);
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.arc(px, py, 2.6, -0.6 + time, 0.6 + time);
          ctx.stroke();
        }
      }
      ctx.save();
      ctx.rotate(-time * 0.7);
      ctx.strokeStyle = hexA(accent, 0.75);
      ctx.lineWidth = 1.1;
      U.polygon(ctx, 0, 0, 6.3, 4, 0);
      ctx.stroke();
      if (level >= 3) {
        ctx.strokeStyle = hexA(color, 0.5);
        ctx.lineWidth = 0.85;
        U.polygon(ctx, 0, 0, 9.2, 6, Math.PI / 6);
        ctx.stroke();
      }
      if (level >= 5) {
        ctx.strokeStyle = hexA(accent, 0.42);
        ctx.lineWidth = 0.8;
        U.polygon(ctx, 0, 0, 11.8, 3, Math.PI / 2);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = hexA(accent, 0.16 + Math.sin(time * 3.2) * 0.04);
      ctx.beginPath();
      ctx.arc(0, 0, 4.4, 0, TAU);
      ctx.fill();
      if (level >= 2) {
        ctx.strokeStyle = hexA(color, 0.3);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(0, 0, 15.5, 0.4, 2.5);
        ctx.stroke();
      }
      if (level >= 4) {
        for (let i = 0; i < 4; i++) {
          const a = time * 0.9 + i * TAU / 4;
          ctx.strokeStyle = hexA(accent, 0.5);
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 15, Math.sin(a) * 15);
          ctx.lineTo(Math.cos(a) * 18, Math.sin(a) * 18);
          ctx.stroke();
        }
      }
      if (level >= 5) {
        ctx.strokeStyle = hexA(accent, 0.45);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(0, 0, 16, 0, TAU);
        ctx.stroke();
        for (let i = 0; i < 6; i++) {
          const a = -time * 0.5 + i * TAU / 6;
          ctx.fillStyle = hexA(accent, 0.66);
          ctx.beginPath();
          ctx.arc(Math.cos(a) * 17, Math.sin(a) * 17, 1.1, 0, TAU);
          ctx.fill();
        }
      }
    }

    _drawEnemies(ctx, game, time) {
      const lowDetail = game.enemies.length > 42;
      for (let i = 0; i < game.enemies.length; i++) {
        const enemy = game.enemies[i];
        if (enemy.dead) continue;
        this._drawEnemy(ctx, enemy, game, time, lowDetail);
      }
    }

    _drawEnemy(ctx, enemy, game, time, lowDetail) {
      const cell = this.cell;
      const def = enemy.def;
      const color = def.color;
      const cx = this.ox + enemy.x * cell;
      const cy = this.oy + enemy.y * cell;
      const spawn = enemy.spawnAnim == null ? 1 : U.clamp(enemy.spawnAnim, 0, 1);
      const spawnScale = 0.4 + U.easeOutCubic(spawn) * 0.6;
      const radius = def.radius * cell * spawnScale * (def.boss ? 1.1 : 1);
      const hitFlash = enemy.hitFlash || 0;
      const slowed = enemy.slowTimer > 0 && (def.tenacity || 0) < 1;
      const angle = enemy.angle || Math.PI / 2;
      const sides = def.sides || (def.shape === 'octagon' ? 8 : def.shape === 'hex' ? 6 : def.shape === 'pentagon' ? 5 : def.shape === 'square' ? 4 : 3);
      const stealth = !!def.stealth;
      const revealed = !stealth || game._enemyRevealed(enemy);
      const tenacious = (def.tenacity || 0) > 0;
      const shieldActive = enemy.shield > 0;
      const shieldRatio = enemy.maxShield ? U.clamp(enemy.shield / enemy.maxShield, 0, 1) : 0;
      const shieldFlash = enemy.shieldFlash || 0;
      let rot = angle;
      if (def.id === 'drone') rot = angle * 0.2 + time * 0.35;
      else if (def.shape === 'shield') rot = time * 0.06;
      else if (def.shape === 'octagon' && def.boss) rot = time * 0.28;
      else if (def.shape === 'kite') rot = angle + Math.PI / 2;
      else if (def.shape === 'heptagon') rot = angle * 0.35 - time * 0.2;
      else if (def.shape === 'octagon') rot = angle * 0.15 + time * 0.05;
      const bodyAlpha = (0.25 + spawn * 0.75) * (stealth && !revealed ? 0.5 : 1);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalAlpha = 0.25 + spawn * 0.75;

      // Cheap team-colour aura. Gradients are reserved for bosses and highlights.
      if (def.boss) {
        const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 2.3);
        halo.addColorStop(0, hexA(color, 0.18));
        halo.addColorStop(1, hexA(color, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 2.3, 0, TAU);
        ctx.fill();
      } else if (!lowDetail) {
        ctx.fillStyle = hexA(color, 0.055);
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.95, 0, TAU);
        ctx.fill();
      }

      // Stealth refraction halo behind the body; revealed units get a gold lock-on ring.
      if (stealth) {
        ctx.save();
        if (!revealed) {
          ctx.strokeStyle = hexA('#b9e9ff', 0.24 + Math.sin(time * 4 + enemy.x) * 0.08);
          ctx.lineWidth = 0.8;
          ctx.setLineDash([2, 4]);
          ctx.lineDashOffset = -time * 9;
          ctx.beginPath();
          ctx.arc(0, 0, radius * 1.75, 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = hexA('#ffd76a', 0.5 + Math.sin(time * 4 + enemy.x) * 0.12);
          ctx.lineWidth = 0.9;
          ctx.setLineDash([3, 3]);
          ctx.lineDashOffset = time * 8;
          ctx.beginPath();
          ctx.arc(0, 0, radius * 1.62, 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = hexA('#ffe8a8', 0.8);
          ctx.beginPath();
          ctx.arc(0, -radius * 1.9, 1.6, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }

      // Motion trail.
      if (!def.boss && (def.id === 'scout' || def.id === 'shard' || def.id === 'wraith')) {
        ctx.strokeStyle = hexA(color, 0.18);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-Math.cos(angle) * radius * 0.6, -Math.sin(angle) * radius * 0.6);
        ctx.lineTo(-Math.cos(angle) * radius * 2.5, -Math.sin(angle) * radius * 2.5);
        ctx.stroke();
      }

      // Slow ring.
      if (slowed) {
        ctx.strokeStyle = 'rgba(131,199,255,0.74)';
        ctx.lineWidth = 0.9;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.55, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (tenacious && enemy.slowBlocked > 0) {
        ctx.strokeStyle = 'rgba(255,154,98,' + U.clamp(enemy.slowBlocked * 2.4, 0, 0.9) + ')';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.5, 0, TAU);
        ctx.stroke();
      }

      // Orbit arcs.
      if (!lowDetail || def.boss) {
        ctx.strokeStyle = hexA(color, 0.24);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.3, time * 0.8 + 0.3, time * 0.8 + 2.4);
        ctx.stroke();
      }
      if (def.boss) {
        ctx.strokeStyle = hexA(color, 0.3);
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.6, -time * 0.4, -time * 0.4 + 4.2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Main hollow body.
      ctx.save();
      ctx.globalAlpha = bodyAlpha;
      ctx.rotate(rot);
      ctx.fillStyle = 'rgba(3,9,16,0.94)';
      U.polygon(ctx, 0, 0, radius, sides, def.shape === 'diamond' ? 0 : Math.PI / 2);
      ctx.fill();
      ctx.strokeStyle = hexA(color, hitFlash > 0 ? 0.25 : 0.13);
      ctx.lineWidth = def.boss ? 5.5 : 3.8;
      ctx.stroke();
      ctx.strokeStyle = hitFlash > 0 ? 'rgba(255,255,255,0.95)' : hexA(color, 0.9);
      ctx.lineWidth = def.boss ? 1.8 : 1.25;
      ctx.stroke();

      // Inner glyph, shaped by the dominant trait.
      ctx.strokeStyle = hexA(color, def.boss ? 0.6 : 0.38);
      ctx.lineWidth = 0.8;
      if (def.boss) {
        U.polygon(ctx, 0, 0, radius * 0.62, 6, -time * 0.5);
        ctx.stroke();
        U.polygon(ctx, 0, 0, radius * 0.35, 4, time * 0.8);
        ctx.stroke();
        ctx.strokeStyle = hexA('#6fe7ff', 0.42 + shieldFlash * 1.4);
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.84, 0, TAU);
        ctx.stroke();
      } else if (def.shield) {
        U.polygon(ctx, 0, 0, radius * 0.6, 6, 0);
        ctx.stroke();
        ctx.strokeStyle = hexA('#9bfaff', 0.5);
        ctx.beginPath();
        ctx.moveTo(-radius * 0.3, 0);
        ctx.lineTo(radius * 0.3, 0);
        ctx.moveTo(0, -radius * 0.3);
        ctx.lineTo(0, radius * 0.3);
        ctx.stroke();
      } else if (stealth) {
        ctx.strokeStyle = hexA('#b9e9ff', 0.55);
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.58, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(-radius * 0.55, radius * 0.5);
        ctx.lineTo(radius * 0.45, -radius * 0.55);
        ctx.stroke();
      } else if (tenacious) {
        ctx.strokeStyle = hexA('#ff9a62', 0.5);
        ctx.lineWidth = 1.4;
        ctx.strokeRect(-radius * 0.4, -radius * 0.4, radius * 0.8, radius * 0.8);
      } else if (def.resist && (def.resist.energy >= 0.5 || def.resist.cryo >= 0.5)) {
        U.polygon(ctx, 0, 0, radius * 0.55, 7, time * 0.18);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.3, 0, TAU);
        ctx.stroke();
      } else if (!lowDetail) {
        U.polygon(ctx, 0, 0, radius * 0.48, sides, time * 0.25);
        ctx.stroke();
        ctx.strokeStyle = hexA(color, 0.2);
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.82, 0.3, 2.1);
        ctx.stroke();
      }
      // Facing notch.
      if (!lowDetail || def.boss) {
        ctx.fillStyle = hexA(color, 0.72);
        ctx.beginPath();
        ctx.moveTo(radius * 0.78, 0);
        ctx.lineTo(radius * 0.55, -radius * 0.2);
        ctx.lineTo(radius * 0.55, radius * 0.2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // Stealth scanline shimmer over the body.
      if (stealth && !revealed && !lowDetail) {
        ctx.save();
        ctx.globalAlpha = 0.35 + Math.sin(time * 5 + enemy.x) * 0.1;
        ctx.strokeStyle = 'rgba(185,233,255,0.7)';
        ctx.lineWidth = 0.6;
        for (let s = -1; s <= 1; s++) {
          const y = s * radius * 0.4 + Math.sin(time * 3 + s) * 1.5;
          ctx.beginPath();
          ctx.moveTo(-radius * 0.8, y);
          ctx.lineTo(radius * 0.8, y + 1.2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Active energy shield: a rotating hex bubble with a clear break point.
      if (shieldActive) {
        ctx.save();
        ctx.globalAlpha = (0.25 + spawn * 0.75) * (0.4 + shieldRatio * 0.6);
        const bubble = radius * 1.55;
        ctx.strokeStyle = hexA('#6fe7ff', 0.42 + shieldFlash * 1.8);
        ctx.lineWidth = 1.2 + shieldFlash * 2.4;
        ctx.setLineDash([3, 4]);
        ctx.lineDashOffset = -time * 14;
        ctx.beginPath();
        ctx.arc(0, 0, bubble, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = hexA('#9bfaff', 0.2 + shieldFlash * 1.2);
        ctx.lineWidth = 0.8;
        for (let f = 0; f < 3; f++) {
          const a = time * 0.55 + f * TAU / 3;
          ctx.beginPath();
          ctx.arc(0, 0, bubble, a, a + 0.62);
          ctx.stroke();
        }
        ctx.fillStyle = hexA('#6fe7ff', 0.035 + shieldFlash * 0.16);
        ctx.beginPath();
        ctx.arc(0, 0, bubble, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      // Tenacity brace corners.
      if (tenacious) {
        ctx.save();
        ctx.strokeStyle = hexA('#ff9a62', 0.55);
        ctx.lineWidth = 1.5;
        const b = radius * 1.28;
        const arm = radius * 0.34;
        for (let i = 0; i < 4; i++) {
          const sx = i % 2 === 0 ? -1 : 1;
          const sy = i < 2 ? -1 : 1;
          ctx.beginPath();
          ctx.moveTo(sx * b - sx * arm, sy * b);
          ctx.lineTo(sx * b, sy * b);
          ctx.lineTo(sx * b, sy * b - sy * arm);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Trait badges above the health bar.
      const traitIds = (def.traits || []).filter(function (id) {
        return id !== 'boss';
      });
      if (traitIds.length && (!lowDetail || def.boss)) {
        const step = 8;
        const badgeY = -radius - (def.boss ? 26 : 18);
        const startX = -((traitIds.length - 1) * step) / 2;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '6px "Cascadia Mono", monospace';
        for (let i = 0; i < traitIds.length; i++) {
          const trait = C.TRAITS[traitIds[i]];
          if (!trait) continue;
          const bx = startX + i * step;
          ctx.fillStyle = 'rgba(2,8,13,0.82)';
          ctx.strokeStyle = hexA(trait.color, 0.82);
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(bx, badgeY - 4);
          ctx.lineTo(bx + 3.8, badgeY);
          ctx.lineTo(bx, badgeY + 4);
          ctx.lineTo(bx - 3.8, badgeY);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = trait.color;
          ctx.fillText(trait.short, bx, badgeY + 0.2);
        }
        ctx.restore();
      }

      // HP and shield bars.
      if (enemy.hp < enemy.maxHp || def.boss || shieldActive) {
        const barW = def.boss ? radius * 2.2 : radius * 1.8;
        const barY = -radius - (def.boss ? 10 : 7);
        const barH = def.boss ? 3.5 : 2.2;
        if (shieldActive) {
          const shieldW = barW * shieldRatio;
          ctx.fillStyle = 'rgba(1,5,10,0.75)';
          ctx.fillRect(-barW / 2, barY - barH - 1.4, barW, barH * 0.8);
          ctx.fillStyle = '#6fe7ff';
          ctx.fillRect(-barW / 2, barY - barH - 1.4, shieldW, barH * 0.8);
        }
        ctx.fillStyle = 'rgba(1,5,10,0.75)';
        ctx.fillRect(-barW / 2, barY, barW, barH);
        const ratio = U.clamp(enemy.hp / enemy.maxHp, 0, 1);
        ctx.fillStyle = enemy.hp / enemy.maxHp < 0.35 ? '#ff7b6f' : def.boss ? '#ff8a4d' : '#ff5a4d';
        ctx.fillRect(-barW / 2, barY, barW * ratio, barH);
        // Little ticks.
        if (!lowDetail || def.boss) {
          ctx.fillStyle = 'rgba(2,8,13,0.7)';
          for (let t = 1; t < 4; t++) {
            ctx.fillRect(-barW / 2 + (barW * t) / 4, barY, 0.6, barH);
          }
        }
      }

      if (def.boss) {
        ctx.fillStyle = hexA(color, 0.65);
        ctx.font = '5px "Cascadia Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SINGULARITY', 0, -radius - (def.traits.length ? 36 : 16));
      }
      ctx.restore();
    }

    _drawProjectiles(ctx, game, time) {
      const cell = this.cell;
      for (let i = 0; i < game.projectiles.length; i++) {
        const p = game.projectiles[i];
        const tier = p.tier || 1;
        const px = this.ox + p.x * cell;
        const py = this.oy + p.y * cell;
        ctx.save();
        ctx.translate(px, py);
        if (p.type === 'arrow') {
          ctx.rotate(p.angle || 0);
          const stretch = 1 + (tier - 1) * 0.055;
          if (tier >= 3) {
            // Ionised wake left behind the arrow.
            ctx.strokeStyle = hexA(p.color, 0.14 + tier * 0.015);
            ctx.lineWidth = 3.4;
            ctx.beginPath();
            ctx.moveTo(-cell * (0.3 + tier * 0.035), 0);
            ctx.lineTo(cell * 0.12, 0);
            ctx.stroke();
          }
          ctx.strokeStyle = hexA(p.color, 0.28);
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.moveTo(-cell * 0.22 * stretch, 0);
          ctx.lineTo(cell * 0.16 * stretch, 0);
          ctx.stroke();
          ctx.strokeStyle = hexA(p.color, 0.94);
          ctx.lineWidth = 1.1 + (tier >= 4 ? 0.25 : 0);
          ctx.beginPath();
          ctx.moveTo(-cell * 0.12 * stretch, 0);
          ctx.lineTo(cell * 0.16 * stretch, 0);
          ctx.stroke();
          const barbs = tier >= 4 ? 3 : 2;
          for (let b = 0; b < barbs; b++) {
            const t = (b + 1) / (barbs + 1);
            const bx = cell * 0.16 * stretch - cell * 0.13 * t;
            const len = cell * (0.055 + t * 0.02);
            ctx.beginPath();
            ctx.moveTo(bx, 0);
            ctx.lineTo(bx - len, -len);
            ctx.moveTo(bx, 0);
            ctx.lineTo(bx - len, len);
            ctx.stroke();
          }
          if (tier >= 5) {
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(-cell * 0.24, 0);
            ctx.lineTo(cell * 0.18, 0);
            ctx.stroke();
            ctx.strokeStyle = hexA(p.color, 0.4);
            ctx.beginPath();
            ctx.moveTo(-cell * 0.06, -cell * 0.055);
            ctx.lineTo(cell * 0.14, -cell * 0.055);
            ctx.moveTo(-cell * 0.06, cell * 0.055);
            ctx.lineTo(cell * 0.14, cell * 0.055);
            ctx.stroke();
          }
        } else if (p.type === 'bullet') {
          ctx.rotate(p.angle || 0);
          const size = 1 + (tier - 1) * 0.18;
          if (tier >= 4) {
            ctx.strokeStyle = hexA(p.color, 0.16);
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.moveTo(-cell * 0.38, 0);
            ctx.lineTo(cell * 0.06, 0);
            ctx.stroke();
          }
          ctx.fillStyle = hexA(p.color, 0.2);
          ctx.beginPath();
          ctx.arc(0, 0, cell * 0.055 * size, 0, TAU);
          ctx.fill();
          ctx.fillStyle = hexA(p.color, 0.96);
          ctx.fillRect(-cell * 0.11 * size, -0.65 * size, cell * 0.16 * size, 1.3 * size);
          if (tier >= 5) {
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.lineWidth = 0.55;
            ctx.beginPath();
            ctx.moveTo(-cell * 0.3, -1.1);
            ctx.lineTo(cell * 0.04, -1.1);
            ctx.moveTo(-cell * 0.3, 1.1);
            ctx.lineTo(cell * 0.04, 1.1);
            ctx.stroke();
          }
        } else if (p.type === 'shell') {
          const spin = (p.spin || 0) + time * 7;
          const size = 1 + (tier - 1) * 0.1;
          ctx.rotate(spin);
          ctx.strokeStyle = hexA(p.color, 0.2);
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(0, 0, cell * 0.14 * size, 0, TAU);
          ctx.stroke();
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.arc(0, 0, cell * 0.12 * size, 0.2, 4.4);
          ctx.stroke();
          ctx.fillStyle = hexA(p.color, 0.8);
          ctx.beginPath();
          ctx.arc(0, 0, cell * 0.035 * size, 0, TAU);
          ctx.fill();
          if (tier >= 3) {
            ctx.strokeStyle = hexA(p.color, 0.36);
            ctx.lineWidth = 0.8;
            for (let s = 0; s < Math.min(4, tier - 2); s++) {
              const a = spin * 1.4 + s * TAU / Math.max(1, Math.min(4, tier - 2));
              ctx.beginPath();
              ctx.arc(0, 0, cell * (0.2 + s * 0.03), a, a + 1.2);
              ctx.stroke();
            }
          }
          if (tier >= 5) {
            ctx.fillStyle = 'rgba(255,244,214,0.9)';
            for (let s = 0; s < 3; s++) {
              const a = -spin * 1.2 + s * TAU / 3;
              ctx.beginPath();
              ctx.arc(Math.cos(a) * cell * 0.22, Math.sin(a) * cell * 0.22, 1.1, 0, TAU);
              ctx.fill();
            }
          }
        }
        ctx.restore();
      }
    }

    _drawEffects(ctx, game, time) {
      const cell = this.cell;
      for (let i = 0; i < game.effects.length; i++) {
        const e = game.effects[i];
        if (e.life <= 0) continue;
        const t = 1 - e.life / e.maxLife;
        if (e.type === 'ring') {
          const tier = e.tier || 1;
          const r = U.lerp(e.r0, e.r1, U.easeOutCubic(t)) * cell;
          const alpha = (1 - t) * (e.alpha || 0.6);
          ctx.strokeStyle = hexA(e.color, alpha);
          ctx.lineWidth = (e.width || 1.2) * (1 - t * 0.6);
          ctx.beginPath();
          ctx.arc(this.ox + e.x * cell, this.oy + e.y * cell, r, 0, TAU);
          ctx.stroke();
          if (e.second) {
            ctx.strokeStyle = hexA(e.color, alpha * 0.4);
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.arc(this.ox + e.x * cell, this.oy + e.y * cell, r * 0.65, 0, TAU);
            ctx.stroke();
          }
          if (tier >= 4) {
            ctx.strokeStyle = hexA(e.color, alpha * 0.24);
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.arc(this.ox + e.x * cell, this.oy + e.y * cell, r * 1.14, 0, TAU);
            ctx.stroke();
          }
          if (tier >= 5) {
            const cx = this.ox + e.x * cell;
            const cy = this.oy + e.y * cell;
            for (let k = 0; k < 8; k++) {
              const a = (k / 8) * TAU + t * 0.8;
              ctx.strokeStyle = hexA(e.color, alpha * 0.4);
              ctx.beginPath();
              ctx.moveTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92);
              ctx.lineTo(cx + Math.cos(a) * r * 1.08, cy + Math.sin(a) * r * 1.08);
              ctx.stroke();
            }
          }
        } else if (e.type === 'beam') {
          const tier = e.tier || 1;
          const alpha = Math.pow(1 - t, 1.4);
          const x1 = this.ox + e.x1 * cell;
          const y1 = this.oy + e.y1 * cell;
          const x2 = this.ox + e.x2 * cell;
          const y2 = this.oy + e.y2 * cell;
          ctx.strokeStyle = hexA(e.color, alpha * 0.18);
          ctx.lineWidth = (e.width || 3) * (1 + Math.sin(time * 40) * 0.08);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          if (tier >= 3) {
            ctx.strokeStyle = hexA(e.color, alpha * 0.1);
            ctx.lineWidth = (e.width || 3) * 1.9;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
          ctx.strokeStyle = 'rgba(255,255,255,' + alpha * 0.82 + ')';
          ctx.lineWidth = 0.9 + (tier >= 5 ? 0.35 : 0);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          if (tier >= 4) {
            ctx.strokeStyle = hexA('#ffffff', alpha * 0.5);
            ctx.lineWidth = 0.5;
            const len = Math.hypot(x2 - x1, y2 - y1) || 1;
            const nx = -(y2 - y1) / len;
            const ny = (x2 - x1) / len;
            const off = Math.sin(time * 30) * 1.6;
            ctx.beginPath();
            ctx.moveTo(x1 + nx * off, y1 + ny * off);
            ctx.lineTo(x2 + nx * off, y2 + ny * off);
            ctx.stroke();
          }
          ctx.fillStyle = hexA(e.color, alpha * 0.8);
          ctx.beginPath();
          ctx.arc(x2, y2, 2.6 + (tier >= 5 ? 1.4 : 0), 0, TAU);
          ctx.fill();
        } else if (e.type === 'lightning') {
          const tier = e.tier || 1;
          const alpha = Math.pow(1 - t, 1.1);
          const points = e.points;
          for (let pass = 0; pass < 2; pass++) {
            ctx.strokeStyle = pass === 0 ? hexA(e.color, alpha * 0.22) : 'rgba(241,248,255,' + alpha * 0.8 + ')';
            ctx.lineWidth = pass === 0 ? (e.width || 3) * 2.2 : (e.width || 1.2);
            ctx.beginPath();
            for (let p = 0; p < points.length; p++) {
              const px = this.ox + points[p].x * cell;
              const py = this.oy + points[p].y * cell;
              if (p === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.stroke();
          }
          if (tier >= 4) {
            ctx.strokeStyle = hexA(e.color, alpha * 0.45);
            ctx.lineWidth = 0.7;
            for (let p = 1; p < points.length; p += 2) {
              const a = this.ox + points[p].x * cell;
              const b = this.oy + points[p].y * cell;
              const ang = Math.random() * TAU;
              ctx.beginPath();
              ctx.moveTo(a, b);
              ctx.lineTo(a + Math.cos(ang) * cell * 0.12, b + Math.sin(ang) * cell * 0.12);
              ctx.stroke();
            }
          }
        } else if (e.type === 'frostTrail') {
          const tier = e.tier || 1;
          const alpha = Math.pow(1 - t, 1.3);
          const x1 = this.ox + e.x1 * cell;
          const y1 = this.oy + e.y1 * cell;
          const x2 = this.ox + e.x2 * cell;
          const y2 = this.oy + e.y2 * cell;
          ctx.strokeStyle = hexA(e.color, alpha * 0.32);
          ctx.lineWidth = 1 + (tier >= 4 ? 0.4 : 0);
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = hexA(e.color, alpha * 0.85);
          const count = tier >= 4 ? 6 : 3;
          for (let p = 1; p <= count; p++) {
            const tt = p / (count + 1);
            const px = U.lerp(x1, x2, tt);
            const py = U.lerp(y1, y2, tt);
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(p + time * 2);
            const s = tier >= 5 ? 1.6 : 1.2;
            ctx.fillRect(-s, -s, s * 2, s * 2);
            ctx.restore();
          }
        } else if (e.type === 'muzzle') {
          const tier = e.tier || 1;
          const alpha = (1 - t) * 0.8;
          const size = (e.size || 1) * (1 + (tier - 1) * 0.12);
          ctx.fillStyle = hexA(e.color, alpha);
          ctx.beginPath();
          ctx.arc(this.ox + e.x * cell, this.oy + e.y * cell, (1.4 + t * 3) * size, 0, TAU);
          ctx.fill();
          if (tier >= 4) {
            ctx.strokeStyle = hexA('#ffffff', alpha * 0.6);
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.arc(this.ox + e.x * cell, this.oy + e.y * cell, (1.8 + t * 4) * size, 0, TAU);
            ctx.stroke();
          }
        } else if (e.type === 'spawn') {
          const alpha = (1 - t) * 0.6;
          ctx.strokeStyle = hexA(e.color, alpha);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(this.ox + e.x * cell, this.oy + e.y * cell, (0.1 + t * 0.5) * cell, 0, TAU);
          ctx.stroke();
        }
      }
    }

    _drawParticles(ctx, game) {
      const cell = this.cell;
      for (let i = 0; i < game.particles.length; i++) {
        const p = game.particles[i];
        if (p.life <= 0) continue;
        const alpha = U.clamp(p.life / p.maxLife, 0, 1);
        const px = this.ox + p.x * cell;
        const py = this.oy + p.y * cell;
        const vx = p.vx * cell * 0.022;
        const vy = p.vy * cell * 0.022;
        ctx.strokeStyle = hexA(p.color, alpha * (p.alpha || 0.9));
        ctx.lineWidth = p.size * cell * alpha;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - vx, py - vy);
        ctx.stroke();
        if (p.shape === 'diamond') {
          ctx.fillStyle = hexA(p.color, alpha * 0.8);
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-p.size * cell * 0.25, -p.size * cell * 0.25, p.size * cell * 0.5, p.size * cell * 0.5);
          ctx.restore();
        }
      }
    }

    _drawFloatTexts(ctx, game) {
      for (let i = 0; i < game.floatTexts.length; i++) {
        const f = game.floatTexts[i];
        const t = 1 - f.life / f.maxLife;
        const alpha = Math.min(1, f.life * 2.6);
        const x = this.ox + f.x * this.cell;
        const y = this.oy + f.y * this.cell - U.easeOutCubic(t) * this.cell * 0.72;
        ctx.fillStyle = hexA(f.color, alpha);
        ctx.font = (f.big ? 9 : 7) + 'px "Cascadia Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(f.text, x, y);
      }
    }

    _drawPlacement(ctx, game, time) {
      const hover = game.hoverCell;
      if (!game.selectedBuild || !hover) return;
      if (hover.x < 0 || hover.x >= COLS || hover.y < 0 || hover.y >= ROWS) return;
      const color = game.selectedBuild === 'wall' ? C.WALL.color : C.TOWERS[game.selectedBuild].color;
      const cell = this.cell;
      const cx = this.ox + (hover.x + 0.5) * cell;
      const cy = this.oy + (hover.y + 0.5) * cell;
      const occupied = game.structures.some(function (s) {
        return s.x === hover.x && s.y === hover.y;
      });
      let valid = game.grid.isStaticBuildable(hover.x, hover.y) && !occupied;
      if (valid) {
        const check = game.grid.validateBuild(hover, game.structures, game.enemies);
        valid = check.ok;
      }
      ctx.save();
      ctx.globalAlpha = 0.42;
      if (!valid) {
        ctx.strokeStyle = 'rgba(255,93,122,0.9)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(cx - cell * 0.25, cy - cell * 0.25);
        ctx.lineTo(cx + cell * 0.25, cy + cell * 0.25);
        ctx.moveTo(cx + cell * 0.25, cy - cell * 0.25);
        ctx.lineTo(cx - cell * 0.25, cy + cell * 0.25);
        ctx.stroke();
      } else {
        if (game.selectedBuild === 'wall') {
          this._drawWall(ctx, { x: hover.x, y: hover.y }, time, false);
        } else {
          const ghost = {
            kind: 'tower',
            type: game.selectedBuild,
            x: hover.x,
            y: hover.y,
            level: 1,
            angle: -Math.PI / 2,
            recoil: 0,
          };
          this._drawTower(ctx, ghost, game, time);
        }
      }
      ctx.restore();
      if (game.selectedBuild !== 'wall') {
        const def = C.TOWERS[game.selectedBuild];
        const stats = def.levels[0];
        this._drawRangeCircle(ctx, cx, cy, stats.range * cell, def.color, time, 0.8);
      }
    }

    _drawSelectionBrackets(ctx, game, time) {
      if (!game.selectedStructure) return;
      const s = game.selectedStructure;
      const pulse = 0.7 + (Math.sin(time * 3.4) * 0.5 + 0.5) * 0.24;
      ctx.save();
      ctx.shadowColor = hexA(SEM.select, 0.55);
      ctx.shadowBlur = this.cell * 0.18;
      if (s.kind === 'wall') {
        const cx = this.ox + (s.x + 0.5) * this.cell;
        const cy = this.oy + (s.y + 0.5) * this.cell;
        ctx.strokeStyle = hexA(SEM.select, pulse + 0.12);
        ctx.lineWidth = 1.3;
        const b = this.cell * 0.41;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const sx = i % 2 === 0 ? -1 : 1;
          const sy = i < 2 ? -1 : 1;
          const px = cx + sx * b;
          const py = cy + sy * b;
          ctx.moveTo(px - sx * 6, py);
          ctx.lineTo(px, py);
          ctx.lineTo(px, py - sy * 6);
        }
        ctx.stroke();
      } else {
        const cx = this.ox + (s.x + 0.5) * this.cell;
        const cy = this.oy + (s.y + 0.5) * this.cell;
        ctx.strokeStyle = hexA(SEM.select, pulse);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(cx, cy, this.cell * 0.45, time * 0.7, time * 0.7 + 1.4);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, this.cell * 0.45, time * 0.7 + Math.PI, time * 0.7 + Math.PI + 1.4);
        ctx.stroke();
        ctx.strokeStyle = hexA(SEM.select, pulse * 0.36);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(cx, cy, this.cell * 0.5, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    _drawPlacementError(ctx, game) {
      if (!game.placementError) return;
      const e = game.placementError;
      const cell = this.cell;
      const cx = this.ox + (e.x + 0.5) * cell;
      const cy = this.oy + (e.y + 0.5) * cell;
      const t = U.clamp(e.timer / 0.55, 0, 1);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((1 - t) * 0.3);
      ctx.strokeStyle = 'rgba(255,93,122,' + t * 0.9 + ')';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(-cell * 0.3, -cell * 0.3, cell * 0.6, cell * 0.6);
      ctx.beginPath();
      ctx.moveTo(-cell * 0.16, -cell * 0.16);
      ctx.lineTo(cell * 0.16, cell * 0.16);
      ctx.moveTo(cell * 0.16, -cell * 0.16);
      ctx.lineTo(-cell * 0.16, cell * 0.16);
      ctx.stroke();
      ctx.restore();
    }

    _drawBaseFlash(ctx, game) {
      if (!game.baseFlash) return;
      const t = game.baseFlash;
      const cx = this.ox + (game.grid.base.x + 0.5) * this.cell;
      const cy = this.oy + (game.grid.base.y + 0.5) * this.cell;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, this.cell * 3.2);
      g.addColorStop(0, 'rgba(255,57,91,' + t * 0.28 + ')');
      g.addColorStop(0.5, 'rgba(255,57,91,' + t * 0.08 + ')');
      g.addColorStop(1, 'rgba(255,57,91,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.strokeStyle = 'rgba(255,93,122,' + t * 0.35 + ')';
      ctx.lineWidth = 1;
      ctx.strokeRect(1, 1, this.w - 2, this.h - 2);
    }
  }

  function cellDash(cell) {
    return Math.max(2, cell * 0.1);
  }

  /* ============================================================
     ICON + ILLUSTRATION RENDERERS
     ============================================================ */

  function towerIcon(canvas, type) {
    if (!canvas) return;
    const def = type === 'wall' ? C.WALL : C.TOWERS[type];
    if (!def) return;
    const size = 64;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2.25);
    canvas.width = 64 * dpr;
    canvas.height = 64 * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const color = def.color;
    const accent = def.accent || '#ffffff';
    ctx.save();
    ctx.translate(size / 2, size / 2);

    // Base platform for all but wall.
    if (type !== 'wall') {
      ctx.fillStyle = 'rgba(3,10,17,0.72)';
      ctx.strokeStyle = hexA(color, 0.24);
      ctx.lineWidth = 0.8;
      U.polygon(ctx, 0, 2, 20, 6, Math.PI / 6);
      ctx.fill();
      ctx.stroke();
    }
    switch (type) {
      case 'prism': {
        ctx.save();
        ctx.rotate(-Math.PI / 2);
        ctx.strokeStyle = hexA(accent, 0.9);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(20, 0);
        ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(26, 0);
        ctx.lineTo(18, -4.5);
        ctx.lineTo(20, 0);
        ctx.lineTo(18, 4.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = hexA(color, 0.9);
        ctx.lineWidth = 1.2;
        U.polygon(ctx, 0, 0, 11, 4, Math.PI / 4);
        ctx.stroke();
        ctx.fillStyle = hexA(color, 0.12);
        ctx.fill();
        break;
      }
      case 'gatling': {
        ctx.save();
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = 'rgba(4,13,22,0.9)';
        ctx.strokeStyle = hexA(color, 0.9);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-9, -10);
        ctx.lineTo(9, -7);
        ctx.lineTo(12, 0);
        ctx.lineTo(9, 7);
        ctx.lineTo(-9, 10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = hexA(accent, 0.85);
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(7, i * 4.6);
          ctx.lineTo(23, i * 4.6);
          ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case 'cannon': {
        ctx.save();
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = 'rgba(5,14,20,0.95)';
        ctx.strokeStyle = hexA(color, 0.9);
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(-6, -8);
        ctx.lineTo(17, -6);
        ctx.lineTo(23, 0);
        ctx.lineTo(17, 6);
        ctx.lineTo(-6, 8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = hexA(accent, 0.7);
        ctx.beginPath();
        ctx.moveTo(17, -7);
        ctx.lineTo(17, 7);
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = hexA(color, 0.7);
        ctx.beginPath();
        ctx.arc(0, 2, 12, 0, TAU);
        ctx.stroke();
        break;
      }
      case 'laser': {
        ctx.save();
        ctx.rotate(-Math.PI / 2);
        ctx.strokeStyle = hexA(color, 0.9);
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(-9, -10);
        ctx.lineTo(5, -6);
        ctx.lineTo(11, -3);
        ctx.moveTo(-9, 10);
        ctx.lineTo(5, 6);
        ctx.lineTo(11, 3);
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = hexA(accent, 0.9);
        U.polygon(ctx, 0, 0, 7, 4, Math.PI / 4);
        ctx.stroke();
        ctx.fillStyle = hexA(accent, 0.65);
        ctx.beginPath();
        ctx.arc(0, 0, 1.7, 0, TAU);
        ctx.fill();
        break;
      }
      case 'shock': {
        ctx.save();
        ctx.rotate(0.15);
        ctx.strokeStyle = hexA(color, 0.9);
        ctx.lineWidth = 1.1;
        U.polygon(ctx, 0, 0, 17, 3, Math.PI / 2);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.rotate(-0.3);
        ctx.strokeStyle = hexA(accent, 0.9);
        U.polygon(ctx, 0, 0, 11, 6, 0);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = hexA(color, 0.2);
        ctx.beginPath();
        ctx.arc(0, 0, 5.5, 0, TAU);
        ctx.fill();
        break;
      }
      case 'frost': {
        ctx.save();
        ctx.rotate(0.22);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          ctx.strokeStyle = hexA(i % 2 ? accent : color, 0.9);
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5);
          ctx.lineTo(Math.cos(a) * 19, Math.sin(a) * 19);
          ctx.stroke();
          ctx.save();
          ctx.translate(Math.cos(a) * 18, Math.sin(a) * 18);
          ctx.rotate(Math.PI / 4);
          ctx.strokeStyle = hexA(color, 0.8);
          ctx.strokeRect(-3, -3, 6, 6);
          ctx.restore();
        }
        ctx.restore();
        break;
      }
      case 'tesla': {
        ctx.strokeStyle = hexA(color, 0.9);
        ctx.lineWidth = 1.2;
        U.polygon(ctx, 0, 0, 18, 3, Math.PI / 2);
        ctx.stroke();
        ctx.strokeStyle = hexA(accent, 0.9);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-9, 8);
        ctx.lineTo(0, -10);
        ctx.lineTo(9, 8);
        ctx.lineTo(-9, 8);
        ctx.stroke();
        ctx.fillStyle = hexA(color, 0.28);
        ctx.beginPath();
        ctx.arc(0, 3, 4.2, 0, TAU);
        ctx.fill();
        break;
      }
      case 'beacon': {
        // Lighthouse: tapered tower, lantern room, light rays and reveal arc.
        ctx.strokeStyle = hexA(color, 0.9);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-7, 17);
        ctx.lineTo(-4, -3);
        ctx.lineTo(4, -3);
        ctx.lineTo(7, 17);
        ctx.closePath();
        ctx.stroke();
        ctx.strokeStyle = hexA(accent, 0.85);
        ctx.beginPath();
        ctx.moveTo(-6, 2);
        ctx.lineTo(6, 2);
        ctx.moveTo(-7, 17);
        ctx.lineTo(7, 17);
        ctx.stroke();
        ctx.fillStyle = hexA(color, 0.22);
        ctx.beginPath();
        ctx.arc(0, -7, 6.5, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = hexA(accent, 0.95);
        ctx.beginPath();
        ctx.arc(0, -7, 6.5, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = hexA(accent, 0.9);
        ctx.beginPath();
        ctx.arc(0, -7, 2.6, 0, TAU);
        ctx.fill();
        for (let i = 0; i < 4; i++) {
          const a = -0.9 + i * 0.6;
          ctx.strokeStyle = hexA(accent, 0.6);
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 8, -7 + Math.sin(a) * 8);
          ctx.lineTo(Math.cos(a) * 13, -7 + Math.sin(a) * 13);
          ctx.stroke();
        }
        ctx.strokeStyle = hexA(color, 0.45);
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.arc(0, -7, 18, 0.2, 2.95);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case 'wall': {
        const r = 18;
        ctx.fillStyle = 'rgba(4,12,21,0.82)';
        ctx.strokeStyle = hexA(color, 0.8);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-r, -r * 0.7);
        ctx.lineTo(-r * 0.7, -r);
        ctx.lineTo(r * 0.7, -r);
        ctx.lineTo(r, -r * 0.7);
        ctx.lineTo(r, r * 0.7);
        ctx.lineTo(r * 0.7, r);
        ctx.lineTo(-r * 0.7, r);
        ctx.lineTo(-r, r * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = hexA(accent, 0.45);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(-11, -11);
        ctx.lineTo(11, 11);
        ctx.moveTo(11, -11);
        ctx.lineTo(-11, 11);
        ctx.stroke();
        U.polygon(ctx, 0, 0, 7, 4, Math.PI / 4);
        ctx.strokeStyle = hexA(color, 0.78);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  function enemyIcon(canvas, type) {
    if (!canvas) return;
    const def = C.ENEMIES[type];
    if (!def) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2.25);
    canvas.width = 64 * dpr;
    canvas.height = 64 * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 64, 64);
    const color = def.color;
    let sides = def.sides || 5;
    ctx.save();
    ctx.translate(32, 32);
    ctx.strokeStyle = hexA(color, 0.2);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(0, 0, 23, 0.4, 2.9);
    ctx.stroke();
    if (def.stealth) {
      ctx.strokeStyle = hexA(color, 0.3);
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, 25, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = 'rgba(4,10,17,0.9)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.35;
    if (def.stealth) ctx.globalAlpha = 0.62;
    U.polygon(ctx, 0, 0, 18, sides, Math.PI / 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = hexA(color, 0.45);
    ctx.lineWidth = 0.8;
    if (def.shield) {
      U.polygon(ctx, 0, 0, 11, 6, 0);
      ctx.stroke();
      ctx.strokeStyle = hexA('#9bfaff', 0.65);
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(6, 0);
      ctx.moveTo(0, -6);
      ctx.lineTo(0, 6);
      ctx.stroke();
    } else if (def.stealth) {
      ctx.setLineDash([2, 2]);
      U.polygon(ctx, 0, 0, 9, 4, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(-10, 8);
      ctx.lineTo(9, -9);
      ctx.stroke();
    } else if (def.tenacity > 0) {
      ctx.strokeStyle = hexA('#ff9a62', 0.7);
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-7, -7, 14, 14);
    } else {
      U.polygon(ctx, 0, 0, 9, sides, Math.PI / 4);
      ctx.stroke();
    }
    if (def.resist && (def.resist.energy || def.resist.cryo || def.resist.kinetic)) {
      ctx.strokeStyle = hexA('#aeffee', 0.62);
      ctx.beginPath();
      ctx.arc(0, 0, 22, -0.9, 0.2);
      ctx.stroke();
    }
    ctx.fillStyle = hexA(color, 0.7);
    ctx.font = '4.5px "Cascadia Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText((def.tag || '').split(' · ')[0], 0, 30);
    ctx.restore();
  }

  function skillIcon(canvas, skill, rank) {
    if (!canvas || !skill) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2.25);
    canvas.width = 64 * dpr;
    canvas.height = 64 * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 64, 64);
    const color = skill.color;
    ctx.save();
    ctx.translate(32, 32);
    ctx.strokeStyle = hexA(color, 0.92);
    ctx.fillStyle = hexA(color, 0.09);
    ctx.lineWidth = 1.25;
    switch (skill.icon) {
      case 'shield':
        U.polygon(ctx, 0, 0, 19, 6, Math.PI / 6);
        ctx.fill();
        ctx.stroke();
        U.polygon(ctx, 0, 0, 11, 6, Math.PI / 6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-6, 0);
        ctx.lineTo(0, 6);
        ctx.lineTo(8, -7);
        ctx.stroke();
        break;
      case 'crystal':
        ctx.beginPath();
        ctx.moveTo(0, -20);
        ctx.lineTo(14, -4);
        ctx.lineTo(0, 20);
        ctx.lineTo(-14, -4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-14, -4);
        ctx.lineTo(14, -4);
        ctx.moveTo(0, -20);
        ctx.lineTo(0, 20);
        ctx.stroke();
        break;
      case 'bolt':
        ctx.beginPath();
        ctx.moveTo(5, -21);
        ctx.lineTo(-11, 3);
        ctx.lineTo(-1, 3);
        ctx.lineTo(-8, 21);
        ctx.lineTo(13, -6);
        ctx.lineTo(2, -6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = hexA(color, 0.35);
        ctx.beginPath();
        ctx.arc(0, 0, 23, 0.5, 2.4);
        ctx.stroke();
        break;
      case 'frame':
        ctx.strokeRect(-15, -15, 30, 30);
        ctx.strokeStyle = hexA(color, 0.45);
        ctx.strokeRect(-8, -8, 16, 16);
        ctx.beginPath();
        ctx.moveTo(-23, 0);
        ctx.lineTo(-17, 0);
        ctx.moveTo(17, 0);
        ctx.lineTo(23, 0);
        ctx.moveTo(0, -23);
        ctx.lineTo(0, -17);
        ctx.moveTo(0, 17);
        ctx.lineTo(0, 23);
        ctx.stroke();
        break;
      case 'snow':
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 3, Math.sin(a) * 3);
          ctx.lineTo(Math.cos(a) * 20, Math.sin(a) * 20);
          ctx.stroke();
          ctx.save();
          ctx.translate(Math.cos(a) * 13, Math.sin(a) * 13);
          ctx.rotate(a);
          ctx.beginPath();
          ctx.moveTo(0, -4);
          ctx.lineTo(5, 0);
          ctx.lineTo(0, 4);
          ctx.stroke();
          ctx.restore();
        }
        break;
      case 'repair':
        ctx.strokeStyle = hexA(color, 0.9);
        ctx.beginPath();
        ctx.arc(0, 0, 18, 0.35, 4.2);
        ctx.stroke();
        ctx.strokeStyle = hexA(color, 0.35);
        ctx.beginPath();
        ctx.arc(0, 0, 23, 2.4, 5.4);
        ctx.stroke();
        ctx.fillStyle = hexA(color, 0.2);
        ctx.fillRect(-4, -14, 8, 28);
        ctx.fillRect(-14, -4, 28, 8);
        ctx.strokeStyle = hexA(color, 0.9);
        ctx.strokeRect(-4, -14, 8, 28);
        ctx.strokeRect(-14, -4, 28, 8);
        break;
      case 'diamond':
        for (let i = 0; i < 3; i++) {
          const x = (i - 1) * 11;
          const y = i === 1 ? -4 : 5;
          ctx.beginPath();
          ctx.moveTo(x, y - 10);
          ctx.lineTo(x + 8, y);
          ctx.lineTo(x, y + 10);
          ctx.lineTo(x - 8, y);
          ctx.closePath();
          ctx.stroke();
        }
        break;
    }
    if (rank > 0) {
      ctx.fillStyle = hexA(color, 0.8);
      for (let i = 0; i < rank; i++) {
        ctx.save();
        ctx.translate(-8 + i * 4, 23);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-0.8, -0.8, 1.6, 1.6);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawHomeCore(canvas, time) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const scale = Math.min(w, h) / 220;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    const cyan = '#5ef2ff';
    const violet = '#a88bff';
    ctx.strokeStyle = 'rgba(94,242,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 95, 0.4, 2.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 76, 3.2, 5.1);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = time * (0.08 + i * 0.02) + i * 1.57;
      ctx.fillStyle = i % 2 ? violet : cyan;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 82, Math.sin(a) * 82, 1.2, 0, TAU);
      ctx.fill();
    }
    ctx.save();
    ctx.rotate(time * 0.16);
    ctx.strokeStyle = 'rgba(94,242,255,0.22)';
    ctx.lineWidth = 1;
    U.polygon(ctx, 0, 0, 64, 3, -Math.PI / 2);
    ctx.stroke();
    U.polygon(ctx, 0, 0, 46, 3, Math.PI / 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(168,139,255,0.2)';
    U.polygon(ctx, 0, 0, 58, 6, 0.5);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.rotate(-time * 0.22);
    ctx.strokeStyle = 'rgba(94,242,255,0.65)';
    ctx.lineWidth = 1.2;
    U.polygon(ctx, 0, 0, 27, 4, 0);
    ctx.stroke();
    ctx.fillStyle = 'rgba(94,242,255,0.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,95,210,0.5)';
    U.polygon(ctx, 0, 0, 17, 4, Math.PI / 4);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(224,255,255,0.86)';
    ctx.beginPath();
    ctx.arc(0, 0, 1.8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(94,242,255,0.08)';
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawSkillMatrixHero(canvas, time) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const scale = Math.min(w, h) / 160;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    ctx.strokeStyle = 'rgba(94,242,255,0.22)';
    ctx.lineWidth = 1;
    ctx.save();
    ctx.rotate(time * 0.1);
    U.polygon(ctx, 0, 0, 58, 6, Math.PI / 6);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(168,139,255,0.2)';
    U.polygon(ctx, 0, 0, 45, 6, 0);
    ctx.stroke();
    ctx.restore();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + time * 0.16;
      ctx.fillStyle = i % 2 ? 'rgba(168,139,255,0.7)' : 'rgba(94,242,255,0.7)';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 58, Math.sin(a) * 58, 1.4, 0, TAU);
      ctx.fill();
    }
    ctx.rotate(-time * 0.18);
    ctx.strokeStyle = 'rgba(94,242,255,0.45)';
    U.polygon(ctx, 0, 0, 22, 3, -Math.PI / 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    U.polygon(ctx, 0, 0, 11, 4, Math.PI / 4);
    ctx.stroke();
    ctx.restore();
  }

  function drawResultSigil(canvas, success, accent) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2.25);
    canvas.width = 200 * dpr;
    canvas.height = 150 * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 200, 150);
    const color = success ? accent : '#ff5d7a';
    const cx = 100;
    const cy = 78;
    ctx.save();
    ctx.translate(cx, cy);
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 70);
    halo.addColorStop(0, hexA(color, 0.16));
    halo.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, 70, 0, TAU);
    ctx.fill();
    if (success) {
      ctx.strokeStyle = hexA(color, 0.4);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 43, 0.35, 5.4);
      ctx.stroke();
      ctx.strokeStyle = hexA(color, 0.24);
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, 53, -2.2, 2.7);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = hexA(color, 0.85);
      ctx.lineWidth = 1.25;
      U.polygon(ctx, 0, 0, 29, 6, Math.PI / 6);
      ctx.stroke();
      U.polygon(ctx, 0, 0, 18, 4, Math.PI / 4);
      ctx.stroke();
      ctx.fillStyle = hexA(color, 0.13);
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, TAU);
      ctx.fill();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        ctx.strokeStyle = hexA(color, 0.35);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 36, Math.sin(a) * 36);
        ctx.lineTo(Math.cos(a) * 48, Math.sin(a) * 48);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(240,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, TAU);
      ctx.fill();
    } else {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + 0.5;
        const r = 30 + (i % 2) * 14;
        ctx.strokeStyle = hexA(color, 0.35 + i * 0.06);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 10, Math.sin(a) * 10);
        ctx.lineTo(Math.cos(a + 0.12) * r, Math.sin(a + 0.12) * r);
        ctx.stroke();
      }
      ctx.strokeStyle = hexA(color, 0.65);
      ctx.lineWidth = 1.2;
      U.polygon(ctx, 0, 0, 24, 6, Math.PI / 6);
      ctx.stroke();
      ctx.strokeStyle = hexA(color, 0.26);
      U.polygon(ctx, 0, 0, 37, 3, Math.PI / 2);
      ctx.stroke();
      ctx.fillStyle = hexA(color, 0.1);
      ctx.beginPath();
      ctx.arc(0, 0, 23, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  window.GEOTD_GFX = {
    GameRenderer: GameRenderer,
    towerIcon: towerIcon,
    enemyIcon: enemyIcon,
    skillIcon: skillIcon,
    drawHomeCore: drawHomeCore,
    drawSkillMatrixHero: drawSkillMatrixHero,
    drawResultSigil: drawResultSigil,
  };
})();
