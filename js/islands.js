'use strict';

// ===== TERRAIN GENERATION: ARCHIPELAGO =====
// One large home island in the middle, several smaller islands around it, open sea in between.
// Forests, rock outcrops and small lakes are then scattered over the land.
// amount scales the number of islands (ISLAND_AMOUNTS). Returns { grid, pirate: {x, y} | null } where
// pirate is the centre of a small islet reserved for the pirate fort.
function generateTerrain(w, h, amount = 1) {
  const grid = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) grid.push({ x, y, type: 'water' });
  }
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h) ? grid[y * w + x] : null;

  // Island blobs: a big home island in the middle, then islands spread over the sea with wide sea lanes
  const islands = [{ cx: w / 2, cy: h / 2, r: 16 + w * 0.03 }];
  const target = Math.round((w * h / 1300) * amount) + Math.floor(Math.random() * 3);
  for (let tries = 0; islands.length < target && tries < 3000; tries++) {
    const r = 6.5 + Math.random() * (3 + w * 0.06);
    const cx = r + 5 + Math.random() * (w - 2 * r - 10);
    const cy = r + 5 + Math.random() * (h - 2 * r - 10);
    if (islands.every(o => Math.hypot(o.cx - cx, o.cy - cy) > o.r + r + 7)) islands.push({ cx, cy, r });
  }
  // A small pirate islet well away from home
  let pirate = null;
  for (let tries = 0; !pirate && tries < 3000; tries++) {
    const r = 3.2, cx = 8 + Math.random() * (w - 16), cy = 8 + Math.random() * (h - 16);
    const farEnough = Math.hypot(cx - w / 2, cy - h / 2) > w * 0.3 - tries / 300;
    if (farEnough && islands.every(o => Math.hypot(o.cx - cx, o.cy - cy) > o.r + r + 6)) {
      pirate = { cx, cy, r, pirate: true };
      islands.push(pirate);
    }
  }
  const off = Math.random() * 1000;
  for (const t of grid) {
    for (const isl of islands) {
      // Noise-wobbled radius gives natural, irregular coastlines (the pirate islet stays round and solid)
      const wobble = isl.pirate ? 1 : 0.72 + 0.6 * valueNoise((t.x + off) / 6, (t.y + off) / 6);
      if (Math.hypot(t.x - isl.cx, t.y - isl.cy) / isl.r < wobble) { t.type = 'grass'; if (isl.pirate) t.pirateIslet = true; break; }
    }
  }

  // Clusters on land only. Centres are picked on land tiles; the home island is guaranteed forest and rock.
  const land = grid.filter(t => t.type === 'grass' && !t.pirateIslet);
  const home = islands[0];
  const homeLand = land.filter(t => Math.hypot(t.x - home.cx, t.y - home.cy) < home.r * 0.8);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clusters = [];
  const addClusters = (pool, n, type, rMin, rMax) => {
    for (let i = 0; i < n && pool.length; i++) {
      const c = pick(pool);
      clusters.push({ cx: c.x, cy: c.y, radius: rMin + Math.random() * (rMax - rMin), type });
    }
  };
  addClusters(homeLand, 4, 'forest', 3, 5.5);
  addClusters(homeLand, 3, 'rock', 1.5, 3);
  addClusters(land, Math.round(land.length / 140), 'forest', 2.5, 5);
  addClusters(land, Math.round(land.length / 450), 'rock', 1.5, 3.5);
  addClusters(land, Math.round(land.length / 700), 'lake', 1.5, 3);

  for (const t of land) {
    for (const c of clusters) {
      const d = Math.hypot(t.x - c.cx, t.y - c.cy);
      const type = c.type === 'lake' ? 'water' : c.type;
      if (d < c.radius) t.type = type;
      else if (d < c.radius + 2 && Math.random() < 0.3) t.type = type; // ragged edges
    }
  }

  // Beaches along coasts
  for (const t of grid) {
    if (t.type !== 'grass') continue;
    let water = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && at(t.x + dx, t.y + dy)?.type === 'water') water++;
      }
    }
    if (water > 0 && Math.random() < 0.5) t.type = 'beach';
  }
  return { grid, pirate: pirate ? { x: Math.round(pirate.cx), y: Math.round(pirate.cy) } : null };
}

// ===== ISLANDS =====
// Every connected landmass is an island with its own storage (shared by all warehouses on it).
const ISLAND_NAMES = ['Mågeø', 'Ravneø', 'Falkeø', 'Tangø', 'Sælø', 'Lyngø', 'Egeø', 'Klippeø', 'Sandø',
                      'Ørneø', 'Tågeø', 'Stormø', 'Vindø', 'Rævø', 'Hjorteø', 'Birkeø', 'Svaneø', 'Kragø',
                      'Ulveø', 'Bjørneø', 'Odderø', 'Hvaleø', 'Perleø', 'Solø', 'Måneø', 'Stjerneø', 'Rosenø', 'Lindeø',
                      'Askeø', 'Tjørneø', 'Havreø', 'Humleø', 'Skarveø', 'Terneø', 'Lærkeø', 'Uglø', 'Glimtø', 'Tordenø'];
const tileAt = (x, y) => (x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE) ? GAME.grid[y * MAP_SIZE + x] : null;
// A bridge (road on a canal tile) joins the land on both sides into one island; ships still pass beneath
const isBridge = (t) => !!t && t.canal && GAME.roads.has(`${t.x},${t.y}`);
const isLand = (t) => !!t && (t.type !== 'water' || isBridge(t));

// Marks water connected to the map edge as open sea (tile.ocean). Lakes stay false until a canal joins them up.
function markOcean() {
  const q = [];
  for (const t of GAME.grid) {
    t.ocean = false;
    const edge = t.x === 0 || t.y === 0 || t.x === MAP_SIZE - 1 || t.y === MAP_SIZE - 1;
    if (edge && t.type === 'water') { t.ocean = true; q.push(t); }
  }
  for (let i = 0; i < q.length; i++) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = tileAt(q[i].x + dx, q[i].y + dy);
      if (n && n.type === 'water' && !n.ocean) { n.ocean = true; q.push(n); }
    }
  }
}

// Iron ore veins: the rock on two islands (never the start island) holds ore. Farther islands first,
// so tools require real shipping.
function assignOre(startId) {
  const start = GAME.islands.get(startId);
  const sx = start.anchor[0], sy = start.anchor[1];
  const cands = [...GAME.islands.values()].filter(i => i.id !== startId && i.size >= 12 &&
    GAME.grid.some(t => t.island === i.id && t.type === 'rock'));
  cands.sort((a, b) => Math.hypot(a.anchor[0] - sx, a.anchor[1] - sy) - Math.hypot(b.anchor[0] - sx, b.anchor[1] - sy));
  for (const isl of cands.slice(1, 3).concat(cands.length === 1 ? cands : [])) {
    isl.ore = true;
    for (const t of GAME.grid) if (t.island === isl.id && t.type === 'rock') t.ore = ORE_PER_TILE;
  }
}

// Gold: the rock on the farthest rocky island without iron holds gold veins (for the Adelige's jewellery)
function assignGold(startId) {
  const start = GAME.islands.get(startId);
  const sx = start.anchor[0], sy = start.anchor[1];
  const cands = [...GAME.islands.values()].filter(i => i.id !== startId && !i.ore && !i.pirate && i.size >= 12 &&
    GAME.grid.some(t => t.island === i.id && t.type === 'rock'));
  if (!cands.length) {
    // No free rocky island: share the farthest ore island
    const ore = [...GAME.islands.values()].filter(i => i.ore);
    if (ore.length) cands.push(ore[ore.length - 1]);
  }
  cands.sort((a, b) => Math.hypot(b.anchor[0] - sx, b.anchor[1] - sy) - Math.hypot(a.anchor[0] - sx, a.anchor[1] - sy));
  const isl = cands[0];
  if (!isl) return;
  isl.gold = true;
  for (const t of GAME.grid) if (t.island === isl.id && t.type === 'rock') t.gold = GOLD_PER_TILE;
}

// Labels connected land components (4-neighbour). Sets tile.island; returns the components.
function labelIslands() {
  markOcean();
  for (const t of GAME.grid) t.island = null;
  const comps = [];
  let id = 0;
  for (const start of GAME.grid) {
    if (!isLand(start) || start.island !== null) continue;
    id++;
    start.island = id;
    const idx = [start.y * MAP_SIZE + start.x];
    for (let i = 0; i < idx.length; i++) {
      const t = GAME.grid[idx[i]];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = tileAt(t.x + dx, t.y + dy);
        if (isLand(n) && n.island === null) { n.island = id; idx.push(n.y * MAP_SIZE + n.x); }
      }
    }
    // Anchor = first tile in row-major order: stable across reloads, used to match saved island data
    comps.push({ id, size: idx.length, anchor: [start.x, start.y], idx });
  }
  return comps;
}

function newIsland(comp) {
  const used = new Set([...GAME.islands.values()].map(i => i.name));
  let n = Math.floor(hash2(comp.anchor[0], comp.anchor[1]) * ISLAND_NAMES.length);
  for (let k = 0; k < ISLAND_NAMES.length && used.has(ISLAND_NAMES[n]); k++) n = (n + 1) % ISLAND_NAMES.length;
  let name = ISLAND_NAMES[n];
  for (let k = 2; used.has(name); k++) name = `${ISLAND_NAMES[n]} ${k}`; // more islands than names
  return { id: comp.id, size: comp.size, anchor: comp.anchor, name, home: false,
           resources: emptyStock(), pop: 0, hunger: 0, fertility: [], needsMet: {}, mood: MOOD_START, tax: 'normal' };
}

// Gives each island its farming fertility. The home island only has grain, so wool (cloth) and hops (beer)
// must come from other islands - the reason to build ships. The two nearest islands are guaranteed sheep and hops.
function assignFertility(homeId) {
  const centre = (id) => {
    const ts = GAME.grid.filter(t => t.island === id);
    return [ts.reduce((s, t) => s + t.x, 0) / ts.length, ts.reduce((s, t) => s + t.y, 0) / ts.length];
  };
  const home = GAME.islands.get(homeId);
  const [hx, hy] = centre(homeId);
  home.fertility = ['grain'];
  const others = [...GAME.islands.values()].filter(i => i.id !== homeId && i.size >= 12 && !i.pirate)
    .map(i => { const [x, y] = centre(i.id); return { i, d: Math.hypot(x - hx, y - hy) }; })
    .sort((a, b) => a.d - b.d).map(o => o.i);
  // Vines only grow on islands in the far half, so wine needs long voyages
  const keys = Object.keys(FERTILITY).filter(k => k !== 'grapes');
  others.forEach((isl, n) => {
    const f = new Set();
    if (n === 0) f.add('sheep');
    if (n === 1) f.add('hops');
    const r = hash2(isl.anchor[0] + 77, isl.anchor[1] + 13);
    f.add(keys[Math.floor(r * keys.length)]);
    if (r > 0.55) f.add(keys[Math.floor(hash2(isl.anchor[1], isl.anchor[0]) * keys.length)]);
    if (n >= Math.max(2, others.length / 2) && hash2(isl.anchor[0] + 5, isl.anchor[1] + 9) < 0.4) f.add('grapes');
    isl.fertility = [...f];
  });
  ensureGrapes(others);
}

// At least one (far) island must be able to grow grapes
function ensureGrapes(others = [...GAME.islands.values()].filter(i => !i.home && !i.start && !i.pirate && i.size >= 12)) {
  if (!others.length || others.some(i => i.fertility.includes('grapes'))) return;
  const isl = others[Math.max(0, others.length - 2)];
  isl.fertility = [...isl.fertility, 'grapes'];
}

// Re-label islands after the terrain changed (e.g. a canal split a landmass), keeping each island's
// data with the component that holds most of its old tiles. Bigger components claim first.
function recomputeIslands() {
  const prevLabel = GAME.grid.map(t => t.island ?? null);
  const prev = GAME.islands;
  const comps = labelIslands().sort((a, b) => b.size - a.size);
  const next = new Map();
  const claimed = new Set();
  const compCounts = new Map();
  GAME.islands = next; // so newIsland() sees names already taken in this pass
  for (const c of comps) {
    const counts = new Map();
    for (const i of c.idx) {
      const p = prevLabel[i];
      if (p !== null) counts.set(p, (counts.get(p) || 0) + 1);
    }
    compCounts.set(c.id, counts);
    let best = null, bestN = 0;
    for (const [p, n] of counts) if (!claimed.has(p) && prev.has(p) && n > bestN) { best = p; bestN = n; }
    if (best !== null) {
      claimed.add(best);
      next.set(c.id, { ...prev.get(best), id: c.id, size: c.size, anchor: c.anchor });
    } else {
      // A part split off an existing island keeps that island's fertility (but starts with empty storage)
      const isl = newIsland(c);
      let origin = null, originN = 0;
      for (const [p, n] of counts) if (prev.has(p) && n > originN) { origin = p; originN = n; }
      if (origin !== null) isl.fertility = [...prev.get(origin).fertility];
      next.set(c.id, isl);
    }
  }
  // Islands that were joined into another (e.g. by a bridge) hand over their goods, people and fertility
  for (const [p, old] of prev) {
    if (claimed.has(p)) continue;
    let into = null, intoN = 0;
    for (const [cid, counts] of compCounts) if ((counts.get(p) || 0) > intoN) { into = cid; intoN = counts.get(p); }
    if (into === null) continue;
    const isl = next.get(into);
    for (const k of RES_KEYS) isl.resources[k] += old.resources[k];
    isl.pop += old.pop;
    isl.home ||= old.home;
    isl.fertility = [...new Set([...isl.fertility, ...old.fertility])];
  }
  updateIslandStats();
  invalidateRoutes(); // water paths may have changed
}

const islandOfBuilding = (b) => GAME.islands.get(tileAt(b.x, b.y)?.island);

// Chebyshev distance between two building footprints (0 when they touch or overlap)
function footprintGap(a, b) {
  const da = DEFS[a.type], db = DEFS[b.type];
  const dx = Math.max(0, a.x - (b.x + db.w - 1), b.x - (a.x + da.w - 1));
  const dy = Math.max(0, a.y - (b.y + db.h - 1), b.y - (a.y + da.h - 1));
  return Math.max(dx, dy) - 1;
}

// A service building works when it isn't paused, has its workers and isn't on fire
// When you're bankrupt only markets keep going
const serviceActive = (b) => !b.paused && b.staffed !== false && !b.fire &&
  !(GAME.bankrupt && DEFS[b.type].service && DEFS[b.type].service !== 'market');

// Which services reach building b (market/chapel/tavern/fire); warehouses count as small markets
function coverageOf(b, isl) {
  const cov = {};
  for (const s of GAME.buildings) {
    const def = DEFS[s.type];
    const radius = def.service ? def.radius : s.type === 'warehouse' ? WAREHOUSE_MARKET_RADIUS : 0;
    if (!radius || s === b || !serviceActive(s) || islandOfBuilding(s) !== isl) continue;
    const kind = def.service || 'market';
    if (!cov[kind] && footprintGap(b, s) <= radius) cov[kind] = true;
  }
  return cov;
}

const servicesMet = (b, L) => HOUSE_LEVELS[L].services.every(s => b.cov?.[s]);

// A house's capacity: full for its level when its goods needs (last tick) and services are met, otherwise
// the level below. Houses out of any market's reach only hold a couple of self-sufficient pioneers.
// Houses need a road to the warehouse to get their goods (houses built before this rule are exempt)
const houseLinked = (b) => b.roadExempt || GAME.connected.has(b.id);

function houseCap(b, isl) {
  const L = b.level || 1;
  if (!b.cov?.market || !houseLinked(b)) return UNSERVED_CAP;
  const met = HOUSE_LEVELS[L].needs.every(n => isl.needsMet[n] !== false) && servicesMet(b, L);
  return HOUSE_LEVELS[met || L === 1 ? L : L - 1].cap;
}

// Derived per-island numbers: warehouses, storage cap, housing capacity (total and per house level)
function updateIslandStats() {
  for (const isl of GAME.islands.values()) {
    isl.warehouses = 0;
    isl.popCap = 0;
    isl.cap = 0;
    isl.levelCap = new Array(HOUSE_LEVELS.length).fill(0);
    isl.houses = 0;
  }
  for (const b of GAME.buildings) {
    const isl = islandOfBuilding(b);
    if (!isl) continue;
    const def = DEFS[b.type];
    if (b.type === 'warehouse') { isl.warehouses++; isl.cap += def.storage; }
    b.cov = coverageOf(b, isl);
    if (def.house) {
      // Best decoration in reach
      b.beauty = 0;
      for (const d of GAME.buildings) {
        const bd = DEFS[d.type].beauty;
        if (bd && bd.bonus > b.beauty && islandOfBuilding(d) === isl && !d.paused && footprintGap(b, d) <= bd.radius) b.beauty = bd.bonus;
      }
      const c = houseCap(b, isl);
      isl.popCap += c;
      isl.levelCap[b.level || 1] += c;
      isl.houses++;
    }
  }
}

// Residents per house level on an island (population is spread over the houses by capacity)
const popByLevel = (isl) => isl.levelCap.map(c => isl.popCap ? isl.pop * c / isl.popCap : 0);

const totalMerchants = () => [...GAME.islands.values()].reduce((s, i) => s + popByLevel(i)[3], 0);
const totalNobles = () => [...GAME.islands.values()].reduce((s, i) => s + popByLevel(i)[4], 0);
const totalPopulation = () => [...GAME.islands.values()].reduce((s, i) => s + i.pop, 0);
const totalPopCap = () => [...GAME.islands.values()].reduce((s, i) => s + i.popCap, 0);
const homeIsland = () => [...GAME.islands.values()].find(i => i.home);

// Natural resources left on an island: wood in its forests, stone, iron ore and gold in its rock
function natureTotals(isl) {
  const out = { wood: 0, stone: 0, ore: 0, gold: 0 };
  for (const t of GAME.grid) {
    if (t.island !== isl.id) continue;
    if (t.type === 'forest') out.wood += t.wood ?? t.woodMax ?? 0;
    else if (t.type === 'rock') { out.stone += t.stone ?? ROCK_STONE; out.ore += t.ore || 0; out.gold += t.gold || 0; }
  }
  return out;
}

// ----- Fog of war -----
// Unexplored tiles are hidden under clouds. Ships and buildings reveal the map around them.
const SHIP_SIGHT = 7, BUILDING_SIGHT = 6, WAREHOUSE_SIGHT = 9;
let minimapDirty = true;
const isSeen = (x, y) => x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE && GAME.seen[y * MAP_SIZE + x] === 1;

// Reveals a circle; announces islands seen for the first time (quiet during setup/loading)
function reveal(cx, cy, r, quiet = false) {
  const found = new Set();
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(MAP_SIZE - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(MAP_SIZE - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * MAP_SIZE + x;
      if (GAME.seen[i] || (x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      GAME.seen[i] = 1;
      minimapDirty = true;
      fogLayer.dirty = true;
      groundLayer.dirty = true;
      const isl = GAME.islands.get(GAME.grid[i].island);
      if (isl && !isl.discovered) { isl.discovered = true; found.add(isl); }
    }
  }
  if (quiet || GAME.phase !== 'play') return;
  for (const isl of found) {
    if (isl.size < 12 && !isl.pirate) continue;
    const extras = [...isl.fertility.map(f => FERTILITY[f].icon), isl.ore ? '⛏️' : '', isl.gold ? '🥇' : ''].join('');
    notify(isl.pirate ? `🏴‍☠️ Du har fundet piraternes ø!` :
           isl.owner === 'rival' ? `🧭 ${isl.name} er opdaget – den tilhører ${RIVAL_NAME}` :
           `🧭 Ny ø opdaget: ${isl.name} ${extras}`, false);
    sfx('discover');
  }
}

function revealAroundBuilding(b, quiet = false) {
  const def = DEFS[b.type];
  reveal(b.x + (def.w - 1) / 2, b.y + (def.h - 1) / 2, b.type === 'warehouse' ? WAREHOUSE_SIGHT : BUILDING_SIGHT, quiet);
}

// New game: only the start island (and a rim of sea around it) is known
function initFog() {
  GAME.seen = new Uint8Array(MAP_SIZE * MAP_SIZE);
  const start = [...GAME.islands.values()].find(i => i.start);
  const tiles = GAME.grid.filter(t => t.island === start.id);
  const cx = tiles.reduce((s, t) => s + t.x, 0) / tiles.length, cy = tiles.reduce((s, t) => s + t.y, 0) / tiles.length;
  const r = Math.max(...tiles.map(t => Math.hypot(t.x - cx, t.y - cy))) + 4;
  reveal(cx, cy, r, true);
}

// Fog is saved run-length encoded: alternating counts of hidden and seen tiles, starting with hidden
function encodeSeen() {
  const runs = [];
  let cur = 0, n = 0;
  for (const v of GAME.seen) {
    if (v === cur) n++;
    else { runs.push(n); cur = v; n = 1; }
  }
  runs.push(n);
  return runs;
}
function decodeSeen(runs) {
  const seen = new Uint8Array(MAP_SIZE * MAP_SIZE);
  let i = 0, v = 0;
  for (const n of runs) { if (v) seen.fill(1, i, i + n); i += n; v ^= 1; }
  return seen;
}
