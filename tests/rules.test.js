'use strict';
// Placement rules, roads, fog of war, canals and bridges, demolishing, relocating and the pipette.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, placeFirstWarehouse, revealAll, build, connect, findSpot, startIsland } = require('./helpers');

// Top-left of a w×h patch of free, explored land on the island (optionally away from water)
function freeLand(G, isl, w = 2, h = 2, awayFromWater = 0) {
  return G.GAME.grid.find(t => {
    for (let dy = -awayFromWater; dy < h + awayFromWater; dy++) {
      for (let dx = -awayFromWater; dx < w + awayFromWater; dx++) {
        const q = G.tileAt(t.x + dx, t.y + dy);
        const inside = dx >= 0 && dy >= 0 && dx < w && dy < h;
        if (!q || q.type === 'water') return false;
        if (inside && (q.island !== isl.id || !G.isLandType(q.type) || G.GAME.occupancy.has(`${q.x},${q.y}`) || !G.isSeen(q.x, q.y))) return false;
      }
    }
    return true;
  });
}

function setup(seed = 21) {
  const { game, G } = newGame({}, seed);
  const wh = placeFirstWarehouse(G);
  G.GAME.coins = 50000;
  Object.assign(G.homeIsland().resources, { planks: 150, stone: 150, bricks: 150, tools: 150 });
  return { game, G, wh, home: G.homeIsland() };
}

test('first warehouse must be on the start island coast; later ones need people', () => {
  const { G } = newGame({}, 21);
  const isl = startIsland(G);
  const inland = freeLand(G, isl, 2, 2, 2);
  assert.match(G.checkPlacement(inland.x, inland.y, 'warehouse').reason, /havet/);
  const wh = placeFirstWarehouse(G);
  const spot = findSpot(G, 'warehouse', wh.x, wh.y, { island: isl, ok: () => true, maxDist: 60 });
  assert.equal(spot, null, 'extra warehouse blocked without residents');
  const any = freeLand(G, isl);
  assert.match(G.checkPlacement(any.x, any.y, 'warehouse').reason, /indbyggere/);
});

test('buildings cost island goods and global coins', () => {
  const { G, wh, home } = setup();
  const coins = G.GAME.coins, planks = home.resources.planks;
  const b = build(G, 'woodcutter', wh.x, wh.y);
  assert.ok(b);
  assert.equal(G.GAME.coins, coins - G.DEFS.woodcutter.cost.coins);
  assert.ok(home.resources.planks < planks);
});

test('fog blocks building, canals and route waypoints until explored', () => {
  const { G } = setup();
  const hidden = G.GAME.grid.find(t => !G.isSeen(t.x, t.y) && G.isLandType(t.type));
  assert.match(G.checkPlacement(hidden.x, hidden.y, 'house').reason, /udforsket/);
  assert.match(G.canalCheck(hidden.x, hidden.y).reason, /udforsket/);
  G.reveal(hidden.x, hidden.y, 3);
  assert.ok(G.isSeen(hidden.x, hidden.y));
  assert.ok(G.GAME.islands.get(hidden.island).discovered, 'island marked discovered');
});

test('fertility, tiers and terrain requirements are enforced', () => {
  const { G, home } = setup();
  G.GAME.tierReached = 1;
  const spot = freeLand(G, home, 2, 2, 2);
  assert.match(G.checkPlacement(spot.x, spot.y, 'sheepfarm').reason, /frugtbarhed/);
  assert.match(G.checkPlacement(spot.x, spot.y, 'brewery').reason, /Låses op/);
  assert.match(G.checkPlacement(spot.x, spot.y, 'fisher').reason, /vand/);
  G.GAME.tierReached = 4;
  assert.match(G.placementCost('monument', home).block, /Adelige/);
});

test('rival and pirate islands cannot be built on', () => {
  const { G } = setup();
  revealAll(G);
  const rivalIsl = G.rivalIslands()[0];
  const free = freeLand(G, rivalIsl);
  assert.match(G.checkPlacement(free.x, free.y, 'house').reason, /tilhører/);
  const pirateIsl = [...G.GAME.islands.values()].find(i => i.pirate);
  const pt = freeLand(G, pirateIsl);
  assert.match(G.checkPlacement(pt.x, pt.y, 'house').reason, /Pirat/);
});

test('roads connect production to the warehouse; removing them disconnects', () => {
  const { G, wh } = setup();
  const b = build(G, 'sawmill', wh.x + 6, wh.y + 6, { maxDist: 30 });
  assert.ok(b, 'sawmill placed');
  assert.ok(G.GAME.connected.has(b.id), 'connected by road');
  // Remove every road next to the sawmill
  for (const [x, y] of G.footprintNeighbors(b)) if (G.GAME.roads.has(`${x},${y}`)) G.demolishAt(x, y);
  assert.ok(!G.GAME.connected.has(b.id) || G.footprintNeighbors(b).some(([x, y]) => G.GAME.buildings.some(o => o.type === 'warehouse' && G.GAME.occupancy.get(`${x},${y}`) === o.id)));
});

test('roads through forest fell the trees', () => {
  const { G } = setup();
  revealAll(G);
  const home = G.homeIsland();
  const forest = G.GAME.grid.find(t => t.island === home.id && t.type === 'forest' && !G.GAME.occupancy.has(`${t.x},${t.y}`));
  G.placeRoads([{ tx: forest.x, ty: forest.y }]);
  assert.equal(G.tileAt(forest.x, forest.y).type, 'grass');
  assert.ok(G.GAME.roads.has(`${forest.x},${forest.y}`));
});

test('demolishing refunds half and keeps the last warehouse', () => {
  const { G, wh, home } = setup();
  const b = build(G, 'woodcutter', wh.x, wh.y);
  const coins = G.GAME.coins;
  G.demolishAt(b.x, b.y);
  assert.ok(!G.GAME.buildings.includes(b));
  assert.equal(G.GAME.coins, coins + Math.floor(G.DEFS.woodcutter.cost.coins / 2));
  G.demolishAt(wh.x, wh.y);
  assert.ok(G.GAME.buildings.includes(wh), 'last warehouse on the home island stays');
  // Rival buildings can't be demolished
  const rb = G.GAME.rival.buildings[0];
  G.demolishAt(rb.x, rb.y);
  assert.ok(G.GAME.rival.buildings.includes(rb));
});

test('a canal can split an island and a bridge joins it again', () => {
  const { G, home } = setup();
  const before = G.GAME.islands.size;
  // Dig a canal straight across a narrow part: find a row where the island is short
  const tiles = G.GAME.grid.filter(t => t.island === home.id);
  const rows = new Map();
  for (const t of tiles) (rows.get(t.y) || rows.set(t.y, []).get(t.y)).push(t);
  let dug = false;
  const cy = tiles.reduce((s, t) => s + t.y, 0) / tiles.length;
  for (const [y, row] of [...rows].sort((a, b) => Math.abs(a[0] - cy) - Math.abs(b[0] - cy))) {
    const xs = row.map(t => t.x).sort((a, b) => a - b);
    const path = [];
    for (let x = xs[0]; x <= xs[xs.length - 1]; x++) path.push({ tx: x, ty: y });
    if (G.canalPlan(path).every(r => r.ok)) { G.placeCanals(path); dug = path; break; }
  }
  assert.ok(dug, 'found a straight row to dig across');
  assert.equal(G.GAME.islands.size, before + 1, 'island split in two');
  const mid = dug[Math.floor(dug.length / 2)];
  G.placeRoads([mid]);
  assert.ok(G.isBridge(G.tileAt(mid.tx, mid.ty)));
  assert.equal(G.GAME.islands.size, before, 'bridge joins the halves');
});

test('buildings can be moved on their island for free', () => {
  const { G, wh } = setup();
  const b = build(G, 'woodcutter', wh.x, wh.y);
  const coins = G.GAME.coins;
  const old = [b.x, b.y];
  let target = null;
  for (const t of G.GAME.grid) {
    if (t.island !== G.homeIsland().id || Math.hypot(t.x - b.x, t.y - b.y) < 5) continue;
    if (G.checkPlacement(t.x, t.y, 'woodcutter', { move: b }).ok) { target = [t.x, t.y]; break; }
  }
  G.startMove(b);
  G.finishMove(target[0], target[1]);
  assert.deepEqual([b.x, b.y], target);
  assert.equal(G.GAME.moving, null);
  assert.equal(G.GAME.coins, coins, 'moving is free');
  assert.ok(!G.GAME.occupancy.has(`${old[0]},${old[1]}`), 'old tiles freed');
  assert.equal(G.GAME.occupancy.get(`${target[0]},${target[1]}`), b.id);
  // Not to another island
  revealAll(G);
  const other = G.GAME.grid.find(t => t.island !== G.homeIsland().id && t.island && G.isLandType(t.type) && !G.GAME.occupancy.has(`${t.x},${t.y}`));
  assert.match(G.checkPlacement(other.x, other.y, 'woodcutter', { move: b }).reason, /.+/);
});

test('pipette picks the building type under the cursor', () => {
  const { G, wh } = setup();
  const b = build(G, 'fisher', wh.x, wh.y);
  G.GAME.hoveredTile = { tx: b.x, ty: b.y };
  G.pipette();
  assert.equal(G.GAME.selectedBuilding, 'fisher');
});

test('connect helper keeps working (roads reach the warehouse)', () => {
  const { G, wh } = setup();
  const b = build(G, 'stonecutter', wh.x, wh.y, { maxDist: 40 });
  if (b) assert.ok(connect(G, b));
});
