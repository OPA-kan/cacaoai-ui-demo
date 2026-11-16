(() => {
  const LAT_METERS = 111000;
  const LON_METERS = 109000;

  function normalizeTreeId(value) {
    return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function distanceMeters(x, y) {
    return Math.sqrt((x * x) + (y * y));
  }

  function weightedMean(observations, prior, priorWeight) {
    let weight = priorWeight;
    let x = prior.x * priorWeight;
    let y = prior.y * priorWeight;
    observations.forEach((observation) => {
      weight += observation.weight;
      x += observation.x * observation.weight;
      y += observation.y * observation.weight;
    });
    return { x: x / weight, y: y / weight, weight };
  }

  function estimateTreePositions(photos, trees, options = {}) {
    const priorSigmaM = Number(options.priorSigmaM) || 4;
    const cameraOffsetSigmaM = Number(options.cameraOffsetSigmaM) || 4;
    const minimumDisplayConfidence = options.minimumDisplayConfidence || 'medium';
    const confidenceRank = { low: 0, medium: 1, high: 2 };
    const treeById = new Map();

    (trees || []).forEach((tree) => {
      const id = normalizeTreeId(tree.id || tree.number);
      if (id && tree.position && Number.isFinite(tree.position.lat) && Number.isFinite(tree.position.lng)) treeById.set(id, tree);
    });

    const grouped = new Map();
    (photos || []).forEach((photo) => {
      const treeId = normalizeTreeId(photo.confirmedTreeId || photo.confirmed_tree_id);
      const lat = finiteNumber(photo.lat ?? photo.latitude);
      const lon = finiteNumber(photo.lon ?? photo.longitude);
      if (!treeId || !treeById.has(treeId) || lat === null || lon === null) return;
      if (!grouped.has(treeId)) grouped.set(treeId, []);
      grouped.get(treeId).push({ lat, lon, accuracy: finiteNumber(photo.gpsAccuracy ?? photo.gps_accuracy), photoId: photo.id || null });
    });

    const estimates = {};
    grouped.forEach((observations, treeId) => {
      const tree = treeById.get(treeId);
      const origin = tree.position;
      const prior = { x: 0, y: 0 };
      const priorWeight = 1 / (priorSigmaM * priorSigmaM);
      const projected = observations.map((observation) => {
        const x = (observation.lon - origin.lng) * LON_METERS;
        const y = (observation.lat - origin.lat) * LAT_METERS;
        const gpsSigma = Math.max(observation.accuracy || 10, 5);
        const sigma = Math.sqrt((gpsSigma * gpsSigma) + (cameraOffsetSigmaM * cameraOffsetSigmaM));
        return { ...observation, x, y, sigma, weight: 1 / (sigma * sigma) };
      });

      let posterior = weightedMean(projected, prior, priorWeight);
      // A single bad GPS fix should not pull the tree position across the farm.
      for (let pass = 0; pass < 2; pass += 1) {
        const robust = projected.map((observation) => {
          const residual = distanceMeters(observation.x - posterior.x, observation.y - posterior.y);
          const factor = residual > 12 ? 12 / residual : 1;
          return { ...observation, weight: observation.weight * factor };
        });
        posterior = weightedMean(robust, prior, priorWeight);
      }

      const observationWeight = projected.reduce((sum, observation) => sum + observation.weight, 0);
      const spreadM = Math.sqrt(projected.reduce((sum, observation) => {
        const residual = distanceMeters(observation.x - posterior.x, observation.y - posterior.y);
        return sum + (residual * residual * observation.weight);
      }, 0) / Math.max(observationWeight, 1));
      const uncertaintyM = Math.max(2.5, Math.sqrt(1 / Math.max(posterior.weight, 0.0001)));
      const shiftM = distanceMeters(posterior.x, posterior.y);
      const confidenceScore = Math.max(0.01, Math.min(0.99,
        (1 - Math.exp(-projected.length / 2.4))
        * Math.exp(-spreadM / 10)
        * Math.exp(-Math.max(0, shiftM - 8) / 12)
      ));
      const confidence = projected.length >= 3 && uncertaintyM <= 4.5 && spreadM <= 6 && shiftM <= 8
        ? 'high'
        : projected.length >= 2 && uncertaintyM <= 7 && spreadM <= 10 && shiftM <= 12
          ? 'medium'
          : 'low';
      const usesEstimatedPosition = confidenceRank[confidence] >= confidenceRank[minimumDisplayConfidence] && projected.length >= 2;

      estimates[treeId] = {
        treeId: tree.id || tree.number,
        latitude: origin.lat + (posterior.y / LAT_METERS),
        longitude: origin.lng + (posterior.x / LON_METERS),
        uncertaintyM,
        radius95M: Math.max(4.9, uncertaintyM * 1.96),
        spreadM,
        shiftM,
        confidenceScore,
        confidence,
        observationCount: projected.length,
        photoIds: projected.map((observation) => observation.photoId).filter(Boolean),
        usesEstimatedPosition,
        source: 'confirmed PWA photo GPS + registry prior'
      };
    });
    return estimates;
  }

  window.cacaoaiPositionEstimator = { estimateTreePositions, normalizeTreeId };
})();
