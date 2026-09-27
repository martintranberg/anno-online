'use strict';

// ===== LIFE ON THE ROADS =====
// Purely visual: carts carry goods from working production buildings to the warehouse, and residents walk
// from their houses to the market. They follow the road network and only appear near the camera.
const LIFE_MAX = 50;          // walkers and carts at the same time
const LIFE_RANGE = 28;        // tiles from the camera centre where new ones start
const CART_CHANCE = 1 / 10;   // per working building per tick
const WALKER_CHANCE = 1 / 30; // per linked house per tick
const LIFE_ZOOM = 0.5;        // below this zoom they are neither started nor drawn

const life = { walkers: [], cache: new Map(), cacheKey: '' };
const GOOD_COLORS = { wood: '#8a5a2a', planks: '#d8b070', stone: '#a8a498', fish: '#7ab0d0', grain: '#e0c050', pork: '#e89a8a',
  beef: '#b04a3a', wool: '#f4f0e8', cloth: '#5a7ab0', hops: '#7ab050', beer: '#c89030', clay: '#b0643e', bricks: '#b04a30',
  coal: '#2a2622', ore: '#8a4a2a', tools: '#707880', grapes: '#7a3a7a', wine: '#8a1a3a', gold: '#e8c040', jewelry: '#8ad0ff' };

// Road tiles next to a building's footprint
const roadsBeside = (b) => footprintNeighbors(b).filter(([x, y]) => GAME.roads.has(`${x},${y}`));

// Shortest road path from building a to building b (breadth-first over road tiles), cached until roads change
function roadRoute(a, b) {
  const key = `${GAME.roads.size}:${GAME.buildings.length}`;
  if (key !== life.cacheKey) { life.cache.clear(); life.cacheKey = key; }
  const ck = `${a.id}>${b.id}`;
  if (life.cache.has(ck)) return life.cache.get(ck);
  const goals = new Set(roadsBeside(b).map(([x, y]) => `${x},${y}`));
  const starts = roadsBeside(a);
  const prev = new Map(starts.map(([x, y]) => [`${x},${y}`, null]));
  const q = [...starts];
  let end = null;
  for (let i = 0; i < q.length && !end && q.length < 4000; i++) {
    const [x, y] = q[i];
    if (goals.has(`${x},${y}`)) { end = [x, y]; break; }
    for (const [dx, dy] of DIRS) {
      const k = `${x + dx},${y + dy}`;
      if (!prev.has(k) && GAME.roads.has(k)) { prev.set(k, [x, y]); q.push([x + dx, y + dy]); }
    }
  }
  let path = null;
  if (end) {
    path = [];
    for (let p = end; p; p = prev.get(`${p[0]},${p[1]}`)) path.push(p);
    path.reverse();
  }
  life.cache.set(ck, path);
  return path;
}

function nearestOf(b, list) {
  let best = null, bestD = Infinity;
  for (const o of list) {
    const d = Math.hypot(o.x - b.x, o.y - b.y);
    if (d < bestD) { best = o; bestD = d; }
  }
  return best;
}

function spawnWalker(from, to, kind, good) {
  const path = roadRoute(from, to);
  if (!path || path.length < 2) return;
  const side = (Math.random() - 0.5) * 0.3;
  life.walkers.push({ kind, good, path, i: 0, t: 0, side, speed: kind === 'cart' ? 1.1 : 1.3 + Math.random() * 0.4,
                      shirt: ['#b03a2a', '#3a6ab0', '#3a8a4a', '#c8902a', '#7a4a8a'][Math.floor(Math.random() * 5)], x: path[0][0], y: path[0][1] });
}

function lifeTick() {
  if (GAME.phase !== 'play' || GAME.camera.zoom < LIFE_ZOOM) return;
  const c = screenToWorld(canvas.width / 2, canvas.height / 2);
  const ct = ISO.screenToTile(c.x, c.y);
  const near = (b) => Math.abs(b.x - ct.tx) < LIFE_RANGE && Math.abs(b.y - ct.ty) < LIFE_RANGE;
  const warehouses = GAME.buildings.filter(b => b.type === 'warehouse');
  for (const b of GAME.buildings) {
    if (life.walkers.length >= LIFE_MAX) break;
    if (!near(b) || !isSeen(b.x, b.y)) continue;
    const def = DEFS[b.type];
    if (def.produces && b.status === 'ok' && Math.random() < CART_CHANCE) {
      const isl = islandOfBuilding(b);
      const wh = nearestOf(b, warehouses.filter(w => islandOfBuilding(w) === isl));
      if (wh) spawnWalker(b, wh, 'cart', def.produces);
    } else if (def.house && houseLinked(b) && Math.random() < WALKER_CHANCE) {
      const isl = islandOfBuilding(b);
      const markets = GAME.buildings.filter(m => (m.type === 'warehouse' || m.type === 'marketplace') && islandOfBuilding(m) === isl);
      const m = nearestOf(b, markets);
      if (m) spawnWalker(b, m, 'walker');
    }
  }
}

function updateLife(dt) {
  const sec = dt / 1000;
  for (let n = life.walkers.length - 1; n >= 0; n--) {
    const w = life.walkers[n];
    w.t += w.speed * sec;
    while (w.t >= 1 && w.i < w.path.length - 1) { w.t -= 1; w.i++; }
    if (w.i >= w.path.length - 1) { life.walkers.splice(n, 1); continue; }
    const [x0, y0] = w.path[w.i], [x1, y1] = w.path[w.i + 1];
    // The road may have been removed under them
    if (!GAME.roads.has(`${x1},${y1}`)) { life.walkers.splice(n, 1); continue; }
    w.dx = x1 - x0; w.dy = y1 - y0;
    // Keep to one side of the road
    w.x = x0 + w.dx * w.t - w.dy * w.side;
    w.y = y0 + w.dy * w.t + w.dx * w.side;
  }
}

// A person pulling a hand cart with the goods, or a resident walking
function drawWalker(w) {
  const bob = Math.abs(Math.sin((w.i + w.t) * Math.PI * 2)) * 1.2;
  const face = w.dx - w.dy >= 0 ? 1 : -1; // screen direction
  const p = P(w.x, w.y, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(p.x, p.y, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
  const person = (x, y) => {
    line({ x: x - 1, y }, { x: x - 1.5, y: y - 5 + bob }, '#3a2a1a', 1.2);
    line({ x: x + 1, y }, { x: x + 1.5, y: y - 5 + bob }, '#3a2a1a', 1.2);
    poly(w.shirt, [{ x: x - 2.2, y: y - 5 }, { x: x + 2.2, y: y - 5 }, { x: x + 1.8, y: y - 11 }, { x: x - 1.8, y: y - 11 }], null);
    dot({ x, y: y - 13 }, 2, '#e8c0a0');
  };
  if (w.kind === 'cart') {
    const cx = p.x - face * 7, cy = p.y + 1;
    // Cart: box on a wheel, loaded with the good's colour
    line({ x: cx + face * 3, y: cy - 5 }, { x: p.x, y: p.y - 7 }, '#5a3a1e', 1.2);
    poly('#8a6034', [{ x: cx - 5, y: cy - 8 }, { x: cx + 5, y: cy - 8 }, { x: cx + 4, y: cy - 3 }, { x: cx - 4, y: cy - 3 }], 'rgba(40,24,10,0.6)');
    poly(GOOD_COLORS[w.good] || '#c49a5c', [{ x: cx - 4, y: cy - 8 }, { x: cx + 4, y: cy - 8 }, { x: cx + 2.5, y: cy - 11.5 }, { x: cx - 2.5, y: cy - 11.5 }], null);
    ctx.strokeStyle = '#3a2616';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, cy - 2, 2.5, 0, Math.PI * 2); ctx.stroke();
  }
  person(p.x, p.y);
}
