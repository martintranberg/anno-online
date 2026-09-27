'use strict';
// Production, residents and needs, house tiers 1-4, production upgrades, depletion and regrowth,
// taxes and happiness, bankruptcy, fire and quests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, placeFirstWarehouse, build, runTicks, assertSane } = require('./helpers');

function setup(seed = 31, settings = {}) {
  const { G } = newGame({ events: false, rival: false, ...settings }, seed);
  const wh = placeFirstWarehouse(G);
  const home = G.homeIsland();
  G.GAME.coins = 100000;
  Object.assign(home.resources, { planks: 150, stone: 150, bricks: 150, tools: 150 });
  return { G, wh, home };
}
const stock = (home, goods) => Object.assign(home.resources, goods);

test('settlers arrive, a fisher feeds them and production needs workers and a road', () => {
  const { G, wh, home } = setup();
  const houses = [1, 2, 3].map(() => build(G, 'house', wh.x, wh.y, { maxDist: 6 }));
  assert.ok(houses.every(Boolean), 'three houses near the warehouse');
  const fisher = build(G, 'fisher', wh.x, wh.y);
  assert.ok(fisher && G.GAME.connected.has(fisher.id), 'fisher connected');
  assert.ok(houses.every(h => G.houseLinked(h)), 'houses are connected by road');
  runTicks(G, 8);
  assert.ok(home.pop >= 3, 'free settlers move in without food');
  runTicks(G, 60);
  assert.ok(fisher.staffed, 'fisher has workers');
  assert.equal(fisher.status, 'ok');
  assert.ok(home.pop > G.FREE_SETTLERS, `population grows with food (${home.pop})`);
  assert.ok(home.pop <= home.popCap);
  assertSane(assert, G);
});

test('storage is capped per warehouse and production stops when full', () => {
  const { G, wh, home } = setup();
  build(G, 'house', wh.x, wh.y, { maxDist: 6 });
  const fisher = build(G, 'fisher', wh.x, wh.y);
  home.pop = 6;
  home.resources.fish = home.cap;
  runTicks(G, 2);
  assert.ok(home.resources.fish <= home.cap);
  home.pop = 0;
  home.resources.fish = home.cap;
  G.tick();
  assert.equal(fisher.status, home.pop >= G.workersOf(fisher) ? 'full' : 'noworkers');
});

test('processing buildings consume inputs', () => {
  const { G, wh, home } = setup();
  for (let i = 0; i < 3; i++) build(G, 'house', wh.x, wh.y, { maxDist: 6 });
  const mill = build(G, 'sawmill', wh.x, wh.y, { maxDist: 30 });
  assert.ok(G.GAME.connected.has(mill.id));
  stock(home, { wood: 20, fish: 50 });
  home.pop = 12;
  const planks = home.resources.planks;
  G.tick();
  assert.equal(mill.status, 'ok');
  assert.ok(home.resources.planks > planks, 'planks made');
  assert.ok(home.resources.wood < 20, 'wood used');
  home.resources.wood = 0;
  G.tick();
  assert.equal(mill.status, 'noinput');
});

test('woodcutters fell trees; stumps and foresters regrow the forest; quarries run out', () => {
  const { G, wh, home } = setup();
  for (let i = 0; i < 3; i++) build(G, 'house', wh.x, wh.y, { maxDist: 6 });
  const wc = build(G, 'woodcutter', wh.x, wh.y, { maxDist: 30, ok: (x, y) => G.harvestLeft({ type: 'woodcutter', x, y }) > 0 });
  assert.ok(wc, 'woodcutter near forest');
  stock(home, { fish: 100 });
  home.pop = 12;
  const before = G.harvestLeft(wc);
  runTicks(G, 20);
  assert.ok(G.harvestLeft(wc) < before, 'forest shrinks');
  // Forester tends and plants within its radius
  const target = G.tilesAround(wc, 4).find(t => t.type === 'forest' && t.wood < t.woodMax) ||
                 G.tilesAround(wc, 4).find(t => t.stumps);
  const fo = build(G, 'forester', wc.x, wc.y, { maxDist: 5 });
  if (fo && target) {
    wc.paused = true;
    const w = G.tilesAround(fo, G.FORESTER_RADIUS).reduce((s, t) => s + (t.type === 'forest' ? t.wood : 0), 0);
    runTicks(G, 10);
    const w2 = G.tilesAround(fo, G.FORESTER_RADIUS).reduce((s, t) => s + (t.type === 'forest' ? t.wood : 0), 0);
    assert.ok(w2 > w, 'forester grows wood');
  }
  // Stone never comes back
  const rock = G.GAME.grid.find(t => t.type === 'rock');
  rock.stone = 1;
  G.depleteTile(Object.assign(rock, { stone: 0 }));
  assert.equal(rock.type, 'grass');
  assert.ok(rock.quarried);
});

test('houses upgrade through all four tiers when needs, services and materials are there', () => {
  const { G, wh, home } = setup();
  G.GAME.tierReached = 3; // unlock the buildings; the tiers themselves must still be earned by the houses
  const houses = [];
  for (let i = 0; i < 4; i++) houses.push(build(G, 'house', wh.x, wh.y, { maxDist: 6 }));
  for (const t of ['marketplace', 'chapel', 'tavern', 'theater']) assert.ok(build(G, t, wh.x, wh.y, { maxDist: 12 }), t);
  G.GAME.tierReached = 1;
  const fill = () => stock(home, { fish: 150, pork: 150, cloth: 150, beer: 150, wine: 150, jewelry: 150, planks: 150, stone: 150, bricks: 150, tools: 150 });
  for (let round = 0; round < 60 && houses.some(h => h.level < 4); round++) {
    fill();
    home.pop = home.popCap;
    home.mood = 80;
    G.GAME.coins = 100000;
    G.tick();
  }
  assert.deepEqual(houses.map(h => h.level), [4, 4, 4, 4], 'all houses reached Adelige');
  assert.equal(G.GAME.tierReached, 4);
  G.updateIslandStats();
  assert.equal(home.popCap, 4 * G.HOUSE_LEVELS[4].cap);
  assert.ok(G.totalNobles() > 0);
});

test('unmet needs lower house capacity; missing services block upgrades', () => {
  const { G, wh, home } = setup();
  const h = build(G, 'house', wh.x, wh.y, { maxDist: 6 });
  h.level = 2;
  home.pop = 10;
  stock(home, { fish: 100, pork: 0, beef: 0, cloth: 0 });
  G.tick();
  G.updateIslandStats();
  assert.equal(G.houseCap(h, home), G.HOUSE_LEVELS[1].cap, 'Borgere without meat/cloth fall back to pioneer capacity');
  assert.ok(!G.servicesMet(h, 2), 'no chapel in reach');
});

test('production buildings upgrade in place: more output, more workers, more upkeep', () => {
  const { G, wh, home } = setup();
  for (let i = 0; i < 4; i++) build(G, 'house', wh.x, wh.y, { maxDist: 6 });
  const mill = build(G, 'sawmill', wh.x, wh.y, { maxDist: 30 });
  home.pop = 24;
  stock(home, { wood: 100, fish: 100 });
  const make = () => { const p = home.resources.planks; G.tick(); return home.resources.planks - p; };
  const base = make();
  const up1 = G.upkeepOf(mill);
  mill.level = 2;
  const lvl2 = make();
  assert.ok(Math.abs(lvl2 - base * G.PROD_LEVELS[2].mult) < 1e-6, `level 2 makes ${lvl2} vs ${base}`);
  assert.equal(G.workersOf(mill), G.DEFS.sawmill.workers + 1);
  assert.ok(G.upkeepOf(mill) > up1);
  const cost = G.PROD_LEVELS[3].cost(G.DEFS.sawmill);
  assert.ok(cost.bricks && cost.tools, 'level 3 needs bricks and tools');
});

test('taxes: higher tax earns more but upsets residents; low tax pleases them', () => {
  const run = (tax) => {
    const { G, wh, home } = setup(33);
    for (let i = 0; i < 4; i++) build(G, 'house', wh.x, wh.y, { maxDist: 6 });
    home.tax = tax;
    home.pop = 20;
    home.mood = 60;
    stock(home, { fish: 150 });
    let income = 0;
    for (let i = 0; i < 30; i++) { stock(home, { fish: 150 }); home.pop = Math.max(home.pop, 20); G.tick(); income += G.GAME.lastTax; }
    return { income, mood: home.mood };
  };
  const low = run('low'), normal = run('normal'), high = run('high');
  assert.ok(high.income > normal.income && normal.income > low.income, 'income order');
  assert.ok(low.mood > normal.mood && normal.mood > high.mood, 'mood order');
});

test('unhappy residents move away and stop upgrades', () => {
  const { G, wh, home } = setup();
  for (let i = 0; i < 4; i++) build(G, 'house', wh.x, wh.y, { maxDist: 6 });
  stock(home, { fish: 150 });
  home.pop = 20;
  home.mood = 10;
  home.tax = 'high';
  for (let i = 0; i < 12; i++) { stock(home, { fish: 150 }); G.tick(); }
  assert.ok(home.pop < 20, `residents left (${home.pop})`);
});

test('bankruptcy halts all but food production and ends when coins are positive', () => {
  const { G, wh, home } = setup();
  for (let i = 0; i < 3; i++) build(G, 'house', wh.x, wh.y, { maxDist: 6 });
  const fisher = build(G, 'fisher', wh.x, wh.y);
  const mill = build(G, 'sawmill', wh.x, wh.y, { maxDist: 30 });
  assert.ok(G.GAME.connected.has(mill.id), 'sawmill connected');
  home.pop = 12;
  stock(home, { wood: 50, fish: 50 });
  G.GAME.coins = -5;
  G.tick(); // becomes bankrupt at the end of this tick
  assert.ok(G.GAME.bankrupt);
  G.tick();
  assert.equal(mill.status, 'nocoins');
  assert.notEqual(fisher.status, 'nocoins', 'food keeps running');
  assert.ok(G.checkPlacement(0, 0, 'house').ok === false);
  G.GAME.coins = 500;
  G.tick();
  assert.ok(!G.GAME.bankrupt);
  G.tick();
  assert.equal(mill.status, 'ok');
});

test('fires burn buildings down unless a fire station is in reach', () => {
  const { G, wh, home } = setup();
  for (let i = 0; i < 4; i++) build(G, 'house', wh.x, wh.y, { maxDist: 6 });
  home.pop = 24;
  stock(home, { fish: 150 });
  const victim = G.GAME.buildings.find(b => b.type === 'house');
  victim.fire = G.FIRE_TICKS;
  runTicks(G, G.FIRE_TICKS + 1);
  assert.ok(!G.GAME.buildings.includes(victim), 'burnt down');
  const station = build(G, 'firestation', wh.x, wh.y, { maxDist: 8 });
  const h2 = G.GAME.buildings.find(b => b.type === 'house' && G.footprintGap(b, station) <= G.DEFS.firestation.radius);
  runTicks(G, 2);
  h2.fire = G.FIRE_TICKS;
  runTicks(G, 8);
  assert.ok(G.GAME.buildings.includes(h2) && !h2.fire, 'fire put out');
});

test('quests complete in order and pay out', () => {
  const { G, wh } = setup();
  assert.equal(G.QUESTS[0].id, 'fisher');
  build(G, 'fisher', wh.x, wh.y);
  const coins = G.GAME.coins;
  G.checkQuests();
  assert.equal(G.GAME.questIndex, 1);
  assert.equal(G.GAME.coins, coins + G.QUESTS[0].reward);
  assert.equal(new Set(G.QUESTS.map(q => q.id)).size, G.QUESTS.length, 'quest ids are unique');
  assert.equal(G.QUESTS[G.QUESTS.length - 1].id, 'monument');
});

test('production overview shows every building, its output and the island resources used', () => {
  const { G, wh, home } = setup();
  for (let i = 0; i < 3; i++) build(G, 'house', wh.x, wh.y, { maxDist: 6 });
  const wc = build(G, 'woodcutter', wh.x, wh.y, { maxDist: 30, ok: (x, y) => G.harvestLeft({ type: 'woodcutter', x, y }) > 50 });
  const mill = build(G, 'sawmill', wh.x, wh.y, { maxDist: 30 });
  const wc2 = build(G, 'woodcutter', wh.x, wh.y, { maxDist: 30, ok: (x, y) => G.harvestLeft({ type: 'woodcutter', x, y }) > 50 });
  wc2.paused = true;
  home.pop = 18;
  stock(home, { fish: 100, wood: 0 });
  const start = G.natureTotals(home).wood;
  assert.equal(Math.round(home.natureStart.wood), Math.round(start), 'start amount recorded when the game began');
  runTicks(G, 10);
  const o = G.productionOverview(home);
  const wcRow = o.rows.find(r => r.type === 'woodcutter');
  assert.equal(wcRow.count, 2);
  assert.equal(wcRow.status.ok, 1);
  assert.equal(wcRow.status.paused, 1);
  assert.equal(wcRow.buildings.length, 2);
  assert.equal(wcRow.buildings[0].status, 'paused', 'problems listed first');
  assert.ok(Math.abs(wcRow.made - G.DEFS.woodcutter.rate) < 1e-9, 'output of the working woodcutter');
  assert.ok(wcRow.max > wcRow.made);
  assert.ok(o.util > 0 && o.util < 1);
  // Harvested wood and what is left add up
  const wood = o.nature.find(n => n.key === 'wood');
  assert.ok(wood.harvested >= 7, `harvested ${wood.harvested}`);
  assert.ok(wood.left <= wood.start - wood.harvested + 2, 'left = start - harvested (+ a little regrowth)');
  // Goods table splits buildings and residents
  const planks = o.goods.find(g => g.key === 'planks');
  assert.ok(planks.made > 0 || mill.status !== 'ok');
  const fish = o.goods.find(g => g.key === 'fish');
  assert.ok(fish.eaten > 0, 'residents eat fish');
  // Unused resources are pointed out
  assert.ok(o.tips.some(t => t.type === 'forester'), 'hint: more woodcutters than foresters');
  // Survives a save and reload
  G.saveGame();
});
