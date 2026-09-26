'use strict';

// ===== RENDERING =====
const canvas = document.getElementById('canvas');
// `let` so build-menu previews can temporarily redirect all drawing to their own canvas
let ctx = canvas.getContext('2d');
let animTime = 0; // ms, drives smoke, flags and saw blades

// Fallback colours (used e.g. by build-menu previews whose tiles aren't decorated)
const TERRAIN_COLORS = {
  grass: '#6aa444',
  forest: '#467e32',
  beach: '#e0cc92',
  water: '#2a78b0',
  rock: '#948f80'
};
const SEA_COLOR = '#1b5487'; // background outside the map
const DETAIL_ZOOM = 0.7;     // below this zoom, tiny ground details are skipped
const WAVE_ZOOM = 0.6;       // below this zoom, animated wave crests are skipped
const GROUND_LOD_ZOOM = 0.55; // below this zoom, the ground is one pre-rendered image and rock textures are skipped

// Low-zoom ground: one pixel per tile in its colour, drawn as crisp diamonds with a single transformed drawImage.
// Rebuilt when the terrain look or the fog changes.
const groundLayer = { canvas: null, dirty: true };
function drawGroundLayer() {
  const N = MAP_SIZE;
  if (!groundLayer.canvas || groundLayer.canvas.width !== N) {
    groundLayer.canvas = document.createElement('canvas');
    groundLayer.canvas.width = groundLayer.canvas.height = N;
    groundLayer.dirty = true;
  }
  if (groundLayer.dirty) {
    const g = groundLayer.canvas.getContext('2d'), img = g.createImageData(N, N), d = img.data;
    const sea = hexArr(SEA_COLOR);
    for (let i = 0; i < N * N; i++) {
      const t = GAME.grid[i];
      let c = sea;
      if (GAME.seen[i]) {
        const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(t.color || '');
        c = m ? [+m[1], +m[2], +m[3]] : hexArr(TERRAIN_COLORS[t.type] || '#6aa444');
      }
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    groundLayer.dirty = false;
  }
  ctx.save();
  ctx.transform(32, 16, -32, 16, 0, -16);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(groundLayer.canvas, 0, 0);
  ctx.restore();
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

// ----- Noise & colour helpers -----
// Seeds all per-tile decoration; stored in save games so a loaded map looks identical
let NOISE_SEED = Math.floor(Math.random() * 100000);

function hash2(x, y) {
  let h = Math.imul(x + NOISE_SEED, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smooth value noise in 0..1
function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const sm = (t) => t * t * (3 - 2 * t);
  const u = sm(x - xi), v = sm(y - yi);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => valueNoise(x, y) * 0.65 + valueNoise(x * 2.3 + 17, y * 2.3 + 5) * 0.35;

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

// ----- Per-tile look, computed once after terrain generation -----
const FLOWER_COLORS = ['#f4f0e0', '#f2d040', '#e87890', '#b890e0'];
const SHORE_EDGES = { '0,-1': [[-0.5, -0.5], [0.5, -0.5]], '1,0': [[0.5, -0.5], [0.5, 0.5]],
                      '0,1': [[0.5, 0.5], [-0.5, 0.5]], '-1,0': [[-0.5, 0.5], [-0.5, -0.5]] };
const DIRS4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const TREE_HUES = 4; // colour variants per tree kind (each becomes one cached sprite)

function makeTree(rnd, n, u, v) {
  const bucket = Math.floor(rnd() * TREE_HUES);
  const hue = (bucket + 0.5) / TREE_HUES;
  const tree = { u, v, s: 0.75 + rnd() * 0.4 };
  tree.conifer = rnd() < 0.2 + n * 0.5; // conifers cluster in the darker noise areas
  const autumn = !tree.conifer && rnd() < 0.06;
  tree.key = `${tree.conifer ? 'c' : autumn ? 'a' : 'd'}${bucket}`;
  if (tree.conifer) {
    tree.dark = mix('#2a5a2e', '#36683a', hue);
    tree.light = mix('#4a8a46', '#5c9c50', hue);
  } else if (autumn) {
    // The odd autumn-coloured tree for a bit of life
    tree.dark = mix('#9a5a1e', '#8a6a1a', hue);
    tree.mid = mix('#d08a2a', '#c8a030', hue);
    tree.light = mix('#f0b848', '#e8c858', hue);
  } else {
    tree.dark = mix('#2e6624', '#3c7628', hue);
    tree.mid = mix('#4a9232', '#5aa03a', hue);
    tree.light = mix('#7abe50', '#8ccc5c', hue);
  }
  return tree;
}

function decorateTerrain(grid) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE) ? grid[y * MAP_SIZE + x] : null;

  // Water depth = steps to the nearest land tile (BFS from the shoreline)
  const queue = [];
  for (const t of grid) {
    if (t.type !== 'water') continue;
    t.landDirs = DIRS4.filter(([dx, dy]) => { const n = at(t.x + dx, t.y + dy); return n && n.type !== 'water'; });
    t.shore = t.landDirs.map(([dx, dy]) => SHORE_EDGES[`${dx},${dy}`]);
    t.depth = t.shore.length ? 1 : 99;
    if (t.shore.length) queue.push(t);
    else t.shore = null;
  }
  while (queue.length) {
    const t = queue.shift();
    for (const [dx, dy] of DIRS4) {
      const n = at(t.x + dx, t.y + dy);
      if (n && n.type === 'water' && n.depth > t.depth + 1) { n.depth = t.depth + 1; queue.push(n); }
    }
  }

  for (const t of grid) decorateTile(t);
  groupRocks(grid, at);
  groundLayer.dirty = true;
}

// Per-tile colour, decoration and trees. Deterministic per position, so it can be re-run for a single
// tile (e.g. when a forester plants trees) without changing anything else.
const TREE_SLOTS = [[-0.22, -0.2], [0.2, -0.16], [-0.14, 0.2], [0.22, 0.2]];
function decorateTile(t) {
  groundLayer.dirty = true;
  const n = fbm(t.x / 6, t.y / 6);
  const rnd = seeded(t.x * 7919 + t.y * 104729 + NOISE_SEED);
  t.decor = null;
  t.trees = null;
  t.object = null;
  const at2 = () => rnd() * 0.8 - 0.4;

  if (t.type === 'grass' && t.quarried) {
    // Worked-out quarry: grey gravel that never grows back
    t.color = mix('#8a8a70', '#a09c84', n);
    t.decor = [];
    for (let i = 0; i < 8; i++) t.decor.push({ k: 'speck', u: at2(), v: at2(), c: rnd() < 0.5 ? '#6e6a5e' : '#c4beac' });
    t.decor.push({ k: 'pebble', u: at2(), v: at2() }, { k: 'tuft', u: at2(), v: at2(), s: 0.7 });
  } else if (t.type === 'grass') {
    t.color = mix('#5a943a', '#86ba50', n);
    t.decor = [];
    // Felled forest leaves stumps until trees grow back
    if (t.stumps) for (let i = 0; i < 3; i++) t.decor.push({ k: 'stump', u: TREE_SLOTS[i][0], v: TREE_SLOTS[i][1] });
    for (let i = 0, m = 2 + Math.floor(rnd() * 3); i < m; i++) t.decor.push({ k: 'tuft', u: at2(), v: at2(), s: 0.7 + rnd() * 0.6 });
    if (valueNoise(t.x / 4 + 50, t.y / 4 + 50) > 0.62) {
      for (let i = 0, m = 2 + Math.floor(rnd() * 4); i < m; i++) {
        t.decor.push({ k: 'flower', u: at2(), v: at2(), c: FLOWER_COLORS[Math.floor(rnd() * FLOWER_COLORS.length)] });
      }
    }
    if (rnd() < 0.05) t.decor.push({ k: 'pebble', u: at2(), v: at2() });
    const r = rnd();
    if (t.stumps) { /* no lone trees or bushes on a clearing */ }
    else if (r < 0.035) t.object = { k: 'bush', u: rnd() * 0.4 - 0.2, v: rnd() * 0.4 - 0.2, s: 0.24 + rnd() * 0.12 };
    else if (r < 0.05) t.object = { k: 'tree', tree: makeTree(rnd, n, rnd() * 0.3 - 0.15, rnd() * 0.3 - 0.15) };
  } else if (t.type === 'forest') {
    t.color = mix('#3a6c2a', '#528a36', n);
    const count = 2 + (rnd() < 0.45 ? 1 : 0);
    const start = Math.floor(rnd() * 4);
    t.trees = [];
    for (let i = 0; i < count; i++) {
      const [su, sv] = TREE_SLOTS[(start + i) % 4];
      t.trees.push(makeTree(rnd, n, su + rnd() * 0.12 - 0.06, sv + rnd() * 0.12 - 0.06));
    }
    t.trees.sort((a, b) => (a.u + a.v) - (b.u + b.v)); // back to front
    t.decor = [{ k: 'tuft', u: at2(), v: at2(), s: 1 }];
    // Harvestable wood: WOOD_PER_TREE per tree; a fresh map starts fully grown
    t.woodMax = count * WOOD_PER_TREE;
    t.wood = Math.min(t.wood ?? t.woodMax, t.woodMax);
  } else if (t.type === 'beach') {
    t.color = mix('#d4bd84', '#ecdca8', n);
    t.decor = [];
    for (let i = 0; i < 6; i++) t.decor.push({ k: 'speck', u: at2(), v: at2(), c: rnd() < 0.5 ? '#bfa872' : '#f6ecc8' });
    if (rnd() < 0.12) t.decor.push({ k: 'shell', u: at2(), v: at2() });
  } else if (t.type === 'water') {
    const d = Math.min(t.depth, 4);
    t.color = mix('#58b2d2', '#1e5e96', (d - 1) / 3);
    t.wave = rnd() < 0.45 ? { u: at2() * 0.8, v: at2() * 0.8, ph: rnd() * Math.PI * 2 } : null;
  } else if (t.type === 'rock') {
    t.color = mix('#868272', '#a09a88', n);
    t.decor = [];
    for (let i = 0; i < 5; i++) t.decor.push({ k: 'speck', u: at2(), v: at2(), c: rnd() < 0.5 ? '#6e6a5e' : '#bcb6a4' });
    t.stone = t.stone ?? ROCK_STONE; // finite: quarried stone never comes back
  }
}

// ----- Mountains: connected rock tiles grouped (max 10) into small faceted peaks -----
const MOUNTAIN_MAX = 10;
const LIGHT_DIR = (() => { const l = [0.75, -0.25, 0.9]; const m = Math.hypot(...l); return l.map(c => c / m); })();
const hexArr = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lerpArr = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);
const rgbArr = (a, f = 1) => `rgb(${a.map(c => Math.min(255, Math.round(c * f))).join(',')})`;
const MOSS = hexArr('#7e8662'), STONE = hexArr('#a29c8e'), SNOW = hexArr('#eef1f2'), GRASS = hexArr('#6a9c44');
const GRASS_LINE = 5; // px height below which mountain slopes are grassy

// Part of a 3D triangle below (keepBelow) or above a height level; null if nothing remains
function clipZ(tri, level, keepBelow) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const a = tri[i], b = tri[(i + 1) % 3];
    const inA = keepBelow ? a[2] <= level : a[2] >= level;
    const inB = keepBelow ? b[2] <= level : b[2] >= level;
    if (inA) out.push(a);
    if (inA !== inB) {
      const t = (level - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, level]);
    }
  }
  return out.length >= 3 ? out : null;
}

function groupRocks(grid, at) {
  const assigned = new Set();
  let gid = 0;
  for (const start of grid) {
    if (start.type !== 'rock' || assigned.has(start)) continue;
    // Grow a group breadth-first from this tile until it has MOUNTAIN_MAX tiles
    const group = [start];
    assigned.add(start);
    for (let i = 0; i < group.length && group.length < MOUNTAIN_MAX; i++) {
      for (const [dx, dy] of DIRS4) {
        const nb = at(group[i].x + dx, group[i].y + dy);
        if (nb && nb.type === 'rock' && !assigned.has(nb) && group.length < MOUNTAIN_MAX) {
          assigned.add(nb);
          group.push(nb);
        }
      }
    }
    gid++;
    for (const t of group) t.rockGroup = gid;
    if (group.length >= 2) buildMountain(group, at);
    else {
      // Lone boulders sit on grassy gravel rather than a bare grey tile
      start.color = mix('#6e8a4c', '#8a9064', fbm(start.x / 6, start.y / 6));
      start.decor.push({ k: 'tuft', u: 0.3, v: -0.25, s: 1 }, { k: 'tuft', u: -0.3, v: 0.3, s: 0.8 });
    }
  }
}

function buildMountain(group, at) {
  const n = group.length, gid = group[0].rockGroup;
  const inG = (x, y) => { const t = at(x, y); return t && t.rockGroup === gid ? t : null; };
  // Jitter keyed on world position, so vertices shared between tiles get the same value
  const jit = (x, y, amp) => (hash2(Math.round(x * 2) + 5000, Math.round(y * 2) + 9000) - 0.5) * 2 * amp;

  const cx = group.reduce((s, t) => s + t.x, 0) / n, cy = group.reduce((s, t) => s + t.y, 0) / n;
  const dmax = Math.max(...group.map(t => Math.hypot(t.x - cx, t.y - cy))) + 0.7;
  const sizeF = Math.sqrt(n / MOUNTAIN_MAX); // bigger groups grow taller
  for (const t of group) {
    const left = 0.35 + 0.65 * ((t.stone ?? ROCK_STONE) / ROCK_STONE); // quarried tiles sink
    t.hc = (10 + 6 * sizeF + 38 * sizeF * (1 - Math.hypot(t.x - cx, t.y - cy) / dmax)) * left + jit(t.x, t.y, 4);
  }
  const peak = Math.max(...group.map(t => t.hc));
  const snowLine = n >= 8 ? peak * 0.84 : Infinity; // only the biggest peaks get a snow cap

  for (const t of group) {
    const { x, y } = t;
    // Corner raised only when it is surrounded by 3-4 tiles of the same group; otherwise it's at ground level
    const cornerH = (ox, oy) => {
      const bx = x + (ox < 0 ? -1 : 0), by = y + (oy < 0 ? -1 : 0);
      const ts = [inG(bx, by), inG(bx + 1, by), inG(bx, by + 1), inG(bx + 1, by + 1)].filter(Boolean);
      const f = ts.length === 4 ? 0.95 : ts.length === 3 ? 0.68 : 0;
      return f ? (ts.reduce((s, q) => s + q.hc, 0) / ts.length) * f + jit(x + ox, y + oy, 3) : 0;
    };
    // Edge midpoint raised when the neighbour across it belongs to the group -> continuous ridges
    const midH = (dx, dy) => {
      const nb = inG(x + dx, y + dy);
      return nb ? ((t.hc + nb.hc) / 2) * 0.92 + jit(x + dx / 2, y + dy / 2, 3) : 0;
    };

    const TL = [x - 0.5, y - 0.5, cornerH(-0.5, -0.5)], TR = [x + 0.5, y - 0.5, cornerH(0.5, -0.5)];
    const BR = [x + 0.5, y + 0.5, cornerH(0.5, 0.5)], BL = [x - 0.5, y + 0.5, cornerH(-0.5, 0.5)];
    const Nm = [x, y - 0.5, midH(0, -1)], Em = [x + 0.5, y, midH(1, 0)];
    const Sm = [x, y + 0.5, midH(0, 1)], Wm = [x - 0.5, y, midH(-1, 0)];
    const C = [x, y, t.hc];
    // Back facets (north, west) first, then the front ones (east, south)
    const tris = [[TL, Nm, C], [Nm, TR, C], [BL, Wm, C], [Wm, TL, C], [TR, Em, C], [Em, BR, C], [BR, Sm, C], [Sm, BL, C]];

    t.mountain = tris.map(tri => {
      const [a, b, c] = tri, S = 40; // S: horizontal world scale (px per tile) for normals
      const ab = [(b[0] - a[0]) * S, (b[1] - a[1]) * S, b[2] - a[2]];
      const ac = [(c[0] - a[0]) * S, (c[1] - a[1]) * S, c[2] - a[2]];
      let nx = ab[1] * ac[2] - ab[2] * ac[1], ny = ab[2] * ac[0] - ab[0] * ac[2], nz = ab[0] * ac[1] - ab[1] * ac[0];
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const len = Math.hypot(nx, ny, nz) || 1;
      const lit = Math.max(0, (nx * LIGHT_DIR[0] + ny * LIGHT_DIR[1] + nz * LIGHT_DIR[2]) / len);
      const hAvg = (a[2] + b[2] + c[2]) / 3;
      const base = lerpArr(MOSS, STONE, Math.min(1, Math.max(0, (hAvg - 4) / 16)));
      const toScreen = (poly3) => poly3.map(([u, v, z]) => P(u, v, z));
      // Grass at the foot and snow at the top follow height contours, not facet edges
      const bands = [];
      const grass = clipZ(tri, GRASS_LINE, true);
      if (grass) bands.push({ pts: toScreen(grass), col: rgbArr(GRASS, 0.72 + 0.4 * lit) });
      const snow = clipZ(tri, snowLine, false);
      if (snow) bands.push({ pts: toScreen(snow), col: rgbArr(SNOW, 0.82 + 0.22 * lit), snow: true });
      return { pts: toScreen(tri), col: rgbArr(base, 0.56 + 0.52 * lit), h: hAvg, bands };
    });

    // Details: grass tufts on the low slopes, loose scree at the foot of the front edges
    const rnd = seeded(x * 48611 + y * 96769 + NOISE_SEED);
    t.slopeTufts = [];
    for (const tri of t.mountain) {
      if (tri.h < 9 && rnd() < 0.8) {
        const [a, b, c] = tri.pts, w1 = rnd() * 0.5, w2 = rnd() * (1 - w1);
        t.slopeTufts.push({ x: a.x + (b.x - a.x) * w1 + (c.x - a.x) * w2, y: a.y + (b.y - a.y) * w1 + (c.y - a.y) * w2 });
      }
    }
    t.scree = [];
    if (!inG(x + 1, y) && rnd() < 0.6) t.scree.push({ u: x + 0.6, v: y + rnd() * 0.6 - 0.3, r: 0.06 + rnd() * 0.05, seed: Math.floor(rnd() * 1e9) });
    if (!inG(x, y + 1) && rnd() < 0.6) t.scree.push({ u: x + rnd() * 0.6 - 0.3, v: y + 0.6, r: 0.06 + rnd() * 0.05, seed: Math.floor(rnd() * 1e9) });
  }
}

// Seamless rock texture (mid-grey = neutral), applied with 'overlay' so it only adds light/dark detail
let rockPattern = null;
function getRockPattern() {
  if (rockPattern) return rockPattern;
  const S = 192, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), rnd = seeded(20240926);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, S, S);
  // Draw each shape at the 9 wrap offsets so the texture tiles without seams
  const wrapped = (drawFn) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) drawFn(ox, oy); };

  // Soft mottling
  for (let i = 0; i < 150; i++) {
    const x = rnd() * S, y = rnd() * S, rx = 4 + rnd() * 16, ry = 3 + rnd() * 8, rot = rnd() * Math.PI;
    const col = rnd() < 0.5 ? 'rgba(0,0,0,0.11)' : 'rgba(255,255,255,0.11)';
    wrapped((ox, oy) => { g.fillStyle = col; g.beginPath(); g.ellipse(x + ox, y + oy, rx, ry, rot, 0, Math.PI * 2); g.fill(); });
  }
  // Cracks / strata: a dark line with a light lip underneath
  for (let i = 0; i < 16; i++) {
    const pts = [[rnd() * S, rnd() * S]];
    for (let k = 0; k < 4; k++) { const [px, py] = pts[pts.length - 1]; pts.push([px + 4 + rnd() * 14, py + (rnd() - 0.5) * 9]); }
    wrapped((ox, oy) => {
      for (const [off, col] of [[1, 'rgba(255,255,255,0.28)'], [0, 'rgba(0,0,0,0.4)']]) {
        g.strokeStyle = col;
        g.lineWidth = 1.3;
        g.beginPath();
        pts.forEach(([px, py], k) => k ? g.lineTo(px + ox, py + oy + off) : g.moveTo(px + ox, py + oy + off));
        g.stroke();
      }
    });
  }
  // Fine grain
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const d = (rnd() - 0.5) * 38;
    img.data[i] += d; img.data[i + 1] += d; img.data[i + 2] += d;
  }
  g.putImageData(img, 0, 0);

  rockPattern = ctx.createPattern(c, 'repeat');
  rockPattern.setTransform(new DOMMatrix().scale(0.5)); // 2 texels per world px -> crisp when zoomed in
  return rockPattern;
}

function rockTexture(polys, strength = 0.7, mode = 'overlay') {
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha *= strength;
  ctx.fillStyle = getRockPattern();
  ctx.beginPath();
  for (const pts of polys) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

function drawMountainTile(tile) {
  // Stroke each facet in its own colour: hides hairline seams without drawing visible edges.
  // Bands are drawn right after their facet so later (front) facets still cover them correctly.
  // (far out the seams are invisible, so the strokes are skipped)
  const seam = GAME.camera.zoom >= GROUND_LOD_ZOOM;
  for (const tri of tile.mountain) {
    poly(tri.col, tri.pts, seam ? tri.col : null);
    for (const b of tri.bands) poly(b.col, b.pts, seam ? b.col : null);
  }
  const lod = GAME.camera.zoom < GROUND_LOD_ZOOM;
  if (!lod) rockTexture(tile.mountain.map(tri => tri.pts), 0.6);
  if (tile.ore > 0) {
    // Iron ore veins show as rusty streaks on the facets
    const rnd = seeded(tile.x * 131 + tile.y * 977);
    for (let i = 0; i < 4; i++) {
      const tri = tile.mountain[Math.floor(rnd() * tile.mountain.length)];
      const [a, bb, c] = tri.pts, w1 = rnd() * 0.5, w2 = rnd() * (1 - w1);
      const q = { x: a.x + (bb.x - a.x) * w1 + (c.x - a.x) * w2, y: a.y + (bb.y - a.y) * w1 + (c.y - a.y) * w2 };
      line(q, { x: q.x + 3, y: q.y + 1.5 }, '#b0582a', 2);
    }
  }
  if (tile.gold > 0) {
    // Gold veins glint on the facets
    const rnd = seeded(tile.x * 577 + tile.y * 211);
    for (let i = 0; i < 4; i++) {
      const tri = tile.mountain[Math.floor(rnd() * tile.mountain.length)];
      const [a, bb, c] = tri.pts, w1 = rnd() * 0.5, w2 = rnd() * (1 - w1);
      const q = { x: a.x + (bb.x - a.x) * w1 + (c.x - a.x) * w2, y: a.y + (bb.y - a.y) * w1 + (c.y - a.y) * w2 };
      line(q, { x: q.x + 3, y: q.y - 1 }, '#e8c040', 2);
      dot({ x: q.x + 1, y: q.y - 1 }, 0.9, '#fff6c0');
    }
  }
  // 'overlay' leaves near-white untouched, so snow gets a faint multiplied texture instead
  const snowPolys = lod ? [] : tile.mountain.flatMap(tri => tri.bands.filter(b => b.snow).map(b => b.pts));
  if (snowPolys.length) rockTexture(snowPolys, 0.22, 'multiply');

  if (GAME.camera.zoom >= DETAIL_ZOOM && tile.slopeTufts.length) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#5a7a36';
    ctx.beginPath();
    for (const q of tile.slopeTufts) {
      ctx.moveTo(q.x - 2, q.y); ctx.lineTo(q.x - 3, q.y - 4);
      ctx.moveTo(q.x, q.y); ctx.lineTo(q.x, q.y - 5);
      ctx.moveTo(q.x + 2, q.y); ctx.lineTo(q.x + 3.5, q.y - 3.5);
    }
    ctx.stroke();
  }
  for (const s of tile.scree) boulder(s.u, s.v, s.r, seeded(s.seed));
}

// ----- Ground -----
function drawTile(x, y, tile) {
  const p = ISO.tileToScreen(x, y);
  const TW = ISO.TW, TH = ISO.TH;
  const color = tile.color || TERRAIN_COLORS[tile.type];

  // Diamond enlarged by ~half a pixel so neighbouring tiles overlap and no seams show
  const e = 0.6;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - TH / 2 - e);
  ctx.lineTo(p.x + TW / 2 + e * 2, p.y);
  ctx.lineTo(p.x, p.y + TH / 2 + e);
  ctx.lineTo(p.x - TW / 2 - e * 2, p.y);
  ctx.closePath();
  ctx.fill();

  if (tile.type === 'water') { drawWaterDetails(x, y, tile); return; }
  if (!tile.decor || GAME.camera.zoom < DETAIL_ZOOM) return;

  const at = (d) => ({ x: p.x + (d.u - d.v) * 32, y: p.y + (d.u + d.v) * 16 });

  // Grass tufts: batched into two paths (shadow blades + lit blades)
  const tufts = tile.decor.filter(d => d.k === 'tuft');
  if (tufts.length) {
    const dark = tile.type === 'forest' ? '#2e5a22' : '#44782c';
    const light = tile.type === 'forest' ? '#5e9a40' : '#9ccc62';
    ctx.lineWidth = 1;
    ctx.strokeStyle = dark;
    ctx.beginPath();
    for (const d of tufts) {
      const q = at(d);
      ctx.moveTo(q.x - 2.5 * d.s, q.y); ctx.lineTo(q.x - 3.5 * d.s, q.y - 4 * d.s);
      ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - 0.5 * d.s, q.y - 5.5 * d.s);
    }
    ctx.stroke();
    ctx.strokeStyle = light;
    ctx.beginPath();
    for (const d of tufts) {
      const q = at(d);
      ctx.moveTo(q.x + 1, q.y); ctx.lineTo(q.x + 2.5 * d.s, q.y - 4.5 * d.s);
      ctx.moveTo(q.x + 2.5 * d.s, q.y); ctx.lineTo(q.x + 4 * d.s, q.y - 3 * d.s);
    }
    ctx.stroke();
  }

  for (const d of tile.decor) {
    if (d.k === 'tuft') continue;
    const q = at(d);
    if (d.k === 'flower') {
      line(q, { x: q.x, y: q.y - 3 }, '#3e7228', 0.8);
      dot({ x: q.x, y: q.y - 3.5 }, 1.5, d.c);
      dot({ x: q.x, y: q.y - 3.5 }, 0.5, '#f8e070');
    } else if (d.k === 'pebble') {
      ctx.fillStyle = '#9a968a';
      ctx.beginPath(); ctx.ellipse(q.x, q.y, 2.2, 1.3, 0, 0, Math.PI * 2); ctx.fill();
      dot({ x: q.x + 0.6, y: q.y - 0.4 }, 0.8, '#c4c0b4');
    } else if (d.k === 'speck') {
      dot(q, 0.8, d.c);
    } else if (d.k === 'stump') {
      ctx.fillStyle = '#5a3c20';
      ctx.fillRect(q.x - 2.2, q.y - 3, 4.4, 3);
      ctx.fillStyle = '#c8a070';
      ctx.beginPath(); ctx.ellipse(q.x, q.y - 3, 2.2, 1.1, 0, 0, Math.PI * 2); ctx.fill();
    } else if (d.k === 'shell') {
      ctx.fillStyle = '#f8ece0';
      ctx.beginPath(); ctx.arc(q.x, q.y, 1.8, Math.PI, 0); ctx.fill();
    }
  }
}

// Stone quay along the edge of a canal tile that faces direction (dx, dy)
function drawQuay(x, y, dx, dy) {
  const [[u0, v0], [u1, v1]] = SHORE_EDGES[`${dx},${dy}`];
  const a = P(x + u0, y + v0, 2), b = P(x + u1, y + v1, 2);
  const a2 = P(x + u0 * 0.78, y + v0 * 0.78, 0), b2 = P(x + u1 * 0.78, y + v1 * 0.78, 0);
  poly('#aaa496', [a, b, b2, a2], 'rgba(60,54,44,0.5)');
  for (let i = 1; i < 4; i++) line(lerp(a, b, i / 4), lerp(a2, b2, i / 4), 'rgba(60,54,44,0.35)', 0.6);
}

function drawWaterDetails(x, y, tile) {
  const t = animTime / 1000;
  // Canals have stone quays instead of foam
  if (tile.canal && tile.landDirs) {
    for (const [dx, dy] of tile.landDirs) drawQuay(x, y, dx, dy);
  } else if (tile.shore) {
    // Foam along edges that touch land, gently pulsing
    const a = 0.45 + 0.2 * Math.sin(t * 2 + x * 0.7 + y * 0.5);
    ctx.strokeStyle = `rgba(236,248,255,${a.toFixed(2)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [[u0, v0], [u1, v1]] of tile.shore) {
      const a0 = P(x + u0 * 0.86, y + v0 * 0.86), a1 = P(x + u1 * 0.86, y + v1 * 0.86);
      ctx.moveTo(a0.x, a0.y);
      ctx.lineTo(a1.x, a1.y);
    }
    ctx.stroke();
  }
  // Glinting wave crests that fade in and out
  if (tile.wave && GAME.camera.zoom >= WAVE_ZOOM) {
    const w = tile.wave, ph = t * 1.3 + w.ph;
    const alpha = (Math.sin(ph) + 1) / 2 * 0.55;
    if (alpha > 0.05) {
      const q = P(x + w.u, y + w.v), off = Math.sin(ph * 0.5) * 2.5;
      ctx.strokeStyle = `rgba(200,236,252,${alpha.toFixed(2)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(q.x - 7 + off, q.y);
      ctx.quadraticCurveTo(q.x + off, q.y - 3, q.x + 7 + off, q.y);
      ctx.stroke();
    }
  }
}

// ----- Trees -----
// Deciduous canopy made of overlapping blobs [dx, dy, r] around the crown centre
const CANOPY = [[-6, 2, 7], [6, 2, 7], [0, -4, 8.5], [-3.5, -9, 6], [4, -8.5, 6]];

// Trees are drawn once per variant into an offscreen sprite (vector detail is too costly
// for thousands of trees per frame) and then blitted with drawImage.
const TREE_SPRITE = { w: 36, h: 48, ax: 18, ay: 42, res: 2.5 }; // size/anchor in tree px, render scale
const treeSprites = new Map();

function treeSprite(tr) {
  let spr = treeSprites.get(tr.key);
  if (spr) return spr;
  spr = document.createElement('canvas');
  spr.width = TREE_SPRITE.w * TREE_SPRITE.res;
  spr.height = TREE_SPRITE.h * TREE_SPRITE.res;
  const mainCtx = ctx;
  ctx = spr.getContext('2d');
  try {
    ctx.scale(TREE_SPRITE.res, TREE_SPRITE.res);
    drawTreeVector(TREE_SPRITE.ax, TREE_SPRITE.ay, { ...tr, s: 1 });
  } finally {
    ctx = mainCtx;
  }
  treeSprites.set(tr.key, spr);
  return spr;
}

function drawTreeAt(u, v, tr) {
  const b = P(u, v, 0), s = tr.s, spr = treeSprite(tr);
  ctx.drawImage(spr, b.x - TREE_SPRITE.ax * s, b.y - TREE_SPRITE.ay * s, TREE_SPRITE.w * s, TREE_SPRITE.h * s);
}

// Full vector tree with its base at screen point (bx, by)
function drawTreeVector(bx, by, tr) {
  const b = { x: bx, y: by }, s = tr.s;

  // Shadow falls to the left (light comes from the right)
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(b.x - 5 * s, b.y + 1, 11 * s, 4.5 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  if (tr.conifer) {
    ctx.fillStyle = '#5a3a1e';
    ctx.fillRect(b.x - 1.3 * s, b.y - 7 * s, 2.6 * s, 7 * s);
    for (let i = 0; i < 3; i++) {
      const w = (10 - i * 2.6) * s, yb = b.y - (5 + i * 7.5) * s, yt = yb - 13 * s;
      const tip = { x: b.x, y: yt };
      const L = { x: b.x - w, y: yb }, R = { x: b.x + w, y: yb }, M = { x: b.x, y: yb + 2.5 * s };
      poly(tr.dark, [L, M, tip], null);  // shaded half
      poly(tr.light, [M, R, tip], null); // lit half
      poly(null, [L, M, R, tip], 'rgba(20,40,20,0.55)');
    }
    return;
  }

  // Trunk: tapered, lit on the right
  poly('#5e3c1e', [{ x: b.x - 2.2 * s, y: b.y }, { x: b.x + 2.2 * s, y: b.y }, { x: b.x + 1.2 * s, y: b.y - 13 * s }, { x: b.x - 1.2 * s, y: b.y - 13 * s }], null);
  poly('#7a5230', [{ x: b.x, y: b.y }, { x: b.x + 2.2 * s, y: b.y }, { x: b.x + 1.2 * s, y: b.y - 13 * s }, { x: b.x, y: b.y - 13 * s }], null);

  const cx = b.x, cy = b.y - 21 * s;

  // Draw each layer as one batched path: outline → shadow tone → mid tone → highlights
  const blobs = (grow, ox, oy, rs, color, list = CANOPY) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const [dx, dy, r] of list) {
      const X = cx + (dx + ox) * s, Y = cy + (dy + oy) * s, R = r * s * rs + grow;
      ctx.moveTo(X + R, Y);
      ctx.arc(X, Y, R, 0, Math.PI * 2);
    }
    ctx.fill();
  };
  blobs(1.2, 0, 0, 1, 'rgba(20,40,16,0.6)');
  blobs(0, 0, 0, 1, tr.dark);
  blobs(0, 1.6, -1.6, 0.72, tr.mid);
  blobs(0, 2.6, -2.8, 0.34, tr.light, CANOPY.slice(1, 5));
}

// Trees are drawn according to how much wood is left: felled trees disappear,
// a regrowing tree starts as a small sapling and grows to full size
function drawForest(x, y, tile) {
  const wood = tile.wood ?? tile.woodMax;
  const far = GAME.camera.zoom < GROUND_LOD_ZOOM; // far out, two trees per tile read the same
  tile.trees.forEach((tr, i) => {
    if (far && i >= 2) return;
    const frac = Math.min(1, (wood - i * WOOD_PER_TREE) / WOOD_PER_TREE);
    if (frac <= 0.05) return;
    drawTreeAt(x + tr.u, y + tr.v, frac >= 1 ? tr : { ...tr, s: tr.s * (0.3 + 0.7 * frac) });
  });
}
