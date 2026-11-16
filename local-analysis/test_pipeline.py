import math
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline import METERS_PER_DEGREE, analyze_payload  # noqa: E402

LAT0, LON0 = 9.2618, 123.2182
KX = METERS_PER_DEGREE * math.cos(math.radians(LAT0))


def to_latlon(point):
    return LAT0 + point[1] / METERS_PER_DEGREE, LON0 + point[0] / KX


def simulated_farm(seed=0, sessions=4, wrong_tag=True, unconfirmed=True):
    """A 6 x 8 tree block on a 3 m grid walked in several sessions.

    Registry positions are off by ~1.5 m per tree; every session has its own
    GPS bias around the field offset seen on 2026-11-04 (+2.5 m E, -3.9 m N)
    drifting slowly (M1); each visit adds 2 m of noise shared by its photos
    and 0.7 m per photo.
    """
    rng = np.random.default_rng(seed)
    true = {f"T-{r}{c:02d}": np.array([c * 3.0, r * 3.0]) for r in range(6) for c in range(8)}
    registry = {k: p + rng.normal(0, 1.5, 2) for k, p in true.items()}
    trees = [{"id": k, "number": k, "areaId": "T", "lat": to_latlon(p)[0], "lon": to_latlon(p)[1]} for k, p in registry.items()]
    keys = list(true)
    photos, truth_bias, swapped = [], [], None
    start = datetime(2026, 11, 7, 8, tzinfo=timezone.utc)
    for s in range(sessions):
        offset = np.array([2.5, -3.9]) + rng.normal(0, 1.0, 2)
        bias = offset.copy()
        t = start + timedelta(days=s)
        session_bias = []
        route = keys if s % 2 == 0 else keys[::-1]
        for v, key in enumerate(route):
            bias = offset + 0.9 * (bias - offset) + rng.normal(0, 0.3, 2)
            session_bias.append(bias.copy())
            visit_error = rng.normal(0, 2.0, 2)
            label = key
            if wrong_tag and s == 1 and v == 10:  # a tag read from a tree three columns away
                label = keys[(keys.index(key) + 3) % len(keys)]
                swapped = (s, key, label)
            hidden = unconfirmed and s == 2 and v == 20
            for j in range(3):
                point = true[key] + bias + visit_error + rng.normal(0, 0.7, 2)
                lat, lon = to_latlon(point)
                photos.append({
                    "id": f"s{s}-v{v}-p{j}", "captured_at": (t + timedelta(seconds=40 * v + 2 * j)).isoformat(),
                    "latitude": lat, "longitude": lon, "gps_accuracy": 4,
                    "confirmed_tree_id": None if hidden else label, "areaId": "T",
                })
        truth_bias.append(np.mean(session_bias, axis=0))
    return trees, photos, true, registry, truth_bias, swapped


def as_tag_numbers(trees, photos, unknown=("T-103", "T-305", "T-506"), historical=("T-305",)):
    """The PWA as used in the field: the three-digit tag typed as tree_number, no confirmed ID.

    Every tree carries tag 300 + its index; the tag table knows all of them
    except ``unknown`` (one of which older records know: ``historical``).
    """
    tag = {tree["id"]: str(300 + i) for i, tree in enumerate(trees)}
    field_photos = [{**photo, "confirmed_tree_id": None,
                     "tree_number": tag[photo["confirmed_tree_id"]] if photo["confirmed_tree_id"] else None}
                    for photo in photos]
    tag_map = [{"tag_number": tag[k], "tree_id": k} for k in tag if k not in unknown]
    return field_photos, tag_map, [tag[k] for k in historical], tag


class TagNumberFieldTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        trees, photos, cls.true, _, _, cls.swapped = simulated_farm()
        field_photos, tag_map, historical, cls.tag = as_tag_numbers(trees, photos)
        cls.result = analyze_payload({"trees": trees, "photos": field_photos, "tag_map": tag_map,
                                      "historical_numbers": historical})
        cls.links = {l["photo_id"]: l for l in cls.result["photo_links"]}

    def test_typed_numbers_resolve_through_the_tag_table(self):
        counts = self.result["record_status_counts"]
        self.assertGreater(counts.get("registered", 0), 500)
        self.assertNotIn("confirmed", counts)
        self.assertEqual(self.result["evaluation"]["status"], "ok")

    def test_wrong_number_is_a_gps_conflict_and_is_kept(self):
        link = self.links["s1-v10-p0"]
        self.assertEqual(link["record_status"], "gps_conflict")
        self.assertEqual(link["reported_number"], self.tag[self.swapped[2]])
        self.assertEqual(link["tree_id"], self.swapped[2])
        self.assertGreater(link["raw_gps_distance_m"], link["gps_distance_m"] - 10)  # both distances reported

    def test_suggests_the_tree_of_each_unknown_tag(self):
        matches = {m["reported_number"]: m for m in self.result["number_matches"]}
        right = 0
        for tree in ("T-103", "T-305", "T-506"):
            match = matches[self.tag[tree]]
            right += match["candidates"][0]["tree_id"] == tree
            if match["suggestion"] == "suggested":  # a confident suggestion must be the right tree
                self.assertEqual(match["candidates"][0]["tree_id"], tree)
        self.assertGreaterEqual(right, 2)
        self.assertTrue(any(m["suggestion"] == "suggested" for m in matches.values()))
        self.assertEqual(matches[self.tag["T-305"]]["status"], "historical_number_only")
        self.assertEqual(matches[self.tag["T-103"]]["status"], "photo_number_unmatched")

    def test_unknown_tag_photos_are_linked_by_the_number_match(self):
        unknown = [l for l in self.result["photo_links"] if l["reported_number"] == self.tag["T-103"]]
        self.assertTrue(unknown)
        self.assertTrue(all(l["source"] == "model" and l["model_source"] == "number_match" for l in unknown))
        self.assertTrue(all(l["record_status"] == "photo_number_unmatched" for l in unknown))

    def test_photo_without_number_is_gps_only(self):
        link = self.links["s2-v20-p0"]
        self.assertEqual(link["record_status"], "no_number")
        self.assertEqual(link["model_source"], "gps")


class UnreliableGpsTests(unittest.TestCase):
    """PWA builds before 2026-11-11 reused one GPS reading for every photo."""

    def frozen_photos(self, trees, start, count=20, minutes=10):
        frozen = (trees[0]["lat"] + 0.0001, trees[0]["lon"] + 0.0001)
        return [{"id": f"frozen-{i}", "captured_at": (start + timedelta(seconds=minutes * 60 * i / count)).isoformat(),
                 "latitude": frozen[0], "longitude": frozen[1], "gps_accuracy": 55.2,
                 "tree_number": trees[i % len(trees)]["id"]} for i in range(count)]

    def test_frozen_fix_is_ignored_but_the_numbers_are_kept(self):
        trees, photos, _, _, truth_bias, _ = simulated_farm(wrong_tag=False, unconfirmed=False)
        last = max(datetime.fromisoformat(p["captured_at"]) for p in photos if p["id"].startswith("s0-"))
        payload_photos = photos + self.frozen_photos(trees, last + timedelta(minutes=1))
        result = analyze_payload({"trees": trees, "photos": payload_photos, "options": {"m3_min_groups": 10**9}})
        self.assertEqual(result["gps_status_counts"].get("repeated_fix"), 20)
        frozen = [l for l in result["photo_links"] if l["photo_id"].startswith("frozen-")]
        self.assertEqual(len(frozen), 20)
        self.assertTrue(all(l["gps_status"] == "repeated_fix" and l["gps_distance_m"] is None for l in frozen))
        self.assertTrue(all(l["tree_id"] == trees[i % len(trees)]["id"] for i, l in
                            enumerate(sorted(frozen, key=lambda l: int(l["photo_id"].split("-")[1])))))
        self.assertLess(np.linalg.norm(np.asarray(result["sessions"][0]["estimated_bias_m"]) - truth_bias[0]), 1.0)

    def test_only_frozen_fixes_still_link_by_number(self):
        trees, *_ = simulated_farm(sessions=1)
        result = analyze_payload({"trees": trees, "photos": self.frozen_photos(trees, datetime(2026, 11, 11, 3, tzinfo=timezone.utc))})
        self.assertEqual(result["status"], "no-data")
        self.assertEqual(result["gps_status_counts"], {"repeated_fix": 20})
        self.assertTrue(all(l["source"] == "confirmed" for l in result["photo_links"]))

    def test_a_short_burst_at_one_spot_is_kept(self):
        trees, *_ = simulated_farm(sessions=1)
        burst = self.frozen_photos(trees, datetime(2026, 11, 11, 3, tzinfo=timezone.utc), count=3, minutes=0.1)
        result = analyze_payload({"trees": trees, "photos": burst})
        self.assertEqual(result["gps_status_counts"], {"ok": 3})

    def test_stale_fix_time_is_ignored(self):
        trees, *_ = simulated_farm(sessions=1)
        photo = {"id": "p1", "captured_at": "2026-11-11T03:10:00Z", "gps_fixed_at": "2026-11-11T03:00:00Z",
                 "latitude": trees[0]["lat"], "longitude": trees[0]["lon"], "tree_number": trees[0]["id"]}
        result = analyze_payload({"trees": trees, "photos": [photo]})
        self.assertEqual(result["gps_status_counts"], {"stale_fix": 1})


class FieldPipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.trees, cls.photos, cls.true, cls.registry, cls.truth_bias, cls.swapped = simulated_farm()
        cls.result = analyze_payload({"trees": cls.trees, "photos": cls.photos,
                                      "options": {"m3_min_groups": 10**9}})

    def test_learns_each_session_gps_bias(self):
        for session, truth in zip(self.result["sessions"], self.truth_bias):
            self.assertLess(np.linalg.norm(np.asarray(session["estimated_bias_m"]) - truth), 1.0)

    def test_moved_tree_positions_are_closer_than_the_registry(self):
        moved = [e for e in self.result["position_estimates"] if e["uses_estimated_position"]]
        self.assertGreater(len(moved), 40)
        before, after = [], []
        for e in moved:
            point = np.array([(e["longitude"] - LON0) * KX, (e["latitude"] - LAT0) * METERS_PER_DEGREE])
            after.append(np.linalg.norm(point - self.true[e["tree_id"]]))
            before.append(np.linalg.norm(self.registry[e["tree_id"]] - self.true[e["tree_id"]]))
        self.assertLess(np.mean(after), 0.85 * np.mean(before))

    def test_flags_the_wrong_tag_read(self):
        _, tree, label = self.swapped
        suspects = {(l["photo_id"].split("-p")[0], l["tree_id"]) for l in self.result["photo_links"] if l.get("id_check") == "suspect"}
        self.assertIn(("s1-v10", label), suspects)
        self.assertLessEqual(len(suspects), 3)

    def test_reports_live_accuracy_and_calibration(self):
        evaluation = self.result["evaluation"]
        self.assertEqual(evaluation["status"], "ok")
        self.assertGreater(evaluation["visits"], 150)
        self.assertGreater(evaluation["accuracy"], 0.5)
        self.assertTrue(evaluation["temperature_fitted"])

    def test_links_the_unconfirmed_visit(self):
        model_links = [l for l in self.result["photo_links"] if l["source"] == "model"]
        self.assertEqual(len(model_links), 3)
        self.assertTrue(all(0.0 < l["confidence"] <= 1.0 for l in model_links))

    def test_confirmed_ids_stay_authoritative(self):
        confirmed = [l for l in self.result["photo_links"] if l["source"] == "confirmed"]
        self.assertTrue(all(l["confidence"] == 1.0 for l in confirmed))
        swapped_link = next(l for l in confirmed if l["photo_id"] == "s1-v10-p0")
        self.assertEqual(swapped_link["tree_id"], self.swapped[2])  # flagged, not overwritten

    def test_registry_number_matches_a_confirmed_id(self):
        trees = [{"id": "uuid-1", "number": "B1-001", "lat": 9.2618, "lon": 123.2182}]
        photos = [{"id": "p1", "captured_at": "2026-11-07T08:00:00Z", "latitude": 9.2618, "longitude": 123.2182, "confirmed_tree_id": "B1-001"}]
        result = analyze_payload({"trees": trees, "photos": photos})
        self.assertEqual(result["photo_links"][0]["tree_id"], "uuid-1")

    def test_single_session_does_not_move_trees(self):
        trees, photos, *_ = simulated_farm(seed=1, sessions=1, wrong_tag=False, unconfirmed=False)
        result = analyze_payload({"trees": trees, "photos": photos})
        self.assertFalse(any(e["uses_estimated_position"] for e in result["position_estimates"]))

    def test_empty_gps_payload_does_not_fail(self):
        result = analyze_payload({"trees": [{"id": "B1-001", "lat": 9.2618, "lon": 123.2182}], "photos": [{"id": "p1"}]})
        self.assertEqual(result["status"], "no-data")


if __name__ == "__main__":
    unittest.main()
