'use strict';
// Long-running simulations: the bot plays whole games; these catch economies that stall, crash or
// produce impossible numbers after a change. For detailed balance numbers run `npm run sim`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { simulate } = require('./bot');
const { assertSane, newGame, placeFirstWarehouse, revealAll, runTicks } = require('./helpers');

for (const seed of [1, 2]) {
  test(`bot builds a working island economy in 45 minutes (map ${seed})`, () => {
    const res = simulate({ seed, seconds: 45 * 60, every: 300 });
    const f = res.final;
    assertSane(assert, res.G);
    assert.ok(f.pop >= 120, `population ${f.pop} ≥ 120`);
    assert.ok(res.minCoins >= 0, `never in debt (lowest ${Math.round(res.minCoins)})`);
    assert.ok(res.hungryTicks < 120, `little hunger (${res.hungryTicks} s)`);
    assert.ok(f.quest >= 6, `quests progress (${f.quest})`);
    assert.ok(f.islands >= 2, 'founded a colony');
    // Population never collapses between snapshots
    for (let i = 1; i < res.rows.length; i++) assert.ok(res.rows[i].pop >= res.rows[i - 1].pop * 0.7, `no collapse at ${res.rows[i].min} min`);
  });
}

test('bot reaches Borgere within 90 minutes on a friendly map', () => {
  const res = simulate({ seed: 1, seconds: 90 * 60, every: 900 });
  assert.ok(res.final.tier >= 2, `tier ${res.final.tier}`);
  assertSane(assert, res.G);
});

test('a big, fully explored late game ticks fast enough', () => {
  const { G } = newGame({ size: 'large', islands: 'many' }, 9);
  placeFirstWarehouse(G);
  revealAll(G);
  for (let i = 0; i < 6; i++) G.rivalExpand(G.rivalIslands());
  runTicks(G, 5);
  const t0 = Date.now();
  runTicks(G, 50);
  const ms = (Date.now() - t0) / 50;
  assert.ok(ms < 40, `one second of game time took ${ms.toFixed(1)} ms`);
});
