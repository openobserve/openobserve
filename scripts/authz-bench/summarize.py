#!/usr/bin/env python3

import argparse
import json
from pathlib import Path

# authz::list::SMALL_REQUEST_OBJECTS: at or below it each id is checked by design.
SMALL_REQUEST_OBJECTS = 5


def load_rows(path):
    rows = {}
    with path.open(encoding="utf-8") as report:
        for line in report:
            if line.strip():
                row = json.loads(line)
                rows[row["key"]] = row
    return list(rows.values())


def counterpart_key(row, mode):
    return row["path"], row["scale"], row["shape"], row["cpus"], row["users"], mode


def markdown(values):
    print("| " + " | ".join(map(str, values)) + " |")


def header(columns):
    markdown(columns)
    markdown(["---"] * len(columns))


def numeric(value, spec, suffix=""):
    return "—" if value is None else f"{value:{spec}}{suffix}"


def status(passed):
    if passed is None:
        return "—"
    return "PASS" if passed else "FAIL"


def table_row(row):
    size = row["requested_objects"]
    scale = row["scale"]
    objects = f"{size:,}" if size == scale else f"{size:,} of {scale:,}"
    calls = row["calls"]
    requests = row["runs"] * row["users"]
    by_op = (calls["check"], calls["probe"] + calls["role"], calls["list"])
    allowed = "unscoped" if row.get("unscoped") else row["allowed"]
    return [
        row["path"], row["shape"], objects, numeric(row["cpus"], "g"), row["users"],
        row["mode"], " / ".join(f"{count / requests:.3g}" for count in by_op),
        numeric(row["p50_ms"], ".2f", " ms"),
        numeric(row["p95_ms"], ".2f", " ms"),
        numeric(row["p99_ms"], ".2f", " ms"),
        numeric(row["cold_ms"], ".2f", " ms"),
        numeric(warm_list_max(row), ".2f", " ms"),
        numeric(row.get("cold_list_max_ms"), ".2f", " ms"),
        row["peak_in_flight"], numeric(row["fga_cpu_seconds_per_auth"], ".6f"),
        numeric(row.get("neighbor_p95_ms"), ".2f", " ms"),
        numeric(row.get("neighbor_p99_ms"), ".2f", " ms"),
        numeric(row.get("neighbor_peak_in_flight"), "d"),
        numeric(row.get("neighbor_due_checks"), "d"), allowed,
    ]


def same_answer(left, right):
    return all(left[field] == right[field] for field in (
        "allowed", "allowed_hash", "evidence_allowed",
    )) and (
        left.get("unscoped", False) == right.get("unscoped", False)
    )


def latency_regressions(row, baseline):
    if baseline is None or baseline["p95_ms"] is None or row["p95_ms"] is None:
        return None, None
    off = baseline["p95_ms"]
    if row["mode"] == "on":
        return row["p95_ms"] <= off + max(20.0, off * 0.2), None
    if row["mode"] == "shadow":
        return None, row["p95_ms"] <= off * 1.1
    return None, None


def design_gate(row):
    if row["path"] != "service_streams" or row["scale"] != 2858 or row["mode"] != "on":
        return "—"
    shape = row["shape"]
    if shape in {"direct", "group"}:
        shape = "subset"
    gate = {
        ("subset", 1.0, 1): ("G-1", 150),
        ("subset", 1.0, 4): ("G-1b", 250),
        ("subset", 0.2, 4): ("G-2", 2000),
        ("type_wide", 0.2, 4): ("G-3", 550),
        ("none", 0.2, 1): ("G-4", 600),
    }.get((shape, row["cpus"], row["users"]))
    if gate is None:
        return "—"
    name, limit = gate
    measurements = [row["p95_ms"], row["cold_ms"]]
    if any(value is not None and value > limit for value in measurements):
        return f"{name} FAIL"
    if None in measurements:
        return f"{name} pending cold"
    return f"{name} PASS"


def warm_list_max(row):
    legacy = row.get("call_latency", {}).get("list", {})
    return row.get("warm_list_max_ms", legacy.get("max_ms"))


def list_gate(row):
    warm = warm_list_max(row)
    cold = row.get("cold_list_max_ms")
    cold_over = row.get("cold_list_calls_over_1s")
    if row["list_calls_over_1s"] or cold_over:
        return "FAIL"
    if any(value is not None and value > 1000 for value in (warm, cold)):
        return "FAIL"
    if warm is not None or row["calls"]["list"]:
        return "PASS (warm only)" if cold_over is None else "PASS"
    return "PASS" if cold is not None else "—"


def regression_row(row, index):
    mode = row["mode"]
    baseline = index.get(counterpart_key(row, "off"))
    if mode == "off":
        peers = [index.get(counterpart_key(row, peer)) for peer in ("on", "shadow")]
        peers = [peer for peer in peers if peer is not None]
        equal = all(same_answer(row, peer) for peer in peers) if peers else None
    else:
        equal = same_answer(baseline, row) if baseline is not None else None

    on_latency, shadow_latency = latency_regressions(row, baseline)
    budget = row["call_budget"]
    on = mode == "on"
    peak_limit = row.get("peak_in_flight_limit", row["users"] * (row["types"] + 16))
    return [
        f"`{row['key']}`", status(equal),
        status(row["max_calls_per_user"] <= budget if on and budget is not None else None),
        status(row["fallback_checks"] == 0 or row["requested_objects"] <= SMALL_REQUEST_OBJECTS if on else None),
        status(on_latency), status(shadow_latency),
        status(row["peak_in_flight"] <= peak_limit if on else None),
        design_gate(row),
        list_gate(row),
        status(row.get("security_p95_gate_passed")),
    ]


def main():
    parser = argparse.ArgumentParser(description="Summarize OpenFGA list-authz benchmark cells")
    parser.add_argument("jsonl", type=Path)
    rows = load_rows(parser.parse_args().jsonl)
    if not rows:
        parser.error("benchmark file contains no cells")
    header([
        "Path", "Grants", "Objects", "OpenFGA CPU", "Users", "Mode",
        "Calls (check / probe / list)", "p50", "p95", "p99", "Cold",
        "Warm list max", "Cold list max", "Primary peak in-flight", "OpenFGA CPU-s",
        "Neighbor Check p95", "Neighbor Check p99", "Neighbor peak in-flight",
        "Neighbor due Checks", "Allowed",
    ])
    for row in rows:
        markdown(table_row(row))
    print("\nCalls and OpenFGA CPU-seconds are per authorization. Role calls are included in probes.")
    print("\n## Regressions\n")
    header([
        "Cell", "G-5 set equality", "On call budget", "On fallback checks",
        "On p95 vs off", "Shadow p95 vs off", "On peak in-flight",
        "Design warm/cold", "G-6 list ≤ 1 s", "Security Sources p95 ≤ 1.5 s",
    ])
    index = {counterpart_key(row, row["mode"]): row for row in rows}
    for row in rows:
        markdown(regression_row(row, index))
    print("\n— indicates a missing comparison or a rule that does not apply.")


if __name__ == "__main__":
    main()
