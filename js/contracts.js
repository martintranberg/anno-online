'use strict';

// ===== CONTRACTS, FESTIVALS, SCORE AND UNDO =====

// ----- Contracts -----
// The trader (and the rival, when relations are good) regularly offer contracts: deliver an amount of a good
// by a deadline, for well above the trader's price. Accept an offer, then deliver from a harbour warehouse.
const contractGoods = () => {
  const byTier = [[], ['planks', 'fish', 'wood', 'stone', 'grain'], ['pork', 'wool', 'cloth', 'hops', 'bricks', 'clay'],
                  ['beer', 'beef', 'tools', 'coal'], ['wine', 'jewelry']];
  return byTier.slice(1, GAME.tierReached + 1).flat();
};
const contractById = (id) => GAME.contracts.find(c => c.id === id);

// Goods a contract can pay with: useful building materials and goods a tier ahead of where you are,
// so a contract can be a shortcut to something you can't make yet
const CONTRACT_PAY_GOODS = [
  [], ['planks', 'stone', 'fish', 'pork', 'wool'], ['cloth', 'bricks', 'tools', 'beer'], ['wine', 'tools', 'bricks'], ['jewelry', 'wine']
];
const CONTRACT_GOODS_SHARE = 0.45; // share of offers that pay in goods instead of coins
const CONTRACT_GOODS_BONUS = 1.25; // goods are worth this much more than the coins would be

function offerContract() {
  const goods = contractGoods();
  const good = goods[Math.floor(Math.random() * goods.length)];
  const rivalOffers = GAME.rival && rivalRelation() >= 75 && Math.random() < 0.4;
  const amount = Math.round((20 + Math.random() * 40) * (1 + (GAME.tierReached - 1) * 0.5) / 5) * 5;
  GAME.contractCounter = (GAME.contractCounter || 0) + 1;
  const value = Math.round(amount * PRICES[good] * (rivalOffers ? 1.9 : 1.6) + 50);
  const c = {
    id: `c_${GAME.contractCounter}`, from: rivalOffers ? 'rival' : 'trader', good, amount,
    reward: value, rewardGoods: null,
    offeredAt: GAME.tick, accepted: false, deadline: null
  };
  // Some contracts pay in goods: something other than what's delivered, up to a tier ahead
  if (Math.random() < CONTRACT_GOODS_SHARE) {
    const pay = CONTRACT_PAY_GOODS.slice(1, Math.min(CONTRACT_PAY_GOODS.length, GAME.tierReached + 2)).flat().filter(k => k !== good);
    const k = pay[Math.floor(Math.random() * pay.length)];
    const n = Math.max(5, Math.round(value * CONTRACT_GOODS_BONUS / PRICES[k] / 5) * 5);
    c.rewardGoods = { [k]: Math.min(n, WAREHOUSE_CAP) };
    c.reward = 0;
  }
  GAME.contracts.push(c);
  notify(`📜 Ny kontrakt fra ${c.from === 'rival' ? RIVAL_NAME : 'handelsmanden'}: ${c.amount} ${RES_ICONS[good]} ${RESOURCES[good].name.toLowerCase()} for ${contractRewardText(c)}`, false);
}

// "320 🪙" or "30 🛠️ Værktøj"
function contractRewardText(c) {
  const parts = [];
  if (c.reward) parts.push(`${c.reward} 🪙`);
  for (const [k, n] of Object.entries(c.rewardGoods || {})) parts.push(`${n} ${RES_ICONS[k]} ${RESOURCES[k].name.toLowerCase()}`);
  return parts.join(' + ');
}

function contractsTick() {
  if (GAME.phase !== 'play') return;
  GAME.contracts = GAME.contracts || [];
  for (const c of [...GAME.contracts]) {
    if (!c.accepted && GAME.tick - c.offeredAt > CONTRACT_OFFER_TIME) GAME.contracts.splice(GAME.contracts.indexOf(c), 1);
    else if (c.accepted && GAME.tick > c.deadline) {
      GAME.contracts.splice(GAME.contracts.indexOf(c), 1);
      if (c.from === 'rival') changeRelation(-8);
      notify(`⌛ Kontrakten om ${c.amount} ${RES_ICONS[c.good]} udløb uden levering${c.from === 'rival' ? ` – ${RIVAL_NAME} er skuffet` : ''}`);
    }
  }
  GAME.nextContract = (GAME.nextContract ?? 120) - 1;
  if (GAME.nextContract <= 0) {
    GAME.nextContract = CONTRACT_EVERY;
    if (GAME.contracts.filter(c => !c.accepted).length < CONTRACT_MAX_OFFERS) offerContract();
  }
}

function acceptContract(c) {
  if (GAME.contracts.filter(x => x.accepted).length >= 3) return 'Du kan højst have 3 kontrakter i gang';
  c.accepted = true;
  c.deadline = GAME.tick + CONTRACT_TIME;
  saveGame();
  return null;
}

// Harbour warehouses on your islands that hold enough of the good
const contractSources = (c) => [...new Set(portWarehouses().filter(b => !isRivalId(b.id)).map(islandOfBuilding))]
  .filter(isl => isl && isl.resources[c.good] >= c.amount);

function deliverContract(c, isl = contractSources(c)[0]) {
  if (!isl) return `Ingen af dine havne har ${c.amount} ${RESOURCES[c.good].name.toLowerCase()}`;
  isl.resources[c.good] -= c.amount;
  GAME.coins += c.reward;
  // Goods are delivered to the island that filled the contract (as much as its storage holds)
  let lost = 0;
  for (const [k, n] of Object.entries(c.rewardGoods || {})) {
    const put = Math.min(n, Math.max(0, isl.cap - isl.resources[k]));
    isl.resources[k] += put;
    lost += n - put;
  }
  GAME.contractsDone = (GAME.contractsDone || 0) + 1;
  GAME.contracts.splice(GAME.contracts.indexOf(c), 1);
  if (c.from === 'rival') changeRelation(6);
  notify(`✅ Kontrakt leveret fra ${isl.name}: ${c.amount} ${RES_ICONS[c.good]} (+${contractRewardText(c)})${lost ? ` – ${lost} gik tabt, lageret var fuldt` : ''}`);
  sfx('coins');
  saveGame();
  return null;
}

// ----- Festivals -----
function holdFestival(isl) {
  if (isl.festival > 0) return 'Der er allerede fest';
  if ((isl.festivalCooldown || 0) > 0) return `Næste fest om ${isl.festivalCooldown} s`;
  const cost = festivalCost(isl);
  if (!hasCost(isl.resources, cost)) return `Kræver ${fmtCost(cost)}`;
  payCost(isl.resources, cost);
  isl.festival = FESTIVAL_TICKS;
  isl.festivalCooldown = FESTIVAL_COOLDOWN;
  notify(`🎉 Fest på ${isl.name}! Beboerne er i godt humør i ${FESTIVAL_TICKS} sekunder`);
  sfx('fanfare');
  saveGame();
  return null;
}

function festivalTick() {
  for (const isl of GAME.islands.values()) {
    if (isl.festival > 0) isl.festival--;
    if (isl.festivalCooldown > 0) isl.festivalCooldown--;
  }
}

// ----- Rival relations -----
const rivalRelation = () => GAME.rival?.relation ?? RIVAL_RELATION_START;
function changeRelation(d) {
  if (!GAME.rival) return;
  const before = rivalRelation();
  GAME.rival.relation = Math.max(0, Math.min(100, before + d));
  const after = GAME.rival.relation;
  if (before >= 25 && after < 25) notify(`⚑ ${RIVAL_NAME} er fjendtlig: de handler ikke længere med dig og betaler pirater for at plyndre dine skibe!`);
  if (before < 25 && after >= 25) notify(`⚑ ${RIVAL_NAME} vil handle med dig igen`);
  if (before < 75 && after >= 75) notify(`⚑ ${RIVAL_NAME} er venligt stemt: bedre priser og kontrakter`);
}
const relationText = (r) => r >= 75 ? 'Venner' : r >= 50 ? 'Neutral' : r >= 25 ? 'Kølig' : 'Fjendtlig';
const relationIcon = (r) => r >= 75 ? '🤝' : r >= 50 ? '😐' : r >= 25 ? '😒' : '⚔';

function sendGift() {
  if (!GAME.rival) return 'Der er ingen rival';
  if (GAME.coins < RIVAL_GIFT) return `Kræver ${RIVAL_GIFT} 🪙`;
  if (rivalRelation() >= 100) return 'Forholdet er allerede det bedste';
  GAME.coins -= RIVAL_GIFT;
  changeRelation(RIVAL_GIFT_RELATION);
  notify(`🎁 Du sendte ${RIVAL_NAME} en gave (−${RIVAL_GIFT} 🪙)`, false);
  saveGame();
  return null;
}

// Relations slowly drift back towards neutral
function relationTick() {
  if (!GAME.rival || GAME.tick % 30) return;
  const r = rivalRelation();
  if (r > RIVAL_RELATION_START) GAME.rival.relation = r - 1;
  else if (r < RIVAL_RELATION_START) GAME.rival.relation = r + 1;
}

// ----- Score -----
// A number to compare games by (and to keep playing for after the monument)
function computeScore() {
  const isl = [...GAME.islands.values()].filter(i => i.warehouses);
  const parts = {
    residents: Math.round(isl.reduce((s, i) => s + i.pop, 0)),
    tiers: Math.round(isl.reduce((s, i) => { const byL = popByLevel(i); return s + byL[2] * 2 + byL[3] * 5 + byL[4] * 12; }, 0)),
    islands: isl.length * 100,
    buildings: GAME.buildings.length * 5,
    ships: GAME.ships.length * 25,
    quests: GAME.questIndex * 50,
    contracts: (GAME.contractsDone || 0) * 75,
    coins: Math.round(Math.max(0, GAME.coins) / 50),
    pirates: GAME.pirates && GAME.pirates.fortHp <= 0 ? 500 : 0,
    monument: GAME.won ? 2000 : 0
  };
  return { total: Object.values(parts).reduce((a, b) => a + b, 0), parts };
}

const SCORE_LABELS = {
  residents: 'Beboere', tiers: 'Borgere, Købmænd og Adelige', islands: 'Øer', buildings: 'Bygninger', ships: 'Skibe',
  quests: 'Opgaver', contracts: 'Kontrakter', coins: 'Mønter', pirates: 'Piratfortet ødelagt', monument: 'Monumentet'
};

// Best score per map size and difficulty, kept in this browser only
const HIGHSCORE_KEY = 'anno-online-highscores';
function loadHighscores() {
  try { return JSON.parse(localStorage.getItem(HIGHSCORE_KEY)) || {}; } catch { return {}; }
}
function recordHighscore() {
  const key = `${GAME.settings.size}-${GAME.settings.difficulty}`;
  const all = loadHighscores(), score = computeScore().total;
  if (!all[key] || score > all[key].score) {
    all[key] = { score, date: Date.now(), minutes: Math.floor(GAME.tick / 60), won: GAME.won };
    try { localStorage.setItem(HIGHSCORE_KEY, JSON.stringify(all)); } catch { /* not remembered */ }
  }
}

// ----- Undo demolition -----
// The last demolished building (or road) can be put back within a few seconds, including what was refunded
let lastDemolition = null;

function rememberDemolition(entry) {
  lastDemolition = { ...entry, at: Date.now() };
  showToast(`↶ Fortryd nedrivning med Ctrl+Z (${UNDO_SECONDS} s)`);
}

function undoDemolition() {
  const d = lastDemolition;
  if (!d || Date.now() - d.at > UNDO_SECONDS * 1000) { showToast('Intet at fortryde'); return false; }
  lastDemolition = null;
  if (d.road) {
    if (GAME.occupancy.has(`${d.x},${d.y}`)) { showToast('Feltet er optaget igen'); return false; }
    GAME.roads.add(`${d.x},${d.y}`);
    GAME.occupancy.set(`${d.x},${d.y}`, 'road');
    if (d.bridge) recomputeIslands();
  } else {
    const b = d.building, def = DEFS[b.type];
    for (let dy = 0; dy < def.h; dy++) for (let dx = 0; dx < def.w; dx++) {
      if (GAME.occupancy.has(`${b.x + dx},${b.y + dy}`)) { showToast('Pladsen er optaget igen'); return false; }
    }
    // Take the refund back (as much as is still there)
    const isl = islandOfBuilding(b);
    for (const [r, n] of Object.entries(d.refund)) {
      if (r === 'coins') GAME.coins -= n; else isl.resources[r] = Math.max(0, isl.resources[r] - n);
    }
    GAME.buildings.push(b);
    for (let dy = 0; dy < def.h; dy++) for (let dx = 0; dx < def.w; dx++) GAME.occupancy.set(`${b.x + dx},${b.y + dy}`, b.id);
    for (const r of d.routes || []) GAME.routes.push(r);
    updateIslandStats();
  }
  recomputeConnectivity();
  showToast('↶ Nedrivningen er fortrudt');
  saveGame();
  return true;
}
