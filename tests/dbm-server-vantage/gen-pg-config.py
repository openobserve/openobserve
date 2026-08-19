#!/usr/bin/env python3
"""Generate collector/config.pg.yaml: POSTGRES ONLY -> ONE org, NO traces.

WHAT THIS LANE IS
-----------------
  org       3I5P2XLx14DvzepfpUikQX0nV9Y  (display name "pg_server")
  server    http://host.docker.internal:5080   -- the ONE OpenObserve running here
  signals   server-vantage logs + postgresql receiver metrics
  NOT sent  traces/spans, and every non-Postgres engine

WHY GENERATED, NOT HAND-WRITTEN
-------------------------------
Same reason as gen-quad-config.py: collector/config.yaml is ~1,417 lines, is
shared with other work, and must not be edited in place. This script keeps the
receivers/processors verbatim and rewrites only `exporters:` and `service:`.
Re-run it after any edit to config.yaml.

HOW "NO TRACES" IS ENFORCED -- STRUCTURALLY, IN THREE PLACES
------------------------------------------------------------
Not by a filter that could be misconfigured, but by absence:
  1. NO traces exporter is defined in this file at all.
  2. NO traces pipeline exists, so there is no route for a span.
  3. The `otlp` receiver -- the ONLY span ingress -- is dropped from every
     pipeline, so a span the workload might still emit is not even accepted.
The workload additionally runs with WORKLOAD_TRACES=0 (see workload.py), which
stops spans at the source. Any ONE of these four is sufficient; all four hold.

Note this also removes `otlp` from the METRICS pipeline. In the shared config the
otlp receiver feeds metrics too, but its only client here is the workload's OTel
SDK -- with span export off it contributes nothing, and keeping it open would
accept spans on 4317/4318.

HOW POSTGRES-ONLY IS ENFORCED
-----------------------------
The mysql/mariadb/mssql receivers are dropped from the pipelines (the receiver
DEFINITIONS stay in the derived upstream text, which is inert -- OTel only
instantiates a receiver a pipeline names). That matters: those containers are
deliberately down, and a pipeline naming them would fail the collector at
startup rather than merely logging a scrape error.

THE ORG NEEDS NO PROVISIONING -- and here it already exists (id 1, "pg_server").
Never call POST /api/organizations for a rig org: it ignores a supplied
identifier, mints a random ksuid, and is not idempotent on name. See
gen-quad-config.py's header for the full account.
"""

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "collector" / "config.yaml"

ENDPOINT = "http://host.docker.internal:5080"

# A SECOND destination every lane also writes to, in ADDITION to its own org.
#
# The per-lane orgs keep the vantages separable (server-only vs server+client,
# per engine); this one is the COMBINED view -- all engines and both vantages in
# a single org, which is what a real deployment monitoring several databases
# actually looks like. It is a fan-out, not a move: each pipeline lists both
# exporters, so nothing the existing orgs receive changes.
#
# Set to "" to switch the fan-out off. Kept identical to gen-my-config.py's.
FANOUT_ORG = "3I75nCL8SYAzp4UHlZYepu5FqC0"  # display name: dbm_test

# TWO LANES, ONE GENERATOR. Both scrape the SAME Postgres with the SAME recipes;
# the ONLY difference is whether spans have a route. Keeping them in one file
# means a recipe added to config.yaml reaches both on the next regeneration, and
# the traces dimension cannot silently drift between them.
#
#   pg_server        server vantage only  -> NO traces exporter, NO traces
#                    pipeline, otlp receiver unused
#   pg_clinet_server client + server      -> traces pipeline fed by the otlp
#                    receiver (the workload's spans)
#
# The org id is CASE-SENSITIVE and is the only thing that varies in the URL.
# (`pg_clinet_server` is spelled as the org actually is -- matching the real
# identifier matters more than the typo.)
LANES = [
    {
        "out": "config.pg.yaml",
        "org": "3I5P2XLx14DvzepfpUikQX0nV9Y",
        "name": "pg_server",
        "traces": False,
    },
    {
        "out": "config.pgcs.yaml",
        "org": "3I5dk6zTLaUO6mehphFztiODMKh",
        "name": "pg_clinet_server",
        "traces": True,
    },
]

# Bounded queue + capped retry, same rationale as the quad lane: a dead backend
# should shed on a timer, not buffer without limit (measured 2.06 GiB RSS once).
QUEUE_LOGS = "sending_queue: { enabled: true, num_consumers: 8, queue_size: 5000 }"
QUEUE_SMALL = "sending_queue: { enabled: true, num_consumers: 2, queue_size: 200 }"
RETRY = "retry_on_failure: { enabled: true, max_elapsed_time: 300s }"

# Postgres-only recipe receivers. Derived from config.yaml's logs pipeline by
# prefix, so a pg recipe added there is picked up on the next regeneration.
PG_PREFIXES = ("sqlquery/pg_", "filelog/pg")


def exporters_block(lane) -> str:
    org, traces = lane["org"], lane["traces"]
    # TRACES: emitted ONLY for a traces lane. The ABSENCE of this exporter is
    # what makes the no-traces lane no-traces -- not a filter that could be
    # misconfigured. Do not add one "for symmetry".
    traces_exporter = f"""
  otlphttp/pg_traces:
    traces_endpoint: {ENDPOINT}/api/{org}/v1/traces
    headers: {{ Authorization: "Basic ${{env:O2_AUTH}}" }}
    tls: {{ insecure: true }}
    {QUEUE_SMALL}
    {RETRY}""" if traces else ""

    # The SECOND destination -- see FANOUT_ORG. Same signals, same stream name;
    # only the org differs. Separate exporters because an otlphttp exporter has
    # exactly one URL.
    fanout_exporters = f"""
  otlphttp/fan_logs:
    logs_endpoint: {ENDPOINT}/api/{FANOUT_ORG}/v1/logs
    headers:
      Authorization: Basic ${{env:O2_AUTH}}
      stream-name: dbm_server
    tls: {{ insecure: true }}
    {QUEUE_LOGS}
    {RETRY}
  otlphttp/fan_metrics:
    metrics_endpoint: {ENDPOINT}/api/{FANOUT_ORG}/v1/metrics
    headers: {{ Authorization: "Basic ${{env:O2_AUTH}}" }}
    tls: {{ insecure: true }}
    {QUEUE_SMALL}
    {RETRY}""" + (f"""
  otlphttp/fan_traces:
    traces_endpoint: {ENDPOINT}/api/{FANOUT_ORG}/v1/traces
    headers: {{ Authorization: "Basic ${{env:O2_AUTH}}" }}
    tls: {{ insecure: true }}
    {QUEUE_SMALL}
    {RETRY}""" if traces else "") if FANOUT_ORG else ""

    return f"""exporters:
  # ---- GENERATED BY gen-pg-config.py -- DO NOT EDIT BY HAND ----
  # Lane: {lane["name"]} ({org})  traces={"YES" if traces else "NO"}
  otlphttp/pg_logs:
    logs_endpoint: {ENDPOINT}/api/{org}/v1/logs
    headers:
      Authorization: Basic ${{env:O2_AUTH}}
      stream-name: dbm_server
    tls: {{ insecure: true }}
    {QUEUE_LOGS}
    {RETRY}
  otlphttp/pg_metrics:
    metrics_endpoint: {ENDPOINT}/api/{org}/v1/metrics
    headers: {{ Authorization: "Basic ${{env:O2_AUTH}}" }}
    tls: {{ insecure: true }}
    {QUEUE_SMALL}
    {RETRY}{traces_exporter}
{fanout_exporters}
  debug:
    verbosity: basic
  # Raw-evidence sink. The path is OPENED, never CREATED -- /rawout must exist
  # on the host before start or the collector dies within seconds and `docker
  # ps` simply shows nothing (check `docker ps -a`).
  file/raw_events:
    path: /rawout/receiver-events.jsonl
  # DETACHED on purpose: no rotation, measured ~90 GB/hour. Do not re-attach
  # except for a short, watched run.
  file/raw_recipes:
    path: /rawout/recipe-rows.jsonl
"""


def service_block(lane, recipe_receivers: str) -> str:
    traces = lane["traces"]
    # Every pipeline gains the fan-out exporter ALONGSIDE its own -- appending,
    # never replacing, so the lane's own org is unaffected.
    fan_logs = ", otlphttp/fan_logs" if FANOUT_ORG else ""
    fan_metrics = ", otlphttp/fan_metrics" if FANOUT_ORG else ""
    fan_traces = ", otlphttp/fan_traces" if FANOUT_ORG else ""
    # CLIENT VANTAGE. Present ONLY on a traces lane. `otlp` is the workload's
    # span ingress; on the server-only lane it appears in NO pipeline, so a span
    # that somehow arrived would have nowhere to go.
    traces_pipeline = f"""
    traces:
      receivers: [otlp]
      processors: [memory_limiter/pg, resource/ident, batch]
      exporters: [otlphttp/pg_traces{fan_traces}]""" if traces else """
    # NO `traces:` PIPELINE. Deliberate. A span has no route to this org."""

    return f"""service:
  extensions: [health_check, file_storage/o2dbm]
  telemetry:
    logs:
      level: info
  pipelines:
    # SERVER VANTAGE / receiver-native events: db.server.query_sample and
    # db.server.top_query. `mysql` is dropped from the shared config's list --
    # that container is down for this lane.
    logs/receiver_events:
      receivers: [postgresql]
      processors: [memory_limiter/pg, transform/tag_source, resource/ident, batch]
      exporters: [otlphttp/pg_logs{fan_logs}, file/raw_events]
    # SERVER VANTAGE: pg recipes + pg log tailing.
    # memory_limiter FIRST, then filter/dbm before the batcher -- dropped
    # records must never reach the batcher.
    logs:
      receivers:
        [
          {recipe_receivers}
        ]
      processors: [memory_limiter/pg, filter/dbm, transform/tag_source, resource/ident, batch]
      exporters: [otlphttp/pg_logs{fan_logs}]
    # Postgres receiver metrics. `otlp` is NOT a receiver here even on the
    # traces lane: its only client is the workload's OTel SDK, which exports
    # spans, not metrics -- listing it would open a metrics path nothing feeds.
    metrics:
      receivers: [postgresql]
      processors: [memory_limiter/pg, resource/ident, batch]
      exporters: [otlphttp/pg_metrics{fan_metrics}]{traces_pipeline}
"""


def main() -> None:
    src = SRC.read_text()

    # Keep everything upstream of `exporters:` verbatim -- receivers/processors
    # stay in lockstep with the shared config.
    idx = src.index("\nexporters:\n")
    upstream = src[: idx + 1]

    ext_start = src.index("\nextensions:\n")
    svc_start = src.index("\nservice:\n")
    extensions = src[ext_start + 1 : svc_start + 1]

    # Pull the shared logs-pipeline receiver list, then keep only the pg ones.
    svc = src[svc_start:]
    m = re.search(r"    logs:\n      receivers:\n(.*?)\n      processors:", svc, re.S)
    if not m:
        raise SystemExit("could not locate the logs pipeline receiver list in config.yaml")
    names = [n for n in re.findall(r"[\w/]+", m.group(1)) if n != "receivers"]
    pg_names = [n for n in names if n.startswith(PG_PREFIXES)]
    if not pg_names:
        raise SystemExit("no postgres receivers found -- refusing to write an empty pipeline")
    dropped = [n for n in names if n not in pg_names]
    recipe_receivers = ",\n          ".join(pg_names) + ","

    limiter = """
  # memory_limiter: the guard the shared config lacks. MUST be first in every
  # pipeline's processor list -- a limiter after the batcher never sees the data
  # that is actually accumulating.
  memory_limiter/pg:
    check_interval: 1s
    limit_mib: 1536
    spike_limit_mib: 384
"""

    for lane in LANES:
        out = HERE / "collector" / lane["out"]
        vantage = (
            "server + CLIENT (workload spans)" if lane["traces"] else "SERVER vantage only"
        )
        header = (
            "# GENERATED FILE -- edit gen-pg-config.py and re-run it, not this file.\n"
            "# Derived from collector/config.yaml (kept verbatim upstream of `exporters:`).\n"
            f"# POSTGRES ONLY -> org {lane['org']} (\"{lane['name']}\") on {ENDPOINT}\n"
            f"# Vantage: {vantage}.\n"
            "# Signals: server-vantage logs + postgresql metrics"
            + (" + traces.\n" if lane["traces"] else ", NO traces.\n")
            + "# The receiver DEFINITIONS for mysql/mariadb/mssql survive in the upstream text\n"
            "# below but are inert: OTel only instantiates a receiver a pipeline names.\n"
        )
        out.write_text(
            header + upstream.rstrip("\n") + "\n" + limiter + "\n"
            + exporters_block(lane) + "\n"
            + extensions.rstrip("\n") + "\n\n"
            + service_block(lane, recipe_receivers)
        )
        print(f"wrote {out.name} ({len(out.read_text().splitlines())} lines)")
        print(f"  org      {lane['org']}  ({lane['name']})")
        print(f"  traces   {'YES -- otlp receiver -> traces pipeline' if lane['traces'] else 'NO exporter, NO pipeline, otlp unused'}")

    print(f"  kept     {len(pg_names)} pg receivers: {', '.join(pg_names)}")
    print(f"  dropped  {len(dropped)} non-pg receivers: {', '.join(dropped)}")


if __name__ == "__main__":
    main()
