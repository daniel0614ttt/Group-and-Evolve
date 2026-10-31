/* Group and Evolve — deterministic artificial-life simulation.
 *
 * One call to step() is one unit of evolutionary time. Every living creature
 * senses, decides, moves, metabolises, perhaps reproduces, perhaps attacks,
 * ages, and possibly dies. A generation is not a round: it is a lineage
 * distance from the single ancestor. Relationships are pairwise genetic
 * distances — there is no preassigned group membership or identity.
 */
(function (root) {
  'use strict';
  const Evo = (root.Evo = root.Evo || {});
  const U = Evo.Utils;
  const clamp = U.clamp;
  const TAU = U.TAU;

  const WORLD = Object.freeze({ width: 1600, height: 1000 });
  const BASE_TPS = 30;
  const MAX_POPULATION = 160;
  const MAX_ENERGY = 220;
  const HISTORY_INTERVAL = 15;
  const HISTORY_LIMIT = 240;
  const DEFAULT_NEAR_THRESHOLD = 0.16;
  const DEFAULT_EVOLUTION_RATE = 0.12;

  const PHYSICS = Object.freeze({
    forceScale: 0.28,
    maxSpeed: 5.6,
    visionRange: 255,
    visionHalfAngle: (142 * Math.PI) / 360, // a 142° forward cone
    attackRange: 100,
    attackHalfAngle: (118 * Math.PI) / 360,
    attackCooldown: 18,
    wallSense: 230,
    wallRestitution: 0.58,
    // A gentle moving medium. It keeps the world alive and makes steering
    // meaningful, while neural thrust remains the dominant way to hunt.
    currentStrength: 0.25,
    currentTimeScale: 0.0019,
  });

  const ANCESTOR_ENERGY = 46;

  // A producer-type founder: weak attack, almost no predatory payoff, strong
  // baseline energy gain, a very low reproduction threshold, but a low chance
  // per attempt. These are starting values only; mutation and selection can
  // turn later generations toward a predatory strategy.
  const ANCESTOR_GENOME = Object.freeze({
    attackDamage: 1.8,
    attackGain: 0.125,
    mass: 1.04,
    energyGrowth: 0.39,
    reproThreshold: 57,
    reproChance: 0.32,
  });

  const GENE_DEFINITIONS = [
    {
      key: 'attackDamage',
      label: '攻击伤害',
      short: '伤害',
      min: 1.5,
      max: 12,
      initMin: 2.5,
      initMax: 6.2,
      digits: 1,
      unit: '',
    },
    {
      key: 'attackGain',
      label: '攻击收益',
      short: '收益',
      min: 0.12,
      max: 0.95,
      initMin: 0.28,
      initMax: 0.68,
      digits: 2,
      unit: '×',
    },
    {
      key: 'mass',
      label: '质量',
      short: '质量',
      min: 0.55,
      max: 2.6,
      initMin: 0.7,
      initMax: 1.85,
      digits: 2,
      unit: '',
    },
    {
      key: 'energyGrowth',
      label: '自然能量增长',
      short: '增能',
      min: 0.045,
      max: 0.42,
      initMin: 0.1,
      initMax: 0.26,
      digits: 3,
      unit: '/t',
    },
    {
      key: 'reproThreshold',
      label: '繁殖阈值',
      short: '阈值',
      min: 55,
      max: 155,
      initMin: 72,
      initMax: 121,
      digits: 0,
      unit: 'E',
    },
    {
      key: 'reproChance',
      label: '繁殖成功率',
      short: '成功率',
      min: 0.08,
      max: 0.95,
      initMin: 0.34,
      initMax: 0.78,
      digits: 2,
      unit: '',
      percent: true,
    },
  ];

  const GENE_BY_KEY = Object.fromEntries(GENE_DEFINITIONS.map((g) => [g.key, g]));

  function normalizeGene(key, value) {
    const def = GENE_BY_KEY[key];
    return U.clamp(U.invLerp(def.min, def.max, value), 0, 1);
  }

  function makeAncestorGenome(rng) {
    const genes = {};
    const jitter = {
      attackDamage: 0.14,
      attackGain: 0.006,
      mass: 0.06,
      energyGrowth: 0.011,
      reproThreshold: 1.5,
      reproChance: 0.028,
    };
    for (const def of GENE_DEFINITIONS) {
      const base = ANCESTOR_GENOME[def.key];
      genes[def.key] = clamp(
        base + rng.gauss() * (jitter[def.key] || 0),
        def.min,
        def.max,
      );
    }
    return genes;
  }

  /** Normalized trait vector used for pairwise genetic distances. */
  function makeGenomeVector(genes) {
    const vector = new Float32Array(GENE_DEFINITIONS.length);
    for (let i = 0; i < GENE_DEFINITIONS.length; i += 1) {
      const definition = GENE_DEFINITIONS[i];
      vector[i] = normalizeGene(definition.key, genes[definition.key]);
    }
    return vector;
  }

  /** RMS distance in normalized gene space; 0 = identical, 1 = opposite ends. */
  function vectorDistance(a, b) {
    let sum = 0;
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i += 1) {
      const difference = a[i] - b[i];
      sum += difference * difference;
    }
    return length ? Math.sqrt(sum / length) : 0;
  }

  function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    if (max === min) {
      return { h: 0, s: 0, l: lightness };
    }
    const delta = max - min;
    const saturation =
      lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue;
    if (max === r) {
      hue = (g - b) / delta + (g < b ? 6 : 0);
    } else if (max === g) {
      hue = (b - r) / delta + 2;
    } else {
      hue = (r - g) / delta + 4;
    }
    return { h: (hue * 60) % 360, s: saturation, l: lightness };
  }

  /**
   * Continuous phenotype colour derived from the six normalized genes.
   * No group labels are involved: similar genomes necessarily land on similar
   * colours. Green/cyan channels express producer traits, red channels express
   * predation, and blue channels express reproduction.
   */
  function rawGenomeColor(genes) {
    const damage = normalizeGene('attackDamage', genes.attackDamage);
    const gain = normalizeGene('attackGain', genes.attackGain);
    const mass = normalizeGene('mass', genes.mass);
    const growth = normalizeGene('energyGrowth', genes.energyGrowth);
    const threshold = normalizeGene('reproThreshold', genes.reproThreshold);
    const chance = normalizeGene('reproChance', genes.reproChance);
    const predation = clamp(0.72 * damage + 0.28 * gain, 0, 1);
    const production = growth;
    const reproduction = clamp(0.55 * chance + 0.45 * (1 - threshold), 0, 1);

    const r = clamp(0.14 + 0.62 * predation + 0.16 * reproduction + 0.04 * mass, 0, 1);
    const g = clamp(
      0.16 + 0.58 * production + 0.14 * predation + 0.08 * reproduction + 0.04 * mass,
      0,
      1,
    );
    const b = clamp(
      0.16 + 0.58 * reproduction + 0.14 * production + 0.06 * (1 - predation) + 0.03 * mass,
      0,
      1,
    );
    const hsl = rgbToHsl(r, g, b);
    const saturation = clamp(hsl.s * 1.14 + 0.12, 0.48, 0.84);
    const lightness = clamp(0.5 + (hsl.l - 0.5) * 0.65 + 0.02 * mass, 0.46, 0.64);
    return {
      h: hsl.h,
      s: saturation,
      l: lightness,
      mass,
    };
  }

  const COLOR_BASE = rawGenomeColor(ANCESTOR_GENOME);
  const HUE_CONTRAST = 3.2;
  const SATURATION_CONTRAST = 1.25;
  const LIGHTNESS_CONTRAST = 1.45;

  /**
   * A continuous, fixed genotype → colour function. Contrast is expanded
   * linearly around the producer baseline so real gene drift is visible, while
   * arbitrarily similar genomes still land on nearby colours.
   */
  function genomeColor(genes) {
    const raw = rawGenomeColor(genes);
    let hueDelta = U.mod(raw.h - COLOR_BASE.h + 540, 360) - 180;
    const h = U.mod(COLOR_BASE.h + hueDelta * HUE_CONTRAST, 360);
    const s = clamp(
      COLOR_BASE.s + (raw.s - COLOR_BASE.s) * SATURATION_CONTRAST,
      0.45,
      0.88,
    );
    const l = clamp(
      COLOR_BASE.l + (raw.l - COLOR_BASE.l) * LIGHTNESS_CONTRAST + (raw.mass - 0.24) * 0.035,
      0.45,
      0.67,
    );
    return {
      h,
      s,
      l,
      css: `hsl(${h.toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%)`,
    };
  }

  function mutateGenome(parent, rate, rng) {
    const genes = { ...parent };
    if (rate <= 0) return genes;
    for (const def of GENE_DEFINITIONS) {
      if (rng.next() < Math.min(0.9, rate * 1.65)) {
        const sigma = (def.max - def.min) * (0.035 + rate * 0.13);
        genes[def.key] += rng.gauss() * sigma;
      }
      if (rng.next() < rate * 0.028) {
        genes[def.key] += rng.gauss() * (def.max - def.min) * 0.26;
      }
      genes[def.key] = clamp(genes[def.key], def.min, def.max);
    }
    return genes;
  }

  function deriveBody(genes, rng) {
    return {
      mass: genes.mass,
      radius: 6.3 + genes.mass * 4.55,
      maxHealth: 29 + genes.mass * 31,
      longevity: Math.round(900 + genes.mass * 300 + rng.range(-90, 220)),
    };
  }

  class Simulation {
    constructor(options = {}) {
      this.world = WORLD;
      this.baseTps = BASE_TPS;
      this.maxPopulation = MAX_POPULATION;
      this.settings = {
        inertia: options.inertia ?? 0.9,
        evolutionRate: options.evolutionRate ?? DEFAULT_EVOLUTION_RATE,
        nearThreshold: options.nearThreshold ?? DEFAULT_NEAR_THRESHOLD,
        learningEnabled: options.learningEnabled !== false,
        showVision: options.showVision !== false,
      };
      this.seed = options.seed ?? 20251018;
      this.initialPopulation = 1;
      this.reset(this.seed);
    }

    reset(seed = this.seed) {
      this.seed = seed >>> 0;
      this.initialPopulation = 1;
      this.rng = new U.RNG(this.seed ^ 0x6a09e667);
      this.tick = 0;
      this.creatures = [];
      this.events = [];
      this.history = [];
      this.nextCreatureId = 1;
      this.stats = {
        births: 0,
        deaths: 0,
        attacks: 0,
        kills: 0,
        firstConflictTick: null,
        peakPopulation: 0,
        peakGeneration: 1,
        extinct: false,
      };
      this._extinctionNotified = false;

      const genes = makeAncestorGenome(this.rng);
      this._spawnAncestor(genes);

      this.stats.peakPopulation = 1;
      this._recordHistory();
      this.events.push({
        type: 'seed',
        tick: this.tick,
        count: 1,
      });
      return this;
    }

    reseed(seed) {
      const nextSeed = seed ?? ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
      return this.reset(nextSeed);
    }

    setSettings(patch) {
      if (!patch) return;
      if (Number.isFinite(patch.inertia)) {
        this.settings.inertia = clamp(patch.inertia, 0, 0.985);
      }
      if (Number.isFinite(patch.evolutionRate)) {
        this.settings.evolutionRate = clamp(patch.evolutionRate, 0, 1);
      }
      if (Number.isFinite(patch.nearThreshold)) {
        this.settings.nearThreshold = clamp(patch.nearThreshold, 0, 0.5);
      }
      if (typeof patch.learningEnabled === 'boolean') {
        this.settings.learningEnabled = patch.learningEnabled;
        for (const creature of this.creatures) {
          creature.brain.learningEnabled = patch.learningEnabled;
        }
      }
      if (typeof patch.showVision === 'boolean') {
        this.settings.showVision = patch.showVision;
      }
    }

    _spawnAncestor(genes) {
      const body = deriveBody(genes, this.rng);
      const color = genomeColor(genes);
      const angle = this.rng.range(0, TAU);
      const x = WORLD.width / 2 + this.rng.range(-80, 80);
      const y = WORLD.height / 2 + this.rng.range(-60, 60);
      const speed = this.rng.range(0.16, 0.42);
      const creature = {
        id: this.nextCreatureId++,
        hue: color.h,
        saturation: color.s,
        lightness: color.l,
        colorCss: color.css,
        generation: 1,
        x,
        y,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed,
        headingX: Math.cos(angle),
        headingY: Math.sin(angle),
        speed,
        health: body.maxHealth,
        maxHealth: body.maxHealth,
        energy: ANCESTOR_ENERGY,
        mass: body.mass,
        radius: body.radius,
        genes,
        genomeVector: makeGenomeVector(genes),
        maxLife: body.longevity,
        remainingLife: body.longevity,
        age: 0,
        attackCooldown: 0,
        reproCooldown: 0,
        children: 0,
        kills: 0,
        attacks: 0,
        alive: true,
        spawnTick: this.tick,
        brain: new Evo.NeuralBrain(this.rng),
        perception: {
          count: 0,
          nearestDistance: Infinity,
          nearestId: null,
          nearCount: 0,
          farCount: 0,
          nearestFarDistance: Infinity,
          neighbors: [],
        },
        lastDecision: null,
        nearSuppressed: false,
        forceForward: 0,
        forceLateral: 0,
        _input: new Float32Array(Evo.BrainSpec.INPUT_SIZE),
      };
      creature.brain.learningEnabled = this.settings.learningEnabled;
      this.creatures.push(creature);
      return creature;
    }

    _spawnChild(parent) {
      const rate = this.settings.evolutionRate;
      const genes = mutateGenome(parent.genes, rate, this.rng);
      const body = deriveBody(genes, this.rng);
      const angle = this.rng.range(0, TAU);
      const distance = parent.radius + body.radius + this.rng.range(5, 26);
      const margin = body.radius + 10;
      const x = clamp(parent.x + Math.cos(angle) * distance, margin, WORLD.width - margin);
      const y = clamp(parent.y + Math.sin(angle) * distance, margin, WORLD.height - margin);
      const vx = parent.velocityX * 0.32 + Math.cos(angle) * this.rng.range(0.08, 0.65);
      const vy = parent.velocityY * 0.32 + Math.sin(angle) * this.rng.range(0.08, 0.65);
      const genomeVector = makeGenomeVector(genes);
      const color = genomeColor(genes);
      const child = {
        id: this.nextCreatureId++,
        hue: color.h,
        saturation: color.s,
        lightness: color.l,
        colorCss: color.css,
        generation: parent.generation + 1,
        x,
        y,
        velocityX: vx,
        velocityY: vy,
        headingX: Math.cos(angle),
        headingY: Math.sin(angle),
        speed: Math.hypot(vx, vy),
        health: body.maxHealth,
        maxHealth: body.maxHealth,
        energy: clamp(parent.genes.reproThreshold * 0.4 + 4, 16, 76),
        mass: body.mass,
        radius: body.radius,
        genes,
        genomeVector,
        maxLife: body.longevity,
        remainingLife: body.longevity,
        age: 0,
        attackCooldown: this.rng.int(0, PHYSICS.attackCooldown),
        reproCooldown: this.rng.int(55, 82),
        children: 0,
        kills: 0,
        attacks: 0,
        alive: true,
        spawnTick: this.tick,
        brain: parent.brain.clone(rate, this.rng),
        perception: {
          count: 0,
          nearestDistance: Infinity,
          nearestId: null,
          nearCount: 0,
          farCount: 0,
          nearestFarDistance: Infinity,
          neighbors: [],
        },
        lastDecision: null,
        nearSuppressed: false,
        forceForward: 0,
        forceLateral: 0,
        _input: new Float32Array(Evo.BrainSpec.INPUT_SIZE),
      };
      child.brain.learningEnabled = this.settings.learningEnabled;
      this.creatures.push(child);
      this.stats.births += 1;
      this.stats.peakGeneration = Math.max(this.stats.peakGeneration, child.generation);
      parent.children += 1;
      parent.brain.addReward(0.9);
      this.events.push({
        type: 'birth',
        tick: this.tick,
        id: child.id,
        parentId: parent.id,
        x,
        y,
        hue: child.hue,
        generation: child.generation,
      });
      return child;
    }

    _affinitySignal(distance) {
      const threshold = this.settings.nearThreshold;
      if (threshold <= 1e-6) {
        return distance <= 1e-6 ? 1 : -1;
      }
      if (distance <= threshold) {
        return clamp(1 - distance / threshold, 0, 1);
      }
      return -clamp((distance - threshold) / Math.max(1e-6, 1 - threshold), 0, 1);
    }

    /**
     * Assemble the creature's egocentric 60-value perception vector.
     * Self block: 18 values. Then up to six front-facing neighbours: 7 each.
     * Neighbour slot 5 is a threshold-relative genetic-affinity signal; self
     * slot 16 is the fraction of visible neighbours inside the threshold.
     */
    _sense(creature) {
      const input = creature._input;
      const spec = Evo.BrainSpec;
      const { width, height } = WORLD;
      const r = creature.radius;
      const hx = creature.headingX;
      const hy = creature.headingY;
      const rightX = -hy;
      const rightY = hx;
      const speed = Math.hypot(creature.velocityX, creature.velocityY);
      creature.speed = speed;

      input[0] = 1;
      input[1] = clamp(creature.energy / MAX_ENERGY, 0, 1);
      input[2] = clamp(creature.health / creature.maxHealth, 0, 1);
      input[3] = clamp(creature.remainingLife / creature.maxLife, 0, 1);
      input[4] = clamp(speed / PHYSICS.maxSpeed, 0, 1);
      input[5] = normalizeGene('mass', creature.mass);
      input[6] = normalizeGene('attackDamage', creature.genes.attackDamage);
      input[7] = normalizeGene('attackGain', creature.genes.attackGain);
      input[8] = normalizeGene('reproThreshold', creature.genes.reproThreshold);
      input[9] = clamp(creature.genes.reproChance, 0, 1);
      input[10] = creature.attackCooldown / PHYSICS.attackCooldown;
      input[11] = clamp((creature.x - r) / PHYSICS.wallSense, 0, 1);
      input[12] = clamp((width - creature.x - r) / PHYSICS.wallSense, 0, 1);
      input[13] = clamp((creature.y - r) / PHYSICS.wallSense, 0, 1);
      input[14] = clamp((height - creature.y - r) / PHYSICS.wallSense, 0, 1);
      input[15] = 0; // filled after neighbour scan
      input[16] = 0; // fraction of visible neighbours inside the genetic threshold
      input[17] = clamp(creature.energy / Math.max(1, creature.genes.reproThreshold), 0, 1.5) / 1.5;

      const candidates = [];
      const cosLimit = Math.cos(PHYSICS.visionHalfAngle);
      const rangeSq = PHYSICS.visionRange * PHYSICS.visionRange;
      for (let i = 0; i < this.creatures.length; i += 1) {
        const other = this.creatures[i];
        if (other === creature || !other.alive || other.health <= 0) continue;
        const dx = other.x - creature.x;
        const dy = other.y - creature.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > rangeSq) continue;
        const dist = Math.sqrt(distSq) || 0.0001;
        const forward = (dx * hx + dy * hy) / dist;
        if (forward < cosLimit) continue;
        candidates.push({ other, dx, dy, dist, distSq });
      }
      candidates.sort((a, b) => a.distSq - b.distSq);

      const visible = Math.min(spec.MAX_NEIGHBORS, candidates.length);
      const startAt = spec.SELF_INPUTS;
      const neighborLength = spec.MAX_NEIGHBORS * spec.NEIGHBOR_INPUTS;
      input.fill(0, startAt, startAt + neighborLength);
      let nearCount = 0;
      let farCount = 0;
      let nearestFarDistance = Infinity;
      const neighbors = [];

      for (let n = 0; n < visible; n += 1) {
        const entry = candidates[n];
        const other = entry.other;
        const offset = startAt + n * spec.NEIGHBOR_INPUTS;
        const forwardDist = (entry.dx * hx + entry.dy * hy) / PHYSICS.visionRange;
        const lateralDist = (entry.dx * rightX + entry.dy * rightY) / PHYSICS.visionRange;
        const relVx = other.velocityX - creature.velocityX;
        const relVy = other.velocityY - creature.velocityY;
        const relForward = (relVx * hx + relVy * hy) / PHYSICS.maxSpeed;
        const relLateral = (relVx * rightX + relVy * rightY) / PHYSICS.maxSpeed;
        const geneticDistance = vectorDistance(creature.genomeVector, other.genomeVector);
        const isNear = geneticDistance <= this.settings.nearThreshold;
        if (isNear) {
          nearCount += 1;
        } else {
          farCount += 1;
          nearestFarDistance = Math.min(nearestFarDistance, entry.dist);
        }
        input[offset] = clamp(forwardDist, 0, 1);
        input[offset + 1] = clamp(lateralDist, -1, 1);
        input[offset + 2] = clamp(relForward, -1, 1);
        input[offset + 3] = clamp(relLateral, -1, 1);
        input[offset + 4] = clamp(other.health / other.maxHealth, 0, 1);
        input[offset + 5] = this._affinitySignal(geneticDistance);
        input[offset + 6] = normalizeGene('mass', other.mass);
        neighbors.push({
          id: other.id,
          distance: geneticDistance,
          near: isNear,
        });
      }
      input[15] = visible / spec.MAX_NEIGHBORS;
      input[16] = visible > 0 ? nearCount / visible : 0;

      creature.perception = {
        count: visible,
        nearestDistance: visible ? candidates[0].dist : Infinity,
        nearestId: visible ? candidates[0].other.id : null,
        nearCount,
        farCount,
        nearestFarDistance,
        neighbors,
      };
    }

    /** Recompute perception without advancing time (e.g. after changing the
     * genetic threshold while paused). */
    refreshPerception() {
      for (const creature of this.creatures) {
        if (creature.alive) this._sense(creature);
      }
    }

    /** Smooth, slowly moving ambient current. Bounded to one unit. */
    sampleCurrent(x, y, tick = this.tick) {
      const t = tick * PHYSICS.currentTimeScale;
      const nx = x / WORLD.width - 0.5;
      const ny = y / WORLD.height - 0.5;
      let fx =
        -ny * 1.25 +
        0.34 * Math.sin(y * 0.0063 + t * 2.1) +
        0.2 * Math.sin(t * 0.62 + x * 0.0022);
      let fy =
        nx * 0.92 +
        0.34 * Math.cos(x * 0.0057 - t * 1.7) +
        0.2 * Math.cos(t * 0.48 + y * 0.002);
      const magnitude = Math.hypot(fx, fy);
      if (magnitude > 1) {
        fx /= magnitude;
        fy /= magnitude;
      }
      return {
        x: fx * PHYSICS.currentStrength,
        y: fy * PHYSICS.currentStrength,
      };
    }

    _move(creature, decision) {
      const inertia = this.settings.inertia;
      let fForward = decision.forceForward;
      let fLateral = decision.forceLateral;
      const magnitude = Math.hypot(fForward, fLateral);
      if (magnitude > 1) {
        fForward /= magnitude;
        fLateral /= magnitude;
      }
      creature.forceForward = fForward;
      creature.forceLateral = fLateral;

      const hx = creature.headingX;
      const hy = creature.headingY;
      const forceX = hx * fForward + -hy * fLateral;
      const forceY = hy * fForward + hx * fLateral;
      const acceleration = PHYSICS.forceScale / creature.mass;
      const current = this.sampleCurrent(creature.x, creature.y, this.tick);

      creature.velocityX =
        creature.velocityX * inertia + forceX * acceleration + current.x;
      creature.velocityY =
        creature.velocityY * inertia + forceY * acceleration + current.y;

      const speed = Math.hypot(creature.velocityX, creature.velocityY);
      if (speed > PHYSICS.maxSpeed) {
        const scale = PHYSICS.maxSpeed / speed;
        creature.velocityX *= scale;
        creature.velocityY *= scale;
      }
      creature.speed = Math.min(speed, PHYSICS.maxSpeed);
      creature.x += creature.velocityX;
      creature.y += creature.velocityY;

      // Elastic-ish walls keep the closed ecosystem bounded.
      const margin = creature.radius;
      if (creature.x < margin) {
        creature.x = margin;
        creature.velocityX = Math.abs(creature.velocityX) * PHYSICS.wallRestitution;
      } else if (creature.x > WORLD.width - margin) {
        creature.x = WORLD.width - margin;
        creature.velocityX = -Math.abs(creature.velocityX) * PHYSICS.wallRestitution;
      }
      if (creature.y < margin) {
        creature.y = margin;
        creature.velocityY = Math.abs(creature.velocityY) * PHYSICS.wallRestitution;
      } else if (creature.y > WORLD.height - margin) {
        creature.y = WORLD.height - margin;
        creature.velocityY = -Math.abs(creature.velocityY) * PHYSICS.wallRestitution;
      }

      if (Math.hypot(creature.velocityX, creature.velocityY) > 0.045) {
        const inv = 1 / Math.hypot(creature.velocityX, creature.velocityY);
        creature.headingX = creature.velocityX * inv;
        creature.headingY = creature.velocityY * inv;
      }
    }

    /** Mild volume exclusion keeps organisms legible without changing the
     * neural or genetic rules. Overlap is resolved with equal, gentle pushes. */
    _separateBodies() {
      const creatures = this.creatures;
      for (let i = 0; i < creatures.length; i += 1) {
        const a = creatures[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < creatures.length; j += 1) {
          const b = creatures[j];
          if (!b.alive) continue;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let distSq = dx * dx + dy * dy;
          const minDist = (a.radius + b.radius) * 0.82;
          if (distSq >= minDist * minDist) continue;
          let dist = Math.sqrt(distSq);
          if (dist < 0.0001) {
            const angle = this.rng.range(0, TAU);
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            dist = 1;
            distSq = 1;
          }
          const push = (minDist - Math.sqrt(distSq)) * 0.24;
          const nx = dx / dist;
          const ny = dy / dist;
          const aRatio = b.mass / (a.mass + b.mass);
          const bRatio = a.mass / (a.mass + b.mass);
          a.x -= nx * push * aRatio;
          a.y -= ny * push * aRatio;
          b.x += nx * push * bRatio;
          b.y += ny * push * bRatio;
          const mA = a.radius + 1;
          const mB = b.radius + 1;
          a.x = clamp(a.x, mA, WORLD.width - mA);
          a.y = clamp(a.y, mA, WORLD.height - mA);
          b.x = clamp(b.x, mB, WORLD.width - mB);
          b.y = clamp(b.y, mB, WORLD.height - mB);
        }
      }
    }

    _metaboliseAndReproduce(creature) {
      creature.energy = Math.min(
        MAX_ENERGY,
        creature.energy + creature.genes.energyGrowth * this.rng.range(0.82, 1.18),
      );

      if (creature.reproCooldown > 0) return;
      if (creature.energy < creature.genes.reproThreshold) return;
      if (this.creatures.length >= this.maxPopulation) return;

      if (!this.rng.chance(creature.genes.reproChance)) {
        // A failed attempt costs time rather than energy.
        creature.reproCooldown = this.rng.int(12, 28);
        creature.brain.addReward(-0.035);
        this.events.push({
          type: 'reproFail',
          tick: this.tick,
          id: creature.id,
          x: creature.x,
          y: creature.y,
        });
        return;
      }

      const cost = creature.genes.reproThreshold * 0.42 + 8;
      if (creature.energy < cost) {
        creature.reproCooldown = 6;
        return;
      }
      creature.energy -= cost;
      const child = this._spawnChild(creature);
      creature.reproCooldown = this.rng.int(60, 92);
      this.events.push({
        type: 'birthBurst',
        tick: this.tick,
        x: child.x,
        y: child.y,
        hue: child.hue,
        id: child.id,
      });
    }

    _findAttackTarget(creature) {
      const hx = creature.headingX;
      const hy = creature.headingY;
      const cosLimit = Math.cos(PHYSICS.attackHalfAngle);
      const threshold = this.settings.nearThreshold;
      let best = null;
      let bestDistSq = Infinity;
      let bestGeneticDistance = 0;
      let nearInRange = false;
      for (let i = 0; i < this.creatures.length; i += 1) {
        const other = this.creatures[i];
        if (other === creature || !other.alive || other.health <= 0) continue;
        // Newborns get one tick of grace so they are never hit before acting.
        if (other.spawnTick === this.tick) continue;
        const dx = other.x - creature.x;
        const dy = other.y - creature.y;
        const distSq = dx * dx + dy * dy;
        const reach = PHYSICS.attackRange + creature.radius + other.radius;
        if (distSq > reach * reach) continue;
        const dist = Math.sqrt(distSq) || 0.0001;
        if ((dx * hx + dy * hy) / dist < cosLimit) continue;

        const geneticDistance = vectorDistance(creature.genomeVector, other.genomeVector);
        if (geneticDistance <= threshold) {
          nearInRange = true;
          continue;
        }
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          best = other;
          bestGeneticDistance = geneticDistance;
        }
      }
      creature.nearInAttackRange = nearInRange;
      creature.lastTargetGeneticDistance = best ? bestGeneticDistance : 0;
      return best;
    }

    _attack(creature) {
      if (creature.attackCooldown > 0) return;
      const target = this._findAttackTarget(creature);
      if (!target) {
        creature.nearSuppressed = Boolean(creature.nearInAttackRange);
        return;
      }
      creature.nearSuppressed = false;

      const damage = creature.genes.attackDamage * this.rng.range(0.84, 1.16);
      const cost = 0.38 + damage * 0.055;
      if (creature.energy < cost) return;

      creature.energy -= cost;
      creature.attackCooldown = PHYSICS.attackCooldown;
      target.health -= damage;
      const steal = Math.min(target.energy, damage * creature.genes.attackGain);
      target.energy = Math.max(0, target.energy - steal);
      creature.energy = Math.min(MAX_ENERGY, creature.energy + steal);
      creature.attacks += 1;
      this.stats.attacks += 1;

      const attackerReward = steal * 0.2 + damage * 0.025 - cost * 0.08;
      creature.brain.addReward(attackerReward);
      target.brain.addReward(-(steal * 0.16 + damage * 0.032));

      let killed = false;
      if (target.health <= 0) {
        target.health = 0;
        killed = true;
        creature.kills += 1;
        this.stats.kills += 1;
        target.killedBy = creature.id;
        creature.brain.addReward(0.55);
      }

      const firstConflict = this.stats.firstConflictTick === null;
      if (firstConflict) {
        this.stats.firstConflictTick = this.tick;
        this.events.push({
          type: 'firstConflict',
          tick: this.tick,
          attackerId: creature.id,
          victimId: target.id,
          distance: creature.lastTargetGeneticDistance,
          nearThreshold: this.settings.nearThreshold,
          x1: creature.x,
          y1: creature.y,
          x2: target.x,
          y2: target.y,
        });
      }

      this.events.push({
        type: 'attack',
        tick: this.tick,
        attackerId: creature.id,
        victimId: target.id,
        geneticDistance: creature.lastTargetGeneticDistance,
        x1: creature.x,
        y1: creature.y,
        x2: target.x,
        y2: target.y,
        damage,
        steal,
        killed,
        hue: creature.hue,
        victimHue: target.hue,
      });
    }

    _die(creature, cause) {
      if (!creature.alive) return;
      creature.alive = false;
      creature.brain.addReward(cause === 'attack' ? -1.4 : -1.0);
      creature.brain.terminate(this.rng);
      this.stats.deaths += 1;
      this.events.push({
        type: 'death',
        tick: this.tick,
        id: creature.id,
        cause,
        killerId: creature.killedBy ?? null,
        x: creature.x,
        y: creature.y,
        hue: creature.hue,
        generation: creature.generation,
      });
    }

    step() {
      if (this.stats.extinct) return;
      this.tick += 1;
      this.events = [];

      const actors = this.creatures.slice();
      const decidedAttacks = [];

      // 1 · Age, cool down, orient towards the previous velocity.
      for (const creature of actors) {
        if (!creature.alive) continue;
        creature.attackCooldown = Math.max(0, creature.attackCooldown - 1);
        creature.nearSuppressed = false;
        if (creature.reproCooldown > 0) creature.reproCooldown -= 1;
        creature.age += 1;
        creature.remainingLife -= 1;
        const speed = Math.hypot(creature.velocityX, creature.velocityY);
        if (speed > 0.05) {
          creature.headingX = creature.velocityX / speed;
          creature.headingY = creature.velocityY / speed;
        }
      }

      // 2 · Perceive, decide, and move. The brain learns from the previous
      //     action's accumulated reward during this forward pass.
      for (const creature of actors) {
        if (!creature.alive) continue;
        this._sense(creature);
        const decision = creature.brain.decide(creature._input, this.rng);
        creature.lastDecision = decision;
        this._move(creature, decision);
        if (decision.attackIntent) decidedAttacks.push(creature);
      }

      this._separateBodies();

      // 3 · Energy growth and reproduction.
      for (const creature of actors) {
        if (!creature.alive) continue;
        this._metaboliseAndReproduce(creature);
      }

      // 4 · Attack resolution (after movement, as in the original design).
      for (const creature of decidedAttacks) {
        if (!creature.alive || creature.health <= 0) continue;
        this._attack(creature);
      }

      // 5 · Death, aging and bookkeeping.
      for (const creature of this.creatures) {
        if (!creature.alive) continue;
        if (creature.health <= 0) {
          this._die(creature, 'attack');
        } else if (creature.remainingLife <= 0) {
          this._die(creature, 'age');
        }
      }

      if (this.creatures.some((creature) => creature.alive) === false) {
        this.creatures = [];
      } else {
        this.creatures = this.creatures.filter((creature) => creature.alive);
      }

      this.stats.peakPopulation = Math.max(this.stats.peakPopulation, this.creatures.length);
      if (this.creatures.length === 0) {
        this.stats.extinct = true;
        if (!this._extinctionNotified) {
          this._extinctionNotified = true;
          this.events.push({
            type: 'extinct',
            tick: this.tick,
          });
        }
      }

      if (this.tick % HISTORY_INTERVAL === 0) this._recordHistory();
    }

    _recordHistory() {
      const count = this.creatures.length;
      let avgEnergy = 0;
      let avgGeneration = 0;
      let avgUpdates = 0;
      let avgAge = 0;
      for (const creature of this.creatures) {
        avgEnergy += creature.energy;
        avgGeneration += creature.generation;
        avgUpdates += creature.brain.updates;
        avgAge += creature.age / creature.maxLife;
      }
      if (count > 0) {
        avgEnergy /= count;
        avgGeneration /= count;
        avgUpdates /= count;
        avgAge /= count;
      }
      this.history.push({
        tick: this.tick,
        population: count,
        avgEnergy,
        avgGeneration,
        avgUpdates,
        avgAge,
        attacks: this.stats.attacks,
        births: this.stats.births,
        deaths: this.stats.deaths,
        diversity: this.getDiversity(),
      });
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
    }

    getDiversity() {
      if (this.creatures.length < 2) return 0;
      let total = 0;
      for (const def of GENE_DEFINITIONS) {
        let mean = 0;
        for (const creature of this.creatures) mean += creature.genes[def.key];
        mean /= this.creatures.length;
        let variance = 0;
        for (const creature of this.creatures) {
          const d = (creature.genes[def.key] - mean) / (def.max - def.min);
          variance += d * d;
        }
        total += Math.sqrt(variance / this.creatures.length);
      }
      return (total / GENE_DEFINITIONS.length) * 100;
    }

    getTelemetry() {
      const count = this.creatures.length;
      let energy = 0;
      let generation = 0;
      let ageRatio = 0;
      let learning = 0;
      let speed = 0;
      let attackIntent = 0;
      for (const creature of this.creatures) {
        energy += creature.energy;
        generation += creature.generation;
        ageRatio += creature.age / creature.maxLife;
        learning += creature.brain.updates;
        speed += creature.speed;
        if (creature.lastDecision && creature.lastDecision.attackIntent) attackIntent += 1;
      }
      if (count > 0) {
        energy /= count;
        generation /= count;
        ageRatio /= count;
        learning /= count;
        speed /= count;
        attackIntent /= count;
      }
      let phase = 'primordial';
      if (count > 1) {
        phase = this.stats.firstConflictTick === null ? 'cohesion' : 'conflict';
      }
      return {
        tick: this.tick,
        population: count,
        avgEnergy: energy,
        avgGeneration: generation,
        avgAgeRatio: ageRatio,
        avgBrainUpdates: learning,
        avgSpeed: speed,
        attackIntentRatio: attackIntent,
        diversity: this.getDiversity(),
        phase,
        firstConflictTick: this.stats.firstConflictTick,
        nearThreshold: this.settings.nearThreshold,
        births: this.stats.births,
        deaths: this.stats.deaths,
        attacks: this.stats.attacks,
        kills: this.stats.kills,
        peakPopulation: this.stats.peakPopulation,
        peakGeneration: this.stats.peakGeneration,
        extinct: this.stats.extinct,
      };
    }

    getLeaders(limit = 4) {
      return this.creatures
        .slice()
        .sort(
          (a, b) =>
            b.energy + b.kills * 16 + b.generation * 2 - (a.energy + a.kills * 16 + a.generation * 2),
        )
        .slice(0, limit);
    }

    getCreature(id) {
      return this.creatures.find((creature) => creature.id === id) || null;
    }

    getGeneDefinitions() {
      return GENE_DEFINITIONS;
    }
  }

  Evo.Simulation = Simulation;
  Evo.Physics = PHYSICS;
  Evo.GeneDefinitions = GENE_DEFINITIONS;
  Evo.genomeColor = genomeColor;
  Evo.genomeVector = makeGenomeVector;
  Evo.geneticDistance = vectorDistance;
  Evo.World = WORLD;
  Evo.Constants = {
    BASE_TPS,
    MAX_POPULATION,
    MAX_ENERGY,
    HISTORY_INTERVAL,
    HISTORY_LIMIT,
    DEFAULT_NEAR_THRESHOLD,
    DEFAULT_EVOLUTION_RATE,
  };
})(typeof window !== 'undefined' ? window : globalThis);
