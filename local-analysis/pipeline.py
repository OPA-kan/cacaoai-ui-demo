"""Local production adapter for the Valencia field-analysis pipeline.

Almost every PWA photo carries a field-confirmed tree ID, so the confirmed
photos are the data and the research models are the tools that use them:

0. Numbers.  The tree is what the field reported: the typed tag number
   (``tree_number``) resolved through the tag table (``tag_map``), or a
   ``confirmed_tree_id`` picked later.  A number that does not resolve is kept
   as reported ("historical_number_only" / "photo_number_unmatched"); GPS
   then suggests which registry tree it is (``number_matches``) for an
   administrator to add to the tag table.  Every link carries a
   ``record_status`` (confirmed, registered, gps_conflict, unmatched, no_number).
1. Visits.  Consecutive photos of one confirmed tree are one visit.  Their GPS
   fixes are strongly correlated, so a visit, not a photo, is the unit of
   evidence (three photos from one stop are not three observations).
2. Error model and tree positions (M1).  Each visit's mean position is
   ``z_v = theta_t + b_v + e_v``: the tree's true position, the GPS bias at
   that moment and independent noise.  ``theta_t`` has the registry position
   as prior; ``b_v`` is the M1 AR(1) bias, smoothed per session with the
   Kalman smoother of graph_linkage_poc.  The two are fitted alternately
   (exact MAP of a linear-Gaussian model), with robust weights for outlying
   visits.  The noise levels are learned from the data: within-visit spread
   and between-visit residuals.
3. Tree positions move only on confirmed visits, and only when seen in at
   least two sessions, because a single session cannot separate a tree's
   registry error from that session's GPS bias.
4. Leave-one-visit-out posterior.  Each confirmed visit's ID is hidden and the
   tree is predicted from its bias-corrected position (with the tree's own
   estimate recomputed without that visit) and the neighbouring visits.  This
   gives (a) the live accuracy and confidence calibration of the linkage and
   (b) a check of each confirmed ID: a visit whose GPS clearly points at
   another tree is flagged as a possible tag-reading error.
5. Unconfirmed photos (rare) get the same posterior, tempered by the
   temperature learned in step 4.
6. M3/M2 (joint_viterbi) can run on the bias-corrected visits as a diagnostic
   of the row shape (``run_m3``; about two minutes per session), and its tree
   assignment is scored against the confirmed IDs.  Its natural use is an
   area without a trustworthy registry, such as the young trees.
"""

from __future__ import annotations

import math
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np


HERE = Path(__file__).resolve().parent
WORKSPACE_ROOT = Path(os.environ.get("CACOAI_WORKSPACE_ROOT", HERE.parents[1]))
for module_root in (WORKSPACE_ROOT / "gpp_tree_linkage_poc", WORKSPACE_ROOT / "gps_grid_poc"):
    if str(module_root) not in sys.path:
        sys.path.insert(0, str(module_root))

from graph_linkage_poc import _kalman_smoother  # noqa: E402  (M1 AR(1) bias smoother)
from joint_viterbi import JointParams, fit_m3_to_joint  # noqa: E402


MODEL_VERSION = "field-pipeline-v2"
METERS_PER_DEGREE = 111320.0
DEFAULTS = {
    "session_gap_seconds": 900.0,
    "burst_gap_seconds": 6.0,
    "spacing_m": 3.0,
    "registry_sd_m": 3.0,        # starting prior spread of a registry position around the true tree (then learned)
    "registry_sd_min_m": 1.0,    # the registry was itself surveyed with GPS: never trust it below this
    "bias_sd_m": 4.0,            # M1 prior GPS bias (JointParams.bias_sd)
    "bias_phi_per_visit": 0.9,   # M1 AR(1) persistence between consecutive visits
    "camera_distance_m": JointParams.camera_distance_mean,
    "candidate_radius_m": 15.0,
    "walk_length_m": 4.5,        # neighbouring visits are usually at nearby trees
    "move_min_sessions": 2,
    "move_max_sd_m": 1.5,
    "suspect_max_probability": 0.05,
    "calibration_min_visits": 30,
    "m3_min_groups": 6,
    "run_m3": False,
    "number_match_min_probability": 0.8,
    "tagged_tree_prior": 0.05,   # a tree that already has a known tag rarely carries a second one
    "max_fix_age_seconds": 120.0,        # a GPS fix this much older than the photo is not that photo's position
    "repeated_fix_min_photos": 3,        # the same exact coordinates on this many photos ...
    "repeated_fix_span_seconds": 120.0,  # ... taken over this long is a frozen fix reused by the app, not GPS
}


# ---------------------------------------------------------------------- parsing

def normalize_tree_id(value: Any) -> str:
    return "".join(character for character in str(value or "").strip().lower() if character.isalnum())


def parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


class Frame:
    """Local metres east/north of an origin (equirectangular, fine at farm scale)."""

    def __init__(self, lat: float, lon: float) -> None:
        self.lat, self.lon = lat, lon
        self.kx = METERS_PER_DEGREE * math.cos(math.radians(lat))

    def project(self, lat: float, lon: float) -> np.ndarray:
        return np.array([(lon - self.lon) * self.kx, (lat - self.lat) * METERS_PER_DEGREE])

    def unproject(self, point: np.ndarray) -> tuple[float, float]:
        return self.lat + float(point[1]) / METERS_PER_DEGREE, self.lon + float(point[0]) / self.kx


def normalize_tree(row: dict[str, Any]) -> dict[str, Any] | None:
    position = row.get("position") or {}
    lat = finite(row.get("lat", position.get("lat")))
    lon = finite(row.get("lon", row.get("lng", position.get("lng"))))
    tree_id = row.get("id") or row.get("number")
    if not tree_id or lat is None or lon is None:
        return None
    return {"id": str(tree_id), "number": str(row.get("number") or tree_id),
            "area_id": row.get("areaId") or row.get("area_id"), "lat": lat, "lon": lon}


def normalize_photo(row: dict[str, Any], index: int) -> dict[str, Any]:
    return {
        "id": str(row.get("id") or row.get("file_name") or f"photo-{index:05d}"),
        "captured_at": parse_time(row.get("captured_at") or row.get("capturedAt")),
        "lat": finite(row.get("latitude", row.get("lat"))),
        "lon": finite(row.get("longitude", row.get("lon"))),
        "gps_accuracy": finite(row.get("gps_accuracy", row.get("gpsAccuracy"))),
        "gps_fixed_at": parse_time(row.get("gps_fixed_at") or row.get("gpsFixedAt")),
        "gps_status": "ok",
        "confirmed_tree_id": row.get("confirmed_tree_id") or row.get("confirmedTreeId"),
        "tree_number": row.get("tree_number") or row.get("treeNumber"),
        "area_id": row.get("area_id") or row.get("areaId"),
        "heading_deg": finite(row.get("heading_deg", row.get("heading"))),
    }


def reject_unreliable_gps(photos: list[dict[str, Any]], options: dict[str, Any]) -> dict[str, int]:
    """Drop GPS that is not the photo's own position; the photo and its tag number are kept.

    * ``stale_fix``: the fix was taken long before the photo (``gps_fixed_at``).
    * ``repeated_fix``: identical coordinates on several photos spread over minutes.
      Live GPS always jitters, so this is a position the app took once and reused
      (PWA builds before 2026-11-11 read GPS only when the app opened).
    """
    for photo in photos:
        if photo["lat"] is None or photo["lon"] is None:
            photo["gps_status"] = "missing"
        elif (photo["gps_fixed_at"] and photo["captured_at"]
              and (photo["captured_at"] - photo["gps_fixed_at"]).total_seconds() > options["max_fix_age_seconds"]):
            photo["gps_status"] = "stale_fix"
    groups: dict[tuple[float, float], list[dict[str, Any]]] = defaultdict(list)
    for photo in photos:
        if photo["gps_status"] == "ok":
            groups[(round(photo["lat"], 7), round(photo["lon"], 7))].append(photo)
    for group in groups.values():
        times = [p["captured_at"] for p in group if p["captured_at"]]
        span = (max(times) - min(times)).total_seconds() if len(times) > 1 else 0.0
        if len(group) >= options["repeated_fix_min_photos"] and span > options["repeated_fix_span_seconds"]:
            for photo in group:
                photo["gps_status"] = "repeated_fix"
    counts: dict[str, int] = defaultdict(int)
    for photo in photos:
        counts[photo["gps_status"]] += 1
        if photo["gps_status"] != "ok":
            photo["lat"] = photo["lon"] = None
    return dict(counts)


def number_only_links(photos: list[dict[str, Any]], book: "NumberBook", trees_list: list[dict]) -> list[dict[str, Any]]:
    """Links from tag numbers alone, for a payload without any usable GPS."""
    by_key = {normalize_tree_id(t["id"]): t for t in trees_list}
    links = []
    for photo in photos:
        key, _, status = book.resolve(photo)
        links.append({
            "photo_id": photo["id"], "tree_id": by_key[key]["id"] if key in by_key else None,
            "source": "confirmed" if key in by_key else "unlinked", "confidence": 1.0 if key in by_key else 0.0,
            "reported_number": photo["tree_number"], "record_status": status, "gps_status": photo["gps_status"],
            "gps_distance_m": None, "raw_gps_distance_m": None,
            "captured_at": photo["captured_at"].isoformat() if photo["captured_at"] else None,
        })
    return links


def circular_mean_deg(values: list[float]) -> float | None:
    if not values:
        return None
    radians = np.radians(values)
    return float(np.degrees(np.arctan2(np.mean(np.sin(radians)), np.mean(np.cos(radians)))) % 360.0)


# ------------------------------------------------------------- sessions/visits

def _gap(a: dict[str, Any], b: dict[str, Any]) -> float:
    return (b["captured_at"] - a["captured_at"]).total_seconds() if a["captured_at"] and b["captured_at"] else 0.0


def split_sessions(photos: list[dict[str, Any]], gap_seconds: float) -> list[list[dict[str, Any]]]:
    start = datetime.min.replace(tzinfo=timezone.utc)
    ordered = sorted(photos, key=lambda p: (p["captured_at"] is None, p["captured_at"] or start, p["id"]))
    sessions: list[list[dict[str, Any]]] = []
    for photo in ordered:
        previous = sessions[-1][-1] if sessions else None
        area_changed = previous and photo["area_id"] and previous["area_id"] and photo["area_id"] != previous["area_id"]
        if previous is None or _gap(previous, photo) > gap_seconds or area_changed:
            sessions.append([photo])
        else:
            sessions[-1].append(photo)
    return sessions


class NumberBook:
    """Resolves what a photo says about its tree.

    The PWA stores the number typed in the field (``tree_number``, normally the
    three-digit tag) and, only when someone picked a tree afterwards,
    ``confirmed_tree_id``.  A typed number resolves through the tag table
    (``tag_map``: tag number -> registry tree), or directly when it is a
    registry id/number.  An unresolved number is kept as reported, never
    replaced: it is "historical_number_only" when older records know it and
    "photo_number_unmatched" otherwise.
    """

    def __init__(self, trees_list: list[dict], tag_map: Any, historical_numbers: Any) -> None:
        self.registry: dict[str, str] = {}
        for tree in trees_list:
            key = normalize_tree_id(tree["id"])
            self.registry.setdefault(key, key)
            self.registry.setdefault(normalize_tree_id(tree["number"]), key)
        pairs = tag_map.items() if isinstance(tag_map, dict) else (
            (row.get("tag_number") or row.get("number"), row.get("tree_id")) for row in (tag_map or []))
        self.tags = {normalize_tree_id(tag): self.registry[normalize_tree_id(tree)]
                     for tag, tree in pairs if tag and normalize_tree_id(tree) in self.registry}
        self.historical = {normalize_tree_id(n) for n in (historical_numbers or [])}

    def resolve(self, photo: dict[str, Any]) -> tuple[str | None, str | None, str]:
        """(tree key or None, normalised reported number, record status)."""
        confirmed = normalize_tree_id(photo["confirmed_tree_id"])
        number = normalize_tree_id(photo["tree_number"]) or None
        if confirmed in self.registry:
            return self.registry[confirmed], number, "confirmed"
        if number:
            key = self.tags.get(number) or self.registry.get(number)
            if key:
                return key, number, "registered"
            return None, number, "historical_number_only" if number in self.historical else "photo_number_unmatched"
        return None, None, "no_number"


def make_visits(session: list[dict[str, Any]], book: NumberBook, burst_gap: float) -> list[dict[str, Any]]:
    """Consecutive photos reporting the same tree/number (or one burst of photos without a number)."""
    visits: list[dict[str, Any]] = []
    for photo in session:
        key, number, status = book.resolve(photo)
        current = visits[-1] if visits else None
        same = (current is not None and current["key"] == key and current["number"] == number
                and (key is not None or number is not None or _gap(current["photos"][-1], photo) <= burst_gap))
        if same:
            current["photos"].append(photo)
        else:
            visits.append({"key": key, "number": number, "status": status, "photos": [photo]})
    return visits


# ------------------------------------------------------------------ the model

def visit_observation(visit: dict[str, Any], frame: Frame, camera_distance: float) -> None:
    """Mean tree-position estimate of a visit: GPS moved forward along the camera heading."""
    points = []
    for photo in visit["photos"]:
        if photo["lat"] is None or photo["lon"] is None:
            continue
        point = frame.project(photo["lat"], photo["lon"])
        if photo["heading_deg"] is not None:  # the photographer stands in front of the tree, facing it
            h = math.radians(photo["heading_deg"])
            point = point + camera_distance * np.array([math.sin(h), math.cos(h)])
        points.append(point)
    visit["n"] = len(points)
    visit["z"] = np.mean(points, axis=0) if points else None
    visit["within_ss"] = float(np.sum((np.asarray(points) - visit["z"]) ** 2)) if points else 0.0
    times = [p["captured_at"] for p in visit["photos"] if p["captured_at"]]
    visit["time"] = min(times) if times else None


def fit_error_model(visits: list[dict[str, Any]], registry: dict[str, np.ndarray], options: dict[str, Any]) -> dict[str, Any]:
    """Alternate tree positions and the per-session M1 bias on confirmed visits."""
    confirmed = [v for v in visits if v["key"] and v["z"] is not None and not v.get("excluded")]
    for v in visits:
        if v.get("excluded"):
            v["w"] = 0.0
    # Within-visit spread: pooled per-axis variance of photos around their visit mean.
    dof = sum(2 * (v["n"] - 1) for v in confirmed)
    within_var = sum(v["within_ss"] for v in confirmed) / dof if dof > 0 else 4.0
    between_var = 4.0  # per-axis variance of a visit mean around tree + bias; re-estimated below
    tau2 = options["registry_sd_m"] ** 2
    for v in visits:
        v["bias"] = np.zeros(2)
        v["weight"] = 1.0
    theta = {k: p.copy() for k, p in registry.items()}
    precision: dict[str, float] = {}
    for _ in range(6):
        # Trees given the bias: precision-weighted mean of the registry prior and the visits.
        sums: dict[str, np.ndarray] = defaultdict(lambda: np.zeros(2))
        weights: dict[str, float] = defaultdict(float)
        for v in confirmed:
            w = v["weight"] / (between_var + within_var / v["n"])
            v["w"] = w
            sums[v["key"]] += w * (v["z"] - v["bias"])
            weights[v["key"]] += w
        # Datum: a translation shared by every tree and every session's bias is not
        # identifiable from the data.  With datum "registry" the trees keep the
        # registry's mean position and the shared offset goes to the GPS bias; with
        # "gps" the bias averages to zero over all visits instead (applied below).
        data_mean = {k: sums[k] / weights[k] for k in weights}
        shift = np.zeros(2)
        if weights and options.get("datum", "registry") == "registry":
            shift = np.mean([data_mean[k] - registry[k] for k in weights], axis=0)
        # Registry error learned from the data (empirical Bayes): the spread of the
        # trees' data-only positions around the registry, minus their own noise.
        if len(weights) >= 5 and options.get("learn_registry_sd", True):
            excess = [float(np.sum((data_mean[k] - shift - registry[k]) ** 2)) / 2.0 - 1.0 / weights[k] for k in weights]
            tau2 = float(np.clip(np.mean(excess), options["registry_sd_min_m"] ** 2, 25.0))
        for key in weights:
            precision[key] = 1.0 / tau2 + weights[key]
            theta[key] = (registry[key] / tau2 + weights[key] * (data_mean[key] - shift)) / precision[key]
        # Bias given the trees: M1 AR(1) Kalman smoother over each session's visits.
        by_session: dict[int, list[dict]] = defaultdict(list)
        for v in confirmed:
            by_session[v["session"]].append(v)
        observation_sd = math.sqrt(between_var + within_var / max(np.median([v["n"] for v in confirmed]), 1)) if confirmed else 3.0
        for session_visits in by_session.values():
            residuals = np.asarray([v["z"] - theta[v["key"]] for v in session_visits])
            smoothed = _kalman_smoother(residuals, phi=options["bias_phi_per_visit"],
                                        bias_sd=options["bias_sd_m"], observation_sd=observation_sd)
            for v, b in zip(session_visits, smoothed):
                v["bias"] = b
        if confirmed and options.get("datum", "registry") == "gps":
            mean_bias = np.mean([v["bias"] for v in confirmed], axis=0)
            for v in confirmed:
                v["bias"] = v["bias"] - mean_bias
        # Noise level and robust weights.  Residuals are taken against each tree's
        # data-only mean (not the prior-shrunk position, which would leak the
        # registry error into the noise) and scaled for the degrees of freedom
        # the mean uses up; trees seen once carry no information on the noise.
        # The bias here is each session's median, not the smoothed M1 bias: a
        # smoother free to follow every visit would absorb the very noise being
        # measured (and shrink its own observation noise on the next pass).
        session_bias = {s: np.median([v["z"] - (data_mean[v["key"]] - shift) for v in vs], axis=0)
                        for s, vs in by_session.items()}
        scaled = []
        for v in confirmed:
            share = v["w"] / weights[v["key"]]
            if share < 0.999:
                residual = v["z"] - session_bias[v["session"]] - (data_mean[v["key"]] - shift)
                scaled.append((v, float(np.linalg.norm(residual)) / math.sqrt(1.0 - share)))
        if len(scaled) >= 5:
            sigma = float(np.median([r for _, r in scaled])) / math.sqrt(2.0 * math.log(2.0))  # Rayleigh median -> per-axis sd
            between_var = max(sigma**2 - within_var / max(np.median([v["n"] for v in confirmed]), 1), 0.25)
            scale = math.sqrt(between_var + within_var)
            for v, r in scaled:
                v["weight"] = min(1.0, 2.5 * scale / max(r, 1e-9))  # Huber
    # Unconfirmed visits take the bias of the nearest confirmed visit in time within the session.
    for v in visits:
        if v["key"] or v["z"] is None:
            continue
        same = [c for c in confirmed if c["session"] == v["session"]]
        if same:
            nearest = min(same, key=lambda c: abs((c["time"] - v["time"]).total_seconds()) if c["time"] and v["time"] else 0.0)
            v["bias"] = nearest["bias"]
    return {"theta": theta, "precision": precision, "within_var": within_var, "between_var": between_var, "tau2": tau2}


def candidate_posterior(
    visit: dict[str, Any],
    neighbours: list[np.ndarray],
    model: dict[str, Any],
    keys: list[str],
    points: np.ndarray,
    options: dict[str, Any],
    leave_out: bool,
    temperature: float = 1.0,
) -> tuple[list[str], np.ndarray]:
    """Posterior over nearby trees for one visit (its own ID hidden)."""
    z = visit["z"] - visit["bias"]
    noise = model["between_var"] + model["within_var"] / visit["n"]
    near = np.where(np.linalg.norm(points - z, axis=1) <= options["candidate_radius_m"])[0]
    if len(near) == 0:
        near = np.argsort(np.linalg.norm(points - z, axis=1))[:5]
    log_p = []
    for index in near:
        key = keys[index]
        center, precision = points[index], model["precision"].get(key, 1.0 / model["tau2"])
        if leave_out and key == visit["key"]:  # remove this visit from its own tree's estimate
            w = visit.get("w", 0.0)
            reduced = max(precision - w, 1.0 / model["tau2"])
            center = (precision * center - w * z) / reduced
            precision = reduced
        variance = noise + 1.0 / precision
        log_like = -0.5 * float(np.sum((z - center) ** 2)) / variance - math.log(variance)
        if neighbours:  # walk prior: the tree is near one of the neighbouring visits' trees
            d2 = np.asarray([float(np.sum((center - n) ** 2)) for n in neighbours])
            log_like += float(np.log(np.mean(np.exp(-0.5 * d2 / options["walk_length_m"] ** 2)) + 1e-12))
        log_p.append(log_like / temperature)
    log_p = np.asarray(log_p)
    p = np.exp(log_p - log_p.max())
    return [keys[i] for i in near], p / p.sum()


def neighbour_points(visits: list[dict], index: int, model: dict[str, Any]) -> list[np.ndarray]:
    out = []
    for j in (index - 1, index + 1):
        if 0 <= j < len(visits) and visits[j]["session"] == visits[index]["session"]:
            key = visits[j]["key"] or visits[j].get("predicted")
            if visits[j].get("id_check") == "suspect":  # do not lean on a doubtful tag read
                key = visits[j]["loo"]["predicted"]
            if key in model["theta"]:
                out.append(model["theta"][key])
    return out


def fit_temperature(records: list[tuple[list[np.ndarray], int]]) -> float:
    """Temperature minimising the negative log-likelihood of the held-out true trees."""
    best, best_nll = 1.0, float("inf")
    for temperature in np.exp(np.linspace(math.log(0.3), math.log(5.0), 40)):
        nll = 0.0
        for log_p, truth in records:
            scaled = log_p / temperature
            nll -= scaled[truth] - (scaled.max() + math.log(np.exp(scaled - scaled.max()).sum()))
        if nll < best_nll:
            best, best_nll = float(temperature), nll
    return best


def evaluate_and_check(visits: list[dict], model: dict[str, Any], keys: list[str], points: np.ndarray,
                       options: dict[str, Any]) -> dict[str, Any]:
    """Leave-one-visit-out: live accuracy, calibration and checks of each confirmed ID."""
    for _ in range(2):  # the second pass stops a wrong tag from casting doubt on its neighbours
        rows, nll_records = _leave_one_out_pass(visits, model, keys, points, options)
    if not rows:
        return {"status": "skipped", "reason": "no confirmed visits", "temperature": 1.0}
    return _summarise_evaluation(visits, rows, nll_records, options)


def _leave_one_out_pass(visits: list[dict], model: dict[str, Any], keys: list[str], points: np.ndarray,
                        options: dict[str, Any]) -> tuple[list, list]:
    rows, nll_records = [], []
    for index, visit in enumerate(visits):
        if not visit["key"] or visit["z"] is None:
            continue
        candidates, p = candidate_posterior(visit, neighbour_points(visits, index, model), model, keys, points,
                                            options, leave_out=True)
        best = int(np.argmax(p))
        truth_p = float(p[candidates.index(visit["key"])]) if visit["key"] in candidates else 0.0
        visit["loo"] = {"predicted": candidates[best], "confidence": float(p[best]), "confirmed_probability": truth_p}
        rows.append((candidates[best] == visit["key"], float(p[best])))
        if visit["key"] in candidates:
            nll_records.append((np.log(np.maximum(p, 1e-300)), candidates.index(visit["key"])))
        suspect = truth_p < options["suspect_max_probability"] and candidates[best] != visit["key"]
        visit["id_check"] = "suspect" if suspect else "ok"
    return rows, nll_records


def _summarise_evaluation(visits: list[dict], rows: list, nll_records: list, options: dict[str, Any]) -> dict[str, Any]:
    correct = np.asarray([r[0] for r in rows], dtype=float)
    confidence = np.asarray([r[1] for r in rows])
    bins = []
    for low, high in ((0.0, 0.5), (0.5, 0.8), (0.8, 0.95), (0.95, 1.01)):
        mask = (confidence >= low) & (confidence < high)
        if mask.any():
            bins.append({"confidence_range": [low, min(high, 1.0)], "visits": int(mask.sum()),
                         "mean_confidence": float(confidence[mask].mean()), "accuracy": float(correct[mask].mean())})
    ece = sum(b["visits"] * abs(b["mean_confidence"] - b["accuracy"]) for b in bins) / len(rows)
    temperature = fit_temperature(nll_records) if len(nll_records) >= options["calibration_min_visits"] else 1.0
    calibrated_rows = []
    for log_p, truth in nll_records:
        scaled = log_p / temperature
        probabilities = np.exp(scaled - scaled.max())
        probabilities /= probabilities.sum()
        calibrated_rows.append((bool(int(np.argmax(probabilities)) == truth), float(probabilities.max())))
    calibrated_accuracy = float(np.mean([row[0] for row in calibrated_rows])) if calibrated_rows else None
    calibrated_confidence = float(np.mean([row[1] for row in calibrated_rows])) if calibrated_rows else None
    calibrated_bins = []
    if calibrated_rows:
        calibrated_correct = np.asarray([row[0] for row in calibrated_rows], dtype=float)
        calibrated_scores = np.asarray([row[1] for row in calibrated_rows], dtype=float)
        for low, high in ((0.0, 0.5), (0.5, 0.8), (0.8, 0.95), (0.95, 1.01)):
            mask = (calibrated_scores >= low) & (calibrated_scores < high)
            if mask.any():
                calibrated_bins.append({
                    "confidence_range": [low, min(high, 1.0)],
                    "visits": int(mask.sum()),
                    "mean_confidence": float(calibrated_scores[mask].mean()),
                    "accuracy": float(calibrated_correct[mask].mean()),
                })
    calibrated_ece = (
        sum(b["visits"] * abs(b["mean_confidence"] - b["accuracy"]) for b in calibrated_bins) / len(calibrated_rows)
        if calibrated_rows else None
    )
    return {
        "status": "ok",
        "method": "leave-one-visit-out over confirmed visits",
        "visits": len(rows),
        "accuracy": float(correct.mean()),
        "mean_confidence": float(confidence.mean()),
        "calibration_error": float(ece),
        "reliability": bins,
        "temperature": temperature,
        "temperature_fitted": len(nll_records) >= options["calibration_min_visits"],
        "calibrated_accuracy": calibrated_accuracy,
        "calibrated_mean_confidence": calibrated_confidence,
        "calibrated_calibration_error": calibrated_ece,
        "calibrated_reliability": calibrated_bins,
        "suspect_confirmed_visits": sum(1 for v in visits if v.get("id_check") == "suspect"),
        "note": "Bias is estimated with the held-out visit included; accuracy is slightly optimistic.",
    }


def tree_positions(visits: list[dict], model: dict[str, Any], trees: dict[str, dict], frame: Frame,
                   registry: dict[str, np.ndarray], options: dict[str, Any]) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = defaultdict(lambda: {"visits": 0, "photos": [], "sessions": set()})
    for v in visits:
        if v["key"] and v["z"] is not None and v.get("id_check") != "suspect":
            entry = seen[v["key"]]
            entry["visits"] += 1
            entry["sessions"].add(v["session"])
            entry["photos"] += [p["id"] for p in v["photos"]]
    estimates = []
    for key, entry in seen.items():
        theta = model["theta"][key]
        sd = math.sqrt(1.0 / model["precision"][key])
        shift = float(np.linalg.norm(theta - registry[key]))
        sessions = len(entry["sessions"])
        moves = sessions >= options["move_min_sessions"] and sd <= options["move_max_sd_m"]
        confidence = "high" if moves and sessions >= 3 and sd <= 1.0 else "medium" if moves else "low"
        lat, lon = frame.unproject(theta)
        estimates.append({
            "tree_id": trees[key]["id"],
            "latitude": lat, "longitude": lon,
            "observation_count": entry["visits"],
            "session_count": sessions,
            "photo_ids": entry["photos"],
            "sd_m": sd,
            "uncertainty_m": sd,
            "radius95_m": 2.448 * sd,  # 95% radius of an isotropic 2-D Gaussian
            "shift_m": shift,
            "confidence": confidence,
            "confidence_score": float(max(0.01, min(0.99, 1.0 - math.exp(-sessions / 2.0)) * math.exp(-sd / 2.0))),
            "uses_estimated_position": moves,
            "source": "field-pipeline-v2: confirmed visits, M1 bias removed",
        })
    return estimates


def run_joint_calibration(visits: list[dict], model: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
    """M3 shape + M2 joint Viterbi on the session's visits, scored against the confirmed IDs."""
    if not options.get("run_m3"):
        return {"status": "skipped", "reason": "run_m3 is off (confirmed IDs make it a diagnostic)"}
    usable = [v for v in visits if v["z"] is not None]
    if len(usable) < options["m3_min_groups"]:
        return {"status": "skipped", "reason": "not enough visits"}
    means = np.asarray([v["z"] - v["bias"] for v in usable])  # bias-corrected, same frame as the trees
    headings = [circular_mean_deg([p["heading_deg"] for p in v["photos"] if p["heading_deg"] is not None]) for v in usable]
    heading_array = np.asarray([h if h is not None else np.nan for h in headings]) if any(h is not None for h in headings) else None
    gaps = [max(0.1, (b["time"] - a["time"]).total_seconds()) if a["time"] and b["time"] else np.nan for a, b in zip(usable, usable[1:])]
    time_array = np.asarray(gaps) if np.isfinite(gaps).sum() >= 2 else None
    counts = [v["n"] for v in usable]
    try:
        result = fit_m3_to_joint(
            means, heading_array, time_array, spacing=float(options["spacing_m"]),
            params=JointParams(photos_per_tree=max(1, int(np.median(counts))), time_row_change=True),
            min_rows=int(options.get("m3_min_rows", 3)), max_rows=int(options.get("m3_max_rows", 15)),
            min_cols=int(options.get("m3_min_cols", 3)), max_cols=int(options.get("m3_max_cols", 20)),
            max_shapes=int(options.get("m3_max_shapes", 12)),
            use_em=time_array is not None, em_reselect=True, group_counts=counts,
        )
    except Exception as error:  # diagnostics must not block field records
        return {"status": "error", "reason": str(error)}
    grid_points = result.fit.grid.points()
    keys = list(model["theta"])
    tree_points = np.asarray([model["theta"][k] for k in keys])
    mapping, agree, scored = [], 0, 0
    for v, grid_index in zip(usable, result.fit.mapping):
        point = grid_points[int(grid_index)]
        nearest = keys[int(np.argmin(np.linalg.norm(tree_points - point, axis=1)))]
        if v["key"]:
            scored += 1
            agree += nearest == v["key"]
        mapping.append({"photo_ids": [p["id"] for p in v["photos"]], "grid_index": int(grid_index),
                        "nearest_tree_key": nearest, "confirmed_tree_key": v["key"]})
    learned = result.learned_params
    return {
        "status": "ok",
        "selected_shape": list(result.selected_shape),
        "candidate_shape_count": len(result.candidate_shapes),
        "missing_probability": [float(x) for x in result.fit.missing_probability],
        "agreement_with_confirmed": agree / scored if scored else None,
        "group_mapping": mapping,
        "learned_time": {
            "alpha_sec": learned.time_alpha_sec if learned else None,
            "beta_sec_per_meter": learned.time_beta_sec_per_meter if learned else None,
        },
    }


def suggest_number_matches(visits: list[dict], model: dict[str, Any], keys: list[str], points: np.ndarray,
                           tagged: set[str], options: dict[str, Any]) -> list[dict[str, Any]]:
    """Which registry tree an unresolved tag number most likely is.

    All visits reporting the number are combined (bias-corrected, precision-weighted)
    and compared with each nearby tree.  A tree that already has a known tag is
    unlikely to carry a second one.  Only a suggestion: an administrator adds the
    pair to the tag table.
    """
    by_number: dict[str, list[tuple[int, dict]]] = defaultdict(list)
    for index, v in enumerate(visits):
        if not v["key"] and v["number"] and v["z"] is not None:
            by_number[v["number"]].append((index, v))
    out = []
    for number, indexed in sorted(by_number.items()):
        group = [v for _, v in indexed]
        # The trees photographed just before and after each visit (the walk, as in the HMM).
        walk = [neighbour_points(visits, index, model) for index, _ in indexed]
        precisions = np.asarray([1.0 / (model["between_var"] + model["within_var"] / v["n"]) for v in group])
        mean = np.sum([w * (v["z"] - v["bias"]) for w, v in zip(precisions, group)], axis=0) / precisions.sum()
        variance = 1.0 / precisions.sum()
        distance = np.linalg.norm(points - mean, axis=1)
        near = np.where(distance <= options["candidate_radius_m"])[0]
        if len(near) == 0:
            near = np.argsort(distance)[:5]
        log_p = []
        for index in near:
            total = variance + 1.0 / model["precision"].get(keys[index], 1.0 / model["tau2"])
            score = -0.5 * distance[index] ** 2 / total - math.log(total)
            if keys[index] in tagged:
                score += math.log(options["tagged_tree_prior"])
            for neighbours in walk:
                if neighbours:
                    d2 = np.asarray([float(np.sum((points[index] - n) ** 2)) for n in neighbours])
                    score += float(np.log(np.mean(np.exp(-0.5 * d2 / options["walk_length_m"] ** 2)) + 1e-12))
            log_p.append(score)
        log_p = np.asarray(log_p)
        prob = np.exp(log_p - log_p.max())
        prob /= prob.sum()
        order = np.argsort(prob)[::-1][:3]
        sessions = len({v["session"] for v in group})
        top = float(prob[order[0]])
        out.append({
            "reported_number": group[0]["photos"][0]["tree_number"],
            "reported_number_key": number,
            "status": group[0]["status"],
            "visit_count": len(group),
            "session_count": sessions,
            "suggestion": "suggested" if top >= options["number_match_min_probability"] and sessions >= 2 else "needs_more_visits",
            "candidates": [{"tree_key": keys[near[i]], "probability": float(prob[i]),
                            "distance_m": float(distance[near[i]])} for i in order],
        })
    return out


# ------------------------------------------------------------------- entry point

def analyze_payload(payload: dict[str, Any]) -> dict[str, Any]:
    options = {**DEFAULTS, **(payload.get("options") or {})}
    trees_list = [tree for row in payload.get("trees", []) if (tree := normalize_tree(row))]
    if not trees_list:
        return {"status": "no-data", "reason": "tree registry is empty", "photo_links": [], "tree_records": []}
    book = NumberBook(trees_list, payload.get("tag_map"), payload.get("historical_numbers"))
    photos = [normalize_photo(row, index) for index, row in enumerate(payload.get("photos", []))]
    gps_status_counts = reject_unreliable_gps(photos, options)
    usable = [p for p in photos if p["lat"] is not None and p["lon"] is not None]
    if not usable:
        return {"status": "no-data", "reason": "no photos with usable GPS", "photo_count": len(photos),
                "gps_status_counts": gps_status_counts, "model_version": MODEL_VERSION,
                "photo_links": number_only_links(photos, book, trees_list) if photos else [], "tree_records": []}
    frame = Frame(float(np.mean([t["lat"] for t in trees_list])), float(np.mean([t["lon"] for t in trees_list])))
    trees = {normalize_tree_id(t["id"]): t for t in trees_list}
    registry = {k: frame.project(t["lat"], t["lon"]) for k, t in trees.items()}
    keys = list(registry)

    sessions = split_sessions(photos, float(options["session_gap_seconds"]))
    visits: list[dict[str, Any]] = []
    for session_index, session in enumerate(sessions):
        for visit in make_visits(session, book, float(options["burst_gap_seconds"])):
            visit["session"] = session_index
            visit_observation(visit, frame, float(options["camera_distance_m"]))
            visits.append(visit)

    model = fit_error_model(visits, registry, options)
    points = np.asarray([model["theta"][k] for k in keys])
    evaluation = evaluate_and_check(visits, model, keys, points, options)
    if any(v.get("id_check") == "suspect" for v in visits):  # refit without doubtful tag reads
        for v in visits:
            v["excluded"] = v.get("id_check") == "suspect"
        model = fit_error_model(visits, registry, options)
        points = np.asarray([model["theta"][k] for k in keys])
        evaluation = evaluate_and_check(visits, model, keys, points, options)
    temperature = evaluation.get("temperature", 1.0)
    number_matches = suggest_number_matches(visits, model, keys, points, set(book.tags.values()), options)
    match_by_number = {m["reported_number_key"]: m for m in number_matches}
    for index, visit in enumerate(visits):  # photos whose number does not resolve, or with no number
        if visit["key"] or visit["z"] is None:
            continue
        match = match_by_number.get(visit["number"])
        if match and match["candidates"]:
            visit["predicted"] = match["candidates"][0]["tree_key"]
            visit["confidence"] = match["candidates"][0]["probability"]
            visit["predicted_source"] = "number_match"
            continue
        candidates, p = candidate_posterior(visit, neighbour_points(visits, index, model), model, keys, points,
                                            options, leave_out=False, temperature=temperature)
        best = int(np.argmax(p))
        visit["predicted"], visit["confidence"] = candidates[best], float(p[best])
        visit["predicted_source"] = "gps"

    links = []
    for visit in visits:
        tree_key = visit["key"] or visit.get("predicted")
        status = "gps_conflict" if visit.get("id_check") == "suspect" else visit["status"]
        corrected = raw = None
        if tree_key and visit["z"] is not None:  # distance after removing the session's GPS bias, and raw
            corrected = float(np.linalg.norm(visit["z"] - visit["bias"] - model["theta"][tree_key]))
            raw = float(np.linalg.norm(visit["z"] - registry[tree_key]))
        for photo in visit["photos"]:
            common = {
                "photo_id": photo["id"],
                "reported_number": photo["tree_number"],
                "record_status": status,
                "gps_status": photo["gps_status"],
                "gps_distance_m": corrected,
                "raw_gps_distance_m": raw,
                "captured_at": photo["captured_at"].isoformat() if photo["captured_at"] else None,
            }
            if visit["key"]:
                loo = visit.get("loo", {})
                links.append({
                    **common, "tree_id": trees[visit["key"]]["id"], "source": "confirmed", "confidence": 1.0,
                    "model_tree_id": trees[loo["predicted"]]["id"] if loo.get("predicted") else None,
                    "model_confidence": loo.get("confidence"),
                    "confirmed_probability": loo.get("confirmed_probability"),
                    "consistent_with_confirmed_id": loo.get("predicted", visit["key"]) == visit["key"],
                    "id_check": visit.get("id_check", "unchecked"),
                })
            elif visit.get("predicted"):
                links.append({
                    **common, "tree_id": trees[visit["predicted"]]["id"], "source": "model",
                    "model_source": visit["predicted_source"],
                    "confidence": visit["confidence"], "model_tree_id": trees[visit["predicted"]]["id"],
                    "model_confidence": visit["confidence"], "consistent_with_confirmed_id": True,
                    "confidence_calibrated": visit["predicted_source"] == "gps" and bool(evaluation.get("temperature_fitted")),
                })

    records = {k: {"tree_id": t["id"], "photo_count": 0, "photo_ids": [], "confirmed_photo_count": 0,
                   "inferred_photo_count": 0, "visit_count": 0, "suspect_visit_count": 0,
                   "mean_assignment_confidence": 0.0} for k, t in trees.items()}
    for link in links:
        record = records[normalize_tree_id(link["tree_id"])]
        record["photo_count"] += 1
        record["photo_ids"].append(link["photo_id"])
        record["mean_assignment_confidence"] += link["confidence"]
        record["confirmed_photo_count"] += link["source"] == "confirmed"
        record["inferred_photo_count"] += link["source"] == "model"
    for visit in visits:
        key = visit["key"] or visit.get("predicted")
        if key:
            records[key]["visit_count"] += 1
            records[key]["suspect_visit_count"] += visit.get("id_check") == "suspect"
    for record in records.values():
        if record["photo_count"]:
            record["mean_assignment_confidence"] /= record["photo_count"]
    for match in number_matches:
        for candidate in match["candidates"]:
            candidate["tree_id"] = trees[candidate.pop("tree_key")]["id"]
        match.pop("reported_number_key")
    status_counts: dict[str, int] = defaultdict(int)
    for link in links:
        status_counts[link["record_status"]] += 1

    session_results = []
    for session_index, session in enumerate(sessions):
        session_visits = [v for v in visits if v["session"] == session_index]
        biases = [v["bias"] for v in session_visits if v["key"] and v["z"] is not None]
        session_results.append({
            "session_id": f"session-{session_index + 1:03d}",
            "photo_count": len(session),
            "visit_count": len(session_visits),
            "confirmed_visit_count": sum(1 for v in session_visits if v["key"]),
            "estimated_bias_m": [float(x) for x in np.mean(biases, axis=0)] if biases else None,
            "joint": run_joint_calibration(session_visits, model, options),
        })

    return {
        "status": "ok",
        "photo_count": len(photos),
        "geolocated_photo_count": len(usable),
        "gps_status_counts": gps_status_counts,
        "session_count": len(sessions),
        "visit_count": len(visits),
        "photo_links": links,
        "tree_records": list(records.values()),
        "position_estimates": tree_positions(visits, model, trees, frame, registry, options),
        "evaluation": evaluation,
        "number_matches": number_matches,
        "record_status_counts": dict(status_counts),
        "error_model": {
            "within_visit_sd_m": math.sqrt(model["within_var"]),
            "between_visit_sd_m": math.sqrt(model["between_var"]),
            "registry_sd_m": math.sqrt(model["tau2"]),
            "camera_distance_m": float(options["camera_distance_m"]),
        },
        "sessions": session_results,
        "origin": {"latitude": frame.lat, "longitude": frame.lon},
        "model_version": MODEL_VERSION,
    }
