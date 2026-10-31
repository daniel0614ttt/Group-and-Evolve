/* Group and Evolve — homepage interactions and the hero culture field. */
(function () {
  'use strict';

  const nav = document.getElementById('siteNav');
  const canvas = document.getElementById('cultureCanvas');

  function syncNav() {
    if (!nav) return;
    nav.classList.toggle('is-scrolled', window.scrollY > 16);
  }

  window.addEventListener('scroll', syncNav, { passive: true });
  syncNav();

  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const card = canvas.parentElement;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const palette = [
    { h: 170, s: 82, l: 62 },
    { h: 160, s: 82, l: 63 },
    { h: 182, s: 78, l: 62 },
    { h: 194, s: 68, l: 65 },
    { h: 148, s: 72, l: 62 },
    { h: 46, s: 84, l: 65 },
    { h: 17, s: 83, l: 67 },
  ];

  let width = 0;
  let height = 0;
  let dpr = 1;
  let lastTime = performance.now();
  let elapsed = 0;
  let rafId = 0;
  let pointer = { x: 0, y: 0, active: false };
  const agents = [];
  const dust = [];

  const random = (min, max) => min + Math.random() * (max - min);

  function makeAgent(index) {
    const color = palette[Math.random() < 0.74 ? Math.floor(Math.random() * 5) : 5 + Math.floor(Math.random() * 2)];
    const clustered = Math.random() < 0.66;
    let nx;
    let ny;
    if (clustered) {
      const angle = random(0, Math.PI * 2);
      const spread = Math.pow(Math.random(), 1.7) * random(0.17, 0.3);
      nx = 0.5 + Math.cos(angle) * spread;
      ny = 0.48 + Math.sin(angle) * spread;
    } else {
      nx = random(0.1, 0.9);
      ny = random(0.12, 0.84);
    }
    return {
      nx,
      ny,
      vx: random(-0.018, 0.018),
      vy: random(-0.014, 0.014),
      radius: clustered ? random(2.3, 5.4) : random(1.8, 4.3),
      color,
      alpha: random(0.72, 1),
      phase: random(0, Math.PI * 2),
      drift: random(0.16, 0.5),
      ring: index % 4 === 0,
      index,
    };
  }

  function initField() {
    agents.length = 0;
    const count = width < 480 ? 34 : 48;
    for (let i = 0; i < count; i += 1) agents.push(makeAgent(i));
    dust.length = 0;
    for (let i = 0; i < 34; i += 1) {
      dust.push({
        nx: Math.random(),
        ny: Math.random(),
        radius: random(0.4, 1.25),
        alpha: random(0.15, 0.45),
        phase: random(0, Math.PI * 2),
      });
    }
  }

  function resize() {
    if (!card) return;
    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    width = Math.round(rect.width);
    height = Math.round(rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    if (!agents.length) initField();
    if (reducedMotion) renderFrame(0);
  }

  function drawLinks(time) {
    const limit = Math.min(width, height) * 0.27;
    const limitSq = limit * limit;
    for (let i = 0; i < agents.length; i += 1) {
      const a = agents[i];
      const ax = a.nx * width;
      const ay = a.ny * height;
      for (let j = i + 1; j < agents.length; j += 1) {
        const b = agents[j];
        const dx = b.nx * width - ax;
        const dy = b.ny * height - ay;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq > limitSq) continue;
        const closeness = 1 - Math.sqrt(distanceSq) / limit;
        const pulse = 0.55 + 0.45 * Math.sin(time * 0.55 + a.phase + b.phase);
        ctx.strokeStyle = `rgba(147, 231, 194, ${closeness * 0.19 * pulse})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(b.nx * width, b.ny * height);
        ctx.stroke();
      }
    }
  }

  function drawDust(time) {
    for (const speck of dust) {
      const x = speck.nx * width;
      const y = speck.ny * height;
      const alpha = speck.alpha * (0.55 + Math.sin(time * 0.55 + speck.phase) * 0.45);
      ctx.fillStyle = `rgba(196, 232, 187, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, speck.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawAgent(agent, time) {
    const x = agent.nx * width;
    const y = agent.ny * height;
    const pulse = 0.72 + Math.sin(time * 0.8 + agent.phase) * 0.28;
    const { h, s, l } = agent.color;
    let highlight = 0;
    if (pointer.active) {
      const dx = pointer.x - x;
      const dy = pointer.y - y;
      const distance = Math.hypot(dx, dy);
      highlight = Math.max(0, 1 - distance / 135);
    }

    // Soft atmospheric halo.
    ctx.fillStyle = `hsla(${h}, ${s}%, ${l}%, ${0.055 + highlight * 0.075})`;
    ctx.beginPath();
    ctx.arc(x, y, agent.radius * (3.4 + pulse * 0.4), 0, Math.PI * 2);
    ctx.fill();

    // Elastic membrane.
    ctx.fillStyle = `hsla(${h}, ${s}%, ${l}%, ${agent.alpha * (0.72 + highlight * 0.2)})`;
    ctx.beginPath();
    ctx.arc(x, y, agent.radius * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `hsla(${h}, 94%, 82%, ${0.28 + highlight * 0.3})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(x, y, agent.radius * pulse + 1.3, 0, Math.PI * 2);
    ctx.stroke();

    // Bright nucleus.
    ctx.fillStyle = 'rgba(240, 255, 229, 0.82)';
    ctx.beginPath();
    ctx.arc(x + agent.radius * 0.12, y - agent.radius * 0.08, Math.max(0.55, agent.radius * 0.24), 0, Math.PI * 2);
    ctx.fill();

    if (agent.ring) {
      const ringRadius = agent.radius * 2.1 + (Math.sin(time * 0.8 + agent.phase) + 1) * 4;
      ctx.strokeStyle = `hsla(${h}, 85%, 72%, ${0.12 + highlight * 0.16})`;
      ctx.lineWidth = 0.55;
      ctx.setLineDash([1.5, 3]);
      ctx.beginPath();
      ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function stepAgents(dt, time) {
    for (const agent of agents) {
      agent.nx += agent.vx * dt;
      agent.ny += agent.vy * dt;
      agent.vx += Math.sin(time * 0.24 + agent.phase) * 0.00012;
      agent.vy += Math.cos(time * 0.2 + agent.phase) * 0.0001;

      if (agent.nx < 0.1) {
        agent.nx = 0.1;
        agent.vx = Math.abs(agent.vx);
      } else if (agent.nx > 0.9) {
        agent.nx = 0.9;
        agent.vx = -Math.abs(agent.vx);
      }
      if (agent.ny < 0.12) {
        agent.ny = 0.12;
        agent.vy = Math.abs(agent.vy);
      } else if (agent.ny > 0.84) {
        agent.ny = 0.84;
        agent.vy = -Math.abs(agent.vy);
      }
    }
  }

  function renderFrame(dt) {
    if (!width || !height) return;
    elapsed += dt;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const ambient = ctx.createRadialGradient(width * 0.5, height * 0.47, 0, width * 0.5, height * 0.47, Math.min(width, height) * 0.58);
    ambient.addColorStop(0, 'rgba(69, 141, 111, 0.075)');
    ambient.addColorStop(0.55, 'rgba(46, 91, 71, 0.028)');
    ambient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = ambient;
    ctx.fillRect(0, 0, width, height);

    if (dt > 0) stepAgents(dt, elapsed);
    drawLinks(elapsed);
    drawDust(elapsed);

    if (pointer.active) {
      const glow = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 150);
      glow.addColorStop(0, 'rgba(154, 238, 198, 0.038)');
      glow.addColorStop(1, 'rgba(154, 238, 198, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(pointer.x - 155, pointer.y - 155, 310, 310);
    }

    for (const agent of agents) drawAgent(agent, elapsed);
  }

  function animate(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    renderFrame(dt);
    rafId = window.requestAnimationFrame(animate);
  }

  if (card) {
    card.addEventListener('pointermove', (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        active: true,
      };
    });
    card.addEventListener('pointerleave', () => {
      pointer.active = false;
    });
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(card || canvas);
  resize();

  if (!reducedMotion) {
    rafId = window.requestAnimationFrame((now) => {
      lastTime = now;
      animate(now);
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (reducedMotion) return;
    if (document.hidden) {
      window.cancelAnimationFrame(rafId);
    } else {
      lastTime = performance.now();
      rafId = window.requestAnimationFrame(animate);
    }
  });
})();
