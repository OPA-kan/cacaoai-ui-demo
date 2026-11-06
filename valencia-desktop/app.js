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
const registeredTreePoints = window.valenciaRegisteredTrees || [];

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
    ['Tagged trees', Object.values(registeredTrees).reduce((sum, count) => sum + count, 0), 'C / Bu / B1 registry']
  ];
  $(targetId).innerHTML = metrics.map(([label, value, note], index) => `<article class="metric ${index === 1 ? 'priority' : ''}"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></article>`).join('');
  return priorityAreas;
}

function mapPopup(title, lines) {
  return `<strong>${title}</strong>${lines.map((line) => `<br>${line}`).join('')}`;
}

function initFarmMap() {
  if (farmMap || !window.L) return;
  farmMap = L.map('farm-map', { zoomControl: false, preferCanvas: false, minZoom: 17, maxZoom: 21, maxBounds: [[mapBounds.south, mapBounds.west], [mapBounds.north, mapBounds.east]], maxBoundsViscosity: 1 }).fitBounds([[mapBounds.south, mapBounds.west], [mapBounds.north, mapBounds.east]], { padding: [8, 8] });
  L.control.zoom({ position: 'topright' }).addTo(farmMap);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri, Maxar, Earthstar Geographics', maxZoom: 20 }).addTo(farmMap);
  mapLayerGroups.areas = L.layerGroup().addTo(farmMap);
  mapLayerGroups.trees = L.layerGroup().addTo(farmMap);
  mapLayerGroups.signals = L.layerGroup().addTo(farmMap);
  referenceContext = L.layerGroup();
  referenceOverlay = L.imageOverlay('./assets/valencia_1021_status.png', [[mapBounds.south, mapBounds.west], [mapBounds.north, mapBounds.east]], { opacity: 0.58, interactive: false });
  drawAreaLayer();
  drawTreeLayer();
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
  registeredTreePoints.forEach((tree) => {
    L.circleMarker([tree.position.lat, tree.position.lng], { radius:4, color:'#fff', weight:1.5, fillColor:colors[tree.areaId] || '#315f8a', fillOpacity:.98 }).bindTooltip(`Tree ${tree.number}`, { direction:'top' }).addTo(mapLayerGroups.trees);
  });
}

function drawSignalLayer() {
  if (!mapLayerGroups.signals) return;
  mapLayerGroups.signals.clearLayers();
  const color = signalColors[heatmapFilter] || signalColors.all;
  history.trees.forEach((tree, index) => {
    const signals = heatmapFilter === 'all' ? totalSignals(tree) : (tree.flagged?.[heatmapFilter] || 0);
    if (!signals) return;
    const rate = tree.photos?.length ? signals / tree.photos.length : 0;
    const radius = Math.min(15, 5 + signals * .8);
    const halo = L.circle([tree.lat, tree.lon], { radius: Math.min(16, 4 + signals * .9), color, weight:1.5, opacity:.35, fillColor:color, fillOpacity:.1, interactive:false }).addTo(mapLayerGroups.signals);
    const marker = L.circleMarker([tree.lat, tree.lon], { radius, color:'#fff', weight:2.5, fillColor:color, fillOpacity:.92 });
    marker.bindPopup(mapPopup(tree.label.match(/木\s+([^（]+)/)?.[1] || tree.label, [`Area ${areaForTree(tree)}`, `${signals} ${heatmapFilter === 'all' ? 'signals' : signalNames[heatmapFilter]}`, `${tree.photos?.length || 0} photos`, '<em>Start the next field check here</em>']), { autoPan:false });
    marker.on('click', () => openTree(index));
    marker.addTo(mapLayerGroups.signals);
  });
  $('map-status').textContent = `${registeredTreePoints.length} registered trees · ${history.trees.length} scan groups · ${heatmapFilter === 'all' ? 'all signals' : signalNames[heatmapFilter]} heatmap`;
}

function renderHeatmapControls() {
  const allCount = Object.values(history.diseaseTypeCounts).reduce((sum, value) => sum + value, 0);
  const entries = [['all', allCount], ...Object.entries(history.diseaseTypeCounts)];
  $('heatmap-filter').innerHTML = entries.map(([key, count]) => `<button class="heatmap-button ${key === heatmapFilter ? 'active' : ''}" data-heatmap="${key}" type="button"><i style="background:${signalColors[key] || signalColors.all}"></i>${key === 'all' ? 'All signals' : signalNames[key] || key}<b>${count}</b></button>`).join('');
  document.querySelectorAll('[data-heatmap]').forEach((button) => button.addEventListener('click', () => {
    heatmapFilter = button.dataset.heatmap;
    document.querySelectorAll('[data-heatmap]').forEach((item) => item.classList.toggle('active', item === button));
    drawSignalLayer();
  }));
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
  renderMetrics(); renderMap(); renderPriority(); renderSignals('signal-list'); renderAreas(); renderTrees(); renderPhotos(); renderReport();
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => openView(button.dataset.view)));
$('tree-search').addEventListener('input', (event) => renderTrees(event.target.value));
$('photo-filter').addEventListener('change', (event) => renderPhotos(event.target.value));
$('refresh-data').addEventListener('click', async () => { try { await loadData(); showToast('Valencia snapshot refreshed.'); } catch (error) { showToast(error.message); } });
$('new-action').addEventListener('click', () => showToast('Field action entry will be connected to Supabase in the next integration slice.'));
$('download-report').addEventListener('click', () => { const lines = [`Valencia DA Pilot Farm — scan ${history.scanDate}`, `Scanned photos: ${history.totalPhotos}`, `Disease signals: ${history.diseasedPhotos}`, `Tree records: ${history.trees.length}`, ...Object.entries(history.diseaseTypeCounts).map(([key, value]) => `${signalNames[key] || key}: ${value}`)]; const blob = new Blob([lines.join('\n')], { type:'text/plain' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'valencia-cacao-weekly-summary.txt'; link.click(); URL.revokeObjectURL(link.href); });
loadData().catch((error) => { $('map-status').textContent = error.message; showToast(error.message); });
