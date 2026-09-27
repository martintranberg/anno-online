'use strict';
// Decorations, festivals, contracts, rival relations, houses needing roads, undo, ship loading reports,
// life on the roads, the score, and the panels for all of them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./harness');
const { newGame, placeFirstWarehouse, revealAll, build, runTicks } = require('./helpers');

function setup(seed = 61, settings = {}) {
  const { game, G } = newGame({ events: false, ...settings }, seed);
  const wh = placeFirstWarehouse(G);
  const home = G.homeIsland();
  G.GAME.coins = 100000;
  Object.assign(home.resources, { planks: 150, stone: 150, bricks: 150, tools: 150, fish: 150 });
  G.GAME.tierReached = 3;
  return { game, G, wh, home };
}
const factor = (G, isl, name) => G.moodFactors(isl, G.popByLevel(isl)).find(([k]) => k === name)?.[1];

test('houses need a road; houses from older saves are exempt', () => {
  const { G, wh, home } = setup();
  const h = build(G, 'house', wh.x, wh.y, { maxDist: 6 });
  assert.ok(G.houseLinked(h));
  G.updateIslandStats();
  const full = G.houseCap(h, home);
  // Cut every road around it
  for (const [x, y] of G.footprintNeighbors(h)) if (G.GAME.roads.has(`${x},${y}`)) G.demolishAt(x, y);
  G.recomputeConnectivity();
  if (!G.GAME.connected.has(h.id)) {
    assert.equal(G.houseCap(h, home), G.UNSERVED_CAP, 'no road: only a couple of settlers');
    h.roadExempt = true;
    assert.equal(G.houseCap(h, home), full, 'exempt houses keep working');
  }
});

test('decorations make nearby residents happier (the best one counts)', () => {
  const { G, wh, home } = setup();
  for (let i = 0; i < 3; i++) build(G, 'house', wh.x, wh.y, { maxDist: 6 });
  home.pop = 18;
  G.updateIslandStats();
  assert.equal(factor(G, home, 'Pynt og parker'), undefined);
  assert.ok(build(G, 'park', wh.x, wh.y, { maxDist: 8 }), 'park placed');
  G.updateIslandStats();
  const withPark = factor(G, home, 'Pynt og parker');
  assert.ok(withPark > 0 && withPark <= G.DEFS.park.beauty.bonus);
  assert.ok(build(G, 'statue', wh.x, wh.y, { maxDist: 10 }), 'statue placed');
  G.updateIslandStats();
  assert.ok(factor(G, home, 'Pynt og parker') > withPark, 'a statue beats a park');
});

test('a festival costs coins, lifts the mood for a while and then needs a pause', () => {
  const { G, home } = setup();
  home.pop = 30;
  const coins = G.GAME.coins, cost = G.festivalCost(home).coins;
  assert.equal(G.holdFestival(home), null);
  assert.equal(G.GAME.coins, coins - cost);
  assert.equal(factor(G, home, 'Fest'), G.FESTIVAL_MOOD);
  assert.match(G.holdFestival(home), /allerede/);
  for (let i = 0; i < G.FESTIVAL_TICKS; i++) G.festivalTick();
  assert.equal(factor(G, home, 'Fest'), undefined, 'over');
  assert.match(G.holdFestival(home), /Næste fest/);
});

test('contracts are offered, accepted, delivered for a good price or expire', () => {
  const { G, home } = setup();
  G.GAME.nextContract = 1;
  G.contractsTick();
  assert.equal(G.GAME.contracts.length, 1, 'an offer arrives');
  const c = G.GAME.contracts[0];
  assert.ok(c.reward > c.amount * G.PRICES[c.good], 'pays more than the trader');
  assert.equal(G.acceptContract(c), null);
  home.resources[c.good] = 0;
  assert.match(G.deliverContract(c), /Ingen/);
  home.resources[c.good] = c.amount + 5;
  const coins = G.GAME.coins;
  assert.equal(G.deliverContract(c), null);
  assert.equal(G.GAME.coins, coins + c.reward);
  assert.equal(home.resources[c.good], 5);
  assert.equal(G.GAME.contractsDone, 1);
  // An accepted contract from the rival that runs out hurts relations
  G.offerContract();
  const d = G.GAME.contracts[0];
  d.from = 'rival';
  G.acceptContract(d);
  const rel = G.rivalRelation();
  G.GAME.tick = d.deadline + 1;
  G.contractsTick();
  assert.ok(!G.GAME.contracts.includes(d), 'expired');
  assert.ok(G.rivalRelation() < rel, 'rival disappointed');
  // Offers that aren't accepted disappear
  G.offerContract();
  G.GAME.tick += G.CONTRACT_OFFER_TIME + 1;
  G.contractsTick();
  assert.equal(G.GAME.contracts.filter(x => !x.accepted).length, 0);
});

test('rival relations: gifts help, buy-outs hurt, hostile rivals refuse trade and hire pirates', () => {
  const { G, wh } = setup();
  assert.equal(G.rivalRelation(), G.RIVAL_RELATION_START);
  const coins = G.GAME.coins;
  assert.equal(G.sendGift(), null);
  assert.equal(G.GAME.coins, coins - G.RIVAL_GIFT);
  assert.equal(G.rivalRelation(), G.RIVAL_RELATION_START + G.RIVAL_GIFT_RELATION);
  // Friends get better prices
  const k = 'fish';
  const normal = G.rivalSellPrice(k);
  G.GAME.rival.relation = 80;
  assert.ok(G.rivalSellPrice(k) < normal);
  // Hostile: no trade
  G.GAME.rival.relation = 10;
  const rwh = G.GAME.rival.buildings.find(b => b.type === 'warehouse');
  const risl = G.islandOfBuilding(rwh);
  const ship = G.spawnShip('karavel', wh);
  const foreign = G.RES_KEYS.find(r => !G.rivalGoods(risl).includes(r));
  ship.cargo[foreign] = 20;
  G.sellToRival(ship, risl);
  assert.equal(ship.cargo[foreign], 20, 'refused');
  // ... and pirates come twice as fast
  ship.routeId = 'x';
  G.GAME.events = true;
  G.GAME.pirates.nextRaid = 10;
  G.pirateTick();
  assert.equal(G.GAME.pirates.nextRaid, 8);
  // Buying them out hurts
  G.GAME.rival.relation = 60;
  G.buyRivalIsland(risl);
  assert.equal(G.rivalRelation(), 30);
  // Drift back towards neutral
  G.GAME.tick = 30;
  G.relationTick();
  assert.equal(G.rivalRelation(), 31);
});

test('the rival announces colonies on known islands and you can get there first', () => {
  const { G, wh } = setup();
  revealAll(G);
  G.rivalExpand(G.rivalIslands());
  const plan = G.GAME.rival.plan;
  assert.ok(plan, 'plan announced');
  const target = G.planIsland(plan);
  // Found a colony there before the time is up
  G.spawnShip('jolle', wh);
  const spot = G.GAME.grid.find(t => t.island === target.id && G.checkPlacement(t.x, t.y, 'warehouse').ok);
  assert.ok(spot, 'room for a harbour');
  G.placeBuilding(spot.x, spot.y, 'warehouse');
  plan.at = G.GAME.tick;
  G.rivalTick();
  assert.equal(G.GAME.rival.plan, null);
  assert.notEqual(target.owner, 'rival', 'you were first');
});

test('demolishing can be undone, including the refund', () => {
  const { G, wh, home } = setup();
  const b = build(G, 'sawmill', wh.x, wh.y, { maxDist: 30 });
  const coins = G.GAME.coins, planks = home.resources.planks;
  G.demolishAt(b.x, b.y);
  assert.ok(!G.GAME.buildings.includes(b));
  assert.ok(G.GAME.coins > coins);
  assert.ok(G.undoDemolition());
  assert.ok(G.GAME.buildings.includes(b), 'back again');
  assert.equal(G.GAME.coins, coins, 'refund taken back');
  assert.equal(home.resources.planks, planks);
  assert.equal(G.GAME.occupancy.get(`${b.x},${b.y}`), b.id);
  assert.ok(!G.undoDemolition(), 'only once');
  // Roads too
  const road = [...G.GAME.roads][0].split(',').map(Number);
  G.demolishAt(road[0], road[1]);
  assert.ok(!G.GAME.roads.has(`${road[0]},${road[1]}`));
  G.undoDemolition();
  assert.ok(G.GAME.roads.has(`${road[0]},${road[1]}`));
});

test('ships report what they loaded and why they sailed empty', () => {
  const { G, wh, home } = setup();
  G.spawnShip('jolle', wh);
  revealAll(G);
  const isl = [...G.GAME.islands.values()].find(i => !i.home && !i.pirate && i.owner !== 'rival' && i.size >= 40 &&
    G.GAME.grid.some(t => t.island === i.id && G.checkPlacement(t.x, t.y, 'warehouse').ok));
  const spot = G.GAME.grid.find(t => t.island === isl.id && G.checkPlacement(t.x, t.y, 'warehouse').ok);
  G.placeBuilding(spot.x, spot.y, 'warehouse');
  const colony = G.GAME.buildings[G.GAME.buildings.length - 1];
  const ship = G.spawnShip('karavel', wh);
  const r = G.createRoute(wh.id, colony.id, []);
  r.res = ['stone'];
  r.keepRes = { stone: 200 };
  home.resources.stone = 100;
  G.assignShip(ship, r.id);
  for (let i = 0; i < 20 && !r.lastLoad; i++) G.updateShips(1000);
  assert.ok(r.lastLoad?.out, 'loading recorded');
  assert.match(r.lastLoad.out.note, /minimumslageret/);
  assert.ok(G.GAME.messages.some(m => /sejlede tom/.test(m.msg)));
});

test('carts and walkers move along the roads', () => {
  const { G, wh, home } = setup();
  for (let i = 0; i < 3; i++) build(G, 'house', wh.x, wh.y, { maxDist: 6 });
  build(G, 'woodcutter', wh.x, wh.y, { maxDist: 30, ok: (x, y) => G.harvestLeft({ type: 'woodcutter', x, y }) > 50 });
  home.pop = 18;
  G.centerOn(wh.x, wh.y);
  G.GAME.camera.zoom = 1;
  runTicks(G, 3);
  for (let i = 0; i < 40 && !G.life.walkers.length; i++) { G.lifeTick(); G.updateLife(100); }
  assert.ok(G.life.walkers.length > 0, 'someone is on the road');
  const w = G.life.walkers[0];
  const pos = [w.x, w.y];
  G.updateLife(500);
  assert.ok(!G.life.walkers.includes(w) || w.x !== pos[0] || w.y !== pos[1], 'they move');
  for (const x of G.life.walkers) G.drawWalker(x);
  for (let i = 0; i < 200; i++) G.updateLife(500);
  assert.equal(G.life.walkers.length, 0, 'they arrive and disappear');
});

test('score and records', () => {
  const { game, G } = setup();
  const s = G.computeScore();
  assert.ok(s.total > 0);
  assert.equal(s.total, Object.values(s.parts).reduce((a, b) => a + b, 0));
  G.recordHighscore();
  const hs = JSON.parse(game.store.get('anno-online-highscores'));
  assert.equal(hs['small-normal'].score, s.total);
});

test('new panels render and their buttons work', () => {
  const { game, G, home } = setup();
  const body = game.el('info-body');
  G.offerContract();
  G.openInfo('contracts');
  assert.match(body.innerHTML, /Tilbud/);
  body.querySelectorAll('[data-accept]')[0].click();
  assert.ok(G.GAME.contracts[0].accepted, 'accepted by clicking');
  G.openInfo('good', 'planks');
  assert.match(body.innerHTML, /Laves af/);
  G.openInfo('score');
  assert.match(body.innerHTML, /I alt/);
  const wh = G.GAME.buildings.find(b => b.type === 'warehouse');
  G.openInfo('building', wh.id);
  home.pop = 10;
  G.renderInfo();
  body.querySelectorAll('[data-act="festival"]')[0].click();
  assert.ok(home.festival > 0, 'festival from the warehouse panel');
  body.querySelectorAll('[data-good="fish"]')[0].click();
  assert.equal(G.GAME.selectedInfo.kind, 'good');
  const rwh = G.GAME.rival.buildings.find(b => b.type === 'warehouse');
  G.openInfo('rival', rwh.id);
  assert.match(body.innerHTML, /Forhold/);
  body.querySelectorAll('[data-act="gift"]')[0].click();
  assert.ok(G.rivalRelation() > G.RIVAL_RELATION_START);
  G.renderQuest();
});

test('version 4 saves load: houses exempt from roads, no contracts yet', () => {
  const { game, G } = setup();
  build(G, 'house', G.GAME.buildings[0].x, G.GAME.buildings[0].y, { maxDist: 6 });
  G.saveGame();
  const data = JSON.parse(game.store.get('anno-online-save'));
  data.v = 4;
  for (const k of ['contracts', 'contractCounter', 'nextContract', 'contractsDone']) delete data[k];
  delete data.rival.relation;
  const L = createGame({ seed: 3, storage: { 'anno-online-save': JSON.stringify(data) } }).boot().api;
  assert.equal(L.GAME.phase, 'play');
  assert.ok(L.GAME.buildings.filter(b => b.type === 'house').every(b => b.roadExempt));
  assert.equal(L.GAME.contracts.length, 0);
  assert.equal(L.rivalRelation(), L.RIVAL_RELATION_START);
});

test('messages are ranked: alerts first and kept longest, minor news without a pop-up', () => {
  const { game, G } = setup();
  assert.equal(G.messageLevel('🍽️ Beboerne på X sulter!', true), 'alert');
  assert.equal(G.messageLevel('🔥 Brand i bolig', true), 'alert');
  assert.equal(G.messageLevel('⛵ Jolle 1 er søsat!', true), 'info');
  assert.equal(G.messageLevel('🛒 Handelsmanden solgte', false), 'minor');
  G.GAME.messages.length = 0;
  G.notify('🛒 lille nyhed', false);
  for (let i = 0; i < 6; i++) G.notify(`⛵ nyhed ${i}`);
  G.notify('🔥 Brand!');
  G.renderMessages();
  const html = game.el('messages').innerHTML;
  assert.ok(html.indexOf('🔥 Brand!') < html.indexOf('nyhed 5'), 'alert shown first');
  assert.equal((html.match(/msg-info/g) || []).length, G.MESSAGE_LEVELS.info.max, 'news capped');
  assert.ok(G.GAME.messageLog.length >= 8, 'everything kept in the log');
});

test('the status bar lists what needs attention and each warning leads to it', () => {
  const { game, G, wh, home } = setup();
  const mill = build(G, 'sawmill', wh.x, wh.y, { maxDist: 30 });
  for (let i = 0; i < 3; i++) build(G, 'house', wh.x, wh.y, { maxDist: 6 });
  home.pop = 18;
  home.resources.wood = 0;
  G.tick();
  let alerts = G.collectAlerts();
  assert.ok(alerts.some(a => /mangler råvarer/.test(a.text)), 'sawmill without wood is listed');
  home.hunger = 3;
  alerts = G.collectAlerts();
  assert.equal(alerts[0].level, 0, 'hunger is urgent and comes first');
  G.alertsCheckedAt = 0;
  G.renderAlertsButton();
  const btn = game.el('alerts');
  assert.equal(btn.hidden, false);
  assert.match(btn.textContent, /Sult/);
  btn.click();
  assert.equal(G.GAME.selectedInfo.kind, 'alerts');
  const body = game.el('info-body');
  assert.match(body.innerHTML, /Haster/);
  const production = alerts.findIndex(a => /mangler råvarer/.test(a.text));
  body.querySelectorAll(`[data-alert="${production}"]`)[0].click();
  assert.equal(G.GAME.selectedInfo.kind, 'economy');
  assert.equal(G.GAME.selectedInfo.tab, 'production', 'leads to the production overview');
  void mill;
});

test('help opens with F1 and every topic renders', () => {
  const { game, G } = setup();
  game.fireWindow('keydown', { key: 'F1', target: G.document.body });
  assert.equal(G.GAME.selectedInfo.kind, 'help');
  const body = game.el('info-body');
  for (const t of G.HELP_TOPICS) {
    body.querySelectorAll(`[data-topic="${t.id}"]`)[0].click();
    assert.equal(G.GAME.selectedInfo.topic, t.id);
    assert.ok(body.innerHTML.length > 200, `${t.name} has content`);
  }
});
