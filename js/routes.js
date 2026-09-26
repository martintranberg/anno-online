'use strict';

// ===== ROUTE DRAWING =====
// Click a port warehouse to start, click water to add waypoints, click a warehouse on another island to finish.
// Right-click or Backspace removes the last point, Esc cancels. Segments between points follow the water.
function startRouteDraw(opts = {}) {
  selectTool(null);
  GAME.routeDraw = { from: null, points: [], segs: [], editId: opts.editId || null, assignShip: opts.assignShip || null,
                     preview: null, previewKey: '' };
  const r = opts.editId && routeById(opts.editId);
  if (r) GAME.routeDraw.from = r.from; // redrawing keeps the start warehouse
  updateRouteBanner();
}

function cancelRouteDraw() {
  GAME.routeDraw = null;
  document.getElementById('banner').hidden = true;
}

function updateRouteBanner() {
  const d = GAME.routeDraw, el = document.getElementById('banner');
  el.hidden = false;
  const step = !d.from ? '1. Klik på et af dine lagre ved havet, hvor ruten starter'
    : `2. Klik i vandet for at sætte punkter (${d.points.length} sat) – klik på et lager på en anden ø (også ${RIVAL_NAME}s) for at afslutte`;
  el.innerHTML = `🗺️ Tegn handelsrute<small>${step}. Højreklik/Backspace fortryder · Esc afbryder</small>`;
}

const portAt = (tx, ty) => {
  const occ = GAME.occupancy.get(`${tx},${ty}`);
  const b = occ && occ !== 'road' ? buildingById(occ) : null;
  return b && b.type === 'warehouse' && dockTiles(b).length ? b : null;
};
// Where the next segment starts: the last waypoint, or the start warehouse's docks
const routeAnchor = (d) => d.points.length ? [d.points[d.points.length - 1]] : dockTiles(buildingById(d.from));

function handleRouteClick(tx, ty) {
  const d = GAME.routeDraw, port = portAt(tx, ty);
  if (!d.from) {
    if (!port || isRivalId(port.id)) { showToast('Klik på et af dine lagre ved havet for at starte ruten'); return; }
    d.from = port.id;
    updateRouteBanner();
    return;
  }
  if (port) {
    if (islandOfBuilding(port) === islandOfBuilding(buildingById(d.from))) { showToast('Ruten skal ende ved et lager på en anden ø'); return; }
    if (!waterPath(routeAnchor(d), dockTiles(port))) { showToast('Der er ingen sejlvej derhen'); return; }
    finishRouteDraw(port);
    return;
  }
  if (!isWater(tx, ty)) { showToast('Klik i vandet for at sætte et punkt'); return; }
  if (!isSeen(tx, ty)) { showToast('Farvandet er ikke udforsket endnu'); return; }
  const seg = waterPath(routeAnchor(d), [[tx, ty]]);
  if (!seg) { showToast('Det punkt kan ikke nås ad vandvejen'); return; }
  d.points.push([tx, ty]);
  d.segs.push(seg.path);
  updateRouteBanner();
}

function undoRoutePoint() {
  const d = GAME.routeDraw;
  if (!d) return;
  if (d.points.length) { d.points.pop(); d.segs.pop(); }
  else if (d.from && !d.editId) d.from = null;
  d.previewKey = '';
  updateRouteBanner();
}

function finishRouteDraw(endPort) {
  const d = GAME.routeDraw;
  let r = d.editId && routeById(d.editId);
  if (r) {
    Object.assign(r, { from: d.from, to: endPort.id, waypoints: d.points, _path: null });
    routePath(r);
    // Ships on a redrawn route re-check range and start over
    for (const s of GAME.ships.filter(s => s.routeId === r.id)) {
      const err = assignShip(s, r.id);
      if (err) { stopRoute(s); notify(`⚠ ${s.name}: ${err}`); }
    }
  } else {
    r = createRoute(d.from, endPort.id, d.points);
  }
  cancelRouteDraw();
  notify(`🗺️ Ruten ${routeName(r)} er tegnet (${r.length} felter)`);
  const ship = d.assignShip && GAME.ships.find(s => s.id === d.assignShip);
  openInfo('route', r.id);
  if (ship) GAME.selectedInfo.error = assignShip(ship, r.id) || '';
  saveGame();
  renderInfo();
}

// Dashed route line along tile centres, with direction arrows
function drawPathLine(path, color, width = 2.5, dash = [7, 5]) {
  if (!path || path.length < 2) return;
  const pts = path.map(([x, y]) => P(x, y, 1));
  ctx.save();
  ctx.setLineDash(dash);
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = width + 2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.setLineDash([]);
  for (let i = 4; i < pts.length - 1; i += 6) {
    const a = pts[i - 1], b = pts[i], ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(b.x + Math.cos(ang) * 6, b.y + Math.sin(ang) * 6);
    ctx.lineTo(b.x + Math.cos(ang + 2.5) * 5, b.y + Math.sin(ang + 2.5) * 5);
    ctx.lineTo(b.x + Math.cos(ang - 2.5) * 5, b.y + Math.sin(ang - 2.5) * 5);
    ctx.fill();
  }
  ctx.restore();
}

function drawWaypointFlag(x, y, label, color = '#e8c040') {
  const base = P(x, y, 0), top = { x: base.x, y: base.y - 18 };
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(base.x, base.y, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  line(base, top, '#4a3018', 1.6);
  poly(color, [top, { x: top.x + 11, y: top.y + 3.5 }, { x: top.x, y: top.y + 7 }]);
  ctx.fillStyle = '#2a1a0a';
  ctx.font = 'bold 7px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(label, top.x + 4, top.y + 5.5);
}

function drawAnchorMarker(b, color) {
  const def = DEFS[b.type], c = P(b.x + (def.w - 1) / 2, b.y + (def.h - 1) / 2, 0);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(c.x, c.y, 44, 22, 0, 0, Math.PI * 2); ctx.stroke();
}

function drawRouteOnMap(r, color, flags = true) {
  const p = routePath(r);
  if (!p) return;
  drawPathLine(p.path, color);
  if (flags) r.waypoints.forEach(([x, y], i) => drawWaypointFlag(x, y, String(i + 1)));
}

// Route overlays: the route being drawn (with a live preview to the cursor), or the selected route/ship's route
function drawRouteOverlay() {
  const d = GAME.routeDraw, sel = GAME.selectedInfo;
  if (d) {
    if (d.from) drawAnchorMarker(buildingById(d.from), '#ffd700');
    for (const seg of d.segs) drawPathLine(seg, '#ffd700');
    d.points.forEach(([x, y], i) => drawWaypointFlag(x, y, String(i + 1)));
    const h = GAME.hoveredTile;
    if (d.from && h) {
      const port = portAt(h.tx, h.ty);
      const key = `${h.tx},${h.ty},${d.points.length}`;
      if (key !== d.previewKey) {
        // Only recompute the preview path when the cursor moves to another tile
        d.previewKey = key;
        const goals = port ? dockTiles(port) : isWater(h.tx, h.ty) ? [[h.tx, h.ty]] : null;
        d.preview = goals ? waterPath(routeAnchor(d), goals) : null;
        d.previewOk = !!d.preview && !(port && islandOfBuilding(port) === islandOfBuilding(buildingById(d.from)));
      }
      if (d.preview) drawPathLine(d.preview.path, d.previewOk ? 'rgba(255,255,255,0.85)' : 'rgba(230,80,80,0.85)', 2, [4, 4]);
      if (port && port.id !== d.from) drawAnchorMarker(port, d.previewOk ? '#9ad06a' : '#e05050');
    }
    return;
  }
  if (sel?.kind === 'route') {
    const r = routeById(sel.id);
    if (r) drawRouteOnMap(r, '#ffd700');
  } else if (sel?.kind === 'routes') {
    GAME.routes.forEach(r => drawRouteOnMap(r, 'rgba(255,215,0,0.55)', false));
  } else if (sel?.kind === 'ship') {
    const s = GAME.ships.find(x => x.id === sel.id);
    const r = s && shipRoute(s);
    if (r) drawRouteOnMap(r, '#ffd700');
  }
}
