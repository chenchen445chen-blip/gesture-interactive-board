/**
 * 06. SuperCollider — 实时程序化声音合成器 (Algorithmic Web Audio Synth Engine)
 * 模拟 SuperCollider 的 UGen 节点合成思想 (SinOsc + LFSaw + BiquadFilter + EnvGen)，
 * 为 3D 手模姿态切换、关节运动、物理碰撞球及关键帧步进提供实时程序化合成音效。
 */
export class SuperColliderSynth {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.lastVisualizeData = new Float32Array(32);
  }

  _ensureContext() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * 姿态切换和弦合成音 (SynthDef: \poseMorphChord)
   */
  triggerPoseSound(poseIndex = 0) {
    const ctx = this._ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const baseFreqs = [220, 261.63, 293.66, 329.63, 392.0, 440.0];
    const root = baseFreqs[poseIndex % baseFreqs.length];
    const ratios = [1, 1.25, 1.5, 2.0];

    ratios.forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(root * ratio, now);
      osc.frequency.exponentialRampToValueAtTime(root * ratio * 1.015, now + 0.35);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1800, now);
      filter.frequency.exponentialRampToValueAtTime(420, now + 0.42);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.045 / (i + 1), now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.42);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + i * 0.018);
      osc.stop(now + 0.45);
    });

    this._pulseWaveform(0.85);
  }

  /**
   * 关节弯曲微伺服脉冲音 (SynthDef: \jointServoGrain)
   */
  triggerJointGrain(normAngle = 0.5) {
    const ctx = this._ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    const freq = 180 + normAngle * 520;
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.018, now);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.045);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.05);
    this._pulseWaveform(0.4 + normAngle * 0.5);
  }

  /**
   * 04 Ammo.js 物理刚体碰撞声学共振 (SynthDef: \ammoImpactModal)
   */
  triggerPhysicsImpact(velocity = 1.0) {
    const ctx = this._ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const amp = Math.min(0.12, Math.max(0.01, velocity * 0.04));
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160 + velocity * 90, now);
    osc.frequency.exponentialRampToValueAtTime(58, now + 0.14);

    gain.gain.setValueAtTime(amp, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.16);
    this._pulseWaveform(Math.min(1, velocity * 0.5));
  }

  _pulseWaveform(intensity = 0.5) {
    for (let i = 0; i < this.lastVisualizeData.length; i++) {
      this.lastVisualizeData[i] = Math.sin(i * 0.65 + performance.now() * 0.01) * intensity;
    }
  }
}
