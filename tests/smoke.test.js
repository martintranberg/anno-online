'use strict';
// Loading, map generation for every option, and "does every drawing and panel run without throwing".
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./harness');
const { newGame, placeFirstWarehouse, revealAll, build, runTicks, startIsland } = require('./helpers');

test('all game scripts load and the new-game dialog opens on first start', () => {
  const game = createGame({ seed: 3 }).boot();
  assert.equal(game.el('newgame').hidden, false, 'dialog is shown');
  assert.equal(game.el('ng-cancel').hidden, true, 'no cancel button on first start');
  assert.equal(game.api.GAME.grid.length, 0, 'no map before the player chooses');
});

for (const size of ['small', 'medium', 'large']) {
  test(`new ${size} map has a start island, pirates, fertility, ore and gold`, () => {
    const { G } = newGame({ size }, 11);
    const N = G.MAP_SIZES[size].size;
    assert.equal(G.MAP_SIZE, N);
    assert.equal(G.GAME.grid.length, N * N);
    assert.equal(G.GAME.phase, 'setup');
    const islands = [...G.GAME.islands.values()];
    const start = islands.find(i => i.start);
    assert.ok(start, 'start island');
    assert.equal(Math.max(...islands.map(i => i.size)), start.size, 'start island is the biggest');
    assert.equal(JSON.stringify(start.fertility), '["grain"]');
    assert.ok(islands.filter(i => i.size >= 12 && !i.start).length >= 5, 'enough other islands');
    assert.ok(G.GAME.pirates && G.GAME.pirates.fortHp === G.FORT_HP, 'pirate fort');
    assert.ok(islands.some(i => i.pirate), 'pirate island');
    for (const f of ['sheep', 'hops', 'grapes']) assert.ok(islands.some(i => i.fertility.includes(f)), `some island has ${f}`);
    assert.ok(islands.some(i => i.ore), 'ore island');
    assert.ok(islands.some(i => i.gold), 'gold island');
    // Fog: only the start island and its surroundings are known
    const seen = G.GAME.seen.reduce((a, b) => a + b, 0);
    assert.ok(seen > start.size && seen < N * N / 2, `fog covers most of the map (seen ${seen})`);
    assert.equal(G.GAME.coins, G.DIFFICULTIES.normal.coins);
  });
}

test('difficulty and island amount settings are applied', () => {
  const easy = newGame({ difficulty: 'easy', islands: 'few' }, 5).G;
  const hard = newGame({ difficulty: 'hard', islands: 'many' }, 5).G;
  assert.equal(easy.GAME.coins, 2000);
  assert.equal(hard.GAME.coins, 600);
  const count = (G) => [...G.GAME.islands.values()].filter(i => i.size >= 12).length;
  assert.ok(count(hard) > count(easy), 'many > few islands');
});

test('same seed gives the same map', () => {
  const a = newGame({}, 42).G, b = newGame({}, 42).G;
  assert.equal(a.GAME.grid.map(t => t.type[0]).join(''), b.GAME.grid.map(t => t.type[0]).join(''));
});

test('first warehouse starts the game and brings the rival', () => {
  const { G } = newGame({}, 2);
  const wh = placeFirstWarehouse(G);
  assert.equal(G.GAME.phase, 'play');
  assert.ok(G.islandOfBuilding(wh).home);
  assert.equal(G.homeIsland().resources.planks, G.START_STOCK.planks);
  assert.ok(G.rivalIslands().length === 1, 'rival has a home island');
});

test('every building renders at every level, in the build menu and on the map', () => {
  const { G } = newGame({}, 4);
  placeFirstWarehouse(G);
  for (const id of Object.keys(G.DEFS)) {
    G.drawPreview(G.document.createElement('canvas'), id);
    if (G.BUILDING_RENDERERS[id]) {
      for (const level of [1, 2, 3, 4]) G.drawBuilding({ id: 'x', type: id, x: 10, y: 10, level });
    }
  }
  G.drawPreview(G.document.createElement('canvas'), 'demolish');
  for (const id of Object.keys(G.DEFS)) if (!['road', 'canal'].includes(id)) assert.ok(G.BUILDING_RENDERERS[id], `renderer for ${id}`);
});

test('the map renders at every zoom level, with fog, ships, rival and pirates', () => {
  const { G } = newGame({ size: 'medium' }, 6);
  const wh = placeFirstWarehouse(G);
  const ship = G.spawnShip('jolle', wh);
  G.spawnShip('fregat', wh);
  G.GAME.pirates.ship = { pirate: true, type: 'kogge', name: 'P', x: ship.x + 2, y: ship.y, dir: [1, 0], path: [], hp: 20, state: 'hunting' };
  for (const zoom of [0.35, 0.5, 0.8, 1.5, 2.5]) {
    G.GAME.camera.zoom = zoom;
    G.render();
    G.renderMinimap();
  }
  revealAll(G);
  G.fogLayer.dirty = true;
  G.groundLayer.dirty = true;
  G.GAME.camera.zoom = 0.35;
  G.render();
  G.GAME.storm = 5;
  G.render();
});

test('every info panel renders', () => {
  const { G } = newGame({}, 8);
  const wh = placeFirstWarehouse(G);
  revealAll(G);
  G.GAME.coins = 99999;
  Object.assign(G.homeIsland().resources, { planks: 150, stone: 150 });
  const house = build(G, 'house', wh.x, wh.y);
  const fisher = build(G, 'fisher', wh.x, wh.y);
  const yard = build(G, 'shipyard', wh.x, wh.y);
  const market = build(G, 'marketplace', wh.x, wh.y);
  const tower = build(G, 'watchtower', wh.x, wh.y);
  const ship = G.spawnShip('jolle', wh);
  const frigate = G.spawnShip('fregat', wh);
  runTicks(G, 3);
  const rivalWh = G.GAME.rival.buildings.find(b => b.type === 'warehouse');
  const route = G.createRoute(wh.id, rivalWh.id, []);
  const views = [['building', wh.id], ['building', house.id], ['building', fisher.id], ['building', yard.id],
                 ['building', market.id], ['building', tower.id], ['ship', ship.id], ['ship', frigate.id],
                 ['route', route.id], ['routes'], ['islands'], ['economy'], ['rival', rivalWh.id], ['pirates']];
  for (const [kind, id] of views) {
    G.openInfo(kind, id);
    assert.ok(G.document.getElementById('info-body').innerHTML.length > 50, `${kind} panel has content`);
  }
  G.renderQuest();
  G.updateHud();
  G.refreshMenuState();
  for (const cat of G.CATEGORIES) G.openBuildCategory(cat.id);
});
