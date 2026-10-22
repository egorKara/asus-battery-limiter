#!/usr/bin/env python3
"""Small offline guard for published battery catalog."""
import json
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
catalog = json.loads((ROOT / "docs/data/catalog.json").read_text(encoding="utf-8"))
assert catalog["schema_version"] == 1
assert isinstance(catalog["devices"], list)
assert isinstance(catalog["manufacturer_guidance"], list)
assert isinstance(catalog["references"], list)
ids = set()
for device in catalog["devices"]:
    assert device["id"] not in ids
    ids.add(device["id"])
    assert device["manufacturer"] and device["laptop_model"]
    cap = device["capabilities"]
    assert all(cap[k] in ("yes", "no", "reported", "unknown")
               for k in ("end_threshold", "start_threshold", "pause_charging"))
    source = device["evidence"]
    parsed = urlparse(source["source_url"])
    assert parsed.scheme == "https" and parsed.netloc
    assert source["checked_at"] <= catalog["updated_at"]
    window = device["recommended_window"]
    low, high = window["min_percent"], window["max_percent"]
    if low is None or high is None:
        assert low is None and high is None
        assert window["scope"] == "unknown"
    else:
        assert device["battery_model"], "Cannot set exact thresholds without battery identity"
        assert window["scope"] == "exact_battery"
        assert source["kind"] == "verified"
        assert cap["end_threshold"] == "yes"
        assert type(low) is int and type(high) is int and 0 <= low < high <= 100
for guidance in catalog["manufacturer_guidance"]:
    assert guidance["verified_model_ids"] == [], "Vendor-wide guidance is not a battery match"
    assert guidance["recommended_min_percent"] is None
    assert urlparse(guidance["source_url"]).scheme == "https"
    assert all(type(m["max_percent"]) is int and 0 < m["max_percent"] <= 100
               for m in guidance["modes"])
    assert all(
        m.get("resume_below_percent") is None or
        (type(m["resume_below_percent"]) is int and
         0 <= m["resume_below_percent"] < m["max_percent"])
        for m in guidance["modes"]
    ), "Manufacturer hysteresis must stay below its upper limit"
for reference in catalog["references"]:
    assert urlparse(reference["url"]).scheme == "https"
assert not any(
    d["recommended_window"]["min_percent"] is not None and
    d["evidence"]["kind"] != "verified" for d in catalog["devices"]
)
print("PASS: catalog schema, identity, provenance and recommendation safety")
