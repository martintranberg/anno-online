'use strict';

// ===== BUILD MENU =====
let openCategory = null;

const menuPlacement = (id) => DEFS[id] ? placementCost(id, activeIsland()) : null;

function canAfford(id) {
  if (GAME.phase === 'setup' && id === 'warehouse') return true;
  const r = menuPlacement(id);
  if (!r) return true;
  if (r.block) return false;
  return !r.payer || hasCost(r.payer.resources, r.cost);
}

function costLabel(id) {
  const r = menuPlacement(id);
  return r ? fmtCost(r.cost) : '—';
}

function buildMenu() {
  const tabs = document.getElementById('build-tabs');
  CATEGORIES.forEach((cat, i) => {
    const t = document.createElement('button');
    t.className = 'build-tab';
    t.dataset.cat = cat.id;
    t.innerHTML = `<span class="tab-icon">${cat.icon}</span>${cat.name}<span class="tab-key">${i + 1}</span>`;
    t.addEventListener('click', () => openBuildCategory(openCategory === cat.id ? null : cat.id));
    tabs.appendChild(t);
  });
}

function openBuildCategory(id) {
  openCategory = id;
  const panel = document.getElementById('build-panel');
  panel.hidden = !id;
  if (id) {
    const cat = CATEGORIES.find(c => c.id === id);
    panel.innerHTML = `<div class="panel-title">${cat.icon} ${cat.name}</div><div class="cards"></div><div class="panel-desc"></div>`;
    const cards = panel.querySelector('.cards');
    const desc = panel.querySelector('.panel-desc');
    for (const itemId of cat.items) {
      const info = itemInfo(itemId);
      const def = DEFS[itemId];
      const card = document.createElement('button');
      card.className = 'build-card';
      card.dataset.bid = itemId;
      card.innerHTML = `<canvas></canvas><div class="card-name">${info.name}</div>` +
        `<div class="card-meta"><span class="card-cost"></span><span class="card-size">${def ? `${def.w}×${def.h}` : ''}</span></div>`;
      card.addEventListener('click', () => selectTool(GAME.selectedBuilding === itemId ? null : itemId));
      card.addEventListener('mouseenter', () => {
        const block = menuPlacement(itemId)?.block;
        desc.textContent = block && !(GAME.phase === 'setup' && itemId === 'warehouse') ? `🔒 ${block}` : info.desc;
      });
      card.addEventListener('mouseleave', () => {
        desc.textContent = GAME.selectedBuilding ? itemInfo(GAME.selectedBuilding).desc : '';
      });
      cards.appendChild(card);
      drawPreview(card.querySelector('canvas'), itemId);
    }
  }
  refreshMenuState();
}

// Sync tabs/cards with phase, selection and affordability (cheap; runs every frame)
function refreshMenuState() {
  const setup = GAME.phase === 'setup';
  document.querySelectorAll('.build-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.cat === openCategory);
    t.disabled = setup && t.dataset.cat !== 'harbor';
  });
  document.querySelectorAll('.build-card').forEach(card => {
    const id = card.dataset.bid;
    card.classList.toggle('active', GAME.selectedBuilding === id);
    card.classList.toggle('unaffordable', !canAfford(id));
    card.disabled = setup && id !== 'warehouse';
    const cost = card.querySelector('.card-cost');
    const label = costLabel(id);
    if (cost.textContent !== label) cost.textContent = label;
  });
}

// Render a building (or tool) into a card canvas by temporarily redirecting `ctx`
const PREVIEW_H = { park: 40, fountain: 50, statue: 70, house: 40, woodcutter: 52, sawmill: 62, warehouse: 74, stonecutter: 52, road: 10,
                    canal: 10, fisher: 46, grainfarm: 40, pigfarm: 44, cattlefarm: 50, shipyard: 70,
                    sheepfarm: 40, weaver: 60, hopfarm: 60, brewery: 62, forester: 44,
                    claypit: 36, brickworks: 70, charcoal: 50, mine: 44, smithy: 64, marketplace: 36, chapel: 80,
                    tavern: 70, firestation: 60, monument: 110, theater: 70, vineyard: 36, winery: 56, goldmine: 44,
                    goldsmith: 60, watchtower: 70 };

function drawPreview(cv, id) {
  const dpr = window.devicePixelRatio || 1, cw = 96, ch = 72;
  cv.width = cw * dpr;
  cv.height = ch * dpr;
  cv.style.width = cw + 'px';
  cv.style.height = ch + 'px';

  const mainCtx = ctx;
  ctx = cv.getContext('2d');
  try {
    ctx.scale(dpr, dpr);
    if (id === 'demolish') {
      ctx.font = '38px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔨', cw / 2, ch / 2 + 2);
      return;
    }

    // Roads and canals are previewed as a small bend, far away from any real map tiles
    const isRoadPreview = id === 'road' || id === 'canal';
    const ox = isRoadPreview ? -1000 : 0, oy = ox;
    const w = isRoadPreview ? 2 : DEFS[id].w, h = isRoadPreview ? 2 : DEFS[id].h;

    const left = P(ox - 0.5, oy + h - 0.5).x, right = P(ox + w - 0.5, oy - 0.5).x;
    const bottom = P(ox + w - 0.5, oy + h - 0.5).y;
    const s = Math.min(cw / (right - left + 10), ch / ((w + h) * 16 + PREVIEW_H[id]));
    ctx.translate(cw / 2 - ((left + right) / 2) * s, ch - 3 - bottom * s);
    ctx.scale(s, s);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) drawTile(ox + x, oy + y, { type: 'grass' });
    }

    if (id === 'canal') {
      const bend = [[ox, oy + 1], [ox + 1, oy + 1], [ox + 1, oy]];
      for (const [x, y] of bend) {
        drawTile(x, y, { type: 'water', color: '#4aa8cc' });
        // Stone quay along the sides facing land
        for (const [dx, dy] of DIRS) {
          if (bend.some(([bx, by]) => bx === x + dx && by === y + dy)) continue;
          drawQuay(x, y, dx, dy);
        }
      }
    } else if (isRoadPreview) {
      const keys = [`${ox},${oy + 1}`, `${ox + 1},${oy + 1}`, `${ox + 1},${oy}`];
      keys.forEach(k => GAME.roads.add(k));
      try {
        keys.forEach(k => { const [x, y] = k.split(',').map(Number); drawRoad(x, y); });
      } finally {
        keys.forEach(k => GAME.roads.delete(k));
      }
    } else {
      drawBuilding({ type: id, x: 0, y: 0 });
    }
  } finally {
    ctx = mainCtx;
  }
}

function render() {
  ctx.fillStyle = SEA_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(canvas.width / 2 - GAME.camera.x * GAME.camera.zoom,
                canvas.height / 2 - GAME.camera.y * GAME.camera.zoom);
  ctx.scale(GAME.camera.zoom, GAME.camera.zoom);

  // Visible world rectangle; objects outside it are skipped (culling).
  // Generous margins because buildings/trees extend upwards and sideways from their anchor.
  const cam = GAME.camera;
  const hw = canvas.width / 2 / cam.zoom, hh = canvas.height / 2 / cam.zoom;
  // Margins: side = left/right, top = above the top edge, bottom = below the bottom edge
  // (tall objects anchored below the screen can still reach up into view)
  const inView = (p, side = 40, top = 24, bottom = 40) =>
    p.x > cam.x - hw - side && p.x < cam.x + hw + side &&
    p.y > cam.y - hh - top && p.y < cam.y + hh + bottom;
  const seenAt = (x, y) => isSeen(Math.round(x), Math.round(y));

  // Only the tiles in the bounding box (in tile space) of the visible screen area are looked at
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [sx, sy] of [[cam.x - hw, cam.y - hh], [cam.x + hw, cam.y - hh], [cam.x + hw, cam.y + hh], [cam.x - hw, cam.y + hh]]) {
    const tx = (sx / 32 + sy / 16) / 2, ty = (sy / 16 - sx / 32) / 2;
    x0 = Math.min(x0, tx); x1 = Math.max(x1, tx); y0 = Math.min(y0, ty); y1 = Math.max(y1, ty);
  }
  const M = 4; // tall objects below the screen can reach up into view
  x0 = Math.max(0, Math.floor(x0) - 2); y0 = Math.max(0, Math.floor(y0) - 2);
  x1 = Math.min(MAP_SIZE - 1, Math.ceil(x1) + M); y1 = Math.min(MAP_SIZE - 1, Math.ceil(y1) + M);
  const visibleTiles = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) visibleTiles.push(GAME.grid[y * MAP_SIZE + x]);

  // Flat ground first (terrain + roads), then upright objects (trees + buildings) sorted by depth.
  // Unexplored tiles are covered by one pre-rendered fog layer.
  let fogged = false;
  const lowDetail = cam.zoom < GROUND_LOD_ZOOM;
  if (lowDetail) drawGroundLayer();
  for (const tile of visibleTiles) {
    if (!GAME.seen[tile.y * MAP_SIZE + tile.x]) { fogged = true; continue; }
    if (!lowDetail && inView(ISO.tileToScreen(tile.x, tile.y))) drawTile(tile.x, tile.y, tile);
  }
  for (const key of GAME.roads) {
    const [x, y] = key.split(',').map(Number);
    if (inView(ISO.tileToScreen(x, y))) drawRoad(x, y);
  }
  if (fogged) drawFogLayer();

  const items = [];
  for (const tile of visibleTiles) {
    if (!GAME.seen[tile.y * MAP_SIZE + tile.x]) continue;
    if (tile.type === 'forest' && inView(ISO.tileToScreen(tile.x, tile.y), 40, 24, 60)) {
      items.push({ depth: tile.x + tile.y, draw: () => drawForest(tile.x, tile.y, tile) });
    } else if (tile.object && !GAME.occupancy.has(`${tile.x},${tile.y}`) && inView(ISO.tileToScreen(tile.x, tile.y), 40, 24, 60)) {
      // Lone trees and bushes on open grass (hidden once something is built on the tile)
      const o = tile.object;
      items.push({
        depth: tile.x + tile.y,
        draw: () => o.k === 'bush'
          ? bush(tile.x + o.u, tile.y + o.v, o.s)
          : drawTreeAt(tile.x + o.tree.u, tile.y + o.tree.v, o.tree)
      });
    } else if (tile.type === 'rock' && inView(ISO.tileToScreen(tile.x, tile.y), 40, 24, 80)) {
      // Grouped rock tiles form a mountain (drawn per tile so depth sorting still works); lone ones are boulders
      items.push({
        depth: tile.x + tile.y,
        draw: tile.mountain ? () => drawMountainTile(tile) : () => drawRock(tile.x, tile.y, tile)
      });
    }
  }
  const visibleBuildings = GAME.buildings.filter(b => {
    const def = DEFS[b.type];
    return inView(ISO.tileToScreen(b.x + (def.w - 1) / 2, b.y + (def.h - 1) / 2), 120, 80, 140);
  });
  const sel = GAME.selectedInfo;
  for (const b of visibleBuildings) {
    const def = DEFS[b.type];
    const d = (b.x + def.w - 1) + (b.y + def.h - 1);
    if ((sel?.kind === 'building' && sel.id === b.id) || (sel?.kind === 'economy' && sel.focus === b.id)) {
      // Gold outline around the inspected building's footprint (flat, so drawn before objects)
      poly('rgba(255,215,0,0.18)', uvRect(b.x - 0.5, b.y - 0.5, b.x + def.w - 0.5, b.y + def.h - 0.5), '#ffd700');
    }
    if (GAME.moving === b.id) continue; // drawn at the cursor instead
    items.push({ depth: d, draw: () => { drawBuilding(b); if (prodLevel(b) > 1) drawLevelStars(b); } });
  }
  // Rival colonies (red pennants)
  for (const b of GAME.rival?.buildings || []) {
    const def = DEFS[b.type];
    if (!seenAt(b.x, b.y) || !inView(ISO.tileToScreen(b.x + (def.w - 1) / 2, b.y + (def.h - 1) / 2), 120, 80, 140)) continue;
    if (sel?.kind === 'rival' && sel.id === b.id) {
      poly('rgba(255,120,100,0.18)', uvRect(b.x - 0.5, b.y - 0.5, b.x + def.w - 0.5, b.y + def.h - 0.5), RIVAL_COLOR);
    }
    items.push({ depth: (b.x + def.w - 1) + (b.y + def.h - 1), draw: () => drawRivalBuilding(b) });
  }
  // Pirate fort
  const PF = GAME.pirates;
  if (PF?.fort && PF.fortHp > 0 && seenAt(PF.fort.x, PF.fort.y) && inView(P(PF.fort.x, PF.fort.y), 120, 80, 140)) {
    items.push({ depth: PF.fort.x + PF.fort.y + 2, draw: () => drawPirateFort(PF) });
  }
  const T = GAME.trader;
  if (T && seenAt(T.x, T.y) && inView(P(T.x, T.y), 60, 30, 60)) items.push({ depth: T.x + T.y, draw: () => drawShip(T, false) });
  const RS = GAME.rival?.ship;
  if (RS && seenAt(RS.x, RS.y) && inView(P(RS.x, RS.y), 60, 30, 60)) items.push({ depth: RS.x + RS.y, draw: () => drawShip(RS, false) });
  const raider = PF?.ship;
  if (raider && seenAt(raider.x, raider.y) && inView(P(raider.x, raider.y), 60, 30, 60)) {
    items.push({ depth: raider.x + raider.y, draw: () => drawShip(raider, false) });
  }
  if (cam.zoom >= LIFE_ZOOM) {
    for (const w of life.walkers) if (inView(P(w.x, w.y), 20, 20, 20)) items.push({ depth: w.x + w.y, draw: () => drawWalker(w) });
  }
  for (const s of GAME.ships) {
    if (inView(P(s.x, s.y), 60, 30, 60)) {
      items.push({ depth: s.x + s.y, draw: () => drawShip(s, sel?.kind === 'ship' && sel.id === s.id) });
    }
  }

  items.sort((a, b) => a.depth - b.depth);
  items.forEach(it => it.draw());

  // Warning bubbles over production buildings without a road link
  for (const b of visibleBuildings) {
    if (needsRoad(DEFS[b.type]) && !GAME.connected.has(b.id) && !b.roadExempt) drawNoRoadIcon(b);
  }

  drawRouteOverlay();
  drawServiceOverlay();
  drawCombat();
  for (const b of visibleBuildings) {
    if (b.fire) drawFire(b);
    else if (b.paused) drawStatusBubble(b, '⏸', '#6a6a6a');
    else if (b.status === 'nocoins') drawStatusBubble(b, '💸', '#8a3a2a');
  }

  // Placement / tool preview
  if (GAME.moving && GAME.hoveredTile) {
    const b = buildingById(GAME.moving);
    if (b) drawMoveGhost(b, GAME.hoveredTile.tx, GAME.hoveredTile.ty);
  } else if (GAME.selectedBuilding && GAME.hoveredTile) {
    if (GAME.selectedBuilding === 'road') drawRoadGhost();
    else if (GAME.selectedBuilding === 'canal') drawCanalGhost();
    else if (GAME.selectedBuilding === 'demolish') drawDemolishGhost();
    else drawGhostBuilding(GAME.hoveredTile.tx, GAME.hoveredTile.ty, DEFS[GAME.selectedBuilding]);
  }
  if (GAME.shipOrder && GAME.hoveredTile) {
    const { tx, ty } = GAME.hoveredTile, ok = isWater(tx, ty);
    drawTileHighlight(tx, ty, ok ? 'rgba(120,200,255,0.4)' : 'rgba(220,80,80,0.35)', ok ? '#bfe6ff' : '#e05050');
  }

  ctx.restore();
  if (GAME.storm > 0) drawStorm();
}

// Unexplored area: a cloud texture masked by the fog, pre-rendered at FOG_RES px per tile and drawn with one
// transformed drawImage per frame. The mask is rebuilt only when new tiles are revealed; the bilinear scaling
// of the tiny mask gives the soft edge.
const FOG_RES = 4;
const fogLayer = { canvas: null, clouds: null, mask: null, dirty: true, size: 0 };
function rebuildFogLayer() {
  const N = MAP_SIZE, S = N * FOG_RES;
  if (fogLayer.size !== N) {
    fogLayer.size = N;
    fogLayer.canvas = document.createElement('canvas');
    fogLayer.canvas.width = fogLayer.canvas.height = S;
    fogLayer.mask = document.createElement('canvas');
    fogLayer.mask.width = fogLayer.mask.height = N;
    // Static cloud texture: dark blue-grey with soft lighter billows
    fogLayer.clouds = document.createElement('canvas');
    fogLayer.clouds.width = fogLayer.clouds.height = S;
    const g = fogLayer.clouds.getContext('2d'), img = g.createImageData(S, S), d = img.data;
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const n = fbm(px / 9 + 300, py / 9 + 700), m = valueNoise(px / 3.5 + 50, py / 3.5 + 90);
        const k = Math.max(0, n - 0.45) * 1.6 + m * 0.08;
        const i = (py * S + px) * 4;
        d[i] = 28 + k * 110; d[i + 1] = 42 + k * 115; d[i + 2] = 58 + k * 120; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }
  // Mask: unexplored tiles opaque, explored tiles on the border half-covered for a soft edge
  const mg = fogLayer.mask.getContext('2d'), mi = mg.createImageData(N, N), md = mi.data;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let a = 0;
      if (!GAME.seen[y * N + x]) a = 255;
      else {
        for (let dy = -1; dy <= 1 && !a; dy++) for (let dx = -1; dx <= 1 && !a; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < N && ny < N && !GAME.seen[ny * N + nx]) a = 110;
        }
      }
      md[(y * N + x) * 4 + 3] = a;
    }
  }
  mg.putImageData(mi, 0, 0);
  const fg = fogLayer.canvas.getContext('2d');
  fg.globalCompositeOperation = 'copy';
  fg.imageSmoothingEnabled = true;
  fg.drawImage(fogLayer.mask, 0, 0, S, S);
  fg.globalCompositeOperation = 'source-in';
  fg.drawImage(fogLayer.clouds, 0, 0);
  fg.globalCompositeOperation = 'source-over';
  fogLayer.dirty = false;
}

function drawFogLayer() {
  if (fogLayer.dirty || fogLayer.size !== MAP_SIZE) rebuildFogLayer();
  const k = FOG_RES;
  ctx.save();
  // Pixel (px, py) of the layer covers tile (px / k - 0.5, py / k - 0.5)
  ctx.transform(32 / k, 16 / k, -32 / k, 16 / k, 0, -16);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fogLayer.canvas, 0, 0);
  ctx.restore();
}

// Gold stars over an upgraded production building
function drawLevelStars(b) {
  const def = DEFS[b.type], n = prodLevel(b) - 1;
  const p = P(b.x - 0.5 + def.w, b.y - 0.5, 40);
  for (let i = 0; i < n; i++) {
    const x = p.x - 6 + i * 12, y = p.y;
    const pts = [];
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 2.8 : 6.5;
      pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
    }
    poly('#f0c83a', pts, '#7a5a10');
  }
}

// ===== CAMERA =====
const ZOOM_MIN = 0.35, ZOOM_MAX = 2.5;
const mouse = { x: null, y: null }; // last cursor position in canvas pixels (null = off canvas)

function screenToWorld(px, py) {
  return {
    x: (px - canvas.width / 2) / GAME.camera.zoom + GAME.camera.x,
    y: (py - canvas.height / 2) / GAME.camera.zoom + GAME.camera.y
  };
}

// Keep the camera centre over the map
function clampCamera() {
  const c = GAME.camera, ext = (MAP_SIZE - 1) * 32;
  c.x = Math.max(-ext, Math.min(ext, c.x));
  c.y = Math.max(0, Math.min(ext, c.y));
}

// Zoom by a factor while keeping the world point under (px, py) fixed
function zoomAt(factor, px = canvas.width / 2, py = canvas.height / 2) {
  const before = screenToWorld(px, py);
  GAME.camera.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, GAME.camera.zoom * factor));
  const after = screenToWorld(px, py);
  GAME.camera.x += before.x - after.x;
  GAME.camera.y += before.y - after.y;
  clampCamera();
  updateHover();
}

function centerOn(tx, ty) {
  const p = ISO.tileToScreen(tx, ty);
  GAME.camera.x = p.x;
  GAME.camera.y = p.y;
  clampCamera();
}

function centerHome() {
  const wh = GAME.buildings.find(b => b.type === 'warehouse');
  if (wh) centerOn(wh.x + 0.5, wh.y + 0.5);
  else centerOn(MAP_SIZE / 2, MAP_SIZE / 2);
}

function updateHover() {
  if (mouse.x === null) { GAME.hoveredTile = null; return; }
  const w = screenToWorld(mouse.x, mouse.y);
  GAME.hoveredTile = ISO.screenToTile(w.x, w.y);
}

function setMouse(e) {
  const rect = canvas.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
}

// ===== INPUT =====
// Left-drag pans the map (a short press without movement counts as a click).
// Right/middle-drag always pans. With the road tool, left-drag lays roads instead.
const DRAG_THRESHOLD = 5;
const drag = { active: false, button: -1, startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false };

// Roads and canals are laid by dragging a path rather than clicking
const isDragTool = (tool) => tool === 'road' || tool === 'canal' || tool === 'demolish';

function useToolAtHover() {
  if (GAME.routeDraw) { if (GAME.hoveredTile) handleRouteClick(GAME.hoveredTile.tx, GAME.hoveredTile.ty); return; }
  if (GAME.moving) { if (GAME.hoveredTile) finishMove(GAME.hoveredTile.tx, GAME.hoveredTile.ty); return; }
  if (GAME.shipOrder) { if (GAME.hoveredTile) handleShipOrderClick(GAME.hoveredTile.tx, GAME.hoveredTile.ty); return; }
  const tool = GAME.selectedBuilding;
  if (!tool) { selectAtHover(); return; } // no tool: clicking inspects buildings and ships
  if (!GAME.hoveredTile) return;
  const { tx, ty } = GAME.hoveredTile;
  if (tool === 'demolish') demolishAt(tx, ty);
  else if (!isDragTool(tool)) placeBuilding(tx, ty, tool);
}

canvas.addEventListener('mousedown', (e) => {
  setMouse(e);
  updateHover();
  if (e.button === 1 || e.button === 2) e.preventDefault(); // no autoscroll / context menu

  if (e.button === 0 && isDragTool(GAME.selectedBuilding)) {
    if (GAME.hoveredTile) GAME.roadDrag = { ...GAME.hoveredTile };
    return;
  }
  Object.assign(drag, {
    active: true, button: e.button, moved: false,
    startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY
  });
});

// Listen on window so drags continue (and end) even outside the canvas
window.addEventListener('mousemove', (e) => {
  if (e.target === canvas || drag.active || GAME.roadDrag) setMouse(e);

  if (drag.active) {
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > DRAG_THRESHOLD) {
      drag.moved = true;
      canvas.style.cursor = 'grabbing';
    }
    if (drag.moved) {
      GAME.camera.x -= (e.clientX - drag.lastX) / GAME.camera.zoom;
      GAME.camera.y -= (e.clientY - drag.lastY) / GAME.camera.zoom;
      clampCamera();
    }
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
  }
  updateHover();
});

canvas.addEventListener('mouseleave', () => {
  if (!drag.active && !GAME.roadDrag) { mouse.x = null; updateHover(); }
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 0 && GAME.roadDrag) {
    if (GAME.hoveredTile) {
      const path = roadPath(GAME.roadDrag, GAME.hoveredTile);
      if (GAME.selectedBuilding === 'canal') placeCanals(path);
      else if (GAME.selectedBuilding === 'demolish') demolishPath(path);
      else placeRoads(path);
    }
    GAME.roadDrag = null;
    return;
  }
  if (!drag.active || e.button !== drag.button) return;
  const wasClick = !drag.moved;
  drag.active = false;
  canvas.style.cursor = '';
  if (wasClick && e.button === 0 && e.target === canvas) useToolAtHover();
  if (wasClick && e.button === 2 && GAME.routeDraw) undoRoutePoint();
  if (wasClick && e.button === 2 && GAME.moving) cancelMove();
  if (wasClick && e.button === 2 && GAME.shipOrder) cancelShipOrder();
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  // Exponential zoom towards the cursor; works for mouse wheels and trackpads alike
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  const factor = Math.max(0.5, Math.min(2, Math.exp(-dy * 0.0015)));
  setMouse(e);
  zoomAt(factor, mouse.x, mouse.y);
}, { passive: false });

// Keyboard: WASD / arrows pan, +/- zoom, Esc deselects, H returns home
const PAN_KEYS = {
  w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1],
  a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0]
};
const keysDown = new Set();

// True while the player types in a field (sell amounts, names, ...): shortcuts must not fire then
const isTyping = (e) => {
  const t = e.target;
  return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
};

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (isTyping(e)) {
    if (k === 'escape') e.target.blur();
    return;
  }
  if (k === 'escape' && GAME.phase === 'play') {
    // Esc closes the game menu, then drops the tool, then closes the info panel, then the build panel
    const gm = document.getElementById('game-menu');
    if (GAME.routeDraw) cancelRouteDraw();
    else if (GAME.moving) cancelMove();
    else if (GAME.shipOrder) cancelShipOrder();
    else if (!gm.hidden) gm.hidden = true;
    else if (GAME.selectedBuilding) selectTool(null);
    else if (GAME.selectedInfo) closeInfo();
    else openBuildCategory(null);
  }
  // 1-4 open build categories
  const catIdx = Number(k) - 1;
  if (GAME.phase === 'play' && CATEGORIES[catIdx]) {
    const id = CATEGORIES[catIdx].id;
    openBuildCategory(openCategory === id ? null : id);
  }
  if (PAN_KEYS[k]) { keysDown.add(k); e.preventDefault(); }
  if (k === '+' || k === '=') zoomAt(1.2);
  if (k === '-') zoomAt(1 / 1.2);
  if (k === 'h') centerHome();
  if (k === 'q' && GAME.phase === 'play' && e.target === document.body) pipette();
  if (k === 'm' && e.target === document.body) toggleMinimap();
  if (k === 'backspace' && GAME.routeDraw) { e.preventDefault(); undoRoutePoint(); }
  // Developer log, hidden by default
  if (e.key === '`' || e.key === '§' || e.key === '½') {
    const dbg = document.getElementById('debug');
    dbg.hidden = !dbg.hidden;
  }
});
window.addEventListener('keyup', (e) => keysDown.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keysDown.clear());

function updateKeyboardPan(dt) {
  let dx = 0, dy = 0;
  for (const k of keysDown) {
    const d = PAN_KEYS[k];
    if (d) { dx += d[0]; dy += d[1]; }
  }
  if (!dx && !dy) return;
  const speed = 800 / GAME.camera.zoom; // world px per second, constant on screen
  const len = Math.hypot(dx, dy);
  GAME.camera.x += (dx / len) * speed * dt / 1000;
  GAME.camera.y += (dy / len) * speed * dt / 1000;
  clampCamera();
  updateHover();
}

// On-screen view controls
document.querySelectorAll('#view-controls button').forEach(btn => {
  btn.addEventListener('click', () => {
    const a = btn.dataset.view;
    if (a === 'in') zoomAt(1.25);
    if (a === 'out') zoomAt(1 / 1.25);
    if (a === 'home') centerHome();
  });
});
