'use strict';

// ===== ROADS =====
const isRoad = (x, y) => GAME.roads.has(`${x},${y}`);
const isBuildingTile = (x, y) => {
  const occ = GAME.occupancy.get(`${x},${y}`);
  return !!occ && occ !== 'road';
};
const uvRect = (u0, v0, u1, v1) => [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];

// A dirt path that joins up with neighbouring roads and runs into buildings it touches
// Wooden bridge deck over a canal, oriented along the road
function drawBridge(x, y) {
  const alongU = isRoad(x - 1, y) || isRoad(x + 1, y) || !(isRoad(x, y - 1) || isRoad(x, y + 1));
  const z = 4, hw = 0.32;
  const [u0, v0, u1, v1] = alongU ? [x - 0.5, y - hw, x + 0.5, y + hw] : [x - hw, y - 0.5, x + hw, y + 0.5];
  // Supports down into the water
  for (const [pu, pv] of alongU ? [[x, v0], [x, v1]] : [[u0, y], [u1, y]]) line(P(pu, pv, 0), P(pu, pv, z), '#4a3018', 2);
  poly('#9a7448', [P(u0, v0, z), P(u1, v0, z), P(u1, v1, z), P(u0, v1, z)], 'rgba(40,24,10,0.6)');
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    if (alongU) line(P(u0 + t, v0, z), P(u0 + t, v1, z), 'rgba(40,24,10,0.35)', 0.7);
    else line(P(u0, v0 + t, z), P(u1, v0 + t, z), 'rgba(40,24,10,0.35)', 0.7);
  }
  // Railings
  const rails = alongU ? [[[u0, v0], [u1, v0]], [[u0, v1], [u1, v1]]] : [[[u0, v0], [u0, v1]], [[u1, v0], [u1, v1]]];
  for (const [[a0, b0], [a1, b1]] of rails) {
    line(P(a0, b0, z + 5), P(a1, b1, z + 5), '#5a3a1e', 1.2);
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      line(P(a0 + (a1 - a0) * t, b0 + (b1 - b0) * t, z), P(a0 + (a1 - a0) * t, b0 + (b1 - b0) * t, z + 5), '#5a3a1e', 1);
    }
  }
}

function drawRoad(x, y) {
  if (tileAt(x, y)?.canal) { drawBridge(x, y); return; }
  const arms = [
    [0, -1], [1, 0], [0, 1], [-1, 0]
  ].filter(([dx, dy]) => isRoad(x + dx, y + dy) || isBuildingTile(x + dx, y + dy));

  const shape = (hw) => {
    const parts = [uvRect(x - hw, y - hw, x + hw, y + hw)];
    for (const [dx, dy] of arms) {
      if (dy === -1) parts.push(uvRect(x - hw, y - 0.5, x + hw, y - hw));
      if (dy === 1) parts.push(uvRect(x - hw, y + hw, x + hw, y + 0.5));
      if (dx === -1) parts.push(uvRect(x - 0.5, y - hw, x - hw, y + hw));
      if (dx === 1) parts.push(uvRect(x + hw, y - hw, x + 0.5, y + hw));
    }
    return parts;
  };

  for (const q of shape(0.36)) poly('#7a6a44', q, null); // verge
  for (const q of shape(0.3)) poly('#b8a274', q, null);  // path surface

  // Scattered pebbles, stable per tile
  const rnd = seeded(x * 92821 ^ y * 68917);
  for (let i = 0; i < 5; i++) {
    dot(P(x - 0.25 + rnd() * 0.5, y - 0.25 + rnd() * 0.5), 0.9, rnd() < 0.5 ? '#9a865c' : '#d2c092');
  }
}

// Tiles within a service building's reach, drawn as a soft area with an outline
function drawRadiusArea(x, y, w, hgt, r, color) {
  const u0 = x - r - 0.5, v0 = y - r - 0.5, u1 = x + w + r - 0.5, v1 = y + hgt + r - 0.5;
  poly(color, [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)], 'rgba(255,240,180,0.8)');
}

// Show reach while placing a service building, or when one (or a warehouse) is selected
function drawServiceOverlay() {
  const tool = GAME.selectedBuilding && DEFS[GAME.selectedBuilding];
  const h = GAME.hoveredTile;
  if ((tool?.service || tool?.guard) && h) {
    drawRadiusArea(h.tx, h.ty, tool.w, tool.h, tool.radius || tool.guard, tool.guard ? 'rgba(220,120,90,0.14)' : 'rgba(120,200,120,0.14)');
    return;
  }
  const sel = GAME.selectedInfo;
  const b = sel?.kind === 'building' && buildingById(sel.id);
  if (!b) return;
  const def = DEFS[b.type];
  const r = def.service ? def.radius : def.guard ? def.guard : b.type === 'warehouse' ? WAREHOUSE_MARKET_RADIUS : 0;
  if (r) drawRadiusArea(b.x, b.y, def.w, def.h, r, def.guard ? 'rgba(220,120,90,0.12)' : 'rgba(120,200,120,0.12)');
}

function drawStatusBubble(b, icon, color) {
  const def = DEFS[b.type];
  const p = P(b.x - 0.5 + def.w / 2, b.y - 0.5 + def.h / 2, 60);
  ctx.fillStyle = color;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = '10px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, p.x, p.y + 0.5);
  ctx.textBaseline = 'alphabetic';
}

// Flickering flames and dark smoke over a burning building
function drawFire(b) {
  const def = DEFS[b.type], t = animTime / 120;
  for (let i = 0; i < 6; i++) {
    const u = b.x - 0.3 + (i % 3) * (def.w - 0.4) / 2, v = b.y - 0.3 + Math.floor(i / 3) * (def.h - 0.4);
    const p = P(u, v, 14 + Math.sin(t + i) * 3);
    const s = 5 + Math.sin(t * 1.7 + i * 2) * 2;
    dot({ x: p.x, y: p.y }, s + 3, 'rgba(230,90,20,0.8)');
    dot({ x: p.x, y: p.y - 3 }, s, 'rgba(255,200,60,0.9)');
  }
  const c = P(b.x + (def.w - 1) / 2, b.y + (def.h - 1) / 2, 30);
  for (let i = 0; i < 4; i++) {
    const k = (animTime / 1800 + i / 4) % 1;
    dot({ x: c.x + Math.sin(k * 6 + i) * 6, y: c.y - k * 40 }, 5 + k * 9, `rgba(50,45,40,${0.5 * (1 - k)})`);
  }
}

// Storm: darker sky and slanted rain over the whole screen
function drawStorm() {
  ctx.fillStyle = 'rgba(20,30,50,0.28)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(200,215,235,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const off = (animTime / 3) % 40;
  for (let i = 0; i < 160; i++) {
    const x = (i * 97) % canvas.width, y = ((i * 57) % canvas.height + off * 6) % canvas.height;
    ctx.moveTo(x, y);
    ctx.lineTo(x - 6, y + 16);
  }
  ctx.stroke();
}

function drawNoRoadIcon(b) {
  const def = DEFS[b.type];
  const bob = Math.sin(animTime / 300) * 2;
  const p = P(b.x - 0.5 + def.w / 2, b.y - 0.5 + def.h / 2, 72 + bob);
  ctx.fillStyle = '#c0392b';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Little road symbol: two converging edges with a dashed centre line
  line({ x: p.x - 6, y: p.y + 6 }, { x: p.x - 2, y: p.y - 6 }, '#fff', 1.6);
  line({ x: p.x + 6, y: p.y + 6 }, { x: p.x + 2, y: p.y - 6 }, '#fff', 1.6);
  line({ x: p.x, y: p.y + 5 }, { x: p.x, y: p.y + 2 }, '#fff', 1.2);
  line({ x: p.x, y: p.y - 1 }, { x: p.x, y: p.y - 4 }, '#fff', 1.2);
}

function drawTileHighlight(x, y, fill, stroke) {
  poly(fill, uvRect(x - 0.5, y - 0.5, x + 0.5, y + 0.5), stroke);
}

// L-shaped path between two tiles: first along x, then along y
function roadPath(a, b) {
  const sx = Math.sign(b.tx - a.tx), sy = Math.sign(b.ty - a.ty);
  let x = a.tx, y = a.ty;
  const tiles = [{ tx: x, ty: y }];
  while (x !== b.tx) { x += sx; tiles.push({ tx: x, ty: y }); }
  while (y !== b.ty) { y += sy; tiles.push({ tx: x, ty: y }); }
  return tiles;
}

function drawRoadGhost() {
  const h = GAME.hoveredTile;
  const tiles = GAME.roadDrag ? roadPath(GAME.roadDrag, h) : [h];
  for (const t of tiles) {
    const ok = isRoad(t.tx, t.ty) || canPlaceBuilding(t.tx, t.ty, DEFS.road, true);
    drawTileHighlight(t.tx, t.ty, ok ? 'rgba(200,180,120,0.55)' : 'rgba(200,80,80,0.45)', ok ? '#e8d8a0' : '#c86464');
  }
}

function drawCanalGhost() {
  const h = GAME.hoveredTile;
  const tiles = GAME.roadDrag ? roadPath(GAME.roadDrag, h) : [h];
  canalPlan(tiles).forEach((r, i) => {
    drawTileHighlight(tiles[i].tx, tiles[i].ty, r.ok ? 'rgba(80,170,220,0.55)' : 'rgba(200,80,80,0.45)', r.ok ? '#a8e0f8' : '#c86464');
  });
}

function drawDemolishGhost() {
  const { tx, ty } = GAME.hoveredTile;
  const occ = GAME.occupancy.get(`${tx},${ty}`);
  if (occ === 'road' || !occ) {
    const target = occ || tileAt(tx, ty)?.canal; // roads, bridges and canals (filled in) can be removed
    drawTileHighlight(tx, ty, target ? 'rgba(220,60,60,0.45)' : 'rgba(220,60,60,0.15)', '#e05050');
    return;
  }
  const b = GAME.buildings.find(bb => bb.id === occ);
  if (!b) return; // rival building
  const def = DEFS[b.type];
  poly('rgba(220,60,60,0.35)', uvRect(b.x - 0.5, b.y - 0.5, b.x + def.w - 0.5, b.y + def.h - 0.5), '#e05050');
}

// ----- Relocating buildings -----
// Anno-style "move": pick up a building and put it down elsewhere on the same island, free of charge
function startMove(b) {
  selectTool(null);
  GAME.moving = b.id;
  closeInfo();
  const el = document.getElementById('banner');
  el.hidden = false;
  el.innerHTML = `↔ Flyt ${esc(DEFS[b.type].name.toLowerCase())}<small>Klik, hvor bygningen skal stå (samme ø) · Esc eller højreklik afbryder</small>`;
}

function cancelMove() {
  GAME.moving = null;
  document.getElementById('banner').hidden = true;
}

function finishMove(tx, ty) {
  const b = buildingById(GAME.moving);
  if (!b) { cancelMove(); return; }
  const r = checkPlacement(tx, ty, b.type, { move: b });
  if (!r.ok) { showToast(`❌ ${r.reason}`); return; }
  const def = DEFS[b.type];
  for (let dy = 0; dy < def.h; dy++) for (let dx = 0; dx < def.w; dx++) GAME.occupancy.delete(`${b.x + dx},${b.y + dy}`);
  b.x = tx;
  b.y = ty;
  for (let dy = 0; dy < def.h; dy++) for (let dx = 0; dx < def.w; dx++) GAME.occupancy.set(`${tx + dx},${ty + dy}`, b.id);
  b.harvestAt = null;
  cancelMove();
  if (b.type === 'warehouse') invalidateRoutes();
  updateIslandStats();
  recomputeConnectivity();
  revealAroundBuilding(b);
  sfx('build');
  log(`✓ ${def.name} flyttet`, 'ok');
  saveGame();
  openInfo('building', b.id);
}

function drawMoveGhost(b, tx, ty) {
  const def = DEFS[b.type];
  const ok = checkPlacement(tx, ty, b.type, { move: b }).ok;
  poly(ok ? 'rgba(100,200,100,0.3)' : 'rgba(200,100,100,0.3)', uvRect(tx - 0.5, ty - 0.5, tx + def.w - 0.5, ty + def.h - 0.5), ok ? '#64c864' : '#c86464');
  // Faint outline where it stands now
  poly('rgba(255,255,255,0.12)', uvRect(b.x - 0.5, b.y - 0.5, b.x + def.w - 0.5, b.y + def.h - 0.5), 'rgba(255,255,255,0.6)');
  ctx.globalAlpha = ok ? 0.7 : 0.4;
  drawBuilding({ ...b, x: tx, y: ty });
  ctx.globalAlpha = 1;
}

// Pipette: take the type of the building under the cursor as the build tool
function pipette() {
  const h = GAME.hoveredTile;
  const occ = h && GAME.occupancy.get(`${h.tx},${h.ty}`);
  const b = occ && occ !== 'road' && GAME.buildings.find(x => x.id === occ);
  if (!b || b.type === 'monument') return;
  if (b.type === 'warehouse' && GAME.phase !== 'play') return;
  selectTool(b.type);
  showToast(`📋 ${DEFS[b.type].name} valgt`);
}

function drawGhostBuilding(tx, ty, def) {
  const valid = canPlaceBuilding(tx, ty, def, true);
  ctx.globalAlpha = 0.5;

  for (let dy = 0; dy < def.h; dy++) {
    for (let dx = 0; dx < def.w; dx++) {
      const p = ISO.tileToScreen(tx + dx, ty + dy);
      const TW = ISO.TW, TH = ISO.TH;

      ctx.fillStyle = valid ? 'rgba(100, 200, 100, 0.3)' : 'rgba(200, 100, 100, 0.3)';
      ctx.strokeStyle = valid ? '#64c864' : '#c86464';
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.moveTo(p.x, p.y - TH / 2);
      ctx.lineTo(p.x + TW / 2, p.y);
      ctx.lineTo(p.x, p.y + TH / 2);
      ctx.lineTo(p.x - TW / 2, p.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  // Preview of the actual building on top of the footprint
  ctx.globalAlpha = valid ? 0.65 : 0.35;
  drawBuilding({ type: def.id, x: tx, y: ty });
  ctx.globalAlpha = 1;
}

// ----- Placement rules & costs -----
// Costs mix island goods with global coins
const hasCost = (stock, cost) => Object.entries(cost).every(([r, n]) => (r === 'coins' ? GAME.coins : (stock[r] || 0)) >= n);
const payCost = (stock, cost) => {
  for (const r in cost) {
    if (r === 'coins') GAME.coins -= cost[r];
    else stock[r] -= cost[r];
  }
};
const fmtCost = (cost) => {
  const parts = Object.entries(cost).map(([r, n]) => `${RES_ICONS[r]} ${n}`);
  return parts.length ? parts.join(' ') : 'Gratis';
};
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const touchesWater = (x, y) => DIRS.some(([dx, dy]) => tileAt(x + dx, y + dy)?.type === 'water');

// What placing `type` on island `isl` costs, which island pays, and whether it's blocked (and why).
function placementCost(type, isl) {
  const def = DEFS[type];
  if (type === 'warehouse') {
    if (GAME.phase === 'setup') {
      const block = !isl ? 'Skal bygges på land' : !isl.start ? 'Dit første lager skal ligge på den store hovedø' : null;
      return { cost: {}, payer: isl, kind: 'start', block };
    }
    if (!isl) return { cost: FOUNDING_COST, payer: null, kind: 'found', block: 'Skal bygges på land' };
    if (isl.warehouses > 0) {
      const need = EXTRA_WAREHOUSE_POP * isl.warehouses;
      return {
        cost: extraWarehouseCost(isl.warehouses), payer: isl, kind: 'extra',
        block: isl.pop < need ? `Kræver ${need} indbyggere på ${isl.name} (har ${isl.pop})` : null
      };
    }
    // Founding a new island: the materials are shipped over from an island that can pay (home first)
    if (!GAME.ships.length) return { cost: FOUNDING_COST, payer: null, kind: 'found', block: 'Kræver et skib for at grundlægge en ny ø' };
    const payers = [...GAME.islands.values()].filter(i => i.warehouses > 0);
    const payer = payers.find(i => i.home && hasCost(i.resources, FOUNDING_COST)) ||
                  payers.find(i => hasCost(i.resources, FOUNDING_COST)) || homeIsland();
    return { cost: FOUNDING_COST, payer, kind: 'found', block: null };
  }
  if (def.tier && GAME.tierReached < def.tier) return { cost: def.cost, payer: isl, block: `Låses op, når du har ${tierName(def.tier)}` };
  if (type === 'monument' && totalNobles() < MONUMENT_POP) {
    return { cost: def.cost, payer: isl, block: `Kræver ${MONUMENT_POP} Adelige i alt (har ${Math.floor(totalNobles())})` };
  }
  if (!isl) return { cost: def.cost, payer: null, block: 'Skal bygges på land' };
  if (isl.warehouses === 0) return { cost: def.cost, payer: isl, block: `Byg først et lager på ${isl.name}` };
  if (def.fertility && !isl.fertility.includes(def.fertility)) {
    return { cost: def.cost, payer: isl, block: `${isl.name} har ikke frugtbarhed til ${FERTILITY[def.fertility].name.toLowerCase()}` };
  }
  return { cost: def.cost, payer: isl, block: null };
}

// Full placement check. Returns { ok, reason, cost, payer, kind }.
// opts.move: an existing building being relocated (its own tiles count as free, nothing is paid)
function checkPlacement(tx, ty, type, opts = {}) {
  const def = DEFS[type];
  const mv = opts.move;
  const no = (reason) => ({ ok: false, reason });
  if (tx < 0 || ty < 0 || tx + def.w > MAP_SIZE || ty + def.h > MAP_SIZE) return no('Uden for kortet');

  for (let dy = 0; dy < def.h; dy++) {
    for (let dx = 0; dx < def.w; dx++) {
      const key = `${tx + dx},${ty + dy}`;
      if (!isSeen(tx + dx, ty + dy)) return no('Området er ikke udforsket endnu – send et skib på opdagelse');
      const occ = GAME.occupancy.get(key);
      if (occ && !(mv && occ === mv.id)) return no('Feltet er optaget');
      const tt = tileAt(tx + dx, ty + dy), ttype = tt?.type;
      // Roads may cut through forest (the trees are felled) and cross canals as bridges;
      // everything else needs open ground
      const roadOk = type === 'road' && (ttype === 'forest' || tt?.canal);
      if (!isLandType(ttype) && !roadOk) return no('Kan kun bygges på græs eller sand');
    }
  }
  // A bridge tile is water itself, so it belongs to the island of the land it touches
  let islTile = tileAt(tx, ty);
  if (!isLand(islTile)) islTile = DIRS.map(([dx, dy]) => tileAt(tx + dx, ty + dy)).find(t => isLand(t) && GAME.islands.get(t.island)?.warehouses) || islTile;
  const isl = GAME.islands.get(islTile.island);
  if (isl?.owner === 'rival') return no(`${isl.name} tilhører ${RIVAL_NAME}`);
  if (isl?.pirate && GAME.pirates?.fortHp > 0) return no('Piraternes ø – ødelæg først deres fort med et krigsskib');
  let pc;
  if (mv) {
    if (isl !== islandOfBuilding(mv)) return no('En bygning kan kun flyttes rundt på sin egen ø');
    pc = { cost: {}, payer: null, block: null, kind: 'move' };
  } else pc = placementCost(type, isl);

  // Ports (shipyard and every island's first warehouse) must face the open sea so ships can reach them;
  // other coastal buildings (fisher) just need water. A warehouse that ships use must stay a port when moved.
  const around = footprintNeighbors({ type, x: tx, y: ty }).map(([x, y]) => tileAt(x, y));
  const isPort = type === 'shipyard' || pc.kind === 'start' || pc.kind === 'found' ||
    (mv && type === 'warehouse' && dockTiles(mv).length > 0);
  if (isPort && !around.some(t => t?.ocean)) return no(`${def.name} skal ligge ud til havet (ikke en sø)`);
  if (def.coastal && !around.some(t => t?.type === 'water')) return no(`${def.name} skal ligge ud til vandet`);

  if (def.near) {
    const r = def.near.radius ?? 4, min = def.near.min ?? 2;
    let count = 0;
    for (let dy = -r; dy < def.h + r; dy++) {
      for (let dx = -r; dx < def.w + r; dx++) {
        const nt = tileAt(tx + dx, ty + dy);
        if (def.near.key ? nt?.[def.near.key] > 0 : nt?.type === def.near.terrain) count++;
      }
    }
    if (count < min) return no(`Ikke nok ${def.near.label} i nærheden`);
  }

  if (pc.block) return no(pc.block);
  if (pc.payer && !hasCost(pc.payer.resources, pc.cost)) return { ...no(`Ikke nok materialer på ${pc.payer.name}`), afford: false };
  return { ok: true, ...pc };
}

// Moves the founding supplies (as much as is available) from one island to a newly founded one
function deliverSupplies(from, to) {
  const got = {};
  for (const [k, n] of Object.entries(FOUNDING_SUPPLIES)) {
    const amt = Math.floor(Math.min(n, from?.resources[k] || 0));
    if (from) from.resources[k] -= amt;
    to.resources[k] += amt;
    if (amt) got[k] = amt;
  }
  to.supplied = true;
  return got;
}

// quiet = true for per-frame checks (ghost preview) so the log isn't flooded
function canPlaceBuilding(tx, ty, def, quiet = false) {
  const r = checkPlacement(tx, ty, def.id);
  if (!r.ok && !quiet) log(r.reason, 'err');
  return r.ok;
}

function placeBuilding(tx, ty, type) {
  const def = DEFS[type];
  const r = checkPlacement(tx, ty, type);
  if (!r.ok) {
    log(`❌ ${r.reason}`, 'err');
    showToast(`❌ ${r.reason}`);
    return false;
  }
  if (r.payer) payCost(r.payer.resources, r.cost);

  const bid = 'b_' + Math.random().toString(36).slice(2, 8);
  const b = { id: bid, type, x: tx, y: ty };
  if (type === 'shipyard') b.queue = null;
  if (def.house) b.level = 1;
  GAME.buildings.push(b);
  for (let dy = 0; dy < def.h; dy++) {
    for (let dx = 0; dx < def.w; dx++) GAME.occupancy.set(`${tx + dx},${ty + dy}`, bid);
  }

  const isl = islandOfBuilding(b);
  if (r.kind === 'start') {
    isl.home = true;
    isl.name = 'Hjemøen';
    Object.assign(isl.resources, START_STOCK);
  }
  updateIslandStats();
  revealAroundBuilding(b);
  sfx(type === 'monument' ? 'fanfare' : 'build');

  if (r.kind === 'found') {
    const got = deliverSupplies(r.payer, isl);
    log(`✓ ${isl.name} er grundlagt – materialer sejlet over fra ${r.payer.name}`, 'ok');
    notify(`⚓ ${isl.name} er grundlagt! Skibet havde ${fmtCost(got)} med som startforsyning`);
  } else {
    log(`✓ ${def.name} bygget på ${isl.name}`, 'ok');
  }
  selectTool(null);
  if (r.kind === 'start') startPlaying();
  if (type === 'monument' && !GAME.won) showVictory();
  recomputeConnectivity();
  saveGame();
  return true;
}

function placeRoads(tiles) {
  let built = 0, felled = 0, bridges = 0;
  for (const t of tiles) {
    if (isRoad(t.tx, t.ty) || !canPlaceBuilding(t.tx, t.ty, DEFS.road, true)) continue;
    const key = `${t.tx},${t.ty}`;
    const tile = tileAt(t.tx, t.ty);
    if (tile.type === 'forest') { tile.type = 'grass'; felled++; }
    if (tile.canal) bridges++;
    GAME.roads.add(key);
    GAME.occupancy.set(key, 'road');
    built++;
  }
  if (felled) decorateTerrain(GAME.grid); // re-dress the cleared tiles as grass
  if (bridges) {
    const before = GAME.islands.size;
    recomputeIslands(); // a bridge can join two islands into one
    if (GAME.islands.size < before) notify('🌉 Broen forbinder to øer – deres lagre er slået sammen');
  }
  if (built) log(`✓ ${built} vejfelt${built > 1 ? 'er' : ''} bygget${felled ? ` (${felled} træer fældet)` : ''}${bridges ? ` (${bridges} bro)` : ''}`, 'ok');
  else log('Ingen gyldige felter til vej', 'err');
  recomputeConnectivity();
  if (built) saveGame();
}

// Canals are dug in order along the drag path, so each new tile may connect to the previous one.
// `water` holds keys that will already be water at that point (for previews).
function canalCheck(x, y, water = new Set(), spent = new Map()) {
  const t = tileAt(x, y);
  if (!t || !isLandType(t.type)) return { ok: false, reason: 'Kanaler kan kun graves i græs eller sand' };
  if (!isSeen(x, y)) return { ok: false, reason: 'Området er ikke udforsket endnu' };
  if (GAME.occupancy.has(`${x},${y}`)) return { ok: false, reason: 'Feltet er optaget' };
  if (!DIRS.some(([dx, dy]) => tileAt(x + dx, y + dy)?.type === 'water' || water.has(`${x + dx},${y + dy}`))) {
    return { ok: false, reason: 'En kanal skal forbindes til vand' };
  }
  const isl = GAME.islands.get(t.island);
  if (!isl.warehouses) return { ok: false, reason: `Byg først et lager på ${isl.name}` };
  const n = (spent.get(isl) || 0) + 1;
  const total = Object.fromEntries(Object.entries(DEFS.canal.cost).map(([r, c]) => [r, c * n]));
  if (!hasCost(isl.resources, total)) return { ok: false, reason: `Ikke nok materialer på ${isl.name}` };
  return { ok: true, payer: isl };
}

// Per-tile validity for a canal drag, simulating the tiles dug before it
function canalPlan(tiles) {
  const water = new Set(), spent = new Map();
  return tiles.map(t => {
    const r = canalCheck(t.tx, t.ty, water, spent);
    if (r.ok) { water.add(`${t.tx},${t.ty}`); spent.set(r.payer, (spent.get(r.payer) || 0) + 1); }
    return r;
  });
}

function placeCanals(tiles) {
  const plan = canalPlan(tiles);
  let dug = 0;
  plan.forEach((r, i) => {
    if (!r.ok) return;
    payCost(r.payer.resources, DEFS.canal.cost);
    const t = tileAt(tiles[i].tx, tiles[i].ty);
    t.type = 'water';
    t.canal = true;
    dug++;
  });
  if (!dug) {
    const reason = plan.find(r => !r.ok)?.reason || 'Ingen gyldige felter til kanal';
    log(`❌ ${reason}`, 'err');
    showToast(`❌ ${reason}`);
    return;
  }
  const before = GAME.islands.size;
  recomputeIslands();
  decorateTerrain(GAME.grid);
  recomputeConnectivity();
  log(`✓ ${dug} kanalfelt${dug > 1 ? 'er' : ''} gravet`, 'ok');
  if (GAME.islands.size > before) showToast('🌊 Kanalen har delt øen i to');
  saveGame();
}

function demolishAt(tx, ty) {
  const key = `${tx},${ty}`;
  const occ = GAME.occupancy.get(key);
  const tile = tileAt(tx, ty);

  // Demolishing an empty canal tile fills it back in
  if (!occ && tile?.canal) {
    tile.type = 'grass';
    tile.canal = false;
    recomputeIslands();
    decorateTerrain(GAME.grid);
    recomputeConnectivity();
    log(`✓ Kanal fyldt op ved ${key}`, 'ok');
    saveGame();
    return;
  }
  if (!occ) return;

  if (occ === 'road') {
    const wasBridge = isBridge(tile);
    GAME.roads.delete(key);
    GAME.occupancy.delete(key);
    if (wasBridge) recomputeIslands(); // removing a bridge may split the island again
    log(`✓ ${wasBridge ? 'Bro' : 'Vej'} fjernet ved ${key}`, 'ok');
    recomputeConnectivity();
    saveGame();
    return;
  }

  const b = GAME.buildings.find(bb => bb.id === occ);
  if (!b) {
    showToast(`❌ Du kan ikke rive ${RIVAL_NAME}s bygninger ned`);
    return;
  }
  const def = DEFS[b.type];
  const isl = islandOfBuilding(b);
  if (b.type === 'warehouse' && isl.warehouses === 1) {
    const others = GAME.buildings.some(o => o !== b && islandOfBuilding(o) === isl);
    if (others || isl.home) {
      log('❌ Du kan ikke rive øens sidste lager ned', 'err');
      showToast('❌ Du kan ikke rive øens sidste lager ned');
      return;
    }
  }

  GAME.buildings.splice(GAME.buildings.indexOf(b), 1);
  for (let dy = 0; dy < def.h; dy++) {
    for (let dx = 0; dx < def.w; dx++) GAME.occupancy.delete(`${b.x + dx},${b.y + dy}`);
  }
  // Ships lose routes that used this warehouse
  if (b.type === 'warehouse') {
    for (const r of GAME.routes.filter(r => r.from === b.id || r.to === b.id)) deleteRoute(r);
  }

  updateIslandStats();
  for (const r of RES_KEYS) isl.resources[r] = Math.min(isl.resources[r], isl.cap);
  for (const r in def.cost) {
    if (r === 'coins') GAME.coins += Math.floor(def.cost[r] / 2);
    else isl.resources[r] = Math.min(isl.cap, isl.resources[r] + Math.floor(def.cost[r] / 2));
  }

  log(`✓ ${def.name} revet ned`, 'ok');
  sfx('demolish');
  if (GAME.selectedInfo?.id === b.id) closeInfo();
  recomputeConnectivity();
  saveGame();
}

// Tiles orthogonally adjacent to a building's footprint
function footprintNeighbors(b) {
  const def = DEFS[b.type], out = [];
  for (let dx = 0; dx < def.w; dx++) {
    out.push([b.x + dx, b.y - 1], [b.x + dx, b.y + def.h]);
  }
  for (let dy = 0; dy < def.h; dy++) {
    out.push([b.x - 1, b.y + dy], [b.x + def.w, b.y + dy]);
  }
  return out;
}

// Water tiles next to a building, where ships dock
const dockTiles = (b) => footprintNeighbors(b).filter(([x, y]) => tileAt(x, y)?.type === 'water');

// Flood-fill the road network outwards from every warehouse,
// then mark each building that touches a reached road tile
function recomputeConnectivity() {
  const reached = new Set();
  const queue = [];
  for (const b of GAME.buildings) {
    if (b.type !== 'warehouse') continue;
    for (const [x, y] of footprintNeighbors(b)) {
      const k = `${x},${y}`;
      if (GAME.roads.has(k) && !reached.has(k)) { reached.add(k); queue.push([x, y]); }
    }
  }
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of DIRS) {
      const k = `${x + dx},${y + dy}`;
      if (GAME.roads.has(k) && !reached.has(k)) { reached.add(k); queue.push([x + dx, y + dy]); }
    }
  }

  GAME.connected.clear();
  for (const b of GAME.buildings) {
    if (b.type === 'warehouse' || footprintNeighbors(b).some(([x, y]) => reached.has(`${x},${y}`))) {
      GAME.connected.add(b.id);
    }
  }
}

function startPlaying() {
  GAME.phase = 'play';
  document.getElementById('banner').hidden = true;
  openBuildCategory('food');
  if (GAME.settings.rival && !GAME.rival) initRival();
  log('Lageret er placeret. Byg en fisker, så beboerne har mad, og forbind den med vej.', 'ok');
}

function selectTool(type) {
  if (type && GAME.routeDraw) cancelRouteDraw();
  if (type && GAME.moving) cancelMove();
  if (type && GAME.shipOrder) cancelShipOrder();
  GAME.selectedBuilding = type;
  GAME.roadDrag = null;
  refreshMenuState();
}

// The island the build menu shows prices for: under the cursor while placing, otherwise at screen centre
function activeIsland() {
  const h = GAME.hoveredTile;
  const ht = GAME.selectedBuilding && h ? tileAt(h.tx, h.ty) : null;
  if (isLand(ht)) return GAME.islands.get(ht.island);
  const c = screenToWorld(canvas.width / 2, canvas.height / 2);
  const ct = ISO.screenToTile(c.x, c.y);
  const t = tileAt(ct.tx, ct.ty);
  return (isLand(t) && GAME.islands.get(t.island)) || homeIsland() || null;
}
