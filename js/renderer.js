/* Group and Evolve — canvas ecosystem renderer + camera interactions. */
(function (root) {
  'use strict';
  const Evo = (root.Evo = root.Evo || {});
  const U = Evo.Utils;
  const { clamp, TAU } = U;
  const WORLD = Evo.World;
  const PHYSICS = Evo.Physics;
  const BASE_TPS = Evo.Constants.BASE_TPS;

  const healthColor = (ratio) => {
    if (ratio > 0.6) return '112, 233, 193';
    if (ratio > 0.3) return '255, 202, 109';
    return '255, 124, 112';
  };

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  class Renderer {
    constructor(canvas, simulation, callbacks = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true });
      this.sim = simulation;
      this.callbacks = callbacks;
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      this.fitScale = 1;
      this.selectedId = null;
      this.hoveredId = null;
      this.following = false;
      this.drag = null;
      this.fluidTime = 0;
      this.effects = [];
      this.beams = [];
      this.rings = [];
      this.motes = [];
      this._lastMetrics = { scale: 1, centerX: WORLD.width / 2, centerY: WORLD.height / 2 };
      this._screenDust = [];
      this._lastFrame = performance.now();

      this._initMotes();
      this._initDust();
      this._bindEvents();
      this._resizeObserver = new ResizeObserver(() => this.resize());
      this._resizeObserver.observe(canvas.parentElement || canvas);
      this.resize();
    }

    setSimulation(simulation) {
      this.sim = simulation;
      this.effects = [];
      this.beams = [];
      this.rings = [];
      this.selectedId = null;
      this.hoveredId = null;
      this.following = false;
      this.panX = 0;
      this.panY = 0;
      this.zoom = 1;
    }

    setSelection(id) {
      this.selectedId = id;
      if (id === null) this.following = false;
    }

    setFollow(enabled) {
      this.following = Boolean(enabled && this.selectedId !== null);
      return this.following;
    }

    isFollowing() {
      return this.following;
    }

    getZoom() {
      return this.zoom;
    }

    _initMotes() {
      for (let i = 0; i < 88; i += 1) {
        this.motes.push({
          x: Math.random() * WORLD.width,
          y: Math.random() * WORLD.height,
          size: 0.55 + Math.random() * 1.15,
          alpha: 0.12 + Math.random() * 0.28,
          phase: Math.random() * TAU,
          drift: 0.5 + Math.random() * 1.4,
        });
      }
    }

    _initDust() {
      for (let i = 0; i < 52; i += 1) {
        this._screenDust.push({
          x: Math.random(),
          y: Math.random(),
          size: Math.random() < 0.8 ? 0.7 : 1.2,
          alpha: 0.025 + Math.random() * 0.08,
          phase: Math.random() * TAU,
        });
      }
    }

    resize() {
      const parent = this.canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.width = width;
      this.height = height;
      this.canvas.width = Math.round(width * this.dpr);
      this.canvas.height = Math.round(height * this.dpr);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }

    _eventPoint(event) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    _bindEvents() {
      const canvas = this.canvas;

      canvas.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const p = this._eventPoint(event);
        this.drag = {
          pointerId: event.pointerId,
          startX: p.x,
          startY: p.y,
          startPanX: this.panX,
          startPanY: this.panY,
          moved: false,
        };
        canvas.setPointerCapture?.(event.pointerId);
      });

      canvas.addEventListener('pointermove', (event) => {
        const p = this._eventPoint(event);
        if (this.drag && this.drag.pointerId === event.pointerId) {
          const dx = p.x - this.drag.startX;
          const dy = p.y - this.drag.startY;
          if (!this.drag.moved && Math.hypot(dx, dy) > 4) {
            this.drag.moved = true;
            canvas.classList.add('is-dragging');
            canvas.classList.remove('is-hovering');
            if (this.following) {
              this.following = false;
              this.callbacks.onFollowStop?.();
            }
          }
          if (this.drag.moved) {
            const scale = this._lastMetrics.scale || 1;
            this.panX = this.drag.startPanX - dx / scale;
            this.panY = this.drag.startPanY - dy / scale;
            this._hideHover();
          }
          return;
        }

        const creature = this._hitTest(p.x, p.y);
        if (creature) {
          canvas.classList.add('is-hovering');
          if (this.hoveredId !== creature.id) this.hoveredId = creature.id;
          this.callbacks.onHover?.(creature, p);
        } else {
          canvas.classList.remove('is-hovering');
          if (this.hoveredId !== null) {
            this.hoveredId = null;
            this.callbacks.onHover?.(null, p);
          }
        }
      });

      const finishPointer = (event) => {
        if (!this.drag || this.drag.pointerId !== event.pointerId) return;
        const p = this._eventPoint(event);
        const wasMoved = this.drag.moved;
        this.drag = null;
        this.canvas.classList.remove('is-dragging');
        if (this.canvas.hasPointerCapture?.(event.pointerId)) {
          this.canvas.releasePointerCapture(event.pointerId);
        }
        if (!wasMoved) {
          const creature = this._hitTest(p.x, p.y);
          this.selectedId = creature ? creature.id : null;
          this.callbacks.onSelect?.(creature ? creature.id : null);
        }
      };
      canvas.addEventListener('pointerup', finishPointer);
      canvas.addEventListener('pointercancel', (event) => {
        if (this.drag && this.drag.pointerId === event.pointerId) {
          this.drag = null;
          canvas.classList.remove('is-dragging');
        }
      });
      canvas.addEventListener('pointerleave', () => {
        if (!this.drag) this._hideHover();
      });

      canvas.addEventListener(
        'wheel',
        (event) => {
          event.preventDefault();
          const p = this._eventPoint(event);
          this._zoomAt(p.x, p.y, Math.exp(-event.deltaY * 0.0012));
        },
        { passive: false },
      );
    }

    _hideHover() {
      this.canvas.classList.remove('is-hovering');
      if (this.hoveredId !== null) {
        this.hoveredId = null;
        this.callbacks.onHover?.(null, null);
      }
    }

    _worldToScreen(x, y) {
      const m = this._lastMetrics;
      return {
        x: (x - m.centerX) * m.scale + this.width / 2,
        y: (y - m.centerY) * m.scale + this.height / 2,
      };
    }

    _screenToWorld(x, y) {
      const m = this._lastMetrics;
      return {
        x: (x - this.width / 2) / m.scale + m.centerX,
        y: (y - this.height / 2) / m.scale + m.centerY,
      };
    }

    _hitTest(screenX, screenY) {
      let nearest = null;
      let nearestDistance = Infinity;
      for (const creature of this.sim.creatures) {
        if (!creature.alive) continue;
        const p = this._worldToScreen(creature.x, creature.y);
        const hitRadius = Math.max(9, creature.radius * this._lastMetrics.scale + 8);
        const dx = screenX - p.x;
        const dy = screenY - p.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < hitRadius * hitRadius && distSq < nearestDistance) {
          nearest = creature;
          nearestDistance = distSq;
        }
      }
      return nearest;
    }

    _zoomAt(screenX, screenY, factor) {
      const before = this._lastMetrics;
      const worldPoint = this._screenToWorld(screenX, screenY);
      const nextZoom = clamp(this.zoom * factor, 0.72, 3.2);
      if (Math.abs(nextZoom - this.zoom) < 0.001) return;
      if (this.following) {
        this.following = false;
        this.callbacks.onFollowStop?.();
      }
      this.zoom = nextZoom;
      const fit = this._computeFit();
      const nextScale = fit * this.zoom;
      const desiredCenterX = worldPoint.x - (screenX - this.width / 2) / nextScale;
      const desiredCenterY = worldPoint.y - (screenY - this.height / 2) / nextScale;
      this.panX = desiredCenterX - WORLD.width / 2;
      this.panY = desiredCenterY - WORLD.height / 2;
      this._clampCamera(nextScale);
      this._lastMetrics = {
        scale: nextScale,
        centerX: WORLD.width / 2 + this.panX,
        centerY: WORLD.height / 2 + this.panY,
      };
    }

    zoomBy(factor) {
      this._zoomAt(this.width / 2, this.height / 2, factor);
    }

    resetCamera() {
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      this.following = false;
    }

    focusCreature(id, zoom = 1.35) {
      const creature = this.sim.getCreature(id);
      if (!creature) return false;
      this.zoom = Math.max(this.zoom, zoom);
      this.panX = creature.x - WORLD.width / 2;
      this.panY = creature.y - WORLD.height / 2;
      this._lastMetrics = this._computeViewMetrics(0);
      return true;
    }

    _computeFit() {
      const padX = Math.min(44, this.width * 0.045);
      const padY = Math.min(38, this.height * 0.06);
      return Math.min((this.width - padX * 2) / WORLD.width, (this.height - padY * 2) / WORLD.height);
    }

    _clampCamera(scale) {
      const halfW = this.width / (2 * scale);
      const halfH = this.height / (2 * scale);
      let centerX = WORLD.width / 2 + this.panX;
      let centerY = WORLD.height / 2 + this.panY;
      if (halfW * 2 >= WORLD.width) {
        centerX = WORLD.width / 2;
      } else {
        centerX = clamp(centerX, halfW, WORLD.width - halfW);
      }
      if (halfH * 2 >= WORLD.height) {
        centerY = WORLD.height / 2;
      } else {
        centerY = clamp(centerY, halfH, WORLD.height - halfH);
      }
      this.panX = centerX - WORLD.width / 2;
      this.panY = centerY - WORLD.height / 2;
    }

    _computeViewMetrics(dt) {
      if (this.following && this.selectedId !== null) {
        const selected = this.sim.getCreature(this.selectedId);
        if (selected) {
          const targetX = selected.x - WORLD.width / 2;
          const targetY = selected.y - WORLD.height / 2;
          const smoothing = 1 - Math.exp(-7 * Math.max(0.001, dt));
          this.panX = U.lerp(this.panX, targetX, smoothing);
          this.panY = U.lerp(this.panY, targetY, smoothing);
        } else {
          this.following = false;
          this.callbacks.onFollowStop?.();
        }
      }
      this.fitScale = this._computeFit();
      const scale = Math.max(0.0001, this.fitScale * this.zoom);
      this._clampCamera(scale);
      const centerX = WORLD.width / 2 + this.panX;
      const centerY = WORLD.height / 2 + this.panY;
      this._lastMetrics = { scale, centerX, centerY };
      return this._lastMetrics;
    }

    /* ------------------------------------------------------------- effects */

    consumeEvents(events) {
      if (!events || !events.length) return;
      for (const event of events) {
        if (event.type === 'attack') {
          if (this.beams.length < 64) {
            this.beams.push({
              x1: event.x1,
              y1: event.y1,
              x2: event.x2,
              y2: event.y2,
              hue: event.hue,
              killed: event.killed,
              age: 0,
              life: event.killed ? 0.34 : 0.2,
            });
          }
          this._burst(event.x2, event.y2, event.hue, event.killed ? 8 : 3, event.killed ? 64 : 34, 'impact');
          if (event.killed) this._ring(event.x2, event.y2, event.hue, 7, 0.75, 'death');
        } else if (event.type === 'birthBurst') {
          this._ring(event.x, event.y, event.hue, 4, 0.85, 'birth');
          this._burst(event.x, event.y, event.hue, 5, 28, 'birth');
        } else if (event.type === 'firstConflict') {
          this._ring(event.x1, event.y1, 0, 4, 1.4, 'death');
          this._ring(event.x2, event.y2, 0, 4, 1.4, 'death');
        } else if (event.type === 'death') {
          this._ring(event.x, event.y, event.hue, 5, 0.9, 'death');
          this._burst(event.x, event.y, event.hue, 9, 50, 'death');
        }
      }
    }

    _burst(x, y, hue, count, speed, kind) {
      if (this.effects.length > 280) return;
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * TAU;
        const velocity = speed * (0.35 + Math.random() * 0.75);
        this.effects.push({
          x,
          y,
          vx: Math.cos(angle) * velocity,
          vy: Math.sin(angle) * velocity,
          size: kind === 'death' ? 0.8 + Math.random() * 1.4 : 0.7 + Math.random() * 1.7,
          hue: hue + (Math.random() - 0.5) * 28,
          life: kind === 'death' ? 0.7 + Math.random() * 0.7 : 0.45 + Math.random() * 0.55,
          age: 0,
          drag: 0.9 + Math.random() * 0.06,
          kind,
        });
      }
    }

    _ring(x, y, hue, radius, life, kind) {
      if (this.rings.length > 70) return;
      this.rings.push({ x, y, hue, radius, life, age: 0, kind });
    }

    _updateEffects(dt) {
      for (let i = this.effects.length - 1; i >= 0; i -= 1) {
        const p = this.effects[i];
        p.age += dt;
        if (p.age >= p.life) {
          this.effects.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= p.drag;
        p.vy *= p.drag;
        p.vy += 8 * dt;
      }
      for (let i = this.beams.length - 1; i >= 0; i -= 1) {
        this.beams[i].age += dt;
        if (this.beams[i].age >= this.beams[i].life) this.beams.splice(i, 1);
      }
      for (let i = this.rings.length - 1; i >= 0; i -= 1) {
        const ring = this.rings[i];
        ring.age += dt;
        if (ring.age >= ring.life) this.rings.splice(i, 1);
      }
    }

    _drawEffects(dt) {
      const ctx = this.ctx;
      const scale = this._lastMetrics.scale;
      this._updateEffects(dt);

      for (const beam of this.beams) {
        const t = beam.age / beam.life;
        const alpha = Math.sin(Math.min(1, t) * Math.PI) * 0.8;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = `hsla(${beam.hue}, 90%, 70%, ${alpha * 0.18})`;
        ctx.lineWidth = 6 / scale;
        ctx.beginPath();
        ctx.moveTo(beam.x1, beam.y1);
        ctx.lineTo(beam.x2, beam.y2);
        ctx.stroke();
        ctx.strokeStyle = `hsla(${beam.hue}, 100%, 78%, ${alpha})`;
        ctx.lineWidth = 1.15 / scale;
        ctx.stroke();
        ctx.restore();
      }

      for (const ring of this.rings) {
        const t = ring.age / ring.life;
        const radius = ring.radius + t * (ring.kind === 'death' ? 34 : 23);
        const alpha = (1 - t) * (ring.kind === 'death' ? 0.5 : 0.7);
        ctx.strokeStyle = `hsla(${ring.hue}, 94%, 76%, ${alpha})`;
        ctx.lineWidth = (1 - t) * 1.4 / scale + 0.05;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, radius, 0, TAU);
        ctx.stroke();
      }

      for (const p of this.effects) {
        const t = 1 - p.age / p.life;
        const alpha = t * t * 0.72;
        ctx.fillStyle = `hsla(${p.hue}, 92%, ${p.kind === 'death' ? 66 : 77}%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      }
    }

    /* -------------------------------------------------------------- drawing */

    _updateMotes(dt) {
      const multiplier = 150;
      for (const mote of this.motes) {
        const flow = this.sim.sampleCurrent(mote.x, mote.y, this.sim.tick);
        mote.phase += dt * 0.7;
        mote.x += flow.x * multiplier * dt;
        mote.y += flow.y * multiplier * dt;
        if (mote.x < 8) mote.x = WORLD.width - 8;
        else if (mote.x > WORLD.width - 8) mote.x = 8;
        if (mote.y < 8) mote.y = WORLD.height - 8;
        else if (mote.y > WORLD.height - 8) mote.y = 8;
      }
    }

    _drawAtmosphere() {
      const ctx = this.ctx;
      for (const dust of this._screenDust) {
        const alpha = dust.alpha * (0.7 + Math.sin(this.fluidTime * 0.35 + dust.phase) * 0.3);
        ctx.fillStyle = `rgba(210, 235, 200, ${alpha})`;
        ctx.beginPath();
        ctx.arc(dust.x * this.width, dust.y * this.height, dust.size, 0, TAU);
        ctx.fill();
      }
    }

    _drawWorldBase(now) {
      const ctx = this.ctx;
      const scale = this._lastMetrics.scale;
      ctx.save();
      ctx.beginPath();
      roundedRect(ctx, 0, 0, WORLD.width, WORLD.height, 25);
      ctx.clip();

      const atmosphere = ctx.createLinearGradient(0, 0, WORLD.width, WORLD.height);
      atmosphere.addColorStop(0, 'rgba(10, 16, 12, 0.92)');
      atmosphere.addColorStop(0.48, 'rgba(13, 21, 15, 0.84)');
      atmosphere.addColorStop(1, 'rgba(7, 13, 9, 0.94)');
      ctx.fillStyle = atmosphere;
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);

      const bloom = ctx.createRadialGradient(
        WORLD.width * 0.5,
        WORLD.height * 0.44,
        30,
        WORLD.width * 0.5,
        WORLD.height * 0.44,
        WORLD.width * 0.7,
      );
      bloom.addColorStop(0, 'rgba(102, 145, 91, 0.085)');
      bloom.addColorStop(0.55, 'rgba(66, 102, 76, 0.025)');
      bloom.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);

      // Quiet coordinate grid.
      ctx.strokeStyle = 'rgba(205, 235, 205, 0.04)';
      ctx.lineWidth = 1 / scale;
      const step = 100;
      ctx.beginPath();
      for (let x = step; x < WORLD.width; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, WORLD.height);
      }
      for (let y = step; y < WORLD.height; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(WORLD.width, y);
      }
      ctx.stroke();

      ctx.strokeStyle = 'rgba(205, 235, 205, 0.07)';
      ctx.beginPath();
      for (let x = 500; x < WORLD.width; x += 500) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, WORLD.height);
      }
      for (let y = 500; y < WORLD.height; y += 500) {
        ctx.moveTo(0, y);
        ctx.lineTo(WORLD.width, y);
      }
      ctx.stroke();

      // Large topographic rings give the arena depth without visual noise.
      const orbitX = WORLD.width * 0.5;
      const orbitY = WORLD.height * 0.46;
      for (let i = 0; i < 4; i += 1) {
        ctx.strokeStyle = `rgba(163, 204, 154, ${0.026 - i * 0.0035})`;
        ctx.lineWidth = 1 / scale;
        ctx.beginPath();
        ctx.ellipse(
          orbitX,
          orbitY,
          235 + i * 112 + Math.sin(now * 0.00008 + i) * 5,
          195 + i * 92,
          -0.16,
          0,
          TAU,
        );
        ctx.stroke();
      }

      // Current field marks.
      for (let x = 90; x < WORLD.width; x += 172) {
        for (let y = 84; y < WORLD.height; y += 150) {
          const flow = this.sim.sampleCurrent(x, y, this.sim.tick);
          const magnitude = Math.hypot(flow.x, flow.y);
          if (magnitude < 0.0001) continue;
          const angle = Math.atan2(flow.y, flow.x);
          const length = 8 + magnitude * 66;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.strokeStyle = `rgba(121, 194, 163, ${0.04 + magnitude * 0.13})`;
          ctx.lineWidth = 1 / scale;
          ctx.beginPath();
          ctx.moveTo(-length * 0.35, 0);
          ctx.lineTo(length * 0.65, 0);
          ctx.stroke();
          ctx.fillStyle = `rgba(144, 219, 185, ${0.075 + magnitude * 0.16})`;
          ctx.beginPath();
          ctx.arc(length * 0.65, 0, 1.2 / scale + 0.25, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
      }

      // Drifting plankton / nutrient motes.
      ctx.save();
      for (const mote of this.motes) {
        const alpha = mote.alpha * (0.55 + 0.45 * Math.sin(this.fluidTime * 0.8 + mote.phase));
        ctx.fillStyle = `rgba(186, 227, 185, ${alpha * 0.36})`;
        ctx.beginPath();
        ctx.arc(mote.x, mote.y, mote.size, 0, TAU);
        ctx.fill();
      }
      ctx.restore();

      const vignette = ctx.createRadialGradient(
        WORLD.width / 2,
        WORLD.height / 2,
        WORLD.height * 0.25,
        WORLD.width / 2,
        WORLD.height / 2,
        WORLD.width * 0.62,
      );
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(1, 'rgba(1, 5, 2, 0.34)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = 'rgba(206, 235, 198, 0.12)';
      ctx.lineWidth = 1 / scale;
      roundedRect(ctx, 0.5, 0.5, WORLD.width - 1, WORLD.height - 1, 25);
      ctx.stroke();

      // Corner registration marks.
      const mark = 17;
      const inset = 15;
      ctx.strokeStyle = 'rgba(213, 255, 117, 0.34)';
      ctx.lineWidth = 1.15 / scale;
      const corners = [
        [inset, inset, 1, 1],
        [WORLD.width - inset, inset, -1, 1],
        [inset, WORLD.height - inset, 1, -1],
        [WORLD.width - inset, WORLD.height - inset, -1, -1],
      ];
      for (const [x, y, sx, sy] of corners) {
        ctx.beginPath();
        ctx.moveTo(x, y + mark * sy);
        ctx.lineTo(x, y);
        ctx.lineTo(x + mark * sx, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(211, 236, 204, 0.24)';
      const labelSize = 8 / scale;
      ctx.font = `${labelSize}px "SFMono-Regular", "Roboto Mono", monospace`;
      ctx.textBaseline = 'bottom';
      ctx.fillText('CLOSED ECOSYSTEM / 1600 × 1000', 16, WORLD.height - 11);
      ctx.textAlign = 'right';
      ctx.fillText(`T+${this.sim.tick.toString().padStart(6, '0')}`, WORLD.width - 16, WORLD.height - 11);
      ctx.textAlign = 'left';
      ctx.restore();
    }

    _drawVisionCone(creature) {
      if (!this.sim.settings.showVision) return;
      const ctx = this.ctx;
      const scale = this._lastMetrics.scale;
      const angle = Math.atan2(creature.headingY, creature.headingX);
      const half = PHYSICS.visionHalfAngle;
      const range = PHYSICS.visionRange;
      ctx.save();
      const gradient = ctx.createRadialGradient(
        creature.x,
        creature.y,
        6,
        creature.x,
        creature.y,
        range,
      );
      gradient.addColorStop(0, 'rgba(213, 255, 117, 0.105)');
      gradient.addColorStop(0.5, 'rgba(213, 255, 117, 0.05)');
      gradient.addColorStop(1, 'rgba(112, 233, 193, 0.008)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(creature.x, creature.y);
      ctx.arc(creature.x, creature.y, range, angle - half, angle + half);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(213, 255, 117, 0.17)';
      ctx.lineWidth = 0.9 / scale;
      ctx.setLineDash([4 / scale, 7 / scale]);
      ctx.beginPath();
      ctx.moveTo(creature.x, creature.y);
      ctx.lineTo(
        creature.x + Math.cos(angle - half) * range,
        creature.y + Math.sin(angle - half) * range,
      );
      ctx.moveTo(creature.x, creature.y);
      ctx.lineTo(
        creature.x + Math.cos(angle + half) * range,
        creature.y + Math.sin(angle + half) * range,
      );
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(213, 255, 117, 0.09)';
      ctx.beginPath();
      ctx.arc(creature.x, creature.y, range, angle - half, angle + half);
      ctx.stroke();
      ctx.restore();
    }

    _drawAttackRange(creature) {
      const ctx = this.ctx;
      const scale = this._lastMetrics.scale;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 142, 127, 0.12)';
      ctx.lineWidth = 1 / scale;
      ctx.setLineDash([2 / scale, 8 / scale]);
      ctx.beginPath();
      ctx.arc(creature.x, creature.y, PHYSICS.attackRange + creature.radius, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    _drawCreature(creature, now) {
      const ctx = this.ctx;
      const scale = this._lastMetrics.scale;
      const selected = creature.id === this.selectedId;
      const hovered = creature.id === this.hoveredId;
      const energyRatio = clamp(creature.energy / 180, 0, 1);
      const healthRatio = clamp(creature.health / creature.maxHealth, 0, 1);
      const phase = now * 0.0012 + creature.id * 1.37;
      const breathing = 1 + Math.sin(phase * 1.4) * 0.032;
      const radius = creature.radius * breathing;
      const hat = Math.atan2(creature.headingY, creature.headingX);
      const points = 9;
      const speed = creature.speed;

      ctx.save();
      ctx.translate(creature.x, creature.y);

      // Directional motion streak.
      if (speed > 0.18) {
        const streak = Math.min(25, speed * 5.8) + radius * 0.4;
        const gradient = ctx.createLinearGradient(
          -creature.headingX * streak,
          -creature.headingY * streak,
          0,
          0,
        );
        gradient.addColorStop(0, `hsla(${creature.hue}, ${creature.saturation * 100}%, ${creature.lightness * 100}%, 0)`);
        gradient.addColorStop(1, `hsla(${creature.hue}, ${creature.saturation * 100}%, ${creature.lightness * 100}%, ${selected ? 0.25 : 0.1})`);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = Math.max(0.7, radius * 0.35);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-creature.headingX * streak, -creature.headingY * streak);
        ctx.lineTo(-creature.headingX * radius * 0.1, -creature.headingY * radius * 0.1);
        ctx.stroke();
      }

      // Ambient halo.
      const haloAlpha = 0.035 + energyRatio * 0.045 + (selected ? 0.09 : 0) + (hovered ? 0.04 : 0);
      ctx.fillStyle = `hsla(${creature.hue}, ${creature.saturation * 100}%, ${creature.lightness * 100}%, ${haloAlpha})`;
      ctx.beginPath();
      ctx.arc(0, 0, radius * (selected ? 2.85 : 2.35), 0, TAU);
      ctx.fill();

      if (healthRatio < 0.33) {
        ctx.fillStyle = `rgba(255, 111, 97, ${0.025 + (1 - healthRatio) * 0.045})`;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 2.7, 0, TAU);
        ctx.fill();
      }

      // Organic membrane: a smooth closed curve through a wobbling ring.
      const membrane = [];
      for (let i = 0; i < points; i += 1) {
        const angle = (i / points) * TAU;
        const wobble =
          1 +
          Math.sin(phase + i * 1.93) * 0.075 +
          Math.cos(phase * 0.63 + i * 2.71) * 0.045;
        membrane.push({
          x: Math.cos(angle) * radius * wobble,
          y: Math.sin(angle) * radius * wobble,
        });
      }
      const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const firstMid = midpoint(membrane[points - 1], membrane[0]);
      ctx.beginPath();
      ctx.moveTo(firstMid.x, firstMid.y);
      for (let i = 0; i < points; i += 1) {
        const current = membrane[i];
        const next = membrane[(i + 1) % points];
        const mid = midpoint(current, next);
        ctx.quadraticCurveTo(current.x, current.y, mid.x, mid.y);
      }
      ctx.closePath();
      ctx.fillStyle = `hsla(${creature.hue}, ${creature.saturation * 100}%, ${(creature.lightness + (selected ? 0.05 : 0)) * 100}%, 0.94)`;
      ctx.fill();
      ctx.strokeStyle = `hsla(${creature.hue}, ${Math.min(92, creature.saturation * 100 + 14)}%, ${Math.min(84, creature.lightness * 100 + 19)}%, ${selected ? 0.8 : 0.52})`;
      ctx.lineWidth = Math.max(0.6 / scale, 0.55);
      ctx.stroke();

      // Soft interior highlight.
      ctx.beginPath();
      ctx.ellipse(
        -radius * 0.22,
        -radius * 0.25,
        radius * 0.48,
        radius * 0.36,
        -0.7,
        0,
        TAU,
      );
      ctx.fillStyle = 'rgba(255, 255, 255, 0.13)';
      ctx.fill();

      // Energy nucleus.
      const nucleus = 1.1 + energyRatio * radius * 0.28;
      ctx.fillStyle = `hsla(${creature.hue}, ${Math.min(100, creature.saturation * 100 + 20)}%, ${Math.min(88, creature.lightness * 100 + 26)}%, ${0.55 + energyRatio * 0.4})`;
      ctx.beginPath();
      ctx.arc(radius * 0.04, radius * 0.01, nucleus, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(247, 255, 229, ${0.45 + energyRatio * 0.3})`;
      ctx.beginPath();
      ctx.arc(radius * 0.04, radius * 0.01, Math.max(0.35, nucleus * 0.38), 0, TAU);
      ctx.fill();

      // Heading organ.
      ctx.save();
      ctx.rotate(hat);
      ctx.fillStyle = `hsla(${creature.hue}, ${Math.min(90, creature.saturation * 100 + 10)}%, ${Math.min(86, creature.lightness * 100 + 24)}%, ${selected ? 0.92 : 0.45})`;
      ctx.beginPath();
      ctx.moveTo(radius + Math.max(1.4, radius * 0.2), 0);
      ctx.lineTo(radius * 0.66, -radius * 0.27);
      ctx.lineTo(radius * 0.72, 0);
      ctx.lineTo(radius * 0.66, radius * 0.27);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Attack readiness notch.
      if (creature.lastDecision?.attackIntent && creature.attackCooldown === 0) {
        ctx.strokeStyle = 'rgba(255, 142, 127, 0.7)';
        ctx.lineWidth = Math.max(0.7 / scale, 0.55);
        ctx.beginPath();
        ctx.arc(0, 0, radius + 4.5 / scale, hat - 0.35, hat + 0.35);
        ctx.stroke();
      }

      // Health ring.
      const ringRadius = radius + Math.max(3.4, 3.2 / scale);
      ctx.strokeStyle = 'rgba(230, 244, 228, 0.09)';
      ctx.lineWidth = Math.max(0.8 / scale, 0.7);
      ctx.beginPath();
      ctx.arc(0, 0, ringRadius, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${healthColor(healthRatio)}, ${0.58 + (selected ? 0.2 : 0)})`;
      ctx.lineWidth = Math.max(0.9 / scale, 0.8);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, ringRadius, -Math.PI / 2, -Math.PI / 2 + TAU * healthRatio);
      ctx.stroke();

      if (selected || hovered) {
        ctx.strokeStyle = selected ? 'rgba(213, 255, 117, 0.68)' : 'rgba(235, 248, 227, 0.4)';
        ctx.lineWidth = Math.max(0.8 / scale, 0.7);
        ctx.setLineDash(selected ? [3 / scale, 5 / scale] : []);
        ctx.beginPath();
        ctx.arc(0, 0, radius + Math.max(7, 9 / scale), 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (selected) {
        // Reticle brackets.
        const bracket = radius + Math.max(10, 11 / scale);
        const arm = Math.max(5, 6 / scale);
        ctx.strokeStyle = 'rgba(213, 255, 117, 0.9)';
        ctx.lineWidth = 1.1 / scale;
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          ctx.beginPath();
          ctx.moveTo(sx * bracket, sy * bracket - sy * arm);
          ctx.lineTo(sx * bracket, sy * bracket);
          ctx.lineTo(sx * bracket - sx * arm, sy * bracket);
          ctx.stroke();
        }
      }

      ctx.restore();
    }

    _drawGeneticLinks(creature) {
      if (!this.sim.settings.showVision) return;
      const neighbors = creature.perception?.neighbors;
      if (!neighbors || !neighbors.length) return;
      const ctx = this.ctx;
      const scale = this._lastMetrics.scale;
      ctx.save();
      for (const relation of neighbors) {
        const other = this.sim.getCreature(relation.id);
        if (!other) continue;
        const near = relation.near;
        ctx.strokeStyle = near
          ? 'rgba(213, 255, 117, 0.35)'
          : 'rgba(255, 142, 127, 0.4)';
        ctx.lineWidth = (near ? 0.9 : 1.15) / scale;
        ctx.setLineDash(near ? [2.5 / scale, 5 / scale] : []);
        ctx.beginPath();
        ctx.moveTo(creature.x, creature.y);
        ctx.lineTo(other.x, other.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = near
          ? 'rgba(213, 255, 117, 0.52)'
          : 'rgba(255, 142, 127, 0.56)';
        ctx.lineWidth = 0.85 / scale;
        ctx.beginPath();
        ctx.arc(other.x, other.y, other.radius + 5 / scale, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    _drawForceVector(creature) {
      if (!creature.lastDecision) return;
      const ctx = this.ctx;
      const scale = this._lastMetrics.scale;
      const forward = creature.forceForward;
      const lateral = creature.forceLateral;
      const magnitude = Math.hypot(forward, lateral);
      if (magnitude < 0.035) return;
      const hx = creature.headingX;
      const hy = creature.headingY;
      const fx = hx * forward + -hy * lateral;
      const fy = hy * forward + hx * lateral;
      const inv = 1 / Math.max(0.0001, Math.hypot(fx, fy));
      const length = 24 + Math.min(30, magnitude * 34);
      const x2 = creature.x + fx * inv * length;
      const y2 = creature.y + fy * inv * length;
      const nx = fx * inv;
      const ny = fy * inv;
      ctx.save();
      ctx.strokeStyle = 'rgba(213, 255, 117, 0.52)';
      ctx.fillStyle = 'rgba(213, 255, 117, 0.68)';
      ctx.lineWidth = 1.1 / scale;
      ctx.setLineDash([2.2 / scale, 3.5 / scale]);
      ctx.beginPath();
      ctx.moveTo(creature.x, creature.y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      const head = 5.2 / scale;
      ctx.beginPath();
      ctx.moveTo(x2 + nx * head, y2 + ny * head);
      ctx.lineTo(x2 - nx * head * 0.5 - ny * head * 0.55, y2 - ny * head * 0.5 + nx * head * 0.55);
      ctx.lineTo(x2 - nx * head * 0.5 + ny * head * 0.55, y2 - ny * head * 0.5 - nx * head * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    _drawSelectedScreenLabel(creature) {
      const ctx = this.ctx;
      const p = this._worldToScreen(creature.x, creature.y);
      const radius = creature.radius * this._lastMetrics.scale;
      const label = `#${String(creature.id).padStart(4, '0')}  ·  GEN ${String(creature.generation).padStart(2, '0')}`;
      ctx.save();
      ctx.font = '8.5px "SFMono-Regular", "Roboto Mono", monospace';
      const textWidth = ctx.measureText(label).width;
      const x = clamp(p.x - textWidth / 2 - 7, 8, this.width - textWidth - 22);
      const y = clamp(p.y - radius - 21, 40, this.height - 16);
      ctx.fillStyle = 'rgba(9, 14, 10, 0.82)';
      ctx.strokeStyle = 'rgba(213, 255, 117, 0.27)';
      ctx.lineWidth = 0.8;
      roundedRect(ctx, x, y - 8.5, textWidth + 14, 17, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(222, 246, 208, 0.84)';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + 7, y);
      ctx.strokeStyle = 'rgba(213, 255, 117, 0.35)';
      ctx.beginPath();
      ctx.moveTo(p.x, y + 8.5);
      ctx.lineTo(p.x, p.y - radius - 4);
      ctx.stroke();
      ctx.restore();
    }

    render(sim, dt = 0.016, now = performance.now()) {
      this.sim = sim;
      const ctx = this.ctx;
      if (!ctx) return;
      const delta = clamp(dt, 0, 0.05);
      this.fluidTime += delta;
      this._updateMotes(delta);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      const metrics = this._computeViewMetrics(delta);
      this._drawAtmosphere();

      ctx.save();
      ctx.translate(this.width / 2, this.height / 2);
      ctx.scale(metrics.scale, metrics.scale);
      ctx.translate(-metrics.centerX, -metrics.centerY);

      this._drawWorldBase(now);

      const selected = this.selectedId !== null ? sim.getCreature(this.selectedId) : null;
      if (selected) {
        this._drawVisionCone(selected);
        this._drawAttackRange(selected);
        this._drawGeneticLinks(selected);
      }

      for (const creature of sim.creatures) {
        this._drawCreature(creature, now);
      }

      this._drawEffects(delta);
      if (selected) this._drawForceVector(selected);
      ctx.restore();

      if (selected) this._drawSelectedScreenLabel(selected);

      if (this.hoveredId !== null && !sim.getCreature(this.hoveredId)) {
        this._hideHover();
      }
    }
  }

  Evo.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
