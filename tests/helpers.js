'use strict';
// Shared helpers for the tests and the balance simulation: placing buildings like a player would,
// laying roads to the warehouse, and advancing game time.

const { createGame } = require('./harness');

// A fresh game in the setup phase (small map unless told otherwise)
function newGame(settings = {}, seed = 1) {
  const game = createGame({ seed }).newGame(settings);
  return { game, G: game.api };
}

const islandTiles = (G, isl) => G.GAME.grid.filter(t => t.island === isl.id);
const centre = (tiles) => [tiles.reduce((s, t) => s + t.x, 0) / tiles.length, tiles.reduce((s, t) => s + t.y, 0) / tiles.length];
const startIsland = (G) => [...G.GAME.islands.values()].find(i => i.start);

// A building touching a warehouse would block the roads that have to reach it, so keep a free ring around them
function besideWarehouse(G, type, x, y) {
  return G.footprintNeighbors({ type, x, y }).some(([nx, ny]) => {
    const occ = G.GAME.occupancy.get(`${nx},${ny}`);
    return occ && occ !== 'road' && G.buildingById(occ)?.type === 'warehouse';
  });
}

// Tiles from which a road could reach a warehouse: flood fill over roads and buildable ground,
// starting next to every warehouse
function roadReachable(G) {
  const { GAME, DEFS } = G;
  const key = (x, y) => `${x},${y}`;
  const seen = new Set(), q = [];
  const passable = (x, y) => GAME.roads.has(key(x, y)) || G.canPlaceBuilding(x, y, DEFS.road, true);
  for (const w of GAME.buildings.filter(w => w.type === 'warehouse')) {
    for (const [x, y] of G.footprintNeighbors(w)) if (!seen.has(key(x, y)) && passable(x, y)) { seen.add(key(x, y)); q.push([x, y]); }
  }
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = key(x + dx, y + dy);
      if (seen.has(k) || !passable(x + dx, y + dy)) continue;
      seen.add(k);
      q.push([x + dx, y + dy]);
    }
  }
  return seen;
}

// Free spot for `type` nearest to (x, y) on the given island, or null. Buildings that need a road
// only go where one can be laid.
function findSpot(G, type, x, y, { island = null, maxDist = 40, ok = () => true } = {}) {
  const tiles = G.GAME.grid
    .filter(t => (!island || t.island === island.id) && Math.hypot(t.x - x, t.y - y) <= maxDist)
    .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
  const reach = G.needsRoad(G.DEFS[type]) ? roadReachable(G) : null;
  for (const t of tiles) {
    if (type !== 'warehouse' && besideWarehouse(G, type, t.x, t.y)) continue;
    if (reach && !G.footprintNeighbors({ type, x: t.x, y: t.y }).some(([nx, ny]) => reach.has(`${nx},${ny}`))) continue;
    if (!G.checkPlacement(t.x, t.y, type).ok || !ok(t.x, t.y)) continue;
    return [t.x, t.y];
  }
  return null;
}

// Places the free first warehouse on the start island's coast, as close to the middle as possible
function placeFirstWarehouse(G) {
  const isl = startIsland(G);
  const [cx, cy] = centre(islandTiles(G, isl));
  const spot = findSpot(G, 'warehouse', cx, cy, { island: isl, maxDist: 99 });
  if (!spot || !G.placeBuilding(spot[0], spot[1], 'warehouse')) throw new Error('no spot for the first warehouse');
  return G.GAME.buildings.find(b => b.type === 'warehouse');
}

const revealAll = (G) => { G.GAME.seen.fill(1); for (const i of G.GAME.islands.values()) i.discovered = true; };

// Shortest road (breadth-first over buildable tiles) from a building - placed or planned - to the road network
// linked to a warehouse, or to a tile next to a warehouse. Returns [] if already linked, null if impossible.
function roadPath(G, b) {
  const { GAME, DEFS } = G;
  const key = (x, y) => `${x},${y}`;
  const isl = GAME.islands.get(G.tileAt(b.x, b.y)?.island);
  const def = DEFS[b.type];
  const inside = (x, y) => x >= b.x && y >= b.y && x < b.x + def.w && y < b.y + def.h;
  const touchesWarehouse = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
    const occ = GAME.occupancy.get(key(x + dx, y + dy));
    const w = occ && occ !== 'road' && G.buildingById(occ);
    return w && w.type === 'warehouse' && G.islandOfBuilding(w) === isl;
  });
  const reachedRoads = new Set();
  for (const w of GAME.buildings.filter(w => w.type === 'warehouse')) {
    const q = G.footprintNeighbors(w).filter(([x, y]) => GAME.roads.has(key(x, y)));
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i];
      if (reachedRoads.has(key(x, y))) continue;
      reachedRoads.add(key(x, y));
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (GAME.roads.has(key(x + dx, y + dy))) q.push([x + dx, y + dy]);
    }
  }
  const passable = (x, y) => !inside(x, y) && (GAME.roads.has(key(x, y)) || G.canPlaceBuilding(x, y, DEFS.road, true));
  const starts = G.footprintNeighbors(b).filter(([x, y]) => passable(x, y) || touchesWarehouse(x, y) && GAME.occupancy.has(key(x, y)) === false);
  if (G.footprintNeighbors(b).some(([x, y]) => { const occ = GAME.occupancy.get(key(x, y)); return occ && occ !== 'road' && G.buildingById(occ)?.type === 'warehouse'; })) return [];
  const prev = new Map(starts.map(([x, y]) => [key(x, y), null]));
  const q = [...starts];
  let goal = null;
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    if (reachedRoads.has(key(x, y)) || touchesWarehouse(x, y)) { goal = [x, y]; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (prev.has(k) || !passable(nx, ny) || Math.abs(nx - b.x) > 40 || Math.abs(ny - b.y) > 40) continue;
      prev.set(k, [x, y]);
      q.push([nx, ny]);
    }
  }
  if (!goal) return null;
  const path = [];
  for (let p = goal; p; p = prev.get(key(p[0], p[1]))) path.push({ tx: p[0], ty: p[1] });
  return path;
}

// Lays that road for a placed building
function connect(G, b) {
  if (G.GAME.connected.has(b.id) || !G.needsRoad(G.DEFS[b.type])) return true;
  const path = roadPath(G, b);
  if (!path) return false;
  if (path.length) G.placeRoads(path);
  G.recomputeConnectivity();
  return G.GAME.connected.has(b.id);
}

// Builds `type` near (x, y) and connects it by road. Returns the building or null.
function build(G, type, x, y, opts = {}) {
  const spot = findSpot(G, type, x, y, opts);
  if (!spot || !G.placeBuilding(spot[0], spot[1], type)) return null;
  const b = G.GAME.buildings[G.GAME.buildings.length - 1];
  connect(G, b);
  return b;
}

// Advances game time by n seconds: ships move each second and the simulation ticks once
function runTicks(G, n) {
  for (let i = 0; i < n; i++) {
    G.updateShips(1000);
    G.updateTrader(1000);
    G.updatePirates(1000);
    G.updateRivalShip(1000);
    G.tick();
  }
}

// Numbers that must never turn into NaN/Infinity or go negative (except coins)
function assertSane(assert, G) {
  assert.ok(Number.isFinite(G.GAME.coins), 'coins are a number');
  for (const isl of G.GAME.islands.values()) {
    assert.ok(Number.isFinite(isl.pop) && isl.pop >= 0, `population of ${isl.name}`);
    for (const [k, v] of Object.entries(isl.resources)) {
      assert.ok(Number.isFinite(v) && v >= -1e-6, `${k} on ${isl.name} is ${v}`);
      if (isl.cap) assert.ok(v <= isl.cap + 1e-6, `${k} on ${isl.name} over capacity (${v} > ${isl.cap})`);
    }
  }
}

module.exports = { newGame, findSpot, roadPath, placeFirstWarehouse, revealAll, connect, build, runTicks, assertSane, startIsland, islandTiles, centre };
