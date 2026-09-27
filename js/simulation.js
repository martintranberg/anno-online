'use strict';

// ===== SIMULATION =====
// Takes up to `amount` from the given goods, spread over those in stock. Returns what was taken.
function consume(isl, keys, amount) {
  let taken = 0;
  for (let pass = 0; pass < 2 && taken < amount - 1e-9; pass++) {
    const avail = keys.filter(k => isl.resources[k] > 0);
    if (!avail.length) break;
    const share = (amount - taken) / avail.length;
    for (const k of avail) {
      const t = Math.min(share, isl.resources[k]);
      isl.resources[k] -= t;
      isl.flowOut[k] += t;
      if (isl.flowPeople) isl.flowPeople[k] += t; // the residents' share, for the production overview
      taken += t;
    }
  }
  return taken;
}

const inStock = (isl, need) => NEED_INFO[need].keys.some(k => isl.resources[k] >= 1);

// ----- Natural resources -----
let rocksDirty = false; // set when quarrying visibly changes a rock tile; mountains are rebuilt once per tick
const quarriedTiles = []; // rock tiles quarried away since the last rebuild

// Tiles within `r` of a building's footprint, nearest first
// (cached per building and position: foresters and harvesters ask every tick)
function tilesAround(b, r) {
  const key = `${r}:${b.x},${b.y}`;
  if (b._around?.key === key) return b._around.tiles;
  const tiles = tilesAroundUncached(b, r);
  if (b.id) Object.defineProperty(b, '_around', { value: { key, tiles }, writable: true, configurable: true, enumerable: false });
  return tiles;
}
function tilesAroundUncached(b, r) {
  const def = DEFS[b.type], cx = b.x + (def.w - 1) / 2, cy = b.y + (def.h - 1) / 2, out = [];
  for (let y = b.y - r; y < b.y + def.h + r; y++) {
    for (let x = b.x - r; x < b.x + def.w + r; x++) {
      const t = tileAt(x, y);
      if (t) out.push(t);
    }
  }
  return out.sort((a, c) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(c.x - cx, c.y - cy));
}

// The tile a harvester is working on: keeps chopping the same one until it's empty, then the nearest next
// Upgraded harvesters reach one tile further per level
const harvestRadius = (b) => DEFS[b.type].harvest.radius + prodLevel(b) - 1;
function harvestTarget(b) {
  const { terrain, key } = DEFS[b.type].harvest, radius = harvestRadius(b);
  const ok = (t) => t && t.type === terrain && t[key] > 0;
  let t = b.harvestAt && tileAt(b.harvestAt[0], b.harvestAt[1]);
  if (!ok(t)) {
    t = tilesAround(b, radius).find(ok) || null;
    b.harvestAt = t ? [t.x, t.y] : null;
  }
  return t;
}

// Remaining harvestable amount around a harvester (for the info panel)
const harvestLeft = (b) => {
  const { terrain, key } = DEFS[b.type].harvest, radius = harvestRadius(b);
  return Math.round(tilesAround(b, radius).reduce((s, t) => s + (t.type === terrain ? t[key] || 0 : 0), 0));
};

// Turns emptied tiles into clearings (forest) or gravel (rock), and flags visible rock changes
function depleteTile(t) {
  if (t.type === 'forest' && t.wood <= 0) {
    t.type = 'grass';
    t.stumps = true;
    t.wood = 0;
    decorateTile(t);
  } else if (t.type === 'rock') {
    const stage = Math.ceil((t.stone / ROCK_STONE) * 4);
    if (t.stone <= 0) {
      t.type = 'grass';
      t.quarried = true;
      quarriedTiles.push(t);
      rocksDirty = true;
    } else if (stage !== t.stoneStage) {
      rocksDirty = true;
    }
    t.stoneStage = stage;
  }
}

// Grows a sapling on an empty clearing or grass tile
function plantTree(t) {
  t.type = 'forest';
  t.stumps = false;
  t.wood = 1;
  decorateTile(t);
}

const canPlantOn = (t) => t.type === 'grass' && !t.quarried && !GAME.occupancy.has(`${t.x},${t.y}`);

// One unit of growth per tick: first tend young or thinned trees, then plant on stumps, then on free grass
function tendForest(b) {
  const around = tilesAround(b, FORESTER_RADIUS);
  const grow = around.find(t => t.type === 'forest' && t.wood < t.woodMax);
  if (grow) { grow.wood++; return true; }
  const spot = around.find(t => canPlantOn(t) && t.stumps) || around.find(canPlantOn);
  if (spot) { plantTree(spot); return true; }
  return false;
}

function naturalRegrowth() {
  const samples = Math.round(REGROW_SAMPLES * GAME.grid.length / REGROW_BASE_AREA);
  for (let i = 0; i < samples; i++) {
    const t = GAME.grid[Math.floor(Math.random() * GAME.grid.length)];
    if (t.type === 'forest' && t.wood < t.woodMax && Math.random() < REGROW_CHANCE) t.wood++;
    else if (t.stumps && canPlantOn(t) && Math.random() < STUMP_SPROUT_CHANCE) plantTree(t);
  }
}

// ----- Events: fire, storms, pirates -----
const burnable = (b) => b.type !== 'warehouse' && b.type !== 'monument';

function rollEvents() {
  for (const b of GAME.buildings) {
    if (!b.fire && burnable(b) && Math.random() < FIRE_CHANCE * diff().events) {
      b.fire = FIRE_TICKS;
      const isl = islandOfBuilding(b);
      notify(`🔥 Brand i ${DEFS[b.type].name.toLowerCase()} på ${isl.name}!${b.cov?.fire ? ' Brandstationen rykker ud.' : ' Byg en brandstation i nærheden.'}`);
      sfx('alarm');
    }
  }
  if (!GAME.storm && Math.random() < STORM_CHANCE * diff().events) {
    GAME.storm = STORM_TICKS;
    notify('🌧️ Storm! Skibene sejler langsommere et stykke tid');
    sfx('thunder');
  }
}

// Burning buildings: a nearby fire station puts the fire out quickly, otherwise the building burns down
function updateFires() {
  for (const b of [...GAME.buildings]) {
    if (!b.fire) continue;
    b.fire--;
    if (b.cov?.fire && b.fire <= FIRE_TICKS - 5) {
      b.fire = 0;
      notify(`🚒 Branden i ${DEFS[b.type].name.toLowerCase()} er slukket`, false);
    } else if (b.fire <= 0) {
      notify(`🔥 ${DEFS[b.type].name} på ${islandOfBuilding(b).name} er brændt ned`);
      destroyBuilding(b);
    }
  }
}

// Removes a building without refund (fire). Keeps roads, routes and storage consistent.
function destroyBuilding(b) {
  const def = DEFS[b.type], isl = islandOfBuilding(b);
  GAME.buildings.splice(GAME.buildings.indexOf(b), 1);
  for (let dy = 0; dy < def.h; dy++) {
    for (let dx = 0; dx < def.w; dx++) GAME.occupancy.delete(`${b.x + dx},${b.y + dy}`);
  }
  updateIslandStats();
  for (const r of RES_KEYS) isl.resources[r] = Math.min(isl.resources[r], isl.cap);
  if (GAME.selectedInfo?.id === b.id) closeInfo();
  recomputeConnectivity();
}

function recordHistory(islands) {
  const stock = emptyStock();
  for (const isl of islands) if (isl.owner !== 'rival') for (const k of RES_KEYS) stock[k] += isl.resources[k];
  GAME.history.push({ tick: GAME.tick, coins: Math.round(GAME.coins), stock: Object.fromEntries(RES_KEYS.map(k => [k, Math.round(stock[k])])) });
  if (GAME.history.length > 60) GAME.history.shift();
}

// Happiness factors for an island: [label, points]. The island's mood drifts towards their sum (0-100).
function moodFactors(isl, byL) {
  const f = [['Grundstemning', 55]];
  const t = TAX_LEVELS[isl.tax || 'normal'];
  if (t.mood) f.push([`Skat: ${t.name.toLowerCase()}`, t.mood]);
  if (isl.hunger) f.push(['Sult', -35]);
  for (const n of ['meat', 'cloth', 'beer', 'wine', 'jewelry']) {
    const wanted = byL.some((p, L) => L >= NEED_FROM[n] && p > 0.5);
    if (wanted && isl.needsMet[n] === false) f.push([`Mangler ${NEED_INFO[n].name.toLowerCase()}`, -10]);
  }
  const houses = GAME.buildings.filter(b => DEFS[b.type].house && islandOfBuilding(b) === isl);
  if (houses.length) {
    const served = houses.filter(b => b.cov?.market && servicesMet(b, b.level || 1)).length / houses.length;
    f.push(['Offentlige bygninger', Math.round(served * 25 - 10)]);
    const noRoad = houses.filter(b => !houseLinked(b)).length / houses.length;
    if (noRoad > 0.05) f.push(['Boliger uden vej', -Math.round(noRoad * 15)]);
    const beauty = Math.round(houses.reduce((s, b) => s + (b.beauty || 0), 0) / houses.length);
    if (beauty) f.push(['Pynt og parker', beauty]);
  }
  if (isl.festival > 0) f.push(['Fest', FESTIVAL_MOOD]);
  if (GAME.bankrupt) f.push(['Fallit – byen forfalder', -15]);
  if (GAME.buildings.some(b => b.fire && islandOfBuilding(b) === isl)) f.push(['Brand', -8]);
  return f;
}
const moodIcon = (m) => m >= 70 ? '😊' : m >= 45 ? '😐' : m >= 30 ? '😟' : '😠';
const taxMult = (isl) => TAX_LEVELS[isl.tax || 'normal'].mult * (isl.mood >= 70 ? 1.1 : isl.mood < 40 ? 0.8 : 1);

function tick() {
  updateIslandStats();
  const islands = [...GAME.islands.values()];
  for (const isl of islands) {
    isl.flowIn = emptyStock();
    isl.flowOut = emptyStock();
    isl.flowPeople = emptyStock();
    isl.workersFree = Math.floor(isl.pop);
  }

  // Staffing: food producers get workers first, then everything else in build order
  const staffed = GAME.buildings.filter(b => DEFS[b.type].workers)
    .sort((a, b) => (DEFS[b.type].food ? 1 : 0) - (DEFS[a.type].food ? 1 : 0));
  for (const b of staffed) {
    const isl = islandOfBuilding(b), need = workersOf(b);
    if (b.paused) { b.staffed = false; continue; } // paused buildings release their workers
    b.staffed = isl.workersFree >= need;
    if (b.staffed) isl.workersFree -= need;
  }
  updateFires();

  // Production. Raw producers first, then processors, so this tick's raw output can be processed.
  // When bankrupt, only food production keeps running.
  const producers = GAME.buildings.filter(b => DEFS[b.type].produces);
  producers.sort((a, b) => !!DEFS[a.type].consumes - !!DEFS[b.type].consumes);
  for (const b of producers) {
    const def = DEFS[b.type], isl = islandOfBuilding(b), R = isl.resources;
    const mult = PROD_LEVELS[prodLevel(b)].mult, out = (def.rate ?? 1) * mult;
    b.made = 0; // actual output this tick (the overview compares it with the maximum)
    if (b.paused) { b.status = 'paused'; continue; }
    if (b.fire) { b.status = 'fire'; continue; }
    if (GAME.bankrupt && !def.food) { b.status = 'nocoins'; continue; }
    if (!GAME.connected.has(b.id)) { b.status = 'noroad'; continue; }
    if (!b.staffed) { b.status = 'noworkers'; continue; }
    if (R[def.produces] >= isl.cap) { b.status = 'full'; continue; }
    const inputs = Object.entries(def.consumes || {}).map(([r, n]) => [r, n * mult]);
    if (inputs.some(([r, n]) => R[r] < n)) { b.status = 'noinput'; continue; }
    let made = out;
    if (def.harvest) {
      // Woodcutters and stonecutters take their goods from the map around them
      const src = harvestTarget(b);
      if (!src) {
        b.status = 'noresource';
        warnOnce(`depleted-${b.id}`, `🪓 ${def.name} på ${isl.name} har ikke flere ${def.harvest.label} i nærheden`, 600);
        continue;
      }
      made = Math.min(out, src[def.harvest.key]);
      src[def.harvest.key] -= made;
      isl.harvested = isl.harvested || {};
      isl.harvested[def.harvest.key] = (isl.harvested[def.harvest.key] || 0) + made;
      depleteTile(src);
    }
    if (def.harvest) resolveWarning(`depleted-${b.id}`);
    for (const [r, n] of inputs) { R[r] -= n; isl.flowOut[r] += n; }
    R[def.produces] = Math.min(isl.cap, R[def.produces] + made);
    isl.flowIn[def.produces] += made;
    b.made = made;
    b.status = 'ok';
  }

  // Foresters plant and tend trees; the wild slowly grows back by itself
  for (const b of GAME.buildings) {
    if (b.type !== 'forester') continue;
    b.status = b.paused ? 'paused' : GAME.bankrupt ? 'nocoins' : !b.staffed ? 'noworkers' : tendForest(b) ? 'planting' : 'idle';
  }
  naturalRegrowth();

  // Shipyards
  for (const b of GAME.buildings) {
    if (b.type !== 'shipyard') continue;
    const linked = GAME.connected.has(b.id);
    b.status = b.paused ? 'paused' : GAME.bankrupt ? 'nocoins' : !linked ? 'noroad' : !b.staffed ? 'noworkers' : b.queue ? 'building' : 'idle';
    if (b.queue && b.status === 'building' && !b.fire && ++b.queue.progress >= SHIP_TYPES[b.queue.type].buildTime) {
      spawnShip(b.queue.type, b);
      b.queue = null;
    }
  }

  // Residents' needs, happiness, growth and taxes, per island
  let tax = 0;
  for (const isl of islands) {
    if (isl.owner === 'rival') continue;
    const byL = popByLevel(isl);
    const demand = { food: Math.max(0, isl.pop - FREE_SETTLERS) * NEED_RATES.food };
    for (const n of ['meat', 'cloth', 'beer', 'wine', 'jewelry']) {
      demand[n] = byL.reduce((s, p, L) => s + (L >= NEED_FROM[n] ? p : 0), 0) * NEED_RATES[n];
    }
    for (const need of NEED_ORDER) {
      // Everyday food is fish (and other non-meat food) first; meat only when that runs out,
      // so the meat the Borgere need can build up
      let eaten;
      if (need === 'food') {
        eaten = consume(isl, BASIC_FOOD_KEYS, demand.food);
        eaten += consume(isl, MEAT_KEYS, demand.food - eaten);
      } else eaten = consume(isl, NEED_INFO[need].keys, demand[need]);
      // With no one to consume it yet, a need counts as met when the goods are in stock
      isl.needsMet[need] = demand[need] > 1e-9 ? eaten >= demand[need] - 1e-6 : (need === 'food' || inStock(isl, need));
    }
    const fed = isl.needsMet.food;
    const hasFood = FOOD_KEYS.some(k => isl.resources[k] > 0);
    if (fed) { isl.hunger = 0; resolveWarning(`hunger-${isl.name}`); }
    else {
      if (++isl.hunger === 1 && isl.pop > 0) warnOnce(`hunger-${isl.name}`, `🍽️ Beboerne på ${isl.name} sulter!`, 60);
      if (isl.hunger % STARVE_TICKS === 0 && isl.pop > 0) isl.pop--;
    }

    // Mood drifts towards the sum of its factors
    isl.mood = isl.mood ?? MOOD_START;
    if (isl.pop > 0) {
      const target = Math.max(0, Math.min(100, moodFactors(isl, byL).reduce((s, [, v]) => s + v, 0)));
      isl.mood += Math.max(-2, Math.min(2, target - isl.mood));
    }
    const mood = isl.mood;

    if (isl.pop > isl.popCap) isl.pop--;
    else if (mood < 30 && isl.pop > FREE_SETTLERS) {
      // Unhappy residents move away
      if (GAME.tick % 4 === 0) isl.pop--;
      warnOnce(`mood-${isl.name}`, `😠 Beboerne på ${isl.name} er utilfredse og flytter! Sænk skatten eller dæk deres behov.`, 120);
    } else if (fed && hasFood && isl.pop < isl.popCap && (mood >= 45 || GAME.tick % 2 === 0)) {
      resolveWarning(`mood-${isl.name}`);
      const bonus = mood >= 75 ? 1 : 0;
      // Settlers arrive gradually: about one every other second, a little faster on big islands
      isl.pop = Math.min(isl.popCap, isl.pop + (GAME.tick % 2 === 0 ? 1 : 0) + bonus + Math.floor(isl.popCap / 150));
    } else if (isl.pop < Math.min(isl.popCap, FREE_SETTLERS)) isl.pop++; // first settlers come even without food

    for (let L = 1; L <= MAX_LEVEL; L++) {
      const happy = HOUSE_LEVELS[L].needs.every(n => isl.needsMet[n]);
      tax += byL[L] * HOUSE_LEVELS[L].tax * (happy ? 1 : 0.5) * taxMult(isl);
    }

    if (mood >= 30) resolveWarning(`mood-${isl.name}`);

    // Worker shortage: which buildings stand empty and how many workers they would need beyond those free
    const short = GAME.buildings.filter(b => DEFS[b.type].workers && !b.staffed && !b.paused && islandOfBuilding(b) === isl);
    const missing = short.reduce((s, b) => s + workersOf(b), 0) - (isl.workersFree || 0);
    isl.workerShortage = short.length ? { buildings: short.length, missing: Math.max(1, missing), names: [...new Set(short.map(b => DEFS[b.type].name.toLowerCase()))] } : null;
    if (isl.pop > 0 && short.length) {
      const s = isl.workerShortage;
      warnOnce(`workers-${isl.name}`, `👷 ${isl.name} mangler ${s.missing} arbejder${s.missing > 1 ? 'e' : ''} til ${s.names.slice(0, 3).join(', ')}${s.names.length > 3 ? ' m.fl.' : ''} (${isl.workersFree} ledige) – byg flere boliger`, 180);
    } else resolveWarning(`workers-${isl.name}`);
    for (const k of RES_KEYS) {
      if (isl.cap && isl.flowIn[k] > 0 && isl.resources[k] >= isl.cap) {
        warnOnce(`full-${isl.name}-${k}`, `📦 Lageret på ${isl.name} er fuldt af ${RESOURCES[k].name.toLowerCase()}`, 240);
      } else if (isl.resources[k] < isl.cap - 1) resolveWarning(`full-${isl.name}-${k}`);
    }
  }

  // Coins: taxes in, upkeep of running buildings and ships out. Buildings halted by bankruptcy cost nothing.
  const running = (b) => !b.paused && !(GAME.bankrupt && b.status === 'nocoins') &&
    !(GAME.bankrupt && DEFS[b.type].service && DEFS[b.type].service !== 'market');
  const upkeep = GAME.buildings.reduce((s, b) => s + (running(b) ? upkeepOf(b) : 0), 0) +
                 GAME.ships.reduce((s, sh) => s + SHIP_TYPES[sh.type].upkeep, 0);
  GAME.coins += tax - upkeep;
  GAME.lastTax = tax;
  GAME.lastUpkeep = upkeep;
  updateBankruptcy(tax - upkeep);

  if (GAME.tick % UPGRADE_EVERY === 0) upgradeHouses(islands);
  if (GAME.events) rollEvents();
  if (GAME.storm > 0 && --GAME.storm === 0) notify('🌤️ Stormen er drevet over', false);
  traderTick();
  pirateTick();
  rivalTick();
  relationTick();
  contractsTick();
  festivalTick();
  lifeTick();
  if (GAME.tick % 30 === 0 && GAME.phase === 'play') recordHighscore();
  repairShips();
  for (const s of GAME.ships) reveal(s.x, s.y, SHIP_SIGHT);
  if (GAME.tick % 10 === 0) recordHistory(islands);
  checkQuests();
  if (rocksDirty) { rocksDirty = false; redecorateRocks(quarriedTiles.splice(0)); } // rebuild shrinking mountains
  if (GAME.tick % 5 === 0) minimapDirty = true;

  GAME.tick++;
  if (GAME.tick % AUTOSAVE_TICKS === 0) saveGame();
}

// Below zero coins you're bankrupt: production (except food), shipyards and most public buildings stop
// until the treasury is positive again. Before that, warn when the money is about to run out.
function updateBankruptcy(net) {
  if (!GAME.bankrupt && GAME.coins < 0) {
    GAME.bankrupt = true;
    notify('💸 Fallit! Al produktion undtagen mad står stille, og kapeller, kroer og teatre lukker, indtil du er ude af gælden.');
    sfx('alarm');
    updateIslandStats();
  } else if (GAME.bankrupt && GAME.coins >= 50) {
    GAME.bankrupt = false;
    notify('🪙 Du er ude af gælden – alt kører igen');
    sfx('coins');
    updateIslandStats();
  } else if (!GAME.bankrupt && net < 0 && GAME.coins / -net < 120) {
    warnOnce('lowcoins', `⚠ Mønterne slipper op om ca. ${Math.max(1, Math.round(GAME.coins / -net))} sekunder! Sæt skatten op, sæt bygninger på pause eller sælg varer.`, 90);
  } else resolveWarning('lowcoins');
}

// One house per island may upgrade when the island's houses are (nearly) full, the residents are content,
// the house's current needs are met, the next level's goods are in stock and the island can pay the materials.
function upgradeHouses(islands) {
  for (const isl of islands) {
    if (!isl.houses || isl.pop < isl.popCap * 0.9) continue;
    if (isl.allowUpgrade === false || (isl.mood ?? MOOD_START) < 50) continue;
    const b = GAME.buildings.find(h => DEFS[h.type].house && islandOfBuilding(h) === isl && (h.level || 1) < MAX_LEVEL &&
      !h.lockLevel && !h.fire &&
      HOUSE_LEVELS[h.level || 1].needs.every(n => isl.needsMet[n]) && servicesMet(h, h.level || 1) &&
      HOUSE_LEVELS[(h.level || 1) + 1].needs.every(n => inStock(isl, n)) && servicesMet(h, (h.level || 1) + 1) &&
      hasCost(isl.resources, HOUSE_LEVELS[h.level || 1].upgrade));
    if (!b) continue;
    payCost(isl.resources, HOUSE_LEVELS[b.level].upgrade);
    b.level++;
    notify(`🏠 En bolig på ${isl.name} er blevet til ${tierName(b.level)}`, false);
    if (b.level > GAME.tierReached) {
      GAME.tierReached = b.level;
      const unlocked = [...Object.values(DEFS).filter(d => d.tier === b.level).map(d => d.name),
                        ...Object.values(SHIP_TYPES).filter(t => t.tier === b.level).map(t => t.name)];
      notify(`🎉 Du har nu ${tierName(b.level)}! Låst op: ${unlocked.join(', ') || 'intet nyt'}`);
      sfx('fanfare');
    }
  }
  updateIslandStats();
}

// ===== MAIN LOOP =====
let acc = 0, lastTime = 0, infoTimer = 0;
function gameLoop(t) {
  if (!lastTime) lastTime = t;
  const dt = Math.min(250, t - lastTime);
  lastTime = t;
  animTime = t;
  updateKeyboardPan(dt);
  const gdt = dt * GAME.speed; // game time runs at the chosen speed (0 = paused)
  updateShips(gdt);
  updateTrader(gdt);
  updatePirates(gdt);
  updateRivalShip(gdt);
  updateLife(gdt);

  acc += gdt;
  while (acc >= 1000) {
    tick();
    acc -= 1000;
  }

  render();
  renderMinimap();
  updateHud();
  refreshMenuState();
  infoTimer += dt;
  if (infoTimer > 500) {
    infoTimer = 0;
    if (!infoPointerDown) renderInfo();
    renderQuest();
    renderMessages();
  }

  requestAnimationFrame(gameLoop);
}

function updateHud() {
  const isl = activeIsland();
  const net = (GAME.lastTax || 0) - (GAME.lastUpkeep || 0);
  const coinsEl = document.getElementById('coins');
  coinsEl.innerHTML =
    `🪙 ${Math.floor(GAME.coins)} <small class="${net < 0 ? 'neg' : 'pos'}">${net >= 0 ? '+' : ''}${rate(net)}/s</small>${GAME.bankrupt ? ' <b class="neg">FALLIT</b>' : ''}`;
  coinsEl.classList.toggle('bankrupt', GAME.bankrupt);
  document.getElementById('pop').textContent = `👥 ${totalPopulation()} / ${totalPopCap()} · ${tierName(GAME.tierReached)}`;
  const known = isl && isl.discovered;
  const fert = known ? isl.fertility.map(f => FERTILITY[f].icon).join('') + (isl.ore ? '⛏️' : '') + (isl.gold ? '🥇' : '') : '';
  const extra = !isl ? '' : !known ? '' : isl.owner === 'rival' ? ` (${RIVAL_NAME})` : isl.pirate ? ' (pirater)' :
    !isl.warehouses ? ' (intet lager)' : isl.pop ? ` ${moodIcon(isl.mood ?? MOOD_START)}` : '';
  document.getElementById('island-name').textContent = `📍 ${isl ? (known ? isl.name : 'Ukendt ø') : 'Havet'} ${fert}${extra}`;
  document.getElementById('tick').textContent = `Tick: ${GAME.tick}${GAME.speed === 0 ? ' · ⏸ Pause' : ''}`;
  renderAlertsButton();
  document.getElementById('saved-at').textContent =
    lastSavedAt ? `Gemt ${lastSavedAt.toLocaleTimeString('da-DK')}` : 'Ikke gemt endnu';
}

// ===== INIT =====
window.addEventListener('DOMContentLoaded', () => {
  log('Initializing game...', 'info');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  buildMenu();
  setSpeed(1);
  initMinimap();
  initAudioControls();

  if (loadGame()) { finishInit(true); return; }
  // A new game chosen before the reload, or the new-game dialog on first start
  let pending = null;
  try {
    pending = JSON.parse(localStorage.getItem(NEWGAME_KEY));
    localStorage.removeItem(NEWGAME_KEY);
  } catch { /* no stored choice */ }
  if (pending) startNewGame(pending);
  else openNewGameDialog(false);
});

// Everything after the map exists (loaded or freshly generated)
function finishInit(loaded) {
  gameStarted = true;
  decorateTerrain(GAME.grid);
  // Natural resources at the start, for the production overview (saves from before it are measured from now)
  for (const isl of GAME.islands.values()) {
    if (!isl.natureStart) { isl.natureStart = natureTotals(isl); isl.natureFromLoad = loaded; }
  }
  document.getElementById('opt-events').checked = GAME.events;
  minimapDirty = true;
  fogLayer.dirty = true;

  if (GAME.phase === 'play') {
    document.getElementById('banner').hidden = true;
    recomputeConnectivity();
    GAME.routes.forEach(routePath); // lengths for the route lists
    resumeShips();
    refreshMenuState();
    log('Gemt spil indlæst', 'ok');
    showToast(migratedFrom === 2 ? '📂 Dit spil er opdateret til den nye version (boliger og mønter er nulstillet)'
      : migratedFrom === 3 ? '📂 Dit spil er opdateret: nye øer at udforske, pirater, en rival og Adelige'
      : migratedFrom === 4 ? '📂 Dit spil er opdateret: kontrakter, fester, pynt og vogne på vejene. Nye boliger skal have vej.' : '📂 Dit gemte spil er indlæst');
  } else {
    // Setup phase: the player picks where the first (free) warehouse goes
    openBuildCategory('harbor');
    selectTool('warehouse');
    log('Vælg hvor dit første lager skal stå', 'ok');
    if (oldSaveIgnored) showToast('Dit gemte spil var fra en ældre version – et nyt kort er lavet');
  }
  // Save right away so even the freshly generated map survives a reload
  if (!loaded) { saveGame(); pendingNotices.push('❓ Tryk F1 (eller ?) for hjælp til spillets systemer og taster'); }
  renderQuest();
  for (const msg of pendingNotices) notify(msg, false);
  requestAnimationFrame(gameLoop);
}
