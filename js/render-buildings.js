'use strict';

// ===== BUILDING RENDERING =====
// Everything is drawn procedurally in a small 3D iso space:
// u/v in tile units (tile centres at integers), z in screen pixels.
// Visible walls are the front-left (plane v = const) and front-right (plane u = const).
// Light comes from the right, so front-right faces are lit and front-left faces are shaded.
const P = (u, v, z = 0) => ({ x: (u - v) * 32, y: (u + v) * 16 - z });
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const OUTLINE = 'rgba(35,22,10,0.6)';
const TILE_PX = 36; // approx. screen length of one tile edge, used for round shapes

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.min(255, Math.round(v * f));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

// Deterministic per-building randomness so details don't flicker between frames
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function poly(fill, pts, stroke = OUTLINE) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.8; ctx.stroke(); }
}

function line(a, b, color, w = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function dot(p, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Wall faces. at(s, t): s = tiles along the wall (left → right on screen), t = pixels up.
const wallL = (u0, u1, v, z0, z1) => ({ len: u1 - u0, h: z1 - z0, at: (s, t) => P(u0 + s, v, z0 + t) });
const wallR = (u, v0, v1, z0, z1) => ({ len: v1 - v0, h: z1 - z0, at: (s, t) => P(u, v1 - s, z0 + t) });
const rectOn = (f, s0, t0, s1, t1) => [f.at(s0, t0), f.at(s1, t0), f.at(s1, t1), f.at(s0, t1)];

function walls(u0, v0, u1, v1, z0, z1, color, top) {
  const L = wallL(u0, u1, v1, z0, z1), R = wallR(u1, v0, v1, z0, z1);
  poly(shade(color, 0.78), rectOn(L, 0, 0, L.len, L.h));
  poly(color, rectOn(R, 0, 0, R.len, R.h));
  if (top) poly(top, [P(u0, v0, z1), P(u1, v0, z1), P(u1, v1, z1), P(u0, v1, z1)]);
  return { L, R };
}

// --- Wall surface details ---
function boards(f, spacing = 0.08) {
  const n = Math.max(1, Math.round(f.len / spacing));
  for (let i = 1; i < n; i++) line(f.at(f.len * i / n, 0), f.at(f.len * i / n, f.h), 'rgba(0,0,0,0.22)', 0.7);
}

function logCourses(f, n) {
  for (let i = 1; i < n; i++) line(f.at(0, f.h * i / n), f.at(f.len, f.h * i / n), 'rgba(30,15,5,0.45)', 1);
}

function stones(f) {
  const rows = Math.max(1, Math.round(f.h / 4));
  for (let r = 0; r < rows; r++) {
    const t0 = f.h * r / rows, t1 = f.h * (r + 1) / rows;
    if (r > 0) line(f.at(0, t0), f.at(f.len, t0), 'rgba(0,0,0,0.25)', 0.6);
    for (let s = (r % 2) * 0.07 + 0.07; s < f.len; s += 0.14) line(f.at(s, t0), f.at(s, t1), 'rgba(0,0,0,0.2)', 0.6);
  }
}

// Half-timbering: sill, header, posts and alternating braces
function timber(f, color = '#4a3020', spacing = 0.28) {
  const n = Math.max(1, Math.round(f.len / spacing));
  for (let i = 0; i < n; i++) {
    const a = f.len * i / n, b = f.len * (i + 1) / n;
    if (i % 2) line(f.at(a, 0), f.at(b, f.h), color, 1);
    else line(f.at(b, 0), f.at(a, f.h), color, 1);
  }
  for (let i = 0; i <= n; i++) line(f.at(f.len * i / n, 0), f.at(f.len * i / n, f.h), color, 1.4);
  line(f.at(0, 0.7), f.at(f.len, 0.7), color, 1.6);
  line(f.at(0, f.h - 0.7), f.at(f.len, f.h - 0.7), color, 1.6);
}

function win(f, s, t, ws, ht, opts = {}) {
  const a = s - ws / 2, b = s + ws / 2;
  poly('#3a2616', rectOn(f, a - 0.015, t - 1, b + 0.015, t + ht + 1), null);
  poly(opts.lit ? '#f0d890' : '#5e7e9c', rectOn(f, a, t, b, t + ht), null);
  line(f.at(s, t), f.at(s, t + ht), '#3a2616', 0.8);
  line(f.at(a, t + ht / 2), f.at(b, t + ht / 2), '#3a2616', 0.8);
  if (opts.shutter) {
    const sw = ws * 0.45;
    poly(opts.shutter, rectOn(f, a - sw - 0.01, t, a - 0.01, t + ht));
    poly(opts.shutter, rectOn(f, b + 0.01, t, b + sw + 0.01, t + ht));
  }
  if (opts.flowers) {
    poly('#5a3a1a', rectOn(f, a - 0.02, t - 3, b + 0.02, t - 1));
    for (let i = 0; i < 3; i++) dot(f.at(a + ws * (i + 0.5) / 3, t - 0.5), 1.1, i % 2 ? '#e05050' : '#f0c040');
  }
}

function door(f, s, ws, ht, color = '#5a3a1a') {
  poly('#2e1c0c', rectOn(f, s - ws / 2 - 0.015, 0, s + ws / 2 + 0.015, ht + 1), null);
  poly(color, rectOn(f, s - ws / 2, 0, s + ws / 2, ht));
  line(f.at(s - ws / 6, 0), f.at(s - ws / 6, ht), 'rgba(0,0,0,0.3)', 0.6);
  line(f.at(s + ws / 6, 0), f.at(s + ws / 6, ht), 'rgba(0,0,0,0.3)', 0.6);
  dot(f.at(s + ws / 3, ht * 0.45), 0.8, '#d8b060');
}

// Large arched double door (barns, warehouses)
function barnDoor(f, s, ws, ht) {
  const a = s - ws / 2, b = s + ws / 2, arch = ws * 14;
  const outline = [f.at(a, 0), f.at(b, 0)];
  for (let i = 0; i <= 8; i++) {
    const ang = (i / 8) * Math.PI;
    outline.push(f.at(s + Math.cos(ang) * ws / 2, ht + Math.sin(ang) * arch));
  }
  poly('#4e3014', outline);
  line(f.at(s, 0), f.at(s, ht + arch), '#2e1c0c', 1);
  line(f.at(a, ht * 0.15), f.at(s, ht * 0.85), 'rgba(0,0,0,0.35)', 1);
  line(f.at(b, ht * 0.15), f.at(s, ht * 0.85), 'rgba(0,0,0,0.35)', 1);
  line(f.at(a, ht * 0.5), f.at(b, ht * 0.5), 'rgba(0,0,0,0.35)', 0.8);
}

// --- Roofs ---
function roofTexture(q, col, style) {
  const [A, B, C, D] = q;
  if (style === 'thatch') {
    for (let i = 1; i < 5; i++) line(lerp(A, D, i / 5), lerp(B, C, i / 5), shade(col, 0.72), 1.2);
    line(A, B, shade(col, 0.6), 2.2);
  } else {
    const rows = style === 'shingle' ? 6 : 5;
    for (let i = 1; i < rows; i++) line(lerp(A, D, i / rows), lerp(B, C, i / rows), shade(col, 0.62), 0.8);
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    const cols = Math.max(3, Math.round(len / (style === 'shingle' ? 6 : 4.5)));
    for (let j = 1; j < cols; j++) line(lerp(A, B, j / cols), lerp(D, C, j / cols), shade(col, 0.8), 0.5);
  }
  line(D, C, shade(col, 0.5), 2); // ridge
}

function gableDeco(g, opts) {
  if (opts.timber) {
    const c = opts.timber;
    line(g.at(g.len / 2, 0), g.at(g.len / 2, g.h), c, 1.4);
    line(g.at(g.len * 0.25, g.h * 0.5), g.at(g.len * 0.75, g.h * 0.5), c, 1.2);
    line(g.at(0, 0.6), g.at(g.len, 0.6), c, 1.6);
  }
  if (opts.boards) boards(g, 0.08);
  if (opts.vent) {
    const w = opts.vent;
    poly('#2e1c0c', rectOn(g, g.len / 2 - w / 2, g.h * 0.22, g.len / 2 + w / 2, g.h * 0.22 + w * 30));
  }
}

// Gable roof with ridge along u; the visible gable end faces +u (front-right)
function roofU(u0, v0, u1, v1, z, rh, col, gable, opts = {}) {
  const o = 0.09, vm = (v0 + v1) / 2, a = u0 - o, b = u1 + o;
  poly(shade(col, 0.7), [P(a, v0 - o, z), P(b, v0 - o, z), P(b, vm, z + rh), P(a, vm, z + rh)]);
  if (gable) {
    const g = wallR(u1, v0, v1, z, z + rh);
    poly(gable, [g.at(0, 0), g.at(g.len, 0), g.at(g.len / 2, rh)]);
    ctx.save();
    ctx.beginPath();
    const tri = [g.at(0, 0), g.at(g.len, 0), g.at(g.len / 2, rh)];
    ctx.moveTo(tri[0].x, tri[0].y); ctx.lineTo(tri[1].x, tri[1].y); ctx.lineTo(tri[2].x, tri[2].y);
    ctx.clip();
    gableDeco(g, opts);
    ctx.restore();
  }
  const front = [P(a, v1 + o, z), P(b, v1 + o, z), P(b, vm, z + rh), P(a, vm, z + rh)];
  poly(shade(col, 0.88), front);
  roofTexture(front, col, opts.style);
  const verge = shade(col, 0.45);
  line(P(b, v0 - o, z), P(b, vm, z + rh), verge, 1.6);
  line(P(b, vm, z + rh), P(b, v1 + o, z), verge, 1.6);
  // Surface height at a given v, for placing chimneys
  return (v) => z + rh * (1 - Math.abs(v - vm) / (vm - v0 + o));
}

// Gable roof with ridge along v; the visible gable end faces +v (front-left)
function roofV(u0, v0, u1, v1, z, rh, col, gable, opts = {}) {
  const o = 0.09, um = (u0 + u1) / 2, a = v0 - o, b = v1 + o;
  poly(shade(col, 0.7), [P(u0 - o, b, z), P(u0 - o, a, z), P(um, a, z + rh), P(um, b, z + rh)]);
  if (gable) {
    const g = wallL(u0, u1, v1, z, z + rh);
    const tri = [g.at(0, 0), g.at(g.len, 0), g.at(g.len / 2, rh)];
    poly(shade(gable, 0.78), tri);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(tri[0].x, tri[0].y); ctx.lineTo(tri[1].x, tri[1].y); ctx.lineTo(tri[2].x, tri[2].y);
    ctx.clip();
    gableDeco(g, opts);
    ctx.restore();
  }
  const front = [P(u1 + o, b, z), P(u1 + o, a, z), P(um, a, z + rh), P(um, b, z + rh)];
  poly(col, front);
  roofTexture(front, col, opts.style);
  const verge = shade(col, 0.45);
  line(P(u0 - o, b, z), P(um, b, z + rh), verge, 1.6);
  line(P(um, b, z + rh), P(u1 + o, b, z), verge, 1.6);
  return (u) => z + rh * (1 - Math.abs(u - um) / (um - u0 + o));
}

// --- Props ---
function smoke(p, seed = 0) {
  for (let i = 0; i < 4; i++) {
    const t = (animTime / 2600 + i / 4 + seed) % 1;
    ctx.fillStyle = `rgba(225,225,225,${0.5 * (1 - t)})`;
    ctx.beginPath();
    ctx.arc(p.x + Math.sin(t * 5 + i) * 2 + t * 8, p.y - 2 - t * 30, 2 + t * 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function chimney(u, v, z0, z1, seed) {
  const c = walls(u - 0.06, v - 0.06, u + 0.06, v + 0.06, z0, z1, '#9a8a78', '#4a3a2a');
  stones(c.L); stones(c.R);
  smoke(P(u, v, z1), seed);
}

function cylinder(u, v, z, r, h, side, top) {
  const b = P(u, v, z), t = P(u, v, z + h), rx = r * 45, ry = r * 22.6;
  ctx.fillStyle = side;
  ctx.beginPath();
  ctx.ellipse(b.x, b.y, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(t.x - rx, t.y);
  ctx.lineTo(t.x + rx, t.y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.8; ctx.stroke();
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.ellipse(t.x, t.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  return { b, t, rx, ry };
}

function barrel(u, v, z = 0) {
  const c = cylinder(u, v, z, 0.085, 11, '#8a5226', '#a8703c');
  ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1;
  for (const k of [0.25, 0.75]) {
    ctx.beginPath();
    ctx.ellipse(c.b.x, c.b.y - 11 * k, c.rx, c.ry, 0, 0, Math.PI);
    ctx.stroke();
  }
}

function crate(u, v, s, z = 0) {
  const c = walls(u - s, v - s, u + s, v + s, z, z + s * 50, '#a67c44', '#c49a5c');
  for (const f of [c.L, c.R]) {
    line(f.at(0, 0), f.at(f.len, f.h), 'rgba(60,35,10,0.6)', 0.9);
    line(f.at(0, f.h), f.at(f.len, 0), 'rgba(60,35,10,0.6)', 0.9);
  }
}

function sack(u, v, z = 0) {
  const p = P(u, v, z + 4);
  ctx.fillStyle = '#d6c69a';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, 6, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.8; ctx.stroke();
  dot({ x: p.x, y: p.y - 4 }, 1.5, '#a8966a');
}

// Stack of logs lying along u; the cut ends face +u
function logPile(u0, v0, u1, v1, rows) {
  const d = (v1 - v0) / rows, rpx = d * TILE_PX * 0.38;
  const logs = [];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < rows - r; k++) {
      logs.push({ vc: v1 - d / 2 - r * d / 2 - k * d, zc: rpx + r * rpx * 1.7 });
    }
  }
  logs.sort((a, b) => a.vc - b.vc || a.zc - b.zc);
  for (const l of logs) {
    poly('#6a4422', [P(u0, l.vc, l.zc - rpx), P(u1, l.vc, l.zc - rpx), P(u1, l.vc, l.zc + rpx), P(u0, l.vc, l.zc + rpx)]);
    const e = P(u1, l.vc, l.zc);
    dot(e, rpx, '#d8b07a');
    ctx.strokeStyle = '#8a6030'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.arc(e.x, e.y, rpx, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(e.x, e.y, rpx * 0.5, 0, Math.PI * 2); ctx.stroke();
  }
}

// Log lying along u (e.g. on a saw bench)
function logBand(u0, u1, vc, zc, rpx) {
  poly('#6a4422', [P(u0, vc, zc - rpx), P(u1, vc, zc - rpx), P(u1, vc, zc + rpx), P(u0, vc, zc + rpx)]);
  dot(P(u1, vc, zc), rpx, '#d8b07a');
}

function plankStack(u0, v0, u1, v1, n) {
  for (let i = 0; i < n; i++) {
    const j = (i % 2) * 0.03;
    const p = walls(u0 + j, v0, u1 + j, v1, i * 3, i * 3 + 2.6, '#cfa25c', '#e6c27e');
    boards(p.R, 0.07);
  }
}

function post(u, v, h, color = '#5a3a1e') {
  walls(u - 0.03, v - 0.03, u + 0.03, v + 0.03, 0, h, color, shade(color, 1.2));
}

function fence(u0, v0, u1, v1) {
  const len = Math.hypot(u1 - u0, v1 - v0), n = Math.max(1, Math.round(len / 0.14));
  line(P(u0, v0, 3), P(u1, v1, 3), '#7a5a32', 1);
  line(P(u0, v0, 6.5), P(u1, v1, 6.5), '#7a5a32', 1);
  for (let i = 0; i <= n; i++) {
    const u = u0 + (u1 - u0) * i / n, v = v0 + (v1 - v0) * i / n;
    line(P(u, v, 0), P(u, v, 8), '#5a3e20', 1.5);
  }
}

function bush(u, v, r, color = '#3e7a2e') {
  const p = P(u, v, r * 14);
  dot({ x: p.x + 1, y: p.y + 2 }, r * 16, 'rgba(0,0,0,0.2)');
  dot(p, r * 16, color);
  dot({ x: p.x - r * 5, y: p.y - r * 5 }, r * 9, shade(color, 1.25));
}

function tree(u, v, s = 1) {
  const b = P(u, v, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(b.x, b.y, 9 * s, 4.5 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#6b4423';
  ctx.fillRect(b.x - 1.5 * s, b.y - 12 * s, 3 * s, 12 * s);
  dot({ x: b.x, y: b.y - 16 * s }, 8 * s, '#2e6420');
  dot({ x: b.x - 3 * s, y: b.y - 22 * s }, 6 * s, '#3a7a2a');
  dot({ x: b.x + 3 * s, y: b.y - 19 * s }, 5 * s, '#4a8a34');
}

function stumpWithAxe(u, v) {
  const c = cylinder(u, v, 0, 0.09, 6, '#6a4422', '#d8b07a');
  ctx.strokeStyle = '#a8804a'; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.ellipse(c.t.x, c.t.y, c.rx * 0.5, c.ry * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
  const h0 = { x: c.t.x - 1, y: c.t.y }, h1 = { x: c.t.x + 6, y: c.t.y - 11 };
  line(h0, h1, '#8a6034', 1.6);
  poly('#b8bcc0', [{ x: h0.x - 3, y: h0.y - 1 }, { x: h0.x + 3, y: h0.y - 3 }, { x: h0.x + 2, y: h0.y + 1 }, { x: h0.x - 3, y: h0.y + 2 }]);
}

function flag(u, v, z, h, color) {
  const base = P(u, v, z), top = P(u, v, z + h);
  line(base, top, '#4a3a2a', 1.5);
  const n = 6, len = 15, fh = 9, pts = [];
  const wave = (i) => Math.sin(animTime / 260 + i * 0.9) * 2 * (i / n);
  for (let i = 0; i <= n; i++) pts.push({ x: top.x + len * i / n, y: top.y + 1 + wave(i) });
  for (let i = n; i >= 0; i--) pts.push({ x: top.x + len * i / n, y: top.y + 1 + fh + wave(i) });
  poly(color, pts);
  dot(top, 1.5, '#e8c040');
}

function sawBlade(uc, vc, zc, r) {
  const rot = animTime / 90, teeth = 14, pts = [];
  for (let i = 0; i < teeth * 2; i++) {
    const a = rot + i * Math.PI / teeth, rr = i % 2 ? r : r * 1.14;
    pts.push(P(uc + rr * Math.cos(a), vc, zc + rr * TILE_PX * Math.sin(a)));
  }
  poly('#c8ccd2', pts, '#5a5e64');
  const hub = [];
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5;
    hub.push(P(uc + r * 0.28 * Math.cos(a), vc, zc + r * 0.28 * TILE_PX * Math.sin(a)));
  }
  poly('#5a5e64', hub, null);
}

// Plot of trodden ground under a building
function ground(U, V, W, H, color, rnd, specks = '#6a5a3a') {
  const i = 0.04;
  poly(color, [P(U + i, V + i), P(U + W - i, V + i), P(U + W - i, V + H - i), P(U + i, V + H - i)], 'rgba(0,0,0,0.15)');
  for (let k = 0; k < W * H * 6; k++) dot(P(U + 0.1 + rnd() * (W - 0.2), V + 0.1 + rnd() * (H - 0.2)), 0.9, specks);
}

// Soft contact shadow under a block
function ao(u0, v0, u1, v1) {
  poly('rgba(0,0,0,0.28)', [P(u0 - 0.04, v0 - 0.04), P(u1 + 0.12, v0 - 0.04), P(u1 + 0.12, v1 + 0.12), P(u0 - 0.04, v1 + 0.12)], null);
}

// --- Buildings ---
// Pioneer hut: plank walls and a thatched roof
function drawHouseSmall(U, V, rnd, vr) {
  ground(U, V, 1, 1, '#8a7a55', rnd);
  const u0 = U + 0.24, u1 = U + 0.78, v0 = V + 0.22, v1 = V + 0.76, wh = 12;
  const wall = ['#9a7048', '#8e6842', '#a47a4e'][vr % 3];
  ao(u0, v0, u1, v1);
  const { L, R } = walls(u0, v0, u1, v1, 0, wh, wall);
  boards(L, 0.07); boards(R, 0.07);
  door(L, L.len * 0.55, 0.14, 9);
  win(R, R.len * 0.5, 4, 0.12, 4);
  roofV(u0, v0, u1, v1, wh, 15, '#c9a24e', wall, { style: 'thatch', boards: true });
  logPile(U + 0.83, V + 0.28, U + 0.95, V + 0.64, 2);
}

// Settler house: stone plinth, two half-timbered storeys, tiled roof, chimney and garden
function drawHouseMedium(U, V, rnd, vr) {
  ground(U, V, 2, 2, '#8a7a55', rnd);
  const roof = ['#b0442e', '#9c3a28', '#a85236', '#7e4a3a'][vr % 4];
  const shutter = ['#3a6a3a', '#2e5a7a', '#7a3a2a'][vr % 3];
  const plaster = '#ece0c4';

  // Garden in front
  poly('#6a9a42', [P(U + 0.3, V + 1.45), P(U + 1.75, V + 1.45), P(U + 1.75, V + 1.88), P(U + 0.3, V + 1.88)], null);
  for (let k = 0; k < 14; k++) {
    dot(P(U + 0.4 + rnd() * 1.25, V + 1.52 + rnd() * 0.3, 1), 1.2, ['#e05050', '#f0c040', '#e8e8f0', '#c060c0'][k % 4]);
  }

  const u0 = U + 0.25, u1 = U + 1.55, v0 = V + 0.2, v1 = V + 1.22;
  ao(u0, v0, u1, v1 + 0.04);
  const pl = walls(u0, v0, u1, v1, 0, 5, '#8c867a');
  stones(pl.L); stones(pl.R);
  const g = walls(u0, v0, u1, v1, 5, 19, plaster);
  timber(g.L); timber(g.R);
  // Upper storey juts out slightly, as in real timber-framed houses
  const f1 = walls(u0, v0, u1 + 0.04, v1 + 0.04, 19, 33, plaster);
  timber(f1.L); timber(f1.R);

  const dw = wallL(u0, u1, v1, 0, 19);
  door(dw, 0.72, 0.18, 15);
  walls(u0 + 0.6, v1, u0 + 0.84, v1 + 0.08, 0, 2, '#8c867a', '#a8a294');
  for (const s of [0.3, 1.1]) win(g.L, s, 4, 0.14, 7, { shutter });
  for (const s of [0.28, 0.72, 1.12]) win(f1.L, s, 4, 0.14, 7, { shutter, flowers: s !== 0.72 });
  for (const s of [0.28, 0.74]) { win(g.R, s, 4, 0.14, 7, { shutter }); win(f1.R, s, 4, 0.14, 7, { shutter }); }

  const surf = roofU(u0, v0, u1 + 0.04, v1 + 0.04, 33, 24, roof, plaster, { style: 'tile', timber: '#4a3020', vent: 0.12 });
  const cv = (v0 + v1) / 2 + 0.22;
  chimney(u0 + 0.35, cv, surf(cv + 0.06) - 2, surf(cv) + 16, vr * 0.13);

  barrel(u0 + 0.42, v1 + 0.16);
  bush(U + 1.8, V + 0.5, 0.35);
  bush(U + 1.78, V + 1.0, 0.28, '#4a8a36');
  fence(U + 0.25, V + 1.92, U + 1.82, V + 1.92);
  fence(U + 1.82, V + 1.4, U + 1.82, V + 1.92);
}

// Lumberjack's hut: log cabin, shingle roof, log pile and chopping block
function drawWoodcutter(U, V, rnd) {
  ground(U, V, 2, 2, '#7a6a48', rnd, '#c8a86a');
  bush(U + 0.2, V + 1.75, 0.3);
  const u0 = U + 0.15, u1 = U + 1.05, v0 = V + 0.15, v1 = V + 1.0, wh = 15;
  ao(u0, v0, u1, v1);
  const w = walls(u0, v0, u1, v1, 0, wh, '#8a5a30');
  logCourses(w.L, 5); logCourses(w.R, 5);
  for (let i = 0; i < 5; i++) dot(w.L.at(w.L.len, (i + 0.5) * wh / 5), 1.7, '#c89a60');
  door(w.L, 0.5, 0.16, 11, '#4a2a12');
  win(w.R, 0.42, 5, 0.14, 5, { shutter: '#5a3a1a' });
  const surf = roofV(u0, v0, u1, v1, wh, 17, '#6e5a48', '#8a5a30', { style: 'shingle', boards: true });
  const cu = (u0 + u1) / 2 + 0.2;
  chimney(cu, v0 + 0.3, surf(cu + 0.06) - 2, surf(cu) + 12, 0.4);

  logPile(U + 1.2, V + 0.18, U + 1.85, V + 0.95, 3);
  stumpWithAxe(U + 0.75, V + 1.4);
  logBand(U + 0.95, U + 1.35, V + 1.62, 2.5, 2.5);
  tree(U + 1.65, V + 1.62, 0.8);
}

// Sawmill: timber hall, open saw shed with a spinning blade, plank and log stacks
function drawSawmill(U, V, rnd) {
  ground(U, V, 3, 2, '#7a6a48', rnd, '#d8b878');
  poly('#c8a86a', [P(U + 1.8, V + 0.5), P(U + 2.9, V + 0.5), P(U + 2.9, V + 1.4), P(U + 1.8, V + 1.4)], null);

  // Main hall
  const u0 = U + 0.15, u1 = U + 1.65, v0 = V + 0.15, v1 = V + 1.2;
  ao(u0, v0, u1, v1);
  const pl = walls(u0, v0, u1, v1, 0, 5, '#8c867a');
  stones(pl.L); stones(pl.R);
  const w = walls(u0, v0, u1, v1, 5, 24, '#9a6a3a');
  boards(w.L, 0.09); boards(w.R, 0.09);
  line(w.L.at(0, w.h - 0.7), w.L.at(w.L.len, w.h - 0.7), '#4a3020', 1.6);
  line(w.R.at(0, w.h - 0.7), w.R.at(w.R.len, w.h - 0.7), '#4a3020', 1.6);
  barnDoor(wallL(u0, u1, v1, 0, 24), 0.5, 0.4, 13);
  win(w.L, 1.15, 8, 0.16, 7, { shutter: '#5a3a1a' });
  for (const s of [0.3, 0.75]) win(w.R, s, 8, 0.14, 7, { shutter: '#5a3a1a' });
  roofU(u0, v0, u1, v1, 24, 20, '#5e4e46', '#9a6a3a', { style: 'shingle', boards: true, vent: 0.14 });

  // Open saw shed
  // Roof is kept high and the bench near the front so the blade stays visible under the eave
  const s0 = U + 1.85, s1 = U + 2.85, t0 = V + 0.5, t1 = V + 1.3, ph = 34, bv = t0 + 0.6;
  logPile(U + 1.9, V + 0.06, U + 2.85, V + 0.44, 2);
  post(s0, t0, ph); post(s1, t0, ph);
  walls(s0 + 0.1, bv - 0.12, s1 - 0.1, bv + 0.12, 0, 7, '#7a5030', '#9a7048');
  logBand(s0 + 0.12, s0 + 0.5, bv, 10, 3);
  sawBlade(s0 + 0.55, bv, 12, 0.22);
  poly('#e6c27e', [P(s0 + 0.62, bv - 0.06, 7), P(s1 - 0.12, bv - 0.06, 7), P(s1 - 0.12, bv + 0.06, 7), P(s0 + 0.62, bv + 0.06, 7)]);
  post(s0, t1, ph); post(s1, t1, ph);
  roofU(s0 - 0.03, t0 - 0.03, s1 + 0.03, t1 + 0.03, ph, 9, '#5e4e46', null, { style: 'shingle' });

  // Finished planks out front
  plankStack(U + 0.35, V + 1.4, U + 1.05, V + 1.7, 5);
  plankStack(U + 1.2, V + 1.45, U + 1.7, V + 1.75, 3);
  barrel(U + 2.1, V + 1.7);
  crate(U + 2.4, V + 1.68, 0.1);
}

// Warehouse: stone base, timber barn with a big arched door, goods stacked outside
function drawWarehouse(U, V, rnd) {
  ground(U, V, 2, 2, '#9a9282', rnd, '#7a7266');
  const u0 = U + 0.12, u1 = U + 1.4, v0 = V + 0.12, v1 = V + 1.35;
  ao(u0, v0, u1, v1);
  const base = walls(u0, v0, u1, v1, 0, 11, '#8e887c');
  stones(base.L); stones(base.R);
  const w = walls(u0, v0, u1, v1, 11, 27, '#7a5030');
  boards(w.L, 0.08); boards(w.R, 0.08);
  for (const f of [w.L, w.R]) {
    line(f.at(0, 0.7), f.at(f.len, 0.7), '#3e2614', 1.6);
    line(f.at(0, f.h - 0.7), f.at(f.len, f.h - 0.7), '#3e2614', 1.6);
  }
  barnDoor(wallL(u0, u1, v1, 0, 27), (u1 - u0) / 2, 0.44, 15);
  for (const s of [0.35, 0.9]) win(w.R, s, 5, 0.14, 7, { shutter: '#4a3018' });
  for (const s of [0.2, 1.08]) win(w.L, s, 5, 0.12, 7, { shutter: '#4a3018' });
  roofV(u0, v0, u1, v1, 27, 22, '#8a3a2a', '#7a5030', { style: 'tile', boards: true, vent: 0.16 });
  flag((u0 + u1) / 2, v1 + 0.09, 49, 18, '#2a5aa8');

  // Goods
  crate(U + 1.62, V + 0.32, 0.1);
  crate(U + 1.62, V + 0.6, 0.1);
  crate(U + 1.62, V + 0.46, 0.085, 10);
  barrel(U + 1.62, V + 0.98);
  barrel(U + 1.56, V + 1.24);
  barrel(U + 1.78, V + 1.18);
  sack(U + 0.45, V + 1.62);
  sack(U + 0.64, V + 1.68);
  sack(U + 0.54, V + 1.6, 5);
}

// Irregular grey boulder with a lit top face and a crack or two
function boulder(u, v, r, rnd, z = 0) {
  const c = P(u, v, z);
  const rx = r * 45, ry = r * 26, hgt = r * 38;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(c.x + 2, c.y + 1, rx * 1.05, ry * 0.9, 0, 0, Math.PI * 2); ctx.fill();

  const n = 9, body = [], topFace = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const j = 0.8 + rnd() * 0.3;
    // Lower half of the ring sits on the ground, upper half is lifted to form the dome
    const lift = Math.sin(a) < 0 ? hgt * (0.55 + rnd() * 0.25) : 0;
    body.push({ x: c.x + Math.cos(a) * rx * j, y: c.y + Math.sin(a) * ry * j - lift });
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    topFace.push({ x: c.x - rx * 0.15 + Math.cos(a) * rx * 0.55, y: c.y - hgt * 0.72 + Math.sin(a) * ry * 0.45 });
  }
  poly('#8a867c', body, 'rgba(55,50,42,0.45)');
  poly('#aca89e', topFace, null);
  if (GAME.camera.zoom >= GROUND_LOD_ZOOM) rockTexture([body], 0.8);
}

// Rock terrain tile: one or two boulders, stable per tile
function drawRock(x, y, tile) {
  const rnd = seeded(Math.floor(hash2(x, y) * 1e9) + 7);
  const k = 0.4 + 0.6 * ((tile.stone ?? ROCK_STONE) / ROCK_STONE); // boulders shrink as they are quarried
  boulder(x - 0.12 + rnd() * 0.1, y - 0.1 + rnd() * 0.1, (0.26 + rnd() * 0.08) * k, rnd);
  if (rnd() < 0.6 && k > 0.6) boulder(x + 0.18, y + 0.15, (0.14 + rnd() * 0.06) * k, rnd);
  if (tile.ore > 0) {
    const c = P(x, y, 6);
    line({ x: c.x - 4, y: c.y }, { x: c.x + 2, y: c.y + 2 }, '#b0582a', 2);
    line({ x: c.x + 3, y: c.y - 4 }, { x: c.x + 6, y: c.y - 2 }, '#b0582a', 2);
  }
  if (tile.gold > 0) {
    const c = P(x, y, 8);
    line({ x: c.x - 3, y: c.y - 2 }, { x: c.x + 3, y: c.y }, '#e8c040', 2);
    dot({ x: c.x, y: c.y - 1 }, 1, '#fff6c0');
  }
}

// Stack of cut stone blocks (pyramid, back to front)
function stoneBlocks(u0, v0, n) {
  const s = 0.075, step = s * 2.1, hgt = s * 44;
  for (let layer = 0; layer < n; layer++) {
    for (let i = 0; i < n - layer; i++) {
      for (let j = 0; j < n - layer; j++) {
        const u = u0 + (i + layer / 2) * step, v = v0 + (j + layer / 2) * step;
        const b = walls(u - s, v - s, u + s, v + s, layer * hgt, (layer + 1) * hgt, '#b4b0a4', '#d2cec2');
        line(b.R.at(0, b.R.h * 0.5), b.R.at(b.R.len, b.R.h * 0.5), 'rgba(0,0,0,0.12)', 0.5);
      }
    }
  }
}

function pickaxe(u, v) {
  const p = P(u, v, 0);
  line({ x: p.x - 7, y: p.y + 1 }, { x: p.x + 6, y: p.y - 3 }, '#8a6034', 1.6);
  ctx.strokeStyle = '#8a8e94';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(p.x + 6, p.y + 2, 5, Math.PI * 1.05, Math.PI * 1.9);
  ctx.stroke();
}

// Stonecutter: stone hut with tiled roof, a boulder being worked, cut blocks ready for transport
function drawStonecutter(U, V, rnd) {
  ground(U, V, 2, 2, '#8a8270', rnd, '#b0aa9a');
  boulder(U + 1.55, V + 0.42, 0.34, rnd);
  // Chips around the worked boulder
  for (let k = 0; k < 10; k++) dot(P(U + 1.3 + rnd() * 0.55, V + 0.7 + rnd() * 0.35, 0), 1, '#c8c4b8');

  const u0 = U + 0.15, u1 = U + 1.05, v0 = V + 0.18, v1 = V + 1.02, wh = 14;
  ao(u0, v0, u1, v1);
  const w = walls(u0, v0, u1, v1, 0, wh, '#a29e90');
  stones(w.L); stones(w.R);
  door(w.L, 0.5, 0.16, 10);
  win(w.R, 0.42, 5, 0.13, 5, { shutter: '#5a4a3a' });
  const surf = roofV(u0, v0, u1, v1, wh, 16, '#9c4a30', '#a29e90', { style: 'tile', vent: 0.1 });
  const cu = (u0 + u1) / 2 + 0.2;
  chimney(cu, v0 + 0.3, surf(cu + 0.06) - 2, surf(cu) + 11, 0.7);

  stoneBlocks(U + 1.2, V + 1.12, 3);
  pickaxe(U + 0.75, V + 1.45);
  barrel(U + 0.35, V + 1.3);
}

// Small upturned rowing boat lying on the ground
function rowboat(u, v, len = 0.34, wid = 0.12) {
  const ring = (z, s) => Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    return P(u + Math.cos(a) * len * s, v + Math.sin(a) * wid * s, z);
  });
  poly('#6a4424', convexHull([...ring(0, 1), ...ring(4, 0.9)]));
  poly('#9a6c3c', ring(4, 0.9));
  line(P(u - len * 0.8, v, 4.2), P(u + len * 0.8, v, 4.2), 'rgba(40,24,10,0.5)', 0.8);
}

// Animals: tiny side-view sprites facing left or right on screen
function pig(u, v, face = 1) {
  const p = P(u, v, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(p.x, p.y, 6, 2.2, 0, 0, Math.PI * 2); ctx.fill();
  line({ x: p.x - 3, y: p.y }, { x: p.x - 3, y: p.y - 2.5 }, '#b87878', 1.2);
  line({ x: p.x + 3, y: p.y }, { x: p.x + 3, y: p.y - 2.5 }, '#b87878', 1.2);
  ctx.fillStyle = '#f2aaa2';
  ctx.beginPath(); ctx.ellipse(p.x, p.y - 4.5, 5.5, 3.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(120,60,50,0.6)'; ctx.lineWidth = 0.7; ctx.stroke();
  dot({ x: p.x + face * 5.5, y: p.y - 5 }, 2.6, '#f2aaa2');
  dot({ x: p.x + face * 7.6, y: p.y - 4.6 }, 1.2, '#dc8a82');
  dot({ x: p.x + face * 4.8, y: p.y - 7.3 }, 1, '#dc8a82');
}

function cow(u, v, face = 1, rnd = Math.random) {
  const p = P(u, v, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(p.x, p.y, 8, 2.8, 0, 0, Math.PI * 2); ctx.fill();
  for (const lx of [-4.5, -2, 2.5, 5]) line({ x: p.x + lx, y: p.y }, { x: p.x + lx, y: p.y - 4 }, '#5a4a3a', 1.3);
  ctx.fillStyle = '#f4f0e6';
  ctx.beginPath(); ctx.ellipse(p.x, p.y - 7, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(60,50,40,0.6)'; ctx.lineWidth = 0.7; ctx.stroke();
  for (let i = 0; i < 3; i++) dot({ x: p.x - 4 + rnd() * 7, y: p.y - 9 + rnd() * 4 }, 1.4 + rnd(), '#2a2622');
  dot({ x: p.x + face * 7.5, y: p.y - 8.5 }, 2.8, '#3a3230');
  line({ x: p.x + face * 6.5, y: p.y - 11 }, { x: p.x + face * 5.5, y: p.y - 13 }, '#e8e0cc', 1);
  line({ x: p.x + face * 8.5, y: p.y - 11 }, { x: p.x + face * 9.5, y: p.y - 13 }, '#e8e0cc', 1);
}

function hayBale(u, v, z = 0) {
  const c = cylinder(u, v, z, 0.09, 7, '#c8a040', '#e0c060');
  ctx.strokeStyle = '#a07a28'; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.ellipse(c.t.x, c.t.y, c.rx * 0.55, c.ry * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
}

// Field of grain: soil, furrows and many small golden stalks (stable per building)
function grainField(u0, v0, u1, v1, rnd) {
  poly('#8a6a3a', uvRect(u0, v0, u1, v1), 'rgba(60,40,20,0.4)');
  const rows = Math.round((v1 - v0) / 0.12);
  for (let r = 0; r <= rows; r++) {
    const v = v0 + (v1 - v0) * r / rows;
    line(P(u0, v), P(u1, v), '#b8943e', 1.6);
  }
  const sway = Math.sin(animTime / 900) * 0.6;
  for (const [col, dx] of [['#a8842e', -0.6], ['#f0d070', 0.6]]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const n = Math.round((u1 - u0) * (v1 - v0) * 55);
    for (let i = 0; i < n; i++) {
      const q = P(u0 + 0.04 + rnd() * (u1 - u0 - 0.08), v0 + 0.04 + rnd() * (v1 - v0 - 0.08));
      ctx.moveTo(q.x + dx, q.y);
      ctx.lineTo(q.x + dx + sway, q.y - 5 - rnd() * 2);
    }
    ctx.stroke();
  }
}

// Fisherman's hut: plank hut, net-drying rack, fish rack and an upturned rowing boat
function drawFisher(U, V, rnd) {
  ground(U, V, 2, 2, '#bca874', rnd, '#9a8858');
  const u0 = U + 0.18, u1 = U + 1.0, v0 = V + 0.18, v1 = V + 0.95, wh = 13;
  ao(u0, v0, u1, v1);
  const w = walls(u0, v0, u1, v1, 0, wh, '#8e6c48');
  boards(w.L, 0.07); boards(w.R, 0.07);
  door(w.L, 0.45, 0.15, 10);
  win(w.R, 0.4, 5, 0.13, 5, { shutter: '#3e5a6e' });
  roofV(u0, v0, u1, v1, wh, 14, '#5e6a78', '#8e6c48', { style: 'shingle', boards: true });

  // Net drying between two posts
  post(U + 1.2, V + 0.3, 17); post(U + 1.85, V + 0.3, 17);
  for (let i = 0; i <= 6; i++) {
    const u = U + 1.2 + i * 0.65 / 6;
    line(P(u, V + 0.3, 16), P(u, V + 0.3, 6 + Math.sin(i / 6 * Math.PI) * 2), 'rgba(50,40,30,0.6)', 0.6);
  }
  for (let j = 0; j < 4; j++) {
    const z = 15 - j * 2.6;
    line(P(U + 1.2, V + 0.3, z), P(U + 1.85, V + 0.3, z - 1.5), 'rgba(50,40,30,0.6)', 0.6);
  }
  // Drying fish on a pole
  post(U + 1.3, V + 1.05, 11); post(U + 1.85, V + 1.05, 11);
  line(P(U + 1.3, V + 1.05, 11), P(U + 1.85, V + 1.05, 11), '#5a3a1e', 1.2);
  for (let i = 1; i < 6; i++) {
    const q = P(U + 1.3 + i * 0.09, V + 1.05, 8);
    ctx.fillStyle = '#b8c4cc';
    ctx.beginPath(); ctx.ellipse(q.x, q.y, 1.2, 2.8, 0, 0, Math.PI * 2); ctx.fill();
  }
  barrel(U + 0.3, V + 1.3);
  rowboat(U + 0.85, V + 1.6);
}

// Grain farm: small thatched farmhouse and golden fields
function drawGrainFarm(U, V, rnd) {
  ground(U, V, 3, 3, '#8a7a55', rnd);
  grainField(U + 1.3, V + 0.12, U + 2.88, V + 2.88, rnd);
  grainField(U + 0.12, V + 1.3, U + 1.22, V + 2.88, rnd);

  const u0 = U + 0.14, u1 = U + 1.1, v0 = V + 0.14, v1 = V + 1.05, wh = 13;
  ao(u0, v0, u1, v1);
  const w = walls(u0, v0, u1, v1, 0, wh, '#e8dcc0');
  timber(w.L); timber(w.R);
  door(w.L, 0.5, 0.16, 10);
  win(w.R, 0.45, 4, 0.14, 5, { shutter: '#3a6a3a' });
  roofV(u0, v0, u1, v1, wh, 16, '#c9a24e', '#e8dcc0', { style: 'thatch', timber: '#4a3020' });

  hayBale(U + 1.2, V + 1.2);
  hayBale(U + 1.05, V + 1.28, 0);
  // Scarecrow
  const sc = P(U + 2.1, V + 1.6, 0);
  line(sc, { x: sc.x, y: sc.y - 16 }, '#5a3a1e', 1.2);
  line({ x: sc.x - 6, y: sc.y - 11 }, { x: sc.x + 6, y: sc.y - 12 }, '#5a3a1e', 1.2);
  dot({ x: sc.x, y: sc.y - 17 }, 2.5, '#e0c080');
  poly('#6a4a2a', [{ x: sc.x - 4, y: sc.y - 18.5 }, { x: sc.x + 4, y: sc.y - 18.5 }, { x: sc.x, y: sc.y - 23 }]);
}

// Pig farm: sty with a thatched roof, fenced mud pen with pigs and a trough
function drawPigFarm(U, V, rnd) {
  ground(U, V, 2, 2, '#8a7a55', rnd);
  ctx.fillStyle = '#6a5232';
  const m = P(U + 1.3, V + 1.35);
  ctx.beginPath(); ctx.ellipse(m.x, m.y, 30, 13, 0, 0, Math.PI * 2); ctx.fill();

  const u0 = U + 0.12, u1 = U + 0.95, v0 = V + 0.12, v1 = V + 0.85, wh = 10;
  ao(u0, v0, u1, v1);
  const w = walls(u0, v0, u1, v1, 0, wh, '#8a6440');
  boards(w.L, 0.08); boards(w.R, 0.08);
  door(w.R, 0.36, 0.2, 7, '#4a2a12');
  roofU(u0, v0, u1, v1, wh, 11, '#c9a24e', '#8a6440', { style: 'thatch', boards: true });

  walls(U + 1.1, V + 0.3, U + 1.7, V + 0.42, 0, 3, '#7a5030', '#5a7a9a'); // water trough
  pig(U + 1.0, V + 1.3, 1);
  pig(U + 1.5, V + 1.0, -1);
  pig(U + 1.35, V + 1.65, 1);
  fence(U + 0.08, V + 1.94, U + 1.94, V + 1.94);
  fence(U + 1.94, V + 0.1, U + 1.94, V + 1.94);
}

// Cattle farm: big barn, fenced pasture with cows and hay
function drawCattleFarm(U, V, rnd) {
  ground(U, V, 3, 3, '#7aa04a', rnd, '#5a8a36');
  const u0 = U + 0.12, u1 = U + 1.6, v0 = V + 0.12, v1 = V + 1.2;
  ao(u0, v0, u1, v1);
  const base = walls(u0, v0, u1, v1, 0, 5, '#8c867a');
  stones(base.L); stones(base.R);
  const w = walls(u0, v0, u1, v1, 5, 22, '#a8402e');
  boards(w.L, 0.1); boards(w.R, 0.1);
  for (const f of [w.L, w.R]) {
    line(f.at(0, 0.7), f.at(f.len, 0.7), '#f0e8d8', 1.4);
    line(f.at(0, f.h - 0.7), f.at(f.len, f.h - 0.7), '#f0e8d8', 1.4);
  }
  barnDoor(wallL(u0, u1, v1, 0, 22), 0.7, 0.42, 12);
  win(w.R, 0.5, 7, 0.14, 6, { shutter: '#f0e8d8' });
  roofU(u0, v0, u1, v1, 22, 18, '#5e4e46', '#a8402e', { style: 'shingle', boards: true, vent: 0.14 });

  hayBale(U + 1.85, V + 0.4);
  hayBale(U + 2.1, V + 0.5);
  hayBale(U + 1.95, V + 0.62, 7);
  cow(U + 0.8, V + 1.9, 1, rnd);
  cow(U + 1.9, V + 1.5, -1, rnd);
  cow(U + 2.3, V + 2.3, 1, rnd);
  fence(U + 0.08, V + 2.94, U + 2.94, V + 2.94);
  fence(U + 2.94, V + 0.1, U + 2.94, V + 2.94);
  fence(U + 0.08, V + 1.4, U + 0.08, V + 2.94);
}

// Shipyard: workshop, slipway with a hull under construction, a crane and timber
function drawShipyard(U, V, rnd) {
  ground(U, V, 3, 3, '#a89870', rnd, '#8a7a5a');
  const u0 = U + 0.12, u1 = U + 1.05, v0 = V + 0.12, v1 = V + 0.95;
  ao(u0, v0, u1, v1);
  const w = walls(u0, v0, u1, v1, 0, 15, '#8a6038');
  boards(w.L, 0.08); boards(w.R, 0.08);
  door(w.L, 0.45, 0.18, 11);
  win(w.R, 0.4, 6, 0.14, 6, { shutter: '#4a3018' });
  roofU(u0, v0, u1, v1, 15, 14, '#5e4e46', '#8a6038', { style: 'shingle', boards: true });
  logPile(U + 1.3, V + 0.15, U + 2.85, V + 0.75, 3);

  // Slipway ramp
  const ramp = uvRect(U + 0.35, V + 1.3, U + 2.9, V + 2.4);
  poly('#8a6a44', ramp, 'rgba(50,30,10,0.5)');
  for (let i = 1; i < 12; i++) {
    const u = U + 0.35 + i * 2.55 / 12;
    line(P(u, V + 1.3), P(u, V + 2.4), 'rgba(50,30,10,0.35)', 0.7);
  }
  // Hull skeleton: keel plus U-shaped ribs, lower planks already fitted
  const kv = V + 1.85, ka = U + 0.75, kb = U + 2.55;
  line(P(ka, kv, 3), P(kb, kv, 3), '#5a3a1e', 2.2);
  for (let i = 0; i <= 9; i++) {
    const t = i / 9, u = ka + (kb - ka) * t, half = 0.08 + 0.3 * Math.sin(Math.PI * (0.1 + 0.8 * t));
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const a = Math.PI * k / 8;
      pts.push(P(u, kv - Math.cos(a) * half, 3 + (1 - Math.sin(a)) * 16));
    }
    ctx.strokeStyle = '#6a4422';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    pts.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();
  }
  for (const z of [5, 8]) line(P(ka + 0.1, kv + 0.25, z), P(kb - 0.1, kv + 0.25, z), '#8a5a2e', 1.8);

  // Crane with a hanging beam
  post(U + 2.7, V + 1.15, 36);
  const top = P(U + 2.7, V + 1.15, 36), tip = P(U + 1.9, V + 1.55, 34);
  line(top, tip, '#5a3a1e', 1.8);
  line(tip, P(U + 1.9, V + 1.55, 18), 'rgba(40,30,20,0.8)', 0.8);
  logBand(U + 1.7, U + 2.1, V + 1.55, 16, 2);
  plankStack(U + 0.2, V + 2.55, U + 0.9, V + 2.85, 3);
}

function sheep(u, v, face = 1) {
  const p = P(u, v, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(p.x, p.y, 5.5, 2, 0, 0, Math.PI * 2); ctx.fill();
  line({ x: p.x - 2.5, y: p.y }, { x: p.x - 2.5, y: p.y - 3 }, '#3a3230', 1.1);
  line({ x: p.x + 2.5, y: p.y }, { x: p.x + 2.5, y: p.y - 3 }, '#3a3230', 1.1);
  // Fluffy fleece from overlapping puffs
  for (const [dx, dy, r] of [[-2.5, -5, 3], [1, -6, 3.2], [3, -4.5, 2.6], [-0.5, -4, 3]]) dot({ x: p.x + dx, y: p.y + dy }, r, '#f2eee4');
  dot({ x: p.x + face * 5, y: p.y - 5.5 }, 1.9, '#3a3230');
}

// Level 1 house plot: two pioneer huts and a vegetable patch
function drawPioneerPlot(U, V, rnd, vr) {
  ground(U, V, 2, 2, '#8a7a55', rnd);
  poly('#6a5232', uvRect(U + 1.12, V + 1.12, U + 1.88, V + 1.88), 'rgba(40,30,15,0.4)');
  for (let i = 0; i < 4; i++) {
    const v = V + 1.22 + i * 0.18;
    for (let j = 0; j < 4; j++) dot(P(U + 1.22 + j * 0.18, v, 1), 1.5, '#5a9a38');
  }
  drawHouseSmall(U + 1, V, rnd, vr);
  drawHouseSmall(U, V + 1, rnd, vr + 1);
  fence(U + 1.1, V + 1.94, U + 1.94, V + 1.94);
  fence(U + 1.94, V + 1.1, U + 1.94, V + 1.94);
}

// Level 3: merchant's town house - ashlar ground floor, two timbered storeys, slate roof
function drawMerchantHouse(U, V, rnd, vr) {
  ground(U, V, 2, 2, '#9a9282', rnd, '#7a7266');
  const roof = ['#4a5a6e', '#5a4a6a', '#3e5a5a'][vr % 3];
  const shutter = ['#7a2a2a', '#2a4a6a', '#2a5a3a'][vr % 3];
  const u0 = U + 0.15, u1 = U + 1.6, v0 = V + 0.15, v1 = V + 1.4;
  ao(u0, v0, u1, v1 + 0.05);
  const g = walls(u0, v0, u1, v1, 0, 16, '#d8cdb4');
  stones(g.L); stones(g.R);
  barnDoor(wallL(u0, u1, v1, 0, 16), 0.72, 0.26, 8);
  for (const s of [0.3, 1.15]) win(g.L, s, 5, 0.14, 7, { shutter });
  for (const s of [0.3, 0.9]) win(g.R, s, 5, 0.14, 7, { shutter });
  const f1 = walls(u0, v0, u1 + 0.04, v1 + 0.04, 16, 29, '#efe4ca');
  timber(f1.L, '#5a3020', 0.24); timber(f1.R, '#5a3020', 0.24);
  for (const s of [0.28, 0.72, 1.16]) win(f1.L, s, 4, 0.13, 7, { shutter, flowers: true });
  for (const s of [0.3, 0.9]) win(f1.R, s, 4, 0.13, 7, { shutter });
  const f2 = walls(u0, v0, u1 + 0.08, v1 + 0.08, 29, 41, '#efe4ca');
  timber(f2.L, '#5a3020', 0.24); timber(f2.R, '#5a3020', 0.24);
  for (const s of [0.28, 0.72, 1.16]) win(f2.L, s, 3, 0.13, 7, { shutter });
  for (const s of [0.3, 0.9]) win(f2.R, s, 3, 0.13, 7, { shutter });
  const surf = roofU(u0, v0, u1 + 0.08, v1 + 0.08, 41, 28, roof, '#efe4ca', { style: 'tile', timber: '#5a3020', vent: 0.14 });
  const vm = (v0 + v1 + 0.08) / 2;
  chimney(u0 + 0.3, vm + 0.25, surf(vm + 0.31) - 2, surf(vm + 0.25) + 14, vr * 0.1);
  chimney(u1 - 0.25, vm + 0.25, surf(vm + 0.31) - 2, surf(vm + 0.25) + 14, vr * 0.1 + 0.5);
  // Gilded weathervane on the ridge
  const ridge = P((u0 + u1) / 2, vm, 41 + 28);
  line(ridge, { x: ridge.x, y: ridge.y - 10 }, '#8a6a2a', 1.2);
  poly('#e8c040', [{ x: ridge.x, y: ridge.y - 10 }, { x: ridge.x + 6, y: ridge.y - 8 }, { x: ridge.x, y: ridge.y - 6 }]);
  bush(U + 1.82, V + 0.45, 0.3);
  bush(U + 1.8, V + 1.2, 0.26, '#4a8a36');
  barrel(u0 + 0.45, v1 + 0.2);
}

function drawHouse(U, V, rnd, vr, b) {
  const level = b?.level || 1;
  if (level === 1) drawPioneerPlot(U, V, rnd, vr);
  else if (level === 2) drawHouseMedium(U, V, rnd, vr);
  else if (level === 3) drawMerchantHouse(U, V, rnd, vr);
  else drawNobleHouse(U, V, rnd, vr);
}

// Sheep farm: shepherd's shed and a fenced pasture
function drawSheepFarm(U, V, rnd) {
  ground(U, V, 2, 2, '#7aa04a', rnd, '#5a8a36');
  const u0 = U + 0.12, u1 = U + 0.9, v0 = V + 0.12, v1 = V + 0.8, wh = 11;
  ao(u0, v0, u1, v1);
  const w = walls(u0, v0, u1, v1, 0, wh, '#9a7a52');
  boards(w.L, 0.08); boards(w.R, 0.08);
  door(w.L, 0.4, 0.16, 8);
  roofV(u0, v0, u1, v1, wh, 12, '#c9a24e', '#9a7a52', { style: 'thatch', boards: true });
  sheep(U + 1.3, V + 0.6, -1);
  sheep(U + 0.7, V + 1.35, 1);
  sheep(U + 1.4, V + 1.45, -1);
  sheep(U + 1.1, V + 1.0, 1);
  fence(U + 0.08, V + 1.94, U + 1.94, V + 1.94);
  fence(U + 1.94, V + 0.1, U + 1.94, V + 1.94);
}

// Weaver: timbered workshop, coloured cloth drying on a line, baskets of wool
function drawWeaver(U, V, rnd) {
  ground(U, V, 2, 2, '#9a8a64', rnd);
  const u0 = U + 0.14, u1 = U + 1.1, v0 = V + 0.14, v1 = V + 1.0;
  ao(u0, v0, u1, v1);
  const pl = walls(u0, v0, u1, v1, 0, 4, '#8c867a');
  stones(pl.L); stones(pl.R);
  const w = walls(u0, v0, u1, v1, 4, 18, '#ece0c4');
  timber(w.L); timber(w.R);
  door(wallL(u0, u1, v1, 0, 18), 0.5, 0.17, 13);
  win(w.L, 0.2, 4, 0.12, 7, { shutter: '#6a3a6a' });
  win(w.R, 0.45, 4, 0.14, 7, { shutter: '#6a3a6a' });
  roofV(u0, v0, u1, v1, 18, 16, '#a85236', '#ece0c4', { style: 'tile', timber: '#4a3020' });
  post(U + 1.25, V + 1.3, 14); post(U + 1.9, V + 1.3, 14);
  line(P(U + 1.25, V + 1.3, 14), P(U + 1.9, V + 1.3, 14), '#5a3a1e', 0.8);
  ['#c04040', '#3a6ab0', '#e0b040', '#5a9a4a'].forEach((c, i) => {
    const a = U + 1.3 + i * 0.15;
    poly(c, [P(a, V + 1.3, 13.5), P(a + 0.11, V + 1.3, 13.5), P(a + 0.11, V + 1.3, 5 + (i % 2) * 2), P(a, V + 1.3, 5 + (i % 2) * 2)]);
  });
  for (const [u, v] of [[U + 0.4, V + 1.45], [U + 0.65, V + 1.6]]) {
    const c = cylinder(u, v, 0, 0.08, 6, '#a8844a', '#f2eee4');
    dot({ x: c.t.x, y: c.t.y - 1 }, 3, '#f2eee4');
  }
}

// Hop farm: rows of tall hop poles with climbing bines and a round oast house with a white cowl
function drawHopFarm(U, V, rnd) {
  ground(U, V, 3, 3, '#7a8a4a', rnd, '#5a6a36');
  poly('#6a5a36', uvRect(U + 1.25, V + 0.15, U + 2.88, V + 2.88), 'rgba(40,30,15,0.4)');
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const u = U + 1.45 + c * 0.42, v = V + 0.35 + r * 0.7;
      line(P(u, v, 0), P(u, v, 26), '#6a4a2a', 1.2);
      for (let k = 0; k < 5; k++) dot(P(u + Math.sin(k * 2.1) * 0.03, v, 6 + k * 4), 2.6, k % 2 ? '#6aa03a' : '#4e8a2e');
      dot(P(u + 0.04, v, 18), 1.4, '#b8d860');
    }
    line(P(U + 1.45, V + 0.35 + r * 0.7, 26), P(U + 2.71, V + 0.35 + r * 0.7, 26), 'rgba(60,40,20,0.6)', 0.7);
  }
  // Oast house: round brick kiln with a conical roof and white cowl
  const cx = U + 0.65, cy = V + 0.7;
  const k = cylinder(cx, cy, 0, 0.36, 18, '#a8583a', '#8a4a30');
  ctx.strokeStyle = 'rgba(60,30,15,0.35)'; ctx.lineWidth = 0.6;
  for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.ellipse(k.b.x, k.b.y - i * 3.6, k.rx, k.ry, 0, 0, Math.PI); ctx.stroke(); }
  const tip = P(cx, cy, 40);
  poly('#6a5a4e', [{ x: k.t.x - k.rx - 2, y: k.t.y }, { x: k.t.x + k.rx + 2, y: k.t.y }, tip]);
  poly('#58483e', [{ x: k.t.x - k.rx - 2, y: k.t.y }, { x: k.t.x, y: k.t.y + 3 }, tip], null);
  poly('#f2eee4', [{ x: tip.x - 3, y: tip.y + 5 }, { x: tip.x + 4, y: tip.y + 4 }, { x: tip.x + 5, y: tip.y - 3 }, { x: tip.x - 2, y: tip.y - 4 }]);
  const dw = { len: 1, h: 18, at: (s, t) => P(cx - 0.18 + s * 0.36, cy + 0.36, t) };
  door(dw, 0.5, 0.35, 10, '#4a2a12');
  sack(U + 1.0, V + 1.5);
  sack(U + 0.8, V + 1.6);
}

// Brewery: stone brewhouse with a tall chimney, barrels and a hanging sign
function drawBrewery(U, V, rnd) {
  ground(U, V, 2, 2, '#9a9282', rnd, '#7a7266');
  const u0 = U + 0.14, u1 = U + 1.2, v0 = V + 0.14, v1 = V + 1.05;
  ao(u0, v0, u1, v1);
  const w = walls(u0, v0, u1, v1, 0, 20, '#b8ac94');
  stones(w.L); stones(w.R);
  barnDoor(wallL(u0, u1, v1, 0, 20), 0.55, 0.3, 10);
  win(w.L, 0.18, 9, 0.12, 7, { lit: true });
  for (const s of [0.3, 0.7]) win(w.R, s, 9, 0.13, 7, { lit: true });
  const surf = roofU(u0, v0, u1, v1, 20, 16, '#8a3a2a', '#b8ac94', { style: 'tile', vent: 0.12 });
  const vm = (v0 + v1) / 2;
  chimney(u0 + 0.25, vm + 0.2, surf(vm + 0.26) - 2, surf(vm + 0.2) + 24, 0.3);
  // Sign on a bracket
  const sp = P(u1 + 0.02, v1 - 0.1, 17);
  line(sp, { x: sp.x + 8, y: sp.y - 4 }, '#3a2616', 1.2);
  poly('#e8c050', [{ x: sp.x + 4, y: sp.y - 2 }, { x: sp.x + 11, y: sp.y - 5.5 }, { x: sp.x + 11, y: sp.y + 1.5 }, { x: sp.x + 4, y: sp.y + 5 }]);
  for (const [u, v, z] of [[U + 1.45, V + 0.4, 0], [U + 1.62, V + 0.55, 0], [U + 1.45, V + 0.7, 0], [U + 1.53, V + 0.55, 11]]) barrel(u, v, z);
  barrel(U + 0.5, V + 1.35);
  crate(U + 1.5, V + 1.35, 0.1);
}

// Forester: small log lodge with a green roof, a tree nursery and a watering can
function drawForester(U, V, rnd) {
  ground(U, V, 2, 2, '#7a8a4a', rnd, '#5a6a36');
  poly('#6a5232', uvRect(U + 1.05, V + 0.12, U + 1.9, V + 1.9), 'rgba(40,30,15,0.4)');
  const u0 = U + 0.14, u1 = U + 0.92, v0 = V + 0.14, v1 = V + 0.9, wh = 12;
  ao(u0, v0, u1, v1);
  const w = walls(u0, v0, u1, v1, 0, wh, '#8a5a30');
  logCourses(w.L, 4); logCourses(w.R, 4);
  door(w.L, 0.45, 0.15, 9, '#4a2a12');
  win(w.R, 0.38, 4, 0.13, 5, { shutter: '#3a6a3a' });
  roofV(u0, v0, u1, v1, wh, 13, '#4a7a3a', '#8a5a30', { style: 'shingle', boards: true });
  // Rows of saplings in the nursery
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const tr = { u: 0, v: 0, s: 0.32 + ((r + c) % 3) * 0.08, conifer: (r + c) % 2 === 0, key: (r + c) % 2 ? 'd1' : 'c1',
                   dark: '#2e6624', mid: '#4a9232', light: '#7abe50' };
      drawTreeAt(U + 1.25 + c * 0.28, V + 0.35 + r * 0.55, tr);
    }
  }
  const wc = P(U + 0.55, V + 1.35, 0);
  poly('#8a9aa8', [{ x: wc.x - 3, y: wc.y }, { x: wc.x + 3, y: wc.y }, { x: wc.x + 3, y: wc.y - 5 }, { x: wc.x - 3, y: wc.y - 5 }]);
  line({ x: wc.x + 3, y: wc.y - 4 }, { x: wc.x + 7, y: wc.y - 7 }, '#8a9aa8', 1.4);
  fence(U + 1.02, V + 1.94, U + 1.94, V + 1.94);
  fence(U + 1.94, V + 0.1, U + 1.94, V + 1.94);
}

// Stack of red bricks
function brickStack(u, v, n = 3) {
  for (let i = 0; i < n; i++) {
    const b = walls(u - 0.12, v - 0.08, u + 0.12, v + 0.08, i * 3.2, i * 3.2 + 3, '#b04a30', '#c8603e');
    line(b.R.at(0, b.R.h / 2), b.R.at(b.R.len, b.R.h / 2), 'rgba(0,0,0,0.25)', 0.5);
  }
}

// Clay pit: dug-out pit with clay mounds, drying racks and a small shed
function drawClayPit(U, V, rnd) {
  ground(U, V, 2, 2, '#9a8a5a', rnd, '#7a6a40');
  poly('#8a5a3a', uvRect(U + 0.9, V + 0.2, U + 1.85, V + 1.2), 'rgba(50,30,15,0.5)');
  poly('#6a4228', uvRect(U + 1.05, V + 0.35, U + 1.7, V + 1.05), null);
  for (const [u, v] of [[U + 1.2, V + 1.45], [U + 1.5, V + 1.6], [U + 0.9, V + 1.65]]) {
    const p = P(u, v, 0);
    ctx.fillStyle = '#a0643e';
    ctx.beginPath(); ctx.ellipse(p.x, p.y - 2, 7, 4, 0, Math.PI, 0); ctx.fill();
  }
  const u0 = U + 0.12, u1 = U + 0.72, v0 = V + 0.15, v1 = V + 0.75;
  ao(u0, v0, u1, v1);
  const w = walls(u0, v0, u1, v1, 0, 10, '#8a6440');
  boards(w.L, 0.08); boards(w.R, 0.08);
  door(w.L, 0.3, 0.14, 7);
  roofV(u0, v0, u1, v1, 10, 9, '#6e5a48', '#8a6440', { style: 'shingle' });
  rowboat(U + 0.5, V + 1.35, 0.2, 0.08); // wheelbarrow-like trough
}

// Brickworks: brick kiln with a tall chimney and stacks of fresh bricks
function drawBrickworks(U, V, rnd) {
  ground(U, V, 2, 2, '#9a8a6a', rnd, '#7a6a50');
  const u0 = U + 0.14, u1 = U + 1.15, v0 = V + 0.14, v1 = V + 1.0;
  ao(u0, v0, u1, v1);
  const w = walls(u0, v0, u1, v1, 0, 16, '#a8543a');
  stones(w.L); stones(w.R);
  // Glowing kiln mouth
  poly('#2a1a10', rectOn(w.L, 0.35, 0, 0.65, 8), null);
  poly(`rgba(255,${140 + Math.floor(Math.sin(animTime / 200) * 40)},40,0.9)`, rectOn(w.L, 0.4, 1, 0.6, 6), null);
  const surf = roofU(u0, v0, u1, v1, 16, 12, '#5e4e46', '#a8543a', { style: 'shingle' });
  const vm = (v0 + v1) / 2;
  chimney(u0 + 0.7, vm + 0.15, surf(vm + 0.21) - 2, surf(vm + 0.15) + 26, 0.2);
  brickStack(U + 1.45, V + 0.4, 3);
  brickStack(U + 1.45, V + 0.75, 2);
  brickStack(U + 0.5, V + 1.4, 3);
  brickStack(U + 0.85, V + 1.5, 2);
}

// Charcoal kiln: smoking earth-covered wood mound, split wood stacks
function drawCharcoal(U, V, rnd) {
  ground(U, V, 2, 2, '#6a6048', rnd, '#3a3428');
  const c = P(U + 0.95, V + 0.95, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(c.x, c.y + 2, 34, 16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a3e30';
  ctx.beginPath(); ctx.ellipse(c.x, c.y, 30, 14, 0, Math.PI, 0); ctx.lineTo(c.x + 30, c.y); ctx.fill();
  ctx.fillStyle = '#3a3026';
  ctx.beginPath(); ctx.ellipse(c.x, c.y - 4, 22, 20, 0, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.8; ctx.stroke();
  smoke({ x: c.x - 4, y: c.y - 24 }, 0.1);
  smoke({ x: c.x + 8, y: c.y - 18 }, 0.6);
  logPile(U + 1.45, V + 1.2, U + 1.9, V + 1.85, 3);
  logPile(U + 0.15, V + 1.4, U + 0.6, V + 1.85, 2);
}

// Iron mine: timbered tunnel mouth into a rocky hillock, rails and an ore cart
function drawMine(U, V, rnd) {
  ground(U, V, 2, 2, '#8a8474', rnd, '#6a665c');
  boulder(U + 0.8, V + 0.6, 0.55, rnd);
  const m = P(U + 0.95, V + 1.05, 0);
  poly('#1a1410', [{ x: m.x - 8, y: m.y }, { x: m.x + 8, y: m.y }, { x: m.x + 8, y: m.y - 13 }, { x: m.x, y: m.y - 17 }, { x: m.x - 8, y: m.y - 13 }], null);
  line({ x: m.x - 9, y: m.y }, { x: m.x - 9, y: m.y - 14 }, '#6a4422', 2.4);
  line({ x: m.x + 9, y: m.y }, { x: m.x + 9, y: m.y - 14 }, '#6a4422', 2.4);
  line({ x: m.x - 11, y: m.y - 14 }, { x: m.x + 11, y: m.y - 14 }, '#6a4422', 2.6);
  for (const off of [-0.07, 0.07]) line(P(U + 0.95 + off, V + 1.1), P(U + 0.95 + off, V + 1.9), '#5a5a5a', 1.2);
  for (let i = 0; i < 5; i++) line(P(U + 0.85, V + 1.2 + i * 0.16), P(U + 1.05, V + 1.2 + i * 0.16), '#6a4422', 1.2);
  const cart = walls(U + 0.85, V + 1.45, U + 1.05, V + 1.7, 1, 6, '#5a5a60', '#7a7a80');
  dot(P(U + 0.95, V + 1.57, 7), 2.5, '#8a4a2a');
  const pile = P(U + 1.55, V + 1.5, 0);
  ctx.fillStyle = '#7a4a30';
  ctx.beginPath(); ctx.ellipse(pile.x, pile.y - 2, 10, 6, 0, Math.PI, 0); ctx.fill();
  for (let i = 0; i < 5; i++) dot({ x: pile.x - 6 + i * 3, y: pile.y - 3 - (i % 2) * 2 }, 1.4, '#b0582a');
}

// Smithy: stone forge with a glowing hearth, anvil and a big chimney
function drawSmithy(U, V, rnd) {
  ground(U, V, 2, 2, '#8a8474', rnd, '#5a564c');
  const u0 = U + 0.14, u1 = U + 1.1, v0 = V + 0.14, v1 = V + 1.0;
  ao(u0, v0, u1, v1);
  const w = walls(u0, v0, u1, v1, 0, 15, '#8e887c');
  stones(w.L); stones(w.R);
  const glow = 150 + Math.floor(Math.sin(animTime / 150) * 50);
  poly('#2a1a10', rectOn(w.L, 0.3, 0, 0.7, 10), null);
  poly(`rgba(255,${glow},50,0.85)`, rectOn(w.L, 0.36, 1, 0.64, 6), null);
  win(w.R, 0.42, 6, 0.14, 6, { lit: true });
  const surf = roofV(u0, v0, u1, v1, 15, 13, '#4a4a52', '#8e887c', { style: 'shingle' });
  const cu = (u0 + u1) / 2 + 0.22;
  chimney(cu, v0 + 0.25, surf(cu + 0.06) - 2, surf(cu) + 20, 0.8);
  // Anvil on a stump
  const a = cylinder(U + 1.4, V + 1.3, 0, 0.08, 5, '#6a4422', '#8a6034');
  poly('#3a3a40', [{ x: a.t.x - 6, y: a.t.y - 1 }, { x: a.t.x + 6, y: a.t.y - 1 }, { x: a.t.x + 4, y: a.t.y - 5 }, { x: a.t.x - 7, y: a.t.y - 5 }]);
  crate(U + 1.6, V + 0.5, 0.09);
  barrel(U + 0.45, V + 1.4);
}

// Market stall with a striped awning
function stall(u, v, color, rnd) {
  const w = walls(u - 0.2, v - 0.14, u + 0.2, v + 0.14, 0, 6, '#8a6440', '#a07850');
  post(u - 0.2, v + 0.14, 13); post(u + 0.2, v + 0.14, 13);
  const z = 13;
  const aw = [P(u - 0.24, v - 0.18, z + 2), P(u + 0.24, v - 0.18, z + 2), P(u + 0.24, v + 0.22, z - 2), P(u - 0.24, v + 0.22, z - 2)];
  poly(color, aw);
  for (let i = 1; i < 4; i++) line(lerp(aw[0], aw[1], i / 4), lerp(aw[3], aw[2], i / 4), '#f4ecda', 1.6);
  for (let i = 0; i < 4; i++) dot(P(u - 0.12 + i * 0.08, v, 7), 1.6, ['#e04a3a', '#f0c040', '#6aa03a', '#e88a2a'][Math.floor(rnd() * 4)]);
}

// Market square: cobbled square with stalls, crates and a well
function drawMarketplace(U, V, rnd) {
  ground(U, V, 3, 3, '#a09884', rnd, '#8a8272');
  for (let i = 1; i < 6; i++) {
    line(P(U + 0.1, V + i * 0.5), P(U + 2.9, V + i * 0.5), 'rgba(80,70,60,0.25)', 0.6);
    line(P(U + i * 0.5, V + 0.1), P(U + i * 0.5, V + 2.9), 'rgba(80,70,60,0.25)', 0.6);
  }
  stall(U + 0.6, V + 0.6, '#b03a3a', rnd);
  stall(U + 1.5, V + 0.55, '#3a6ab0', rnd);
  stall(U + 2.4, V + 0.6, '#3a8a4a', rnd);
  stall(U + 0.6, V + 1.6, '#c8902a', rnd);
  // Well in the middle
  const wl = cylinder(U + 1.6, V + 1.7, 0, 0.18, 6, '#8e887c', '#3a5a7a');
  post(U + 1.45, V + 1.7, 16); post(U + 1.75, V + 1.7, 16);
  line(P(U + 1.45, V + 1.7, 16), P(U + 1.75, V + 1.7, 16), '#5a3a1e', 1.6);
  crate(U + 2.4, V + 1.6, 0.1);
  barrel(U + 2.55, V + 2.3);
  sack(U + 0.8, V + 2.4);
  sack(U + 1.0, V + 2.5);
  stall(U + 2.2, V + 2.4, '#8a3a8a', rnd);
}

// Chapel: whitewashed stone nave with a bell tower and a cross
function drawChapel(U, V, rnd) {
  ground(U, V, 2, 2, '#8a9a5a', rnd, '#6a7a3a');
  const u0 = U + 0.12, u1 = U + 1.45, v0 = V + 0.3, v1 = V + 1.0;
  ao(u0, v0, u1, v1);
  const w = walls(u0, v0, u1, v1, 0, 16, '#e8e2d4');
  stones(w.L); stones(w.R);
  for (const s of [0.35, 0.75, 1.1]) {
    poly('#4a6a9a', rectOn(w.L, s - 0.05, 5, s + 0.05, 12), '#3a2616');
    dot(w.L.at(s, 12), 2.5, '#4a6a9a');
  }
  roofU(u0, v0, u1, v1, 16, 16, '#5a5a66', '#e8e2d4', { style: 'tile', vent: 0.1 });
  // Bell tower at the front
  const tu = u1 - 0.05, tv = v1 - 0.05;
  const t = walls(tu - 0.28, tv - 0.28, tu + 0.12, tv + 0.12, 0, 34, '#e8e2d4');
  stones(t.L); stones(t.R);
  poly('#2a1a10', rectOn(t.R, 0.12, 24, 0.28, 30), null);
  door(wallL(tu - 0.28, tu + 0.12, tv + 0.12, 0, 34), 0.2, 0.18, 12, '#6a3a1a');
  const tip = P(tu - 0.08, tv - 0.08, 52);
  poly('#4a4a56', [P(tu - 0.32, tv + 0.16, 34), P(tu + 0.16, tv + 0.16, 34), tip]);
  poly('#5a5a66', [P(tu + 0.16, tv + 0.16, 34), P(tu + 0.16, tv - 0.32, 34), tip]);
  line(tip, { x: tip.x, y: tip.y - 8 }, '#e8c040', 1.6);
  line({ x: tip.x - 3, y: tip.y - 5.5 }, { x: tip.x + 3, y: tip.y - 5.5 }, '#e8c040', 1.6);
  bush(U + 0.4, V + 1.55, 0.25);
  bush(U + 1.7, V + 1.6, 0.28);
}

// Tavern: timbered inn with a hanging sign, benches and barrels
function drawTavern(U, V, rnd) {
  ground(U, V, 2, 2, '#9a8a64', rnd);
  const u0 = U + 0.14, u1 = U + 1.2, v0 = V + 0.14, v1 = V + 1.0;
  ao(u0, v0, u1, v1);
  const pl = walls(u0, v0, u1, v1, 0, 5, '#8c867a');
  stones(pl.L); stones(pl.R);
  const g = walls(u0, v0, u1, v1, 5, 18, '#ece0c4');
  timber(g.L); timber(g.R);
  const f1 = walls(u0, v0, u1 + 0.04, v1 + 0.04, 18, 29, '#ece0c4');
  timber(f1.L); timber(f1.R);
  door(wallL(u0, u1, v1, 0, 18), 0.55, 0.18, 13, '#6a3a1a');
  for (const s of [0.22, 0.9]) win(g.L, s, 4, 0.14, 7, { lit: true });
  for (const s of [0.3, 0.7]) { win(g.R, s, 4, 0.13, 7, { lit: true }); win(f1.R, s, 3, 0.13, 6, { shutter: '#7a2a2a' }); }
  const surf = roofU(u0, v0, u1 + 0.04, v1 + 0.04, 29, 18, '#9c4a30', '#ece0c4', { style: 'tile', timber: '#4a3020' });
  const vm = (v0 + v1) / 2;
  chimney(u0 + 0.25, vm + 0.2, surf(vm + 0.26) - 2, surf(vm + 0.2) + 12, 0.45);
  const sp = P(u0 + 0.1, v1 + 0.04, 20);
  line(sp, { x: sp.x - 8, y: sp.y + 4 }, '#3a2616', 1.2);
  poly('#e8c050', [{ x: sp.x - 12, y: sp.y + 4 }, { x: sp.x - 4, y: sp.y + 4 }, { x: sp.x - 4, y: sp.y + 11 }, { x: sp.x - 12, y: sp.y + 11 }]);
  walls(U + 1.35, V + 0.4, U + 1.8, V + 0.52, 3, 4.5, '#7a5030', '#9a7048');
  walls(U + 1.35, V + 0.9, U + 1.8, V + 1.02, 3, 4.5, '#7a5030', '#9a7048');
  barrel(U + 1.5, V + 1.5); barrel(U + 1.7, V + 1.62); barrel(U + 0.4, V + 1.45);
}

// Fire station: brick house with a bell turret, water cart and buckets
function drawFireStation(U, V, rnd) {
  ground(U, V, 2, 2, '#9a9282', rnd, '#7a7266');
  const u0 = U + 0.14, u1 = U + 1.15, v0 = V + 0.14, v1 = V + 1.0;
  ao(u0, v0, u1, v1);
  const w = walls(u0, v0, u1, v1, 0, 17, '#a8503a');
  stones(w.L); stones(w.R);
  barnDoor(wallL(u0, u1, v1, 0, 17), 0.5, 0.36, 9);
  win(w.R, 0.42, 7, 0.14, 6, { shutter: '#2a4a6a' });
  roofV(u0, v0, u1, v1, 17, 14, '#5a5a66', '#a8503a', { style: 'tile' });
  const um = (u0 + u1) / 2;
  const tw = walls(um - 0.08, v0 + 0.25, um + 0.08, v0 + 0.41, 31, 39, '#6a4422', '#8a6034');
  dot(P(um, v0 + 0.33, 36), 2.2, '#e8c040');
  // Water cart
  const c = cylinder(U + 1.5, V + 1.3, 3, 0.14, 8, '#6a4a2a', '#3a5a7a');
  dot(P(U + 1.38, V + 1.45, 2), 3, '#3a2616');
  dot(P(U + 1.62, V + 1.45, 2), 3, '#3a2616');
  for (let i = 0; i < 3; i++) cylinder(U + 0.35 + i * 0.14, V + 1.4, 0, 0.04, 4, '#8a8e94', '#5a6a7a');
}

// Monument: a grand cathedral-like hall with two towers and a golden dome
function drawMonument(U, V, rnd) {
  ground(U, V, 4, 4, '#b8b0a0', rnd, '#9a9282');
  for (let i = 1; i < 8; i++) {
    line(P(U + 0.1, V + i * 0.5), P(U + 3.9, V + i * 0.5), 'rgba(90,80,70,0.2)', 0.6);
    line(P(U + i * 0.5, V + 0.1), P(U + i * 0.5, V + 3.9), 'rgba(90,80,70,0.2)', 0.6);
  }
  const u0 = U + 0.5, u1 = U + 3.5, v0 = V + 0.8, v1 = V + 3.2;
  ao(u0, v0, u1, v1);
  const base = walls(u0, v0, u1, v1, 0, 8, '#c8c0ae');
  stones(base.L); stones(base.R);
  const w = walls(u0 + 0.1, v0 + 0.1, u1 - 0.1, v1 - 0.1, 8, 34, '#ece6d6');
  stones(w.L); stones(w.R);
  for (let s = 0.3; s < w.L.len; s += 0.45) {
    poly('#4a6a9a', rectOn(w.L, s - 0.08, 12, s + 0.08, 26), '#3a2616');
    dot(w.L.at(s, 26), 4, '#4a6a9a');
  }
  for (let s = 0.3; s < w.R.len; s += 0.45) poly('#4a6a9a', rectOn(w.R, s - 0.08, 12, s + 0.08, 26), '#3a2616');
  barnDoor(wallL(u0, u1, v1, 0, 34), 1.5, 0.5, 16);
  roofU(u0 + 0.1, v0 + 0.1, u1 - 0.1, v1 - 0.1, 34, 22, '#4a5a6e', '#ece6d6', { style: 'tile', vent: 0.2 });
  // Golden dome over the crossing
  const d = P((u0 + u1) / 2, (v0 + v1) / 2, 60);
  dot({ x: d.x, y: d.y }, 22, '#c89a30');
  dot({ x: d.x - 6, y: d.y - 6 }, 12, '#e8c050');
  poly('#ece6d6', [{ x: d.x - 22, y: d.y }, { x: d.x + 22, y: d.y }, { x: d.x + 22, y: d.y + 10 }, { x: d.x - 22, y: d.y + 10 }]);
  line({ x: d.x, y: d.y - 22 }, { x: d.x, y: d.y - 34 }, '#e8c040', 2);
  dot({ x: d.x, y: d.y - 36 }, 3, '#e8c040');
  // Two towers at the front corners
  for (const [tu, tv] of [[u0 + 0.05, v1 - 0.05], [u1 - 0.05, v1 - 0.05], [u1 - 0.05, v0 + 0.3]]) {
    const t = walls(tu - 0.28, tv - 0.28, tu + 0.28, tv + 0.28, 0, 58, '#ece6d6');
    stones(t.L); stones(t.R);
    poly('#2a1a10', rectOn(t.L, 0.2, 44, 0.36, 52), null);
    const tip = P(tu, tv, 88);
    poly('#3e4a5c', [P(tu - 0.32, tv + 0.32, 58), P(tu + 0.32, tv + 0.32, 58), tip]);
    poly('#4a5a6e', [P(tu + 0.32, tv + 0.32, 58), P(tu + 0.32, tv - 0.32, 58), tip]);
    line(tip, { x: tip.x, y: tip.y - 8 }, '#e8c040', 1.6);
  }
  flag(U + 0.3, V + 3.6, 0, 30, '#2a5aa8');
  flag(U + 3.7, V + 3.6, 0, 30, '#b02a2a');
}

// Level 4: nobleman's villa - pale ashlar with a columned portico, blue slate roof and a small garden
function drawNobleHouse(U, V, rnd, vr) {
  ground(U, V, 2, 2, '#8aa458', rnd, '#6a8a3a');
  // Gravel path and hedges
  poly('#d8ccb0', uvRect(U + 0.75, V + 1.35, U + 1.05, V + 1.95), null);
  for (const [u, v] of [[U + 0.25, V + 1.7], [U + 1.75, V + 1.7], [U + 1.8, V + 0.35]]) bush(u, v, 0.2, '#2e6a28');
  const roof = ['#3e5a7e', '#4a4a6e', '#3a5a6a'][vr % 3];
  const u0 = U + 0.15, u1 = U + 1.55, v0 = V + 0.12, v1 = V + 1.2;
  ao(u0, v0, u1, v1 + 0.2);
  const g = walls(u0, v0, u1, v1, 0, 18, '#efe8d8');
  stones(g.L); stones(g.R);
  for (const s of [0.25, 1.15]) win(g.L, s, 5, 0.15, 9, { shutter: '#3a5a7a' });
  for (const s of [0.3, 0.75]) win(g.R, s, 5, 0.14, 9, { shutter: '#3a5a7a' });
  const f1 = walls(u0, v0, u1, v1, 18, 32, '#f4eee0');
  for (const s of [0.25, 0.7, 1.15]) win(f1.L, s, 3, 0.14, 8, { flowers: true });
  for (const s of [0.3, 0.75]) win(f1.R, s, 3, 0.14, 8);
  line(g.L.at(0, 18), g.L.at(g.L.len, 18), '#c8bca0', 1.6);
  line(g.R.at(0, 18), g.R.at(g.R.len, 18), '#c8bca0', 1.6);
  // Hipped roof
  const z = 32, rh = 20, o = 0.08, um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
  const A = P(u0 - o, v1 + o, z), B = P(u1 + o, v1 + o, z), C = P(u1 + o, v0 - o, z);
  const R1 = P(um - 0.3, vm, z + rh), R2 = P(um + 0.3, vm, z + rh);
  poly(shade(roof, 0.9), [A, B, R2, R1]);
  poly(roof, [B, C, R2]);
  roofTexture([A, B, R2, R1], roof, 'tile');
  line(R1, R2, shade(roof, 0.5), 2);
  chimney(um - 0.25, vm, z + rh * 0.55, z + rh + 8, vr * 0.13);
  // Portico with four columns and a pediment in front of the left facade
  const pu0 = u0 + 0.4, pu1 = u0 + 1.0, pv = v1 + 0.28;
  poly('#d8d0bc', [P(pu0, v1, 2), P(pu1, v1, 2), P(pu1, pv, 2), P(pu0, pv, 2)], 'rgba(0,0,0,0.25)');
  for (let i = 0; i < 4; i++) {
    const u = pu0 + 0.04 + i * (pu1 - pu0 - 0.08) / 3;
    cylinder(u, pv - 0.04, 2, 0.035, 20, '#f4eee0', '#e0d8c4');
  }
  const pz = 22;
  poly('#e8e0cc', [P(pu0 - 0.04, pv + 0.02, pz), P(pu1 + 0.04, pv + 0.02, pz), P(pu1 + 0.04, pv + 0.02, pz + 3), P(pu0 - 0.04, pv + 0.02, pz + 3)]);
  poly('#f4eee0', [P(pu0 - 0.04, pv + 0.02, pz + 3), P(pu1 + 0.04, pv + 0.02, pz + 3), P((pu0 + pu1) / 2, pv + 0.02, pz + 12)]);
  door(g.L, (pu0 + pu1) / 2 - u0, 0.16, 11, '#3a2a4a');
  flag(u1 - 0.1, v0 + 0.2, z + rh - 4, 14, '#6a3a8a');
}

// Theatre: round-fronted hall with columns, red banners and a dome
function drawTheater(U, V, rnd) {
  ground(U, V, 3, 3, '#b0a890', rnd, '#8a8272');
  for (let i = 1; i < 6; i++) line(P(U + 0.1, V + i * 0.5), P(U + 2.9, V + i * 0.5), 'rgba(80,70,60,0.2)', 0.6);
  const u0 = U + 0.3, u1 = U + 2.5, v0 = V + 0.3, v1 = V + 2.0;
  ao(u0, v0, u1, v1);
  const w = walls(u0, v0, u1, v1, 0, 26, '#e8dcc0');
  stones(w.L); stones(w.R);
  for (let s = 0.25; s < w.L.len - 0.1; s += 0.38) {
    poly('#2a1a14', rectOn(w.L, s - 0.07, 6, s + 0.07, 18), null);
    dot(w.L.at(s, 18), 3.2, '#2a1a14');
  }
  for (let s = 0.3; s < w.R.len - 0.1; s += 0.42) win(w.R, s, 10, 0.12, 9, { lit: true });
  roofU(u0, v0, u1, v1, 26, 16, '#8a3a3a', '#e8dcc0', { style: 'tile', vent: 0.14 });
  // Dome over the stage end
  const d = P(u0 + 0.5, (v0 + v1) / 2, 46);
  dot(d, 16, '#5a7a8a');
  dot({ x: d.x - 5, y: d.y - 5 }, 8, '#7a9aaa');
  poly('#e8dcc0', [{ x: d.x - 16, y: d.y }, { x: d.x + 16, y: d.y }, { x: d.x + 16, y: d.y + 7 }, { x: d.x - 16, y: d.y + 7 }]);
  line({ x: d.x, y: d.y - 16 }, { x: d.x, y: d.y - 24 }, '#e8c040', 1.6);
  // Colonnade along the front with a red curtain entrance
  const cv = v1 + 0.3;
  poly('#d8ccb0', [P(u0, v1, 2), P(u1, v1, 2), P(u1, cv, 2), P(u0, cv, 2)], 'rgba(0,0,0,0.2)');
  for (let i = 0; i < 6; i++) cylinder(u0 + 0.12 + i * (u1 - u0 - 0.24) / 5, cv - 0.05, 2, 0.04, 24, '#f4ecda', '#e0d4bc');
  poly('#e8dcc0', [P(u0 - 0.05, cv + 0.02, 26), P(u1 + 0.05, cv + 0.02, 26), P(u1 + 0.05, cv + 0.02, 30), P(u0 - 0.05, cv + 0.02, 30)]);
  poly('#b02a2a', rectOn(w.L, 0.95, 0, 1.25, 16), 'rgba(40,10,10,0.5)');
  for (const u of [u0 + 0.3, u1 - 0.3]) flag(u, cv + 0.25, 0, 26, '#b02a2a');
}

// Vineyard: rows of vines on trellises and a small press house
function drawVineyard(U, V, rnd) {
  ground(U, V, 3, 3, '#8a7a4a', rnd, '#6a5a32');
  for (let r = 0; r < 5; r++) {
    const v = V + 0.4 + r * 0.45;
    line(P(U + 1.0, v, 8), P(U + 2.85, v, 8), '#6a4a2a', 1);
    for (let u = U + 1.05; u < U + 2.85; u += 0.3) {
      line(P(u, v, 0), P(u, v, 9), '#5a3a1e', 1.2);
      dot(P(u + 0.12, v, 8), 3.2, '#3e7a2e');
      dot(P(u + 0.1, v, 5.5), 1.8, rnd() < 0.5 ? '#6a2a6a' : '#7a3a7a');
    }
  }
  const u0 = U + 0.12, u1 = U + 0.85, v0 = V + 0.2, v1 = V + 1.1;
  ao(u0, v0, u1, v1);
  const w = walls(u0, v0, u1, v1, 0, 12, '#e8dcc0');
  stones(w.L); stones(w.R);
  door(w.L, 0.4, 0.16, 8);
  roofV(u0, v0, u1, v1, 12, 11, '#b05a3a', '#e8dcc0', { style: 'tile' });
  barrel(U + 0.4, V + 1.5);
  barrel(U + 0.6, V + 1.6);
  for (let i = 0; i < 3; i++) dot(P(U + 0.35 + i * 0.12, V + 2.3, 3), 3, '#8a4a2a');
}

// Wine press: stone cellar house with a big vat and stacked barrels
function drawWinery(U, V, rnd) {
  ground(U, V, 2, 2, '#9a8a6a', rnd, '#7a6a50');
  const u0 = U + 0.14, u1 = U + 1.2, v0 = V + 0.14, v1 = V + 1.0;
  ao(u0, v0, u1, v1);
  const w = walls(u0, v0, u1, v1, 0, 16, '#d8ccb0');
  stones(w.L); stones(w.R);
  barnDoor(wallL(u0, u1, v1, 0, 16), 0.5, 0.3, 8);
  win(w.R, 0.42, 7, 0.14, 6, { shutter: '#6a2a4a' });
  roofV(u0, v0, u1, v1, 16, 13, '#9a4a3a', '#d8ccb0', { style: 'tile', vent: 0.12 });
  // Grape vat
  const vat = cylinder(U + 1.55, V + 0.5, 0, 0.2, 9, '#7a5030', '#5a2a4a');
  dot({ x: vat.t.x - 3, y: vat.t.y }, 2, '#7a3a7a');
  dot({ x: vat.t.x + 4, y: vat.t.y + 1 }, 2, '#8a4a8a');
  for (const [u, v, z] of [[U + 1.4, V + 1.35, 0], [U + 1.62, V + 1.3, 0], [U + 1.51, V + 1.33, 11], [U + 0.45, V + 1.45, 0]]) barrel(u, v, z);
}

// Gold mine: tunnel into a rock with glittering nuggets and a sluice
function drawGoldmine(U, V, rnd) {
  ground(U, V, 2, 2, '#8a8474', rnd, '#6a665c');
  boulder(U + 0.8, V + 0.6, 0.55, rnd);
  const m = P(U + 0.95, V + 1.05, 0);
  poly('#1a1410', [{ x: m.x - 8, y: m.y }, { x: m.x + 8, y: m.y }, { x: m.x + 8, y: m.y - 13 }, { x: m.x, y: m.y - 17 }, { x: m.x - 8, y: m.y - 13 }], null);
  line({ x: m.x - 9, y: m.y }, { x: m.x - 9, y: m.y - 14 }, '#6a4422', 2.4);
  line({ x: m.x + 9, y: m.y }, { x: m.x + 9, y: m.y - 14 }, '#6a4422', 2.4);
  line({ x: m.x - 11, y: m.y - 14 }, { x: m.x + 11, y: m.y - 14 }, '#6a4422', 2.6);
  // Wooden sluice with water
  walls(U + 1.3, V + 1.2, U + 1.9, V + 1.35, 3, 6, '#7a5030', '#4a8ab0');
  const cart = walls(U + 0.85, V + 1.45, U + 1.05, V + 1.7, 1, 6, '#5a5a60', '#7a7a80');
  for (let i = 0; i < 3; i++) dot(P(U + 0.92 + i * 0.05, V + 1.57, 7), 1.6, '#f0c83a');
  const pile = P(U + 1.55, V + 1.65, 0);
  ctx.fillStyle = '#8a7a5a';
  ctx.beginPath(); ctx.ellipse(pile.x, pile.y - 2, 9, 5, 0, Math.PI, 0); ctx.fill();
  for (let i = 0; i < 5; i++) {
    const q = { x: pile.x - 6 + i * 3, y: pile.y - 3 - (i % 2) * 2 };
    dot(q, 1.4, '#f0c83a');
    if ((animTime / 400 + i) % 5 < 0.6) dot(q, 2.5, 'rgba(255,250,200,0.8)');
  }
}

// Goldsmith: elegant brick shop with a gilded sign and a small furnace
function drawGoldsmith(U, V, rnd) {
  ground(U, V, 2, 2, '#9a9282', rnd, '#7a7266');
  const u0 = U + 0.14, u1 = U + 1.2, v0 = V + 0.14, v1 = V + 1.0;
  ao(u0, v0, u1, v1);
  const g = walls(u0, v0, u1, v1, 0, 14, '#a8543a');
  stones(g.L); stones(g.R);
  const f1 = walls(u0, v0, u1 + 0.03, v1 + 0.03, 14, 25, '#efe4ca');
  timber(f1.L, '#4a2a1a'); timber(f1.R, '#4a2a1a');
  door(g.L, 0.3, 0.16, 10, '#2a3a5a');
  win(g.L, 0.72, 4, 0.22, 7, { lit: true });
  for (const s of [0.3, 0.72]) win(f1.L, s, 3, 0.13, 6, { shutter: '#2a3a5a' });
  win(g.R, 0.42, 4, 0.14, 7, { lit: true });
  const surf = roofU(u0, v0, u1 + 0.03, v1 + 0.03, 25, 14, '#4a5a6e', '#efe4ca', { style: 'tile', timber: '#4a2a1a' });
  const vm = (v0 + v1) / 2;
  chimney(u0 + 0.3, vm + 0.15, surf(vm + 0.21) - 2, surf(vm + 0.15) + 12, 0.35);
  // Gilded ring sign
  const sp = P(u0 + 0.08, v1 + 0.03, 16);
  line(sp, { x: sp.x - 8, y: sp.y + 4 }, '#3a2616', 1.2);
  ctx.strokeStyle = '#e8c040';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(sp.x - 9, sp.y + 9, 4, 0, Math.PI * 2); ctx.stroke();
  dot({ x: sp.x - 9, y: sp.y + 4.5 }, 1.8, '#8ad0ff');
  crate(U + 1.55, V + 0.5, 0.09);
  barrel(U + 1.55, V + 1.35);
}

// Watchtower: round stone tower with a crenellated top and a burning brazier
function drawWatchtower(U, V, rnd) {
  ground(U, V, 1, 1, '#9a9282', rnd, '#7a7266');
  const c = cylinder(U + 0.5, V + 0.5, 0, 0.26, 34, '#a09a8a', '#8a8474');
  // Stone courses
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 0.6;
  for (let z = 5; z < 34; z += 5) {
    const p = P(U + 0.5, V + 0.5, z);
    ctx.beginPath(); ctx.ellipse(p.x, p.y, c.rx, c.ry, 0, 0, Math.PI); ctx.stroke();
  }
  poly('#2a1a10', rectOn(wallL(U + 0.36, U + 0.64, V + 0.76, 0, 34), 0.08, 0, 0.2, 9), null);
  poly('#2a1a10', rectOn(wallR(U + 0.76, V + 0.36, V + 0.64, 0, 34), 0.1, 20, 0.18, 26), null);
  // Battlements
  const top = cylinder(U + 0.5, V + 0.5, 34, 0.3, 4, '#aca698', '#7a7466');
  for (let i = 0; i < 6; i++) {
    const a = Math.PI * (0.1 + i * 0.16);
    const p = P(U + 0.5 + Math.cos(a) * 0.28, V + 0.5 + Math.sin(a) * 0.28, 38);
    ctx.fillStyle = '#aca698';
    ctx.fillRect(p.x - 2.5, p.y - 4, 5, 4);
  }
  // Brazier fire
  const f = P(U + 0.5, V + 0.5, 40), fl = Math.sin(animTime / 110) * 1.5;
  dot({ x: f.x, y: f.y - 3 }, 5 + fl, 'rgba(230,90,20,0.85)');
  dot({ x: f.x, y: f.y - 6 }, 3 + fl * 0.5, 'rgba(255,210,70,0.95)');
  smoke({ x: f.x, y: f.y - 8 }, 0.3);
  flag(U + 0.7, V + 0.3, 38, 12, '#2a5aa8');
}

const BUILDING_RENDERERS = {
  theater: drawTheater,
  vineyard: drawVineyard,
  winery: drawWinery,
  goldmine: drawGoldmine,
  goldsmith: drawGoldsmith,
  watchtower: drawWatchtower,
  claypit: drawClayPit,
  brickworks: drawBrickworks,
  charcoal: drawCharcoal,
  mine: drawMine,
  smithy: drawSmithy,
  marketplace: drawMarketplace,
  chapel: drawChapel,
  tavern: drawTavern,
  firestation: drawFireStation,
  monument: drawMonument,
  forester: drawForester,
  house: drawHouse,
  sheepfarm: drawSheepFarm,
  weaver: drawWeaver,
  hopfarm: drawHopFarm,
  brewery: drawBrewery,
  fisher: drawFisher,
  grainfarm: drawGrainFarm,
  pigfarm: drawPigFarm,
  cattlefarm: drawCattleFarm,
  shipyard: drawShipyard,
  stonecutter: drawStonecutter,
  woodcutter: drawWoodcutter,
  sawmill: drawSawmill,
  warehouse: drawWarehouse
};

function drawBuilding(b) {
  const vr = Math.abs(b.x * 31 + b.y * 17);
  const rnd = seeded(b.x * 73856093 ^ b.y * 19349663);
  // Footprint origin corner (tile centres are at integer coords); the building is passed for state like house level
  BUILDING_RENDERERS[b.type](b.x - 0.5, b.y - 0.5, rnd, vr, b);
}
