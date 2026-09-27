'use strict';

// ===== PIRATES =====
// A fort on a small island sends out a raider that hunts your loaded ships. Warships on a route escort it
// (and fight the raider), watchtowers shoot at it near the coast, and a warship can attack the fort itself.
const combatFx = []; // short-lived cannon shots for drawing: { a, b, at }

// Water tile next to the pirate island, nearest the fort (where the raider docks)
function fortDock(PF) {
  let best = null, bestD = Infinity;
  for (let y = PF.fort.y - 8; y <= PF.fort.y + 8; y++) {
    for (let x = PF.fort.x - 8; x <= PF.fort.x + 8; x++) {
      const t = tileAt(x, y);
      if (!t?.ocean) continue;
      const d = Math.hypot(x - PF.fort.x, y - PF.fort.y);
      if (d < bestD) { best = [x, y]; bestD = d; }
    }
  }
  return best;
}

// Sets up the fort: on the generated islet, or (old saves, maps without one) on the smallest far island
function initPirates(spot) {
  const start = [...GAME.islands.values()].find(i => i.start) || homeIsland();
  let isl = spot && GAME.islands.get(tileAt(spot.x, spot.y)?.island);
  if (!isl) {
    const sx = start?.anchor[0] ?? MAP_SIZE / 2, sy = start?.anchor[1] ?? MAP_SIZE / 2;
    isl = [...GAME.islands.values()]
      .filter(i => i !== start && !i.warehouses && i.owner !== 'rival' && i.size >= 6 && i.size <= 200)
      .sort((a, b) => (a.size - b.size) - (Math.hypot(b.anchor[0] - sx, b.anchor[1] - sy) - Math.hypot(a.anchor[0] - sx, a.anchor[1] - sy)) * 2)[0];
  }
  if (!isl) { GAME.pirates = null; return; }
  const tiles = GAME.grid.filter(t => t.island === isl.id);
  const cx = tiles.reduce((s, t) => s + t.x, 0) / tiles.length, cy = tiles.reduce((s, t) => s + t.y, 0) / tiles.length;
  const c = tiles.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))[0];
  isl.pirate = true;
  isl.name = 'Pirateøen';
  GAME.pirates = { fort: { x: c.x, y: c.y }, fortHp: FORT_HP, ship: null, nextRaid: Math.round(PIRATE_RAID_EVERY * 1.5 / diff().pirates) };
}

const pirateActive = () => !!GAME.pirates && GAME.pirates.fortHp > 0 && GAME.events;
const shipDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const activeTowers = () => GAME.buildings.filter(b => b.type === 'watchtower' && serviceActiveTower(b));
const serviceActiveTower = (b) => !b.paused && b.staffed !== false && !b.fire && !GAME.bankrupt;
const inTowerReach = (x, y) => activeTowers().some(t => Math.hypot(t.x - x, t.y - y) <= DEFS.watchtower.guard);

// A ship is safe from plunder next to a warship or inside a watchtower's reach
const isProtected = (s) => GAME.ships.some(w => isWarship(w) && w !== s && shipDist(w, s) <= WARSHIP_GUARD) || inTowerReach(s.x, s.y);

function shoot(a, b) {
  combatFx.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, at: animTime });
  if (combatFx.length > 40) combatFx.shift();
}

function sinkShip(s, why) {
  GAME.ships.splice(GAME.ships.indexOf(s), 1);
  if (GAME.selectedInfo?.kind === 'ship' && GAME.selectedInfo.id === s.id) closeInfo();
  notify(`💥 ${s.name} er sænket${why ? ` ${why}` : ''}!`);
  sfx('cannon');
}

function pirateTick() {
  const PF = GAME.pirates;
  if (!PF || PF.fortHp <= 0) return;

  // Warships attacking the fort trade fire with it
  const attackers = GAME.ships.filter(s => isWarship(s) && s.state === 'attacking' && !s.path.length && shipDist(s, PF.fort) <= 8);
  for (const w of attackers) {
    PF.fortHp -= WARSHIP_DAMAGE;
    w.hp -= FORT_DAMAGE;
    shoot(w, PF.fort);
    shoot(PF.fort, w);
    if (Math.random() < 0.3) sfx('cannon');
  }
  for (const w of attackers) if (w.hp <= 0) sinkShip(w, 'af piratfortets kanoner');
  if (PF.fortHp <= 0) {
    PF.fortHp = 0;
    PF.ship = null;
    GAME.coins += FORT_REWARD;
    const isl = GAME.islands.get(tileAt(PF.fort.x, PF.fort.y)?.island);
    if (isl) { isl.pirate = false; isl.name = 'Frihavnen'; }
    for (const w of GAME.ships.filter(s => s.state === 'attacking')) w.state = 'idle';
    notify(`🏆 Piratfortet er ødelagt! Havene er sikre (+${FORT_REWARD} 🪙). Øen kan nu bebygges.`);
    sfx('fanfare');
    minimapDirty = true;
    return;
  }

  if (!GAME.events) { PF.ship = null; return; }
  const R = PF.ship;
  if (!R) {
    const prey = GAME.ships.filter(s => !isWarship(s) && s.routeId);
    // A hostile rival pays the pirates, so they come twice as often
    PF.nextRaid -= GAME.rival && rivalRelation() < 25 ? 2 : 1;
    if (!prey.length || PF.nextRaid > 0) return;
    const dock = fortDock(PF);
    if (!dock) return;
    PF.ship = { pirate: true, type: 'kogge', name: 'Piratskibet', x: dock[0], y: dock[1], dir: [1, 0], path: [],
                hp: PIRATE_HP, state: 'hunting', target: null, retarget: 0, idle: 0 };
    notify('🏴‍☠️ Et piratskib har forladt fortet og jager dine skibe!');
    sfx('alarm');
    return;
  }

  // Warships near the raider and watchtowers in reach shoot at it; it fires back at warships
  for (const w of GAME.ships.filter(s => isWarship(s) && shipDist(s, R) <= WARSHIP_GUARD + 1)) {
    R.hp -= WARSHIP_DAMAGE;
    w.hp -= 3;
    shoot(w, R);
    shoot(R, w);
    if (Math.random() < 0.4) sfx('cannon');
    if (w.hp <= 0) sinkShip(w, 'af piraterne');
  }
  for (const t of activeTowers()) {
    if (Math.hypot(t.x - R.x, t.y - R.y) <= DEFS.watchtower.guard) {
      R.hp -= TOWER_DAMAGE;
      shoot({ x: t.x, y: t.y }, R);
    }
  }
  if (R.hp <= 0) {
    PF.ship = null;
    PF.nextRaid = Math.round(PIRATE_RAID_EVERY * 1.5 / diff().pirates);
    GAME.coins += 200;
    notify('⚔ Piratskibet er sænket! (+200 🪙)');
    sfx('cannon');
    return;
  }
  if (R.state === 'hunting' && R.hp < PIRATE_HP * 0.4) {
    R.state = 'returning';
    notify('🏴‍☠️ Piratskibet flygter tilbage til fortet', false);
  }

  if (R.state === 'hunting') {
    let target = GAME.ships.find(s => s.id === R.target);
    if (!target || cargoTotal(target) < 1 || --R.retarget <= 0) {
      // Nearest loaded, unprotected cargo ship
      const cands = GAME.ships.filter(s => !isWarship(s) && cargoTotal(s) >= 1 && !isProtected(s));
      target = cands.sort((a, b) => shipDist(a, R) - shipDist(b, R))[0] || null;
      R.target = target?.id || null;
      R.retarget = 3;
      if (target) {
        const res = waterPath([[Math.round(R.x), Math.round(R.y)]], [[Math.round(target.x), Math.round(target.y)]]);
        R.path = res ? res.path : [];
      }
    }
    if (!target) {
      if (++R.idle > 40) R.state = 'returning';
      return;
    }
    R.idle = 0;
    if (shipDist(target, R) <= 1.5) {
      if (isProtected(target)) { R.target = null; return; }
      let lost = 0;
      for (const k of RES_KEYS) {
        const t = Math.floor(target.cargo[k] * PLUNDER_SHARE);
        target.cargo[k] -= t;
        lost += t;
      }
      notify(`🏴‍☠️ Pirater plyndrede ${target.name} for ${lost} varer! Sæt en fregat på ruten eller byg vagttårne.`);
      sfx('alarm');
      R.state = 'returning';
      R.path = [];
    }
  }
  if (R.state === 'returning' && !R.path.length) {
    const dock = fortDock(PF);
    if (dock && Math.hypot(R.x - dock[0], R.y - dock[1]) < 1.5) {
      PF.ship = null;
      PF.nextRaid = Math.round(PIRATE_RAID_EVERY / diff().pirates);
      return;
    }
    const res = dock && waterPath([[Math.round(R.x), Math.round(R.y)]], [dock]);
    R.path = res ? res.path : [];
    if (!res) PF.ship = null;
  }
}

function updatePirates(dt) {
  const R = GAME.pirates?.ship;
  if (!R) return;
  let move = PIRATE_SPEED * dt / 1000 * (GAME.storm > 0 ? 0.5 : 1);
  while (move > 0 && R.path.length) {
    const [tx, ty] = R.path[0], dx = tx - R.x, dy = ty - R.y, d = Math.hypot(dx, dy);
    if (d > 0.001) R.dir = [dx / d, dy / d];
    if (d <= move) { R.x = tx; R.y = ty; R.path.shift(); move -= d; }
    else { R.x += dx / d * move; R.y += dy / d * move; move = 0; }
  }
}

// Warships repair slowly while lying still near one of your warehouses
function repairShips() {
  const ports = portWarehouses();
  for (const s of GAME.ships) {
    const max = SHIP_TYPES[s.type].hp;
    if (!max || s.hp >= max || s.path.length) continue;
    if (ports.some(b => Math.hypot(b.x + 0.5 - s.x, b.y + 0.5 - s.y) <= 4)) s.hp = Math.min(max, s.hp + REPAIR_RATE);
  }
}

function attackFort(ship) {
  const PF = GAME.pirates;
  if (!PF || PF.fortHp <= 0) return 'Der er intet piratfort';
  const dock = fortDock(PF);
  const res = dock && waterPath([[Math.round(ship.x), Math.round(ship.y)]], [dock]);
  if (!res) return `${ship.name} kan ikke sejle hen til fortet`;
  ship.routeId = null;
  ship.timer = 0;
  ship.path = res.path;
  ship.state = 'attacking';
  notify(`⚔ ${ship.name} sejler ud for at angribe piratfortet`);
  return null;
}

// Cannon shots: a bright line and a puff at the target, fading out
function drawCombat() {
  for (let i = combatFx.length - 1; i >= 0; i--) {
    const f = combatFx[i], age = (animTime - f.at) / 700;
    if (age > 1 || age < 0) { combatFx.splice(i, 1); continue; }
    const a = P(f.a.x, f.a.y, 10), b = P(f.b.x, f.b.y, 10);
    const m = lerp(a, b, Math.min(1, age * 3));
    line(a, m, `rgba(255,230,160,${(0.8 * (1 - age)).toFixed(2)})`, 1.5);
    dot(b, 4 + age * 10, `rgba(90,85,80,${(0.5 * (1 - age)).toFixed(2)})`);
    if (age < 0.25) dot(a, 3, 'rgba(255,200,80,0.9)');
  }
}

// Wooden palisade fort with a watchtower, cannons and the black flag
function drawPirateFort(PF) {
  const U = PF.fort.x - 1, V = PF.fort.y - 1;
  const rnd = seeded(PF.fort.x * 31 + PF.fort.y * 17);
  ground(U + 0.1, V + 0.1, 2.3, 2.3, '#8a7a55', rnd);
  // Palisade
  const stakes = (u0, v0, u1, v1) => {
    const n = Math.round(Math.hypot(u1 - u0, v1 - v0) / 0.12);
    for (let i = 0; i <= n; i++) {
      const u = u0 + (u1 - u0) * i / n, v = v0 + (v1 - v0) * i / n;
      const b = P(u, v, 0), t = P(u, v, 13);
      line(b, t, '#5a3a1e', 3);
      poly('#7a5230', [{ x: t.x - 1.5, y: t.y }, { x: t.x + 1.5, y: t.y }, { x: t.x, y: t.y - 3 }], null);
    }
  };
  stakes(U + 0.2, V + 0.2, U + 2.3, V + 0.2);
  stakes(U + 0.2, V + 0.2, U + 0.2, V + 2.3);
  // Hut and tower
  const w = walls(U + 0.6, V + 0.6, U + 1.4, V + 1.3, 0, 12, '#6a4a2a');
  boards(w.L, 0.08); boards(w.R, 0.08);
  roofV(U + 0.6, V + 0.6, U + 1.4, V + 1.3, 12, 10, '#4a3a2a', '#6a4a2a', { style: 'thatch' });
  const t = walls(U + 1.55, V + 1.55, U + 1.95, V + 1.95, 0, 30, '#5a3a1e', '#7a5230');
  boards(t.L, 0.08); boards(t.R, 0.08);
  flag(U + 1.75, V + 1.75, 30, 18, '#111');
  const fl = P(U + 1.75, V + 1.75, 48);
  dot({ x: fl.x + 7, y: fl.y + 5.5 }, 2.2, '#e8e0d0');
  stakes(U + 2.3, V + 0.2, U + 2.3, V + 2.3);
  stakes(U + 0.2, V + 2.3, U + 2.3, V + 2.3);
  // Cannons at the front
  for (const [u, v] of [[U + 2.45, V + 1.0], [U + 1.0, V + 2.45]]) {
    cylinder(u, v, 2, 0.07, 4, '#2a2622', '#3a3632');
  }
  // Fort health
  const c = P(PF.fort.x, PF.fort.y, 70);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(c.x - 22, c.y, 44, 5);
  ctx.fillStyle = '#e04a3a';
  ctx.fillRect(c.x - 22, c.y, 44 * PF.fortHp / FORT_HP, 5);
}

// ===== RIVAL TRADING HOUSE =====
// Settles free islands over time (claiming them before you can), and trades: it buys the goods it lacks
// and sells its own island's produce. Its colonies can be bought out at a high price.
function rivalGoods(isl) {
  const out = new Set(['fish']);
  const byFert = { grain: ['grain', 'pork'], sheep: ['wool', 'cloth'], hops: ['hops', 'beer'], grapes: ['wine'] };
  for (const f of isl.fertility) for (const k of byFert[f] || []) out.add(k);
  if (isl.ore) out.add('tools');
  if (isl.gold) out.add('jewelry');
  return [...out];
}
const rivalIslands = () => [...GAME.islands.values()].filter(i => i.owner === 'rival');
// Friends (relation 75+) get 10% better prices both ways
const rivalFriendly = () => rivalRelation() >= 75;
const rivalSellPrice = (k) => Math.ceil(PRICES[k] * BUY_MARKUP * 0.9 * (rivalFriendly() ? 0.9 : 1));
const rivalBuyPrice = (k) => Math.round(PRICES[k] * 1.15 * (rivalFriendly() ? 1.1 : 1));
const rivalTrades = () => rivalRelation() >= 25;

// Top-left tile of a free w×h spot on the island, satisfying `ok(x, y)`, nearest (cx, cy)
function findSpot(isl, w, h, cx, cy, ok = () => true, maxD = 99) {
  const tiles = GAME.grid.filter(t => t.island === isl.id && Math.hypot(t.x - cx, t.y - cy) <= maxD)
    .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  for (const t of tiles) {
    let free = true;
    for (let dy = 0; dy < h && free; dy++) {
      for (let dx = 0; dx < w && free; dx++) {
        const q = tileAt(t.x + dx, t.y + dy);
        free = !!q && isLandType(q.type) && q.island === isl.id && !GAME.occupancy.has(`${q.x},${q.y}`);
      }
    }
    if (free && ok(t.x, t.y)) return [t.x, t.y];
  }
  return null;
}

function addRivalBuilding(type, x, y) {
  const R = GAME.rival, def = DEFS[type];
  const b = { id: `rv_${++R.counter}`, type, x, y, level: def.house ? 1 + Math.floor(Math.random() * 2) : undefined };
  R.buildings.push(b);
  for (let dy = 0; dy < def.h; dy++) for (let dx = 0; dx < def.w; dx++) GAME.occupancy.set(`${x + dx},${y + dy}`, b.id);
  return b;
}

// What the rival builds next on an island: mostly houses, plus farms that match the fertility
function rivalNextType(isl) {
  const own = GAME.rival.buildings.filter(b => islandOfBuilding(b) === isl);
  const has = (t) => own.some(b => b.type === t);
  const wants = ['fisher'];
  if (isl.fertility.includes('grain')) wants.push('grainfarm');
  if (isl.fertility.includes('sheep')) wants.push('sheepfarm');
  if (isl.fertility.includes('hops')) wants.push('hopfarm');
  if (isl.fertility.includes('grapes')) wants.push('vineyard');
  const missing = wants.find(t => !has(t));
  if (missing && Math.random() < 0.6) return missing;
  return Math.random() < 0.3 ? 'marketplace' : 'house';
}

function rivalGrow(isl, n = 1) {
  const wh = GAME.rival.buildings.find(b => b.type === 'warehouse' && islandOfBuilding(b) === isl);
  if (!wh) return;
  for (let i = 0; i < n; i++) {
    const type = rivalNextType(isl), def = DEFS[type];
    const spot = findSpot(isl, def.w, def.h, wh.x, wh.y, (x, y) =>
      !def.coastal || footprintNeighbors({ type, x, y }).some(([ax, ay]) => isWater(ax, ay)), 10);
    if (spot) addRivalBuilding(type, spot[0], spot[1]);
  }
}

// Founds a rival colony on the island. Returns false if there's no room for a harbour.
function rivalSettle(isl, size = 4) {
  const tiles = GAME.grid.filter(t => t.island === isl.id);
  const cx = tiles.reduce((s, t) => s + t.x, 0) / tiles.length, cy = tiles.reduce((s, t) => s + t.y, 0) / tiles.length;
  const spot = findSpot(isl, 2, 2, cx, cy, (x, y) => footprintNeighbors({ type: 'warehouse', x, y }).some(([ax, ay]) => tileAt(ax, ay)?.ocean));
  if (!spot) return false;
  addRivalBuilding('warehouse', spot[0], spot[1]);
  isl.owner = 'rival';
  isl.resources = emptyStock();
  for (const k of rivalGoods(isl)) isl.resources[k] = 20;
  rivalGrow(isl, size);
  minimapDirty = true;
  return true;
}

// The rival's home: a big island far from yours
function initRival() {
  GAME.rival = { buildings: [], counter: 0, next: diff().rivalEvery, growIn: 60, ship: null, relation: RIVAL_RELATION_START, plan: null };
  const start = [...GAME.islands.values()].find(i => i.start) || homeIsland();
  const sx = start.anchor[0], sy = start.anchor[1];
  const cands = [...GAME.islands.values()].filter(i => i !== start && !i.pirate && !i.warehouses && i.size >= 40)
    .sort((a, b) => Math.hypot(b.anchor[0] - sx, b.anchor[1] - sy) - Math.hypot(a.anchor[0] - sx, a.anchor[1] - sy));
  for (const isl of cands) {
    if (rivalSettle(isl, 7)) { isl.name = 'Rødhavn'; break; }
  }
}

function rivalTick() {
  const R = GAME.rival;
  if (!R) return;
  const mine = rivalIslands();
  // Production and slow consumption of goods bought from you
  for (const isl of mine) {
    const goods = rivalGoods(isl);
    for (const k of RES_KEYS) {
      if (goods.includes(k)) isl.resources[k] = Math.min(RIVAL_STOCK_MAX, isl.resources[k] + RIVAL_PRODUCE);
      else isl.resources[k] = Math.max(0, isl.resources[k] - 0.15);
    }
  }
  if (--R.growIn <= 0 && mine.length) {
    R.growIn = 60;
    const isl = mine[Math.floor(Math.random() * mine.length)];
    if (R.buildings.filter(b => islandOfBuilding(b) === isl).length < 14) rivalGrow(isl, 1);
  }
  if (R.plan && GAME.tick >= R.plan.at) carryOutPlan(R);
  if (GAME.settings.rival && --R.next <= 0) {
    R.next = diff().rivalEvery;
    if (mine.length < diff().rivalMax) rivalExpand(mine);
  }
  rivalShipTick();
}

// Claims the free island nearest to the rival's existing colonies
// (never one of the two islands nearest your start island, which the early quests rely on)
function rivalExpand(mine) {
  const start = [...GAME.islands.values()].find(i => i.start) || homeIsland();
  const fromStart = (i) => Math.hypot(i.anchor[0] - start.anchor[0], i.anchor[1] - start.anchor[1]);
  const reserved = new Set([...GAME.islands.values()].filter(i => !i.start && !i.pirate && i.size >= 12)
    .sort((a, b) => fromStart(a) - fromStart(b)).slice(0, 2));
  const free = [...GAME.islands.values()].filter(i => !i.owner && !i.pirate && !i.start && !i.home && !i.warehouses && i.size >= 20 && !reserved.has(i));
  if (!free.length) return;
  const d = (i) => mine.length ? Math.min(...mine.map(m => Math.hypot(m.anchor[0] - i.anchor[0], m.anchor[1] - i.anchor[1]))) : -fromStart(i);
  free.sort((a, b) => d(a) - d(b));
  for (const isl of free.slice(0, 3)) {
    // Islands you know about are announced first, so you can get there before them
    if (isl.discovered && !GAME.rival.plan) {
      GAME.rival.plan = { island: isl.anchor, at: GAME.tick + RIVAL_PLAN_TICKS };
      notify(`⚑ ${RIVAL_NAME} sender et skib til ${isl.name} og grundlægger en koloni om ${RIVAL_PLAN_TICKS} sekunder – kom før dem!`);
      sfx('alarm');
      return;
    }
    if (isl.discovered) continue;
    if (!rivalSettle(isl)) continue;
    notify(`⚑ ${RIVAL_NAME} har grundlagt en ny koloni et sted på kortet`);
    return;
  }
}

// The announced colony: founded unless you got there first
const planIsland = (plan) => plan && GAME.islands.get(tileAt(plan.island[0], plan.island[1])?.island);
function carryOutPlan(R) {
  const isl = planIsland(R.plan);
  R.plan = null;
  if (!isl) return;
  if (isl.warehouses || isl.owner) {
    notify(`⚑ Du kom før ${RIVAL_NAME} til ${isl.name}!`);
    changeRelation(-5);
    return;
  }
  if (rivalSettle(isl)) {
    notify(`⚑ ${RIVAL_NAME} har grundlagt en koloni på ${isl.name}`);
    sfx('alarm');
  }
}

// Cosmetic merchant ship sailing between the rival's harbours
function rivalShipTick() {
  const R = GAME.rival;
  const ports = R.buildings.filter(b => b.type === 'warehouse' && dockTiles(b).length);
  if (!ports.length) { R.ship = null; return; }
  if (!R.ship) {
    const d = dockTiles(ports[0])[0];
    R.ship = { rival: true, type: 'kogge', name: RIVAL_NAME, x: d[0], y: d[1], dir: [1, 0], path: [], wait: 5, at: ports[0].id };
  }
  const S = R.ship;
  if (S.path.length) return;
  if (--S.wait > 0) return;
  const others = ports.filter(p => p.id !== S.at);
  const target = others.length ? others[Math.floor(Math.random() * others.length)] : null;
  let res = null;
  if (target) {
    res = waterPath([[Math.round(S.x), Math.round(S.y)]], dockTiles(target));
    S.at = target.id;
  } else {
    // Only one harbour: sail out to sea and back
    const e = edgeTileNear(S.x, S.y);
    const home = dockTiles(ports[0]);
    const out = Math.hypot(S.x - home[0][0], S.y - home[0][1]) < 2;
    res = out && e ? waterPath([[Math.round(S.x), Math.round(S.y)]], [[e.x, e.y]]) : waterPath([[Math.round(S.x), Math.round(S.y)]], home);
  }
  S.path = res ? res.path : [];
  S.wait = 6;
}

function updateRivalShip(dt) {
  const S = GAME.rival?.ship;
  if (!S) return;
  let move = 2.1 * dt / 1000 * (GAME.storm > 0 ? 0.5 : 1);
  while (move > 0 && S.path.length) {
    const [tx, ty] = S.path[0], dx = tx - S.x, dy = ty - S.y, d = Math.hypot(dx, dy);
    if (d > 0.001) S.dir = [dx / d, dy / d];
    if (d <= move) { S.x = tx; S.y = ty; S.path.shift(); move -= d; }
    else { S.x += dx / d * move; S.y += dy / d * move; move = 0; }
  }
}

// Your ship arrives at a rival harbour: the rival buys what it doesn't make itself
function sellToRival(ship, isl) {
  if (!rivalTrades()) { warnOnce('rival-embargo', `⚑ ${RIVAL_NAME} vil ikke handle med ${ship.name} – forbedr forholdet med en gave`, 120); return; }
  const own = rivalGoods(isl);
  let income = 0;
  for (const k of RES_KEYS) {
    if (own.includes(k) || ship.cargo[k] < 1) continue;
    const q = Math.floor(Math.min(ship.cargo[k], Math.max(0, RIVAL_BUY_MAX - isl.resources[k])));
    if (q <= 0) continue;
    ship.cargo[k] -= q;
    isl.resources[k] += q;
    income += q * rivalBuyPrice(k);
  }
  if (income) {
    GAME.coins += income;
    changeRelation(1);
    notify(`⚑ ${RIVAL_NAME} købte varer af ${ship.name} for ${income} 🪙`, false);
  }
}

// ... and you buy the chosen return goods from its stock
function buyFromRival(ship, isl, goods) {
  if (!rivalTrades()) return;
  let free = SHIP_TYPES[ship.type].cargo - cargoTotal(ship), spent = 0;
  const wanted = goods.filter(k => rivalGoods(isl).includes(k) && isl.resources[k] >= 1);
  for (const k of wanted) {
    const share = Math.floor(free / wanted.length);
    const q = Math.floor(Math.min(share, isl.resources[k], Math.max(0, GAME.coins - spent) / rivalSellPrice(k)));
    if (q <= 0) continue;
    isl.resources[k] -= q;
    ship.cargo[k] += q;
    spent += q * rivalSellPrice(k);
  }
  if (spent) {
    GAME.coins -= spent;
    notify(`⚑ ${ship.name} købte varer hos ${RIVAL_NAME} for ${spent} 🪙`, false);
  }
}

const buyoutPrice = (isl) => RIVAL_BUYOUT_BASE + 300 * GAME.rival.buildings.filter(b => islandOfBuilding(b) === isl).length;

// Buying a rival colony: its buildings go, its harbour becomes your warehouse with its stock
function buyRivalIsland(isl) {
  const price = buyoutPrice(isl);
  if (GAME.coins < price) return `Kræver ${price} 🪙`;
  GAME.coins -= price;
  const R = GAME.rival;
  const stock = isl.resources;
  let keep = null;
  for (const b of R.buildings.filter(b => islandOfBuilding(b) === isl)) {
    const def = DEFS[b.type];
    R.buildings.splice(R.buildings.indexOf(b), 1);
    for (let dy = 0; dy < def.h; dy++) for (let dx = 0; dx < def.w; dx++) GAME.occupancy.delete(`${b.x + dx},${b.y + dy}`);
    if (b.type === 'warehouse' && !keep) keep = b;
  }
  isl.owner = null;
  isl.resources = emptyStock();
  if (keep) {
    // Same id, so trade routes to this harbour keep working
    const wh = { id: keep.id, type: 'warehouse', x: keep.x, y: keep.y };
    GAME.buildings.push(wh);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) GAME.occupancy.set(`${wh.x + dx},${wh.y + dy}`, wh.id);
    updateIslandStats();
    for (const k of RES_KEYS) isl.resources[k] = Math.min(isl.cap, Math.floor(stock[k] || 0));
    isl.supplied = true;
    isl.discovered = true;
    revealAroundBuilding(wh, true);
  }
  if (R.ship && R.ship.at === keep?.id) R.ship.at = null;
  updateIslandStats();
  recomputeConnectivity();
  minimapDirty = true;
  notify(`🤝 Du har købt ${isl.name} af ${RIVAL_NAME}!`);
  changeRelation(-30);
  sfx('coins');
  saveGame();
  return null;
}

// Rival buildings look like yours, with a red pennant on top
function drawRivalBuilding(b) {
  drawBuilding(b);
  const def = DEFS[b.type];
  const h = b.type === 'warehouse' ? 52 : def.house ? 38 : 30;
  flag(b.x - 0.5 + def.w * 0.3, b.y - 0.5 + def.h * 0.3, h, 12, RIVAL_COLOR);
}
