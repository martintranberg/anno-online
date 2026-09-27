'use strict';

// Simple debug logger
const LOG = [];
function log(msg, type = 'info') {
  const prefix = type === 'ok' ? '✓' : type === 'err' ? '✗' : 'i';
  const entry = `[${prefix}] ${msg}`;
  LOG.unshift(entry);
  if (LOG.length > 20) LOG.pop();
  console.log(entry);
  updateDebug();
}

function updateDebug() {
  const el = document.getElementById('debug');
  if (el) {
    el.innerHTML = LOG.map(l => {
      let cls = 'log-info';
      if (l.includes('✓')) cls = 'log-ok';
      if (l.includes('✗')) cls = 'log-err';
      return `<div class="log ${cls}">${l}</div>`;
    }).join('');
  }
}

// ===== GAME STATE =====
// Chosen when a new game starts (see MAP_SIZES); a loaded save sets it from the save
let MAP_SIZE = 128;

// New-game options
const MAP_SIZES = {
  small:  { name: 'Lille',  size: 96 },
  medium: { name: 'Mellem', size: 128 },
  large:  { name: 'Stor',   size: 160 }
};
const ISLAND_AMOUNTS = {
  few:    { name: 'Få',     f: 0.7 },
  normal: { name: 'Normal', f: 1 },
  many:   { name: 'Mange',  f: 1.4 }
};
// coins: start coins · events: fire/storm chance · pirates: raid frequency · rivalEvery: ticks between
// the rival's new colonies · rivalMax: most islands the rival will own
const DIFFICULTIES = {
  easy:   { name: 'Let',    coins: 2000, events: 0.5, pirates: 0.6, rivalEvery: 720, rivalMax: 3 },
  normal: { name: 'Normal', coins: 1000, events: 1,   pirates: 1,   rivalEvery: 480, rivalMax: 5 },
  hard:   { name: 'Svær',   coins: 600,  events: 1.6, pirates: 1.5, rivalEvery: 300, rivalMax: 8 }
};
const DEFAULT_SETTINGS = { size: 'medium', islands: 'normal', difficulty: 'normal', rival: true, events: true };
const diff = () => DIFFICULTIES[GAME.settings.difficulty] || DIFFICULTIES.normal;

const GAME = {
  grid: [],
  buildings: [],
  occupancy: new Map(),
  islands: new Map(),      // island id -> { name, resources, cap, pop, popCap, fertility, ... } (one storage per landmass)
  ships: [],
  roads: new Set(),        // "x,y" keys of road tiles (a road on a canal tile is a bridge)
  connected: new Set(),    // ids of buildings linked to a warehouse by road
  phase: 'setup',          // 'setup' until the first warehouse is placed, then 'play'
  roadDrag: null,          // start tile while dragging out a road or canal
  shipCounter: 0,
  routes: [],              // player-drawn trade routes (several ships can sail one route)
  routeCounter: 0,
  routeDraw: null,         // state while the player is drawing a route on the map
  trader: null,            // the trader's ship (null while he's away)
  events: true,            // random events (fire, storms, pirates) on/off
  storm: 0,                // ticks left of a storm
  history: [],             // snapshots of total stock and coins for the economy graphs
  won: false,
  settings: { ...DEFAULT_SETTINGS },
  seen: new Uint8Array(0),   // fog of war: 1 = explored tile
  pirates: null,           // pirate fort and raider ship (null = no pirates on this map)
  rival: null,             // rival trading house: its islands, buildings and ship
  bankrupt: false,         // coins below zero: most production stops
  moving: null,            // id of the building being relocated
  shipOrder: null,         // { id } while the player picks a destination for a ship
  contracts: [],           // offers and accepted contracts (see contracts.js)
  coins: 0,
  tierReached: 1,          // highest house level reached so far (unlocks buildings and ships)
  questIndex: 0,
  speed: 1,                // 0 = paused, 1-3 = game speed
  tick: 0,
  selectedBuilding: null,
  hoveredTile: null,
  camera: { x: 0, y: 0, zoom: 1 }
};

const RESOURCES = {
  wood:   { name: 'Træstammer', icon: '🌲' },
  planks: { name: 'Planker',    icon: '📦' },
  stone:  { name: 'Sten',       icon: '🪨' },
  fish:   { name: 'Fisk',       icon: '🐟', food: true },
  grain:  { name: 'Korn',       icon: '🌾' },
  pork:   { name: 'Svinekød',   icon: '🥓', food: true, meat: true },
  beef:   { name: 'Oksekød',    icon: '🥩', food: true, meat: true },
  wool:   { name: 'Uld',        icon: '🐑' },
  cloth:  { name: 'Tøj',        icon: '👕' },
  hops:   { name: 'Humle',      icon: '🌿' },
  beer:   { name: 'Øl',         icon: '🍺' },
  clay:   { name: 'Ler',        icon: '🟤' },
  bricks: { name: 'Mursten',    icon: '🧱' },
  coal:   { name: 'Kul',        icon: '⚫' },
  ore:    { name: 'Jernmalm',   icon: '⛏️' },
  tools:  { name: 'Værktøj',    icon: '🛠️' },
  grapes: { name: 'Vindruer',   icon: '🍇' },
  wine:   { name: 'Vin',        icon: '🍷' },
  gold:   { name: 'Guld',       icon: '🥇' },
  jewelry:{ name: 'Smykker',    icon: '💍' }
};
const RES_KEYS = Object.keys(RESOURCES);
const FOOD_KEYS = RES_KEYS.filter(k => RESOURCES[k].food);
const MEAT_KEYS = RES_KEYS.filter(k => RESOURCES[k].meat);
const BASIC_FOOD_KEYS = FOOD_KEYS.filter(k => !RESOURCES[k].meat); // eaten before meat
// Coins are global (not stored per island) but appear in costs like any other good
const RES_ICONS = { ...Object.fromEntries(RES_KEYS.map(k => [k, RESOURCES[k].icon])), coins: '🪙' };
const emptyStock = () => Object.fromEntries(RES_KEYS.map(k => [k, 0]));

// Island fertility decides which farms can be built there
const FERTILITY = {
  grain: { name: 'Korn',  icon: '🌾' },
  sheep: { name: 'Får',   icon: '🐑' },
  hops:  { name: 'Humle', icon: '🌿' },
  grapes:{ name: 'Vindruer', icon: '🍇' }
};

// ----- Balance -----
const WAREHOUSE_CAP = 150;                                    // storage per resource per warehouse
// Delivered with the very first warehouse. 80 planks covers fisher + 3 houses + woodcutter + sawmill (64)
// with some slack, so the plank chain can always be started.
const START_STOCK = { planks: 80, fish: 25 };
const START_COINS = 1000;
const FOUNDING_COST = { coins: 150, planks: 30, stone: 10 };  // first warehouse on another island (needs a ship)
const EXTRA_WAREHOUSE_POP = 20;                               // island residents needed per existing warehouse
const extraWarehouseCost = (count) => ({ coins: 100 + 50 * count, planks: 30 + 15 * count, stone: 25 + 15 * count });
const STARVE_TICKS = 5;                                       // without food, one resident leaves every N ticks
// Getting a new island going: the founding ship brings supplies, and an island's first few settlers
// bring their own provisions (no food needed), so they can staff the first fisher.
const FOUNDING_SUPPLIES = { planks: 30, fish: 20 };
const FREE_SETTLERS = 4;
const UPGRADE_EVERY = 3;                                      // at most one house upgrade per island every N ticks

// Natural resources on the map run out. Wood grows back (slowly, faster with a forester); stone does not.
const WOOD_PER_TREE = 10;       // wood units per tree (forest tiles hold 2-3 trees)
const ROCK_STONE = 80;          // stone units per rock tile, never replenished
const REGROW_SAMPLES = 60;      // tiles checked per tick for natural regrowth
const REGROW_CHANCE = 0.25;     // chance a sampled forest tile grows one wood unit (~1 tree per hour or so)
const STUMP_SPROUT_CHANCE = 0.1;// chance a sampled clearing with stumps sprouts a sapling
const FORESTER_RADIUS = 5;
const ORE_PER_TILE = 60;        // iron ore in a rock tile on an ore island, never replenished
const GOLD_PER_TILE = 40;       // gold in a rock tile on the gold island, never replenished
const REGROW_BASE_AREA = 96 * 96; // regrowth samples scale with the map area

// Public buildings serve houses within a radius (tiles from the building's edge)
const SERVICES = {
  market: { name: 'Markedsplads', icon: '🏪' },
  chapel: { name: 'Kapel',        icon: '⛪' },
  tavern: { name: 'Kro',          icon: '🍻' },
  fire:   { name: 'Brandstation', icon: '🚒' },
  theater:{ name: 'Teater',       icon: '🎭' }
};
const WAREHOUSE_MARKET_RADIUS = 6; // a warehouse doubles as a small market for nearby houses
const UNSERVED_CAP = 2;            // pioneers living outside any market's reach

// Trader: sails between port warehouses; players set per-island "sell above" / "buy up to" levels
const PRICES = { wood: 2, planks: 4, stone: 5, fish: 3, grain: 2, pork: 6, beef: 7, wool: 4, cloth: 10, hops: 3,
                 beer: 9, clay: 2, bricks: 8, coal: 4, ore: 5, tools: 14, grapes: 4, wine: 14, gold: 12, jewelry: 26 };
const BUY_MARKUP = 1.6;            // buying from the trader costs more than he pays you
const TRADE_PER_VISIT = 30;        // max units per good per visit
const TRADER_WAIT = 4;             // seconds the trader stays at each port

// Events (can be switched off in the game menu)
const FIRE_CHANCE = 1 / 25000;     // per building per tick
const FIRE_TICKS = 30;             // unattended fires destroy the building after this long
const STORM_CHANCE = 1 / 900;      // per tick
const STORM_TICKS = 60;
const MONUMENT_POP = 50;           // Adelige needed before the monument can be built

// Pirates: a fort on a small island sends out a raider that hunts loaded ships.
// Warships escort routes and fight; watchtowers guard the coast; destroying the fort ends the threat.
const PIRATE_RAID_EVERY = 150;     // ticks between raids (scaled by difficulty)
const PIRATE_SPEED = 2.5;
const PIRATE_HP = 60;              // raider ship
const FORT_HP = 250;
const FORT_REWARD = 1500;
const PLUNDER_SHARE = 0.35;        // part of the cargo the raider takes
const WARSHIP_HP = 100;
const WARSHIP_DAMAGE = 6;          // per tick against the raider or the fort
const WARSHIP_GUARD = 5;           // tiles within which a warship protects other ships
const FORT_DAMAGE = 2;             // per tick against each attacking warship
const TOWER_DAMAGE = 5;            // per tick against a raider within a watchtower's reach
const REPAIR_RATE = 3;             // hp per tick for a damaged ship lying near its own warehouse

// Rival trading house: settles free islands over time and trades with you
const RIVAL_NAME = 'Rødflag-kompagniet';
const RIVAL_COLOR = '#b8322a';
const RIVAL_STOCK_MAX = 80;        // goods the rival keeps for sale per island
const RIVAL_BUY_MAX = 60;          // most of one good the rival will buy per island
const RIVAL_PRODUCE = 0.25;        // units per tick of each good a rival island makes
const RIVAL_BUYOUT_BASE = 2500;    // price to buy a rival colony (plus per building)

// Taxes and happiness (per island)
const TAX_LEVELS = {
  low:    { name: 'Lav',    mult: 0.6, mood: 15 },
  normal: { name: 'Normal', mult: 1,   mood: 0 },
  high:   { name: 'Høj',    mult: 1.5, mood: -20 }
};
const MOOD_START = 60;

// Coins have uses beyond building: festivals and decorations lift the mood
const FESTIVAL_TICKS = 120;        // how long a festival lifts the mood
const FESTIVAL_COOLDOWN = 600;     // ticks before the island can hold another
const FESTIVAL_MOOD = 20;
const festivalCost = (isl) => ({ coins: 150 + 3 * Math.round(isl.pop) });

// Contracts: the trader (and the rival, when on good terms) ask for goods by a deadline, for a good price
const CONTRACT_EVERY = 360;        // ticks between new offers
const CONTRACT_MAX_OFFERS = 3;
const CONTRACT_TIME = 900;         // ticks to deliver after accepting
const CONTRACT_OFFER_TIME = 300;   // an offer disappears if not accepted in time

// Relations with the rival (0-100): trading and gifts improve them, buying their islands and failed
// contracts hurt. Bad relations: no trade and pirates paid to raid you. Good relations: better prices, contracts.
const RIVAL_RELATION_START = 50;
const RIVAL_GIFT = 300;            // coins per gift
const RIVAL_GIFT_RELATION = 10;
const RIVAL_PLAN_TICKS = 120;      // warning before the rival settles a discovered island

const UNDO_SECONDS = 15;           // a demolition can be undone this long

// What each resident consumes per second, by need
const NEED_RATES = { food: 0.02, meat: 0.008, cloth: 0.006, beer: 0.008, wine: 0.006, jewelry: 0.004 };
const NEED_INFO = {
  food:    { name: 'Mad',     icon: '🍽️', keys: FOOD_KEYS },
  meat:    { name: 'Kød',     icon: '🥩', keys: MEAT_KEYS },
  cloth:   { name: 'Tøj',     icon: '👕', keys: ['cloth'] },
  beer:    { name: 'Øl',      icon: '🍺', keys: ['beer'] },
  wine:    { name: 'Vin',     icon: '🍷', keys: ['wine'] },
  jewelry: { name: 'Smykker', icon: '💍', keys: ['jewelry'] }
};
// The level from which residents start wanting each need
const NEED_FROM = { food: 1, meat: 2, cloth: 2, beer: 3, wine: 4, jewelry: 4 };
const NEED_ORDER = ['meat', 'cloth', 'beer', 'wine', 'jewelry', 'food']; // meat is eaten as a need before general food

// House levels. A house upgrades when its needs are met, the next level's goods are in stock
// and the island can pay the upgrade materials. Unmet needs drop capacity to the level below.
// services: public buildings the house must be within reach of
const HOUSE_LEVELS = [
  null,
  { name: 'Pionerer', cap: 6,  tax: 0.016, needs: ['food'],                  services: ['market'],
    upgrade: { coins: 30, planks: 10, stone: 4 } },
  { name: 'Borgere',  cap: 12, tax: 0.05, needs: ['food', 'meat', 'cloth'], services: ['market', 'chapel'],
    upgrade: { coins: 120, planks: 15, bricks: 10, tools: 5 } },
  { name: 'Købmænd',  cap: 20, tax: 0.10, needs: ['food', 'meat', 'cloth', 'beer'], services: ['market', 'chapel', 'tavern'],
    upgrade: { coins: 300, planks: 20, bricks: 25, tools: 15 } },
  { name: 'Adelige',  cap: 30, tax: 0.18, needs: ['food', 'meat', 'cloth', 'beer', 'wine', 'jewelry'], services: ['market', 'chapel', 'tavern', 'theater'] }
];
const MAX_LEVEL = HOUSE_LEVELS.length - 1;

// Production buildings can be upgraded in place: more output (and input), one more worker, higher upkeep
const PROD_LEVELS = [
  null,
  { mult: 1,   upkeep: 1 },
  { mult: 1.5, upkeep: 1.4, tier: 2, cost: (d) => ({ coins: Math.round((d.cost.coins || 0) * 1.2) + 50, planks: 15, stone: 15 }) },
  { mult: 2,   upkeep: 1.8, tier: 3, cost: (d) => ({ coins: Math.round((d.cost.coins || 0) * 2) + 100, bricks: 15, tools: 8 }) }
];
const PROD_MAX_LEVEL = PROD_LEVELS.length - 1;
const prodLevel = (b) => (DEFS[b.type].produces && b.level) || 1;
const workersOf = (b) => (DEFS[b.type].workers || 0) + (DEFS[b.type].produces ? prodLevel(b) - 1 : 0);
// Balance: all building upkeep scaled up so coins don't just pile up (tuned with `npm run sim`)
const UPKEEP_FACTOR = 1.25;
const upkeepOf = (b) => (DEFS[b.type].upkeep || 0) * UPKEEP_FACTOR * PROD_LEVELS[prodLevel(b)].upkeep;

// workers: residents needed to run it · upkeep: coins/s · tier: house level needed to unlock
const DEFS = {
  house: { id: 'house', name: 'Bolig', w: 2, h: 2, cost: { coins: 30, planks: 10 }, house: true, needsRoad: true,
    desc: 'Bolig for 6 pionerer. De første 4 beboere på en ø klarer sig uden mad; resten skal have fisk eller kød. Opgraderes til Borgere (12), Købmænd (20) og Adelige (30).' },
  woodcutter: { id: 'woodcutter', name: 'Skovhugger', w: 2, h: 2, cost: { coins: 30, planks: 10 }, workers: 2, upkeep: 0.04,
    produces: 'wood', rate: 0.8, near: { terrain: 'forest', label: 'skov' },
    harvest: { terrain: 'forest', key: 'wood', radius: 4, label: 'træer' },
    desc: 'Fælder træerne omkring sig – skoven forsvinder efterhånden. Byg en skovfoged for at plante nye.' },
  forester: { id: 'forester', name: 'Skovfoged', w: 2, h: 2, cost: { coins: 40, planks: 10 }, workers: 1, upkeep: 0.03,
    desc: 'Planter og plejer træer inden for 5 felter – også på fri græsjord. Én skovfoged holder cirka én skovhugger i gang.' },
  sawmill: { id: 'sawmill', name: 'Savværk', w: 3, h: 2, cost: { coins: 50, planks: 20 }, workers: 3, upkeep: 0.06,
    consumes: { wood: 0.8 }, produces: 'planks', rate: 0.8,
    desc: 'Saver træ til planker. Kræver vej til et lager.' },
  stonecutter: { id: 'stonecutter', name: 'Stenhugger', w: 2, h: 2, cost: { coins: 60, planks: 20 }, workers: 3, upkeep: 0.06,
    produces: 'stone', rate: 0.5, near: { terrain: 'rock', label: 'klipper' },
    harvest: { terrain: 'rock', key: 'stone', radius: 4, label: 'sten' },
    desc: 'Hugger sten af klipperne omkring sig. Sten kommer aldrig igen – klipperne skrumper og forsvinder.' },
  fisher: { id: 'fisher', name: 'Fisker', w: 2, h: 2, cost: { coins: 30, planks: 10 }, workers: 2, upkeep: 0.03,
    produces: 'fish', rate: 0.6, coastal: true, food: true, near: { terrain: 'water', label: 'vand', min: 8, radius: 3 },
    desc: 'Fanger fisk. Skal ligge ved kysten og have vej til et lager.' },
  grainfarm: { id: 'grainfarm', name: 'Kornfarm', w: 3, h: 3, cost: { coins: 40, planks: 15 }, workers: 3, upkeep: 0.04,
    produces: 'grain', rate: 0.6, fertility: 'grain', food: true,
    desc: 'Dyrker korn til dyrefoder og øl. Kræver en ø med kornfrugtbarhed.' },
  pigfarm: { id: 'pigfarm', name: 'Svinefarm', w: 2, h: 2, cost: { coins: 50, planks: 15, stone: 5 }, workers: 2, upkeep: 0.05,
    consumes: { grain: 0.4 }, produces: 'pork', rate: 0.4, food: true,
    desc: 'Fodrer grise med korn og giver svinekød.' },
  sheepfarm: { id: 'sheepfarm', name: 'Fårefarm', w: 2, h: 2, cost: { coins: 40, planks: 15 }, workers: 2, upkeep: 0.04,
    produces: 'wool', rate: 0.5, fertility: 'sheep',
    desc: 'Klipper får og giver uld. Kræver en ø med får.' },
  weaver: { id: 'weaver', name: 'Væver', w: 2, h: 2, cost: { coins: 80, planks: 20, stone: 10 }, workers: 3, upkeep: 0.08,
    consumes: { wool: 0.5 }, produces: 'cloth', rate: 0.5,
    desc: 'Væver uld til tøj, som Borgere og Købmænd skal bruge.' },
  cattlefarm: { id: 'cattlefarm', name: 'Kvægfarm', w: 3, h: 3, cost: { coins: 120, planks: 30, stone: 15 }, workers: 4, upkeep: 0.1, tier: 2,
    consumes: { grain: 0.4 }, produces: 'beef', rate: 0.6, food: true,
    desc: 'Fodrer køer med korn. Mere effektiv end svin, men dyrere.' },
  hopfarm: { id: 'hopfarm', name: 'Humlefarm', w: 3, h: 3, cost: { coins: 80, planks: 20 }, workers: 3, upkeep: 0.06, tier: 2,
    produces: 'hops', rate: 0.5, fertility: 'hops',
    desc: 'Dyrker humle til øl. Kræver en ø med humlefrugtbarhed.' },
  brewery: { id: 'brewery', name: 'Bryggeri', w: 2, h: 2, cost: { coins: 150, planks: 30, stone: 25 }, workers: 4, upkeep: 0.12, tier: 2,
    consumes: { grain: 0.3, hops: 0.3 }, produces: 'beer', rate: 0.5,
    desc: 'Brygger øl af korn og humle. Købmænd skal have øl.' },
  claypit: { id: 'claypit', name: 'Lergrav', w: 2, h: 2, cost: { coins: 60, planks: 15 }, workers: 2, upkeep: 0.04, tier: 2,
    produces: 'clay', rate: 0.5, near: { terrain: 'beach', label: 'strand', min: 3, radius: 3 },
    desc: 'Graver ler ved kysten. Skal have strand i nærheden.' },
  brickworks: { id: 'brickworks', name: 'Teglværk', w: 2, h: 2, cost: { coins: 120, planks: 25, stone: 15 }, workers: 3, upkeep: 0.08, tier: 2,
    consumes: { clay: 0.5 }, produces: 'bricks', rate: 0.5,
    desc: 'Brænder ler til mursten, som Købmændenes huse og store bygninger skal bruge.' },
  charcoal: { id: 'charcoal', name: 'Kulmile', w: 2, h: 2, cost: { coins: 60, planks: 15 }, workers: 2, upkeep: 0.05, tier: 2,
    consumes: { wood: 0.6 }, produces: 'coal', rate: 0.4,
    desc: 'Brænder træ til trækul til smedjen.' },
  mine: { id: 'mine', name: 'Jernmine', w: 2, h: 2, cost: { coins: 150, planks: 30, stone: 20 }, workers: 4, upkeep: 0.1, tier: 2,
    produces: 'ore', rate: 0.4, near: { key: 'ore', label: 'jernmalm', min: 1, radius: 3 },
    harvest: { terrain: 'rock', key: 'ore', radius: 3, label: 'jernmalm' },
    desc: 'Bryder jernmalm i klipper med malmårer (kun på nogle øer). Malmen slipper op.' },
  smithy: { id: 'smithy', name: 'Smedje', w: 2, h: 2, cost: { coins: 200, planks: 30, stone: 30, bricks: 10 }, workers: 4, upkeep: 0.12, tier: 2,
    consumes: { ore: 0.3, coal: 0.3 }, produces: 'tools', rate: 0.3,
    desc: 'Smeder værktøj af jernmalm og kul.' },
  marketplace: { id: 'marketplace', name: 'Markedsplads', w: 3, h: 3, cost: { coins: 60, planks: 15 }, upkeep: 0.05,
    service: 'market', radius: 10,
    desc: 'Alle boliger skal ligge inden for rækkevidde af et marked for at få varer. Lageret virker selv som et lille marked.' },
  chapel: { id: 'chapel', name: 'Kapel', w: 2, h: 2, cost: { coins: 120, planks: 20, stone: 20 }, workers: 1, upkeep: 0.08,
    service: 'chapel', radius: 10,
    desc: 'Borgere og Købmænd skal bo inden for rækkevidde af et kapel.' },
  tavern: { id: 'tavern', name: 'Kro', w: 2, h: 2, cost: { coins: 150, planks: 25, stone: 15 }, workers: 2, upkeep: 0.1, tier: 2,
    service: 'tavern', radius: 10,
    desc: 'Købmænd skal bo inden for rækkevidde af en kro.' },
  firestation: { id: 'firestation', name: 'Brandstation', w: 2, h: 2, cost: { coins: 80, planks: 15, stone: 10 }, workers: 2, upkeep: 0.06,
    service: 'fire', radius: 9,
    desc: 'Slukker brande inden for rækkevidde, før de når at ødelægge bygninger.' },
  theater: { id: 'theater', name: 'Teater', w: 3, h: 3, cost: { coins: 400, planks: 40, stone: 40, bricks: 30 }, workers: 3, upkeep: 0.2, tier: 3,
    service: 'theater', radius: 12,
    desc: 'Adelige skal bo inden for rækkevidde af et teater.' },
  vineyard: { id: 'vineyard', name: 'Vingård', w: 3, h: 3, cost: { coins: 150, planks: 30, stone: 10 }, workers: 3, upkeep: 0.08, tier: 3,
    produces: 'grapes', rate: 0.5, fertility: 'grapes',
    desc: 'Dyrker vindruer. Kræver en ø med vindruer 🍇 – findes kun på nogle fjerne øer.' },
  winery: { id: 'winery', name: 'Vinpresse', w: 2, h: 2, cost: { coins: 200, planks: 30, stone: 20, bricks: 15 }, workers: 3, upkeep: 0.12, tier: 3,
    consumes: { grapes: 0.5 }, produces: 'wine', rate: 0.5,
    desc: 'Presser vindruer til vin, som Adelige skal have.' },
  goldmine: { id: 'goldmine', name: 'Guldmine', w: 2, h: 2, cost: { coins: 250, planks: 30, stone: 30, tools: 10 }, workers: 4, upkeep: 0.15, tier: 3,
    produces: 'gold', rate: 0.3, near: { key: 'gold', label: 'guldårer', min: 1, radius: 3 },
    harvest: { terrain: 'rock', key: 'gold', radius: 3, label: 'guld' },
    desc: 'Bryder guld i klipper med guldårer (kun på én fjern ø). Guldet slipper op.' },
  goldsmith: { id: 'goldsmith', name: 'Guldsmed', w: 2, h: 2, cost: { coins: 300, planks: 20, stone: 30, bricks: 20 }, workers: 3, upkeep: 0.15, tier: 3,
    consumes: { gold: 0.3, coal: 0.3 }, produces: 'jewelry', rate: 0.3,
    desc: 'Smeder smykker af guld og kul. Adelige skal have smykker.' },
  watchtower: { id: 'watchtower', name: 'Vagttårn', w: 1, h: 1, cost: { coins: 150, planks: 15, stone: 30 }, workers: 2, upkeep: 0.08,
    coastal: true, guard: 8,
    desc: 'Skyder på pirater inden for 8 felter og beskytter skibe i nærheden. Skal stå ved vandet.' },
  monument: { id: 'monument', name: 'Monument', w: 4, h: 4, cost: { coins: 6000, planks: 100, stone: 150, bricks: 150, tools: 80, jewelry: 40 }, tier: 4,
    desc: `Rigets store monument – spillets endemål. Kræver ${MONUMENT_POP} Adelige i alt.` },
  shipyard: { id: 'shipyard', name: 'Skibsbygger', w: 3, h: 3, cost: { coins: 150, planks: 40, stone: 20 }, workers: 5, upkeep: 0.1,
    coastal: true, needsRoad: true,
    desc: 'Bygger skibe. Skal ligge ved havet og have vej til et lager. Klik på den for at bygge skibe.' },
  // Decorations: houses within reach get happier (the best one in reach counts, they don't stack)
  park: { id: 'park', name: 'Park', w: 2, h: 2, cost: { coins: 150, planks: 5 }, upkeep: 0.04, beauty: { radius: 6, bonus: 8 },
    desc: 'Træer, bænke og blomster. Beboere inden for 6 felter bliver gladere (+8 tilfredshed).' },
  fountain: { id: 'fountain', name: 'Springvand', w: 1, h: 1, cost: { coins: 300, stone: 10 }, upkeep: 0.05, tier: 2, beauty: { radius: 5, bonus: 12 },
    desc: 'Et springvand på pladsen. Beboere inden for 5 felter bliver gladere (+12 tilfredshed).' },
  statue: { id: 'statue', name: 'Statue', w: 2, h: 2, cost: { coins: 900, stone: 20, bricks: 10 }, upkeep: 0.1, tier: 3, beauty: { radius: 8, bonus: 18 },
    desc: 'En statue af øens grundlægger. Beboere inden for 8 felter bliver gladere (+18 tilfredshed).' },
  warehouse: { id: 'warehouse', name: 'Lager', w: 2, h: 2, cost: {}, storage: WAREHOUSE_CAP, upkeep: 0.05,
    desc: 'Lageret samler varer for hele øen. Første lager på en ny ø skal ligge ved havet, og skibet har 30 planker og 20 fisk med som startforsyning.' },
  road: { id: 'road', name: 'Vej', w: 1, h: 1, cost: {},
    desc: 'Forbinder bygninger med lageret. Træk for at bygge. Gennem skov fældes træerne; over en kanal bliver det en bro.' },
  canal: { id: 'canal', name: 'Kanal', w: 1, h: 1, cost: { coins: 5, planks: 1, stone: 2 },
    desc: 'Graver en vandvej for skibe. Skal starte ved vand. Kan dele en ø i to – byg en bro med vej-værktøjet.' }
};

// Ship types: bigger ships are unlocked by house level and sail further with more cargo
const SHIP_TYPES = {
  jolle:   { id: 'jolle',   name: 'Jolle',   cost: { coins: 60, planks: 15 },              cargo: 20,  range: 65,  speed: 2.2, buildTime: 15, tier: 1, upkeep: 0.05, size: 0.8 },
  kogge:   { id: 'kogge',   name: 'Kogge',   cost: { coins: 200, planks: 50, stone: 15 },  cargo: 60,  range: 130,  speed: 2.0, buildTime: 30, tier: 2, upkeep: 0.15, size: 1.1 },
  karavel: { id: 'karavel', name: 'Karavel', cost: { coins: 500, planks: 100, stone: 40, tools: 20 }, cargo: 150, range: 260, speed: 2.6, buildTime: 45, tier: 3, upkeep: 0.3,  size: 1.4 },
  fregat:  { id: 'fregat',  name: 'Fregat',  cost: { coins: 400, planks: 60, stone: 20, tools: 10 }, cargo: 0, range: 260, speed: 2.9, buildTime: 35, tier: 2, upkeep: 0.25, size: 1.25,
             warship: true, hp: WARSHIP_HP }
};
const isWarship = (s) => !!SHIP_TYPES[s.type]?.warship;
const tierName = (t) => HOUSE_LEVELS[t].name;

// Tools that aren't buildings
const TOOLS = {
  demolish: { id: 'demolish', name: 'Riv ned', desc: 'Fjerner veje, broer og bygninger (50% af materialerne retur). På en kanal fyldes den op igen.' }
};
const itemInfo = (id) => DEFS[id] || TOOLS[id];

// Build menu grouping
const CATEGORIES = [
  { id: 'terrain', name: 'Terræn', icon: '🛤️', items: ['road', 'canal', 'demolish'] },
  { id: 'housing', name: 'Boliger', icon: '🏠', items: ['house'] },
  { id: 'public', name: 'Offentligt', icon: '🏪', items: ['marketplace', 'chapel', 'tavern', 'firestation', 'theater', 'monument'] },
  { id: 'decor', name: 'Pynt', icon: '🌳', items: ['park', 'fountain', 'statue'] },
  { id: 'production', name: 'Produktion', icon: '🪵', items: ['woodcutter', 'forester', 'sawmill', 'stonecutter', 'sheepfarm', 'weaver'] },
  { id: 'industry', name: 'Industri', icon: '⚒️', items: ['claypit', 'brickworks', 'charcoal', 'mine', 'smithy', 'goldmine', 'goldsmith'] },
  { id: 'food', name: 'Mad & drikke', icon: '🌾', items: ['fisher', 'grainfarm', 'pigfarm', 'cattlefarm', 'hopfarm', 'brewery', 'vineyard', 'winery'] },
  { id: 'harbor', name: 'Lager & havn', icon: '⚓', items: ['warehouse', 'shipyard', 'watchtower'] }
];

// Buildings that only work when connected to a warehouse by road
const needsRoad = (def) => !!(def.produces || def.consumes || def.needsRoad);
const isLandType = (type) => type === 'grass' || type === 'beach';

const ISO = {
  TW: 64,
  TH: 32,
  // Accepts fractional tile coords; integer coords give the tile centre
  tileToScreen: (tx, ty) => ({
    x: (tx - ty) * 32,
    y: (tx + ty) * 16
  }),
  screenToTile: (sx, sy) => ({
    tx: Math.round((sx / 32 + sy / 16) / 2),
    ty: Math.round((sy / 16 - sx / 32) / 2)
  })
};
