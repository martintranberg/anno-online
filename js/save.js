'use strict';

// ===== SAVE / LOAD =====
// The game autosaves to localStorage after every action, every 10 s and when the page closes.
// The map is stored as one character per tile; decoration is regenerated from NOISE_SEED.
const SAVE_KEY = 'anno-online-save';
const SAVE_VERSION = 4;
const AUTOSAVE_TICKS = 10;
const TYPE_CODES = { grass: 'g', forest: 'f', water: 'w', beach: 'b', rock: 'r' };
const CODE_TYPES = Object.fromEntries(Object.entries(TYPE_CODES).map(([t, c]) => [c, t]));
let lastSavedAt = null;
let saveDisabled = false; // set when starting a new game, so the unload handler doesn't re-save
let oldSaveIgnored = false;
const pendingNotices = []; // messages from loading, shown once the UI is up
let migratedFrom = null;
const validMapSize = (n) => Object.values(MAP_SIZES).some(s => s.size === n);

function saveGame(manual = false) {
  if (saveDisabled || !GAME.grid.length) return false;
  const data = {
    v: SAVE_VERSION,
    mapSize: MAP_SIZE,
    settings: GAME.settings,
    noiseSeed: NOISE_SEED,
    // Extra codes: c = canal, s = clearing with stumps, q = worked-out quarry
    terrain: GAME.grid.map(t => t.canal ? 'c' : t.stumps ? 's' : t.quarried ? 'q' : TYPE_CODES[t.type]).join(''),
    seen: encodeSeen(),
    // Only tiles that differ from "full" are stored: [tile index, amount]
    wood: GAME.grid.flatMap((t, i) => t.type === 'forest' && t.wood < t.woodMax ? [[i, t.wood]] : []),
    stone: GAME.grid.flatMap((t, i) => t.type === 'rock' && t.stone < ROCK_STONE ? [[i, t.stone]] : []),
    buildings: GAME.buildings.map(({ id, type, x, y, queue, level, paused, lockLevel, fire }) => ({ id, type, x, y, queue, level, paused, lockLevel, fire })),
    roads: [...GAME.roads],
    // Islands are matched on load by their anchor tile, since ids come from re-labelling the map
    islands: [...GAME.islands.values()].map(i => ({ anchor: i.anchor, name: i.name, home: i.home, start: i.start,
                                                     resources: i.resources, pop: i.pop, fertility: i.fertility, supplied: i.supplied,
                                                     ore: i.ore, gold: i.gold, trade: i.trade, allowUpgrade: i.allowUpgrade,
                                                     owner: i.owner, pirate: i.pirate, mood: i.mood, tax: i.tax })),
    ore: GAME.grid.flatMap((t, i) => t.ore > 0 ? [[i, t.ore]] : []),
    gold: GAME.grid.flatMap((t, i) => t.gold > 0 ? [[i, t.gold]] : []),
    oreAssigned: true,
    goldAssigned: true,
    pirates: GAME.pirates && { fort: GAME.pirates.fort, fortHp: GAME.pirates.fortHp, nextRaid: GAME.pirates.nextRaid },
    rival: GAME.rival && { buildings: GAME.rival.buildings, counter: GAME.rival.counter, next: GAME.rival.next, growIn: GAME.rival.growIn },
    bankrupt: GAME.bankrupt,
    events: GAME.events,
    won: GAME.won,
    history: GAME.history,
    ships: GAME.ships.map(({ id, type, name, x, y, dir, routeId, cargo, state, trips, hp }) => ({ id, type, name, x, y, dir, routeId, cargo, state, trips, hp })),
    shipCounter: GAME.shipCounter,
    routes: GAME.routes.map(({ id, from, to, waypoints, res, back, keepRes, keepBack }) => ({ id, from, to, waypoints, res, back, keepRes, keepBack })),
    routeCounter: GAME.routeCounter,
    coins: GAME.coins,
    tierReached: GAME.tierReached,
    questId: QUESTS[GAME.questIndex]?.id || 'done',
    tick: GAME.tick,
    phase: GAME.phase,
    camera: GAME.camera,
    savedAt: Date.now()
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    lastSavedAt = new Date(data.savedAt);
    if (manual) showToast('💾 Spillet er gemt');
    return true;
  } catch (err) {
    if (manual) showToast('⚠ Kunne ikke gemme i denne browser');
    log(`Kunne ikke gemme: ${err.message}`, 'err');
    return false;
  }
}

function initIslands(pirateSpot) {
  GAME.islands = new Map();
  for (const c of labelIslands()) GAME.islands.set(c.id, newIsland(c));
  // The biggest island is the start island; it gets grain only (see assignFertility)
  const start = [...GAME.islands.values()].sort((a, b) => b.size - a.size)[0];
  start.start = true;
  const pirateIsl = pirateSpot && GAME.islands.get(tileAt(pirateSpot.x, pirateSpot.y)?.island);
  if (pirateIsl) pirateIsl.pirate = true;
  assignFertility(start.id);
  assignOre(start.id);
  assignGold(start.id);
  updateIslandStats();
  initPirates(pirateSpot);
}

// Version 2 saves (before house levels and coins): borgerhus -> level 2 house, pioneer huts are dropped
function migrateV2(data) {
  data.buildings = data.buildings.flatMap(b => {
    if (b.type === 'house_medium') return [{ ...b, type: 'house', level: 2 }];
    if (b.type === 'house_small') return [];
    return [b];
  });
  data.coins = START_COINS;
  data.tierReached = data.buildings.some(b => b.level === 2) ? 2 : 1;
  data.questIndex = 0;
  data.needsFertility = true;
  return data;
}

// Restores GAME from localStorage. Returns false (and leaves GAME untouched) if there's no usable save.
function loadGame() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(SAVE_KEY));
  } catch {
    return false;
  }
  if (data && data.v === 2) { data = migrateV2(data); migratedFrom = 2; }
  else if (data && data.v === 3) migratedFrom = 3;
  else if (data && data.v !== SAVE_VERSION) oldSaveIgnored = true;
  if (!data || (data.v !== SAVE_VERSION && !migratedFrom) || !validMapSize(data.mapSize) ||
      typeof data.terrain !== 'string' || data.terrain.length !== data.mapSize * data.mapSize) {
    return false;
  }

  MAP_SIZE = data.mapSize;
  const sizeKey = Object.keys(MAP_SIZES).find(k => MAP_SIZES[k].size === MAP_SIZE);
  GAME.settings = { ...DEFAULT_SETTINGS, size: sizeKey, ...(data.settings || {}) };
  NOISE_SEED = data.noiseSeed;
  GAME.grid = [...data.terrain].map((c, i) => ({
    x: i % MAP_SIZE, y: Math.floor(i / MAP_SIZE),
    type: c === 'c' ? 'water' : (c === 's' || c === 'q') ? 'grass' : (CODE_TYPES[c] || 'grass'),
    canal: c === 'c', stumps: c === 's', quarried: c === 'q'
  }));
  // Depleted forests and quarries (older saves have none, so everything starts full)
  for (const [i, amt] of data.wood || []) GAME.grid[i].wood = amt;
  for (const [i, amt] of data.stone || []) GAME.grid[i].stone = amt;
  for (const [i, amt] of data.ore || []) GAME.grid[i].ore = amt;
  for (const [i, amt] of data.gold || []) GAME.grid[i].gold = amt;
  // Saves from before the fog of war know the whole map
  GAME.seen = data.seen ? decodeSeen(data.seen) : new Uint8Array(MAP_SIZE * MAP_SIZE).fill(1);
  GAME.buildings = data.buildings.filter(b => DEFS[b.type]);
  GAME.roads = new Set(data.roads);
  GAME.occupancy.clear();
  for (const key of GAME.roads) GAME.occupancy.set(key, 'road');
  for (const b of GAME.buildings) {
    const def = DEFS[b.type];
    if (def.house) b.level = b.level || 1;
    for (let dy = 0; dy < def.h; dy++) {
      for (let dx = 0; dx < def.w; dx++) GAME.occupancy.set(`${b.x + dx},${b.y + dy}`, b.id);
    }
  }

  GAME.islands = new Map();
  for (const c of labelIslands()) {
    const saved = data.islands.find(i => tileAt(i.anchor[0], i.anchor[1])?.island === c.id);
    const isl = newIsland(c);
    if (saved) {
      Object.assign(isl, { name: saved.name, home: saved.home, start: saved.start, pop: saved.pop, fertility: saved.fertility || [], supplied: saved.supplied,
                           ore: saved.ore, gold: saved.gold, trade: saved.trade, allowUpgrade: saved.allowUpgrade,
                           owner: saved.owner || null, pirate: saved.pirate, mood: saved.mood ?? MOOD_START, tax: saved.tax || 'normal' });
      Object.assign(isl.resources, saved.resources); // merge: resources added later keep 0
    }
    GAME.islands.set(c.id, isl);
  }
  // Islands with any explored tile count as discovered
  GAME.grid.forEach((t, i) => { if (GAME.seen[i] && t.island) GAME.islands.get(t.island).discovered = true; });
  if (data.needsFertility) {
    const home = homeIsland() || [...GAME.islands.values()].sort((a, b) => b.size - a.size)[0];
    home.start = true;
    assignFertility(home.id);
  }
  const startIsl = [...GAME.islands.values()].find(i => i.start) || homeIsland() || [...GAME.islands.values()].sort((a, b) => b.size - a.size)[0];
  // Saves from before iron ore / gold get their veins now
  if (!data.oreAssigned) assignOre(startIsl.id);
  if (!data.goldAssigned) assignGold(startIsl.id);
  ensureGrapes();
  updateIslandStats();
  // Colonies founded before founding supplies existed get them delivered once
  for (const isl of GAME.islands.values()) {
    if (!isl.home && isl.warehouses && !isl.supplied && isl.owner !== 'rival') {
      const got = deliverSupplies(homeIsland(), isl);
      pendingNotices.push(`⚓ ${isl.name} har fået en startforsyning: ${fmtCost(got)}`);
    }
  }

  GAME.routes = (data.routes || []).map(r => ({ keepRes: {}, keepBack: {}, ...r, length: 0 }));
  GAME.events = data.events ?? true;
  GAME.won = !!data.won;
  GAME.bankrupt = !!data.bankrupt;
  GAME.history = data.history || [];
  GAME.routeCounter = data.routeCounter || GAME.routes.length;
  GAME.ships = (data.ships || []).filter(s => SHIP_TYPES[s.type]).map(s => {
    const ship = { ...s, cargo: { ...emptyStock(), ...s.cargo }, path: [], timer: 0, routeId: s.routeId || null };
    if (SHIP_TYPES[s.type].warship) ship.hp = s.hp ?? SHIP_TYPES[s.type].hp;
    if (s.route) {
      GAME.routeCounter++;
      const r = { id: `r_${GAME.routeCounter}`, from: s.route.from, to: s.route.to, waypoints: [], res: s.route.res || [], back: s.route.back || [], length: 0 };
      GAME.routes.push(r);
      ship.routeId = r.id;
      delete ship.route;
    }
    return ship;
  });
  GAME.shipCounter = data.shipCounter || GAME.ships.length;
  GAME.coins = data.coins ?? START_COINS;
  GAME.tierReached = data.tierReached || 1;
  GAME.questIndex = data.questId ? (data.questId === 'done' ? QUESTS.length : questIndexOf(data.questId))
    : questIndexOf(OLD_QUEST_IDS[Math.min(data.questIndex || 0, OLD_QUEST_IDS.length - 1)] || 'fisher');
  Object.assign(GAME.camera, data.camera);
  GAME.tick = data.tick || 0;
  GAME.phase = data.phase === 'play' ? 'play' : 'setup';

  // Pirates and the rival: restored, or (older saves) created now
  if (data.pirates) {
    GAME.pirates = { ...data.pirates, ship: null };
    const pi = GAME.islands.get(tileAt(GAME.pirates.fort.x, GAME.pirates.fort.y)?.island);
    if (pi && GAME.pirates.fortHp > 0) pi.pirate = true;
  } else if (!data.v || data.v < 4) {
    initPirates(null);
    if (GAME.pirates) pendingNotices.push('🏴‍☠️ Pirater har slået sig ned på en ø. Byg fregatter og vagttårne for at beskytte dine skibe.');
  }
  if (data.rival) {
    GAME.rival = { ...data.rival, ship: null };
    for (const b of GAME.rival.buildings) {
      const def = DEFS[b.type];
      for (let dy = 0; dy < def.h; dy++) for (let dx = 0; dx < def.w; dx++) GAME.occupancy.set(`${b.x + dx},${b.y + dy}`, b.id);
    }
  } else if (GAME.phase === 'play' && GAME.settings.rival && migratedFrom) {
    initRival();
    pendingNotices.push(`⚑ ${RIVAL_NAME} er ankommet og konkurrerer nu om øerne.`);
  }
  lastSavedAt = new Date(data.savedAt);
  return true;
}

// Ships resume their route after loading (paths aren't saved)
function resumeShips() {
  for (const s of GAME.ships) {
    if (s.state === 'autoExplore') { autoExplore(s); continue; }
    if (s.state === 'attacking') { if (attackFort(s)) s.state = 'idle'; continue; }
    const r = shipRoute(s);
    const from = r && buildingById(r.from), to = r && buildingById(r.to);
    if (!from || !to) { stopRoute(s); continue; }
    if (s.state === 'loading' || s.state === 'unloading') s.timer = 1;
    else if (s.state === 'toTo') sailTo(s, to, 'toTo', r.waypoints);
    else sailTo(s, from, 'toFrom', [...r.waypoints].reverse());
  }
}

function newGame() {
  openNewGameDialog(true);
}

// ----- New game dialog -----
const NEWGAME_KEY = 'anno-online-newgame';
let gameStarted = false;
const ngChoice = { ...DEFAULT_SETTINGS };

function openNewGameDialog(canCancel) {
  const el = document.getElementById('newgame');
  Object.assign(ngChoice, GAME.settings);
  const opts = (key, table) => Object.entries(table).map(([k, o]) =>
    `<button data-ng="${key}" data-val="${k}" class="${ngChoice[key] === k ? 'active' : ''}">${o.name}${o.size ? ` <small>${o.size}×${o.size}</small>` : ''}</button>`).join('');
  el.querySelector('.ng-body').innerHTML = `
    <div class="ng-row"><span>Kortstørrelse</span><div class="ng-opts">${opts('size', MAP_SIZES)}</div></div>
    <div class="ng-row"><span>Antal øer</span><div class="ng-opts">${opts('islands', ISLAND_AMOUNTS)}</div></div>
    <div class="ng-row"><span>Sværhedsgrad</span><div class="ng-opts">${opts('difficulty', DIFFICULTIES)}</div></div>
    <p class="ng-hint" id="ng-hint"></p>
    <label class="ng-check"><input type="checkbox" id="ng-rival" ${ngChoice.rival ? 'checked' : ''}> ⚑ ${RIVAL_NAME} konkurrerer om øerne</label>
    <label class="ng-check"><input type="checkbox" id="ng-events" ${ngChoice.events ? 'checked' : ''}> 🔥 Begivenheder: brand, storm og pirater</label>`;
  const hint = () => {
    const d = DIFFICULTIES[ngChoice.difficulty];
    document.getElementById('ng-hint').textContent =
      `${d.coins} mønter at starte med · ${d.events < 1 ? 'færre' : d.events > 1 ? 'flere' : 'normale'} brande og storme · rivalen tager op til ${d.rivalMax} øer`;
  };
  hint();
  el.querySelectorAll('[data-ng]').forEach(b => b.addEventListener('click', () => {
    ngChoice[b.dataset.ng] = b.dataset.val;
    el.querySelectorAll(`[data-ng="${b.dataset.ng}"]`).forEach(o => o.classList.toggle('active', o === b));
    hint();
  }));
  document.getElementById('ng-cancel').hidden = !canCancel;
  el.hidden = false;
}

document.getElementById('ng-cancel').addEventListener('click', () => { document.getElementById('newgame').hidden = true; });
document.getElementById('ng-start').addEventListener('click', () => {
  ngChoice.rival = document.getElementById('ng-rival').checked;
  ngChoice.events = document.getElementById('ng-events').checked;
  document.getElementById('newgame').hidden = true;
  sfx('click');
  if (!gameStarted) { startNewGame({ ...ngChoice }); return; }
  if (!confirm('Starte et nyt spil? Dit nuværende spil bliver slettet (gem det i en plads først, hvis du vil beholde det).')) return;
  saveDisabled = true;
  try {
    localStorage.removeItem(SAVE_KEY);
    localStorage.setItem(NEWGAME_KEY, JSON.stringify(ngChoice));
  } catch { /* storage unavailable: the reload just shows the dialog again */ }
  location.reload();
});

// Generates a fresh map from the chosen settings and enters the setup phase
function startNewGame(settings) {
  GAME.settings = { ...DEFAULT_SETTINGS, ...settings };
  MAP_SIZE = MAP_SIZES[GAME.settings.size]?.size || 128;
  GAME.events = GAME.settings.events;
  log('Generating terrain...', 'ok');
  const gen = generateTerrain(MAP_SIZE, MAP_SIZE, ISLAND_AMOUNTS[GAME.settings.islands]?.f || 1);
  GAME.grid = gen.grid;
  initIslands(gen.pirate);
  initFog();
  GAME.coins = diff().coins;
  centerOn(MAP_SIZE / 2, MAP_SIZE / 2);
  finishInit(false);
}

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function setSpeed(s) {
  GAME.speed = s;
  document.querySelectorAll('#speed button').forEach(b => b.classList.toggle('active', Number(b.dataset.speed) === s));
}

const gameMenu = document.getElementById('game-menu');
document.getElementById('btn-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  gameMenu.hidden = !gameMenu.hidden;
  if (!gameMenu.hidden) renderSlots();
});

// ----- Save slots, export / import -----
const SLOT_KEY = (n) => `anno-online-slot-${n}`;
function slotInfo(n) {
  try {
    const d = JSON.parse(localStorage.getItem(SLOT_KEY(n)));
    return d ? new Date(d.savedAt).toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' }) : null;
  } catch { return null; }
}
function renderSlots() {
  document.getElementById('save-slots').innerHTML = [1, 2, 3].map(n => {
    const info = slotInfo(n);
    return `<div class="slot"><span>Plads ${n}<small>${info || 'tom'}</small></span>
      <button data-slot-save="${n}">Gem</button><button data-slot-load="${n}" ${info ? '' : 'disabled'}>Indlæs</button></div>`;
  }).join('');
  document.querySelectorAll('[data-slot-save]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!saveGame()) return;
    localStorage.setItem(SLOT_KEY(b.dataset.slotSave), localStorage.getItem(SAVE_KEY));
    showToast(`💾 Gemt i plads ${b.dataset.slotSave}`);
    renderSlots();
  }));
  document.querySelectorAll('[data-slot-load]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm(`Indlæse plads ${b.dataset.slotLoad}? Dit nuværende spil erstattes (gem det først, hvis du vil beholde det).`)) return;
    loadSaveString(localStorage.getItem(SLOT_KEY(b.dataset.slotLoad)));
  }));
}
// Replaces the autosave with the given save and restarts the page with it
function loadSaveString(str) {
  try {
    const d = JSON.parse(str);
    if (!d || !d.terrain || !validMapSize(d.mapSize)) throw new Error('ugyldig');
  } catch {
    showToast('⚠ Filen er ikke et gyldigt gemt spil');
    return;
  }
  saveDisabled = true;
  localStorage.setItem(SAVE_KEY, str);
  location.reload();
}
document.getElementById('btn-export').addEventListener('click', () => {
  saveGame();
  const blob = new Blob([localStorage.getItem(SAVE_KEY)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `anno-gem-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
document.getElementById('import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('Indlæse spillet fra filen? Dit nuværende spil erstattes.')) return;
  file.text().then(loadSaveString);
});
const optEvents = document.getElementById('opt-events');
optEvents.addEventListener('change', () => {
  GAME.events = optEvents.checked;
  if (!GAME.events) GAME.storm = 0;
  saveGame();
});

function showVictory() {
  GAME.won = true;
  const merchants = Math.floor(totalMerchants());
  document.getElementById('victory-stats').innerHTML =
    `👥 ${totalPopulation()} beboere · ${merchants} Købmænd · ${Math.floor(totalNobles())} Adelige<br>🏝️ ${[...GAME.islands.values()].filter(i => i.warehouses).length} øer · ⛵ ${GAME.ships.length} skibe<br>⏱️ ${Math.floor(GAME.tick / 60)} minutter`;
  document.getElementById('victory').hidden = false;
  saveGame();
}
document.getElementById('victory-close').addEventListener('click', () => { document.getElementById('victory').hidden = true; });
document.addEventListener('click', (e) => { if (!gameMenu.contains(e.target)) gameMenu.hidden = true; });
document.getElementById('btn-save').addEventListener('click', () => { saveGame(true); gameMenu.hidden = true; });
document.getElementById('btn-new').addEventListener('click', () => { gameMenu.hidden = true; newGame(); });
document.getElementById('btn-islands').addEventListener('click', () => {
  if (GAME.selectedInfo?.kind === 'islands') closeInfo(); else openInfo('islands');
});
document.getElementById('btn-routes').addEventListener('click', () => {
  if (GAME.selectedInfo?.kind === 'routes') closeInfo(); else openInfo('routes');
});
document.getElementById('btn-economy').addEventListener('click', () => {
  if (GAME.selectedInfo?.kind === 'economy') closeInfo(); else openInfo('economy');
});
document.querySelectorAll('#speed button').forEach(b => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
let speedBeforePause = 1;
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveGame(true);
  }
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    if (GAME.speed) { speedBeforePause = GAME.speed; setSpeed(0); } else setSpeed(speedBeforePause);
  }
});
window.addEventListener('beforeunload', () => saveGame());
