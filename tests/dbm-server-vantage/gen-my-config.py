#!/usr/bin/env python3
"""Generate collector/config.my.yaml + config.mycs.yaml: MYSQL ONLY -> two orgs.

WHAT THESE LANES ARE
--------------------
  my    org `mysql_server`         SERVER vantage only: dbm_server logs +
                                   mysql receiver metrics, NO traces.
  mycs  org `mysql_client_server`  the SAME server data PLUS the workload's
                                   client spans (CLIENT + SERVER vantage).

  server    http://host.docker.internal:5080   -- the ONE OpenObserve running here
  NOT sent  every non-MySQL engine (pg / mariadb / mssql / redis)

The two orgs differ by EXACTLY ONE SIGNAL. That is the whole point of the split:
it makes the client-vantage half testable in isolation, because everything else
is byte-for-byte the same generator output.

WHY GENERATED, NOT HAND-WRITTEN
-------------------------------
Same reason as gen-pg-config.py: collector/config.yaml is ~1,450 lines, is shared
with other work, and must not be edited in place. This script keeps everything
upstream of `exporters:` VERBATIM and rewrites only `exporters:` and `service:`
(plus the one surgical `resource/ident` edit described below). Re-run it after
any edit to config.yaml and both lanes stay in lockstep.

HOW "NO TRACES" IS ENFORCED ON THE `my` LANE -- STRUCTURALLY, IN FOUR PLACES
----------------------------------------------------------------------------
Not by a filter that could be misconfigured, but by absence. Any ONE suffices:
  1. NO traces exporter is defined in that file at all.
  2. NO traces pipeline exists, so there is no route for a span.
  3. The `otlp` receiver -- the ONLY span ingress -- is in NO pipeline, so a
     span the workload might still emit is not even accepted.
  4. The workload runs WORKLOAD_TRACES=0 (my-rig.sh), stopping spans at source;
     it is also given no OTEL_EXPORTER_OTLP_ENDPOINT and the container publishes
     no 4317/4318, so a span has no address to go to.
The `mycs` lane reverses exactly those four and changes nothing else.

Note `otlp` is dropped from the METRICS pipeline on BOTH lanes. In the shared
config the otlp receiver feeds metrics too, but its only client here is the
workload's OTel SDK, which exports spans, not metrics -- listing it would open a
metrics path nothing feeds, and on the `my` lane it would also re-open a span
ingress the lane exists to withhold.

HOW MYSQL-ONLY IS ENFORCED
--------------------------
The postgresql/mariadb/mssql receivers are dropped from the PIPELINES (their
DEFINITIONS stay in the derived upstream text). That matters: those containers
are either down or belong to the still-running pg lanes, and a pipeline naming a
down one would fail the collector at startup rather than merely log a scrape
error.

BUT "an unnamed receiver is inert" IS ONLY HALF TRUE -- and this lane is where
the other half bites. OTel resolves `${env:...}` across the WHOLE file and
unmarshals + Validate()s EVERY defined receiver; it merely does not START the
ones no pipeline names. postgresqlreceiver's Validate() REJECTS an empty
username/password, so the inherited-but-unused `postgresql:` definition kills
this collector at startup unless PG* is set:

    Error: invalid configuration: receivers::postgresql: invalid config:
    missing username; invalid config: missing password

The pg lane never hit the mirror image of this only because mysqlreceiver's
Validate() is LENIENT about the same emptiness (it logs "unset environment
variable" warnings for MYSQL*/MARIA* and starts anyway) -- an asymmetry between
the two receivers, not a difference between the lanes. my-rig.sh therefore feeds
the collector deliberately-invalid PG* PLACEHOLDERS: enough to satisfy a
validator, never a connection, and wrong on purpose so that a future edit which
did put `postgresql` in a pipeline fails loudly instead of quietly scraping the
pg lanes' database into a mysql org.

THE INSTANCE IDENTITY -- THE ONE EDIT THIS SCRIPT MAKES TO UPSTREAM TEXT
-----------------------------------------------------------------------
The shared config's `resource/ident` upserts server.address/host.name from
`${env:PGHOST}`, because it was written for the Postgres lane. On a MySQL lane
that is WRONG in the most silent possible way, and the Postgres rig already paid
for the lesson: every row stored a NULL `o2_dbm_instance`, which emptied the
UI's "database" (instance) filter -- pick any value and the tabs go blank.

ONE SERVER MUST HAVE ONE IDENTITY. The mysql sqlquery recipes stamp
`'${env:MYSQLHOST}' AS server_address` into every row they emit, and a
RECORD-LEVEL COLUMN OUTRANKS A RESOURCE ATTRIBUTE at ingest. So if the resource
attribute said anything else, the recipe rows (top queries, table health, lock
waits) would answer to one instance value and the filelog rows (deadlocks,
slowest calls) to another -- one server split into two identities, and NO single
choice in the instance filter showing a complete server.

Hence: rewrite `${env:PGHOST}` -> `${env:MYSQLHOST}` inside the `resource/ident`
block only. The rewrite is asserted (exactly 2 substitutions) so a future edit to
config.yaml that changes that block fails loudly here instead of silently
producing NULL instances again.

THE `events:` BLOCK IS MANDATORY -- and it is inherited, not written here.
From contrib v0.148.0 on, `db.server.query_sample` / `db.server.top_query`
flipped from default-ON to default-OFF; without the receiver's `events:` block
they emit NOTHING, with no error and no warning. The shared config.yaml's
`mysql:` receiver already carries it, and because this script copies the
upstream verbatim it is inherited. main() ASSERTS its presence rather than
trusting that, since its absence is invisible at runtime.

THE ORGS NEED NO PROVISIONING BEYOND THE FIRST INGEST.
Never call POST /api/organizations for a rig org: it IGNORES a supplied
`identifier`, mints a random ksuid, and is not idempotent on name, so every call
makes a new ghost org -- and org deletion is `#[cfg(feature = "cloud")]`-gated,
so on this build they cannot be removed. See gen-quad-config.py's header. The
first ingest write as root auto-creates the org with the EXACT identifier
instead (validator.rs:758 `check_and_create_org`, gated on
ZO_CREATE_ORG_THROUGH_INGESTION, default true). `mysql_server` and
`mysql_client_server` were created exactly that way.
"""

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "collector" / "config.yaml"

ENDPOINT = "http://host.docker.internal:5080"

# TWO LANES, ONE GENERATOR. Both scrape the SAME MySQL with the SAME recipes; the
# ONLY difference is whether spans have a route. Keeping them in one file means a
# recipe added to config.yaml reaches both on the next regeneration, and the
# traces dimension cannot silently drift between them.
#
# The org identifiers are CASE-SENSITIVE and are the only thing that varies in
# the exporter URLs.
LANES = [
    {
        "out": "config.my.yaml",
        "org": "mysql_server",
        "name": "mysql_server",
        "traces": False,
    },
    {
        "out": "config.mycs.yaml",
        "org": "mysql_client_server",
        "name": "mysql_client_server",
        "traces": True,
    },
]

# Bounded queue + capped retry, same rationale as the pg lane: a dead backend
# should shed on a timer, not buffer without limit (measured 2.06 GiB RSS once).
QUEUE_LOGS = "sending_queue: { enabled: true, num_consumers: 8, queue_size: 5000 }"
QUEUE_SMALL = "sending_queue: { enabled: true, num_consumers: 2, queue_size: 200 }"
RETRY = "retry_on_failure: { enabled: true, max_elapsed_time: 300s }"

# MySQL-only recipe receivers. Derived from config.yaml's logs pipeline BY PREFIX,
# so a mysql recipe added there is picked up on the next regeneration.
#
# `sqlquery/mysql_` and `filelog/mysql` -- and NOT `sqlquery/mariadb_` /
# `filelog/mariadb`, which are a different engine against a container this lane
# leaves down. The prefixes are matched with `startswith`, and "mysql" is not a
# prefix of "mariadb", so there is no accidental overlap.
MY_PREFIXES = ("sqlquery/mysql_", "filelog/mysql")


def exporters_block(lane) -> str:
    org, traces = lane["org"], lane["traces"]
    # TRACES: emitted ONLY for a traces lane. The ABSENCE of this exporter is
    # what makes the no-traces lane no-traces -- not a filter that could be
    # misconfigured. Do not add one "for symmetry".
    traces_exporter = f"""
  otlphttp/my_traces:
    traces_endpoint: {ENDPOINT}/api/{org}/v1/traces
    headers: {{ Authorization: "Basic ${{env:O2_AUTH}}" }}
    tls: {{ insecure: true }}
    {QUEUE_SMALL}
    {RETRY}""" if traces else ""

    return f"""exporters:
  # ---- GENERATED BY gen-my-config.py -- DO NOT EDIT BY HAND ----
  # Lane: {lane["name"]} ({org})  traces={"YES" if traces else "NO"}
  otlphttp/my_logs:
    logs_endpoint: {ENDPOINT}/api/{org}/v1/logs
    headers:
      Authorization: Basic ${{env:O2_AUTH}}
      stream-name: dbm_server
    tls: {{ insecure: true }}
    {QUEUE_LOGS}
    {RETRY}
  otlphttp/my_metrics:
    metrics_endpoint: {ENDPOINT}/api/{org}/v1/metrics
    headers: {{ Authorization: "Basic ${{env:O2_AUTH}}" }}
    tls: {{ insecure: true }}
    {QUEUE_SMALL}
    {RETRY}{traces_exporter}
  debug:
    verbosity: basic
  # Raw-evidence sink. The path is OPENED, never CREATED -- /rawout must exist
  # on the host before start or the collector dies within seconds and `docker
  # ps` simply shows nothing (check `docker ps -a`). my-rig.sh pre-creates it.
  file/raw_events:
    path: /rawout/receiver-events.jsonl
  # DETACHED on purpose: no rotation, measured ~90 GB/hour. Do not re-attach
  # except for a short, watched run.
  file/raw_recipes:
    path: /rawout/recipe-rows.jsonl
"""


def service_block(lane, recipe_receivers: str) -> str:
    traces = lane["traces"]
    # CLIENT VANTAGE. Present ONLY on a traces lane. `otlp` is the workload's
    # span ingress; on the server-only lane it appears in NO pipeline, so a span
    # that somehow arrived would have nowhere to go.
    traces_pipeline = """
    traces:
      receivers: [otlp]
      processors: [memory_limiter/my, resource/ident, batch]
      exporters: [otlphttp/my_traces]""" if traces else """
    # NO `traces:` PIPELINE. Deliberate. A span has no route to this org."""

    return f"""service:
  extensions: [health_check, file_storage/o2dbm]
  telemetry:
    logs:
      level: info
  pipelines:
    # SERVER VANTAGE / receiver-native events: db.server.query_sample and
    # db.server.top_query, which the `mysql` receiver emits ONLY because its
    # `events:` block enables them (mandatory from contrib 0.148.0 on).
    # `postgresql` is dropped from the shared config's list -- that engine
    # belongs to the pg lanes, which run their own collectors.
    logs/receiver_events:
      receivers: [mysql]
      processors: [memory_limiter/my, transform/tag_source, resource/ident, batch]
      exporters: [otlphttp/my_logs, file/raw_events]
    # SERVER VANTAGE: mysql recipes + mysql error-log tailing.
    # memory_limiter FIRST, then filter/dbm before the batcher -- dropped
    # records must never reach the batcher.
    logs:
      receivers:
        [
          {recipe_receivers}
        ]
      processors: [memory_limiter/my, filter/dbm, transform/tag_source, resource/ident, batch]
      exporters: [otlphttp/my_logs]
    # MySQL receiver metrics. `otlp` is NOT a receiver here even on the traces
    # lane: its only client is the workload's OTel SDK, which exports spans, not
    # metrics -- listing it would open a metrics path nothing feeds.
    metrics:
      receivers: [mysql]
      processors: [memory_limiter/my, resource/ident, batch]
      exporters: [otlphttp/my_metrics]{traces_pipeline}
"""


def main() -> None:
    src = SRC.read_text()

    # Keep everything upstream of `exporters:` verbatim -- receivers/processors
    # stay in lockstep with the shared config.
    idx = src.index("\nexporters:\n")
    upstream = src[: idx + 1]

    # THE ONE SURGICAL EDIT. See the module docstring: the shared resource/ident
    # is written for Postgres and would stamp a PGHOST identity onto MySQL rows,
    # which the recipes' record-level `server_address` then contradicts. Scope
    # the substitution to the resource/ident block so no datasource or recipe
    # elsewhere in the file is touched, and ASSERT the count -- if a future
    # config.yaml edit changes that block, this fails loudly here rather than
    # silently reintroducing NULL/split instances.
    ident_m = re.search(
        r"(  resource/ident:\n)(.*?)(?=\n  [a-z_]+[a-z_/]*:\n)", upstream, re.S
    )
    if not ident_m:
        raise SystemExit("could not locate the resource/ident block in config.yaml")
    # Substitute only on VALUE lines (`value: ${env:PGHOST}`), never inside the
    # block's prose -- that comment explains the Postgres lane's reasoning and
    # rewriting it would produce a comment that no longer matches config.yaml.
    ident_body, n = re.subn(
        r"(?m)^(\s*value:\s*)\$\{env:PGHOST\}\s*$", r"\1${env:MYSQLHOST}", ident_m.group(2)
    )
    if n != 2:
        raise SystemExit(
            f"resource/ident: expected exactly 2 `value: ${{env:PGHOST}}` lines "
            f"(server.address + host.name), found {n} -- config.yaml changed, "
            "review gen-my-config.py before trusting the instance identity"
        )
    upstream = upstream[: ident_m.start(2)] + ident_body + upstream[ident_m.end(2):]

    # The `events:` block is MANDATORY from contrib 0.148.0 on: without it the
    # mysql receiver emits NO db.server.query_sample / db.server.top_query, with
    # no error and no warning. It is inherited verbatim from config.yaml, but
    # assert it -- its absence is invisible at runtime and would look like "the
    # feature just does not work".
    my_recv = re.search(r"\n  mysql:\n(.*?)(?=\n  [a-z_]+[a-z_/]*:\n)", upstream, re.S)
    if not my_recv:
        raise SystemExit("could not locate the `mysql:` receiver in config.yaml")
    body = my_recv.group(1)
    for ev in ("db.server.query_sample", "db.server.top_query"):
        if not re.search(rf"events:.*{re.escape(ev)}:\s*{{\s*enabled:\s*true", body, re.S):
            raise SystemExit(
                f"mysql receiver is missing `events: {{{ev}: {{enabled: true}}}}` -- "
                "MANDATORY from contrib 0.148.0; without it that event emits "
                "NOTHING, silently"
            )

    ext_start = src.index("\nextensions:\n")
    svc_start = src.index("\nservice:\n")
    extensions = src[ext_start + 1 : svc_start + 1]

    # Pull the shared logs-pipeline receiver list, then keep only the mysql ones.
    svc = src[svc_start:]
    m = re.search(r"    logs:\n      receivers:\n(.*?)\n      processors:", svc, re.S)
    if not m:
        raise SystemExit("could not locate the logs pipeline receiver list in config.yaml")
    names = [n for n in re.findall(r"[\w/]+", m.group(1)) if n != "receivers"]
    my_names = [n for n in names if n.startswith(MY_PREFIXES)]
    if not my_names:
        raise SystemExit("no mysql receivers found -- refusing to write an empty pipeline")
    if not any(n.startswith("filelog/mysql") for n in my_names):
        raise SystemExit(
            "filelog/mysql is missing from the logs pipeline -- deadlocks come "
            "ONLY from the error log, so the lane would silently have none"
        )
    dropped = [n for n in names if n not in my_names]
    recipe_receivers = ",\n          ".join(my_names) + ","

    limiter = """
  # memory_limiter: the guard the shared config lacks. MUST be first in every
  # pipeline's processor list -- a limiter after the batcher never sees the data
  # that is actually accumulating.
  memory_limiter/my:
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
            "# GENERATED FILE -- edit gen-my-config.py and re-run it, not this file.\n"
            "# Derived from collector/config.yaml (kept verbatim upstream of `exporters:`,\n"
            "# except resource/ident's PGHOST -> MYSQLHOST -- see the generator's header).\n"
            f"# MYSQL ONLY -> org {lane['org']} (\"{lane['name']}\") on {ENDPOINT}\n"
            f"# Vantage: {vantage}.\n"
            "# Signals: server-vantage logs + mysql metrics"
            + (" + traces.\n" if lane["traces"] else ", NO traces.\n")
            + "# The receiver DEFINITIONS for postgresql/mariadb/mssql survive in the upstream\n"
            "# text below but are inert: OTel only instantiates a receiver a pipeline names.\n"
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

    print(f"  ident    server.address/host.name = ${{env:MYSQLHOST}} ({n} substitutions)")
    print(f"  events   db.server.query_sample + db.server.top_query enabled on `mysql`")
    print(f"  kept     {len(my_names)} mysql receivers: {', '.join(my_names)}")
    print(f"  dropped  {len(dropped)} non-mysql receivers: {', '.join(dropped)}")


if __name__ == "__main__":
    main()
