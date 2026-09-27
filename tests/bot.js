'use strict';
// A simple scripted player for balance simulations. It plays like a careful beginner: food first, houses
// when people run out of room, wood and stone, markets, meat, then a shipyard, exploring and colonies with
// trade routes (sheep, hops, iron ore, grapes, gold), and the services and chains of every tier up to the
// monument.
// It makes at most one decision every few seconds and never spends its last coins.

const { newGame, placeFirstWarehouse, build, connect, findSpot, runTicks, islandTiles, centre } = require('./helpers');

const RESERVE = 60; // coins the bot keeps for upkeep

function createBot(G) {
  const wh = placeFirstWarehouse(G);
  layMainRoads(G, wh);
  return { G, wh, colony: null, colonies: {}, nextColonyTry: {}, log: [], lastAction: '', stats: { festivals: 0, contracts: 0, gifts: 0, parks: 0 } };
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
  const empty = G.GAME.buildings.find(b => G.DEFS[b.type].harvest && b.status === 'noresource');
  if (empty && (bot.relocAt?.[empty.id] || 0) <= G.GAME.tick) {
    if (relocate(bot, empty)) return true;
    (bot.relocAt ||= {})[empty.id] = G.GAME.tick + 300; // nowhere better right now: try again later
  }
  // Short of planks with coins to spare: ask the trader for some
  home.trade = home.trade || {};
  home.trade.planks = { buy: G.GAME.coins > 500 && R.planks < 40 ? 80 : null };
  // Later on, buy the upgrade materials the islands can't make (yet)
  if (G.GAME.tierReached >= 2) home.trade.tools = { buy: G.GAME.coins > 2000 && R.tools < 30 ? 60 : null };

  // 2. Food before growth
  if (!food.ok && count(bot, 'fisher') < 2 + home.pop / 25 && act('fisher', null, { maxDist: 45 })) return true;
  if (!food.ok && home.pop >= 20 && count(bot, 'grainfarm') < 1 && act('grainfarm', null, { maxDist: 70 })) return true;
  if (!food.ok && count(bot, 'grainfarm') >= 1 && count(bot, 'pigfarm') < 3 && act('pigfarm')) return true;

  // 3. Room for more people
  const full = home.pop >= home.popCap - 1;
  if (full && houses < 70 && act('house', null, { ok: houseSpotOk(G, home) })) return true;
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

  // 6. Spend spare coins like a player would: contracts it can fill at once, festivals when the mood
  //    sags, parks between the houses, gifts when the rival turns cold, and some defence
  for (const c of G.GAME.contracts.filter(c => !c.accepted)) {
    if (R[c.good] >= c.amount + 20 && G.acceptContract(c) === null && G.deliverContract(c, home) === null) { bot.stats.contracts++; return true; }
  }
  if (G.GAME.coins > 1500 && home.pop >= 30 && (home.mood ?? 60) < 65 && !home.festival && !home.festivalCooldown && G.holdFestival(home) === null) {
    bot.stats.festivals++;
    return true;
  }
  const nearHouses = (x, y) => G.GAME.buildings.some(h => G.DEFS[h.type].house && Math.hypot(h.x - x, h.y - y) < 5);
  if (G.GAME.coins > 1500 && houses >= 8 && count(bot, 'park') < Math.floor(houses / 8) && act('park', null, { ok: nearHouses })) {
    bot.stats.parks++;
    return true;
  }
  if (G.GAME.rival && G.rivalRelation() < 40 && G.GAME.coins > 3000 && G.sendGift() === null) { bot.stats.gifts++; return true; }
  if (G.QUESTS[G.GAME.questIndex]?.id === 'defence' && count(bot, 'watchtower') < 1 && act('watchtower', null, { maxDist: 40 })) return true;

  // 7. Ships and colonies: sheep for cloth first, later hops, iron ore, grapes and gold
  if (home.pop >= 25 && count(bot, 'shipyard') < 1) {
    if (act('shipyard', null, { maxDist: 70 })) return true;
    // No free coast: fell coastal forest near the warehouse to make room
    if (clearRoom(bot, bot.wh, (t) => G.touchesWater(t.x, t.y), 14)) return true;
  }
  if (shipsStep(bot)) return true;
  for (const plan of COLONY_PLANS) {
    if (G.GAME.tierReached < plan.tier) continue;
    const col = bot.colonies[plan.key];
    if (!col) {
      if (G.GAME.tick >= (bot.nextColonyTry[plan.key] || 0)) {
        bot.nextColonyTry[plan.key] = G.GAME.tick + 30;
        if (foundColony(bot, plan)) return true;
      }
      break; // one new colony at a time
    }
    if (colonyStep(bot, plan, col)) return true;
  }

  // 8. The towns grow up: services and chains for Borgere, Købmænd and Adelige on the home island
  return lateGameStep(bot);
}

// Colonies the bot founds, in order. `builds` are placed on the colony, `back` is shipped home.
// Residents of Borgere and up (they want meat and cloth), and of Købmænd and up (beer)
const upperPop = (G) => [...G.GAME.islands.values()].reduce((s, i) => { const p = G.popByLevel(i); return s + p[2] + p[3] + p[4]; }, 0);
// How many of a producer are needed for a demand per second, with a margin
const needed = (demand, rate) => Math.max(1, Math.ceil(demand * 1.3 / rate));

const COLONY_PLANS = [
  { key: 'sheep',  tier: 1, pick: (i) => i.fertility.includes('sheep'),  builds: ['sheepfarm', 'weaver'], back: ['wool', 'cloth'],
    scale: (G) => needed(upperPop(G) * G.NEED_RATES.cloth, G.DEFS.weaver.rate) },
  { key: 'hops',   tier: 2, pick: (i) => i.fertility.includes('hops'),   builds: ['hopfarm'], back: ['hops'],
    scale: (G) => needed((G.totalMerchants() + G.totalNobles()) * G.NEED_RATES.beer, G.DEFS.brewery.rate) },
  { key: 'ore',    tier: 2, pick: (i) => i.ore,                          builds: ['mine', 'woodcutter', 'charcoal'], back: ['ore', 'coal'] },
  { key: 'grapes', tier: 3, pick: (i) => i.fertility.includes('grapes'), builds: ['vineyard', 'winery'], back: ['grapes', 'wine'] },
  { key: 'gold',   tier: 3, pick: (i) => i.gold,                         builds: ['goldmine'], back: ['gold'] }
];

// Builds ships: one per colony route, the smallest type that reaches it
function shipsStep(bot) {
  const { G } = bot;
  const yard = G.GAME.buildings.find(b => b.type === 'shipyard');
  if (!yard) return false;
  const first = G.GAME.ships[0];
  if (first && !bot.explored && first.state === 'idle') { first.state = 'autoExplore'; G.autoExplore(first); bot.explored = true; return true; }
  assignShips(bot);
  if (yard.queue || G.GAME.coins < 400) return false;
  // Keep one ship exploring while there's sea left to find and a colony plan without a known island
  const explorer = G.GAME.ships.find(s => s.id === bot.explorerId);
  const unknownLeft = G.GAME.seen.reduce((a, b) => a + b, 0) < G.GAME.seen.length * 0.9;
  if (!explorer && unknownLeft && bot.wantsIsland && G.hasCost(G.homeIsland().resources, G.SHIP_TYPES.jolle.cost) && G.startShipBuild(yard, 'jolle') === null) {
    bot.explorerPending = true;
    bot.log.push(`${G.GAME.tick}: ship jolle (explorer)`);
    return true;
  }
  // Busy routes (the last trip home came back full) get another ship, up to three per route
  const busy = G.GAME.routes.find(r => {
    const ships = G.GAME.ships.filter(s => s.routeId === r.id);
    const back = r.lastLoad?.back;
    return ships.length && ships.length < 3 && back && Object.values(back.loaded).reduce((a, b) => a + b, 0) >= G.SHIP_TYPES[ships[0].type].cargo * 0.9;
  });
  const unserved = G.GAME.routes.filter(r => !G.GAME.ships.some(s => s.routeId === r.id));
  if (busy) unserved.push(busy);
  if (G.GAME.ships.length && !unserved.length) return false;
  const len = unserved[0] ? (G.routePath(unserved[0])?.length ?? 999) : 0;
  const type = ['jolle', 'kogge', 'karavel'].find(t => G.SHIP_TYPES[t].range >= len && G.SHIP_TYPES[t].tier <= G.GAME.tierReached &&
    G.hasCost(G.homeIsland().resources, G.SHIP_TYPES[t].cost));
  if (!type || G.startShipBuild(yard, type) !== null) return false;
  bot.log.push(`${G.GAME.tick}: ship ${type}`);
  return true;
}

// Idle ships that aren't exploring take unserved routes they can reach
function assignShips(bot) {
  const { G } = bot;
  // A newly launched explorer goes exploring
  if (bot.explorerPending) {
    const s = G.GAME.ships.find(x => x.state === 'idle' && !x.routeId && !G.isWarship(x));
    if (s) { bot.explorerPending = false; bot.explorerId = s.id; s.state = 'autoExplore'; G.autoExplore(s); }
  }
  const free = (x) => x.id !== bot.explorerId && (x.state === 'idle' || x.state === 'autoExplore') && !x.routeId && !G.isWarship(x);
  for (const r of G.GAME.routes) {
    const n = G.GAME.ships.filter(s => s.routeId === r.id).length;
    const back = r.lastLoad?.back;
    const full = n && back && Object.values(back.loaded).reduce((a, b) => a + b, 0) >= 0.9 * G.SHIP_TYPES[G.GAME.ships.find(s => s.routeId === r.id).type].cargo;
    if (n && !(full && n < 3)) continue;
    const s = G.GAME.ships.find(x => free(x) && G.assignShip(x, r.id) === null);
    if (s) bot.log.push(`${G.GAME.tick}: ${s.name} sails ${G.routeName(r)}`);
  }
}

function foundColony(bot, plan) {
  const { G } = bot;
  const home = G.homeIsland();
  const isl = [...G.GAME.islands.values()]
    .filter(i => i.discovered && !i.home && i.owner !== 'rival' && !i.pirate && !i.warehouses && i.size >= (plan.key === 'gold' || plan.key === 'ore' ? 12 : 30) && plan.pick(i))
    .sort((a, b) => Math.hypot(a.anchor[0] - bot.wh.x, a.anchor[1] - bot.wh.y) - Math.hypot(b.anchor[0] - bot.wh.x, b.anchor[1] - bot.wh.y))[0];
  if (!isl) {
    // Nothing suitable known yet: keep exploring (shipsStep builds an explorer if needed)
    bot.wantsIsland = plan.key;
    const s = G.GAME.ships.find(x => x.id === bot.explorerId && x.state === 'idle');
    if (s) { s.state = 'autoExplore'; G.autoExplore(s); }
    return false;
  }
  bot.wantsIsland = null;
  const pc = G.placementCost('warehouse', isl);
  if (pc.block || G.GAME.coins < 400 || !G.hasCost(home.resources, G.FOUNDING_COST)) return false;
  // The coast facing home keeps the route short
  const spot = findSpot(G, 'warehouse', bot.wh.x, bot.wh.y, { island: isl, maxDist: 999 });
  if (!spot || !G.placeBuilding(spot[0], spot[1], 'warehouse')) return false;
  const wh = G.GAME.buildings[G.GAME.buildings.length - 1];
  bot.log.push(`${G.GAME.tick}: colony (${plan.key}) on ${isl.name}`);
  // Building materials and food out, the colony's goods back
  const r = G.createRoute(bot.wh.id, wh.id, []);
  r.res = ['planks', 'fish', 'stone', 'tools'];
  r.keepRes = { planks: 40, fish: 30, stone: 20, tools: 10 };
  r.back = plan.back;
  bot.colonies[plan.key] = { wh, route: r };
  if (plan.key === 'sheep') bot.colony = wh;
  assignShips(bot);
  return true;
}

function colonyStep(bot, plan, col) {
  const { G } = bot;
  const cisl = G.islandOfBuilding(col.wh);
  const act = (type, opts = {}) => tryBuild(bot, type, [col.wh.x, col.wh.y], { island: cisl, maxDist: 40, ...opts });
  if (count(bot, 'house', cisl) < 2) return act('house', { ok: houseSpotOk(G, cisl) }) || clearRoom(bot, col.wh);
  if (count(bot, 'fisher', cisl) < 1 + Math.floor(cisl.pop / 30) && act('fisher')) return true;
  // The colony's producers, more of them as demand at home grows
  const target = Math.min(6, plan.scale ? plan.scale(G) : 1);
  for (const type of plan.builds) {
    if (count(bot, type, cisl) >= target) continue;
    const ok = G.DEFS[type].harvest ? (x, y) => G.harvestLeft({ type, x, y }) > 50 : undefined;
    if (act(type, { ok })) return true;
    if (count(bot, type, cisl) === 0 && clearRoom(bot, col.wh, () => true, 11)) return true; // no room: fell forest
  }
  if (count(bot, 'house', cisl) < 2 + target * 2 && cisl.pop >= cisl.popCap - 1 && act('house', { ok: houseSpotOk(G, cisl) })) return true;
  if (cisl.pop >= cisl.popCap - 1 && count(bot, 'house', cisl) < 8 && act('house', { ok: houseSpotOk(G, cisl) })) return true;
  // Wooded islands: fell some forest near the warehouse to make room (at most every few minutes)
  return clearRoom(bot, col.wh);
}

function clearRoom(bot, wh, where = () => true, radius = 7) {
  const { G } = bot;
  if (G.GAME.tick < (bot.nextClear?.[wh.id] || 0)) return false;
  (bot.nextClear ||= {})[wh.id] = G.GAME.tick + 180;
  const isl = G.islandOfBuilding(wh);
  const forest = G.GAME.grid.filter(t => t.island === isl.id && G.canClearForest(t.x, t.y) && Math.hypot(t.x - wh.x, t.y - wh.y) < radius && where(t))
    .sort((a, b) => Math.hypot(a.x - wh.x, a.y - wh.y) - Math.hypot(b.x - wh.x, b.y - wh.y)).slice(0, 12);
  for (const t of forest) G.clearForest(t.x, t.y);
  if (forest.length) bot.log.push(`${G.GAME.tick}: cleared ${forest.length} forest on ${isl.name}`);
  return forest.length > 0;
}

// Services and processing chains on the home island, as the tiers allow
function lateGameStep(bot) {
  const { G } = bot;
  const home = G.homeIsland();
  const R = home.resources;
  const houses = count(bot, 'house');
  const amongHouses = (x, y) => G.GAME.buildings.filter(h => G.DEFS[h.type].house && G.islandOfBuilding(h) === home && Math.hypot(h.x - x, h.y - y) < 7).length >= 3;
  const act = (type, opts) => tryBuild(bot, type, null, { maxDist: 50, ...opts });
  const want = (type, n, opts) => count(bot, type) < n && act(type, opts);
  // Taverns and theatres go where the higher tiers live, or they never reach them
  const nearLevel = (L) => (x, y) => G.GAME.buildings.some(h => G.DEFS[h.type].house && (h.level || 1) >= L && G.islandOfBuilding(h) === home && !h.cov?.[L >= 3 ? 'theater' : 'tavern'] && Math.hypot(h.x - x, h.y - y) < 8);
  const unservedAt = (L, svc) => G.GAME.buildings.some(h => G.DEFS[h.type].house && (h.level || 1) >= L && G.islandOfBuilding(h) === home && !h.cov?.[svc]);
  // Wool that reaches home is woven here if the colony has no weaver
  if (R.wool > 10 && want('weaver', 1)) return true;
  if (G.hasCost(R, G.DEFS.chapel.cost) && want('chapel', 1 + Math.floor(houses / 12), { ok: amongHouses })) return true;
  // Pioneer houses outside every chapel's reach get one of their own (they can't become Borgere without it)
  const noChapel = (x, y) => G.GAME.buildings.some(h => G.DEFS[h.type].house && G.islandOfBuilding(h) === home && !h.cov?.chapel && Math.hypot(h.x - x, h.y - y) < 8);
  if (G.GAME.buildings.some(h => G.DEFS[h.type].house && G.islandOfBuilding(h) === home && !h.cov?.chapel) && count(bot, 'chapel') < 10 &&
      G.hasCost(R, G.DEFS.chapel.cost)) {
    if (act('chapel', { ok: noChapel })) return true;
    if (clearRoom(bot, bot.wh, (t) => noChapel(t.x, t.y), 50)) return true;
  }
  if (G.GAME.tierReached >= 2) {
    // Meat for everyone from Borgere up: pig farms, and grain farms to feed them
    const pigs = needed(upperPop(G) * G.NEED_RATES.meat, G.DEFS.pigfarm.rate);
    if (want('grainfarm', Math.ceil(pigs * G.DEFS.pigfarm.consumes.grain / G.DEFS.grainfarm.rate) + 1, { maxDist: 70 })) return true;
    if (want('pigfarm', pigs)) return true;
    if (R.hops > 5 && want('brewery', 1)) return true;
    if (unservedAt(2, 'tavern') && count(bot, 'tavern') < 8) {
      if (act('tavern', { ok: nearLevel(2) })) return true;
      // No room among the Borgere: fell forest there
      if (clearRoom(bot, bot.wh, (t) => nearLevel(2)(t.x, t.y), 50)) return true;
    }
    if (want('claypit', 1, { maxDist: 70 })) return true;
    if (count(bot, 'claypit') && want('brickworks', 1)) return true;
    if ((R.ore > 5 || R.coal > 5) && want('smithy', 1)) return true;
    if (R.ore > 5 && R.coal < 5 && want('charcoal', 1)) return true;

  }
  if (G.GAME.tierReached >= 3) {
    if (unservedAt(3, 'theater') && count(bot, 'theater') < 6) {
      if (act('theater', { ok: nearLevel(3) })) return true;
      if (clearRoom(bot, bot.wh, (t) => nearLevel(3)(t.x, t.y), 50)) return true;
    }
    if (R.grapes > 5 && want('winery', 1)) return true;
    if (R.gold > 5 && want('goldsmith', 1)) return true;
    if (R.gold > 5 && R.coal < 5 && want('charcoal', 2)) return true;
  }
  if (G.GAME.tierReached >= 4 && G.totalNobles() >= G.MONUMENT_POP && want('monument', 1, { maxDist: 70 })) return true;
  // More room once the houses are full
  if (home.pop >= home.popCap - 1 && houses < 70 && act('house', { ok: houseSpotOk(G, home) })) return true;
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
    borg: Math.round([...G.GAME.islands.values()].reduce((t, i) => t + G.popByLevel(i)[2], 0)),
    købm: Math.round(G.totalMerchants()),
    adel: Math.round(G.totalNobles()),
    quest: G.GAME.questIndex,
    buildings: G.GAME.buildings.length,
    islands: all.length,
    ships: G.GAME.ships.length,
    rival: G.rivalIslands().length,
    hunger: home.hunger > 0 ? 'ja' : '',
    bankrupt: G.GAME.bankrupt ? 'ja' : '',
    fest: bot.stats.festivals,
    kontrakt: bot.stats.contracts,
    parker: bot.stats.parks,
    rivalForhold: Math.round(G.rivalRelation()),
    point: G.computeScore().total
  };
}

// Why the home island's houses don't reach the next tier: every condition upgradeHouses() checks, per level
function diagnoseUpgrade(G) {
  const home = G.homeIsland();
  const out = [];
  const houses = G.GAME.buildings.filter(b => G.DEFS[b.type].house && G.islandOfBuilding(b) === home);
  if (home.pop < home.popCap * 0.9) out.push(`boligerne er ikke fulde (${home.pop}/${home.popCap})`);
  if ((home.mood ?? 60) < 50) {
    const f = G.moodFactors(home, G.popByLevel(home)).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ');
    out.push(`tilfredshed ${Math.round(home.mood)} % (skal være 50): ${f}`);
  }
  const levels = [...new Set(houses.map(h => h.level || 1))].sort();
  for (const L of levels) {
    if (L >= G.MAX_LEVEL) continue;
    const at = houses.filter(h => (h.level || 1) === L);
    const cur = G.HOUSE_LEVELS[L], next = G.HOUSE_LEVELS[L + 1];
    const reasons = [];
    const needsNow = cur.needs.filter(n => !home.needsMet[n]);
    if (needsNow.length) reasons.push(`mangler nu: ${needsNow.join(', ')}`);
    const needsNext = next.needs.filter(n => !G.needAvailable(home, n));
    if (needsNext.length) reasons.push(`ikke til rådighed: ${needsNext.join(', ')}`);
    const svc = next.services.filter(s => !at.some(h => h.cov?.[s]));
    if (svc.length) reasons.push(`ingen bolig i rækkevidde af: ${svc.join(', ')}`);
    const both = at.filter(h => G.servicesMet(h, L) && G.servicesMet(h, L + 1)).length;
    if (!svc.length && !both) reasons.push('ingen bolig har alle offentlige bygninger på én gang');
    const cost = Object.entries(cur.upgrade || {}).filter(([r, n]) => (r === 'coins' ? G.GAME.coins : home.resources[r]) < n);
    if (cost.length) reasons.push(`materialer mangler: ${cost.map(([r, n]) => `${r} ${Math.floor(r === 'coins' ? G.GAME.coins : home.resources[r])}/${n}`).join(', ')}`);
    out.push(`${cur.name} (${at.length}) → ${next.name}: ${reasons.join('; ') || 'alt er opfyldt'}`);
  }
  return out;
}

module.exports = { simulate, createBot, step, diagnoseUpgrade };
