/* Group and Evolve — application shell, controls, charts and inspector. */
(function () {
  'use strict';

  const Evo = window.Evo;
  const U = Evo.Utils;
  const C = Evo.Constants;
  const { clamp, formatTick, formatSigned } = U;

  const STORAGE_KEY = 'group-and-evolve/settings/v3';
  const DEFAULT_SETTINGS = {
    inertia: 0.9,
    evolutionRate: C.DEFAULT_EVOLUTION_RATE,
    nearThreshold: C.DEFAULT_NEAR_THRESHOLD,
    learningEnabled: true,
    showVision: true,
    timeScale: 1,
  };
  const BASE_TPS = C.BASE_TPS;
  const MAX_POPULATION = C.MAX_POPULATION;

  const $ = (id) => document.getElementById(id);
  const refs = {
    stage: $('stage'),
    canvas: $('worldCanvas'),
    statTime: $('statTime'),
    statPopulation: $('statPopulation'),
    statGeneration: $('statGeneration'),
    phaseChip: $('phaseChip'),
    phaseLabel: $('phaseLabel'),
    runState: $('runState'),
    runStateLabel: $('runStateLabel'),
    zoomReadout: $('zoomReadout'),
    zoomOutBtn: $('zoomOutBtn'),
    zoomInBtn: $('zoomInBtn'),
    resetViewBtn: $('resetViewBtn'),
    hoverCard: $('hoverCard'),
    specimenCard: $('specimenCard'),
    specimenSwatch: $('specimenSwatch'),
    specimenKicker: $('specimenKicker'),
    specimenTitle: $('specimenTitle'),
    followBtn: $('followBtn'),
    closeSpecimenBtn: $('closeSpecimenBtn'),
    vitalGrid: $('vitalGrid'),
    socialSummary: $('socialSummary'),
    neuroTab: $('neuroTab'),
    geneTab: $('geneTab'),
    tapMeta: $('tapMeta'),
    neuroPanel: $('neuroPanel'),
    genePanel: $('genePanel'),
    brainCanvas: $('brainCanvas'),
    brainLearning: $('brainLearning'),
    neuralReadout: $('neuralReadout'),
    neuralNote: $('neuralNote'),
    geneList: $('geneList'),
    extinctOverlay: $('extinctOverlay'),
    extinctCopy: $('extinctCopy'),
    extinctStats: $('extinctStats'),
    extinctReseedBtn: $('extinctReseedBtn'),
    helpBtn: $('helpBtn'),
    playBtn: $('playBtn'),
    playLabel: $('playLabel'),
    playHint: $('playHint'),
    stepBtn: $('stepBtn'),
    resetBtn: $('resetBtn'),
    actualTps: $('actualTps'),
    speedGroup: $('speedGroup'),
    evolutionSlider: $('evolutionSlider'),
    evolutionValue: $('evolutionValue'),
    inertiaSlider: $('inertiaSlider'),
    inertiaValue: $('inertiaValue'),
    nearSlider: $('nearSlider'),
    nearValue: $('nearValue'),
    learningToggle: $('learningToggle'),
    visionToggle: $('visionToggle'),
    pulseChart: $('pulseChart'),
    chartMax: $('chartMax'),
    metricEnergy: $('metricEnergy'),
    metricDiversity: $('metricDiversity'),
    metricLearning: $('metricLearning'),
    metricBirths: $('metricBirths'),
    metricDeaths: $('metricDeaths'),
    metricAttacks: $('metricAttacks'),
    leaderList: $('leaderList'),
    eventFeed: $('eventFeed'),
    neuralIndicator: $('neuralIndicator'),
    learningStatus: $('learningStatus'),
    seedLabel: $('seedLabel'),
    helpModal: $('helpModal'),
    helpGrid: $('helpGrid'),
    helpScrollCue: $('helpScrollCue'),
    closeHelpBtn: $('closeHelpBtn'),
    helpDoneBtn: $('helpDoneBtn'),
    toast: $('toast'),
  };

  const state = {
    running: true,
    timeScale: 1,
    settings: loadSettings(),
    selectedId: null,
    hoveredId: null,
    selectedTab: 'neuro',
    accumulator: 0,
    lastFrame: 0,
    lastUi: 0,
    lastChart: 0,
    lastLeaders: 0,
    lastGene: 0,
    lastBirthFeed: 0,
    lastKillFeed: 0,
    lastAgeFeed: 0,
    feed: [],
    feedDirty: false,
    leaderSignature: '',
    extinctionHandled: false,
    extinct: false,
    telemetry: null,
    helpOpen: false,
    lastFocus: null,
    toastTimer: null,
  };

  const sim = new Evo.Simulation({
    seed: initialSeed(),
    inertia: state.settings.inertia,
    evolutionRate: state.settings.evolutionRate,
    nearThreshold: state.settings.nearThreshold,
    learningEnabled: state.settings.learningEnabled,
    showVision: state.settings.showVision,
  });
  state.timeScale = state.settings.timeScale;

  let renderer;
  let brainResizeTracker = { width: 0, height: 0 };

  /* --------------------------------------------------------------- helpers */

  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const settings = { ...DEFAULT_SETTINGS };
      if (Number.isFinite(raw.inertia)) settings.inertia = clamp(raw.inertia, 0.7, 0.97);
      if (Number.isFinite(raw.evolutionRate)) {
        settings.evolutionRate = clamp(raw.evolutionRate, 0, 1);
      }
      if (Number.isFinite(raw.nearThreshold)) {
        settings.nearThreshold = clamp(raw.nearThreshold, 0, 0.5);
      }
      if (typeof raw.learningEnabled === 'boolean') {
        settings.learningEnabled = raw.learningEnabled;
      }
      if (typeof raw.showVision === 'boolean') settings.showVision = raw.showVision;
      if ([0.5, 1, 2, 4, 10, 20].includes(raw.timeScale)) settings.timeScale = raw.timeScale;
      return settings;
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    } catch {
      /* Private/file contexts may block storage. The simulation is unaffected. */
    }
  }

  function generateSeed() {
    return ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1;
  }

  function initialSeed() {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get('seed');
      if (raw !== null && /^\d{1,10}$/.test(raw)) {
        const parsed = Number(raw) >>> 0;
        if (parsed > 0) return parsed;
      }
    } catch {
      /* A malformed URL should never prevent the ecosystem from starting. */
    }
    return generateSeed();
  }

  function seedHex(seed) {
    return `0x${(seed >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
  }

  function syncSeedUrl() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('seed', String(sim.seed));
      window.history.replaceState(null, '', url.toString());
    } catch {
      /* file:// or restricted contexts may not expose a mutable history. */
    }
  }

  function setToast(message, duration = 2600) {
    window.clearTimeout(state.toastTimer);
    refs.toast.textContent = message;
    refs.toast.classList.add('is-visible');
    state.toastTimer = window.setTimeout(() => {
      refs.toast.classList.remove('is-visible');
    }, duration);
  }

  function setSliderVisual(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const fill = max === min ? 0 : ((value - min) / (max - min)) * 100;
    input.style.setProperty('--fill', `${fill}%`);
  }

  function syncRangeControls() {
    refs.evolutionSlider.value = String(Math.round(state.settings.evolutionRate * 100));
    refs.inertiaSlider.value = String(Math.round(state.settings.inertia * 100));
    refs.nearSlider.value = String(Math.round(state.settings.nearThreshold * 100));
    refs.evolutionValue.textContent = `${Math.round(state.settings.evolutionRate * 100)}%`;
    refs.inertiaValue.textContent = state.settings.inertia.toFixed(2);
    refs.nearValue.textContent = state.settings.nearThreshold.toFixed(2);
    setSliderVisual(refs.evolutionSlider);
    setSliderVisual(refs.inertiaSlider);
    setSliderVisual(refs.nearSlider);
  }

  function syncToggle(button, enabled) {
    button.setAttribute('aria-checked', enabled ? 'true' : 'false');
  }

  function syncToggles() {
    syncToggle(refs.learningToggle, state.settings.learningEnabled);
    syncToggle(refs.visionToggle, state.settings.showVision);
    refs.neuralIndicator.classList.toggle('is-off', !state.settings.learningEnabled);
    refs.learningStatus.textContent = state.settings.learningEnabled
      ? '在线学习开启'
      : '在线学习暂停';
    if (refs.brainLearning) {
      refs.brainLearning.textContent = state.settings.learningEnabled ? 'ONLINE' : 'PAUSED';
      refs.brainLearning.classList.toggle('is-off', !state.settings.learningEnabled);
    }
  }

  function syncSpeedControls() {
    for (const button of refs.speedGroup.querySelectorAll('button')) {
      button.classList.toggle('is-active', Number(button.dataset.speed) === state.timeScale);
    }
    refs.actualTps.textContent = `${Math.round(BASE_TPS * state.timeScale)} TICKS / S`;
  }

  function syncRunState() {
    const extinct = sim.stats.extinct;
    const paused = !state.running || extinct;
    refs.playBtn.classList.toggle('is-paused', paused);
    refs.runState.classList.toggle('is-paused', paused && !extinct);
    refs.runState.classList.toggle('is-extinct', extinct);
    if (extinct) {
      refs.playLabel.textContent = '生态已沉寂';
      refs.playHint.textContent = 'R · 重新播种';
      refs.runStateLabel.textContent = '已沉寂';
    } else if (state.running) {
      refs.playLabel.textContent = '暂停演化';
      refs.playHint.textContent = 'SPACE · 暂停';
      refs.runStateLabel.textContent = '演化中';
    } else {
      refs.playLabel.textContent = '继续演化';
      refs.playHint.textContent = 'SPACE · 运行';
      refs.runStateLabel.textContent = '已暂停';
    }
  }

  function setRunning(next) {
    if (sim.stats.extinct) next = false;
    state.running = next;
    state.accumulator = 0;
    syncRunState();
  }

  function syncFollowUI() {
    const active = renderer?.isFollowing() ?? false;
    refs.followBtn.classList.toggle('is-active', active);
    refs.followBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    const label = refs.followBtn.querySelector('span');
    if (label) label.textContent = active ? '跟踪中' : '跟踪';
  }

  function syncZoomReadout() {
    if (!renderer) return;
    refs.zoomReadout.textContent = `${renderer.getZoom().toFixed(2)}×`;
  }

  function seedLabelText() {
    return `SEED ${seedHex(sim.seed)}`;
  }

  /* ---------------------------------------------------------------- render */

  renderer = new Evo.Renderer(refs.canvas, sim, {
    onSelect(id) {
      if (id === null) {
        clearSelection();
      } else {
        selectCreature(id, false);
      }
    },
    onHover(creature, point) {
      if (!creature) {
        hideHoverCard();
      } else {
        showHoverCard(creature, point);
      }
    },
    onFollowStop() {
      syncFollowUI();
    },
  });

  /* --------------------------------------------------------------- events */

  function addFeed(type, primary, detail, tick = sim.tick) {
    state.feed.unshift({ type, primary, detail, tick });
    if (state.feed.length > 5) state.feed.length = 5;
    state.feedDirty = true;
  }

  function ingestEvents(events, now = performance.now()) {
    if (!events || !events.length) return;
    let birthEvent = null;
    let killEvent = null;
    let ageEvent = null;
    let firstConflictEvent = null;

    for (const event of events) {
      if (event.type === 'birth') {
        birthEvent = event;
      } else if (event.type === 'attack' && event.killed) {
        killEvent = event;
      } else if (event.type === 'death' && event.cause === 'age') {
        ageEvent = event;
      } else if (event.type === 'firstConflict') {
        firstConflictEvent = event;
      } else if (event.type === 'extinct') {
        addFeed('death', '生态已达到零种群', '所有个体均已死亡', event.tick);
      }
    }

    if (firstConflictEvent) {
      const threshold =
        firstConflictEvent.nearThreshold ?? sim.settings.nearThreshold;
      addFeed(
        'conflict',
        '<b>首次跨阈值攻击</b>',
        `#${String(firstConflictEvent.attackerId).padStart(4, '0')} → #${String(firstConflictEvent.victimId).padStart(4, '0')} · 距离 ${firstConflictEvent.distance.toFixed(3)} &gt; 阈值 ${threshold.toFixed(2)}`,
        firstConflictEvent.tick,
      );
      setToast('遗传距离越过阈值 · 跨阈值冲突阶段开始', 4200);
    }

    if (birthEvent && now - state.lastBirthFeed > 620) {
      state.lastBirthFeed = now;
      addFeed(
        'birth',
        `<b>#${String(birthEvent.id).padStart(4, '0')}</b> 出生`,
        `父母 #${String(birthEvent.parentId).padStart(4, '0')} · GEN ${birthEvent.generation}`,
        birthEvent.tick,
      );
    }

    if (killEvent && now - state.lastKillFeed > 240) {
      state.lastKillFeed = now;
      addFeed(
        'kill',
        `<b>#${String(killEvent.victimId).padStart(4, '0')}</b> 被猎食`,
        `攻击者 #${String(killEvent.attackerId).padStart(4, '0')} · 遗传距离 ${(killEvent.geneticDistance ?? 0).toFixed(3)}`,
        killEvent.tick,
      );
    }

    if (ageEvent && now - state.lastAgeFeed > 700) {
      state.lastAgeFeed = now;
      addFeed(
        'death',
        `<b>#${String(ageEvent.id).padStart(4, '0')}</b> 寿命耗尽`,
        `GEN ${ageEvent.generation} · 自然死亡`,
        ageEvent.tick,
      );
    }
  }

  function renderFeed() {
    if (!state.feedDirty) return;
    state.feedDirty = false;
    if (!state.feed.length) {
      refs.eventFeed.innerHTML = '<div class="event-empty">等待生态事件…</div>';
      return;
    }
    refs.eventFeed.innerHTML = state.feed
      .map(
        (entry, index) => `
        <div class="event-item${index === 0 ? ' is-new' : ''}">
          <span class="event-time">T+${formatTick(entry.tick)}</span>
          <i class="event-dot ${entry.type}" aria-hidden="true"></i>
          <span class="event-copy">${entry.primary} <small>${entry.detail}</small></span>
        </div>`,
      )
      .join('');
  }

  /* -------------------------------------------------------------- selection */

  function showHoverCard(creature, point) {
    if (!point || !creature) {
      hideHoverCard();
      return;
    }
    const health = Math.round(clamp(creature.health / creature.maxHealth, 0, 1) * 100);
    refs.hoverCard.hidden = false;
    refs.hoverCard.innerHTML = `
      <div class="hover-title">
        <i style="background: ${creature.colorCss}"></i>
        #${String(creature.id).padStart(4, '0')}
        <span style="color: var(--faint)">GEN ${creature.generation}</span>
      </div>
      <div class="hover-meta">
        <span>GEN ${creature.generation}</span>
        <span>HP ${health}%</span>
        <span>E ${Math.round(creature.energy)}</span>
      </div>`;
    const width = refs.stage.clientWidth;
    const height = refs.stage.clientHeight;
    const left = clamp(point.x + 12, 10, Math.max(10, width - 210));
    const top = clamp(point.y, 52, Math.max(52, height - 38));
    refs.hoverCard.style.left = `${left}px`;
    refs.hoverCard.style.top = `${top}px`;
  }

  function hideHoverCard() {
    refs.hoverCard.hidden = true;
    state.hoveredId = null;
    if (renderer) renderer.hoveredId = null;
  }

  function dockSpecimenCard(creature) {
    if (!renderer || !creature) return;
    const point = renderer._worldToScreen(creature.x, creature.y);
    const stageWidth = refs.stage.clientWidth;
    const margin = stageWidth <= 1260 ? 24 : 28;
    const cardWidth = refs.specimenCard.offsetWidth || Math.min(396, stageWidth - margin * 2);
    // Put the dossier on the side opposite the specimen whenever possible.
    const useRight = point.x < stageWidth / 2;
    refs.specimenCard.classList.toggle('is-right', useRight);
    refs.stage.classList.toggle('has-right-card', useRight);
  }

  function selectCreature(id, focus = false) {
    const creature = sim.getCreature(id);
    if (!creature) return;
    state.selectedId = id;
    state.lastGene = 0;
    renderer.setSelection(id);
    refs.specimenCard.hidden = false;
    refs.specimenCard.scrollTop = 0;
    refs.stage.classList.add('is-inspecting');
    hideHoverCard();
    if (focus) {
      renderer.focusCreature(id, 1.45);
      syncZoomReadout();
    }
    dockSpecimenCard(creature);
    syncFollowUI();
    updateSpecimen();
    setSpecimenTab(state.selectedTab);
  }

  function clearSelection(silent = false) {
    if (state.selectedId === null && refs.specimenCard.hidden) return;
    state.selectedId = null;
    renderer.setSelection(null);
    refs.stage.classList.remove('is-inspecting', 'has-right-card');
    refs.specimenCard.hidden = true;
    refs.specimenCard.classList.remove('is-right');
    syncFollowUI();
    if (!silent) hideHoverCard();
  }

  function setSpecimenTab(tab) {
    state.selectedTab = tab;
    state.lastGene = 0;
    const showNeuro = tab === 'neuro';
    refs.neuroTab.classList.toggle('is-active', showNeuro);
    refs.geneTab.classList.toggle('is-active', !showNeuro);
    refs.neuroTab.setAttribute('aria-selected', showNeuro ? 'true' : 'false');
    refs.geneTab.setAttribute('aria-selected', showNeuro ? 'false' : 'true');
    refs.neuroPanel.hidden = !showNeuro;
    refs.genePanel.hidden = showNeuro;
    refs.tapMeta.textContent = showNeuro ? '60 → 24 → 3' : '6 LOCI';
    if (showNeuro) {
      updateSpecimen();
    } else {
      updateGenePanel();
    }
  }

  function updateSpecimen() {
    if (state.selectedId === null) return;
    const creature = sim.getCreature(state.selectedId);
    if (!creature) {
      clearSelection(true);
      setToast('观察对象已经死亡');
      return;
    }
    state.hoveredId = state.hoveredId === creature.id ? creature.id : state.hoveredId;

    const hpRatio = clamp(creature.health / creature.maxHealth, 0, 1);
    const hpClass = hpRatio < 0.3 ? 'is-low' : hpRatio < 0.6 ? 'is-mid' : '';
    refs.specimenKicker.textContent = `SPECIMEN #${String(creature.id).padStart(4, '0')}`;
    refs.specimenTitle.textContent = `第 ${creature.generation} 代个体`;
    refs.specimenSwatch.style.background = creature.colorCss;
    refs.specimenSwatch.style.boxShadow = `0 0 18px hsla(${creature.hue}, ${creature.saturation * 100}%, ${creature.lightness * 100}%, .32)`;

    refs.vitalGrid.innerHTML = `
      <div class="vital-cell">
        <span>生命 / HEALTH</span>
        <strong class="${hpClass}">${creature.health.toFixed(1)} <em>/ ${creature.maxHealth.toFixed(1)}</em></strong>
      </div>
      <div class="vital-cell">
        <span>能量 / ENERGY</span>
        <strong>${creature.energy.toFixed(1)} <em>/ ${C.MAX_ENERGY}</em></strong>
      </div>
      <div class="vital-cell">
        <span>剩余寿命 / LIFE</span>
        <strong>${Math.max(0, creature.remainingLife)} <em>t</em></strong>
      </div>
      <div class="vital-cell">
        <span>速度 / VELOCITY</span>
        <strong>${creature.speed.toFixed(2)} <em>u/t</em></strong>
      </div>
      <div class="vital-cell">
        <span>攻击 / 收益</span>
        <strong>${creature.genes.attackDamage.toFixed(1)} <em>× ${creature.genes.attackGain.toFixed(2)}</em></strong>
      </div>
      <div class="vital-cell">
        <span>位置 / POSITION</span>
        <strong>${Math.round(creature.x)}, ${Math.round(creature.y)}</strong>
      </div>`;

    const perception = creature.perception || {
      nearCount: 0,
      farCount: 0,
      nearestFarDistance: Infinity,
    };
    const nearestFar = Number.isFinite(perception.nearestFarDistance)
      ? `${Math.round(perception.nearestFarDistance)}u`
      : '—';
    refs.socialSummary.innerHTML = `
      <span class="social-label">视域关系</span>
      <span><i class="relation-dot near" aria-hidden="true"></i>近缘 <span class="near-value">${perception.nearCount}</span></span>
      <span><i class="relation-dot far" aria-hidden="true"></i>远缘 <span class="far-value">${perception.farCount}</span></span>
      <span class="social-threshold">阈值 ${sim.settings.nearThreshold.toFixed(2)} · 最近远缘 ${nearestFar}</span>`;
    refs.socialSummary.title =
      '只有这两名个体的遗传距离超过阈值时，攻击才成为可能。';

    const brain = creature.brain;
    const attackProbability = brain.attackProbability * 100;
    refs.brainLearning.textContent = state.settings.learningEnabled ? 'ONLINE' : 'PAUSED';
    refs.brainLearning.classList.toggle('is-off', !state.settings.learningEnabled);
    refs.neuralReadout.innerHTML = `
      <div class="neural-output">
        <span>F∥ 前向力</span>
        <strong class="acid">${formatSigned(brain.forceForward)}</strong>
      </div>
      <div class="neural-output">
        <span>F⊥ 侧向力</span>
        <strong class="mint">${formatSigned(brain.forceLateral)}</strong>
      </div>
      <div class="neural-output">
        <span>攻击概率 / 采样</span>
        <strong class="coral">${Math.round(attackProbability)}% <em style="color: var(--faint); font-size: 8px; font-style: normal">${creature.nearSuppressed ? '近缘抑制' : brain.attackIntent ? '攻击' : '巡航'}</em></strong>
      </div>
      <div class="neural-foot">
        <span>V ${brain.valueEstimate.toFixed(2)}</span>
        <span>ADV ${formatSigned(brain.lastAdvantage)}</span>
        <span>UPD ${formatTick(brain.updates)}</span>
      </div>`;
    if (creature.nearSuppressed) {
      refs.neuralNote.textContent =
        '视域内只有阈值内的近缘个体：这次攻击被两两遗传距离规则抑制。';
    } else if (state.settings.learningEnabled) {
      refs.neuralNote.textContent =
        '动作含探索噪声；下一次决策前用实际收益更新共享隐层与决策头。';
    } else {
      refs.neuralNote.textContent =
        '在线学习已暂停：行为仅由遗传权重与探索噪声驱动。';
    }

    if (state.selectedTab === 'neuro') drawBrainNetwork(brain);
    if (state.selectedTab === 'gene') updateGenePanel();

    if (renderer.isFollowing() && !sim.getCreature(state.selectedId)) syncFollowUI();
  }

  function updateGenePanel() {
    if (state.selectedId === null || state.selectedTab !== 'gene') return;
    const now = performance.now();
    if (now - state.lastGene < 320) return;
    const creature = sim.getCreature(state.selectedId);
    if (!creature) return;
    state.lastGene = now;
    refs.geneList.innerHTML = sim
      .getGeneDefinitions()
      .map((definition) => {
        const value = creature.genes[definition.key];
        const position = clamp((value - definition.min) / (definition.max - definition.min), 0, 1);
        let display;
        if (definition.percent) display = `${Math.round(value * 100)}%`;
        else if (definition.key === 'attackGain') display = `${value.toFixed(2)}×`;
        else if (definition.key === 'reproThreshold') display = `${Math.round(value)} E`;
        else if (definition.key === 'energyGrowth') display = `${value.toFixed(3)} /t`;
        else display = `${value.toFixed(definition.digits)}`;
        return `
          <div class="gene-row">
            <div class="gene-head">
              <span class="gene-name">${definition.label}<small>${definition.short.toUpperCase()}</small></span>
              <span class="gene-value">${display}</span>
            </div>
            <span class="gene-bar"><i style="width:${Math.max(3, position * 100)}%"></i></span>
          </div>`;
      })
      .join('');
  }

  /* --------------------------------------------------------------- neural */

  function drawBrainNetwork(brain) {
    const canvas = refs.brainCanvas;
    if (!canvas || !brain) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 20) return;
    const width = Math.round(rect.width);
    const height = 156;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (
      brainResizeTracker.width !== width ||
      brainResizeTracker.height !== height ||
      canvas.width !== Math.round(width * dpr)
    ) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      brainResizeTracker = { width, height };
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const input = brain.lastInput;
    const hidden = brain.lastHidden;
    const totalInputs = brain.inputSize;
    const hiddenSize = brain.hiddenSize;

    // Layer backgrounds create a readable three-stage diagram.
    ctx.fillStyle = 'rgba(225, 242, 226, 0.014)';
    ctx.fillRect(7, 22, 77, height - 30);
    ctx.fillStyle = 'rgba(225, 242, 226, 0.011)';
    ctx.fillRect(118, 22, 108, height - 30);
    ctx.fillStyle = 'rgba(225, 242, 226, 0.014)';
    ctx.fillRect(width - 62, 22, 54, height - 30);
    ctx.strokeStyle = 'rgba(225, 242, 226, 0.055)';
    ctx.lineWidth = 0.75;
    for (const x of [100, width - 68]) {
      ctx.beginPath();
      ctx.moveTo(x, 24);
      ctx.lineTo(x, height - 12);
      ctx.stroke();
    }

    // Input matrix: 60 actual values, 6 columns × 10 rows.
    const inputNodes = [];
    const inputCols = 6;
    const inputRows = 10;
    for (let i = 0; i < totalInputs; i += 1) {
      const col = i % inputCols;
      const row = Math.floor(i / inputCols);
      const value = input[i] || 0;
      inputNodes.push({
        index: i,
        x: 15 + col * 10.4,
        y: 33 + row * 10.7,
        value,
        magnitude: clamp(Math.abs(value), 0, 1),
        vision: i >= 18,
      });
    }

    // Hidden trunk: 24 actual activations, 4 columns × 6 rows.
    const hiddenNodes = [];
    for (let i = 0; i < hiddenSize; i += 1) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      hiddenNodes.push({
        index: i,
        x: 143 + col * 19.5,
        y: 37 + row * 15.1,
        value: hidden[i] || 0,
      });
    }

    // Motor outputs.
    const outputX = width - 35;
    const outputYs = [height / 2 - 31, height / 2, height / 2 + 31];
    const outputValues = [
      brain.forceForward,
      brain.forceLateral,
      brain.attackProbability * 2 - 1,
    ];

    const drawEdge = (x1, y1, x2, y2, weight, importance = 1, activity = 1) => {
      const strength = Math.min(1, Math.abs(weight) / 1.1);
      const alpha = (0.026 + strength * 0.2) * activity * importance;
      if (alpha < 0.018) return;
      ctx.strokeStyle =
        weight >= 0
          ? `rgba(150, 233, 184, ${alpha})`
          : `rgba(255, 139, 125, ${alpha})`;
      ctx.lineWidth = 0.35 + strength * 0.45;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };

    // Sample the strongest input synapses for each hidden unit.
    const strongestInputEdges = [];
    for (const hNode of hiddenNodes) {
      const candidates = [];
      for (const inNode of inputNodes) {
        const weight = brain.w1[hNode.index * totalInputs + inNode.index] || 0;
        const salience = Math.abs(weight) * (0.22 + inNode.magnitude);
        candidates.push({ node: inNode, weight, salience });
      }
      candidates.sort((a, b) => b.salience - a.salience);
      for (const edge of candidates.slice(0, 3)) {
        drawEdge(
          edge.node.x,
          edge.node.y,
          hNode.x,
          hNode.y,
          edge.weight,
          1,
          0.35 + edge.node.magnitude * 0.65,
        );
        strongestInputEdges.push({ from: edge.node, to: hNode, weight: edge.weight });
      }
    }

    // Every hidden unit projects into all three motor channels.
    const strongestMotorEdges = [null, null, null];
    for (const hNode of hiddenNodes) {
      for (let output = 0; output < 3; output += 1) {
        const weight =
          output === 0
            ? brain.wForce[hNode.index]
            : output === 1
              ? brain.wForce[hiddenSize + hNode.index]
              : brain.wAttack[hNode.index];
        drawEdge(hNode.x, hNode.y, outputX, outputYs[output], weight, 1.25);
        if (!strongestMotorEdges[output] || Math.abs(weight) > Math.abs(strongestMotorEdges[output].weight)) {
          strongestMotorEdges[output] = { from: hNode, toIndex: output, weight };
        }
      }
    }

    // Input synapses.
    for (const node of inputNodes) {
      const radius = 0.8 + node.magnitude * 1.55;
      if (node.vision) {
        ctx.fillStyle = `rgba(213, 255, 117, ${0.16 + node.magnitude * 0.76})`;
      } else {
        ctx.fillStyle = `rgba(112, 233, 193, ${0.2 + node.magnitude * 0.7})`;
      }
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, U.TAU);
      ctx.fill();
    }

    // Hidden activations.
    for (const node of hiddenNodes) {
      const act = clamp(Math.abs(node.value), 0, 1);
      const radius = 1.15 + act * 1.9;
      ctx.fillStyle =
        node.value >= 0
          ? `rgba(213, 255, 117, ${0.28 + act * 0.62})`
          : `rgba(255, 142, 127, ${0.28 + act * 0.56})`;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, U.TAU);
      ctx.fill();
    }

    // Outputs.
    const outputColors = ['213, 255, 117', '112, 233, 193', '255, 142, 127'];
    for (let i = 0; i < 3; i += 1) {
      const value = Math.abs(outputValues[i]);
      ctx.fillStyle = `rgba(${outputColors[i]}, 0.1)`;
      ctx.beginPath();
      ctx.arc(outputX, outputYs[i], 8.5, 0, U.TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(${outputColors[i]}, ${0.44 + Math.min(1, value) * 0.54})`;
      ctx.beginPath();
      ctx.arc(outputX, outputYs[i], 2.5 + value * 2.1, 0, U.TAU);
      ctx.fill();
    }

    // Traveling activation pulses on the strongest motor synapses.
    const now = performance.now();
    for (let i = 0; i < 3; i += 1) {
      const edge = strongestMotorEdges[i];
      if (!edge) continue;
      const phase = (now * 0.00042 + i * 0.31) % 1;
      const px = U.lerp(edge.from.x, outputX, phase);
      const py = U.lerp(edge.from.y, outputYs[i], phase);
      ctx.fillStyle = `rgba(${outputColors[i]}, ${0.16 + Math.sin(phase * Math.PI) * 0.65})`;
      ctx.beginPath();
      ctx.arc(px, py, 1.2, 0, U.TAU);
      ctx.fill();
    }

    // A faint traveling pulse through the input→trunk field.
    if (strongestInputEdges.length) {
      const phase = (now * 0.00032) % 1;
      const pick = strongestInputEdges[Math.floor((now * 0.0005) % strongestInputEdges.length)];
      if (pick) {
        ctx.fillStyle = 'rgba(183, 246, 206, 0.45)';
        ctx.beginPath();
        ctx.arc(
          U.lerp(pick.from.x, pick.to.x, phase),
          U.lerp(pick.from.y, pick.to.y, phase),
          0.95,
          0,
          U.TAU,
        );
        ctx.fill();
      }
    }

    // Labels and channel names.
    ctx.font = '7px "SFMono-Regular", "Roboto Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(202, 226, 201, 0.38)';
    ctx.textAlign = 'left';
    ctx.fillText('SENSE 60', 10, 12);
    ctx.fillStyle = 'rgba(202, 226, 201, 0.3)';
    ctx.fillText('TRUNK 24', 124, 12);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(202, 226, 201, 0.38)';
    ctx.fillText('MOTOR 3', width - 8, 12);

    ctx.font = '6.5px "SFMono-Regular", "Roboto Mono", monospace';
    ctx.fillStyle = 'rgba(202, 226, 201, 0.32)';
    ctx.fillText('F∥', width - 8, outputYs[0]);
    ctx.fillText('F⊥', width - 8, outputYs[1]);
    ctx.fillText('ATK', width - 8, outputYs[2]);
  }

  /* ----------------------------------------------------------------- chart */

  function fitCanvasToDisplay(canvas) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height };
  }

  function drawPulseChart() {
    const { ctx, width, height } = fitCanvasToDisplay(refs.pulseChart);
    ctx.clearRect(0, 0, width, height);
    refs.chartMax.textContent = `MAX ${MAX_POPULATION}`;

    const history = sim.history;
    if (!history.length) return;
    const points = history.slice(-210);
    if (state.telemetry) {
      points.push({
        tick: sim.tick,
        population: sim.creatures.length,
        avgEnergy: state.telemetry.avgEnergy,
      });
    }
    if (points.length < 2) return;

    const padX = 2;
    const padTop = 10;
    const padBottom = 8;
    const drawHeight = height - padTop - padBottom;
    const firstTick = points[0].tick;
    const lastTick = Math.max(points[points.length - 1].tick, firstTick + 1);
    const xFor = (tick) => padX + ((tick - firstTick) / (lastTick - firstTick)) * (width - padX * 2);
    const yForPopulation = (population) =>
      padTop + drawHeight * (1 - clamp(population / MAX_POPULATION, 0, 1));
    const yForEnergy = (energy) => padTop + drawHeight * (1 - clamp(energy / 155, 0, 1));

    // Energy trace.
    ctx.beginPath();
    for (let i = 0; i < points.length; i += 1) {
      const x = xFor(points[i].tick);
      const y = yForEnergy(points[i].avgEnergy || 0);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(112, 233, 193, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Population area.
    const areaGradient = ctx.createLinearGradient(0, padTop, 0, height);
    areaGradient.addColorStop(0, 'rgba(213, 255, 117, 0.17)');
    areaGradient.addColorStop(1, 'rgba(213, 255, 117, 0)');
    ctx.beginPath();
    for (let i = 0; i < points.length; i += 1) {
      const x = xFor(points[i].tick);
      const y = yForPopulation(points[i].population);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(xFor(points[points.length - 1].tick), height - padBottom);
    ctx.lineTo(xFor(points[0].tick), height - padBottom);
    ctx.closePath();
    ctx.fillStyle = areaGradient;
    ctx.fill();

    // Population stroke.
    ctx.beginPath();
    for (let i = 0; i < points.length; i += 1) {
      const x = xFor(points[i].tick);
      const y = yForPopulation(points[i].population);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#d5ff75';
    ctx.lineWidth = 1.35;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    const final = points[points.length - 1];
    const finalX = xFor(final.tick);
    const finalY = yForPopulation(final.population);
    ctx.fillStyle = '#d5ff75';
    ctx.beginPath();
    ctx.arc(finalX, finalY, 2, 0, U.TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(213, 255, 117, 0.15)';
    ctx.beginPath();
    ctx.arc(finalX, finalY, 5, 0, U.TAU);
    ctx.fill();
  }

  /* ---------------------------------------------------------------- leaders */

  function updateLeaders() {
    const leaders = sim.getLeaders(4);
    const signature = leaders
      .map((c) => `${c.id}:${Math.round(c.energy)}:${c.generation}:${c.kills}`)
      .join('|');
    if (signature === state.leaderSignature) return;
    state.leaderSignature = signature;
    if (!leaders.length) {
      refs.leaderList.innerHTML = '<div class="leader-empty">没有存活个体</div>';
      return;
    }
    refs.leaderList.innerHTML = leaders
      .map((creature, index) => {
        const color = creature.colorCss;
        return `
          <button class="leader-row" type="button" data-creature-id="${creature.id}" title="定位并解剖个体 #${creature.id}">
            <span class="leader-rank ${index === 0 ? 'is-first' : ''}">${String(index + 1).padStart(2, '0')}</span>
            <i class="leader-swatch" style="background:${color}; box-shadow:0 0 8px ${color}55" aria-hidden="true"></i>
            <span class="leader-copy">
              <span class="leader-id">#${String(creature.id).padStart(4, '0')}</span>
              <span class="leader-meta">GEN ${creature.generation} · ${creature.kills} KILLS</span>
            </span>
            <span class="leader-value">E ${Math.round(creature.energy)}<small>${Math.round(creature.energy / Math.max(1, creature.genes.reproThreshold) * 100)}% TH</small></span>
          </button>`;
      })
      .join('');
  }

  /* -------------------------------------------------------------- telemetry */

  function updateLiveUI() {
    const telemetry = sim.getTelemetry();
    state.telemetry = telemetry;
    state.extinct = telemetry.extinct;
    refs.statTime.textContent = formatTick(telemetry.tick);
    refs.statTime.title = `${telemetry.tick.toLocaleString('en-US')} units`;
    refs.statPopulation.textContent = String(telemetry.population);
    refs.statGeneration.textContent = telemetry.avgGeneration.toFixed(2);
    refs.statGeneration.title = `峰值世代 ${telemetry.peakGeneration}`;
    updatePhaseUI(telemetry);
    refs.metricEnergy.textContent = telemetry.avgEnergy.toFixed(1);
    refs.metricDiversity.textContent = telemetry.diversity.toFixed(1);
    refs.metricLearning.textContent = formatTick(Math.round(telemetry.avgBrainUpdates));
    refs.metricBirths.textContent = formatTick(telemetry.births);
    refs.metricDeaths.textContent = formatTick(telemetry.deaths);
    refs.metricAttacks.textContent = formatTick(telemetry.attacks);
    syncZoomReadout();
    if (state.selectedId !== null) updateSpecimen();
    if (telemetry.extinct) handleExtinction();
    if (state.feedDirty) renderFeed();
  }

  function updatePhaseUI(telemetry) {
    let label = '生产者期 · 单一起点';
    let phaseClass = 'is-primordial';
    if (telemetry.phase === 'conflict') {
      label = '跨阈值冲突期';
      phaseClass = 'is-conflict';
    } else if (telemetry.phase === 'cohesion') {
      label = '遗传分化期';
      phaseClass = 'is-cohesion';
    }
    refs.phaseLabel.textContent = label;
    refs.phaseChip.classList.toggle('is-primordial', phaseClass === 'is-primordial');
    refs.phaseChip.classList.toggle('is-cohesion', phaseClass === 'is-cohesion');
    refs.phaseChip.classList.toggle('is-conflict', phaseClass === 'is-conflict');
    refs.phaseChip.title = telemetry.firstConflictTick !== null
      ? `首次跨阈值攻击发生在 T+${formatTick(telemetry.firstConflictTick)}`
      : '尚未发生跨阈值攻击';
  }

  function handleExtinction() {
    if (state.extinctionHandled || !sim.stats.extinct) return;
    state.extinctionHandled = true;
    state.extinct = true;
    setRunning(false);
    refs.extinctOverlay.hidden = false;
    refs.extinctStats.innerHTML = `
      <span>峰值世代<strong>${sim.stats.peakGeneration}</strong></span>
      <span>累计出生<strong>${formatTick(sim.stats.births)}</strong></span>
      <span>累计死亡<strong>${formatTick(sim.stats.deaths)}</strong></span>`;
    refs.extinctCopy.textContent = `最后一个个体在第 ${sim.tick.toLocaleString('en-US')} 个时间单位死亡。遗传信息仍保留在实验历史中。`;
    if (state.selectedId !== null) clearSelection(true);
    addFeed('death', '生态系统进入沉寂', `演化停在 T+${formatTick(sim.tick)}`);
    renderFeed();
    syncRunState();
  }

  function updateAllPanels() {
    updateLiveUI();
    drawPulseChart();
    updateLeaders();
    renderFeed();
  }

  /* ------------------------------------------------------------------ frame */

  function frame(now) {
    const last = state.lastFrame || now;
    const dt = Math.min(0.08, Math.max(0, (now - last) / 1000));
    state.lastFrame = now;

    if (state.running && !sim.stats.extinct) {
      state.accumulator += dt * BASE_TPS * state.timeScale;
      let steps = 0;
      // Allow high multipliers enough steps to make use of a slow frame without
      // letting the ordinary speeds spend a whole frame catching up.
      const maxSteps = state.timeScale >= 20 ? 60 : state.timeScale >= 10 ? 34 : 28;
      while (state.accumulator >= 1 && steps < maxSteps) {
        sim.step();
        renderer.consumeEvents(sim.events);
        ingestEvents(sim.events);
        state.accumulator -= 1;
        steps += 1;
        if (sim.stats.extinct) break;
      }
      if (state.accumulator > 3) state.accumulator = 0;
    }

    renderer.render(sim, dt, now);

    if (now - state.lastUi > 155) {
      state.lastUi = now;
      updateLiveUI();
      if (now - state.lastChart > 480) {
        state.lastChart = now;
        drawPulseChart();
      }
      if (now - state.lastLeaders > 900) {
        state.lastLeaders = now;
        updateLeaders();
      }
    }

    window.requestAnimationFrame(frame);
  }

  /* --------------------------------------------------------------- controls */

  function toggleRunning() {
    if (sim.stats.extinct) {
      reseed(false);
      return;
    }
    setRunning(!state.running);
    if (!state.running) hideHoverCard();
  }

  function stepOnce() {
    if (sim.stats.extinct) return;
    if (state.running) setRunning(false);
    sim.step();
    renderer.consumeEvents(sim.events);
    ingestEvents(sim.events);
    updateAllPanels();
    if (sim.stats.extinct) handleExtinction();
    setRunning(false);
  }

  function reseed(sameSeed = false) {
    const nextSeed = sameSeed ? sim.seed : generateSeed();
    sim.reset(nextSeed);
    sim.setSettings({
      inertia: state.settings.inertia,
      evolutionRate: state.settings.evolutionRate,
      nearThreshold: state.settings.nearThreshold,
      learningEnabled: state.settings.learningEnabled,
      showVision: state.settings.showVision,
    });
    renderer.setSimulation(sim);
    state.accumulator = 0;
    state.extinctionHandled = false;
    state.extinct = false;
    state.feed = [];
    state.feedDirty = false;
    state.leaderSignature = '';
    state.lastBirthFeed = 0;
    state.lastKillFeed = 0;
    state.lastAgeFeed = 0;
    state.selectedId = null;
    hideHoverCard();
    refs.extinctOverlay.hidden = true;
    refs.stage.classList.remove('is-inspecting', 'has-right-card');
    refs.specimenCard.classList.remove('is-right');
    refs.specimenCard.hidden = true;
    refs.seedLabel.textContent = seedLabelText();
    refs.seedLabel.title = `点击复制实验种子 ${sim.seed}；Shift 点击重置可复现当前种子`;
    syncSeedUrl();
    refs.eventFeed.innerHTML = '';
    addFeed(
      'system',
      '始祖细胞已苏醒',
      `生产者型始祖 · ${seedHex(sim.seed)}`,
      0,
    );
    state.running = true;
    syncFollowUI();
    syncZoomReadout();
    syncRunState();
    updateAllPanels();
    updateSpecimen();
    setToast('生态已重新播种');
  }

  function copySeed() {
    const text = String(sim.seed);
    const fallback = () => {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
        setToast('实验种子已复制');
      } catch {
        setToast(`实验种子：${text}`, 4200);
      }
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => setToast('实验种子已复制'))
        .catch(fallback);
    } else {
      fallback();
    }
  }

  function updateHelpScrollCue() {
    if (!refs.helpGrid || !refs.helpScrollCue) return;
    const remaining =
      refs.helpGrid.scrollHeight - refs.helpGrid.clientHeight - refs.helpGrid.scrollTop;
    refs.helpScrollCue.classList.toggle('is-hidden', remaining < 16);
  }

  function openHelp() {
    state.helpOpen = true;
    state.lastFocus = document.activeElement;
    hideHoverCard();
    refs.helpModal.hidden = false;
    refs.helpGrid.scrollTop = 0;
    updateHelpScrollCue();
    refs.closeHelpBtn.focus();
    window.requestAnimationFrame(updateHelpScrollCue);
  }

  function closeHelp() {
    if (!state.helpOpen) return;
    state.helpOpen = false;
    refs.helpModal.hidden = true;
    state.lastFocus?.focus?.();
  }

  /* ----------------------------------------------------------------- setup */

  function bindEvents() {
    refs.playBtn.addEventListener('click', toggleRunning);
    refs.stepBtn.addEventListener('click', stepOnce);
    refs.resetBtn.addEventListener('click', (event) => {
      reseed(event.shiftKey);
    });
    refs.extinctReseedBtn.addEventListener('click', () => reseed(false));

    refs.speedGroup.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-speed]');
      if (!button) return;
      const speed = Number(button.dataset.speed);
      if (![0.5, 1, 2, 4, 10, 20].includes(speed)) return;
      state.timeScale = speed;
      state.settings.timeScale = speed;
      state.accumulator = 0;
      saveSettings();
      syncSpeedControls();
    });

    refs.evolutionSlider.addEventListener('input', () => {
      state.settings.evolutionRate = Number(refs.evolutionSlider.value) / 100;
      sim.setSettings({ evolutionRate: state.settings.evolutionRate });
      refs.evolutionValue.textContent = `${refs.evolutionSlider.value}%`;
      setSliderVisual(refs.evolutionSlider);
      saveSettings();
    });

    refs.inertiaSlider.addEventListener('input', () => {
      state.settings.inertia = Number(refs.inertiaSlider.value) / 100;
      sim.setSettings({ inertia: state.settings.inertia });
      refs.inertiaValue.textContent = state.settings.inertia.toFixed(2);
      setSliderVisual(refs.inertiaSlider);
      saveSettings();
    });

    refs.nearSlider.addEventListener('input', () => {
      state.settings.nearThreshold = Number(refs.nearSlider.value) / 100;
      sim.setSettings({ nearThreshold: state.settings.nearThreshold });
      if (!state.running) sim.refreshPerception();
      refs.nearValue.textContent = state.settings.nearThreshold.toFixed(2);
      setSliderVisual(refs.nearSlider);
      saveSettings();
      if (state.selectedId !== null) updateSpecimen();
    });

    refs.learningToggle.addEventListener('click', () => {
      state.settings.learningEnabled = !state.settings.learningEnabled;
      sim.setSettings({ learningEnabled: state.settings.learningEnabled });
      syncToggles();
      saveSettings();
      setToast(state.settings.learningEnabled ? '在线学习已开启' : '在线学习已暂停');
      if (state.selectedId !== null) updateSpecimen();
    });

    refs.visionToggle.addEventListener('click', () => {
      state.settings.showVision = !state.settings.showVision;
      sim.setSettings({ showVision: state.settings.showVision });
      syncToggles();
      saveSettings();
    });

    refs.zoomInBtn.addEventListener('click', () => {
      renderer.zoomBy(1.22);
      syncZoomReadout();
      syncFollowUI();
    });
    refs.zoomOutBtn.addEventListener('click', () => {
      renderer.zoomBy(1 / 1.22);
      syncZoomReadout();
      syncFollowUI();
    });
    refs.resetViewBtn.addEventListener('click', () => {
      renderer.resetCamera();
      syncFollowUI();
      syncZoomReadout();
    });

    refs.closeSpecimenBtn.addEventListener('click', () => clearSelection());
    refs.followBtn.addEventListener('click', () => {
      if (state.selectedId === null) return;
      const next = !renderer.isFollowing();
      if (next) {
        renderer.focusCreature(state.selectedId, 1.5);
        renderer.setFollow(true);
      } else {
        renderer.setFollow(false);
      }
      syncFollowUI();
      syncZoomReadout();
    });

    refs.neuroTab.addEventListener('click', () => setSpecimenTab('neuro'));
    refs.geneTab.addEventListener('click', () => setSpecimenTab('gene'));

    refs.leaderList.addEventListener('click', (event) => {
      const row = event.target.closest('[data-creature-id]');
      if (!row) return;
      const id = Number(row.dataset.creatureId);
      if (Number.isFinite(id)) selectCreature(id, true);
    });

    refs.seedLabel.addEventListener('click', copySeed);
    refs.helpBtn.addEventListener('click', openHelp);
    refs.closeHelpBtn.addEventListener('click', closeHelp);
    refs.helpDoneBtn.addEventListener('click', closeHelp);
    refs.helpModal.addEventListener('click', (event) => {
      if (event.target.matches('[data-close-modal]')) closeHelp();
    });
    refs.helpGrid.addEventListener('scroll', updateHelpScrollCue, { passive: true });
    window.addEventListener('resize', () => {
      if (state.helpOpen) updateHelpScrollCue();
    });

    window.addEventListener('keydown', (event) => {
      if (state.helpOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeHelp();
        }
        return;
      }
      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
          if (event.key === 'Escape') clearSelection();
          return;
        }
        if (tag === 'BUTTON' && (event.code === 'Space' || event.key === 'Enter')) {
          return;
        }
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.code === 'Space') {
        event.preventDefault();
        toggleRunning();
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        stepOnce();
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        reseed(event.shiftKey);
      } else if (event.key.toLowerCase() === 'v') {
        event.preventDefault();
        refs.visionToggle.click();
      } else if (event.key.toLowerCase() === 'l') {
        event.preventDefault();
        refs.learningToggle.click();
      } else if (event.key === 'Escape') {
        if (!refs.specimenCard.hidden) clearSelection();
      }
    });
  }

  function initialize() {
    syncRangeControls();
    syncToggles();
    syncSpeedControls();
    refs.seedLabel.textContent = seedLabelText();
    refs.seedLabel.title = `点击复制实验种子 ${sim.seed}；Shift 点击重置可复现当前种子`;
    syncSeedUrl();
    refs.actualTps.textContent = `${Math.round(BASE_TPS * state.timeScale)} TICKS / S`;
    refs.chartMax.textContent = `MAX ${MAX_POPULATION}`;
    state.feed = [];
    addFeed(
      'system',
      '始祖细胞已播种',
      `生产者型始祖 · ${seedHex(sim.seed)} · 在等它第一次分裂`,
      0,
    );
    bindEvents();
    setRunning(true);
    updateAllPanels();
    updatePhaseUI(sim.getTelemetry());
    syncFollowUI();
    syncZoomReadout();
    renderer.render(sim, 0.016, performance.now());
    window.requestAnimationFrame(frame);

    window.setTimeout(() => {
      if (!sim.stats.extinct) {
        setToast('单一起点已启动 · 点击个体查看遗传关系与神经网络', 3600);
      }
    }, 1500);
  }

  initialize();

  // A small read-only handle for curious researchers and browser-console experiments.
  window.GroupAndEvolve = Object.freeze({
    get simulation() {
      return sim;
    },
    get renderer() {
      return renderer;
    },
    get tick() {
      return sim.tick;
    },
    get population() {
      return sim.creatures.length;
    },
  });
})();
