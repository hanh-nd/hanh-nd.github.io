// Synthesized sounds (Web Audio, no files).
import { clamp } from './util.js';
import { showMessage } from './ui/hud.js';

/* =====================================================================
   AUDIO — synthesized with Web Audio (no files)
   ===================================================================== */
export const Sound = {
  ctx: null, master: null, noise: null, muted: false,
  /** Start audio, or bring it back. Call from a user gesture: browsers (iOS above all) only
   *  start audio from a tap or click. After a tab switch, iOS leaves the context 'interrupted'
   *  and it often never resumes, so it is replaced with a fresh one. */
  init() {
    this.unlockSilentSwitch();
    if (this.ctx) {
      if (this.ctx.state === 'running') return;
      if (this.ctx.state !== 'interrupted' && this.ctx.state !== 'closed') { this.ctx.resume().catch(() => {}); return; }
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    // A limiter at the end of the chain: many sounds at once (hits, smashes, fanfares) never clip.
    const lim = this.ctx.createDynamicsCompressor();
    lim.threshold.value = -10; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.25;
    this.master.connect(lim).connect(this.ctx.destination);
    const len = Math.floor(this.ctx.sampleRate * 0.2);
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  },
  /** iOS plays Web Audio as 'ambient' sound, which the ring/silent switch mutes. Ask for
   *  'playback' instead (iOS 17+); older iOS switches over while an <audio> element plays,
   *  so a looping silent clip does the job there. */
  unlockSilentSwitch() {
    if (navigator.audioSession) { try { navigator.audioSession.type = 'playback'; } catch (e) {} return; }
    if (!/iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) || !('ontouchend' in document)) return;
    if (!this.silentEl) {
      // 0.1 s of 8-bit mono silence as a WAV
      const n = 800, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
      const str = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
      str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
      str(36, 'data'); v.setUint32(40, n, true); b.fill(128, 44);
      const el = this.silentEl = document.createElement('audio');
      el.src = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
      el.loop = true; el.preload = 'auto';
      el.setAttribute('playsinline', ''); el.setAttribute('x-webkit-airplay', 'deny');
      document.addEventListener('visibilitychange', () => { if (document.hidden) el.pause(); });
    }
    if (this.silentEl.paused) this.silentEl.play().catch(() => {});
  },
  /** Throw the audio context away and build a fresh one. Call from a user gesture. Fixes audio
   *  that has gone silent while the context still says 'running' (iOS after a call or a route
   *  change, some desktop audio drivers after sleep). */
  restart() {
    if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null; }
    this.init();
  },
  /** Mute, or unmute — unmuting restarts the audio, so it's also the fix when sound drops out. */
  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) { if (this.master) this.master.gain.value = 0; }
    else {
      this.restart();
      setTimeout(() => this.hit(0.5), 80);   // a tick: you hear that sound is back
    }
    showMessage(this.muted ? 'Muted' : 'Sound on', '', 'neutral', 0.8, 3);
  },

  ready() { return this.ctx && !this.muted && this.ctx.state === 'running'; },
  tone(f0, f1, dur, type, vol, delay = 0) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  click(freq, dur, vol) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    src.buffer = this.noise;
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  },
  hit(i = 0.5) {
    i = clamp(i, 0.1, 1.2);
    this.click(2600, 0.05, 0.25 + 0.4 * i);
    this.tone(650 + 350 * i, 260, 0.08, 'triangle', 0.15 + 0.25 * i);
  },
  /** A signature shot: a bright rising chime over the stroke. */
  signature() {
    [880, 1320, 1760].forEach((f, k) => this.tone(f, f * 1.02, 0.14, 'sine', 0.16, k * 0.045));
    this.tone(220, 140, 0.2, 'sawtooth', 0.12);
  },
  /** Jutsu: the seal (arming / a CPU's call-out), then each jutsu's own sound. */
  sealReady() { this.tone(988, 1319, 0.1, 'sine', 0.12); this.tone(1319, 1760, 0.12, 'sine', 0.1, 0.07); },
  seal() { this.tone(300, 900, 0.18, 'sine', 0.2); this.click(6000, 0.05, 0.2); },
  sharingan() { this.tone(1400, 300, 0.25, 'sawtooth', 0.08); this.tone(700, 1400, 0.2, 'sine', 0.12, 0.08); },
  zeroshiki() { this.tone(900, 1800, 0.12, 'sine', 0.14); this.tone(1800, 600, 0.3, 'triangle', 0.1, 0.1); },
  snake() { for (let k = 0; k < 5; k++) this.tone(300 + k * 40, 600 - k * 30, 0.1, 'triangle', 0.08, k * 0.05); this.click(2500, 0.15, 0.3); },
  godhand() { [196, 294, 392].forEach((f, k) => this.tone(f, f, 0.5, 'triangle', 0.16, k * 0.06)); this.click(400, 0.3, 0.6); },
  misdirect() { this.tone(1200, 2400, 0.3, 'sine', 0.06); this.click(9000, 0.2, 0.15); },
  blackflash() { this.tone(80, 40, 0.3, 'sawtooth', 0.3); this.click(600, 0.12, 0.9); this.tone(2400, 300, 0.15, 'square', 0.08, 0.05); },
  void() { this.tone(60, 55, 1.2, 'sine', 0.3); [523, 659, 784, 1047].forEach((f, k) => this.tone(f, f * 0.99, 0.6, 'sine', 0.05, 0.1 + k * 0.1)); },
  metavision() { this.tone(500, 250, 0.4, 'sine', 0.12); },
  awaken() { [392, 587, 784].forEach((f, k) => this.tone(f, f * 1.5, 0.18, 'sawtooth', 0.07, k * 0.04)); this.click(3000, 0.1, 0.5); },
  hiraishin() { this.click(5000, 0.06, 0.4); this.tone(1800, 2600, 0.1, 'square', 0.05); this.tone(2600, 900, 0.15, 'sine', 0.1, 0.06); },
  timestop() { this.tone(400, 100, 0.6, 'sine', 0.3); [0, 0.18, 0.36].forEach(d => this.tone(2200, 2200, 0.03, 'square', 0.12, d)); },
  samehada() { this.tone(220, 110, 0.3, 'sawtooth', 0.12); this.tone(900, 300, 0.25, 'triangle', 0.08, 0.05); },
  mirror() { [1568, 2093, 2637].forEach((f, k) => this.tone(f, f * 1.01, 0.3, 'sine', 0.09, k * 0.03)); this.click(7000, 0.08, 0.3); },
  possession() { this.tone(110, 70, 0.5, 'sawtooth', 0.1); this.tone(440, 220, 0.4, 'sine', 0.08, 0.05); },
  rasengan() {
    for (let k = 0; k < 6; k++) this.tone(180 + k * 60, 560 + k * 90, 0.14, 'sawtooth', 0.07, k * 0.03);
    this.click(900, 0.3, 0.45);
  },
  clone() { this.click(700, 0.25, 0.6); this.tone(500, 200, 0.2, 'sine', 0.15); },
  /** Any other jutsu: a whoosh and a rising tone. */
  jutsu() { this.click(500, 0.3, 0.5); [330, 495, 660].forEach((f, k) => this.tone(f, f * 1.5, 0.15, 'triangle', 0.12, k * 0.04)); },
  poof() { this.click(1200, 0.18, 0.5); },
  /** Overdrive rally (HEAT): a clang that climbs with the heat level (1–4)... */
  heat(level) { const f = 1100 + 260 * level; this.tone(f, f * 1.25, 0.07, 'square', 0.03 + 0.012 * level); this.click(5200, 0.04, 0.12 + 0.07 * level); },
  /** ...and a smash that cashes it in: a deep thump under a bright ring. */
  overdrive(level) { this.tone(110, 45, 0.3, 'sawtooth', 0.12 + 0.04 * level); [1568, 2349].forEach((f, k) => this.tone(f, f * 0.98, 0.25, 'triangle', 0.05 + 0.02 * level, k * 0.03)); this.click(3800, 0.1, 0.4 + 0.1 * level); },
  counter() { [523, 784, 1047].forEach((f, k) => this.tone(f, f, 0.12, 'square', 0.1, k * 0.05)); this.click(3000, 0.06, 0.5); },
  flow() { [392, 494, 587, 784].forEach((f, k) => this.tone(f, f * 1.01, 0.25, 'triangle', 0.18, k * 0.08)); },
  smash() {
    this.click(1800, 0.09, 0.9);
    this.tone(320, 90, 0.18, 'sawtooth', 0.22);
    this.tone(1200, 400, 0.08, 'triangle', 0.4);
  },
  bounce(surface, speed) {
    const i = clamp(speed / 5, 0.1, 1);
    if (surface === 'table') { this.tone(1500, 1000, 0.05, 'sine', 0.3 * i); this.click(4200, 0.02, 0.12 * i); }
    else if (surface === 'floor') this.tone(460, 280, 0.08, 'sine', 0.25 * i);
    else this.click(500, 0.07, 0.25);   // net
  },
  point(win) {
    const notes = win ? [660, 880] : [440, 330];
    notes.forEach((f, k) => this.tone(f, f, 0.16, 'sine', 0.22, k * 0.12));
  },
  fanfare(win) {
    const notes = win ? [523, 659, 784, 1047] : [392, 349, 311, 262];
    notes.forEach((f, k) => this.tone(f, f * (win ? 1 : 0.98), 0.22, 'triangle', 0.2, k * 0.14));
  },
};
