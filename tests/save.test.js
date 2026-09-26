'use strict';
// Saving and loading: a full round trip, migrating version 3 saves, save slots and bad files.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./harness');
const { newGame, placeFirstWarehouse, build, runTicks } = require('./helpers');

// A game with a bit of everything in it
function busyGame() {
  const { game, G } = newGame({ size: 'medium' }, 51);
  const wh = placeFirstWarehouse(G);
  const home = G.homeIsland();
  G.GAME.coins = 50000;
  Object.assign(home.resources, { planks: 150, stone: 150, bricks: 50, tools: 50 });
  for (let i = 0; i < 3; i++) build(G, 'house', wh.x, wh.y, { maxDist: 6 });
  const mill = build(G, 'sawmill', wh.x, wh.y, { maxDist: 30 });
  mill.level = 2;
  home.tax = 'high';
  const ship = G.spawnShip('karavel', wh);
  const frigate = G.spawnShip('fregat', wh);
  frigate.hp = 55;
  const rwh = G.GAME.rival.buildings.find(b => b.type === 'warehouse');
  const r = G.createRoute(wh.id, rwh.id, [[wh.x + 3, wh.y + 3]].filter(([x, y]) => G.isWater(x, y)));
  r.res = ['planks'];
  G.assignShip(ship, r.id);
  G.GAME.pirates.fortHp = 123;
  runTicks(G, 20);
  G.reveal(wh.x, wh.y, 25);
  return { game, G };
}

// Everything the player would notice if it got lost
function snapshot(G) {
  const home = G.homeIsland();
  return JSON.stringify({
    map: G.MAP_SIZE, settings: G.GAME.settings, phase: G.GAME.phase, coins: Math.round(G.GAME.coins), tick: G.GAME.tick,
    seen: G.GAME.seen.reduce((a, b) => a + b, 0),
    terrain: G.GAME.grid.map(t => t.type[0]).join('').length,
    buildings: G.GAME.buildings.map(b => [b.type, b.x, b.y, b.level || 0]).sort(),
    roads: G.GAME.roads.size,
    home: { name: home.name, pop: home.pop, tax: home.tax, mood: Math.round(home.mood), planks: Math.round(home.resources.planks) },
    fertility: [...G.GAME.islands.values()].map(i => i.fertility.join('+')).sort(),
    ships: G.GAME.ships.map(s => [s.type, s.name, s.routeId, s.hp ?? null]),
    routes: G.GAME.routes.map(r => [r.from, r.to, r.res.join(), r.waypoints.length]),
    rival: G.GAME.rival.buildings.map(b => [b.type, b.x, b.y]).sort(),
    rivalIslands: G.rivalIslands().map(i => i.name).sort(),
    pirates: [G.GAME.pirates.fort, G.GAME.pirates.fortHp],
    quest: G.GAME.questIndex, tier: G.GAME.tierReached, won: G.GAME.won
  });
}

test('save and load restores the whole game', () => {
  const { game, G } = busyGame();
  assert.ok(G.saveGame());
  const before = snapshot(G);
  const loaded = createGame({ seed: 999, storage: { 'anno-online-save': game.store.get('anno-online-save') } }).boot();
  assert.equal(snapshot(loaded.api), before);
  assert.equal(loaded.api.GAME.phase, 'play', 'loaded straight into the game');
  // The loaded game keeps running
  runTicks(loaded.api, 10);
  assert.equal(loaded.api.GAME.tick, G.GAME.tick + 10);
});

test('a version 3 save (before fog, pirates, rival and gold) is migrated', () => {
  const { game, G } = busyGame();
  G.saveGame();
  const data = JSON.parse(game.store.get('anno-online-save'));
  // Turn it into what version 3 wrote
  data.v = 3;
  for (const k of ['seen', 'settings', 'pirates', 'rival', 'gold', 'goldAssigned', 'bankrupt', 'questId']) delete data[k];
  data.questIndex = 9; // "Tegn en handelsrute" in the old 21-step chain
  for (const i of data.islands) { delete i.owner; delete i.pirate; delete i.mood; delete i.tax; delete i.gold; }
  data.buildings = data.buildings.map(b => ({ ...b, level: b.type === 'house' ? b.level : undefined }));
  const loaded = createGame({ seed: 5, storage: { 'anno-online-save': JSON.stringify(data) } }).boot();
  const L = loaded.api;
  assert.equal(L.GAME.phase, 'play');
  assert.equal(L.GAME.seen.reduce((a, b) => a + b, 0), L.MAP_SIZE * L.MAP_SIZE, 'old games know the whole map');
  assert.ok(L.GAME.pirates && L.GAME.pirates.fortHp > 0, 'pirates added');
  assert.ok(L.GAME.rival && L.rivalIslands().length >= 1, 'rival added');
  assert.ok([...L.GAME.islands.values()].some(i => i.gold), 'gold assigned');
  assert.ok([...L.GAME.islands.values()].some(i => i.fertility.includes('grapes')), 'grapes somewhere');
  assert.equal(L.QUESTS[L.GAME.questIndex].id, 'route', 'quest mapped by id');
  L.saveGame();
  assert.equal(JSON.parse(loaded.store.get('anno-online-save')).v, L.SAVE_VERSION, 'saved in the new format');
});

test('saves from other map sizes and junk files are handled', () => {
  const g = createGame({ seed: 1, storage: { 'anno-online-save': '{not json' } }).boot();
  assert.equal(g.el('newgame').hidden, false, 'broken save: new game dialog');
  const bad = createGame({ seed: 1, storage: { 'anno-online-save': JSON.stringify({ v: 4, mapSize: 77, terrain: 'x' }) } }).boot();
  assert.equal(bad.el('newgame').hidden, false, 'invalid map size rejected');
  const { G } = newGame({}, 2);
  placeFirstWarehouse(G);
  G.loadSaveString('garbage');
  assert.equal(G.GAME.phase, 'play', 'garbage import leaves the game alone');
});

test('save slots copy the current game', () => {
  const { game, G } = busyGame();
  G.saveGame();
  game.store.set('anno-online-slot-2', game.store.get('anno-online-save'));
  assert.ok(G.slotInfo(2), 'slot 2 filled');
  assert.equal(G.slotInfo(1), null);
});

test('starting a new game from the menu stores the choice and reloads', () => {
  const { game, G } = busyGame();
  G.newGame();
  game.el('ng-rival').checked = false;
  game.el('ng-events').checked = true;
  game.el('ng-start').click();
  assert.ok(game.reloaded, 'page reloads');
  assert.equal(game.store.get('anno-online-save'), undefined, 'old autosave removed');
  const choice = JSON.parse(game.store.get('anno-online-newgame'));
  assert.equal(choice.rival, false);
  // After the reload the stored choice starts the new map
  const next = createGame({ seed: 8, storage: Object.fromEntries(game.store) }).boot();
  assert.equal(next.api.GAME.phase, 'setup');
  assert.equal(next.api.GAME.settings.rival, false);
});
