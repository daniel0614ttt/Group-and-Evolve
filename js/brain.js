/* Group and Evolve — tiny online actor-critic brain.
 *
 * A creature sees a small, egocentric slice of the world. A 60 → 24 → 3 MLP
 * turns that perception into two force components (forward / lateral) and an
 * attack logit. Each visible neighbour includes a threshold-relative genetic-affinity
 * signal, so social behaviour can be learned. The shared trunk is trained
 * online with a delayed one-step actor-critic update. Weights are inherited
 * and mutated at reproduction.
 */
(function (root) {
  'use strict';
  const Evo = (root.Evo = root.Evo || {});
  const U = Evo.Utils;
  const clamp = U.clamp;

  const MAX_NEIGHBORS = 6;
  const NEIGHBOR_INPUTS = 7;
  const SELF_INPUTS = 18;
  const INPUT_SIZE = SELF_INPUTS + MAX_NEIGHBORS * NEIGHBOR_INPUTS; // 60
  const HIDDEN_SIZE = 24;
  const OUTPUT_SIZE = 3;
  const EXPLORATION_SIGMA = 0.18;
  const GAMMA = 0.965;

  const SIGMOID = (x) => 1 / (1 + Math.exp(-x));

  class NeuralBrain {
    constructor(rng, options = {}) {
      this.inputSize = INPUT_SIZE;
      this.hiddenSize = HIDDEN_SIZE;
      this.maxNeighbors = MAX_NEIGHBORS;
      this.neighborInputs = NEIGHBOR_INPUTS;

      this.w1 = new Float32Array(HIDDEN_SIZE * INPUT_SIZE);
      this.b1 = new Float32Array(HIDDEN_SIZE);
      this.wForce = new Float32Array(2 * HIDDEN_SIZE);
      this.bForce = new Float32Array(2);
      this.wAttack = new Float32Array(HIDDEN_SIZE);
      this.bAttack = 0;
      this.wValue = new Float32Array(HIDDEN_SIZE);
      this.bValue = 0;

      this.updates = 0;
      this.mutations = 0;
      this.rewardEMA = 0;
      this.lastAdvantage = 0;
      this.lastTD = 0;
      this.lastReward = 0;
      this.lastInput = new Float32Array(INPUT_SIZE);
      this.lastHidden = new Float32Array(HIDDEN_SIZE);
      this.lastHiddenPre = new Float32Array(HIDDEN_SIZE);
      this.lastZForce = new Float32Array(2);
      this.lastMeanForce = new Float32Array(2);
      this.lastActionForce = new Float32Array(2);
      this.forceForward = 0;
      this.forceLateral = 0;
      this.attackProbability = 0.5;
      this.attackIntent = false;
      this.valueEstimate = 0;
      this.sigma = EXPLORATION_SIGMA;
      this.gamma = GAMMA;
      this.rewardAccum = 0;
      this.pending = null;
      this.learningEnabled = true;

      // Scratch buffers reused by the backward pass.
      this._dHidden = new Float32Array(HIDDEN_SIZE);
      this._gForce = new Float32Array(2);

      if (options.empty === true) return;

      const inScale = Math.sqrt(2 / (INPUT_SIZE + HIDDEN_SIZE));
      for (let i = 0; i < this.w1.length; i += 1) {
        this.w1[i] = rng.gauss() * inScale;
      }
      for (let i = 0; i < HIDDEN_SIZE; i += 1) {
        this.b1[i] = rng.gauss() * 0.035;
      }
      for (let i = 0; i < this.wForce.length; i += 1) {
        this.wForce[i] = rng.gauss() * 0.09;
      }
      for (let i = 0; i < this.wAttack.length; i += 1) {
        this.wAttack[i] = rng.gauss() * 0.09;
      }
      for (let i = 0; i < this.wValue.length; i += 1) {
        this.wValue[i] = rng.gauss() * 0.04;
      }
      this.bAttack = rng.gauss() * 0.18;
      this.bValue = 0;
      this.attackProbability = SIGMOID(this.bAttack);
    }

    /** Copy this brain's weights into a new, lightly mutated brain. */
    clone(mutationRate, rng) {
      const child = new NeuralBrain(rng, { empty: true });
      child.w1.set(this.w1);
      child.b1.set(this.b1);
      child.wForce.set(this.wForce);
      child.bForce.set(this.bForce);
      child.wAttack.set(this.wAttack);
      child.bAttack = this.bAttack;
      child.wValue.set(this.wValue);
      child.bValue = this.bValue;
      child.rewardEMA = this.rewardEMA * 0.35;
      child.updates = 0;
      child.mutations = this.mutations;
      child.mutate(mutationRate, rng);
      return child;
    }

    mutate(rate, rng) {
      if (!(rate > 0)) return;
      const changed = (probability) => rng.next() < probability;

      this._mutateArray(this.w1, 0.28 + rate * 0.22, rate, rng, changed);
      this._mutateArray(this.b1, 0.3, rate, rng, changed);
      this._mutateArray(this.wForce, 0.3, rate, rng, changed);
      this._mutateArray(this.bForce, 0.3, rate, rng, changed);
      this._mutateArray(this.wAttack, 0.3, rate, rng, changed);
      this._mutateArray(this.wValue, 0.18, rate, rng, changed);

      if (changed(0.2 + rate * 0.25)) {
        this.bAttack += rng.gauss() * (0.12 + rate * 0.32);
      }
      if (changed(0.12 + rate * 0.18)) {
        this.bValue += rng.gauss() * (0.12 + rate * 0.3);
      }
      this.bAttack = clamp(this.bAttack, -4, 4);
      this.bValue = clamp(this.bValue, -4, 4);

      if (rng.next() < 0.08 + rate * 0.08) {
        const arrays = [this.w1, this.wForce, this.wAttack];
        const arr = arrays[rng.int(0, arrays.length - 1)];
        const index = rng.int(0, arr.length - 1);
        arr[index] = clamp(arr[index] + rng.gauss() * (0.35 + rate * 0.9), -5, 5);
        this.mutations += 1;
      }
      this.mutations += 1;
    }

    _mutateArray(array, probability, rate, rng, changed) {
      const sigma = 0.032 + rate * 0.16;
      for (let i = 0; i < array.length; i += 1) {
        if (changed(probability * (0.25 + rate * 0.75))) {
          array[i] = clamp(array[i] + rng.gauss() * sigma, -5, 5);
        }
      }
    }

    /** Forward pass. Leaves activations in scratch fields for the inspector. */
    _forward(input) {
      const { w1, b1, wForce, bForce, wAttack, bAttack, wValue, bValue } = this;
      const hidden = this.lastHidden;
      const hiddenPre = this.lastHiddenPre;

      for (let h = 0; h < HIDDEN_SIZE; h += 1) {
        let sum = b1[h];
        const offset = h * INPUT_SIZE;
        for (let i = 0; i < INPUT_SIZE; i += 1) {
          sum += w1[offset + i] * input[i];
        }
        hiddenPre[h] = sum;
        hidden[h] = Math.tanh(sum);
      }

      let zf0 = bForce[0];
      let zf1 = bForce[1];
      let za = bAttack;
      let value = bValue;
      for (let h = 0; h < HIDDEN_SIZE; h += 1) {
        const v = hidden[h];
        zf0 += wForce[h] * v;
        zf1 += wForce[HIDDEN_SIZE + h] * v;
        za += wAttack[h] * v;
        value += wValue[h] * v;
      }

      this.lastZForce[0] = zf0;
      this.lastZForce[1] = zf1;
      this.lastMeanForce[0] = Math.tanh(zf0);
      this.lastMeanForce[1] = Math.tanh(zf1);
      const p = SIGMOID(za);
      this.attackProbability = p;
      this.valueEstimate = value;
      this._lastAttackLogit = za;
      return { zf0, zf1, za, p, value };
    }

    /**
     * Take one decision from a normalized input vector. Also settles the
     * previous transition once the new state's value is known (one-step
     * delayed actor-critic).
     */
    decide(input, rng) {
      this.lastInput.set(input);
      const out = this._forward(input);

      if (this.pending && this.learningEnabled) {
        this._learn(this.pending, this.rewardAccum, out.value, false);
      }
      this.rewardAccum = 0;

      const rawForward = out.zf0 + rng.gauss() * this.sigma;
      const rawLateral = out.zf1 + rng.gauss() * this.sigma;
      const forceForward = clamp(Math.tanh(rawForward), -1, 1);
      const forceLateral = clamp(Math.tanh(rawLateral), -1, 1);
      const attackIntent = rng.next() < out.p;

      this.forceForward = forceForward;
      this.forceLateral = forceLateral;
      this.lastActionForce[0] = forceForward;
      this.lastActionForce[1] = forceLateral;
      this.attackIntent = attackIntent;

      this.pending = {
        input: Float32Array.from(input),
        hidden: Float32Array.from(this.lastHidden),
        zf0: out.zf0,
        zf1: out.zf1,
        rawForward,
        rawLateral,
        attackLogit: out.za,
        attackProbability: out.p,
        attackIntent,
        value: out.value,
        sigma: this.sigma,
      };
      return {
        forceForward,
        forceLateral,
        attackIntent,
        attackProbability: out.p,
      };
    }

    /** Give the previous action credit (or blame) for what just happened. */
    addReward(amount) {
      if (!Number.isFinite(amount)) return;
      this.rewardAccum += amount;
    }

    /** Final update when a creature dies; there is no bootstrap value. */
    terminate(rng) {
      if (this.pending && this.learningEnabled) {
        this._learn(this.pending, this.rewardAccum, 0, true);
      }
      this.rewardAccum = 0;
      this.pending = null;
    }

    _learn(prev, reward, nextValue, terminal) {
      const advantageRaw = reward + (terminal ? 0 : this.gamma * nextValue) - prev.value;
      const advantage = clamp(advantageRaw, -3, 3);
      const valueTarget = reward + (terminal ? 0 : this.gamma * nextValue);
      const valueError = clamp(prev.value - valueTarget, -6, 6);
      const sigmaSq = prev.sigma * prev.sigma;

      const gForce0 = clamp((advantage * (prev.rawForward - prev.zf0)) / sigmaSq, -12, 12);
      const gForce1 = clamp((advantage * (prev.rawLateral - prev.zf1)) / sigmaSq, -12, 12);
      const gAttack = clamp(
        advantage * ((prev.attackIntent ? 1 : 0) - prev.attackProbability),
        -3,
        3,
      );
      const gValue = -valueError;

      this._gForce[0] = gForce0;
      this._gForce[1] = gForce1;

      const lrActor = 0.00135;
      const lrAttack = 0.0011;
      const lrValue = 0.0032;
      const lrHidden = 0.00032;
      const dHidden = this._dHidden;
      dHidden.fill(0);

      // Backpropagate policy and critic objectives into the shared trunk
      // using the pre-update head weights. Head updates happen afterwards so
      // every hidden gradient is computed against the same forward pass.
      for (let h = 0; h < HIDDEN_SIZE; h += 1) {
        dHidden[h] =
          gForce0 * this.wForce[h] +
          gForce1 * this.wForce[HIDDEN_SIZE + h] +
          gAttack * this.wAttack[h] +
          gValue * this.wValue[h];
      }

      for (let h = 0; h < HIDDEN_SIZE; h += 1) {
        const activation = prev.hidden[h];
        this.wForce[h] += lrActor * gForce0 * activation;
        this.wForce[HIDDEN_SIZE + h] += lrActor * gForce1 * activation;
        this.wAttack[h] += lrAttack * gAttack * activation;
        this.wValue[h] += lrValue * gValue * activation;
      }

      this.bForce[0] += lrActor * gForce0;
      this.bForce[1] += lrActor * gForce1;
      this.bAttack = clamp(this.bAttack + lrAttack * gAttack, -5, 5);
      this.bValue = clamp(this.bValue + lrValue * gValue, -5, 5);

      if (lrHidden !== 0) {
        const input = prev.input;
        for (let h = 0; h < HIDDEN_SIZE; h += 1) {
          const dPre = clamp(dHidden[h] * (1 - prev.hidden[h] * prev.hidden[h]), -4, 4);
          if (dPre === 0) continue;
          const offset = h * INPUT_SIZE;
          const step = lrHidden * dPre;
          for (let i = 0; i < INPUT_SIZE; i += 1) {
            this.w1[offset + i] = clamp(this.w1[offset + i] + step * input[i], -5, 5);
          }
          this.b1[h] = clamp(this.b1[h] + step, -5, 5);
        }
      }

      this.updates += 1;
      this.lastAdvantage = advantage;
      this.lastTD = advantageRaw;
      this.lastReward = reward;
      this.rewardEMA = this.rewardEMA * 0.97 + reward * 0.03;
      if (prev === this.pending) this.pending = null;
    }

    /** Coarse input groups used by the brain-card visualization. */
    getInputGroups() {
      const input = this.lastInput;
      const groups = [];
      const spans = [
        [0, 1], // bias
        [1, 2], // energy
        [2, 3], // health
        [3, 4], // life left
        [4, 5], // speed
        [5, 6], // mass
        [6, 7], // attack damage
        [7, 8], // attack gain
        [8, 10], // reproduction threshold / chance
        [10, 11], // attack cooldown
        [11, 15], // boundary distances
        [15, 17], // neighbour count + visible near fraction
        [17, 18], // energy / reproduction readiness
      ];
      for (let g = 0; g < spans.length; g += 1) {
        const [start, end] = spans[g];
        let sum = 0;
        for (let i = start; i < end; i += 1) sum += Math.abs(input[i]);
        groups.push(sum / (end - start));
      }
      for (let n = 0; n < MAX_NEIGHBORS; n += 1) {
        const start = SELF_INPUTS + n * NEIGHBOR_INPUTS;
        let sum = 0;
        for (let i = 0; i < NEIGHBOR_INPUTS; i += 1) {
          sum += Math.abs(input[start + i]);
        }
        groups.push(sum / NEIGHBOR_INPUTS);
      }
      return groups;
    }

    serializeStats() {
      return {
        inputSize: INPUT_SIZE,
        hiddenSize: HIDDEN_SIZE,
        outputSize: OUTPUT_SIZE,
        updates: this.updates,
        advantage: this.lastAdvantage,
        value: this.valueEstimate,
        rewardEMA: this.rewardEMA,
        sigma: this.sigma,
        maxNeighbors: MAX_NEIGHBORS,
      };
    }
  }

  Evo.NeuralBrain = NeuralBrain;
  Evo.BrainSpec = {
    INPUT_SIZE,
    HIDDEN_SIZE,
    OUTPUT_SIZE,
    SELF_INPUTS,
    NEIGHBOR_INPUTS,
    MAX_NEIGHBORS,
    EXPLORATION_SIGMA,
    GAMMA,
  };
})(typeof window !== 'undefined' ? window : globalThis);
