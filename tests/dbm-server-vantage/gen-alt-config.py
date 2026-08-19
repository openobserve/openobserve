#!/usr/bin/env python3
"""Generate collector configs for the REMAINING engines: MariaDB and SQL Server.

WHAT THIS LANE IS
-----------------
  maria  -> org `mariadb_server`   MariaDB, SERVER vantage only, no traces
  mssql  -> org `mssql_server`     SQL Server, SERVER vantage only, no traces

Plus the shared FANOUT_ORG, exactly as the pg and mysql generators do, so the
combined org ends up holding all four engines.

WHY NO CLIENT-VANTAGE LANE FOR THESE TWO
----------------------------------------
Postgres and MySQL each get a `*cs` twin because the client half is the thing
under test there -- the two orgs differ by exactly one signal, which is what
makes the trace-fed tabs testable in isolation. That question is already
answered by those four orgs; repeating it here would double the containers and
the ingest for no new information. What MariaDB and SQL Server actually add is
ENGINE coverage: a second InnoDB implementation, and a non-InnoDB engine whose
deadlock graph and blocking DMVs share no code path with either.

WHAT EACH ENGINE CAN ACTUALLY FILL -- and what it cannot
--------------------------------------------------------
Neither engine has receiver-native events adopted (no `events:` block exists for
them), so neither fills Activity or Top queries from a receiver. Their tabs come
from the sqlquery recipes and, for MariaDB, the error log:

  MariaDB   sqlquery/mariadb_locks  (10s)  -> Blocked queries
            sqlquery/mariadb_schema (60s)  -> Table health
            filelog/mariadb                -> Deadlocks
  SQL Srv   sqlquery/mssql_blocking (10s)  -> Blocked queries
            sqlquery/mssql_deadlocks (30s) -> Deadlocks

So an EMPTY Activity tab on these lanes is correct, not a defect -- and that is
precisely what the suite's "empty must explain itself" rule exists to check.

SQL SERVER IS EMULATED ON APPLE SILICON
---------------------------------------
There is no arm64 image; it runs under emulation, starts slowly (hence its 30s
start_period) and costs real CPU. It is the reason `mssql` is a separate lane
rather than folded in with MariaDB: bringing MariaDB up should not require
waiting on it.

THE ORGS NEED NO PROVISIONING BEYOND THE FIRST INGEST.
Never call POST /api/organizations for a rig org: it IGNORES a supplied
`identifier`, mints a random ksuid, and is not idempotent on name, so every call
leaves a ghost org -- and org deletion is `#[cfg(feature = "cloud")]`-gated, so
on this build they cannot be removed. The first ingest write as root
auto-creates the org with the EXACT identifier instead (validator.rs:758
`check_and_create_org`, gated on ZO_CREATE_ORG_THROUGH_INGESTION, default true).
"""

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "collector" / "config.yaml"

ENDPOINT = "http://host.docker.internal:5080"

# Kept identical to gen-pg-config.py / gen-my-config.py. Set to "" to switch the
# fan-out off.
FANOUT_ORG = "3I75nCL8SYAzp4UHlZYepu5FqC0"  # display name: dbm_test

# One entry per engine. `env_host` is the variable the shared recipes already
# interpolate as `server_address`, and therefore the value resource/ident must
# be rewritten to -- one server, ONE identity. Getting this wrong is what split
# the Postgres fleet in two: a record-level column outranks a resource
# attribute, so two different values make one server answer to two instances and
# no single choice in the UI's "database" filter shows a complete server.
LANES = [
    {
        "out": "config.maria.yaml",
        "org": "mariadb_server",
        "name": "mariadb_server",
        "engine": "mariadb",
        "prefixes": ("sqlquery/mariadb_", "filelog/mariadb"),
        "env_host": "MARIAHOST",
        "metrics_receiver": None,  # no mariadb metrics receiver is configured
        "require_filelog": True,   # deadlocks come ONLY from the error log
        # mysqlreceiver speaks to MariaDB over the same protocol and identifies
        # it correctly (measured: product "MariaDB", version 11.8.8), so the
        # receiver-native db.server.* events fill Activity and Top queries here
        # exactly as they do on the MySQL lane -- no hand-written digest recipe
        # needed. Verified before wiring: the receiver starts clean against
        # maria-prod-1 and emits log records.
        #
        # ONE HONEST LIMIT, which the receiver discloses itself:
        # `supports_query_sample_text: false`. MariaDB does not expose the
        # statement text the sampler wants, so sample rows describe a session
        # without carrying its SQL. A real gap, but the receiver's own
        # disclosure rather than our guess.
        "events_receiver": True,
        "events_receiver_type": "mysql",
        # mysqlreceiver stamps `db.system.name: mysql` even against MariaDB.
        "engine_override": True,
    },
    {
        "out": "config.mssql.yaml",
        "org": "mssql_server",
        "name": "mssql_server",
        "engine": "mssql",
        "prefixes": ("sqlquery/mssql_",),
        "env_host": "MSSQLHOST",
        "metrics_receiver": None,
        # sqlserverreceiver adopts the SAME `db.server.*` events mysqlreceiver
        # does, so Activity and Top queries come from the receiver rather than a
        # hand-written recipe. Verified before wiring: with the workload running
        # the receiver emits log records against mssql-prod-1.
        #
        # This matters beyond convenience -- a sqlquery recipe would NOT have
        # worked. The backend builds activity records from the
        # `db.server.query_sample` EVENT (server_vantage.rs: ActivitySample), so
        # recipe rows would land as an unclassified kind and the Activity tab
        # would stay empty however good the SQL was.
        "events_receiver": True,
        "events_receiver_type": "sqlserver",
        # SQL Server names the victim inline in its deadlock graph, so the
        # `sqlquery/mssql_deadlocks` shred is self-contained -- no log tailing,
        # and no cross-record stitching of the kind InnoDB needs.
        "require_filelog": False,
    },
]

QUEUE_LOGS = "sending_queue: { enabled: true, num_consumers: 8, queue_size: 5000 }"
QUEUE_SMALL = "sending_queue: { enabled: true, num_consumers: 2, queue_size: 200 }"
RETRY = "retry_on_failure: { enabled: true, max_elapsed_time: 300s }"


def exporters_block(lane) -> str:
    org = lane["org"]
    fanout = f"""
  otlphttp/fan_logs:
    logs_endpoint: {ENDPOINT}/api/{FANOUT_ORG}/v1/logs
    headers:
      Authorization: Basic ${{env:O2_AUTH}}
      stream-name: dbm_server
    tls: {{ insecure: true }}
    {QUEUE_LOGS}
    {RETRY}""" if FANOUT_ORG else ""

    return f"""exporters:
  # ---- GENERATED BY gen-alt-config.py -- DO NOT EDIT BY HAND ----
  # Lane: {lane["name"]} ({org})  engine={lane["engine"]}  traces=NO
  #
  # There is deliberately NO traces exporter and NO metrics exporter here: this
  # lane ships server-vantage logs only. Absence is the guarantee -- not a
  # filter that could be misconfigured.
  otlphttp/alt_logs:
    logs_endpoint: {ENDPOINT}/api/{org}/v1/logs
    headers:
      Authorization: Basic ${{env:O2_AUTH}}
      stream-name: dbm_server
    tls: {{ insecure: true }}
    {QUEUE_LOGS}
    {RETRY}{fanout}
  debug:
    verbosity: basic
  # Raw-evidence sink. The path is OPENED, never CREATED -- /rawout must exist
  # on the host before start or the collector dies within seconds and `docker
  # ps` simply shows nothing (check `docker ps -a`). alt-rig.sh pre-creates it.
  file/raw_events:
    path: /rawout/receiver-events.jsonl
"""


def events_pipeline(lane) -> str:
    """The receiver-native `db.server.*` events pipeline, where the engine has one.

    Kept SEPARATE from the recipe pipeline, exactly as the MySQL lane does: the
    two carry different record shapes and only the recipes need `filter/dbm`.
    """
    if not lane.get("events_receiver"):
        return ""
    fan = ", otlphttp/fan_logs" if FANOUT_ORG else ""
    rid = lane["events_receiver_type"] + "/alt"
    engine_fix = (
        f" transform/engine_{lane['engine']}," if lane.get("engine_override") else ""
    )
    return f"""
    # RECEIVER-NATIVE EVENTS -> Activity + Top queries.
    # The receiver adopts `db.server.query_sample` / `db.server.top_query`, which
    # is what the backend actually builds activity records from -- a sqlquery
    # recipe emitting the same columns would NOT populate the Activity tab.
    # No `filter/dbm`: that processor gates the sqlquery recipe rows, and these
    # records arrive already shaped by the receiver.
    logs/receiver_events:
      receivers: [{rid}]
      processors: [memory_limiter/alt, transform/tag_source,{engine_fix} resource/ident, batch]
      exporters: [otlphttp/alt_logs{fan}, file/raw_events]"""


def events_receiver(lane) -> str:
    """A `mysql` receiver pointed at THIS lane's engine.

    Named `mysql/alt` rather than reusing the upstream `mysql:` definition: that
    one interpolates ${env:MYSQLHOST}, which this lane deliberately sets to an
    inert placeholder so nothing can quietly scrape the MySQL lane's database
    into this org.
    """
    if not lane.get("events_receiver"):
        return ""
    kind = lane["events_receiver_type"]
    events = """    events:
      db.server.query_sample: { enabled: true }
      db.server.top_query: { enabled: true }
"""
    if kind == "mysql":
        # mysqlreceiver takes host:port as one `endpoint`.
        return f"""
  mysql/alt:
    endpoint: ${{env:{lane["env_host"]}}}:${{env:MARIAPORT}}
    username: ${{env:MARIAUSER}}
    password: ${{env:MARIAPASS}}
    database: ${{env:MARIADB}}
    collection_interval: 10s
    query_sample_collection:
      max_rows_per_query: 1000
    top_query_collection:
      top_query_count: 200
      collection_interval: 15s
      lookback_time: 120
      query_plan_cache_size: 1000
{events}"""
    if kind == "sqlserver":
        # sqlserverreceiver splits `server` and `port`, and takes NO `database`
        # -- it reads across the instance. Not interchangeable with the mysql
        # shape above, which is why the type is explicit per lane.
        return f"""
  sqlserver/alt:
    server: ${{env:{lane["env_host"]}}}
    port: ${{env:MSSQLPORT}}
    username: ${{env:MSSQLUSER}}
    password: ${{env:MSSQLPASS}}
    collection_interval: 10s
    query_sample_collection:
      max_rows_per_query: 1000
    top_query_collection:
      top_query_count: 200
{events}"""
    raise SystemExit(f"unknown events_receiver_type {kind!r}")


def engine_fixup_processor(lane) -> str:
    """Correct the engine name a borrowed receiver stamps.

    `mysqlreceiver` works against MariaDB — it detects the product correctly
    (`"product": "MariaDB"`) — but it still stamps `db.system.name: mysql` on
    the events it emits. The lane's own sqlquery recipes stamp `mariadb`, so
    without this ONE SERVER ANSWERS TO TWO ENGINES: measured on the rig, the
    fleet list returned five identities for four servers, with `maria-prod-1`
    appearing once as MariaDB and once as MySQL, and the Overview rendering it
    as two rows.

    That is the same class of split the instance identity had, and it is worth
    fixing at the collector rather than the reader: a record-level attribute is
    the engine's own claim about itself, and correcting it once here beats every
    downstream consumer having to know that one receiver lies about this lane.
    """
    if not lane.get("events_receiver") or not lane.get("engine_override"):
        return ""
    return f"""
  # The borrowed receiver stamps its OWN engine name; this lane is not that
  # engine. See engine_fixup_processor in gen-alt-config.py.
  transform/engine_{lane["engine"]}:
    error_mode: ignore
    log_statements:
      - context: log
        statements:
          - set(attributes["db.system.name"], "{lane["engine"]}")
          - set(resource.attributes["db.system.name"], "{lane["engine"]}")
"""


def service_block(lane, recipe_receivers: str) -> str:
    fan_logs = ", otlphttp/fan_logs" if FANOUT_ORG else ""
    events = events_pipeline(lane)
    return f"""service:
  extensions: [health_check, file_storage/o2dbm]
  telemetry:
    logs:
      level: info
  pipelines:
    # SERVER VANTAGE: this engine's recipes (+ its error log, where it has one).
    # memory_limiter FIRST, then filter/dbm before the batcher -- dropped
    # records must never reach the batcher.
    #
    # There is NO `logs/receiver_events` pipeline: neither engine has
    # receiver-native db.server.* events adopted, so there is nothing to put in
    # one. An empty Activity tab on this lane is the correct answer.
    logs:
      receivers:
        [
          {recipe_receivers}
        ]
      processors: [memory_limiter/alt, filter/dbm, transform/tag_source, resource/ident, batch]
      exporters: [otlphttp/alt_logs{fan_logs}, file/raw_events]{events}
    # NO `metrics:` PIPELINE -- no metrics receiver is configured for this
    # engine, and naming one that does not exist fails the collector at startup.
    # NO `traces:` PIPELINE. Deliberate. A span has no route to this org.
"""


def main() -> None:
    src = SRC.read_text()

    idx = src.index("\nexporters:\n")
    upstream_base = src[: idx + 1]

    ext_start = src.index("\nextensions:\n")
    svc_start = src.index("\nservice:\n")
    extensions = src[ext_start + 1 : svc_start + 1]

    svc = src[svc_start:]
    m = re.search(r"    logs:\n      receivers:\n(.*?)\n      processors:", svc, re.S)
    if not m:
        raise SystemExit("could not locate the logs pipeline receiver list in config.yaml")
    all_names = [n for n in re.findall(r"[\w/]+", m.group(1)) if n != "receivers"]

    limiter = """
  # memory_limiter: the guard the shared config lacks. MUST be first in every
  # pipeline's processor list -- a limiter after the batcher never sees the data
  # that is actually accumulating.
  memory_limiter/alt:
    check_interval: 1s
    limit_mib: 1024
    spike_limit_mib: 256
"""

    for lane in LANES:
        # THE ONE SURGICAL EDIT, same as the sibling generators: the shared
        # resource/ident is written for Postgres and would stamp a PGHOST
        # identity onto this engine's rows, which the recipes' record-level
        # `server_address` then contradicts. Scope the substitution to the
        # resource/ident block and ASSERT the count, so a future config.yaml
        # edit fails loudly here rather than silently reintroducing a split or
        # NULL instance.
        ident_m = re.search(
            r"(  resource/ident:\n)(.*?)(?=\n  [a-z_]+[a-z_/]*:\n)", upstream_base, re.S
        )
        if not ident_m:
            raise SystemExit("could not locate the resource/ident block in config.yaml")
        ident_body, n = re.subn(
            r"(?m)^(\s*value:\s*)\$\{env:PGHOST\}\s*$",
            r"\1${env:" + lane["env_host"] + "}",
            ident_m.group(2),
        )
        if n != 2:
            raise SystemExit(
                f"resource/ident: expected exactly 2 `value: ${{env:PGHOST}}` lines "
                f"(server.address + host.name), found {n} -- config.yaml changed, "
                "review gen-alt-config.py before trusting the instance identity"
            )
        upstream = (
            upstream_base[: ident_m.start(2)] + ident_body + upstream_base[ident_m.end(2):]
        )

        # Splice the events receiver in at the END of the RECEIVERS section.
        # `upstream` spans the whole file up to `exporters:`, so it holds
        # receivers AND processors: appending to its end puts a receiver inside
        # `processors:`, which the collector rejects at startup with
        # `'processors' unknown type: "mysql"`. The `\nprocessors:\n` line is
        # the boundary between the two.
        extra_receiver = events_receiver(lane)
        if extra_receiver:
            marker = "\nprocessors:\n"
            if marker not in upstream:
                raise SystemExit(
                    "could not find the processors: boundary -- refusing to guess "
                    "where a receiver belongs"
                )
            head, tail = upstream.split(marker, 1)
            upstream = head.rstrip("\n") + "\n" + extra_receiver + marker + tail

        kept = [x for x in all_names if x.startswith(lane["prefixes"])]
        if not kept:
            raise SystemExit(
                f"no {lane['engine']} receivers found -- refusing to write an empty pipeline"
            )
        if lane["require_filelog"] and not any(x.startswith("filelog/") for x in kept):
            raise SystemExit(
                f"{lane['engine']}: filelog is missing from the logs pipeline -- "
                "deadlocks come ONLY from the error log, so the lane would "
                "silently have none"
            )
        dropped = [x for x in all_names if x not in kept]
        recipe_receivers = ",\n          ".join(kept) + ","

        out = HERE / "collector" / lane["out"]
        header = (
            "# GENERATED FILE -- edit gen-alt-config.py and re-run it, not this file.\n"
            "# Derived from collector/config.yaml (kept verbatim upstream of `exporters:`,\n"
            f"# except resource/ident's PGHOST -> {lane['env_host']}).\n"
            f"# {lane['engine'].upper()} ONLY -> org {lane['org']} on {ENDPOINT}\n"
            "# Vantage: SERVER only. Signals: server-vantage logs. NO traces, NO metrics.\n"
            "# The receiver DEFINITIONS for the other engines survive in the upstream text\n"
            "# below but are inert: OTel only instantiates a receiver a pipeline names.\n"
            "#\n"
            "# NOTE the asymmetry that bit the MySQL lane: OTel unmarshals and Validate()s\n"
            "# EVERY defined receiver and merely skips STARTING the unnamed ones, and\n"
            "# postgresqlreceiver rejects empty credentials -- so this config still needs\n"
            "# PG* env vars set to something, even though nothing scrapes Postgres here.\n"
        )
        out.write_text(
            header + upstream.rstrip("\n") + "\n" + limiter
            + engine_fixup_processor(lane) + "\n"
            + exporters_block(lane) + "\n"
            + extensions.rstrip("\n") + "\n\n"
            + service_block(lane, recipe_receivers)
        )
        print(f"wrote {out.name} ({len(out.read_text().splitlines())} lines)")
        print(f"  org      {lane['org']}  engine={lane['engine']}")
        print(f"  ident    server.address/host.name = ${{env:{lane['env_host']}}} ({n} subs)")
        print(f"  kept     {len(kept)} receivers: {', '.join(kept)}")
        print(f"  dropped  {len(dropped)} non-{lane['engine']} receivers")
        if FANOUT_ORG:
            print(f"  fanout   also -> {FANOUT_ORG}")


if __name__ == "__main__":
    main()
