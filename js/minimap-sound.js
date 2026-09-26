'use strict';

// ===== MINIMAP =====
// An iso-projected overview in the corner: terrain (under fog where unexplored), your buildings in gold,
// the rival's in red, ships as dots and the camera's view as a frame. Click or drag to move the camera.
const MINIMAP_KEY = 'anno-online-minimap';
const minimap = { cv: null, g: null, base: null, W: 220, H: 120, dragging: false };

function initMinimap() {
  const cv = document.getElementById('minimap'), dpr = window.devicePixelRatio || 1;
  minimap.cv = cv;
  cv.width = minimap.W * dpr;
  cv.height = minimap.H * dpr;
  minimap.g = cv.getContext('2d');
  minimap.g.scale(dpr, dpr);
  let show = true;
  try { show = localStorage.getItem(MINIMAP_KEY) !== '0'; } catch { /* default: shown */ }
  cv.hidden = !show;
  const opt = document.getElementById('opt-minimap');
  opt.checked = show;
  opt.addEventListener('change', () => setMinimapShown(opt.checked));
  const jump = (e) => {
    const r = cv.getBoundingClientRect(), f = minimapFrame();
    const u = (e.clientX - r.left - f.ox) / f.s, w = (e.clientY - r.top - f.oy) / (f.s / 2);
    centerOn((u + w) / 2, (w - u) / 2);
    updateHover();
  };
  cv.addEventListener('mousedown', (e) => { e.stopPropagation(); minimap.dragging = true; jump(e); });
  window.addEventListener('mousemove', (e) => { if (minimap.dragging) jump(e); });
  window.addEventListener('mouseup', () => { minimap.dragging = false; });
}

function setMinimapShown(show) {
  minimap.cv.hidden = !show;
  document.getElementById('opt-minimap').checked = show;
  try { localStorage.setItem(MINIMAP_KEY, show ? '1' : '0'); } catch { /* not remembered */ }
  minimapDirty = true;
}
const toggleMinimap = () => setMinimapShown(minimap.cv.hidden);

// Scale and offset that fit the map diamond into the minimap
function minimapFrame() {
  const N = MAP_SIZE, s = Math.min((minimap.W - 8) / (2 * N), (minimap.H - 8) / N);
  return { s, ox: minimap.W / 2, oy: (minimap.H - N * s) / 2 };
}

// One pixel per tile, redrawn when something changed
function rebuildMinimapBase() {
  const N = MAP_SIZE;
  if (!minimap.base || minimap.base.width !== N) {
    minimap.base = document.createElement('canvas');
    minimap.base.width = minimap.base.height = N;
  }
  const g = minimap.base.getContext('2d'), img = g.createImageData(N, N), d = img.data;
  const COL = { grass: [106, 164, 68], forest: [58, 110, 42], beach: [224, 204, 146], rock: [150, 144, 128] };
  const occ = GAME.occupancy;
  for (let i = 0; i < N * N; i++) {
    const t = GAME.grid[i];
    let c;
    if (!GAME.seen[i]) c = [26, 40, 54];
    else if (t.type === 'water') { const k = Math.min(t.depth || 4, 4); c = [70 - k * 10, 150 - k * 14, 200 - k * 8]; }
    else c = COL[t.type] || COL.grass;
    if (GAME.seen[i]) {
      const o = occ.get(`${t.x},${t.y}`);
      if (o === 'road') c = [200, 178, 122];
      else if (o) c = isRivalId(o) ? [200, 60, 50] : [250, 214, 90];
    }
    d.set([c[0], c[1], c[2], 255], i * 4);
  }
  const PF = GAME.pirates;
  if (PF?.fortHp > 0 && isSeen(PF.fort.x, PF.fort.y)) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const i = (PF.fort.y + dy) * N + PF.fort.x + dx;
      if (i >= 0 && i < N * N) d.set([20, 16, 14, 255], i * 4);
    }
  }
  g.putImageData(img, 0, 0);
}

function renderMinimap() {
  if (!minimap.cv || minimap.cv.hidden || !GAME.grid.length) return;
  if (minimapDirty) { rebuildMinimapBase(); minimapDirty = false; }
  const g = minimap.g, f = minimapFrame();
  g.clearRect(0, 0, minimap.W, minimap.H);
  g.save();
  g.transform(f.s, f.s / 2, -f.s, f.s / 2, f.ox, f.oy);
  g.imageSmoothingEnabled = false;
  g.drawImage(minimap.base, 0, 0);
  g.restore();
  const at = (x, y) => ({ x: f.ox + (x - y) * f.s, y: f.oy + (x + y) * f.s / 2 });
  const dotAt = (x, y, col, r = 1.8) => {
    const p = at(x + 0.5, y + 0.5);
    g.fillStyle = col;
    g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
  };
  for (const s of GAME.ships) dotAt(s.x, s.y, isWarship(s) ? '#8ab4ff' : '#ffffff');
  const T = GAME.trader, R = GAME.pirates?.ship, RS = GAME.rival?.ship;
  if (T && isSeen(Math.round(T.x), Math.round(T.y))) dotAt(T.x, T.y, '#f0c040');
  if (RS && isSeen(Math.round(RS.x), Math.round(RS.y))) dotAt(RS.x, RS.y, '#ff6a5a');
  if (R && isSeen(Math.round(R.x), Math.round(R.y))) dotAt(R.x, R.y, '#000', 2.4);
  // Camera frame: the four screen corners in tile coordinates
  const corners = [[0, 0], [canvas.width, 0], [canvas.width, canvas.height], [0, canvas.height]].map(([px, py]) => {
    const w = screenToWorld(px, py);
    const tx = (w.x / 32 + w.y / 16) / 2, ty = (w.y / 16 - w.x / 32) / 2;
    return at(tx + 0.5, ty + 0.5);
  });
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 1;
  g.beginPath();
  corners.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y));
  g.closePath();
  g.stroke();
}

// ===== SOUND =====
// All sound is synthesised with the Web Audio API: short effects, a soft sea ambience and a gentle lute-like tune.
const AUDIO_KEY = 'anno-online-audio';
const audio = { ctx: null, sfxGain: null, musicGain: null, master: null, sound: true, music: true, volume: 60, last: {}, musicTimer: null, nextNote: 0, step: 0 };
try { Object.assign(audio, JSON.parse(localStorage.getItem(AUDIO_KEY)) || {}); } catch { /* defaults */ }

function saveAudioPrefs() {
  try { localStorage.setItem(AUDIO_KEY, JSON.stringify({ sound: audio.sound, music: audio.music, volume: audio.volume })); } catch { /* not remembered */ }
}

// Browsers only allow audio after a user gesture, so the context is created on the first click or key
function ensureAudio() {
  if (audio.ctx) { if (audio.ctx.state === 'suspended' && !document.hidden) audio.ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audio.ctx = new AC();
  audio.master = audio.ctx.createGain();
  audio.master.gain.value = audio.volume / 100;
  audio.master.connect(audio.ctx.destination);
  audio.sfxGain = audio.ctx.createGain();
  audio.sfxGain.gain.value = audio.sound ? 1 : 0;
  audio.sfxGain.connect(audio.master);
  audio.musicGain = audio.ctx.createGain();
  audio.musicGain.gain.value = audio.music ? 1 : 0;
  audio.musicGain.connect(audio.master);
  startAmbience();
  startMusic();
}
window.addEventListener('pointerdown', ensureAudio);
window.addEventListener('keydown', ensureAudio);
document.addEventListener('visibilitychange', () => {
  if (!audio.ctx) return;
  if (document.hidden) audio.ctx.suspend(); else audio.ctx.resume();
});

function tone(freq, dur, { type = 'sine', vol = 0.2, when = 0, slide = null, dest = audio.sfxGain, attack = 0.005 } = {}) {
  const c = audio.ctx, t0 = c.currentTime + when;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(dest);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

let noiseBuf = null;
function noiseBuffer() {
  if (noiseBuf) return noiseBuf;
  const c = audio.ctx, len = c.sampleRate * 2;
  noiseBuf = c.createBuffer(1, len, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function noise(dur, { vol = 0.3, freq = 800, when = 0, type = 'lowpass', dest = audio.sfxGain, attack = 0.005 } = {}) {
  const c = audio.ctx, t0 = c.currentTime + when;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = noiseBuffer();
  f.type = type;
  f.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t0, Math.random());
  src.stop(t0 + dur + 0.05);
}

const SFX = {
  click:    () => tone(700, 0.06, { type: 'square', vol: 0.04 }),
  build:    () => { noise(0.18, { vol: 0.35, freq: 500 }); tone(150, 0.2, { type: 'triangle', vol: 0.25, slide: 70 }); noise(0.1, { vol: 0.2, freq: 1500, when: 0.12 }); },
  demolish: () => { noise(0.5, { vol: 0.4, freq: 900, attack: 0.02 }); tone(100, 0.4, { type: 'triangle', vol: 0.25, slide: 45 }); },
  coins:    () => [988, 1319, 1568].forEach((f, i) => tone(f, 0.18, { vol: 0.12, when: i * 0.07 })),
  horn:     () => { tone(196, 0.9, { type: 'sawtooth', vol: 0.08, attack: 0.1 }); tone(247, 0.7, { type: 'sawtooth', vol: 0.06, attack: 0.1, when: 0.5 }); },
  alarm:    () => [0, 0.25, 0.5].forEach(w => tone(880, 0.35, { type: 'triangle', vol: 0.12, when: w })),
  cannon:   () => { noise(0.6, { vol: 0.5, freq: 260, attack: 0.002 }); tone(70, 0.4, { type: 'sine', vol: 0.4, slide: 30 }); },
  discover: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.12, when: i * 0.09 })),
  fanfare:  () => [[523, 0], [659, 0.15], [784, 0.3], [1047, 0.45], [784, 0.75], [1047, 0.9]].forEach(([f, w]) => {
    tone(f, 0.4, { type: 'triangle', vol: 0.15, when: w }); tone(f / 2, 0.4, { type: 'sine', vol: 0.08, when: w });
  }),
  thunder:  () => noise(2.5, { vol: 0.35, freq: 180, attack: 0.3 })
};

function sfx(name) {
  if (!audio.ctx || !audio.sound || audio.ctx.state !== 'running' || !SFX[name]) return;
  const now = performance.now();
  if (now - (audio.last[name] || 0) < 120) return; // no machine-gun repeats
  audio.last[name] = now;
  SFX[name]();
}

// Sea ambience: filtered noise swelling like waves, and a gull now and then
function startAmbience() {
  const c = audio.ctx;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), depth = c.createGain();
  src.buffer = noiseBuffer();
  src.loop = true;
  f.type = 'lowpass';
  f.frequency.value = 420;
  g.gain.value = 0.05;
  lfo.frequency.value = 0.12;
  depth.gain.value = 0.035;
  lfo.connect(depth).connect(g.gain);
  src.connect(f).connect(g).connect(audio.musicGain);
  src.start();
  lfo.start();
  const gull = () => {
    if (audio.ctx.state === 'running' && audio.music) {
      tone(1500, 0.22, { type: 'triangle', vol: 0.025, slide: 950, dest: audio.musicGain });
      tone(1400, 0.25, { type: 'triangle', vol: 0.02, slide: 900, when: 0.3, dest: audio.musicGain });
    }
    setTimeout(gull, 9000 + Math.random() * 16000);
  };
  setTimeout(gull, 5000);
}

// Soft plucked tune over a slow chord progression (D major pentatonic), scheduled a little ahead
const CHORDS = [[146.8, [293.7, 370, 440]], [123.5, [246.9, 293.7, 370]], [98, [293.7, 392, 493.9]], [110, [277.2, 329.6, 440]]];
const MELODY = [587.3, 659.3, 740, 880, 987.8, 1174.7];
function pluck(freq, when, vol) {
  tone(freq, 0.9, { type: 'triangle', vol, when, dest: audio.musicGain, attack: 0.01 });
  tone(freq * 2, 0.4, { type: 'sine', vol: vol * 0.3, when, dest: audio.musicGain, attack: 0.01 });
}
function startMusic() {
  const EIGHTH = 0.36;
  audio.nextNote = audio.ctx.currentTime + 0.5;
  audio.musicTimer = setInterval(() => {
    const c = audio.ctx;
    if (c.state !== 'running' || !audio.music) { audio.nextNote = c.currentTime + 0.2; return; }
    while (audio.nextNote < c.currentTime + 0.6) {
      const bar = Math.floor(audio.step / 8) % CHORDS.length, beat = audio.step % 8;
      const [bass, chord] = CHORDS[bar];
      if (beat === 0) tone(bass, 2.4, { type: 'sine', vol: 0.05, when: audio.nextNote - c.currentTime, dest: audio.musicGain, attack: 0.05 });
      if (beat % 2 === 0) pluck(chord[(beat / 2) % 3], audio.nextNote - c.currentTime, 0.025);
      if (Math.random() < 0.35) pluck(MELODY[Math.floor(Math.random() * MELODY.length)], audio.nextNote - c.currentTime, 0.02);
      audio.nextNote += EIGHTH;
      audio.step++;
    }
  }, 150);
}

function initAudioControls() {
  const snd = document.getElementById('opt-sound'), mus = document.getElementById('opt-music'), vol = document.getElementById('opt-volume');
  snd.checked = audio.sound;
  mus.checked = audio.music;
  vol.value = audio.volume;
  snd.addEventListener('change', () => {
    audio.sound = snd.checked;
    if (audio.sfxGain) audio.sfxGain.gain.value = audio.sound ? 1 : 0;
    saveAudioPrefs();
    sfx('click');
  });
  mus.addEventListener('change', () => {
    audio.music = mus.checked;
    if (audio.musicGain) audio.musicGain.gain.value = audio.music ? 1 : 0;
    saveAudioPrefs();
  });
  vol.addEventListener('input', () => {
    audio.volume = Number(vol.value);
    if (audio.master) audio.master.gain.value = audio.volume / 100;
    saveAudioPrefs();
  });
}
