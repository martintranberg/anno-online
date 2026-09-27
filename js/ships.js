'use strict';

// ===== SHIPS =====
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const isWater = (x, y) => tileAt(x, y)?.type === 'water';
// Also finds the rival's buildings (their warehouses can be the end point of a trade route)
const buildingById = (id) => GAME.buildings.find(b => b.id === id) || GAME.rival?.buildings.find(b => b.id === id);
const isRivalId = (id) => !!GAME.rival?.buildings.some(b => b.id === id);
// Pirate and rival ships carry no cargo object
const cargoTotal = (s) => s.cargo ? RES_KEYS.reduce((sum, k) => sum + s.cargo[k], 0) : 0;

// Tiny binary min-heap of [priority, value] pairs for Dijkstra
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(p, v) {
    const a = this.a;
    a.push([p, v]);
    for (let i = a.length - 1; i > 0;) {
      const j = (i - 1) >> 1;
      if (a[j][0] <= a[i][0]) break;
      [a[i], a[j]] = [a[j], a[i]];
      i = j;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

// Shortest water route (8-way, no cutting across land corners) from any start tile to any goal tile.
// Returns { path: [[x, y], ...], length } or null if the goals can't be reached by sea.
function waterPath(starts, goals) {
  const N = MAP_SIZE * MAP_SIZE;
  const goalSet = new Set(goals.map(([x, y]) => y * MAP_SIZE + x));
  // Float64 on purpose: with Float32 the stored distance rounds below the heap priority,
  // and the `d > dist[i]` staleness check would wrongly skip nodes reached diagonally
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const heap = new MinHeap();
  for (const [x, y] of starts) {
    if (!isWater(x, y)) continue;
    dist[y * MAP_SIZE + x] = 0;
    heap.push(0, y * MAP_SIZE + x);
  }
  while (heap.size) {
    const [d, i] = heap.pop();
    if (d > dist[i]) continue;
    if (goalSet.has(i)) {
      const path = [];
      for (let k = i; k !== -1; k = prev[k]) path.push([k % MAP_SIZE, Math.floor(k / MAP_SIZE)]);
      return { path: path.reverse(), length: d };
    }
    const x = i % MAP_SIZE, y = Math.floor(i / MAP_SIZE);
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!isWater(nx, ny)) continue;
      if (dx && dy && (!isWater(x + dx, y) || !isWater(x, y + dy))) continue;
      const nd = d + (dx && dy ? 1.414 : 1), j = ny * MAP_SIZE + nx;
      if (nd < dist[j]) { dist[j] = nd; prev[j] = i; heap.push(nd, j); }
    }
  }
  return null;
}

function spawnShip(typeId, shipyard) {
  // Launch on the sea side (a shipyard may also touch a lake)
  const docks = dockTiles(shipyard);
  const [dx, dy] = docks.find(([x, y]) => tileAt(x, y).ocean) || docks[0] || [shipyard.x, shipyard.y];
  const type = SHIP_TYPES[typeId];
  GAME.shipCounter++;
  const n = GAME.ships.filter(s => s.type === typeId).length + 1;
  const ship = { id: `s_${GAME.shipCounter}`, type: typeId, name: `${type.name} ${n}`, x: dx, y: dy, dir: [1, 0],
                 path: [], state: 'idle', cargo: emptyStock(), route: null, timer: 0, trips: 0 };
  if (type.warship) ship.hp = type.hp;
  GAME.ships.push(ship);
  notify(`⛵ ${ship.name} er søsat!`);
  sfx('horn');
  return ship;
}

// Warehouses that ships can use (they need a water tile next to them)
const portWarehouses = () => GAME.buildings.filter(b => b.type === 'warehouse' && dockTiles(b).length);

// ----- Trade routes -----
// A route is drawn by the player: a start warehouse, waypoints in the water and an end warehouse on
// another island. Several ships can sail one route; goods out (res) and back (back) can change any time.
const routeById = (id) => GAME.routes.find(r => r.id === id);
const shipRoute = (s) => (s.routeId && routeById(s.routeId)) || null;
const routeName = (r) => `${islandOfBuilding(buildingById(r.from))?.name ?? '?'} ⇄ ${islandOfBuilding(buildingById(r.to))?.name ?? '?'}`;

// Water path from any start tile, through each waypoint in order, to any goal tile
function pathVia(starts, waypoints, goals) {
  let path = [], length = 0, from = starts;
  for (const target of [...waypoints.map(p => [p]), goals]) {
    const leg = waterPath(from, target);
    if (!leg) return null;
    path = path.length ? path.concat(leg.path.slice(1)) : leg.path;
    length += leg.length;
    from = [leg.path[leg.path.length - 1]];
  }
  return { path, length };
}

// Outbound path of a route, cached until the terrain changes (canals, bridges)
function routePath(r) {
  if (r._path === undefined || r._path === null) {
    const from = buildingById(r.from), to = buildingById(r.to);
    r._path = from && to ? pathVia(dockTiles(from), r.waypoints, dockTiles(to)) : null;
    if (r._path) r.length = Math.round(r._path.length);
  }
  return r._path;
}
const invalidateRoutes = () => { for (const r of GAME.routes) r._path = null; };

function createRoute(fromId, toId, waypoints) {
  GAME.routeCounter++;
  const r = { id: `r_${GAME.routeCounter}`, from: fromId, to: toId, waypoints, res: ['planks'], back: [], keepRes: {}, keepBack: {}, length: 0 };
  GAME.routes.push(r);
  routePath(r);
  return r;
}

function deleteRoute(r) {
  for (const s of GAME.ships) if (s.routeId === r.id) stopRoute(s);
  GAME.routes.splice(GAME.routes.indexOf(r), 1);
}

// Puts a ship on a route. Returns an error string, or null on success.
function assignShip(ship, routeId) {
  const r = routeById(routeId);
  if (!r) return 'Vælg en rute';
  const p = routePath(r);
  if (!p) return 'Ruten kan ikke længere sejles – tegn den om';
  const range = SHIP_TYPES[ship.type].range;
  if (p.length > range) return `Ruten er ${Math.round(p.length)} felter – ${ship.name} kan kun sejle ${range}`;
  const from = buildingById(r.from);
  if (!waterPath([[Math.round(ship.x), Math.round(ship.y)]], dockTiles(from))) {
    return `${ship.name} kan ikke sejle hen til lageret på ${islandOfBuilding(from).name}`;
  }
  ship.routeId = r.id;
  sailTo(ship, from, 'toFrom');
  return null;
}

function stopRoute(ship) {
  ship.routeId = null;
  ship.path = [];
  ship.timer = 0;
  ship.state = 'idle';
}

// Sail from the ship's position, through the waypoints, to a warehouse
function sailTo(ship, target, state, waypoints = []) {
  const res = pathVia([[Math.round(ship.x), Math.round(ship.y)]], waypoints, dockTiles(target));
  if (!res) {
    notify(`⚠ ${ship.name} kan ikke finde en sejlrute og har stoppet`);
    stopRoute(ship);
    return;
  }
  ship.path = res.path;
  ship.state = state;
  if (!ship.path.length) arriveShip(ship);
}

function arriveShip(ship) {
  if (ship.state === 'autoExplore') { autoExplore(ship); return; }
  if (ship.state === 'attacking') return; // fights the fort from here (see pirateTick)
  if (ship.state === 'exploring' || ship.state === 'moving') { ship.state = 'idle'; return; }
  if (!shipRoute(ship)) { ship.state = 'idle'; return; }
  if (ship.state === 'toFrom') { ship.state = 'loading'; ship.timer = 2; }
  else if (ship.state === 'toTo') { ship.state = 'unloading'; ship.timer = 2; }
}

// Unload everything the island has room for, then load the goods for the next leg
function unloadShip(ship, isl) {
  if (isl.owner === 'rival') { sellToRival(ship, isl); return; }
  for (const k of RES_KEYS) {
    const put = Math.min(ship.cargo[k], Math.max(0, isl.cap - isl.resources[k]));
    isl.resources[k] += put;
    ship.cargo[k] -= put;
  }
}

// keep: minimum stock per good that must stay on the island
function loadShip(ship, isl, goods, keep = {}) {
  if (isl.owner === 'rival') { buyFromRival(ship, isl, goods); return; }
  let free = SHIP_TYPES[ship.type].cargo - cargoTotal(ship);
  const spare = (k) => isl.resources[k] - (keep[k] || 0);
  // Share the hold between the chosen goods; a second pass tops up with whatever is left
  for (let pass = 0; pass < 2 && free >= 1; pass++) {
    const wanted = goods.filter(k => spare(k) >= 1);
    if (!wanted.length) break;
    const share = Math.max(1, Math.floor(free / wanted.length));
    for (const k of wanted) {
      const take = Math.floor(Math.min(share, spare(k), free));
      isl.resources[k] -= take;
      ship.cargo[k] += take;
      free -= take;
    }
  }
}

// Loads a leg and remembers what went on board. When nothing could be loaded, says why:
// the minimum stock ("behold mindst") is at or above what the island has, or there's simply none.
function loadLeg(ship, r, isl, goods, keep, leg) {
  const before = { ...ship.cargo };
  loadShip(ship, isl, goods, keep);
  const loaded = Object.fromEntries(RES_KEYS.filter(k => ship.cargo[k] > before[k]).map(k => [k, ship.cargo[k] - before[k]]));
  let note = '';
  if (goods.length && !Object.keys(loaded).length && !isWarship(ship) && isl.owner !== 'rival') {
    const blocked = goods.filter(k => isl.resources[k] >= 1 && isl.resources[k] - (keep[k] || 0) < 1);
    note = blocked.length
      ? `minimumslageret er for højt (${blocked.map(k => `${RES_ICONS[k]} ${Math.floor(isl.resources[k])} ≤ ${keep[k]}`).join(', ')})`
      : `${isl.name} har ingen af varerne på lager`;
    warnOnce(`load-${ship.id}-${leg}`, `⛵ ${ship.name} sejlede tom fra ${isl.name}: ${note}`, 300);
  }
  r.lastLoad = r.lastLoad || {};
  r.lastLoad[leg] = { tick: GAME.tick, loaded, note, ship: ship.name };
}

function finishShipStop(ship) {
  const r = shipRoute(ship);
  const from = r && buildingById(r.from), to = r && buildingById(r.to);
  if (!from || !to) { stopRoute(ship); return; }
  if (ship.state === 'loading') {
    const isl = islandOfBuilding(from);
    unloadShip(ship, isl);          // return cargo from the last trip
    loadLeg(ship, r, isl, r.res, r.keepRes, 'out');
    sailTo(ship, to, 'toTo', r.waypoints);
  } else if (ship.state === 'unloading') {
    const isl = islandOfBuilding(to);
    unloadShip(ship, isl);
    loadLeg(ship, r, isl, r.back, r.keepBack, 'back');
    ship.trips++;
    sailTo(ship, from, 'toFrom', [...r.waypoints].reverse());
  }
}

function updateShips(dt) {
  const sec = dt / 1000;
  for (const s of GAME.ships) {
    if (s.timer > 0) {
      s.timer -= sec;
      if (s.timer <= 0) finishShipStop(s);
      continue;
    }
    if (!s.path.length) continue;
    let move = SHIP_TYPES[s.type].speed * sec * (GAME.storm > 0 ? 0.5 : 1);
    while (move > 0 && s.path.length) {
      const [tx, ty] = s.path[0], dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy);
      if (d > 0.001) s.dir = [dx / d, dy / d];
      if (d <= move) { s.x = tx; s.y = ty; s.path.shift(); move -= d; }
      else { s.x += dx / d * move; s.y += dy / d * move; move = 0; }
    }
    if (!s.path.length) arriveShip(s);
  }
}

function startShipBuild(yard, typeId) {
  const type = SHIP_TYPES[typeId], isl = islandOfBuilding(yard);
  if (yard.queue) return 'Skibsbyggeren er allerede i gang';
  if (!GAME.connected.has(yard.id)) return 'Skibsbyggeren mangler vej til et lager';
  if (GAME.tierReached < type.tier) return `Låses op, når du har ${tierName(type.tier)}`;
  if (!hasCost(isl.resources, type.cost)) return `Ikke nok materialer eller mønter på ${isl.name}`;
  payCost(isl.resources, type.cost);
  yard.queue = { type: typeId, progress: 0 };
  saveGame();
  return null;
}

const SHIP_STATE_TEXT = {
  idle: 'Ligger stille', toFrom: 'Sejler til afhentning', loading: 'Laster varer',
  toTo: 'Sejler med last', unloading: 'Losser varer', exploring: 'Sejler på opdagelse',
  autoExplore: 'Udforsker havet', moving: 'Sejler', attacking: 'Angriber piratfortet'
};

// ----- Exploring and direct orders -----
// Sends a ship (off its route) to a water tile
function sendShipTo(ship, tx, ty, state = 'moving') {
  const res = waterPath([[Math.round(ship.x), Math.round(ship.y)]], [[tx, ty]]);
  if (!res) return `${ship.name} kan ikke sejle derhen`;
  ship.routeId = null;
  ship.timer = 0;
  ship.path = res.path;
  ship.state = state;
  if (!ship.path.length) arriveShip(ship);
  return null;
}

// Sails to the nearest unexplored water (breadth-first over the sea); stops when the whole sea is known
function autoExplore(ship) {
  const sx = Math.round(ship.x), sy = Math.round(ship.y), N = MAP_SIZE * MAP_SIZE;
  const visited = new Uint8Array(N), q = [sy * MAP_SIZE + sx];
  visited[q[0]] = 1;
  let target = null;
  for (let i = 0; i < q.length && !target; i++) {
    const x = q[i] % MAP_SIZE, y = Math.floor(q[i] / MAP_SIZE);
    if (!GAME.seen[q[i]] && Math.hypot(x - sx, y - sy) > 3) { target = [x, y]; break; }
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy, j = ny * MAP_SIZE + nx;
      if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE || visited[j] || !isWater(nx, ny)) continue;
      visited[j] = 1;
      q.push(j);
    }
  }
  if (!target) {
    ship.state = 'idle';
    ship.path = [];
    notify(`🧭 ${ship.name}: der er ikke mere hav at udforske herfra`);
    return;
  }
  // Sail a bit past the fog edge so each leg reveals a good chunk
  const err = sendShipTo(ship, target[0], target[1], 'autoExplore');
  if (err) { ship.state = 'idle'; notify(`⚠ ${err}`); }
}

function startShipOrder(ship, kind = 'move') {
  selectTool(null);
  GAME.shipOrder = { id: ship.id, kind };
  const el = document.getElementById('banner');
  el.hidden = false;
  el.innerHTML = `⛵ ${esc(ship.name)}<small>Klik i vandet, hvor skibet skal sejle hen – også ud i det ukendte · Esc eller højreklik afbryder</small>`;
}

function cancelShipOrder() {
  GAME.shipOrder = null;
  document.getElementById('banner').hidden = true;
}

function handleShipOrderClick(tx, ty) {
  const ship = GAME.ships.find(s => s.id === GAME.shipOrder.id);
  if (!ship) { cancelShipOrder(); return; }
  if (!isWater(tx, ty)) { showToast('Klik i vandet'); return; }
  const err = sendShipTo(ship, tx, ty, isSeen(tx, ty) ? 'moving' : 'exploring');
  if (err) { showToast(`❌ ${err}`); return; }
  cancelShipOrder();
  sfx('click');
  saveGame();
  openInfo('ship', ship.id);
}

// Screen-space convex hull (monotone chain), used for ship hulls
function convexHull(pts) {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function drawShip(s, selected) {
  const T = SHIP_TYPES[s.type], k = T.size;
  const [du, dv] = s.dir, nu = -dv, nv = du;
  const bob = Math.sin(animTime / 500 + s.x * 1.7) * 0.8;
  const pt = (a, b, z) => P(s.x + du * a + nu * b, s.y + dv * a + nv * b, z + bob);
  const L = 0.42 * k, W = 0.15 * k, deckZ = 5 * k;

  if (selected) {
    const c = P(s.x, s.y, 0);
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(c.x, c.y, 26 * k, 13 * k, 0, 0, Math.PI * 2); ctx.stroke();
  }
  // Sail and flag colours: trader red/gold, pirates black, rival white with a red flag, warships navy
  const sailCol = s.trader ? '#c84a3a' : s.pirate ? '#2a2622' : s.rival ? '#efe6d0' : T.warship ? '#e6e0d0' : '#f4ecda';
  const flagCol = s.trader ? '#e8c040' : s.pirate ? '#111' : s.rival ? RIVAL_COLOR : T.warship ? '#1a3a7a' : '#2a5aa8';
  // Wake while sailing
  if (s.path.length) {
    ctx.strokeStyle = 'rgba(240,250,255,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const st = pt(-L, 0, 0);
    for (const side of [-1, 1]) { const e = pt(-L - 0.45 * k, side * W * 2.2, 0); ctx.moveTo(st.x, st.y); ctx.lineTo(e.x, e.y); }
    ctx.stroke();
  }
  const water = [pt(L, 0, 0), pt(L * 0.4, W, 0), pt(-L, W * 0.9, 0), pt(-L, -W * 0.9, 0), pt(L * 0.4, -W, 0)];
  const deck = [pt(L * 1.08, 0, deckZ + 1), pt(L * 0.4, W * 1.1, deckZ), pt(-L, W, deckZ + 1.5), pt(-L, -W, deckZ + 1.5), pt(L * 0.4, -W * 1.1, deckZ)];
  poly(s.pirate ? '#3a2a1e' : T.warship ? '#3e3024' : '#5a3a1e', convexHull([...water, ...deck]));
  poly('#a87c4c', deck);
  if (T.warship || s.pirate) {
    // Gun ports along the visible side
    for (let i = -2; i <= 2; i++) dot(pt(i * L * 0.3, W * 1.02, deckZ * 0.55), 1.3 * k, '#1a1410');
  }
  // Cargo on deck
  if (cargoTotal(s) > 0) {
    const c = pt(-L * 0.35, 0, deckZ + 1);
    poly('#c49a5c', [{ x: c.x - 3 * k, y: c.y }, { x: c.x + 3 * k, y: c.y }, { x: c.x + 3 * k, y: c.y - 4 * k }, { x: c.x - 3 * k, y: c.y - 4 * k }]);
  }
  const masts = k > 1.2 ? [0.3, -0.35] : [0.05];
  const mastH = 22 * k;
  masts.forEach((m, i) => {
    const a = m * L * 2;
    line(pt(a, 0, deckZ), pt(a, 0, deckZ + mastH), '#4a3018', 1.4 * k);
    const sw = W * 2.3, s0 = deckZ + mastH * 0.35, s1 = deckZ + mastH * 0.92, belly = 0.07 * k;
    poly(sailCol, [pt(a, -sw, s1), pt(a, sw, s1), pt(a + belly, sw * 0.95, s0), pt(a + belly, -sw * 0.95, s0)], 'rgba(60,50,40,0.5)');
    if (s.trader) line(pt(a + belly * 0.5, 0, s0), pt(a, 0, s1), '#f4ecda', 2);
    if (s.rival) {
      const c = pt(a + belly * 0.5, 0, (s0 + s1) / 2);
      line({ x: c.x - 4 * k, y: c.y }, { x: c.x + 4 * k, y: c.y }, RIVAL_COLOR, 2);
      line({ x: c.x, y: c.y - 5 * k }, { x: c.x, y: c.y + 5 * k }, RIVAL_COLOR, 2);
    }
    if (s.pirate) {
      const c = pt(a + belly * 0.5, 0, (s0 + s1) / 2);
      dot(c, 2.6 * k, '#e8e0d0');
      line({ x: c.x - 3 * k, y: c.y + 3 * k }, { x: c.x + 3 * k, y: c.y + 5 * k }, '#e8e0d0', 1.2);
      line({ x: c.x + 3 * k, y: c.y + 3 * k }, { x: c.x - 3 * k, y: c.y + 5 * k }, '#e8e0d0', 1.2);
    }
    if (i === 0) {
      const top = pt(a, 0, deckZ + mastH);
      const wave = Math.sin(animTime / 240 + s.x) * 1.5;
      poly(flagCol, [top, { x: top.x + 8 * k, y: top.y + 1 + wave }, { x: top.x + 8 * k, y: top.y + 5 + wave }, { x: top.x, y: top.y + 5 }]);
    }
  });
  // Health bar for damaged warships and raiders
  const maxHp = s.pirate ? PIRATE_HP : T.hp;
  if (maxHp && s.hp < maxHp) {
    const c = P(s.x, s.y, deckZ + mastH + 12);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(c.x - 15, c.y, 30, 4);
    ctx.fillStyle = s.hp / maxHp > 0.5 ? '#6ac04a' : s.hp / maxHp > 0.25 ? '#e0b030' : '#e04a3a';
    ctx.fillRect(c.x - 15, c.y, 30 * Math.max(0, s.hp) / maxHp, 4);
  }
}

function shipAtScreen(px, py) {
  const w = screenToWorld(px, py);
  let best = null, bestD = 18;
  for (const s of GAME.ships) {
    const c = P(s.x, s.y, 10 * SHIP_TYPES[s.type].size);
    const d = Math.hypot(c.x - w.x, c.y - w.y);
    if (d < bestD) { best = s; bestD = d; }
  }
  return best;
}

// ===== TRADER =====
// A free trader sails in from the edge of the map, visits every island that has trade settings, sells what
// you have in surplus (above your "sell above" level) and delivers what you're short of (up to "buy up to").
const buyPrice = (k) => Math.ceil(PRICES[k] * BUY_MARKUP);
const hasTradeSettings = (isl) => !!isl.trade && Object.values(isl.trade).some(v => v && (v.sell != null || v.buy != null));

// One port per island with trade settings
function tradePorts() {
  const seen = new Set(), out = [];
  for (const b of portWarehouses()) {
    const isl = islandOfBuilding(b);
    if (seen.has(isl) || !hasTradeSettings(isl)) continue;
    seen.add(isl);
    out.push(b);
  }
  return out;
}

// Open-sea tile on the map edge nearest to (x, y), where the trader appears and leaves
function edgeTileNear(x, y) {
  let best = null, bestD = Infinity;
  for (const t of GAME.grid) {
    if (!t.ocean || (t.x && t.y && t.x < MAP_SIZE - 1 && t.y < MAP_SIZE - 1)) continue;
    const d = Math.hypot(t.x - x, t.y - y);
    if (d < bestD) { best = t; bestD = d; }
  }
  return best;
}

function traderTick() {
  if (GAME.trader || GAME.phase !== 'play') return;
  GAME.traderAway = (GAME.traderAway ?? 20) - 1;
  if (GAME.traderAway > 0) return;
  const ports = tradePorts();
  if (!ports.length) { GAME.traderAway = 10; return; }
  const e = edgeTileNear(ports[0].x, ports[0].y);
  if (!e) { GAME.traderAway = 60; return; }
  GAME.trader = { trader: true, type: 'kogge', name: 'Handelsmanden', x: e.x, y: e.y, dir: [1, 0], path: [],
                  state: 'sailing', timer: 0, queue: ports.map(p => p.id), target: null, cargo: emptyStock() };
  traderSailNext();
}

function traderSailNext() {
  const T = GAME.trader;
  while (T.queue.length) {
    const b = buildingById(T.queue.shift());
    const res = b && waterPath([[Math.round(T.x), Math.round(T.y)]], dockTiles(b));
    if (res) { T.path = res.path; T.state = 'sailing'; T.target = b.id; return; }
  }
  // All ports visited: sail back out to sea
  const e = edgeTileNear(T.x, T.y);
  const res = e && waterPath([[Math.round(T.x), Math.round(T.y)]], [[e.x, e.y]]);
  T.path = res ? res.path : [];
  T.state = 'leaving';
  T.target = null;
}

function updateTrader(dt) {
  const T = GAME.trader;
  if (!T) return;
  const sec = dt / 1000;
  if (T.timer > 0) {
    T.timer -= sec;
    if (T.timer <= 0) traderSailNext();
    return;
  }
  let move = 2.4 * sec * (GAME.storm > 0 ? 0.5 : 1);
  while (move > 0 && T.path.length) {
    const [tx, ty] = T.path[0], dx = tx - T.x, dy = ty - T.y, d = Math.hypot(dx, dy);
    if (d > 0.001) T.dir = [dx / d, dy / d];
    if (d <= move) { T.x = tx; T.y = ty; T.path.shift(); move -= d; }
    else { T.x += dx / d * move; T.y += dy / d * move; move = 0; }
  }
  if (T.path.length) return;
  if (T.state === 'sailing' && T.target) {
    const b = buildingById(T.target);
    if (b) tradeAt(b);
    T.state = 'trading';
    T.timer = TRADER_WAIT;
  } else if (T.state === 'leaving') {
    GAME.trader = null;
    GAME.traderAway = 60; // back in about a minute
  }
}

function tradeAt(b) {
  const isl = islandOfBuilding(b), sold = [], bought = [];
  let income = 0, spent = 0;
  for (const k of RES_KEYS) {
    const s = isl.trade?.[k];
    if (!s) continue;
    if (s.sell != null && isl.resources[k] > s.sell) {
      const q = Math.min(TRADE_PER_VISIT, Math.floor(isl.resources[k] - s.sell));
      if (q > 0) { isl.resources[k] -= q; income += q * PRICES[k]; sold.push(`${q} ${RES_ICONS[k]}`); }
    }
    if (s.buy != null && isl.resources[k] < s.buy) {
      const q = Math.min(TRADE_PER_VISIT, Math.floor(s.buy - isl.resources[k]), Math.floor(isl.cap - isl.resources[k]),
                         Math.floor(Math.max(0, GAME.coins - spent) / buyPrice(k)));
      if (q > 0) { isl.resources[k] += q; spent += q * buyPrice(k); bought.push(`${q} ${RES_ICONS[k]}`); }
    }
  }
  GAME.coins += income - spent;
  isl.lastTrade = { tick: GAME.tick, income, spent };
  if (sold.length || bought.length) {
    notify(`🛒 Handelsmanden på ${isl.name}: ${sold.length ? `solgte ${sold.join(' ')}` : ''}${sold.length && bought.length ? ' · ' : ''}${bought.length ? `købte ${bought.join(' ')}` : ''} (${income - spent >= 0 ? '+' : ''}${income - spent} 🪙)`, false);
  }
}
