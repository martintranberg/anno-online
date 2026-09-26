'use strict';

// ===== NOTIFICATIONS =====
// Messages appear as a toast and stay in the message list (bottom left) for a while.
GAME.messages = [];
const MESSAGE_TTL = 30000;
const warnedAt = new Map();

function notify(msg, toast = true) {
  GAME.messages.unshift({ msg, at: Date.now() });
  GAME.messages.length = Math.min(GAME.messages.length, 6);
  if (toast) showToast(msg);
  log(msg, 'ok');
  renderMessages();
}

// Same warning at most once per `cooldown` ticks
function warnOnce(key, msg, cooldown = 120) {
  const last = warnedAt.get(key);
  if (last !== undefined && GAME.tick - last < cooldown) return;
  warnedAt.set(key, GAME.tick);
  notify(msg);
}

function renderMessages() {
  const now = Date.now();
  GAME.messages = GAME.messages.filter(m => now - m.at < MESSAGE_TTL);
  document.getElementById('messages').innerHTML =
    GAME.messages.map(m => `<div style="opacity:${Math.max(0.35, 1 - (now - m.at) / MESSAGE_TTL)}">${esc(m.msg)}</div>`).join('');
}

// ===== QUESTS =====
// A short chain of goals that walks new players through the economy; each pays out coins.
const countOf = (type) => GAME.buildings.filter(b => b.type === type).length;
const linked = (type) => GAME.buildings.some(b => b.type === type && GAME.connected.has(b.id));
const foundIslands = () => [...GAME.islands.values()].filter(i => i.discovered && !i.start && !i.home && (i.size >= 12 || i.pirate)).length;
const QUESTS = [
  { id: 'fisher', text: 'Byg en fisker og forbind den med vej til lageret', done: () => linked('fisher'), reward: 100 },
  { id: 'houses', text: 'Byg 3 boliger tæt på lageret', progress: () => `${countOf('house')}/3`, done: () => countOf('house') >= 3, reward: 100 },
  { id: 'wood', text: 'Byg en skovhugger og et savværk med vej til lageret', done: () => linked('woodcutter') && linked('sawmill'), reward: 150 },
  { id: 'pop20', text: 'Nå 20 indbyggere', progress: () => `${totalPopulation()}/20`, done: () => totalPopulation() >= 20, reward: 150 },
  { id: 'market', text: 'Byg en markedsplads, så flere boliger får varer', done: () => countOf('marketplace') > 0, reward: 100 },
  { id: 'stone', text: 'Byg en stenhugger', done: () => linked('stonecutter'), reward: 100 },
  { id: 'meat', text: 'Skaf kød: byg en kornfarm og en svinefarm', done: () => linked('grainfarm') && linked('pigfarm'), reward: 150 },
  { id: 'ship', text: 'Byg en skibsbygger og søsæt en jolle', done: () => GAME.ships.length > 0, reward: 200 },
  { id: 'explore', text: 'Send skibet på opdagelse (🧭 på skibet) og find 3 nye øer', progress: () => `${Math.min(3, foundIslands())}/3`, done: () => foundIslands() >= 3, reward: 200 },
  { id: 'sheep', text: 'Grundlæg et lager på en ø med får 🐑', done: () => [...GAME.islands.values()].some(i => !i.home && i.warehouses && i.fertility.includes('sheep')), reward: 200 },
  { id: 'route', text: 'Tegn en handelsrute og sæt et skib på', done: () => GAME.ships.some(s => s.routeId), reward: 150 },
  { id: 'cloth', text: 'Skaf tøj: byg en fårefarm og en væver', done: () => linked('sheepfarm') && linked('weaver'), reward: 200 },
  { id: 'chapel', text: 'Byg et kapel til de kommende Borgere', done: () => countOf('chapel') > 0, reward: 150 },
  { id: 'citizens', text: 'Opgrader en bolig til Borgere', done: () => GAME.tierReached >= 2, reward: 300 },
  { id: 'trader', text: 'Sæt handelsmanden i gang: vælg noget at sælge eller købe på et lager', done: () => [...GAME.islands.values()].some(hasTradeSettings), reward: 150 },
  { id: 'defence', text: 'Forsvar dig mod piraterne: byg en fregat eller et vagttårn', done: () => GAME.ships.some(isWarship) || countOf('watchtower') > 0, reward: 250 },
  { id: 'pop80', text: 'Nå 80 indbyggere', progress: () => `${totalPopulation()}/80`, done: () => totalPopulation() >= 80, reward: 300 },
  { id: 'brew', text: 'Byg et bryggeri og en kro', done: () => linked('brewery') && countOf('tavern') > 0, reward: 300 },
  { id: 'bricks', text: 'Lav mursten: byg en lergrav og et teglværk', done: () => linked('claypit') && linked('brickworks'), reward: 300 },
  { id: 'tools', text: 'Lav værktøj: jernmine, kulmile og smedje', done: () => linked('mine') && linked('charcoal') && linked('smithy'), reward: 400 },
  { id: 'merchants', text: 'Opgrader en bolig til Købmænd', done: () => GAME.tierReached >= 3, reward: 500 },
  { id: 'fort', text: 'Ødelæg piratfortet med fregatter', done: () => !GAME.pirates || GAME.pirates.fortHp <= 0, reward: 300 },
  { id: 'theater', text: 'Byg et teater til de kommende Adelige', done: () => countOf('theater') > 0, reward: 400 },
  { id: 'luxury', text: 'Lav vin og smykker: vinpresse og guldsmed', done: () => linked('winery') && linked('goldsmith'), reward: 600 },
  { id: 'nobles', text: 'Opgrader en bolig til Adelige', done: () => GAME.tierReached >= 4, reward: 800 },
  { id: 'nobles50', text: `Nå ${MONUMENT_POP} Adelige`, progress: () => `${Math.floor(totalNobles())}/${MONUMENT_POP}`, done: () => totalNobles() >= MONUMENT_POP, reward: 1500 },
  { id: 'monument', text: 'Byg monumentet og vind spillet', done: () => countOf('monument') > 0, reward: 0 }
];
// Quest order in saves from before quest ids (version 3); ids that no longer exist map to the next one
const OLD_QUEST_IDS = ['fisher', 'houses', 'wood', 'pop20', 'market', 'stone', 'meat', 'ship', 'sheep', 'route', 'cloth',
                       'chapel', 'citizens', 'trader', 'pop80', 'brew', 'bricks', 'tools', 'merchants', 'theater', 'monument'];
const questIndexOf = (id) => Math.max(0, QUESTS.findIndex(q => q.id === id));

function checkQuests() {
  while (GAME.phase === 'play' && GAME.questIndex < QUESTS.length && QUESTS[GAME.questIndex].done()) {
    const q = QUESTS[GAME.questIndex];
    GAME.coins += q.reward;
    GAME.questIndex++;
    notify(`✅ Opgave fuldført: ${q.text} (+${q.reward} 🪙)`);
    if (q.reward) sfx('coins');
  }
}

function renderQuest() {
  const el = document.getElementById('quest');
  if (GAME.phase !== 'play') { el.hidden = true; return; }
  el.hidden = false;
  const q = QUESTS[GAME.questIndex];
  el.innerHTML = q
    ? `<b>📜 Opgave ${GAME.questIndex + 1}/${QUESTS.length}</b><div>${esc(q.text)}${q.progress ? ` <span class="muted">(${q.progress()})</span>` : ''}</div><small>Belønning: ${q.reward} 🪙</small>`
    : '<b>🏆 Alle opgaver er fuldført!</b><div>Byg videre på dit øriget.</div>';
}

// ===== INFO PANEL =====
// Clicking a building or ship (with no build tool selected) opens this panel; so does the economy button.
// It is re-rendered twice a second; route drafts live in GAME.selectedInfo so selections survive.
GAME.selectedInfo = null;
const STATUS_TEXT = {
  ok: '✅ Producerer', noroad: '⚠ Mangler vej til et lager', noinput: '⚠ Mangler råvarer',
  full: '⚠ Lageret er fuldt', idle: 'Ledig', building: '🔨 Bygger skib', noworkers: '⚠ Mangler arbejdere',
  planting: '🌱 Planter og plejer træer', noresource: '⚠ Intet tilbage at høste i nærheden',
  paused: '⏸ På pause', fire: '🔥 Brænder!', nocoins: '💸 Står stille – du er gået fallit'
};
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function openInfo(kind, id) {
  GAME.selectedInfo = { kind, id, error: '', pickRoute: null, pickShip: null };
  document.getElementById('info').hidden = false;
  renderInfo();
}

function closeInfo() {
  GAME.selectedInfo = null;
  document.getElementById('info').hidden = true;
}

function selectAtHover() {
  const s = mouse.x !== null && shipAtScreen(mouse.x, mouse.y);
  if (s) { openInfo('ship', s.id); return; }
  const h = GAME.hoveredTile;
  const occ = h && GAME.occupancy.get(`${h.tx},${h.ty}`);
  if (occ && occ !== 'road') openInfo(isRivalId(occ) ? 'rival' : 'building', occ);
  else if (h && GAME.pirates?.fortHp > 0 && GAME.pirates.fort && isSeen(h.tx, h.ty) &&
           Math.abs(h.tx - GAME.pirates.fort.x) <= 1 && Math.abs(h.ty - GAME.pirates.fort.y) <= 1) openInfo('pirates');
  else closeInfo();
}

const bar = (v, max) => `<div class="bar"><div style="width:${max ? Math.min(100, v / max * 100) : 0}%"></div></div>`;
const rate = (v) => (Math.round(v * 100) / 100).toString().replace('.', ',');
const fertTxt = (isl) => isl.fertility.length ? isl.fertility.map(f => `${FERTILITY[f].icon} ${FERTILITY[f].name}`).join(', ') : 'Ingen';
const needIcon = (isl, n) => `${NEED_INFO[n].icon} ${NEED_INFO[n].name} ${isl.needsMet[n] === false ? '❌' : '✅'}`;
const goodsChecks = (field, list) => RES_KEYS.map(k =>
  `<label class="chk"><input type="checkbox" data-list="${field}" data-res="${k}" ${list.includes(k) ? 'checked' : ''}>${RES_ICONS[k]} ${RESOURCES[k].name}</label>`).join('');

function renderInfo() {
  const sel = GAME.selectedInfo;
  if (!sel) return;
  const panel = document.getElementById('info');
  // Don't rebuild while the player is using a dropdown
  if (panel.contains(document.activeElement) && ['SELECT', 'INPUT'].includes(document.activeElement.tagName) &&
      document.activeElement.type !== 'checkbox') return;
  const title = document.getElementById('info-title'), body = document.getElementById('info-body');

  if (sel.kind === 'economy') { renderEconomy(title, body); return; }

  if (sel.kind === 'routes') { renderRoutes(title, body); return; }
  if (sel.kind === 'islands') { renderIslands(title, body); return; }
  if (sel.kind === 'rival') { renderRival(title, body, sel); return; }
  if (sel.kind === 'pirates') { renderPirates(title, body); return; }
  if (sel.kind === 'route') { renderRoute(title, body, sel); return; }

  if (sel.kind === 'ship') {
    const s = GAME.ships.find(x => x.id === sel.id);
    if (!s) { closeInfo(); return; }
    const T = SHIP_TYPES[s.type], r = shipRoute(s);
    const cargo = RES_KEYS.filter(k => s.cargo[k] > 0).map(k => `${RES_ICONS[k]} ${s.cargo[k]}`).join(' ') || 'Tom';
    const pick = sel.pickRoute ?? r?.id ?? GAME.routes[0]?.id ?? '';
    const fortKnown = GAME.pirates?.fortHp > 0 && isSeen(GAME.pirates.fort.x, GAME.pirates.fort.y);
    title.textContent = `${T.warship ? '⚔' : '⛵'} ${s.name}`;
    body.innerHTML = `
      <div class="row"><span>Status</span><b>${SHIP_STATE_TEXT[s.state] || s.state}</b></div>
      ${T.warship ? `<div class="row"><span>❤ Skrog</span><b>${Math.max(0, Math.round(s.hp))} / ${T.hp}</b></div>${bar(s.hp, T.hp)}
        <p class="muted">Krigsskib: på en rute beskytter det skibene inden for ${WARSHIP_GUARD} felter mod pirater og skyder på piratskibet. Repareres, når det ligger stille ved et af dine lagre.</p>`
        : `<div class="row"><span>Last</span><b>${cargo} <small>/ ${T.cargo}</small></b></div>`}
      <div class="row"><span>Rækkevidde</span><b>${T.range} felter</b></div>
      <div class="row"><span>Drift</span><b>−${rate(T.upkeep)} 🪙/s</b></div>
      <div class="row"><span>Ture</span><b>${s.trips}</b></div>
      <h4>Rute</h4>
      ${r ? `<div class="row"><span>Sejler</span><button class="link" data-open-route="${r.id}">${esc(routeName(r))} (${r.length} felter) ›</button></div>` : '<p class="muted">Skibet har ingen rute.</p>'}
      ${GAME.routes.length ? `<label>Vælg rute <select data-f="route">${GAME.routes.map(x =>
          `<option value="${x.id}" ${x.id === pick ? 'selected' : ''}>${esc(routeName(x))} · ${x.length} felter${x.length > T.range ? ' (for lang)' : ''}</option>`).join('')}</select></label>` : ''}
      <div class="btns">
        ${GAME.routes.length ? '<button data-act="assign">▶ Sejl ruten</button>' : ''}
        ${r ? '<button data-act="stop" class="alt">■ Stop</button>' : ''}
      </div>
      <div class="btns"><button data-act="draw">✏️ Tegn ny rute til skibet</button></div>
      <h4>Ordrer</h4>
      <div class="btns"><button data-act="explore">🧭 Udforsk automatisk</button><button data-act="goto" class="alt">📍 Sejl til…</button></div>
      ${T.warship && fortKnown ? '<div class="btns"><button data-act="attack" class="alt">⚔ Angrib piratfortet</button></div>' : ''}
      ${sel.error ? `<p class="err">${esc(sel.error)}</p>` : ''}`;
    body.querySelector('[data-act="explore"]').addEventListener('click', () => {
      stopRoute(s);
      s.state = 'autoExplore';
      autoExplore(s);
      saveGame();
      renderInfo();
    });
    body.querySelector('[data-act="goto"]').addEventListener('click', () => startShipOrder(s));
    body.querySelector('[data-act="attack"]')?.addEventListener('click', () => {
      sel.error = attackFort(s) || '';
      saveGame();
      renderInfo();
    });
    body.querySelector('[data-f="route"]')?.addEventListener('change', (e) => { sel.pickRoute = e.target.value; e.target.blur(); });
    body.querySelector('[data-act="assign"]')?.addEventListener('click', () => {
      sel.error = assignShip(s, sel.pickRoute ?? pick) || '';
      if (!sel.error) { notify(`⛵ ${s.name} sejler nu ${routeName(shipRoute(s))}`); saveGame(); }
      renderInfo();
    });
    body.querySelector('[data-act="stop"]')?.addEventListener('click', () => { stopRoute(s); saveGame(); renderInfo(); });
    body.querySelector('[data-act="draw"]')?.addEventListener('click', () => startRouteDraw({ assignShip: s.id }));
    body.querySelector('[data-open-route]')?.addEventListener('click', (e) => openInfo('route', e.currentTarget.dataset.openRoute));
    return;
  }

  const b = buildingById(sel.id);
  if (!b) { closeInfo(); return; }
  const def = DEFS[b.type], isl = islandOfBuilding(b);
  const byL = popByLevel(isl);

  if (b.type === 'warehouse') {
    const need = EXTRA_WAREHOUSE_POP * isl.warehouses;
    const shipsHere = GAME.ships.filter(s => { const r = shipRoute(s); return r && [r.from, r.to].some(id => islandOfBuilding(buildingById(id)) === isl); });
    const needs = Object.keys(NEED_INFO).filter(n => byL.some((p, L) => L >= NEED_FROM[n] && p > 0.5) || n === 'food');
    const mood = Math.round(isl.mood ?? MOOD_START);
    const factors = moodFactors(isl, byL);
    const allow = isl.allowUpgrade !== false;
    const T = GAME.trader;
    const traderTxt = T && T.target === b.id && T.state === 'trading' ? 'er her nu'
      : T ? 'er på vej rundt' : hasTradeSettings(isl) ? `kommer om ca. ${Math.max(1, GAME.traderAway ?? 0)} s` : 'kommer, når du har valgt varer';
    const num = (v) => v == null ? '' : v;
    title.textContent = `🏚️ Lager – ${isl.name}`;
    body.innerHTML = `
      <p class="muted">Fælles lager for hele øen · ${isl.warehouses} lager${isl.warehouses > 1 ? 'e' : ''} · plads til ${isl.cap} af hver vare</p>
      <div class="row"><span>🌱 Frugtbarhed</span><b>${fertTxt(isl)}${isl.ore ? '<br>⛏️ Jernmalm' : ''}</b></div>
      <div class="stock">${RES_KEYS.map(k => `
        <div class="res"><span>${RES_ICONS[k]} ${RESOURCES[k].name}</span><b>${Math.floor(isl.resources[k])} / ${isl.cap}</b>${bar(isl.resources[k], isl.cap)}</div>`).join('')}
      </div>
      <div class="row"><span>👥 Beboere</span><b>${isl.pop} / ${isl.popCap}</b></div>
      <div class="row"><span>Fordeling</span><b>${HOUSE_LEVELS.map((_, L) => L).filter(L => L && byL[L] > 0.5).map(L => `${tierName(L)} ${Math.round(byL[L])}`).join(' · ') || '–'}</b></div>
      <div class="row"><span>${moodIcon(mood)} Tilfredshed</span><b class="${mood < 30 ? 'err' : ''}">${mood}%</b></div>
      ${bar(mood, 100)}
      <p class="muted">${factors.map(([k, v]) => `${esc(k)} ${v > 0 ? '+' : ''}${v}`).join(' · ')}</p>
      <p class="muted">Under 45%: langsommere tilflytning og ingen opgraderinger (under 50%). Under 30%: beboerne flytter. Over 70%: bonus til skatten.</p>
      <div class="btns"><span>🪙 Skat</span><span class="seg">${Object.entries(TAX_LEVELS).map(([k, t]) =>
        `<button data-tax="${k}" class="${(isl.tax || 'normal') === k ? '' : 'alt'}" title="${Math.round(t.mult * 100)}% skat · tilfredshed ${t.mood >= 0 ? '+' : ''}${t.mood}">${t.name}</button>`).join('')}</span></div>
      <div class="row"><span>👷 Ledige arbejdere</span><b>${isl.workersFree ?? isl.pop}</b></div>
      <div class="row"><span>Behov</span><b>${needs.map(n => needIcon(isl, n)).join('<br>')}</b></div>
      ${isl.hunger ? '<p class="err">Beboerne sulter! Byg fiskere eller farme.</p>' : ''}
      <div class="btns"><span>Boliger må opgradere</span><button data-act="upgrade" class="${allow ? '' : 'alt'}">${allow ? '✅ Ja' : '⛔ Nej'}</button></div>
      <div class="row"><span>Næste lager</span><b>${isl.pop >= need ? fmtCost(extraWarehouseCost(isl.warehouses)) : `kræver ${need} beboere`}</b></div>
      ${shipsHere.length ? `<h4>Skibe på ruter hertil</h4>${shipsHere.map(s => `<div class="row"><span>${esc(s.name)}</span><b>${SHIP_STATE_TEXT[s.state]}</b></div>`).join('')}` : ''}
      <h4>🛒 Handelsmand</h4>
      ${dockTiles(b).length ? `
        <p class="muted">Handelsmanden ${traderTxt}. Han køber alt over "Sælg over" og sælger dig op til "Køb op til". Tomt felt = ingen handel.</p>
        <table class="trade"><tr><th></th><th>Sælg over</th><th>Køb op til</th></tr>
        ${RES_KEYS.map(k => `<tr><td title="Han betaler ${PRICES[k]} · du betaler ${buyPrice(k)}">${RES_ICONS[k]} <small>${PRICES[k]}/${buyPrice(k)}</small></td>
          <td><input type="number" min="0" data-trade="sell" data-res="${k}" value="${num(isl.trade?.[k]?.sell)}" placeholder="–"></td>
          <td><input type="number" min="0" data-trade="buy" data-res="${k}" value="${num(isl.trade?.[k]?.buy)}" placeholder="–"></td></tr>`).join('')}
        </table>
        ${isl.lastTrade ? `<p class="muted">Seneste handel: +${isl.lastTrade.income} / −${isl.lastTrade.spent} 🪙</p>` : ''}`
      : '<p class="muted">Kun lagre ved vandet kan handle med handelsmanden.</p>'}
      ${moveCopyButtons(b)}`;
    body.querySelector('[data-act="upgrade"]').addEventListener('click', () => {
      isl.allowUpgrade = !allow;
      saveGame();
      renderInfo();
    });
    body.querySelectorAll('[data-tax]').forEach(el => el.addEventListener('click', () => {
      isl.tax = el.dataset.tax;
      sfx('click');
      saveGame();
      renderInfo();
    }));
    bindMoveCopy(body, b);
    body.querySelectorAll('input[data-trade]').forEach(el => el.addEventListener('change', () => {
      const k = el.dataset.res, v = el.value === '' ? null : Math.max(0, Math.floor(Number(el.value)));
      isl.trade = isl.trade || {};
      isl.trade[k] = { ...(isl.trade[k] || {}), [el.dataset.trade]: v };
      saveGame();
    }));
    return;
  }

  if (b.type === 'shipyard') {
    const q = b.queue;
    title.textContent = `⚓ Skibsbygger – ${isl.name}`;
    const status = b.paused ? STATUS_TEXT.paused : !GAME.connected.has(b.id) ? STATUS_TEXT.noroad : !b.staffed ? STATUS_TEXT.noworkers : q ? `Bygger ${SHIP_TYPES[q.type].name}` : 'Klar';
    body.innerHTML = `
      <div class="row"><span>Status</span><b>${status}</b></div>
      <div class="row"><span>👷 Arbejdere</span><b>${workersOf(b)} ${b.staffed ? '✅' : '❌'}</b></div>
      ${q ? bar(q.progress, SHIP_TYPES[q.type].buildTime) : ''}
      ${pauseButton(b)}
      <h4>Byg skib</h4>
      ${Object.values(SHIP_TYPES).map(T => {
        const locked = GAME.tierReached < T.tier, afford = hasCost(isl.resources, T.cost);
        return `<div class="ship-card ${locked ? 'locked' : ''}">
          <div><b>${T.name}</b> <small>${locked ? `🔒 kræver ${tierName(T.tier)}` : `${T.buildTime} s`}</small></div>
          <div class="muted">${T.warship ? `Krigsskib · ${T.hp} i skrog · kæmper mod pirater` : `Last ${T.cargo}`} · rækkevidde ${T.range} felter · drift ${rate(T.upkeep)} 🪙/s</div>
          <div class="btns"><span class="${afford ? '' : 'err'}">${fmtCost(T.cost)}</span>
          <button data-ship="${T.id}" ${locked || q || !afford ? 'disabled' : ''}>Byg</button></div></div>`;
      }).join('')}
      ${sel.error ? `<p class="err">${esc(sel.error)}</p>` : ''}
      <h4>Dine skibe</h4>
      ${GAME.ships.length ? GAME.ships.map(s => `<div class="row"><span>${esc(s.name)}</span><button class="link" data-pick="${s.id}">${SHIP_STATE_TEXT[s.state] || s.state} ›</button></div>`).join('') : '<p class="muted">Ingen skibe endnu.</p>'}
      ${moveCopyButtons(b)}`;
    bindPause(body, b);
    bindMoveCopy(body, b);
    body.querySelectorAll('[data-ship]').forEach(el => el.addEventListener('click', () => {
      sel.error = startShipBuild(b, el.dataset.ship) || '';
      renderInfo();
    }));
    body.querySelectorAll('[data-pick]').forEach(el => el.addEventListener('click', () => {
      const s = GAME.ships.find(x => x.id === el.dataset.pick);
      centerOn(s.x, s.y);
      openInfo('ship', s.id);
    }));
    return;
  }

  if (def.house) {
    const L = b.level || 1, lvl = HOUSE_LEVELS[L], next = HOUSE_LEVELS[L + 1];
    title.textContent = `🏠 Bolig – ${lvl.name}`;
    const nextNeeds = next ? next.needs.filter(n => !lvl.needs.includes(n)) : [];
    const nextServices = next ? next.services.filter(s => !lvl.services.includes(s)) : [];
    body.innerHTML = `
      <p class="muted">${esc(isl.name)}</p>
      <div class="row"><span>Pladser</span><b>${houseCap(b, isl)} / ${lvl.cap}</b></div>
      ${!b.cov?.market ? '<p class="err">Ligger uden for et markeds rækkevidde – kun 2 beboere. Byg en markedsplads i nærheden.</p>' : ''}
      <div class="row"><span>👥 Beboere på øen</span><b>${isl.pop} / ${isl.popCap}</b></div>
      <div class="row"><span>🪙 Skat</span><b>${rate(lvl.tax)} pr. beboer/s</b></div>
      <div class="row"><span>Varer</span><b>${lvl.needs.map(n => needIcon(isl, n)).join('<br>')}</b></div>
      <div class="row"><span>Offentligt</span><b>${lvl.services.map(s => serviceIcon(b, s)).join('<br>')}</b></div>
      ${b.fire ? '<p class="err">🔥 Huset brænder!</p>' : ''}
      ${next ? `<h4>Næste niveau: ${next.name}</h4>
        <p>Opgraderer af sig selv, når boligerne er fulde, behovene ovenfor er dækket, øen har
        ${nextNeeds.map(n => `${NEED_INFO[n].icon} ${NEED_INFO[n].name.toLowerCase()}`).join(' og ')} på lager${nextServices.length ? `, og huset er inden for rækkevidde af ${nextServices.map(s => `${SERVICES[s].icon} ${SERVICES[s].name.toLowerCase()}`).join(' og ')}` : ''}.</p>
        <div class="row"><span>Materialer</span><b>${fmtCost(lvl.upgrade)}</b></div>
        <div class="btns"><span>${b.lockLevel ? '🔒 Niveauet er låst' : 'Må opgradere'}</span><button data-act="lock" class="${b.lockLevel ? 'alt' : ''}">${b.lockLevel ? 'Lås op' : '🔒 Lås niveau'}</button></div>`
        : '<p class="muted">Højeste niveau.</p>'}
      ${isl.allowUpgrade === false ? '<p class="muted">Opgradering er slået fra for hele øen (se lageret).</p>' : ''}
      ${(isl.mood ?? MOOD_START) < 50 && next ? '<p class="muted">😟 Beboerne er for utilfredse til at opgradere (under 50%).</p>' : ''}
      ${moveCopyButtons(b)}`;
    body.querySelector('[data-act="lock"]')?.addEventListener('click', () => {
      b.lockLevel = !b.lockLevel;
      saveGame();
      renderInfo();
    });
    bindMoveCopy(body, b);
    return;
  }

  // Generic production building
  const lvl = prodLevel(b);
  title.textContent = `${def.name}${def.produces && lvl > 1 ? ` ${'★'.repeat(lvl - 1)}` : ''}`;
  let details = '';
  if (def.produces) {
    const m = PROD_LEVELS[lvl].mult;
    const ins = def.consumes ? Object.entries(def.consumes).map(([r, n]) => `${rate(n * m)} ${RES_ICONS[r]}`).join(' + ') + ' → ' : '';
    details = `<div class="row"><span>Status</span><b>${STATUS_TEXT[b.status] || STATUS_TEXT.idle}</b></div>
               <div class="row"><span>Produktion</span><b>${ins}${rate((def.rate ?? 1) * m)} ${RES_ICONS[def.produces]} /s</b></div>
               <div class="row"><span>Niveau</span><b>${lvl} / ${PROD_MAX_LEVEL}</b></div>`;
  }
  if (def.harvest) {
    const left = harvestLeft(b);
    details += `<div class="row"><span>Tilbage i området</span><b class="${left ? '' : 'err'}">${left} ${RES_ICONS[def.harvest.key]}</b></div>`;
    if (b.status === 'noresource') details += `<p class="err">Ingen ${def.harvest.label} tilbage inden for ${harvestRadius(b)} felter.${def.harvest.key === 'wood' ? ' Byg en skovfoged i nærheden.' : ' Det kommer ikke igen – find nye klipper, eller flyt bygningen.'}</p>`;
  }
  if (b.type === 'forester') details += `<div class="row"><span>Status</span><b>${STATUS_TEXT[b.status] || STATUS_TEXT.idle}</b></div>`;
  if (def.service) {
    const served = GAME.buildings.filter(o => DEFS[o.type].house && islandOfBuilding(o) === isl && footprintGap(o, b) <= def.radius).length;
    details += `<div class="row"><span>Status</span><b>${b.paused ? STATUS_TEXT.paused : b.fire ? STATUS_TEXT.fire : serviceActive(b) ? '✅ I drift' : STATUS_TEXT.noworkers}</b></div>
                <div class="row"><span>Rækkevidde</span><b>${def.radius} felter · ${served} boliger</b></div>`;
  }
  if (def.guard) {
    details += `<div class="row"><span>Status</span><b>${b.paused ? STATUS_TEXT.paused : serviceActiveTower(b) ? '✅ På vagt' : GAME.bankrupt ? STATUS_TEXT.nocoins : STATUS_TEXT.noworkers}</b></div>
                <div class="row"><span>Rækkevidde</span><b>${def.guard} felter</b></div>`;
  }
  if (b.fire) details += '<p class="err">🔥 Bygningen brænder!</p>';
  if (def.workers) details += `<div class="row"><span>👷 Arbejdere</span><b>${workersOf(b)} ${b.staffed ? '✅' : '❌'}</b></div>`;
  if (def.upkeep) details += `<div class="row"><span>🪙 Drift</span><b>−${rate(upkeepOf(b))}/s</b></div>`;
  // In-place upgrade for production buildings
  let upgrade = '';
  if (def.produces && lvl < PROD_MAX_LEVEL) {
    const L = PROD_LEVELS[lvl + 1], cost = L.cost(def);
    const locked = GAME.tierReached < L.tier;
    upgrade = `<h4>Opgrader til niveau ${lvl + 1}</h4>
      <p class="muted">${Math.round(L.mult * 100)}% produktion (og forbrug), +1 arbejder, ${Math.round(L.upkeep * 100)}% drift${def.harvest ? ', +1 felts rækkevidde' : ''}.</p>
      <div class="btns"><span class="${hasCost(isl.resources, cost) ? '' : 'err'}">${locked ? `🔒 kræver ${tierName(L.tier)}` : fmtCost(cost)}</span>
      <button data-act="produp" ${locked || !hasCost(isl.resources, cost) ? 'disabled' : ''}>⬆ Opgrader</button></div>`;
  }
  const pausable = def.workers || def.produces || def.service;
  body.innerHTML = `<p class="muted">${esc(isl.name)}</p>${details}${pausable ? pauseButton(b) : ''}${upgrade}<p>${esc(def.desc)}</p>${moveCopyButtons(b)}`;
  bindPause(body, b);
  bindMoveCopy(body, b);
  body.querySelector('[data-act="produp"]')?.addEventListener('click', () => {
    const L = PROD_LEVELS[lvl + 1], cost = L.cost(def);
    if (GAME.tierReached < L.tier || !hasCost(isl.resources, cost)) return;
    payCost(isl.resources, cost);
    b.level = lvl + 1;
    notify(`⬆ ${def.name} på ${isl.name} er opgraderet til niveau ${b.level}`, false);
    sfx('build');
    saveGame();
    renderInfo();
  });
}

// "Move" and "build another" buttons shared by the building panels
const moveCopyButtons = (b) => b.type === 'monument' ? '' :
  `<div class="btns"><button data-act="move" class="alt" title="Flyt bygningen gratis til et andet sted på øen">↔ Flyt</button><button data-act="copy" title="Byg en magen til (Q over en bygning)">📋 Byg magen til</button></div>`;
function bindMoveCopy(body, b) {
  body.querySelector('[data-act="move"]')?.addEventListener('click', () => startMove(b));
  body.querySelector('[data-act="copy"]')?.addEventListener('click', () => { closeInfo(); selectTool(b.type); });
}

function renderRival(title, body, sel) {
  const b = GAME.rival?.buildings.find(x => x.id === sel.id);
  if (!b) { closeInfo(); return; }
  const isl = islandOfBuilding(b);
  const def = DEFS[b.type];
  title.textContent = `⚑ ${def.name} – ${isl.name}`;
  const goods = rivalGoods(isl);
  const price = buyoutPrice(isl);
  body.innerHTML = `
    <p class="muted">Denne ø tilhører ${RIVAL_NAME}. Du kan ikke bygge her, men du kan handle: tegn en rute til deres lager.</p>
    <h4>De sælger (returlast)</h4>
    ${goods.map(k => `<div class="row"><span>${RES_ICONS[k]} ${RESOURCES[k].name}</span><b>${Math.floor(isl.resources[k])} stk · ${rivalSellPrice(k)} 🪙</b></div>`).join('')}
    <h4>De køber (udlast)</h4>
    <p class="muted">Alt, de ikke selv laver, op til ${RIVAL_BUY_MAX} af hver: ${RES_KEYS.filter(k => !goods.includes(k)).map(k => `${RES_ICONS[k]} ${rivalBuyPrice(k)}`).join(' · ')} 🪙</p>
    <h4>Køb øen</h4>
    <p class="muted">Køb kolonien ud. Deres bygninger forsvinder, og lageret med varerne bliver dit.</p>
    <div class="btns"><span class="${GAME.coins >= price ? '' : 'err'}">${price} 🪙</span><button data-act="buyout" ${GAME.coins >= price ? '' : 'disabled'}>🤝 Køb øen</button></div>
    ${sel.error ? `<p class="err">${esc(sel.error)}</p>` : ''}`;
  body.querySelector('[data-act="buyout"]').addEventListener('click', () => {
    if (!confirm(`Købe ${isl.name} af ${RIVAL_NAME} for ${price} mønter?`)) return;
    sel.error = buyRivalIsland(isl) || '';
    if (!sel.error) {
      const wh = GAME.buildings.find(x => x.type === 'warehouse' && islandOfBuilding(x) === isl);
      if (wh) openInfo('building', wh.id); else closeInfo();
    } else renderInfo();
  });
}

function renderPirates(title, body) {
  const PF = GAME.pirates;
  if (!PF || PF.fortHp <= 0) { closeInfo(); return; }
  title.textContent = '🏴‍☠️ Piratfortet';
  const warships = GAME.ships.filter(isWarship);
  body.innerHTML = `
    <div class="row"><span>❤ Fort</span><b>${Math.round(PF.fortHp)} / ${FORT_HP}</b></div>${bar(PF.fortHp, FORT_HP)}
    <div class="row"><span>Piratskib</span><b>${PF.ship ? (PF.ship.state === 'hunting' ? 'På jagt' : 'På vej hjem') : 'I havn'}</b></div>
    <p>Herfra sejler piraterne ud og plyndrer dine lastede skibe. Beskyt dig med fregatter på ruterne og vagttårne ved kysten – eller send fregatter for at ødelægge fortet (+${FORT_REWARD} 🪙).</p>
    <p class="muted">Fortet skyder igen, så send gerne to fregatter. Hver fregat gør ${WARSHIP_DAMAGE} skade pr. sekund og tager ${FORT_DAMAGE}.</p>
    ${warships.length ? warships.map(w => `<div class="btns"><span>${esc(w.name)} (❤ ${Math.round(w.hp)})</span><button data-attack="${w.id}" class="alt">⚔ Angrib</button></div>`).join('')
      : '<p class="muted">Du har ingen fregatter. Byg en på skibsbyggeren (kræver Borgere).</p>'}`;
  body.querySelectorAll('[data-attack]').forEach(el => el.addEventListener('click', () => {
    const w = GAME.ships.find(s => s.id === el.dataset.attack);
    const err = w && attackFort(w);
    if (err) showToast(`❌ ${err}`);
    saveGame();
    renderInfo();
  }));
}

// Pause / resume button for any building with workers, production or a service
const pauseButton = (b) => `<div class="btns"><button data-act="pause" class="${b.paused ? '' : 'alt'}">${b.paused ? '▶ Genoptag' : '⏸ Sæt på pause'}</button><span class="muted">Pause: ingen arbejdere, ingen drift</span></div>`;
function bindPause(body, b) {
  body.querySelector('[data-act="pause"]')?.addEventListener('click', () => {
    b.paused = !b.paused;
    updateIslandStats();
    saveGame();
    renderInfo();
  });
}
const serviceIcon = (b, s) => `${SERVICES[s].icon} ${SERVICES[s].name} ${b.cov?.[s] ? '✅' : '❌'}`;

// Tiny inline SVG line chart for the economy panel
function sparkline(values, w = 110, hgt = 22) {
  if (values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1) * w).toFixed(1)},${(hgt - 2 - (v - min) / span * (hgt - 4)).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${hgt}" style="vertical-align:middle"><polyline points="${pts}" fill="none" stroke="#8a5a2a" stroke-width="1.5"/></svg>`;
}

function renderIslands(title, body) {
  title.textContent = '📍 Øer';
  const all = [...GAME.islands.values()].filter(i => i.size >= 12 || i.pirate);
  const list = all.filter(i => i.discovered).sort((a, b) => (b.warehouses > 0) - (a.warehouses > 0) || b.size - a.size);
  const unknown = all.length - list.length;
  const rivalCount = rivalIslands().length;
  body.innerHTML = `${GAME.rival ? `<p class="muted">⚑ ${RIVAL_NAME} ejer ${rivalCount} ø${rivalCount === 1 ? '' : 'er'}.</p>` : ''}` + list.map(isl => {
    const fert = [...isl.fertility.map(f => FERTILITY[f].icon), isl.ore ? '⛏️' : '', isl.gold ? '🥇' : ''].join('');
    if (isl.pirate) return `<div class="row"><span>🏴‍☠️ ${esc(isl.name)}</span><button class="link" data-go="${isl.id}">Piraternes fort ›</button></div>`;
    if (isl.owner === 'rival') return `<div class="row"><span>⚑ ${esc(isl.name)} ${fert}</span><button class="link" data-go="${isl.id}">${RIVAL_NAME} ›</button></div>`;
    if (!isl.warehouses) return `<div class="row"><span>${esc(isl.name)} ${fert}</span><button class="link" data-go="${isl.id}">Ikke grundlagt ›</button></div>`;
    const full = RES_KEYS.filter(k => isl.resources[k] >= isl.cap).length;
    return `<div class="ship-card">
      <div><b>${esc(isl.name)}</b> ${fert} <small>${isl.home ? '· hjemø' : ''}</small></div>
      <div class="muted">👥 ${isl.pop}/${isl.popCap} · ${moodIcon(isl.mood ?? MOOD_START)} ${Math.round(isl.mood ?? MOOD_START)}% · 🪙 ${TAX_LEVELS[isl.tax || 'normal'].name.toLowerCase()} skat · 👷 ledige ${isl.workersFree ?? 0} · 🍽️ ${isl.hunger ? '❌ sult' : '✅'}${full ? ` · 📦 ${full} fulde varer` : ''}</div>
      <div class="btns"><span></span><button data-go="${isl.id}">Vis</button></div></div>`;
  }).join('') + (unknown ? `<p class="muted">🌫️ ${unknown} ø${unknown === 1 ? '' : 'er'} er endnu ikke opdaget. Send et skib på opdagelse.</p>` : '');
  body.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => {
    const isl = GAME.islands.get(Number(el.dataset.go));
    const wh = GAME.buildings.find(b => b.type === 'warehouse' && islandOfBuilding(b) === isl);
    const rv = GAME.rival?.buildings.find(b => b.type === 'warehouse' && islandOfBuilding(b) === isl);
    if (wh) { centerOn(wh.x + 0.5, wh.y + 0.5); openInfo('building', wh.id); }
    else if (rv) { centerOn(rv.x + 0.5, rv.y + 0.5); openInfo('rival', rv.id); }
    else if (isl.pirate && GAME.pirates) { centerOn(GAME.pirates.fort.x, GAME.pirates.fort.y); openInfo('pirates'); }
    else centerOn(isl.anchor[0], isl.anchor[1]);
  }));
}

function renderRoutes(title, body) {
  title.textContent = '🗺️ Handelsruter';
  body.innerHTML = `
    <p class="muted">Tegn ruter i vandet mellem lagre på forskellige øer, vælg varer begge veje og sæt skibe på.</p>
    <div class="btns"><button data-act="draw">✏️ Tegn ny rute</button></div>
    ${GAME.routes.length ? GAME.routes.map(r => {
      const ships = GAME.ships.filter(s => s.routeId === r.id).length;
      const ok = !!routePath(r);
      return `<div class="ship-card">
        <div><b>${esc(routeName(r))}</b> <small>${ok ? `${r.length} felter · ${r.waypoints.length} punkter` : '<span class="err">kan ikke sejles</span>'}</small></div>
        <div class="muted">Ud: ${r.res.map(k => RES_ICONS[k]).join('') || '–'} · Retur: ${r.back.map(k => RES_ICONS[k]).join('') || '–'} · ⛵ ${ships}</div>
        <div class="btns"><span></span><button data-open="${r.id}">Åbn</button></div></div>`;
    }).join('') : '<p class="muted">Ingen ruter endnu.</p>'}`;
  body.querySelector('[data-act="draw"]').addEventListener('click', () => startRouteDraw());
  body.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => openInfo('route', el.dataset.open)));
}

// "Keep at least N" inputs for the goods chosen on one leg of a route
function keepInputs(r, listField, keepField, islandName) {
  if (!r[listField].length) return '';
  const keep = r[keepField] || {};
  return `<p class="muted">Behold mindst (på ${islandName}):</p><div class="goods">${r[listField].map(k =>
    `<label class="chk">${RES_ICONS[k]} <input type="number" min="0" style="width:52px" data-keep="${keepField}" data-res="${k}" value="${keep[k] ?? ''}" placeholder="0"></label>`).join('')}</div>`;
}

function renderRoute(title, body, sel) {
  const r = routeById(sel.id);
  if (!r) { openInfo('routes'); return; }
  const p = routePath(r);
  const fromName = esc(islandOfBuilding(buildingById(r.from))?.name), toName = esc(islandOfBuilding(buildingById(r.to))?.name);
  const onRoute = GAME.ships.filter(s => s.routeId === r.id);
  const others = GAME.ships.filter(s => s.routeId !== r.id);
  const pick = sel.pickShip ?? others[0]?.id ?? '';
  title.textContent = `🗺️ ${routeName(r)}`;
  body.innerHTML = `
    <div class="row"><span>Længde</span><b>${p ? `${r.length} felter` : '<span class="err">kan ikke sejles – tegn om</span>'}</b></div>
    <div class="row"><span>Punkter</span><b>${r.waypoints.length}</b></div>
    <h4>Varer ud (${fromName} → ${toName})</h4>
    <div class="goods">${goodsChecks('res', r.res)}</div>
    ${keepInputs(r, 'res', 'keepRes', fromName)}
    <h4>Returlast (${toName} → ${fromName})</h4>
    <div class="goods">${goodsChecks('back', r.back)}</div>
    ${keepInputs(r, 'back', 'keepBack', toName)}
    <h4>Skibe på ruten</h4>
    ${onRoute.length ? onRoute.map(s => `<div class="row"><span>${esc(s.name)} <small>(${SHIP_STATE_TEXT[s.state]})</small></span><button class="link" data-unassign="${s.id}">Fjern</button></div>`).join('') : '<p class="muted">Ingen skibe endnu.</p>'}
    ${others.length ? `<label>Sæt skib på <select data-f="ship">${others.map(s =>
        `<option value="${s.id}" ${s.id === pick ? 'selected' : ''}>${esc(s.name)} · rækkevidde ${SHIP_TYPES[s.type].range}${shipRoute(s) ? ' (har rute)' : ''}</option>`).join('')}</select></label>
      <div class="btns"><button data-act="assign">⛵ Sæt på ruten</button></div>` : ''}
    <div class="btns"><button data-act="redraw">✏️ Tegn om</button><button data-act="delete" class="alt">🗑 Slet rute</button></div>
    <div class="btns"><button class="link" data-act="all">‹ Alle ruter</button></div>
    ${sel.error ? `<p class="err">${esc(sel.error)}</p>` : ''}`;
  // Goods changes apply right away, also to ships already sailing the route
  body.querySelectorAll('input[data-list]').forEach(el => el.addEventListener('change', () => {
    const f = el.dataset.list, k = el.dataset.res;
    r[f] = el.checked ? [...new Set([...r[f], k])] : r[f].filter(x => x !== k);
    saveGame();
    renderInfo();
  }));
  body.querySelectorAll('input[data-keep]').forEach(el => el.addEventListener('change', () => {
    const f = el.dataset.keep, k = el.dataset.res;
    r[f] = r[f] || {};
    if (el.value === '' || Number(el.value) <= 0) delete r[f][k];
    else r[f][k] = Math.floor(Number(el.value));
    saveGame();
  }));
  body.querySelector('[data-f="ship"]')?.addEventListener('change', (e) => { sel.pickShip = e.target.value; e.target.blur(); });
  body.querySelector('[data-act="assign"]')?.addEventListener('click', () => {
    const s = GAME.ships.find(x => x.id === (sel.pickShip ?? pick));
    sel.error = s ? assignShip(s, r.id) || '' : 'Vælg et skib';
    if (!sel.error) { sel.pickShip = null; notify(`⛵ ${s.name} sejler nu ${routeName(r)}`); saveGame(); }
    renderInfo();
  });
  body.querySelectorAll('[data-unassign]').forEach(el => el.addEventListener('click', () => {
    stopRoute(GAME.ships.find(x => x.id === el.dataset.unassign));
    saveGame();
    renderInfo();
  }));
  body.querySelector('[data-act="redraw"]').addEventListener('click', () => startRouteDraw({ editId: r.id }));
  body.querySelector('[data-act="delete"]').addEventListener('click', () => {
    if (!confirm(`Slette ruten ${routeName(r)}?`)) return;
    deleteRoute(r);
    saveGame();
    openInfo('routes');
  });
  body.querySelector('[data-act="all"]').addEventListener('click', () => openInfo('routes'));
}

function renderEconomy(title, body) {
  title.textContent = '📊 Økonomi';
  const net = (GAME.lastTax || 0) - (GAME.lastUpkeep || 0);
  const islands = [...GAME.islands.values()].filter(i => i.warehouses);
  body.innerHTML = `
    <div class="row"><span>🪙 Mønter</span><b>${Math.floor(GAME.coins)}</b></div>
    <div class="row"><span>Skat</span><b>+${rate(GAME.lastTax || 0)}/s</b></div>
    <div class="row"><span>Drift</span><b>−${rate(GAME.lastUpkeep || 0)}/s</b></div>
    <div class="row"><span>Balance</span><b class="${net < 0 ? 'err' : ''}">${net >= 0 ? '+' : ''}${rate(net)}/s</b></div>
    ${GAME.bankrupt ? '<p class="err">💸 Du er gået fallit! Kun madproduktion og markeder kører. Sæt skatten op, sæt bygninger på pause eller sælg varer til handelsmanden.</p>' : ''}
    <p class="muted">Skatten sættes pr. ø på lageret. Høj skat giver flere mønter, men gør beboerne utilfredse.</p>
    ${GAME.history.length > 1 ? `<h4>Udvikling (sidste ${Math.round(GAME.history.length * 10 / 60)} min.)</h4>
      <div class="row"><span>🪙 Mønter</span>${sparkline(GAME.history.map(s => s.coins))}</div>
      ${RES_KEYS.filter(k => GAME.history.some(s => s.stock[k] > 0)).map(k =>
        `<div class="row"><span>${RES_ICONS[k]} ${RESOURCES[k].name} <small>${GAME.history[GAME.history.length - 1].stock[k]}</small></span>${sparkline(GAME.history.map(s => s.stock[k]))}</div>`).join('')}` : ''}
    ${islands.map(isl => {
      const rows = RES_KEYS.filter(k => isl.resources[k] >= 1 || isl.flowIn?.[k] || isl.flowOut?.[k]).map(k => {
        const d = (isl.flowIn?.[k] || 0) - (isl.flowOut?.[k] || 0);
        return `<div class="row"><span>${RES_ICONS[k]} ${RESOURCES[k].name}</span><b>${Math.floor(isl.resources[k])} <small class="${d < 0 ? 'err' : ''}">(${d >= 0 ? '+' : ''}${rate(d)}/s)</small></b></div>`;
      }).join('');
      return `<h4>${esc(isl.name)} · 👥 ${isl.pop}/${isl.popCap}</h4>${rows || '<p class="muted">Ingen varer</p>'}`;
    }).join('')}
    <p class="muted">Tallene i parentes er produktion minus forbrug (uden skibe).</p>`;
}

document.getElementById('info-close').addEventListener('click', closeInfo);
