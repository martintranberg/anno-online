'use strict';
// Balance report: lets the bot play several games and prints how they develop.
//
//   node tests/sim-report.js                      40 minutes, seeds 1-3, normal difficulty
//   node tests/sim-report.js --minutes 60 --seeds 5 --difficulty hard --size large
//
const { simulate } = require('./bot');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const minutes = Number(arg('minutes', 40));
const seeds = Number(arg('seeds', 3));
const difficulty = arg('difficulty', 'normal');
const size = arg('size', 'medium');

console.log(`Balance-simulation: ${minutes} min · ${seeds} kort · sværhedsgrad ${difficulty} · kort ${size}\n`);
const finals = [];
for (let seed = 1; seed <= seeds; seed++) {
  const t0 = Date.now();
  const res = simulate({ seed, settings: { difficulty, size }, seconds: minutes * 60, every: 300 });
  console.log(`Kort ${seed} (${((Date.now() - t0) / 1000).toFixed(1)} s realtid)`);
  console.table(res.rows);
  console.log(`  Sult i ${res.hungryTicks} s · laveste mønter ${Math.round(res.minCoins)} · sidste handlinger: ${res.bot.log.slice(-4).join(' | ')}\n`);
  finals.push({ seed, ...res.final, hungerSec: res.hungryTicks, minCoins: Math.round(res.minCoins) });
}
console.log('Samlet:');
console.table(finals);
