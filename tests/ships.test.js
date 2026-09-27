'use strict';
// Ships and the sea: path finding, founding colonies, trade routes, the trader, exploring,
// pirates and warships, and the rival trading house.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, placeFirstWarehouse, revealAll, build, findSpot, runTicks, assertSane, islandTiles, centre } = require('./helpers');

function setup(seed = 41, settings = {}) {
  const { G } = newGame({ size: 'medium', ...settings }, seed);
  const wh = placeFirstWarehouse(G);
  const home = G.homeIsland();
  G.GAME.coins = 100000;
  Object.assign(home.resources, { planks: 150, stone: 150, fish: 150, tools: 100 });
  return { G, wh, home };
}

// Founds a colony on the nearest island with room for a harbour. Returns its warehouse.
function foundColony(G, wh) {
  revealAll(G);
  const islands = [...G.GAME.islands.values()].filter(i => !i.home && !i.pirate && i.owner !== 'rival' && i.size >= 40)
    .sort((a, b) => Math.hypot(a.anchor[0] - wh.x, a.anchor[1] - wh.y) - Math.hypot(b.anchor[0] - wh.x, b.anchor[1] - wh.y));
  for (const isl of islands) {
    const [cx, cy] = centre(islandTiles(G, isl));
    const spot = findSpot(G, 'warehouse', cx, cy, { island: isl, maxDist: 99 });
    if (spot && G.placeBuilding(spot[0], spot[1], 'warehouse')) return G.GAME.buildings[G.GAME.buildings.length - 1];
  }
  throw new Error('no island to found a colony on');
}

test('water paths go around land and are symmetric in length', () => {
  const { G, wh } = setup();
  const docks = G.dockTiles(wh);
  assert.ok(docks.length, 'warehouse has docks');
  const edge = G.edgeTileNear(wh.x, wh.y);
  const a = G.waterPath(docks, [[edge.x, edge.y]]);
  const b = G.waterPath([[edge.x, edge.y]], docks);
  assert.ok(a && b);
  assert.ok(Math.abs(a.length - b.length) < 1e-9);
  for (const [x, y] of a.path) assert.ok(G.isWater(x, y), 'path stays on water');
});

test('founding a colony needs a ship and delivers supplies', () => {
  const { G, wh } = setup();
  revealAll(G);
  const isl = [...G.GAME.islands.values()].find(i => !i.home && !i.pirate && i.owner !== 'rival' && i.size >= 40);
  assert.match(G.placementCost('warehouse', isl).block, /skib/);
  G.spawnShip('jolle', wh);
  const colony = foundColony(G, wh);
  const cisl = G.islandOfBuilding(colony);
  assert.ok(cisl.warehouses === 1 && cisl.supplied);
  assert.equal(cisl.resources.planks, G.FOUNDING_SUPPLIES.planks);
  assert.equal(cisl.resources.fish, G.FOUNDING_SUPPLIES.fish);
});

test('a trade route carries goods both ways and respects the minimum stock', () => {
  const { G, wh, home } = setup();
  G.spawnShip('jolle', wh);
  const colony = foundColony(G, wh);
  const cisl = G.islandOfBuilding(colony);
  const ship = G.spawnShip('karavel', wh);
  const r = G.createRoute(wh.id, colony.id, []);
  r.res = ['planks'];
  r.keepRes = { planks: 100 };
  r.back = ['fish'];
  cisl.resources.fish = 60;
  home.resources.planks = 150;
  assert.equal(G.assignShip(ship, r.id), null);
  for (let i = 0; i < 600 && ship.trips < 1; i++) G.updateShips(1000);
  assert.ok(ship.trips >= 1, 'completed a round trip');
  assert.ok(home.resources.planks >= 100 - 1e-9, 'kept the minimum on the home island');
  assert.ok(cisl.resources.planks > G.FOUNDING_SUPPLIES.planks, 'planks delivered');
  assert.ok(ship.cargo.fish > 0 || home.resources.fish > 150 - 1e-9, 'fish on the way back');
  assertSane(assert, G);
});

test('routes longer than a ship\'s range are refused', () => {
  const { G, wh } = setup();
  G.spawnShip('jolle', wh);
  const colony = foundColony(G, wh);
  const r = G.createRoute(wh.id, colony.id, []);
  const jolle = G.GAME.ships[0];
  r.length > G.SHIP_TYPES.jolle.range
    ? assert.match(G.assignShip(jolle, r.id), /kan kun sejle/)
    : assert.equal(G.assignShip(jolle, r.id), null);
});

test('the trader buys surplus and sells what you are short of', () => {
  const { G, wh, home } = setup();
  home.trade = { planks: { sell: 50 }, stone: { buy: 170 } };
  home.resources.planks = 150;
  home.resources.stone = 100;
  const coins = G.GAME.coins;
  G.tradeAt(wh);
  assert.equal(home.resources.planks, 150 - G.TRADE_PER_VISIT);
  assert.equal(home.resources.stone, Math.min(home.cap, 100 + G.TRADE_PER_VISIT));
  assert.equal(G.GAME.coins, coins + G.TRADE_PER_VISIT * G.PRICES.planks - (home.resources.stone - 100) * G.buyPrice('stone'));
  // The trader ship itself comes, trades and leaves
  G.GAME.traderAway = 1;
  G.traderTick();
  assert.ok(G.GAME.trader, 'trader sails in');
  for (let i = 0; i < 800 && G.GAME.trader; i++) G.updateTrader(1000);
  assert.equal(G.GAME.trader, null, 'trader left again');
});

test('ships explore the fog and discover islands', () => {
  const { G, wh } = setup();
  const ship = G.spawnShip('jolle', wh);
  const seen = G.GAME.seen.reduce((a, b) => a + b, 0);
  ship.state = 'autoExplore';
  G.autoExplore(ship);
  runTicks(G, 120);
  assert.ok(G.GAME.seen.reduce((a, b) => a + b, 0) > seen + 500, 'fog lifted');
  assert.ok([...G.GAME.islands.values()].filter(i => i.discovered && !i.home).length >= 1, 'islands discovered');
  // Direct order to a water tile
  const target = G.GAME.grid.find(t => t.ocean && Math.hypot(t.x - ship.x, t.y - ship.y) > 5);
  assert.equal(G.sendShipTo(ship, target.x, target.y), null);
  for (let i = 0; i < 300 && ship.path.length; i++) G.updateShips(1000);
  assert.equal(ship.state, 'idle');
  assert.ok(Math.hypot(ship.x - target.x, ship.y - target.y) < 1);
});

test('the pirate raider plunders unprotected ships', () => {
  const { G, wh } = setup();
  const ship = G.spawnShip('jolle', wh);
  ship.routeId = 'test';
  ship.cargo.planks = 20;
  G.GAME.pirates.nextRaid = 1;
  for (let i = 0; i < 400 && ship.cargo.planks === 20; i++) { G.updatePirates(1000); G.pirateTick(); }
  assert.ok(ship.cargo.planks < 20, 'cargo plundered');
  assert.equal(G.GAME.pirates.ship.state, 'returning');
});

test('warships and watchtowers protect ships and sink the raider', () => {
  const { G, wh } = setup();
  const ship = G.spawnShip('jolle', wh);
  const frigate = G.spawnShip('fregat', wh);
  frigate.x = ship.x; frigate.y = ship.y;
  ship.cargo.planks = 20;
  assert.ok(G.isProtected(ship), 'frigate nearby protects');
  frigate.x += 20;
  assert.ok(!G.isProtected(ship));
  // Combat
  frigate.x = ship.x + 2;
  const coins = G.GAME.coins;
  G.GAME.pirates.ship = { pirate: true, type: 'kogge', name: 'P', x: frigate.x + 2, y: frigate.y, dir: [1, 0], path: [], hp: G.PIRATE_HP, state: 'hunting', target: null, retarget: 0, idle: 0 };
  for (let i = 0; i < 30 && G.GAME.pirates.ship; i++) G.pirateTick();
  assert.equal(G.GAME.pirates.ship, null, 'raider sunk');
  assert.equal(G.GAME.coins, coins + 200);
  assert.ok(frigate.hp < G.WARSHIP_HP, 'frigate took damage');
  // Repairs at the warehouse
  const hp = frigate.hp;
  frigate.x = G.dockTiles(wh)[0][0]; frigate.y = G.dockTiles(wh)[0][1]; frigate.path = [];
  G.repairShips();
  assert.ok(frigate.hp > hp);
});

test('warships can destroy the pirate fort, which frees the island', () => {
  const { G, wh } = setup();
  const f1 = G.spawnShip('fregat', wh), f2 = G.spawnShip('fregat', wh);
  assert.equal(G.attackFort(f1), null);
  assert.equal(G.attackFort(f2), null);
  const coins = G.GAME.coins;
  for (let i = 0; i < 600 && G.GAME.pirates.fortHp > 0; i++) { G.updateShips(1000); G.pirateTick(); }
  assert.equal(G.GAME.pirates.fortHp, 0);
  assert.ok(G.GAME.coins >= coins + G.FORT_REWARD);
  assert.ok(![...G.GAME.islands.values()].some(i => i.pirate), 'pirate island freed');
  assert.ok(G.GAME.ships.filter(G.isWarship).length >= 1, 'two frigates survive together');
});

test('the rival settles free islands but never the two nearest your start', () => {
  const { G } = setup();
  const start = [...G.GAME.islands.values()].find(i => i.start);
  const d = (i) => Math.hypot(i.anchor[0] - start.anchor[0], i.anchor[1] - start.anchor[1]);
  const reserved = [...G.GAME.islands.values()].filter(i => !i.start && !i.pirate && i.size >= 12).sort((a, b) => d(a) - d(b)).slice(0, 2);
  for (let i = 0; i < 10; i++) {
    G.rivalExpand(G.rivalIslands());
    // Known islands are announced first and settled when the warning time is up
    if (G.GAME.rival.plan) { G.GAME.rival.plan.at = G.GAME.tick; G.carryOutPlan(G.GAME.rival); }
  }
  assert.ok(G.rivalIslands().length >= 2, 'rival expanded');
  for (const r of reserved) assert.notEqual(r.owner, 'rival', `${r.name} stays free`);
  // Rival timer
  G.GAME.rival.next = 1;
  const n = G.rivalIslands().length;
  G.rivalTick();
  assert.ok(G.rivalIslands().length >= n);
});

test('trading with the rival and buying a colony', () => {
  const { G, wh, home } = setup();
  const rwh = G.GAME.rival.buildings.find(b => b.type === 'warehouse');
  const risl = G.islandOfBuilding(rwh);
  const own = G.rivalGoods(risl);
  const foreign = G.RES_KEYS.find(k => !own.includes(k));
  const ship = G.spawnShip('karavel', wh);
  ship.cargo[foreign] = 30;
  let coins = G.GAME.coins;
  G.sellToRival(ship, risl);
  assert.equal(ship.cargo[foreign], 0);
  assert.equal(G.GAME.coins, coins + 30 * G.rivalBuyPrice(foreign));
  risl.resources[own[0]] = 50;
  coins = G.GAME.coins;
  G.buyFromRival(ship, risl, [own[0]]);
  assert.ok(ship.cargo[own[0]] > 0);
  assert.equal(G.GAME.coins, coins - ship.cargo[own[0]] * G.rivalSellPrice(own[0]));
  // A route can end at the rival's harbour
  const r = G.createRoute(wh.id, rwh.id, []);
  assert.ok(G.routePath(r), 'route to the rival');
  // Buy-out keeps the harbour (same id, so the route still works)
  const price = G.buyoutPrice(risl);
  coins = G.GAME.coins;
  assert.equal(G.buyRivalIsland(risl), null);
  assert.equal(G.GAME.coins, coins - price);
  assert.equal(risl.owner, null);
  assert.ok(G.GAME.buildings.some(b => b.id === rwh.id && b.type === 'warehouse'), 'harbour is now yours');
  assert.ok(G.routePath(r), 'route still valid');
  assert.ok(!G.GAME.rival.buildings.some(b => G.islandOfBuilding(b) === risl));
});

test('a shipyard builds ships over time', () => {
  const { G, wh, home } = setup();
  for (let i = 0; i < 3; i++) build(G, 'house', wh.x, wh.y, { maxDist: 6 });
  const yard = build(G, 'shipyard', wh.x, wh.y, { maxDist: 30 });
  assert.ok(yard && G.GAME.connected.has(yard.id), 'shipyard connected');
  home.pop = 18;
  assert.equal(G.startShipBuild(yard, 'jolle'), null);
  const ships = G.GAME.ships.length;
  runTicks(G, G.SHIP_TYPES.jolle.buildTime + 2);
  assert.equal(G.GAME.ships.length, ships + 1);
  assert.match(G.startShipBuild(yard, 'karavel'), /Låses op|allerede/);
});

test('a staffed watchtower shoots the raider and shelters nearby ships', () => {
  const { G, wh, home } = setup();
  for (let i = 0; i < 3; i++) build(G, 'house', wh.x, wh.y, { maxDist: 6 });
  const tower = build(G, 'watchtower', wh.x, wh.y, { maxDist: 20 });
  assert.ok(tower, 'tower on the coast');
  home.pop = 18;
  G.tick();
  assert.ok(tower.staffed && G.serviceActiveTower(tower));
  const water = G.GAME.grid.find(t => t.type === 'water' && Math.hypot(t.x - tower.x, t.y - tower.y) <= 3);
  assert.ok(G.inTowerReach(water.x, water.y));
  G.GAME.pirates.ship = { pirate: true, type: 'kogge', name: 'P', x: water.x, y: water.y, dir: [1, 0], path: [], hp: G.PIRATE_HP, state: 'hunting', target: null, retarget: 0, idle: 0 };
  G.pirateTick();
  assert.ok(!G.GAME.pirates.ship || G.GAME.pirates.ship.hp < G.PIRATE_HP, 'raider hit');
});
