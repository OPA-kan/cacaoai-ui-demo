const areaPolygons = {
  C: [[9.2616638,123.2181945],[9.2619339,123.2181441],[9.2619516,123.2182663],[9.2616678,123.2183155]],
  F: [[9.2623259,123.2182413],[9.26252,123.2182174],[9.2625469,123.218533],[9.2623573,123.2185577]],
  J: [[9.26252,123.2182174],[9.262926,123.2181673],[9.2629382,123.2183366],[9.2625359,123.2184033]],
  I: [[9.2625359,123.2184033],[9.2629382,123.2183366],[9.2629496,123.2184699],[9.2625469,123.218533]],
  B1: [[9.2616835,123.218582],[9.26199,123.2185346],[9.2620339,123.2188841],[9.2617779,123.2189193]],
  Bu: [[9.2616682,123.2183181],[9.2619547,123.218271],[9.26199,123.2185346],[9.2616835,123.218582]],
  CA: [[9.2619572,123.2182917],[9.2623259,123.2182413],[9.262354,123.2185246],[9.261995,123.2185743]]
};
const registeredTrees = { C: 18, Bu: 74, B1: 76, F: 0, J: 0, I: 0, CA: 0 };
const colors = { C:'#76b89a', F:'#d7a643', J:'#d66e57', I:'#7d9dc5', B1:'#9a7fbd', Bu:'#6aa7b8', CA:'#c98e55' };
const mapBounds = { north:9.2631, south:9.26155, west:123.21802, east:123.21918 };
const farmBoundary = [[9.261634,123.2183433],[9.2616383,123.2181857],[9.2619142,123.2180322],[9.2621967,123.2179741],[9.262377,123.2179541],[9.2628794,123.2179257],[9.262924,123.2179671],[9.263012,123.2189368],[9.2622784,123.2190573],[9.261862,123.2191018],[9.2616449,123.2187212]];
const youngCandidateBoundary = [[9.2628556,123.218136],[9.2628243,123.2181106],[9.26277,123.2181166],[9.2625631,123.2181728],[9.2624058,123.2182286],[9.2624099,123.2182573],[9.2624408,123.2182824],[9.2624676,123.2182791],[9.2628405,123.2182266],[9.2628672,123.2182223]];
const referenceLabels = [
  ['D', 9.2622112, 123.2187615, 'reference'], ['A', 9.2620479, 123.2190133, 'reference'],
  ['E', 9.2625002, 123.2187448, 'reference'], ['H', 9.2628149, 123.2187448, 'reference'],
  ['G', 9.2627942, 123.2188678, 'reference'], ['Glico', 9.2621258, 123.2181243, 'facility'],
  ['Cow', 9.2626605, 123.2180026, 'facility'], ['Chocobanashi', 9.2626777, 123.2180773, 'facility'],
  ['Young', 9.2624046, 123.2180567, 'facility']
];
let history = null;
let selectedTree = null;
let currentView = 'overview';
let farmMap = null;
let mapLayerGroups = {};
let referenceOverlay = null;
let referenceContext = null;
let heatmapFilter = 'all';
let scanSelection = 'all';
let scanOptions = [];
let fieldActions = [];
let treeCoverage = { linked:0, noScan:0 };
const registeredTreePoints = window.valenciaRegisteredTrees || [];
const youngTreeCandidates = window.valenciaYoungTreeCandidates || [];

const $ = (id) => document.getElementById(id);
const totalSignals = (tree) => Object.values(tree.flagged || {}).reduce((sum, value) => sum + value, 0);
const signalNames = { black_pod:'Black pod', pest:'Pest-like', charcoal_pod_rot:'Charcoal pod rot', frosty_pod:'Frosty pod' };
const signalColors = { all:'#b8443e', black_pod:'#6d5b55', pest:'#d79027', charcoal_pod_rot:'#7b5b45', frosty_pod:'#6b7db0' };

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1], xj = polygon[j][0], yj = polygon[j][1];
    const intersect = yi > point[1] !== yj > point[1] && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function scanKeyFromPhoto(photo) { return photo?.url?.match(/scan_(\d+)/)?.[1] || null; }
function scanDateLabel(key) { return key === '1028' ? '28 Oct 2026' : key === '1104' ? '04 Nov 2026' : 'All scans'; }
function scanPhotos(tree, key = scanSelection) { return key === 'all' ? (tree.photos || []) : (tree.photos || []).filter((photo) => scanKeyFromPhoto(photo) === key); }
function treeSignalCount(tree, key = scanSelection, disease = heatmapFilter) {
  if (key === 'all' && disease !== 'all') return tree.flagged?.[disease] || 0;
  if (key === 'all') return totalSignals(tree);
  return scanPhotos(tree, key).reduce((sum, photo) => sum + (photo.flagged || 0), 0);
}
function farmScanSummary(key) {
  return history.trees.reduce((summary, tree) => {
    scanPhotos(tree, key).forEach((photo) => { summary.photos += 1; summary.flagged += photo.flagged || 0; summary.pods += photo.pods || 0; });
    return summary;
  }, { photos:0, flagged:0, pods:0 });
}
function buildScanOptions() {
  const keys = [...new Set(history.trees.flatMap((tree) => (tree.photos || []).map(scanKeyFromPhoto)).filter(Boolean))].sort();
  return [...keys.map((key) => ({ key, label: scanDateLabel(key) })), { key:'all', label:'All scans' }];
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const dy = (lat1 - lat2) * 111000;
  const dx = (lon1 - lon2) * 109000;
  return Math.sqrt(dx * dx + dy * dy);
}

function nearestRegisteredTree(tree) {
  return registeredTreePoints.map((candidate) => ({ candidate, distance: distanceMeters(tree.lat, tree.lon, candidate.position.lat, candidate.position.lng) })).sort((a, b) => a.distance - b.distance)[0] || null;
}

function registeredTreeStatus(tree) {
  const match = history.trees.map((candidate) => ({ candidate, distance: distanceMeters(tree.position.lat, tree.position.lng, candidate.lat, candidate.lon) })).sort((a, b) => a.distance - b.distance)[0];
  if (!match || match.distance > 12 || !scanPhotos(match.candidate, scanSelection).length) return { key:'none', label:'No linked scan' };
  const signals = treeSignalCount(match.candidate, scanSelection, scanSelection === 'all' ? heatmapFilter : 'all');
  const rate = signals / scanPhotos(match.candidate, scanSelection).length;
  const key = priorityClass(rate);
  return { key, label:key === 'high' ? 'Priority' : key === 'medium' ? 'Follow-up' : 'Low signal', signals, distance:match.distance, source:match.candidate };
}

function areaForTree(tree) {
  return Object.entries(areaPolygons).find(([, polygon]) => pointInPolygon([tree.lat, tree.lon], polygon))?.[0] ?? 'Unassigned';
}

function areaStats() {
  const stats = Object.fromEntries(Object.keys(areaPolygons).map((id) => [id, { id, photos:0, trees:0, signals:0, pods:0 }]));
  history.trees.forEach((tree) => {
    const id = areaForTree(tree);
    if (!stats[id]) return;
    stats[id].trees += 1;
    stats[id].photos += tree.photos?.length || 0;
    stats[id].signals += totalSignals(tree);
    stats[id].pods += tree.pods || 0;
  });
  Object.values(stats).forEach((stat) => { stat.registered = registeredTrees[stat.id] || 0; stat.rate = stat.photos ? stat.signals / stat.photos : 0; });
  return stats;
}

function priorityClass(rate) { return rate >= .25 ? 'high' : rate > .08 ? 'medium' : 'low'; }
function fmtPercent(value) { return `${Math.round(value * 100)}%`; }
function showToast(message) { const toast = $('toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2400); }

function renderMetrics(targetId = 'overview-metrics') {
  const stats = areaStats();
  const priorityAreas = Object.values(stats).filter((stat) => stat.signals > 0).sort((a,b) => b.rate - a.rate);
  const metrics = [
    ['Scanned photos', history.totalPhotos, '04 Nov scan'],
    ['Disease signals', history.diseasedPhotos, `${fmtPercent(history.diseasedPhotos / history.totalPhotos)} of photos flagged`],
    ['Tree records', history.trees.length, 'Historical GPS groups'],
    ['Tagged trees', Object.values(registeredTrees).reduce((sum, count) => sum + count, 0), `C / Bu / B1 registry · +${youngTreeCandidates.length} young candidates`]
  ];
  $(targetId).innerHTML = metrics.map(([label, value, note], index) => `<article class="metric ${index === 1 ? 'priority' : ''}"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></article>`).join('');
  return priorityAreas;
}

function mapPopup(title, lines) {
  return `<strong>${title}</strong>${lines.map((line) => `<br>${line}`).join('')}`;
}

function initFarmMap() {
  if (farmMap || !window.L) return;
  farmMap = L.map('farm-map', { zoomControl: false, preferCanvas: false, minZoom: 17, maxZoom: 23, maxBounds: [[mapBounds.south, mapBounds.west], [mapBounds.north, mapBounds.east]], maxBoundsViscosity: .75 }).fitBounds([[mapBounds.south, mapBounds.west], [mapBounds.north, mapBounds.east]], { padding: [8, 8] });
  L.control.zoom({ position: 'topright' }).addTo(farmMap);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri, Maxar, Earthstar Geographics', maxNativeZoom: 18, maxZoom: 23, keepBuffer: 4 }).addTo(farmMap);
  mapLayerGroups.areas = L.layerGroup().addTo(farmMap);
  mapLayerGroups.trees = L.layerGroup().addTo(farmMap);
  mapLayerGroups.young = L.layerGroup().addTo(farmMap);
  mapLayerGroups.signals = L.layerGroup().addTo(farmMap);
  referenceContext = L.layerGroup();
  referenceOverlay = L.imageOverlay('./assets/valencia_1021_status.png', [[mapBounds.south, mapBounds.west], [mapBounds.north, mapBounds.east]], { opacity: 0.58, interactive: false });
  drawAreaLayer();
  drawTreeLayer();
  drawYoungLayer();
  drawSignalLayer();
  renderHeatmapControls();
  document.querySelectorAll('[data-map-layer]').forEach((button) => button.addEventListener('click', () => toggleMapLayer(button.dataset.mapLayer, button)));
}

function drawAreaLayer() {
  if (!mapLayerGroups.areas) return;
  Object.entries(areaPolygons).forEach(([id, polygon]) => {
    const shape = L.polygon(polygon, { color: colors[id], fillColor: colors[id], fillOpacity: 0.3, weight: 2.5 }).bindTooltip(`Area ${id}`, { sticky: true });
    shape.on('click', () => openArea(id));
    shape.addTo(mapLayerGroups.areas);
    const center = polygon.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]).map((value) => value / polygon.length);
    L.marker(center, { interactive: false, icon: L.divIcon({ className: 'area-label', html: `<span>Area ${id}</span>`, iconSize: null }) }).addTo(mapLayerGroups.areas);
  });
  L.polygon(farmBoundary, { color:'#173c2d', fill:false, weight:3, dashArray:'8 6' }).bindTooltip('Verified Valencia pilot farm boundary', { sticky:true }).addTo(mapLayerGroups.areas);
  referenceLabels.forEach(([label, lat, lon, kind]) => L.marker([lat, lon], { interactive: false, icon: L.divIcon({ className: `reference-label ${kind}`, html: `<span>${label}</span>`, iconSize: null }) }).addTo(referenceContext));
}

function drawTreeLayer() {
  if (!mapLayerGroups.trees) return;
  mapLayerGroups.trees.clearLayers();
  treeCoverage = { linked:0, noScan:0 };
  registeredTreePoints.forEach((tree) => {
    const status = registeredTreeStatus(tree);
    if (status.key === 'none') treeCoverage.noScan += 1; else treeCoverage.linked += 1;
    const fillColor = status.key === 'high' ? '#b8443e' : status.key === 'medium' ? '#d79027' : status.key === 'low' ? '#4d9b6d' : '#9ba9a2';
    const details = status.key === 'none' ? 'No linked scan yet' : `${status.label} · ${status.signals} signals · ${Math.round(status.distance)}m from scan GPS`;
    L.circleMarker([tree.position.lat, tree.position.lng], { radius:4.5, color:'#fff', weight:1.5, fillColor, fillOpacity:.98 }).bindTooltip(`Tree ${tree.number}<br>${details}`, { direction:'top' }).addTo(mapLayerGroups.trees);
  });
}

function drawYoungLayer() {
  if (!mapLayerGroups.young) return;
  mapLayerGroups.young.clearLayers();
  L.polygon(youngCandidateBoundary, { color:'#65a30d', fillColor:'#bef264', fillOpacity:.08, weight:2, dashArray:'5 5' })
    .bindTooltip('Young area · candidate positions', { sticky:true })
    .bindPopup(mapPopup('Young area', ['64 candidate positions from the 11/04 corner survey', '<em>Candidate grid only · confirm each tree in the field</em>']), { autoPan:false })
    .addTo(mapLayerGroups.young);
  youngTreeCandidates.forEach((tree) => {
    L.circleMarker([tree.position.lat, tree.position.lng], { radius:4.5, color:'#365314', weight:1.4, fillColor:'#a3e635', fillOpacity:.95, dashArray:'2 2' })
      .bindPopup(mapPopup(tree.number, ['Young-tree candidate', 'Area Young', 'Source: 11/04 young-area 3m grid', '<em>Not field-confirmed · use this point to start the next check</em>']), { autoPan:false })
      .bindTooltip(`${tree.number}<br>Young candidate · field confirmation pending`, { direction:'top' })
      .addTo(mapLayerGroups.young);
  });
}

function drawSignalLayer() {
  if (!mapLayerGroups.signals) return;
  mapLayerGroups.signals.clearLayers();
  const disease = scanSelection === 'all' ? heatmapFilter : 'all';
  const color = signalColors[disease] || signalColors.all;
  history.trees.forEach((tree, index) => {
    const signals = treeSignalCount(tree, scanSelection, disease);
    if (!signals) return;
    const photos = scanPhotos(tree, scanSelection).length;
    const marker = L.circleMarker([tree.lat, tree.lon], { radius:Math.min(9, 5 + Math.log1p(signals) * .8), color:'#fff', weight:2.5, fillColor:color, fillOpacity:.92 });
    const registryMatch = nearestRegisteredTree(tree);
    const registryLine = registryMatch && registryMatch.distance <= 12 ? `Registry link: ${registryMatch.candidate.number}` : 'Registry link: not confirmed';
    marker.bindPopup(mapPopup(tree.label.match(/木\s+([^（]+)/)?.[1] || tree.label, [`Area ${areaForTree(tree)}`, `${signals} ${disease === 'all' ? 'signals' : signalNames[disease]}`, `${photos} photos · ${scanSelection === 'all' ? 'all scans' : scanDateLabel(scanSelection)}`, registryLine, '<em>Start the next field check here</em>']), { autoPan:false });
    marker.on('click', () => openTree(index));
    marker.addTo(mapLayerGroups.signals);
  });
  $('map-status').textContent = `${registeredTreePoints.length} registered trees · ${youngTreeCandidates.length} young candidates · ${treeCoverage.linked} linked · ${treeCoverage.noScan} no linked scan · ${history.trees.length} GPS signal groups · ${scanSelection === 'all' ? 'all scans' : scanDateLabel(scanSelection)} · ${disease === 'all' ? 'all signals' : signalNames[disease]} heatmap`;
}

function renderHeatmapControls() {
  const allCount = scanSelection === 'all' ? history.diseasedPhotos : farmScanSummary(scanSelection).flagged;
  const entries = [['all', allCount], ...Object.entries(history.diseaseTypeCounts)];
  const dateSpecific = scanSelection !== 'all';
  $('heatmap-filter').innerHTML = entries.map(([key, count]) => `<button class="heatmap-button ${key === heatmapFilter && !dateSpecific ? 'active' : ''} ${dateSpecific && key !== 'all' ? 'disabled' : ''}" data-heatmap="${key}" type="button" ${dateSpecific && key !== 'all' ? 'disabled' : ''}><i style="background:${signalColors[key] || signalColors.all}"></i>${key === 'all' ? 'All signals' : signalNames[key] || key}<b>${dateSpecific && key !== 'all' ? '—' : count}</b></button>`).join('');
  document.querySelectorAll('[data-heatmap]').forEach((button) => button.addEventListener('click', () => {
    if (button.disabled) return;
    heatmapFilter = button.dataset.heatmap;
    document.querySelectorAll('[data-heatmap]').forEach((item) => item.classList.toggle('active', item === button));
    drawTreeLayer();
    drawSignalLayer();
  }));
}

function renderScanTimeline() {
  scanOptions = buildScanOptions();
  const selectedIndex = Math.max(0, scanOptions.findIndex((option) => option.key === scanSelection));
  const slider = $('scan-slider');
  slider.max = String(scanOptions.length - 1);
  slider.value = String(selectedIndex);
  $('scan-label').textContent = scanOptions[selectedIndex]?.label || 'All scans';
  $('scan-timeline-labels').innerHTML = scanOptions.map((option) => `<span>${option.label.replace(' 2026', '')}</span>`).join('');
  slider.oninput = () => {
    scanSelection = scanOptions[Number(slider.value)]?.key || 'all';
    if (scanSelection !== 'all') heatmapFilter = 'all';
    $('scan-label').textContent = scanOptions[Number(slider.value)]?.label || 'All scans';
    renderHeatmapControls();
    drawTreeLayer();
    drawSignalLayer();
    renderEffectiveness();
  };
}

function treesForAction(action) {
  const target = action.target.toLowerCase().replace(/^tree\s+/, '').trim();
  if (target.startsWith('area ')) return history.trees.filter((tree) => areaForTree(tree).toLowerCase() === target.replace('area ', ''));
  return history.trees.filter((tree) => tree.label.toLowerCase().includes(target));
}

function summarizeTrees(trees, key) {
  return trees.reduce((summary, tree) => {
    scanPhotos(tree, key).forEach((photo) => { summary.photos += 1; summary.flagged += photo.flagged || 0; });
    return summary;
  }, { photos:0, flagged:0 });
}

function actionOutcome(action, firstKey, latestKey) {
  const trees = treesForAction(action);
  if (!trees.length) return null;
  const before = summarizeTrees(trees, firstKey);
  const after = summarizeTrees(trees, latestKey);
  if (!before.photos || !after.photos) return null;
  const beforeRate = before.flagged / before.photos;
  const afterRate = after.flagged / after.photos;
  return { trees, before, after, beforeRate, afterRate, delta: afterRate - beforeRate };
}

function renderEffectiveness() {
  const summaries = scanOptions.filter((option) => option.key !== 'all').map((option) => ({ ...option, summary: farmScanSummary(option.key) }));
  const first = summaries[0];
  const latest = summaries[summaries.length - 1];
  if (!first || !latest) return;
  const firstRate = first.summary.photos ? first.summary.flagged / first.summary.photos : 0;
  const latestRate = latest.summary.photos ? latest.summary.flagged / latest.summary.photos : 0;
  const delta = latestRate - firstRate;
  const maxRate = Math.max(firstRate, latestRate, .01);
  const actionText = fieldActions.length ? `${fieldActions.length} local field action${fieldActions.length === 1 ? '' : 's'} recorded` : 'No treatment record linked yet';
  const latestOutcome = fieldActions[0] ? actionOutcome(fieldActions[0], first.key, latest.key) : null;
  const targetOutcome = latestOutcome ? `<div class="linked-outcome"><div><p class="eyebrow">Selected action outcome</p><h3>${fieldActions[0].target} · ${fieldActions[0].treatment}</h3><p>${latestOutcome.trees.length} matching tree record${latestOutcome.trees.length === 1 ? '' : 's'} · compare ${first.label} with ${latest.label}</p></div><div class="linked-outcome-metrics"><span><b>${fmtPercent(latestOutcome.beforeRate)}</b><small>before</small></span><strong>${latestOutcome.delta <= 0 ? '↓' : '↑'} ${Math.abs(Math.round(latestOutcome.delta * 100))} pts</strong><span><b>${fmtPercent(latestOutcome.afterRate)}</b><small>after</small></span></div></div>` : fieldActions.length ? `<div class="linked-outcome muted-outcome"><strong>Action saved, but its target does not yet match a Tree/Area record with both scan dates.</strong><span>Use a target such as “Tree W31” or “Area J” to connect the next scan.</span></div>` : '';
  $('effectiveness-panel').innerHTML = `<div class="panel-head"><div><p class="eyebrow">Scan comparison · farm level</p><h2>Did the field action help?</h2><p class="section-note">Observed signal change is shown first. Treatment effectiveness is attributed only after an action is linked to a Tree or Area and a recheck scan is available.</p></div><span class="status-badge ${fieldActions.length ? 'neutral' : 'priority'}">${actionText}</span></div><div class="outcome-grid"><div class="outcome-summary"><span>Observed change</span><strong>${delta <= 0 ? '↓' : '↑'} ${Math.abs(Math.round(delta * 100))} pts</strong><small>${first.label} → ${latest.label} flagged-photo rate</small></div>${summaries.map((item) => { const rate = item.summary.photos ? item.summary.flagged / item.summary.photos : 0; return `<div class="outcome-period"><div><strong>${item.label}</strong><span>${item.summary.flagged} / ${item.summary.photos} flagged</span></div><div class="outcome-bar"><i style="width:${Math.round(rate / maxRate * 100)}%"></i></div><small>${fmtPercent(rate)} flagged · ${item.summary.pods} pod detections</small></div>`; }).join('')}</div>${targetOutcome}<div class="outcome-footer"><span><b>Interpretation:</b> This is a scan-to-scan comparison, not proof of treatment effect.</span><button class="small-button" data-view="actions" type="button">Open action log →</button></div>`;
  $('effectiveness-panel').querySelector('[data-view="actions"]').addEventListener('click', () => openView('actions'));
}

function loadFieldActions() {
  try { return JSON.parse(localStorage.getItem('cacaoai.valencia.fieldActions') || '[]'); } catch { return []; }
}

function saveFieldActions() { localStorage.setItem('cacaoai.valencia.fieldActions', JSON.stringify(fieldActions)); }

function renderActionLog() {
  const target = $('action-log');
  if (!fieldActions.length) {
    target.innerHTML = '<div class="empty-state"><span>↺</span><strong>No field actions recorded in this browser</strong><small>Record the treatment and recheck date to connect the next scan to an action.</small></div>';
    return;
  }
  const scanKeys = scanOptions.filter((option) => option.key !== 'all');
  target.innerHTML = fieldActions.map((action) => { const outcome = scanKeys.length >= 2 ? actionOutcome(action, scanKeys[0].key, scanKeys[scanKeys.length - 1].key) : null; const result = outcome ? `<div class="action-result"><span>Observed after recheck</span><strong>${outcome.delta <= 0 ? '↓' : '↑'} ${Math.abs(Math.round(outcome.delta * 100))} pts</strong><small>${fmtPercent(outcome.beforeRate)} → ${fmtPercent(outcome.afterRate)} flagged-photo rate</small></div>` : '<div class="action-result pending"><span>Outcome</span><strong>Awaiting linked recheck</strong><small>Need matching Tree/Area records and both scan dates</small></div>'; return `<article class="action-row"><div class="action-row-head"><strong>${action.target}</strong><span class="status-badge neutral">Local draft</span></div><p>${action.treatment}</p><small>${action.actionDate} · Recheck ${action.recheckDate}</small>${action.note ? `<em>${action.note}</em>` : ''}${result}</article>`; }).join('');
}

function toggleMapLayer(layer, button) {
  if (!farmMap) return;
  const targets = layer === 'reference' ? [referenceContext, referenceOverlay] : [mapLayerGroups[layer]];
  const visible = targets.some((target) => target && farmMap.hasLayer(target));
  targets.forEach((target) => { if (!target) return; if (visible) target.removeFrom(farmMap); else target.addTo(farmMap); });
  button.classList.toggle('active', !visible);
}

function renderMap() {
  initFarmMap();
  if (farmMap) {
    drawTreeLayer();
    drawYoungLayer();
    drawSignalLayer();
    renderHeatmapControls();
    setTimeout(() => farmMap.invalidateSize(), 50);
  }
}

function renderPriority() {
  const stats = areaStats();
  const areas = Object.values(stats).filter((stat) => stat.signals).sort((a,b) => b.rate - a.rate).slice(0, 4);
  $('priority-list').innerHTML = areas.map((stat, index) => `<button class="priority-row" data-area="${stat.id}"><span class="rank">${index + 1}</span><span class="priority-info"><strong>Area ${stat.id} <span class="status-badge ${priorityClass(stat.rate)}">${priorityClass(stat.rate) === 'high' ? 'Priority' : 'Follow-up'}</span></strong><small>${stat.trees} GPS groups · ${stat.photos} photos · ${stat.signals} signals</small></span><span class="priority-count">${fmtPercent(stat.rate)}</span></button>`).join('') || '<div class="empty-state"><strong>No area-level signals yet</strong></div>';
  document.querySelectorAll('[data-area]').forEach((row) => row.addEventListener('click', () => openArea(row.dataset.area)));
  $('next-step').textContent = areas[0] ? `Visit Area ${areas[0].id} first and confirm the highest-signal tree groups in person.` : 'No priority area has been calculated yet.';
}

function renderSignals(targetId) {
  const entries = Object.entries(history.diseaseTypeCounts).sort((a,b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, value]) => value));
  $(targetId).innerHTML = entries.map(([key, value]) => `<div class="signal-row"><span>${signalNames[key] || key}</span><div class="signal-bar"><i style="width:${Math.round(value / max * 100)}%;background:${key === 'pest' ? '#d79027' : key === 'black_pod' ? '#6d5b55' : '#6b7db0'}"></i></div><strong>${value}</strong></div>`).join('');
}

function renderAreas() {
  const stats = areaStats();
  $('area-table').innerHTML = Object.values(stats).map((stat) => `<tr><td><button class="area-link" data-area="${stat.id}">Area ${stat.id}</button></td><td>${stat.registered}</td><td>${stat.trees}</td><td>${stat.photos}</td><td>${stat.signals}</td><td><span class="priority-text ${priorityClass(stat.rate)}">${stat.signals ? (priorityClass(stat.rate) === 'high' ? 'Priority' : 'Follow-up') : 'No scan signal'}</span></td></tr>`).join('');
  document.querySelectorAll('.area-link').forEach((button) => button.addEventListener('click', () => openArea(button.dataset.area)));
}

function renderTrees(query = '') {
  const normalized = query.toLowerCase().trim();
  const rows = history.trees.map((tree, index) => ({ tree, index, signals: totalSignals(tree), area: areaForTree(tree) })).filter(({ tree, area }) => `${tree.label} ${area}`.toLowerCase().includes(normalized)).sort((a,b) => b.signals - a.signals || b.tree.pods - a.tree.pods);
  $('tree-list').innerHTML = rows.map(({ tree, index, signals, area }) => `<button class="tree-row ${selectedTree === tree ? 'selected' : ''}" data-tree-index="${index}"><span class="tree-dot ${signals >= 5 ? 'high' : signals ? 'medium' : 'low'}"></span><span><strong>${tree.label.match(/木\s+([^（]+)/)?.[1] || tree.label}</strong><small>Area ${area} · ${tree.photos?.length || 0} photos · ${tree.pods} pod detections</small></span><em>${signals} signals</em></button>`).join('');
  document.querySelectorAll('.tree-row').forEach((row) => row.addEventListener('click', () => openTree(Number(row.dataset.treeIndex))));
  $('tree-count-label').textContent = history.trees.length;
}

function openTree(index) {
  selectedTree = history.trees[index];
  if (!selectedTree) return;
  renderTrees($('tree-search').value);
  const signals = totalSignals(selectedTree);
  const area = areaForTree(selectedTree);
  const kindList = Object.entries(selectedTree.flagged || {}).map(([key, value]) => `${signalNames[key] || key} ${value}`).join(' · ') || 'No flagged pod';
  $('tree-detail').innerHTML = `<div class="detail-header"><div><p class="eyebrow">Selected tree group</p><h2>${selectedTree.label.match(/木\s+([^（]+)/)?.[1] || selectedTree.label}</h2></div><span class="status-badge ${signals ? 'priority' : 'neutral'}">${signals ? 'Field confirmation' : 'No flagged history'}</span></div><p class="section-note">${selectedTree.label}</p><div class="detail-kpis"><div><small>Photos</small><strong>${selectedTree.photos?.length || 0}</strong></div><div><small>Pod detections</small><strong>${selectedTree.pods}</strong></div><div><small>Signals</small><strong>${signals}</strong></div></div><div class="detail-lines"><span><span>Mapped area</span><strong>Area ${area}</strong></span><span><span>GPS</span><strong>${selectedTree.lat.toFixed(6)}, ${selectedTree.lon.toFixed(6)}</strong></span><span><span>Signal types</span><strong>${kindList}</strong></span><span><span>Next action</span><strong>${signals ? 'Start the next field check here' : 'Keep monitoring'}</strong></span></div><button class="primary-button detail-action" type="button" id="detail-action-button">＋ Record field action</button>`;
  $('detail-action-button').addEventListener('click', () => { showToast('Field action entry will be linked to this tree in the next sync slice.'); openView('actions'); });
  openView('trees');
}

function renderPhotos(filter = 'all') {
  const records = history.trees.flatMap((tree) => (tree.photos || []).filter((photo) => photo.flagged || photo.pods).map((photo) => ({ ...photo, tree, area: areaForTree(tree), signals: Object.keys(tree.flagged || {}) }))).filter((record) => filter === 'all' || record.signals.includes(filter)).sort((a,b) => (b.flagged - a.flagged) || (b.pods - a.pods)).slice(0, 18);
  $('photo-count-label').textContent = history.totalPhotos;
  $('photo-review-grid').innerHTML = records.map((record) => `<article class="photo-card"><h3>${record.name}</h3><p>${record.tree.label} · Area ${record.area}</p><div class="tag-row"><span class="tag ${record.flagged ? 'alert' : ''}">${record.flagged ? `${record.flagged} flagged` : 'No flagged pod'}</span><span class="tag">${record.pods} pod${record.pods === 1 ? '' : 's'}</span><span class="tag">Drive source</span></div><button class="small-button photo-open" data-tree-index="${history.trees.indexOf(record.tree)}" type="button">Open tree record →</button></article>`).join('');
  document.querySelectorAll('.photo-open').forEach((button) => button.addEventListener('click', () => openTree(Number(button.dataset.treeIndex))));
}

function renderReport() {
  renderMetrics('report-metrics');
  renderSignals('report-signals');
  const priorities = Object.values(areaStats()).filter((stat) => stat.signals).sort((a,b) => b.rate - a.rate).slice(0, 3);
  $('recommendations').innerHTML = priorities.map((stat) => `<li><span><strong>Inspect Area ${stat.id} first</strong><br>${stat.signals} signals across ${stat.photos} historical photos; confirm the highest-signal trees in person.</span></li>`).join('') || '<li><span>No area-level follow-up is currently queued.</span></li>';
}

function openArea(area) { showToast(`Area ${area} selected. Opening the area workload.`); openView('areas'); document.querySelectorAll('[data-area]').forEach((row) => row.classList.toggle('selected', row.dataset.area === area)); }
function openView(view) { currentView = view; document.querySelectorAll('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`)); document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view)); $('page-title').textContent = ({ overview:'Farm dashboard', areas:'Areas', trees:'Tree records', photos:'Photo review', actions:'Field actions', report:'Weekly report' })[view]; window.scrollTo({ top:0, behavior:'smooth' }); }

async function loadData() {
  const response = await fetch('../cacaoai-pwa/data/valencia-tree-history-20261104.json');
  if (!response.ok) throw new Error(`Data load failed (${response.status})`);
  history = await response.json();
  fieldActions = loadFieldActions();
  scanOptions = buildScanOptions();
  renderScanTimeline(); renderMetrics(); renderMap(); renderPriority(); renderSignals('signal-list'); renderAreas(); renderTrees(); renderPhotos(); renderReport(); renderEffectiveness(); renderActionLog();
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => openView(button.dataset.view)));
$('tree-search').addEventListener('input', (event) => renderTrees(event.target.value));
$('photo-filter').addEventListener('change', (event) => renderPhotos(event.target.value));
$('refresh-data').addEventListener('click', async () => { try { await loadData(); showToast('Valencia snapshot refreshed.'); } catch (error) { showToast(error.message); } });
$('new-action').addEventListener('click', () => { openView('actions'); setTimeout(() => $('action-target').focus(), 50); });
$('action-form').addEventListener('submit', (event) => { event.preventDefault(); fieldActions.unshift({ id: Date.now(), target: $('action-target').value.trim(), treatment: $('action-treatment').value.trim(), actionDate: $('action-date').value, recheckDate: $('action-recheck').value, note: $('action-note').value.trim() }); saveFieldActions(); renderActionLog(); renderEffectiveness(); event.target.reset(); showToast('Field action saved locally.'); });
$('download-report').addEventListener('click', () => { const lines = [`Valencia DA Pilot Farm — scan ${history.scanDate}`, `Scanned photos: ${history.totalPhotos}`, `Disease signals: ${history.diseasedPhotos}`, `Tree records: ${history.trees.length}`, ...Object.entries(history.diseaseTypeCounts).map(([key, value]) => `${signalNames[key] || key}: ${value}`)]; const blob = new Blob([lines.join('\n')], { type:'text/plain' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'valencia-cacao-weekly-summary.txt'; link.click(); URL.revokeObjectURL(link.href); });
loadData().catch((error) => { $('map-status').textContent = error.message; showToast(error.message); });
