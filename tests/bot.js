'use strict';
// A simple scripted player for balance simulations. It plays the home island like a careful beginner:
// food first, houses when people run out of room, wood and stone, markets for more houses, meat,
// then a shipyard, exploring, a sheep colony with a route, cloth, a chapel and Borgere.
// It makes at most one decision every few seconds and never spends its last coins.

const { newGame, placeFirstWarehouse, build, connect, findSpot, runTicks, islandTiles, centre } = require('./helpers');

const RESERVE = 60; // coins the bot keeps for upkeep

function createBot(G) {
  const wh = placeFirstWarehouse(G);
  layMainRoads(G, wh);
  return { G, wh, colony: null, log: [], lastAction: '' };
}

// Four straight roads out from the warehouse keep corridors open between the houses (roads are free)
function layMainRoads(G, wh, length = 22) {
  const starts = [[wh.x, wh.y - 1, 0, -1], [wh.x + 2, wh.y, 1, 0], [wh.x + 1, wh.y + 2, 0, 1], [wh.x - 1, wh.y + 1, -1, 0]];
  for (const [sx, sy, dx, dy] of starts) {
    const path = [];
    for (let i = 0; i < length; i++) {
      const x = sx + dx * i, y = sy + dy * i;
      if (!G.canPlaceBuilding(x, y, G.DEFS.road, true)) break;
      path.push({ tx: x, ty: y });
    }
    if (path.length) G.placeRoads(path);
  }
}

function count(bot, type, isl = bot.G.homeIsland()) {
  return bot.G.GAME.buildings.filter(b => b.type === type && bot.G.islandOfBuilding(b) === isl).length;
}

function affordable(bot, type, isl = bot.G.homeIsland()) {
  const { G } = bot, cost = G.DEFS[type].cost;
  return G.GAME.coins - (cost.coins || 0) >= RESERVE && G.hasCost(isl.resources, cost);
}

function tryBuild(bot, type, near, opts = {}) {
  const { G } = bot;
  const isl = opts.island || G.homeIsland();
  if (!affordable(bot, type, isl)) return false;
  const [x, y] = near || [bot.wh.x, bot.wh.y];
  bot.bad ||= new Set();
  const userOk = opts.ok || (() => true);
  const b = build(G, type, x, y, { island: isl, maxDist: 30, ...opts, ok: (bx, by) => !bot.bad.has(`${type}@${bx},${by}`) && userOk(bx, by) });
  if (!b) return false;
  if (G.needsRoad(G.DEFS[type]) && !G.GAME.connected.has(b.id)) {
    // No road possible from here: take it down again and never try this spot for this type
    bot.bad.add(`${type}@${b.x},${b.y}`);
    G.demolishAt(b.x, b.y);
    return false;
  }
  bot.lastAction = `${G.GAME.tick}: ${type}`;
  bot.log.push(bot.lastAction);
  return true;
}

// Houses go where a market (the warehouse or a marketplace) reaches them, leaving a free ring
// around warehouses so roads can still get through
function houseSpotOk(G, isl) {
  const whs = G.GAME.buildings.filter(b => b.type === 'warehouse' && G.islandOfBuilding(b) === isl);
  return (x, y) => !!G.coverageOf({ type: 'house', x, y }, isl).market && whs.every(w => G.footprintGap({ type: 'house', x, y }, w) >= 1);
}

function step(bot) {
  const { G } = bot;
  const home = G.homeIsland();
  const R = home.resources;
  const free = home.workersFree ?? 0;
  const food = FOOD(G, home);
  const houses = count(bot, 'house');
  const act = (type, near, opts) => tryBuild(bot, type, near, opts);

  // 1. The basics
  // (production first, so the houses don't block the roads it needs)
  if (count(bot, 'fisher') < 1) return act('fisher');
  if (count(bot, 'woodcutter') < 1) return act('woodcutter', null, { ok: (x, y) => G.harvestLeft({ type: 'woodcutter', x, y }) > 100 });
  if (count(bot, 'sawmill') < 1) return act('sawmill');
  if (houses < 3) return act('house', null, { ok: houseSpotOk(G, home) });
  if (count(bot, 'forester') < count(bot, 'woodcutter')) {
    const wc = G.GAME.buildings.filter(b => b.type === 'woodcutter' && G.islandOfBuilding(b) === home)[count(bot, 'forester')];
    if (wc && act('forester', [wc.x, wc.y], { maxDist: 5 })) return true;
  }
  // A woodcutter or stonecutter that has emptied its area is moved to fresh forest / rock
  const empty = G.GAME.buildings.find(b => G.DEFS[b.type].harvest && b.status === 'noresource' && G.islandOfBuilding(b) === home);
  if (empty && relocate(bot, empty)) return true;
  // Short of planks with coins to spare: ask the trader for some
  home.trade = home.trade || {};
  home.trade.planks = { buy: G.GAME.coins > 500 && R.planks < 40 ? 80 : null };

  // 2. Food before growth
  if (!food.ok && count(bot, 'fisher') < 2 + home.pop / 25 && act('fisher', null, { maxDist: 45 })) return true;
  if (!food.ok && home.pop >= 20 && count(bot, 'grainfarm') < 1 && act('grainfarm', null, { maxDist: 70 })) return true;
  if (!food.ok && count(bot, 'grainfarm') >= 1 && count(bot, 'pigfarm') < 3 && act('pigfarm')) return true;

  // 3. Room for more people
  const full = home.pop >= home.popCap - 1;
  if (full && houses < 40 && act('house', null, { ok: houseSpotOk(G, home) })) return true;
  // No room for houses near a market any more (or enough houses for one): open a new market
  if ((full || houses >= 5) && houses >= 3 && count(bot, 'marketplace') < 1 + Math.floor(houses / 14)) {
    // A new market a little away from the warehouse opens room for more houses
    const angle = count(bot, 'marketplace') * 2.1;
    if (act('marketplace', [bot.wh.x + Math.round(Math.cos(angle) * 9), bot.wh.y + Math.round(Math.sin(angle) * 9)])) return true;
  }

  // 4. Materials
  if (R.planks < 40 && count(bot, 'woodcutter') < 3 && act('woodcutter', null, { ok: (x, y) => G.harvestLeft({ type: 'woodcutter', x, y }) > 100 })) return true;
  if (R.planks < 40 && count(bot, 'woodcutter') >= 2 && count(bot, 'sawmill') < 2 && act('sawmill')) return true;
  if (count(bot, 'stonecutter') < 1 && home.pop >= 15 && act('stonecutter', null, { ok: (x, y) => G.harvestLeft({ type: 'stonecutter', x, y }) > 150 })) return true;

  // 5. Meat and services
  if (home.pop >= 30 && count(bot, 'grainfarm') < 1 && act('grainfarm', null, { maxDist: 70 })) return true;
  if (count(bot, 'grainfarm') >= 1 && count(bot, 'pigfarm') < 1 && act('pigfarm')) return true;
  if (home.pop >= 50 && count(bot, 'firestation') < 1 && act('firestation')) return true;

  // 6. Ships and a sheep colony for cloth
  if (home.pop >= 35 && count(bot, 'shipyard') < 1 && act('shipyard', null, { maxDist: 70 })) return true;
  const yard = G.GAME.buildings.find(b => b.type === 'shipyard');
  if (yard && !yard.queue && G.GAME.ships.length < 1 && G.GAME.coins > 300) { G.startShipBuild(yard, 'jolle'); return true; }
  const ship = G.GAME.ships[0];
  if (ship && !bot.colony && ship.state === 'idle' && !bot.explored) { ship.state = 'autoExplore'; G.autoExplore(ship); bot.explored = true; return true; }
  if (ship && !bot.colony && G.GAME.tick >= (bot.nextColonyTry || 0)) { bot.nextColonyTry = G.GAME.tick + 30; if (foundSheepColony(bot)) return true; }
  if (bot.colony) return colonyStep(bot);
  return false;
}

function relocate(bot, b) {
  const { G } = bot;
  const isl = G.islandOfBuilding(b), def = G.DEFS[b.type];
  const tiles = G.GAME.grid.filter(t => t.island === isl.id && Math.hypot(t.x - b.x, t.y - b.y) < 30)
    .sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y));
  for (const t of tiles) {
    if (!G.checkPlacement(t.x, t.y, b.type, { move: b }).ok) continue;
    if (G.harvestLeft({ type: b.type, x: t.x, y: t.y }) < (def.harvest.key === 'wood' ? 150 : 150)) continue;
    const old = [b.x, b.y];
    G.startMove(b);
    G.finishMove(t.x, t.y);
    if (!connect(G, b)) { G.startMove(b); G.finishMove(old[0], old[1]); continue; }
    bot.log.push(`${G.GAME.tick}: moved ${b.type}`);
    return true;
  }
  return false;
}

// Is food production keeping up? (stock plus a margin)
function FOOD(G, home) {
  const stockFood = G.FOOD_KEYS.reduce((s, k) => s + home.resources[k], 0);
  const made = G.FOOD_KEYS.reduce((s, k) => s + (home.flowIn?.[k] || 0), 0);
  const eaten = Math.max(0, home.pop - G.FREE_SETTLERS) * G.NEED_RATES.food;
  return { ok: made >= eaten * 1.15 || stockFood > 60, made, eaten, stock: stockFood };
}

function foundSheepColony(bot) {
  const { G } = bot;
  const isl = [...G.GAME.islands.values()]
    .filter(i => i.discovered && !i.home && i.owner !== 'rival' && !i.pirate && i.fertility.includes('sheep') && i.size >= 30)
    .sort((a, b) => Math.hypot(a.anchor[0] - bot.wh.x, a.anchor[1] - bot.wh.y) - Math.hypot(b.anchor[0] - bot.wh.x, b.anchor[1] - bot.wh.y))[0];
  if (!isl) return false;
  const pc = G.placementCost('warehouse', isl);
  if (pc.block || G.GAME.coins < 400 || !G.hasCost(G.homeIsland().resources, G.FOUNDING_COST)) return false;
  // The coast facing home keeps the route short
  const spot = findSpot(G, 'warehouse', bot.wh.x, bot.wh.y, { island: isl, maxDist: 999 });
  if (!spot || !G.placeBuilding(spot[0], spot[1], 'warehouse')) return false;
  bot.colony = G.GAME.buildings[G.GAME.buildings.length - 1];
  bot.log.push(`${G.GAME.tick}: colony on ${isl.name}`);
  // A route: planks and fish out, wool and cloth back
  const r = G.createRoute(bot.wh.id, bot.colony.id, []);
  r.res = ['planks', 'fish', 'stone'];
  r.keepRes = { planks: 40, fish: 30, stone: 20 };
  r.back = ['wool', 'cloth'];
  const ship = G.GAME.ships[0];
  if (G.assignShip(ship, r.id)) {
    // Too far for the jolle: build a kogge later
    bot.needBiggerShip = true;
  }
  return true;
}

function colonyStep(bot) {
  const { G } = bot;
  const cisl = G.islandOfBuilding(bot.colony);
  const home = G.homeIsland();
  const act = (type, opts = {}) => tryBuild(bot, type, [bot.colony.x, bot.colony.y], { island: cisl, ...opts });
  if (count(bot, 'house', cisl) < 2) return act('house', { ok: houseSpotOk(G, cisl) });
  if (count(bot, 'fisher', cisl) < 1) return act('fisher');
  if (count(bot, 'sheepfarm', cisl) < 1) return act('sheepfarm');
  if (count(bot, 'weaver', cisl) < 1) return act('weaver');
  if (cisl.pop >= cisl.popCap - 1 && count(bot, 'house', cisl) < 6 && act('house', { ok: houseSpotOk(G, cisl) })) return true;
  // Wool that reaches home is woven there if the colony has no weaver yet
  if (home.resources.wool > 10 && count(bot, 'weaver') < 1 && tryBuild(bot, 'weaver')) return true;
  if (count(bot, 'chapel') < 1 && G.hasCost(home.resources, G.DEFS.chapel.cost)) return tryBuild(bot, 'chapel', null, { ok: houseSpotOk(G, home) });
  if (count(bot, 'chapel') >= 1 && count(bot, 'chapel') < 1 + Math.floor(count(bot, 'house') / 12)) {
    return tryBuild(bot, 'chapel', null, { ok: houseSpotOk(G, home) });
  }
  return false;
}

// Plays `seconds` of game time and returns snapshots every `every` seconds
function simulate({ seed = 1, settings = {}, seconds = 2400, every = 300, decideEvery = 4 } = {}) {
  const { G } = newGame({ size: 'medium', ...settings }, seed);
  const bot = createBot(G);
  G.GAME.camera.zoom = 0.4; // far out: no carts and walkers to animate, so simulations run faster
  const rows = [];
  let hungryTicks = 0, minCoins = Infinity;
  for (let t = 1; t <= seconds; t++) {
    if (t % decideEvery === 0) step(bot);
    runTicks(G, 1);
    const home = G.homeIsland();
    if (home.hunger > 0 && home.pop > G.FREE_SETTLERS) hungryTicks++;
    minCoins = Math.min(minCoins, G.GAME.coins);
    if (t % every === 0) rows.push(snapshot(G, bot));
  }
  return { G, bot, rows, hungryTicks, minCoins, final: snapshot(G, bot) };
}

function snapshot(G, bot) {
  const home = G.homeIsland();
  const all = [...G.GAME.islands.values()].filter(i => i.warehouses);
  return {
    min: Math.round(G.GAME.tick / 60),
    pop: G.totalPopulation(),
    cap: G.totalPopCap(),
    coins: Math.round(G.GAME.coins),
    net: +(G.GAME.lastTax - G.GAME.lastUpkeep).toFixed(2),
    mood: Math.round(home.mood ?? 0),
    tier: G.GAME.tierReached,
    quest: G.GAME.questIndex,
    buildings: G.GAME.buildings.length,
    islands: all.length,
    ships: G.GAME.ships.length,
    rival: G.rivalIslands().length,
    hunger: home.hunger > 0 ? 'ja' : '',
    bankrupt: G.GAME.bankrupt ? 'ja' : ''
  };
}

module.exports = { simulate, createBot, step };
