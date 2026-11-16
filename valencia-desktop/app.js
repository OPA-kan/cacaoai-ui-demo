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
let treePositionEstimates = {};
let analysisSnapshot = { status:'not-run', photo_links:[], tree_records:[], position_estimates:[], sessions:[] };
let weatherSnapshot = { status:'not-loaded', daily:[], summary:null };
let harvestRecords = [];
let marketPrices = { local:[], international:[] };
const registeredTreePoints = window.valenciaRegisteredTrees || [];
const youngTreeCandidates = window.valenciaYoungTreeCandidates || [];
let cloudSnapshot = { photos:[], actions:[], status:'not-loaded', error:null };

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
const safeExternalUrl = (value) => { try { const url = new URL(String(value)); return ['https:','http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
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

function normalizeRemoteSignal(signal) {
  if (!signal) return { flagged:0, pods:0, type:null };
  let value = signal;
  if (typeof signal === 'string') { try { value = JSON.parse(signal); } catch { value = { label:signal }; } }
  if (typeof value === 'number') return { flagged:value, pods:0, type:null };
  const label = String(value.label || value.disease || value.disease_type || value.class || value.type || '').toLowerCase();
  const type = label.includes('black') ? 'black_pod' : label.includes('frosty') ? 'frosty_pod' : label.includes('charcoal') ? 'charcoal_pod_rot' : label.includes('pest') ? 'pest' : null;
  const flagged = Number(value.flagged ?? (value.warning || value.disease_probability >= .5 ? 1 : 0)) || 0;
  const pods = Number(value.pods ?? value.pod_count ?? value.detection_count ?? 0) || 0;
  return { flagged, pods, type };
}

function remotePhotoRecord(row) {
  const signal = normalizeRemoteSignal(row.signal);
  const lat = Number(row.latitude), lon = Number(row.longitude);
  const driveUrl = safeExternalUrl(row.drive_file_url) || (row.drive_file_id ? `https://drive.google.com/file/d/${encodeURIComponent(row.drive_file_id)}/view` : '');
  const name = row.file_name || row.fileName || row.id || 'PWA photo';
  return {
    id: String(row.id || `${name}-${row.captured_at || ''}`),
    name,
    url: row.drive_file_url || '',
    driveUrl,
    flagged: signal.flagged,
    pods: signal.pods,
    cloud: true,
    aiStatus: row.ai_status || 'not_started',
    areaId: row.area_id || null,
    confirmedTreeId: row.confirmed_tree_id || null,
    treeNumber: row.tree_number || row.confirmed_tree_id || row.candidate_tree_ids?.[0] || null,
    capturedAt: row.captured_at || null,
    gpsAccuracy: Number.isFinite(Number(row.gps_accuracy)) ? Number(row.gps_accuracy) : null,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    signalType: signal.type
  };
}

function dateOnly(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function shiftDate(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function reportEndDate() {
  const cloudDates = (cloudSnapshot.photos || []).map((row) => dateOnly(row.captured_at || row.capturedAt)).filter(Boolean);
  const candidates = [...cloudDates, dateOnly(history?.scanDate)].filter(Boolean).sort();
  return candidates[candidates.length - 1] || new Date().toISOString().slice(0, 10);
}

function normalizeHarvestRecord(row) {
  const rawWeight = row.weight_kg ?? row.weightKg ?? row.quantity_kg ?? row.quantity;
  const weight = rawWeight === null || rawWeight === undefined || rawWeight === '' ? null : Number(rawWeight);
  const rawPods = row.pods ?? row.pod_count ?? row.podCount;
  const pods = rawPods === null || rawPods === undefined || rawPods === '' ? null : Number(rawPods);
  return {
    id: row.id || `${row.harvest_date || row.date}-${row.tree_id || row.area_id || 'farm'}`,
    date: dateOnly(row.harvest_date || row.harvestDate || row.date),
    weightKg: Number.isFinite(weight) ? weight : null,
    pods: Number.isFinite(pods) ? pods : null,
    treeId: row.tree_id || row.treeId || null,
    areaId: row.area_id || row.areaId || null,
    grade: row.grade || row.quality_grade || null,
    source: row.source || 'Supabase harvest record'
  };
}

function loadHarvestDrafts() {
  try { return JSON.parse(localStorage.getItem('cacaoai.valencia.harvestDrafts') || '[]'); } catch { return []; }
}

function saveHarvestDrafts(records) {
  localStorage.setItem('cacaoai.valencia.harvestDrafts', JSON.stringify(records));
}

function normalizeMarketPrice(row) {
  const value = Number(row.value ?? row.price ?? row.amount);
  return {
    date: dateOnly(row.observed_on || row.observedOn || row.date),
    value: Number.isFinite(value) ? value : null,
    currency: row.currency || 'PHP',
    unit: row.unit || 'kg',
    source: row.source || 'Local market observation',
    scope: String(row.market_scope || row.scope || 'local').toLowerCase()
  };
}

function normalizeThreeDigitNumber(value) {
  const match = String(value ?? '').trim().match(/^\d{3}$/);
  return match ? match[1] : null;
}

function historicalTreeNumber(label) {
  const match = String(label || '').match(/(?:番号|number|#)\s*([0-9]{3})/i);
  return match ? match[1] : null;
}

function treeMatchesReportedId(tree, id) {
  const raw = String(id ?? '').trim().toLowerCase();
  if (!raw) return false;
  if (raw === String(tree.treeId || '').trim().toLowerCase()) return true;
  if (raw === String(tree.number || '').trim().toLowerCase()) return true;
  const number = normalizeThreeDigitNumber(raw);
  return number !== null && historicalTreeNumber(tree.label) === number;
}

function remoteTreeIds(row) {
  const ids = [row.confirmed_tree_id, row.tree_number, ...(Array.isArray(row.candidate_tree_ids) ? row.candidate_tree_ids : [])];
  return ids.filter(Boolean).map((id) => String(id).trim());
}

function findRemoteTree(merged, row, photo) {
  const ids = remoteTreeIds(row);
  const byId = merged.trees.find((tree) => ids.some((id) => treeMatchesReportedId(tree, id)));
  if (byId) return byId;
  // An explicit tree number or candidate is evidence to review, not permission
  // to silently attach the photo to the nearest historical tree.
  if (ids.length) return null;
  if (!Number.isFinite(photo.lat) || !Number.isFinite(photo.lon)) return null;
  return merged.trees.map((tree) => ({ tree, distance:distanceMeters(photo.lat, photo.lon, tree.lat, tree.lon) })).sort((a, b) => a.distance - b.distance)[0]?.distance <= 12
    ? merged.trees.map((tree) => ({ tree, distance:distanceMeters(photo.lat, photo.lon, tree.lat, tree.lon) })).sort((a, b) => a.distance - b.distance)[0].tree
    : null;
}

function mergeCloudPhotos(baseHistory, rows) {
  const merged = {
    ...baseHistory,
    trees: baseHistory.trees.map((tree) => ({ ...tree, photos:[...(tree.photos || [])], flagged:{ ...(tree.flagged || {}) } })),
    diseaseTypeCounts:{ ...(baseHistory.diseaseTypeCounts || {}) }
  };
  const known = new Set(merged.trees.flatMap((tree) => (tree.photos || []).map((photo) => String(photo.id || photo.name || ''))));
  (rows || []).forEach((row) => {
    const photo = remotePhotoRecord(row);
    if (known.has(photo.id) || [...known].some((id) => id && id === photo.name)) return;
    known.add(photo.id);
    let tree = findRemoteTree(merged, row, photo);
    if (!tree) {
      const treeLabel = photo.treeNumber ? `Tree ${photo.treeNumber} · reported number (unresolved)` : `PWA upload ${photo.name}`;
      tree = { label:treeLabel, treeNumber:photo.treeNumber || null, lat:photo.lat ?? mapBounds.south, lon:photo.lon ?? mapBounds.west, pods:0, flagged:{}, photos:[] };
      merged.trees.push(tree);
    }
    tree.photos.push({ ...photo, flagged:photo.flagged, pods:photo.pods });
    tree.pods += photo.pods;
    if (photo.signalType && photo.flagged) {
      tree.flagged[photo.signalType] = (tree.flagged[photo.signalType] || 0) + photo.flagged;
      merged.diseaseTypeCounts[photo.signalType] = (merged.diseaseTypeCounts[photo.signalType] || 0) + photo.flagged;
    }
    merged.totalPhotos += 1;
    if (photo.flagged) merged.diseasedPhotos += 1;
  });
  return merged;
}

function normalizeCloudAction(row) {
  const target = row.tree_id ? `Tree ${row.tree_id}` : row.area_id ? `Area ${row.area_id}` : 'Farm action';
  return { id:row.id, target, treatment:row.action_type || 'Field action', actionDate:(row.performed_at || '').slice(0, 10), recheckDate:(row.next_check_at || '').slice(0, 10) || 'Not scheduled', note:row.note || '', source:'cloud', photoId:row.photo_id || null };
}

function setCloudStatus(label, tone = 'neutral') {
  const status = $('cloud-status');
  if (!status) return;
  status.textContent = label;
  status.dataset.tone = tone;
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const dy = (lat1 - lat2) * 111000;
  const dx = (lon1 - lon2) * 109000;
  return Math.sqrt(dx * dx + dy * dy);
}

function treePositionEstimate(tree) {
  const normalize = window.cacaoaiPositionEstimator?.normalizeTreeId;
  if (!normalize) return null;
  return treePositionEstimates[normalize(tree.id || tree.number)] || null;
}

function analysisTreeRecord(tree) {
  const normalize = window.cacaoaiPositionEstimator?.normalizeTreeId;
  if (!normalize) return null;
  const treeId = normalize(tree.id || tree.number);
  return (analysisSnapshot.tree_records || []).find((record) => normalize(record.tree_id) === treeId) || null;
}

function analysisPhotoLink(photo) {
  const photoId = String(photo?.id || '');
  return (analysisSnapshot.photo_links || []).find((link) => String(link.photo_id) === photoId) || null;
}

function normalizeAnalysisEstimate(record) {
  return {
    treeId: record.tree_id,
    latitude: Number(record.latitude),
    longitude: Number(record.longitude),
    uncertaintyM: Number(record.uncertainty_m ?? record.uncertaintyM ?? 0),
    radius95M: Number(record.radius95_m ?? record.radius95M ?? 0),
    spreadM: Number(record.spread_m ?? record.spreadM ?? 0),
    shiftM: Number(record.shift_m ?? record.shiftM ?? 0),
    confidenceScore: Number(record.confidence_score ?? record.confidenceScore ?? 0),
    confidence: record.confidence || 'low',
    observationCount: Number(record.observation_count ?? record.observationCount ?? 0),
    photoIds: record.photo_ids || record.photoIds || [],
    usesEstimatedPosition: Boolean(record.uses_estimated_position ?? record.usesEstimatedPosition),
    source: record.source || 'local field pipeline'
  };
}

function mergeLocalAnalysisEstimates() {
  const normalize = window.cacaoaiPositionEstimator?.normalizeTreeId;
  if (!normalize) return;
  treePositionEstimates = {
    ...treePositionEstimates,
    ...(analysisSnapshot.position_estimates || []).reduce((result, record) => {
      const estimate = normalizeAnalysisEstimate(record);
      if (Number.isFinite(estimate.latitude) && Number.isFinite(estimate.longitude)) result[normalize(record.tree_id)] = estimate;
      return result;
    }, {})
  };
}

function displayTreePosition(tree) {
  const estimate = treePositionEstimate(tree);
  return estimate?.usesEstimatedPosition
    ? { lat: estimate.latitude, lng: estimate.longitude }
    : tree.position;
}

function positionSummary(estimate) {
  if (!estimate) return 'Registry position · no confirmed PWA GPS observation';
  const score = Number.isFinite(estimate.confidenceScore) ? `${Math.round(estimate.confidenceScore * 100)}% model score` : 'model score unavailable';
  const radius = Number.isFinite(estimate.radius95M) ? ` · 95% radius ±${estimate.radius95M.toFixed(1)}m` : '';
  const source = estimate.source?.includes('field-pipeline') ? ' · confirmed visits, M1 bias removed' : '';
  return `${estimate.confidence} (${score}) · ${estimate.observationCount} linked PWA photo${estimate.observationCount === 1 ? '' : 's'}${radius}${source}`;
}

function rebuildTreePositionEstimates() {
  const estimator = window.cacaoaiPositionEstimator;
  treePositionEstimates = estimator
    ? estimator.estimateTreePositions((cloudSnapshot.photos || []).map(remotePhotoRecord), registeredTreePoints)
    : {};
}

async function runLocalAnalysis() {
  analysisSnapshot = { status:'unavailable', reason:'local analysis service not started', photo_links:[], tree_records:[], position_estimates:[], sessions:[] };
  const bridge = window.cacaoaiLocalAnalysis;
  if (!bridge?.analyze) return;
  const config = window.cacaoaiDesktopConfig || {};
  try {
    const historicalNumbers = [...new Set((history?.trees || []).map((tree) => historicalTreeNumber(tree.label)).filter(Boolean))];
    analysisSnapshot = await bridge.analyze({
      farm_id: config.farmId || 'sample-farm',
      trees: registeredTreePoints.map((tree) => ({ id:tree.id, number:tree.number, areaId:tree.areaId, lat:tree.position.lat, lon:tree.position.lng })),
      photos: cloudSnapshot.photos || [],
      tag_map: window.valenciaTagMap || [],  // tag number -> registry tree, maintained by the administrator
      historical_numbers: [...new Set([...(window.valenciaHistoricalNumbers || []), ...historicalNumbers])],
      options: { session_gap_seconds:900, burst_gap_seconds:6, spacing_m:3, m3_min_groups:6, m3_max_shapes:12, suspect_max_probability:0.01 }
    });
    mergeLocalAnalysisEstimates();
  } catch (error) {
    console.warn('Local field analysis unavailable; browser estimator remains active.', error);
  }
}

async function loadExternalContext() {
  const config = window.cacaoaiDesktopConfig || {};
  const location = config.farmLocation || { latitude:9.262, longitude:123.218, timezone:'Asia/Manila' };
  const endDate = reportEndDate();
  const startDate = shiftDate(endDate, -6);
  const harvestSources = [
    ...(cloudSnapshot.harvestRecords || []).map(normalizeHarvestRecord),
    ...loadHarvestDrafts().map(normalizeHarvestRecord),
    ...(window.cacaoaiBuiltInHarvestRecords || []).map(normalizeHarvestRecord)
  ];
  const seenHarvestKeys = new Set();
  harvestRecords = harvestSources.filter((record) => {
    if (!record.date || (record.weightKg !== null && record.weightKg < 0)) return false;
    const key = `${record.date}|${record.treeId || record.areaId || 'farm'}`;
    if (seenHarvestKeys.has(key)) return false;
    seenHarvestKeys.add(key);
    return true;
  });
  const cloudPrices = (cloudSnapshot.marketPrices || []).map(normalizeMarketPrice).filter((record) => record.date && record.value !== null);
  marketPrices = {
    local: cloudPrices.filter((record) => record.scope !== 'international'),
    international: []
  };
  weatherSnapshot = { status:'unavailable', daily:[], summary:null, start_date:startDate, end_date:endDate };
  const bridge = window.cacaoaiLocalAnalysis;
  if (!bridge?.weather || !bridge?.marketPrices) return;
  const [weatherResult, marketResult] = await Promise.allSettled([
    bridge.weather({ latitude:location.latitude, longitude:location.longitude, startDate, endDate, timezone:location.timezone }),
    bridge.marketPrices({ startDate:shiftDate(endDate, -(Number(config.marketPriceMonths) || 24) * 31), endDate })
  ]);
  if (weatherResult.status === 'fulfilled') weatherSnapshot = weatherResult.value;
  else weatherSnapshot = { ...weatherSnapshot, status:'error', error:weatherResult.reason?.message || 'Weather unavailable' };
  if (marketResult.status === 'fulfilled') marketPrices.international = marketResult.value.series || [];
}

function nearestRegisteredTree(tree) {
  return registeredTreePoints.map((candidate) => ({ candidate, distance: distanceMeters(tree.lat, tree.lon, candidate.position.lat, candidate.position.lng) })).sort((a, b) => a.distance - b.distance)[0] || null;
}

function registeredTreeStatus(tree) {
  const position = displayTreePosition(tree);
  const match = history.trees.map((candidate) => ({ candidate, distance: distanceMeters(position.lat, position.lng, candidate.lat, candidate.lon) })).sort((a, b) => a.distance - b.distance)[0];
  if (!match || match.distance > 12 || !scanPhotos(match.candidate, scanSelection).length) return { key:'none', label:'No linked scan' };
  const signals = treeSignalCount(match.candidate, scanSelection, scanSelection === 'all' ? heatmapFilter : 'all');
  const rate = signals / scanPhotos(match.candidate, scanSelection).length;
  const key = priorityClass(rate);
  return { key, label:key === 'high' ? 'Priority' : key === 'medium' ? 'Follow-up' : 'Low signal', signals, distance:match.distance, source:match.candidate, positionEstimate:treePositionEstimate(tree) };
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
  mapLayerGroups.cloud = L.layerGroup().addTo(farmMap);
  mapLayerGroups.signals = L.layerGroup().addTo(farmMap);
  referenceContext = L.layerGroup();
  referenceOverlay = L.imageOverlay('./assets/valencia_1021_status.png', [[mapBounds.south, mapBounds.west], [mapBounds.north, mapBounds.east]], { opacity: 0.58, interactive: false });
  drawAreaLayer();
  drawTreeLayer();
  drawYoungLayer();
  drawCloudPhotoLayer();
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
    const estimate = treePositionEstimate(tree);
    const position = displayTreePosition(tree);
    const details = status.key === 'none' ? 'No linked scan yet' : `${status.label} · ${status.signals} signals · ${Math.round(status.distance)}m from scan GPS`;
    const positionLine = `Position: ${positionSummary(estimate)}${estimate?.usesEstimatedPosition ? ' · map updated' : ''}`;
    const linkage = analysisTreeRecord(tree);
    const linkageLine = linkage ? `Local model: ${linkage.photo_count} photo${linkage.photo_count === 1 ? '' : 's'} linked · ${Math.round(linkage.mean_assignment_confidence * 100)}% mean assignment confidence` : 'Local model: no linked PWA photo';
    L.circleMarker([position.lat, position.lng], { radius:4.5, color:'#fff', weight:1.5, fillColor, fillOpacity:.98 })
      .bindTooltip(`Tree ${tree.number}<br>${details}<br>${linkageLine}<br>${positionLine}`, { direction:'top' })
      .bindPopup(mapPopup(`Tree ${escapeHtml(tree.number)}`, [details, linkageLine, positionLine, `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`]), { autoPan:false })
      .addTo(mapLayerGroups.trees);
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

function drawCloudPhotoLayer() {
  if (!mapLayerGroups.cloud) return;
  mapLayerGroups.cloud.clearLayers();
  cloudSnapshot.photos.map(remotePhotoRecord).filter((photo) => Number.isFinite(photo.lat) && Number.isFinite(photo.lon)).forEach((photo) => {
    const pending = photo.aiStatus === 'not_started' || photo.aiStatus === 'pending';
    const marker = L.circleMarker([photo.lat, photo.lon], { radius:5.5, color:'#fff', weight:2, fillColor:pending ? '#2563eb' : photo.flagged ? '#b8443e' : '#4d9b6d', fillOpacity:.95 });
    const source = photo.driveUrl ? `<a href="${escapeHtml(photo.driveUrl)}" target="_blank" rel="noopener">Open source photo</a>` : 'Drive source pending';
    marker.bindPopup(mapPopup(escapeHtml(photo.name), [
      pending ? 'PWA upload · AI screening pending' : `PWA upload · ${photo.flagged} flagged`,
      `${escapeHtml(photo.areaId || 'Area not selected')} · ${escapeHtml(photo.treeNumber || 'Tree not confirmed')}`,
      photo.confirmedTreeId ? `Confirmed tree ID · GPS ±${photo.gpsAccuracy ? `${Math.round(photo.gpsAccuracy)}m` : 'unknown'}` : 'Tree ID not confirmed',
      analysisLinkLine(analysisPhotoLink(photo)),
      `${photo.lat.toFixed(6)}, ${photo.lon.toFixed(6)}`,
      source
    ]), { autoPan:false });
    const linkage = analysisPhotoLink(photo);
    if (linkage?.id_check === 'suspect') marker.setStyle({ color:'#d97706', weight:3 });
    marker.bindTooltip(`${escapeHtml(photo.name)}<br>${pending ? 'AI screening pending' : 'Synced PWA result'}<br>${analysisLinkLine(linkage)}`, { direction:'top' }).addTo(mapLayerGroups.cloud);
  });
}

// One line per photo: a confirmed ID and whether its GPS agrees, or a model link for an unconfirmed photo.
function analysisLinkLine(link) {
  if (!link) return 'Local model link pending';
  if (link.source === 'confirmed') {
    if (link.id_check === 'suspect') return `⚠ Check tag: confirmed ${escapeHtml(link.tree_id)}, but GPS points to ${escapeHtml(link.model_tree_id || '?')}`;
    return `Confirmed ${escapeHtml(link.tree_id)} · GPS check ${link.consistent_with_confirmed_id ? 'agrees' : 'inconclusive'}`;
  }
  if (link.model_source === 'number_match') return `Tag ${escapeHtml(link.reported_number || '?')} not in the tag table · probably ${escapeHtml(link.tree_id)} (${Math.round(link.confidence * 100)}%) · ${link.record_status === 'historical_number_only' ? 'known from older records' : 'needs review'}`;
  return `Model link · Tree ${escapeHtml(link.tree_id)} · ${Math.round(link.confidence * 100)}%${link.confidence_calibrated ? ' (calibrated)' : ' (uncalibrated)'}`;
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
  const estimatedCount = Object.values(treePositionEstimates).filter((estimate) => estimate.usesEstimatedPosition).length;
  const linkedByModel = (analysisSnapshot.tree_records || []).filter((record) => record.photo_count > 0).length;
  const evaluation = analysisSnapshot.evaluation;
  const evaluationLabel = evaluation?.status === 'ok' ? ` · GPS recovers ${Math.round(evaluation.accuracy * 100)}% of hidden tree IDs (${evaluation.visits} visits) · ${evaluation.suspect_confirmed_visits} tag reads to check` : '';
  const analysisLabel = analysisSnapshot.status === 'ok' ? ` · ${linkedByModel} trees with photos${evaluationLabel}` : ` · field model ${analysisSnapshot.status}`;
  $('map-status').textContent = `${registeredTreePoints.length} registered trees · ${youngTreeCandidates.length} young candidates · ${cloudSnapshot.photos.length} PWA uploads · ${estimatedCount} positions updated from GPS · ${linkedByModel} model-linked trees${analysisLabel} · ${treeCoverage.linked} linked · ${treeCoverage.noScan} no linked scan · ${history.trees.length} GPS signal groups · ${scanSelection === 'all' ? 'all scans' : scanDateLabel(scanSelection)} · ${disease === 'all' ? 'all signals' : signalNames[disease]} heatmap`;
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
  target.innerHTML = fieldActions.map((action) => { const outcome = scanKeys.length >= 2 ? actionOutcome(action, scanKeys[0].key, scanKeys[scanKeys.length - 1].key) : null; const result = outcome ? `<div class="action-result"><span>Observed after recheck</span><strong>${outcome.delta <= 0 ? '↓' : '↑'} ${Math.abs(Math.round(outcome.delta * 100))} pts</strong><small>${fmtPercent(outcome.beforeRate)} → ${fmtPercent(outcome.afterRate)} flagged-photo rate</small></div>` : '<div class="action-result pending"><span>Outcome</span><strong>Awaiting linked recheck</strong><small>Need matching Tree/Area records and both scan dates</small></div>'; const sourceLabel = action.source === 'cloud' ? 'Synced from PWA' : 'Local draft'; return `<article class="action-row"><div class="action-row-head"><strong>${escapeHtml(action.target)}</strong><span class="status-badge neutral">${sourceLabel}</span></div><p>${escapeHtml(action.treatment)}</p><small>${escapeHtml(action.actionDate)} · Recheck ${escapeHtml(action.recheckDate)}</small>${action.note ? `<em>${escapeHtml(action.note)}</em>` : ''}${result}</article>`; }).join('');
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
    drawCloudPhotoLayer();
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

function aggregateSeries(records, dateKey, valueKey) {
  const values = new Map();
  (records || []).forEach((record) => {
    const date = dateOnly(record[dateKey] || record.date);
    const rawValue = record[valueKey] ?? record.value;
    const value = rawValue === null || rawValue === undefined || rawValue === '' ? null : Number(rawValue);
    if (!date || !Number.isFinite(value)) return;
    values.set(date, (values.get(date) || 0) + value);
  });
  return [...values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}

function indexPriceSeries(points) {
  const usable = (points || []).filter((point) => Number.isFinite(Number(point.value)) && Number(point.value) > 0);
  if (!usable.length) return [];
  const base = Number(usable[0].value);
  return usable.map((point) => ({ date:point.date, value:Number(point.value) / base * 100 }));
}

function renderSvgChart(targetId, series, { emptyText = 'No records yet', unit = '' } = {}) {
  const target = $(targetId);
  if (!target) return;
  const validSeries = (series || []).map((item) => ({ ...item, points:(item.points || []).filter((point) => Number.isFinite(Number(point.value))) })).filter((item) => item.points.length);
  if (!validSeries.length) {
    target.innerHTML = `<div class="chart-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  const dates = [...new Set(validSeries.flatMap((item) => item.points.map((point) => point.date)))].sort();
  const values = validSeries.flatMap((item) => item.points.map((point) => Number(point.value)));
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const width = 760, height = 180, left = 36, right = 12, top = 12, bottom = 28;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const x = (index) => left + (dates.length <= 1 ? plotWidth / 2 : index / (dates.length - 1) * plotWidth);
  const y = (value) => top + (max - value) / (max - min) * plotHeight;
  const dateLabel = (value) => value?.slice(5) || '';
  const grid = [0, .5, 1].map((ratio) => { const value = max - (max - min) * ratio; const yy = top + plotHeight * ratio; return `<line class="chart-grid-line" x1="${left}" x2="${width - right}" y1="${yy}" y2="${yy}"/><text class="chart-axis-label" x="2" y="${yy + 3}">${value.toFixed(1)}${escapeHtml(unit)}</text>`; }).join('');
  const xLabels = dates.length <= 1 ? `<text class="chart-axis-label" x="${x(0)}" y="${height - 7}" text-anchor="middle">${dateLabel(dates[0])}</text>` : [dates[0], dates[Math.floor((dates.length - 1) / 2)], dates[dates.length - 1]].map((date, index, labels) => `<text class="chart-axis-label" x="${x(dates.indexOf(date))}" y="${height - 7}" text-anchor="${index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle'}">${dateLabel(date)}</text>`).join('');
  const lines = validSeries.map((item) => {
    const valuesByDate = new Map(item.points.map((point) => [point.date, Number(point.value)]));
    const points = dates.filter((date) => valuesByDate.has(date)).map((date) => `${x(dates.indexOf(date))},${y(valuesByDate.get(date))}`).join(' ');
    const dots = dates.filter((date) => valuesByDate.has(date)).map((date) => `<circle class="chart-dot" cx="${x(dates.indexOf(date))}" cy="${y(valuesByDate.get(date))}" r="3" fill="${item.color}"/>`).join('');
    return `<polyline class="chart-line" stroke="${item.color}" points="${points}"/>${dots}`;
  }).join('');
  const legend = validSeries.map((item) => `<span><i style="background:${item.color}"></i>${escapeHtml(item.label)}</span>`).join('');
  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Trend chart">${grid}${lines}${xLabels}</svg><div class="chart-legend">${legend}</div>`;
}

function renderStatisticsDashboard() {
  const status = $('statistics-status');
  const weatherSummary = weatherSnapshot.summary || {};
  const harvestSeries = aggregateSeries(harvestRecords, 'date', 'weightKg');
  const localPriceSeries = marketPrices.local.filter((point) => point.value !== null).sort((a, b) => a.date.localeCompare(b.date));
  const internationalSeries = (marketPrices.international || []).filter((point) => Number.isFinite(Number(point.value))).sort((a, b) => a.date.localeCompare(b.date));
  const harvestTotal = harvestRecords.reduce((sum, record) => sum + (Number(record.weightKg) || 0), 0);
  const harvestPods = harvestRecords.reduce((sum, record) => sum + (Number(record.pods) || 0), 0);
  const latestLocal = localPriceSeries.at(-1);
  const latestInternational = internationalSeries.at(-1);
  const formatPrice = (point) => point ? `${point.currency === 'PHP' ? '₱' : '$'}${Number(point.value).toLocaleString(undefined, { maximumFractionDigits:2 })}/${point.unit || 'kg'}` : '—';
  const weatherReady = weatherSnapshot.status === 'ok';
  const pricesReady = internationalSeries.length || localPriceSeries.length;
  status.textContent = weatherReady ? `Weather ${weatherSnapshot.start_date} → ${weatherSnapshot.end_date}` : 'Weather unavailable';
  status.className = `status-badge ${weatherReady ? 'neutral' : 'priority'}`;
  $('stats-kpis').innerHTML = `<div class="stats-kpi"><span>Rainfall</span><strong>${weatherReady ? `${weatherSummary.total_precipitation_mm ?? '—'} mm` : '—'}</strong><small>${weatherSummary.rainy_days ?? '—'} rainy days</small></div><div class="stats-kpi"><span>Average humidity</span><strong>${weatherSummary.average_humidity_pct ?? '—'}${weatherReady ? '%' : ''}</strong><small>${weatherSummary.average_temperature_c ?? '—'}°C average</small></div><div class="stats-kpi"><span>Recorded harvest</span><strong>${harvestTotal ? `${harvestTotal.toFixed(1)} kg` : '—'}</strong><small>${harvestRecords.length} records · ${harvestPods ? `${harvestPods.toLocaleString()} pods` : 'pods —'}</small></div><div class="stats-kpi"><span>Latest prices</span><strong>${formatPrice(latestLocal)}</strong><small>International: ${formatPrice(latestInternational)}</small></div>`;
  $('weather-period').textContent = weatherReady ? `${weatherSnapshot.start_date} → ${weatherSnapshot.end_date}` : 'No weather data';
  $('harvest-period').textContent = harvestSeries.length ? `${harvestSeries[0].date} → ${harvestSeries.at(-1).date}` : 'No production data';
  const priceDates = [...localPriceSeries, ...internationalSeries].map((point) => point.date).sort();
  $('price-period').textContent = priceDates.length ? `${priceDates[0]} → ${priceDates.at(-1)} · indexed` : 'No price data';
  renderSvgChart('weather-chart', [{ label:'Precipitation (mm)', color:'#3a73a4', points:(weatherSnapshot.daily || []).map((row) => ({ date:row.date, value:Number(row.precipitation_mm) || 0 })) }], { emptyText:'Weather data will appear when the local server can reach Open-Meteo', unit:' mm' });
  renderSvgChart('harvest-chart', [{ label:'Harvest (kg)', color:'#b97819', points:harvestSeries }], { emptyText:'No harvest records yet', unit:' kg' });
  renderSvgChart('price-chart', [
    { label:'Local market', color:'#b97819', points:indexPriceSeries(localPriceSeries) },
    { label:'International benchmark', color:'#3a73a4', points:indexPriceSeries(internationalSeries) }
  ], { emptyText:pricesReady ? 'Price data is being prepared' : 'Add local market observations to compare with the international benchmark', unit:'' });
}

function renderProduction() {
  const records = harvestRecords.length ? harvestRecords : (window.cacaoaiBuiltInHarvestRecords || []).map(normalizeHarvestRecord);
  const process = window.cacaoaiProductionProcessRecords || { fermentation:[], drying:[], dried:[] };
  const totalPods = records.reduce((sum, record) => sum + (Number(record.pods) || 0), 0);
  const totalWet = records.reduce((sum, record) => sum + (Number(record.weightKg) || 0), 0);
  const weighted = records.filter((record) => Number.isFinite(Number(record.weightKg))).sort((a, b) => Number(b.weightKg) - Number(a.weightKg))[0];
  $('production-metrics').innerHTML = [
    ['Harvests logged', records.length, 'field production records'],
    ['Pods harvested', totalPods.toLocaleString(), 'imported production log'],
    ['Wet beans', totalWet ? `${totalWet.toFixed(2)} kg` : '—', 'records with weight'],
    ['Largest harvest', weighted ? `${Number(weighted.weightKg).toFixed(2)} kg` : '—', weighted ? weighted.date : 'not recorded']
  ].map(([label, value, note]) => `<article class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></article>`).join('');
  $('production-harvest-table').innerHTML = [...records].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((record) => `<tr><td>${escapeHtml(record.date || '—')}</td><td>${record.pods === null ? '—' : Number(record.pods).toLocaleString()}</td><td>${record.weightKg === null ? '—' : `${Number(record.weightKg).toFixed(2)} kg`}</td><td>${escapeHtml(record.source || 'Production record')}</td></tr>`).join('');
  $('production-fermentation-grid').innerHTML = process.fermentation.map((batch) => `<article class="production-batch"><div class="production-batch-head"><strong>${escapeHtml(batch.batch)}</strong><span>${escapeHtml(batch.date)}</span></div><b>${escapeHtml(batch.quantity)}</b><p>${escapeHtml(batch.checkpoints)}</p><p>${escapeHtml(batch.status)}</p><small>${escapeHtml(batch.note)}</small></article>`).join('');
  $('production-drying-table').innerHTML = process.drying.map((row) => `<tr><td>${escapeHtml(row.batch)}</td><td>${escapeHtml(row.start)}</td><td>${escapeHtml(row.kept)}</td><td>${escapeHtml(row.days)}</td><td>${escapeHtml(row.note)}</td></tr>`).join('');
  $('production-dried-table').innerHTML = process.dried.map((row) => `<tr><td>${escapeHtml(row.batch)}</td><td>${escapeHtml(row.total)}</td><td>${escapeHtml(row.used)}</td><td>${escapeHtml(row.note)}</td></tr>`).join('');
  document.querySelectorAll('[data-production-tab]').forEach((button) => {
    button.onclick = () => {
      const tab = button.dataset.productionTab;
      document.querySelectorAll('[data-production-tab]').forEach((item) => item.classList.toggle('active', item === button));
      document.querySelectorAll('.production-panel').forEach((panel) => { panel.hidden = panel.id !== `production-panel-${tab}`; });
    };
  });
}

function renderSignals(targetId) {
  const entries = Object.entries(history.diseaseTypeCounts).sort((a,b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, value]) => value));
  $(targetId).innerHTML = entries.map(([key, value]) => `<div class="signal-row"><span>${signalNames[key] || key}</span><div class="signal-bar"><i style="width:${Math.round(value / max * 100)}%;background:${key === 'pest' ? '#d79027' : key === 'black_pod' ? '#6d5b55' : '#6b7db0'}"></i></div><strong>${value}</strong></div>`).join('');
}

function renderModelQuality() {
  const target = $('model-quality');
  const status = $('model-quality-status');
  if (!target || !status) return;
  const evaluation = analysisSnapshot.evaluation;
  const errorModel = analysisSnapshot.error_model;
  if (analysisSnapshot.status !== 'ok' || !evaluation || evaluation.status !== 'ok') {
    status.textContent = analysisSnapshot.status === 'no-data' ? 'No field uploads' : `Model ${analysisSnapshot.status || 'unavailable'}`;
    status.className = 'status-badge neutral';
    target.innerHTML = `<p class="card-note">${cloudSnapshot.photos.length ? 'Not enough confirmed visits for a leave-one-visit-out evaluation yet.' : 'The field-pipeline evaluation appears after photos with confirmed tree IDs arrive from the PWA.'}</p>`;
    return;
  }
  const percent = (value) => Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : '—';
  const metres = (value) => Number.isFinite(Number(value)) ? `±${Number(value).toFixed(1)}m` : '—';
  const calibratedError = evaluation.calibrated_calibration_error;
  status.textContent = `FIELD MODEL ${analysisSnapshot.model_version || 'v2'}`;
  status.className = 'status-badge neutral';
  target.innerHTML = `<div class="model-quality-grid"><div class="model-quality-item"><span>LOO accuracy</span><strong>${percent(evaluation.accuracy)}</strong><small>${evaluation.visits} confirmed visits</small></div><div class="model-quality-item"><span>Calibrated ECE</span><strong>${percent(calibratedError)}</strong><small>after temperature ${Number(evaluation.temperature).toFixed(2)}</small></div><div class="model-quality-item"><span>Within-visit GPS</span><strong>${metres(errorModel?.within_visit_sd_m)}</strong><small>shared stop noise</small></div><div class="model-quality-item"><span>Between-visit GPS</span><strong>${metres(errorModel?.between_visit_sd_m)}</strong><small>remaining visit variation</small></div><div class="model-quality-item"><span>Suspect tag checks</span><strong>${evaluation.suspect_confirmed_visits ?? 0}</strong><small>review before changing the ID</small></div><div class="model-quality-item"><span>Registry position error</span><strong>${metres(errorModel?.registry_sd_m)}</strong><small>learned registry prior</small></div></div><p class="model-quality-note"><strong>Interpretation:</strong> GPS proposes a check; the confirmed field ID remains authoritative. The calibrated ECE is shown separately from the raw confidence gap.</p>`;
}

function renderAreas() {
  const stats = areaStats();
  $('area-table').innerHTML = Object.values(stats).map((stat) => `<tr><td><button class="area-link" data-area="${stat.id}">Area ${stat.id}</button></td><td>${stat.registered}</td><td>${stat.trees}</td><td>${stat.photos}</td><td>${stat.signals}</td><td><span class="priority-text ${priorityClass(stat.rate)}">${stat.signals ? (priorityClass(stat.rate) === 'high' ? 'Priority' : 'Follow-up') : 'No scan signal'}</span></td></tr>`).join('');
  document.querySelectorAll('.area-link').forEach((button) => button.addEventListener('click', () => openArea(button.dataset.area)));
}

function renderTrees(query = '') {
  const normalized = query.toLowerCase().trim();
  const rows = history.trees.map((tree, index) => ({ tree, index, signals: totalSignals(tree), area: areaForTree(tree) })).filter(({ tree, area }) => `${tree.label} ${area}`.toLowerCase().includes(normalized)).sort((a,b) => b.signals - a.signals || b.tree.pods - a.tree.pods);
  $('tree-list').innerHTML = rows.map(({ tree, index, signals, area }) => { const linkage = nearestRegisteredTree(tree); const record = linkage && linkage.distance <= 12 ? analysisTreeRecord(linkage.candidate) : null; const modelLine = record ? ` · ${record.photo_count} model-linked` : ''; return `<button class="tree-row ${selectedTree === tree ? 'selected' : ''}" data-tree-index="${index}"><span class="tree-dot ${signals >= 5 ? 'high' : signals ? 'medium' : 'low'}"></span><span><strong>${tree.label.match(/木\s+([^（]+)/)?.[1] || tree.label}</strong><small>Area ${area} · ${tree.photos?.length || 0} photos · ${tree.pods} pod detections${modelLine}</small></span><em>${signals} signals</em></button>`; }).join('');
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
  const registryMatch = nearestRegisteredTree(selectedTree);
  const estimate = registryMatch && registryMatch.distance <= 12 ? treePositionEstimate(registryMatch.candidate) : null;
  const positionLine = registryMatch && registryMatch.distance <= 12 ? `${registryMatch.candidate.number} · ${positionSummary(estimate)}` : 'No registered tree position linked';
  const modelRecord = registryMatch && registryMatch.distance <= 12 ? analysisTreeRecord(registryMatch.candidate) : null;
  const modelLine = modelRecord ? `${modelRecord.photo_count} PWA photo${modelRecord.photo_count === 1 ? '' : 's'} linked · ${Math.round(modelRecord.mean_assignment_confidence * 100)}% mean assignment confidence · ${modelRecord.confirmed_photo_count} confirmed / ${modelRecord.inferred_photo_count} inferred` : 'No local model link yet';
  $('tree-detail').innerHTML = `<div class="detail-header"><div><p class="eyebrow">Selected tree group</p><h2>${selectedTree.label.match(/木\s+([^（]+)/)?.[1] || selectedTree.label}</h2></div><span class="status-badge ${signals ? 'priority' : 'neutral'}">${signals ? 'Field confirmation' : 'No flagged history'}</span></div><p class="section-note">${selectedTree.label}</p><div class="detail-kpis"><div><small>Photos</small><strong>${selectedTree.photos?.length || 0}</strong></div><div><small>Pod detections</small><strong>${selectedTree.pods}</strong></div><div><small>Signals</small><strong>${signals}</strong></div></div><div class="detail-lines"><span><span>Mapped area</span><strong>Area ${area}</strong></span><span><span>GPS group</span><strong>${selectedTree.lat.toFixed(6)}, ${selectedTree.lon.toFixed(6)}</strong></span><span><span>Registered tree</span><strong>${positionLine}</strong></span><span><span>Photo linkage</span><strong>${modelLine}</strong></span><span><span>Signal types</span><strong>${kindList}</strong></span><span><span>Next action</span><strong>${signals ? 'Start the next field check here' : 'Keep monitoring'}</strong></span></div><button class="primary-button detail-action" type="button" id="detail-action-button">＋ Record field action</button>`;
  $('detail-action-button').addEventListener('click', () => { showToast('Field action entry will be linked to this tree in the next sync slice.'); openView('actions'); });
  openView('trees');
}

function renderPhotos(filter = 'all') {
  const records = history.trees.flatMap((tree) => (tree.photos || []).filter((photo) => photo.flagged || photo.pods || photo.cloud).map((photo) => ({ ...photo, tree, area: photo.areaId || areaForTree(tree), signals: photo.signalType ? [photo.signalType] : Object.keys(tree.flagged || {}) }))).filter((record) => filter === 'all' || record.signals.includes(filter)).sort((a,b) => (b.flagged - a.flagged) || (b.pods - a.pods)).slice(0, 18);
  $('photo-count-label').textContent = history.totalPhotos;
  $('photo-review-grid').innerHTML = records.map((record) => { const pending = record.cloud && !record.flagged && !record.pods; const sourceLink = record.driveUrl ? `<a class="small-button photo-source" href="${escapeHtml(record.driveUrl)}" target="_blank" rel="noopener">Open source photo ↗</a>` : ''; const linkage = analysisPhotoLink(record); const linkageTag = `<span class="tag ${linkage?.id_check === 'suspect' ? 'alert' : ''}">${analysisLinkLine(linkage)}</span>`; return `<article class="photo-card"><h3>${escapeHtml(record.name)}</h3><p>${escapeHtml(record.tree.label)} · Area ${escapeHtml(record.area)}</p><div class="tag-row"><span class="tag ${record.flagged ? 'alert' : ''}">${record.flagged ? `${record.flagged} flagged` : pending ? 'Awaiting AI screening' : 'No flagged pod'}</span><span class="tag">${record.pods} pod${record.pods === 1 ? '' : 's'}</span><span class="tag">${record.cloud ? 'Synced from PWA' : 'Historical snapshot'}</span>${linkageTag}</div><div class="photo-card-actions">${sourceLink}<button class="small-button photo-open" data-tree-index="${history.trees.indexOf(record.tree)}" type="button">Open tree record →</button></div></article>`; }).join('');
  document.querySelectorAll('.photo-open').forEach((button) => button.addEventListener('click', () => openTree(Number(button.dataset.treeIndex))));
}

function renderReport() {
  renderMetrics('report-metrics');
  renderSignals('report-signals');
  const priorities = Object.values(areaStats()).filter((stat) => stat.signals).sort((a,b) => b.rate - a.rate).slice(0, 3);
  $('recommendations').innerHTML = priorities.map((stat) => `<li><span><strong>Inspect Area ${stat.id} first</strong><br>${stat.signals} signals across ${stat.photos} historical photos; confirm the highest-signal trees in person.</span></li>`).join('') || '<li><span>No area-level follow-up is currently queued.</span></li>';
}

function openArea(area) { showToast(`Area ${area} selected. Opening the area workload.`); openView('areas'); document.querySelectorAll('[data-area]').forEach((row) => row.classList.toggle('selected', row.dataset.area === area)); }
function openView(view) { currentView = view; document.querySelectorAll('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`)); document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view)); $('page-title').textContent = ({ overview:'Farm dashboard', areas:'Areas', trees:'Tree records', photos:'Photo review', actions:'Field actions', report:'Weekly report', production:'Production records' })[view]; window.scrollTo({ top:0, behavior:'smooth' }); }

async function loadData() {
  setCloudStatus('LOADING CLOUD…', 'neutral');
  const response = await fetch('../cacaoai-pwa/data/valencia-tree-history-20261104.json');
  if (!response.ok) throw new Error(`Data load failed (${response.status})`);
  const baseHistory = await response.json();
  try {
    cloudSnapshot = await window.cacaoaiCloud.loadSnapshot();
    history = mergeCloudPhotos(baseHistory, cloudSnapshot.photos);
    fieldActions = [...cloudSnapshot.actions.map(normalizeCloudAction), ...loadFieldActions()];
    setCloudStatus(`${cloudSnapshot.photos.length} PWA UPLOADS${cloudSnapshot.status === 'partial' ? ' · PARTIAL' : ''}`, cloudSnapshot.status === 'partial' ? 'warning' : 'connected');
  } catch (error) {
    cloudSnapshot = { photos:[], actions:[], harvestRecords:[], marketPrices:[], status:'fallback', error:error.message };
    history = baseHistory;
    fieldActions = loadFieldActions();
    setCloudStatus('STATIC FALLBACK', 'warning');
    console.warn('Cloud snapshot unavailable; using local historical data.', error);
  }
  rebuildTreePositionEstimates();
  await runLocalAnalysis();
  scanOptions = buildScanOptions();
  // Show the map and records first: weather and international prices come from outside
  // services through the local server and can take up to the request timeout (12 s).
  renderAll();
  await loadExternalContext();
  renderAll();
}

function renderAll() {
  renderScanTimeline(); renderMetrics(); renderMap(); renderPriority(); renderSignals('signal-list'); renderModelQuality(); renderAreas(); renderTrees(); renderPhotos(); renderReport(); renderStatisticsDashboard(); renderProduction(); renderEffectiveness(); renderActionLog();
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => openView(button.dataset.view)));
$('tree-search').addEventListener('input', (event) => renderTrees(event.target.value));
$('photo-filter').addEventListener('change', (event) => renderPhotos(event.target.value));
$('refresh-data').addEventListener('click', async () => { try { await loadData(); showToast(cloudSnapshot.status === 'connected' ? 'Cloud data refreshed.' : 'Historical snapshot refreshed.'); } catch (error) { setCloudStatus('LOAD ERROR', 'warning'); showToast(error.message); } });
$('new-action').addEventListener('click', () => { openView('actions'); setTimeout(() => $('action-target').focus(), 50); });
$('action-form').addEventListener('submit', (event) => { event.preventDefault(); fieldActions.unshift({ id: Date.now(), target: $('action-target').value.trim(), treatment: $('action-treatment').value.trim(), actionDate: $('action-date').value, recheckDate: $('action-recheck').value, note: $('action-note').value.trim() }); saveFieldActions(); renderActionLog(); renderEffectiveness(); event.target.reset(); showToast('Field action saved locally.'); });
$('harvest-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const target = $('harvest-target').value.trim();
  const isArea = /^area\s+/i.test(target);
  const record = {
    id: `harvest-${Date.now()}`,
    harvest_date: $('harvest-date').value,
    weight_kg: Number($('harvest-weight').value),
    area_id: isArea ? target.replace(/^area\s+/i, '') : null,
    tree_id: isArea || !target ? null : target.replace(/^tree\s+/i, ''),
    grade: $('harvest-grade').value.trim() || null,
    source: 'Desktop harvest record'
  };
  try {
    const saved = await window.cacaoaiCloud.createHarvestRecord(record);
    harvestRecords.unshift(normalizeHarvestRecord({ ...saved, source:'Supabase harvest record' }));
    $('harvest-entry-status').textContent = 'Saved to Supabase harvest_records.';
  } catch (error) {
    const drafts = [record, ...loadHarvestDrafts()];
    saveHarvestDrafts(drafts);
    harvestRecords.unshift(normalizeHarvestRecord(record));
    $('harvest-entry-status').textContent = `Saved as a local draft (${error.message}). Create harvest_records and its RLS policy to sync it.`;
  }
  renderStatisticsDashboard();
  event.target.reset();
  showToast('Harvest record saved.');
});
$('download-report').addEventListener('click', () => { const lines = [`Valencia DA Pilot Farm — scan ${history.scanDate}`, `Scanned photos: ${history.totalPhotos}`, `Disease signals: ${history.diseasedPhotos}`, `Tree records: ${history.trees.length}`, ...Object.entries(history.diseaseTypeCounts).map(([key, value]) => `${signalNames[key] || key}: ${value}`)]; const blob = new Blob([lines.join('\n')], { type:'text/plain' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'valencia-cacao-weekly-summary.txt'; link.click(); URL.revokeObjectURL(link.href); });
loadData().catch((error) => { $('map-status').textContent = error.message; showToast(error.message); });
