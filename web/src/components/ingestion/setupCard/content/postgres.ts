// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// PostgreSQL data-source setup card. Shared collector scaffolding (install +
// write-config command) comes from ./otelShared.

import { raw, type TranslateFn } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { collectorInstallStep, writeConfigVariants, sharedToolIcons } from "./otelShared";
import {
  DBM_CONTRIB_VERSION,
  PG_DBM_AUTO_EXPLAIN_CONF,
  PG_DBM_CONFIG_YAML,
  PG_DBM_GRANT_SQL,
  PG_DBM_LOGGING_CONF,
  PG_DBM_LOGGING_VERIFY_SQL,
  dbmVerifyStep,
} from "./dbmShared";

// Step 1 — the monitoring role. The config reads the password from
// $POSTGRESQL_PASSWORD, set at run time.
const ROLE_SQL = `CREATE ROLE myuser WITH LOGIN PASSWORD 'mypassword';`;

const applyRole = (connect: string) => `${connect} -c "${ROLE_SQL}"`;

// Only the exporter endpoint + token are substituted per-org; {host}/{port}
// fill from the configure step's inputs.
const CONFIG_YAML = `receivers:
  postgresql:
    endpoint: {host}:{port}
    transport: tcp
    username: myuser
    password: \${env:POSTGRESQL_PASSWORD}
    databases:
      - postgres
    connection_pool:
      max_idle_time: 10m
      max_lifetime: 0
      max_idle: 2
      max_open: 5

processors:
  memory_limiter:
    check_interval: 1s
    limit_percentage: 75
    spike_limit_percentage: 15
  batch:
    send_batch_size: 10000
    timeout: 10s

exporters:
  otlphttp/openobserve:
    endpoint: {url}/api/{org}
    headers:
      Authorization: Basic {token}
      stream-name: default

service:
  pipelines:
    metrics:
      receivers: [postgresql]
      processors: [memory_limiter, batch]
      exporters: [otlphttp/openobserve]`;

export default function postgresCard(subs: CardSubstitutions, t: TranslateFn): RichCardContent {
  const tool = sharedToolIcons();
  return {
    provider: {
      name: raw("Postgres"),
      tagline: t("ingestion.setupCard.postgresqlTagline"),
      logo: getImageURL("images/ingestion/postgres.png"),
      tone: "#336791",
      // Logs too: the optional Database Monitoring steps ship deadlock and
      // blocking-chain events into the dbm_server logs stream.
      metaBadges: [t("common.metrics"), t("common.logs")],
    },
    steps: [
      {
        id: "prepare",
        titleKey: "ingestion.setupCard.preparePostgresqlTitle",
        descriptionKey: "ingestion.setupCard.preparePostgresqlDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        variants: [
          {
            id: "psql",
            label: raw("psql"),
            icon: tool.terminal,
            code: {
              lang: "bash",
              raw: applyRole("psql -h localhost -U postgres"),
            },
            note: t("ingestion.setupCard.postgresSuperuserNote"),
          },
          {
            id: "docker",
            label: raw("Docker"),
            icon: tool.docker,
            code: {
              lang: "bash",
              raw: applyRole("docker exec -i postgres psql -U postgres"),
            },
          },
          {
            id: "sql-client",
            labelKey: "ingestion.setupCard.sqlClientGuiVariant",
            icon: getImageURL("images/ingestion/postgres.png"),
            code: { lang: "sql", raw: ROLE_SQL },
          },
        ],
      },
      // Pinned, not the shared default: the DBM config below needs upstream
      // contrib >= 0.148.0 (the `events:` block is an unknown key on older
      // releases).
      collectorInstallStep(t, DBM_CONTRIB_VERSION),
      {
        id: "configure",
        titleKey: "ingestion.setupCard.configureCollectorTitle",
        descriptionKey: "ingestion.setupCard.configureCollectorDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        required: true,
        completeOn: "copy",
        // No own toggle — follow the OS picked at the install step.
        variantGroup: "os",
        variantToggle: false,
        // Host/port fields fill {host}/{port} in the config reactively.
        inputs: [
          {
            id: "host",
            labelKey: "ingestion.setupCard.postgresqlHostLabel",
            default: "localhost",
            placeholder: raw("localhost"),
          },
          {
            id: "port",
            labelKey: "ingestion.setupCard.portLabel",
            default: "5432",
            placeholder: raw("5432"),
            width: "sm",
          },
        ],
        variants: writeConfigVariants(CONFIG_YAML, subs),
      },
      {
        id: "run",
        titleKey: "ingestion.setupCard.runCollectorTitle",
        descriptionKey: "ingestion.setupCard.runCollectorPostgresqlDesc",
        chip: { kind: "run", labelKey: "ingestion.setupCard.chipRun" },
        completeOn: "copy",
        code: {
          lang: "bash",
          raw: "POSTGRESQL_PASSWORD='mypassword' ./otelcol-contrib --config ./config.yaml",
        },
      },
      {
        id: "verify",
        titleKey: "ingestion.setupCard.verifyDataTitle",
        descriptionKey: "ingestion.setupCard.verifyPostgresqlMetricsDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipMetrics" },
        completeOn: "detect",
        detectionAnchor: true,
        // Plain-English summary, NOT the pg_stat_database counter names — so
        // these are translated.
        pills: [
          t("ingestion.setupCard.pillActiveBackends"),
          t("ingestion.setupCard.pillCommits"),
          t("ingestion.setupCard.pillRollbacks"),
          t("ingestion.setupCard.pillDatabaseSize"),
          t("ingestion.setupCard.pillBlocksRead"),
        ],
      },
      // ── Database Monitoring (optional) ──────────────────────────────────
      // Everything above ingests METRICS. The steps below add the SERVER
      // vantage the Deadlocks, Blocked queries and Activity tabs need: a
      // blocked query emits no client span while it is blocked, and a
      // deadlock's other participant may not be instrumented at all, so none
      // of it can be derived from traces.
      {
        id: "dbm-grant",
        titleKey: "ingestion.setupCard.dbmPreparePostgresTitle",
        descriptionKey: "ingestion.setupCard.dbmPreparePostgresDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        variants: [
          {
            id: "psql",
            label: raw("psql"),
            icon: tool.terminal,
            code: { lang: "bash", raw: `psql -h localhost -U postgres -c "${PG_DBM_GRANT_SQL}"` },
            note: "pg_monitor is what lets the collector read OTHER sessions' query text. Without it the blocking page can show that something is blocking, but never what. It does NOT include SELECT on your tables, so on a locked-down instance the EXPLAIN-based estimated plans can come back empty while everything else works. pg_stat_statements is what server top queries read — creating the extension here is safe; its counters start filling after the next step's restart.",
          },
          {
            id: "docker",
            label: raw("Docker"),
            icon: tool.docker,
            code: {
              lang: "bash",
              raw: `docker exec -i postgres psql -U postgres -c "${PG_DBM_GRANT_SQL}"`,
            },
          },
          {
            id: "sql-client",
            labelKey: "ingestion.setupCard.sqlClientGuiVariant",
            icon: getImageURL("images/ingestion/postgres.png"),
            code: { lang: "sql", raw: PG_DBM_GRANT_SQL },
          },
        ],
      },
      // The deadlock recipe's parser expects one exact log prefix shape that
      // is NOT the Postgres default. Without this step the collector runs,
      // reports healthy, and ingests nothing — so it comes BEFORE the config.
      {
        id: "dbm-logging",
        titleKey: "ingestion.setupCard.dbmPgLoggingTitle",
        descriptionKey: "ingestion.setupCard.dbmPgLoggingDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        code: { lang: "ini", raw: PG_DBM_LOGGING_CONF, filename: "postgresql.conf" },
        note: "Add these to postgresql.conf, then RESTART Postgres — log_line_prefix and logging_collector are not reloadable, so a reload appears to do nothing. WHAT THIS CAPTURES, AND WHAT IT COSTS: log_min_duration_statement = 100ms writes one log line for every completed statement slower than 100ms, with its exact duration — that log is what fills the Slowest-calls page, so this threshold decides which calls can ever appear there. Only the slow tail is logged, which is the cheap end of the range: Percona measure full-verbosity logging of every statement at over 40% throughput, versus under 2% for 1-in-100 sampled logging. Volume is PRO-CYCLICAL — as the database slows, more statements cross 100ms, so it logs most just when it is busiest. On the reference rig the rate stayed flat (3.33% of statements in both healthy and degraded states) and volume simply tracked throughput, but a primary degrading to a 100ms MEDIAN would cross on most statements; on a contended primary set 500ms or 1s instead. Deadlock capture is not available on managed Postgres (RDS, Aurora, Cloud SQL): it reads the server's log file from disk, and those platforms give the collector no filesystem to read it from — setting these as parameter-group values will not change that. Every other signal on this page, including metrics, top queries, activity and blocking chains, works there normally.",
      },
      {
        id: "dbm-logging-verify",
        titleKey: "ingestion.setupCard.dbmPgLoggingVerifyTitle",
        descriptionKey: "ingestion.setupCard.dbmPgLoggingVerifyDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        code: { lang: "sql", raw: PG_DBM_LOGGING_VERIFY_SQL },
      },
      // OPTIONAL — real executed plans. Sits after the logging step because
      // both edit postgresql.conf and share one restart.
      {
        id: "dbm-auto-explain",
        titleKey: "ingestion.setupCard.dbmPgAutoExplainTitle",
        descriptionKey: "ingestion.setupCard.dbmPgAutoExplainDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        code: { lang: "ini", raw: PG_DBM_AUTO_EXPLAIN_CONF, filename: "postgresql.conf" },
        note: "Optional, with a real cost: log_analyze = on instruments every statement auto_explain samples — log_min_duration only controls what is LOGGED, sample_rate controls what PAYS. The shipped values are the cheap end of the published range: sample_rate = 0.01 is exactly the 1-in-100 case Percona measure at under 2% throughput cost, against over 40% for full-verbosity logging of every statement. On a busy primary start at sample_rate = 0.01 and log_min_duration = '2s', keep log_timing off, and watch p99 for a full business cycle before widening. Requires log_destination = 'stderr' (the logging step's setting); syslog splits multi-line plans and is unsupported. No server-side switch: OpenObserve ingests these records whenever Database Monitoring is enabled.",
      },
      {
        id: "dbm-configure",
        titleKey: "ingestion.setupCard.dbmConfigureTitle",
        descriptionKey: "ingestion.setupCard.dbmConfigurePostgresDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        variantGroup: "os",
        variantToggle: false,
        inputs: [
          {
            id: "database",
            labelKey: "ingestion.setupCard.dbmDatabaseLabel",
            default: "postgres",
            placeholder: raw("postgres"),
          },
          {
            id: "logpath",
            labelKey: "ingestion.setupCard.dbmPgLogPathLabel",
            default: "/var/log/postgresql/postgresql*.log",
            placeholder: raw("/var/log/postgresql/postgresql*.log"),
            helpKey: "ingestion.setupCard.dbmPgLogPathHelp",
          },
        ],
        variants: writeConfigVariants(PG_DBM_CONFIG_YAML, subs).map((v) => ({
          ...v,
          // Written alongside, not over, the metrics config.yaml.
          code: {
            ...v.code,
            raw: v.code.raw.replace(/config\.yaml/g, "dbm-config.yaml"),
            masked: v.code.masked?.replace(/config\.yaml/g, "dbm-config.yaml"),
          },
        })),
        note: "Needs the upstream OpenTelemetry Collector Contrib from the install step, v0.148.0 or newer (verified at v0.158.0) — the OpenObserve collector build does not include the database receivers, so it cannot run this config. Deadlock capture tails the Postgres log file on disk, so it is not available on managed Postgres (RDS, Aurora, Cloud SQL): those platforms give the collector no file to read. Blocking chains, activity samples and top queries work there normally. ACTIVITY SAMPLES AND TOP QUERIES SHIP ON. In the config above, events: db.server.query_sample and db.server.top_query are enabled: true — the collector's own default has been off since v0.148.0, so this block is the switch, and OpenObserve reads both feeds whenever Database Monitoring is enabled (no environment variable to pair). Set either to false to trim collection cost on your database; query_sample is the high-volume one, and top_query includes the receiver's EXPLAIN pass. Activity samples are high-volume and share the dbm_server stream's normal retention; if volume is a concern, set a shorter retention policy on the dbm_server stream. POINT THIS AT A PRIMARY. Top queries, slowest calls, blocking chains and deadlocks all measure things a hot standby barely does — pg_stat_statements on a standby tracks only standby-executed queries, and a standby writes almost no statement log — so a replica-only setup shows empty pages rather than an error. The exception is table and index stats, which read catalog and file sizes and are the same on a replica: moving just those two receivers to a standby takes the largest schema-scaling cost off the primary, with the caveat that idx_scan then counts standby scans only, so 'never scanned' is not grounds to DROP an index. Measured footprint on the reference rig was 0.060% of database execution time and 13 connections; the per-recipe budget, the self-check query for your own instance, and slower intervals for a contended primary are in docs/db_monitoring/database-load-budget.md.",
      },
      {
        id: "dbm-run",
        titleKey: "ingestion.setupCard.dbmRunTitle",
        descriptionKey: "ingestion.setupCard.dbmRunPostgresDesc",
        chip: { kind: "run", labelKey: "ingestion.setupCard.chipRun" },
        completeOn: "copy",
        code: {
          lang: "bash",
          // POSTGRESQL_PASSWORD feeds the metrics config; PGUSER/PGPASS feed
          // the DBM one. The merged run needs all three.
          raw: "POSTGRESQL_PASSWORD='mypassword' PGUSER='myuser' PGPASS='mypassword' \\\n  ./otelcol-contrib --config ./config.yaml --config ./dbm-config.yaml",
        },
        note: "Two --config flags merge the metrics and database-monitoring pipelines into one collector.",
      },
      // 300s: the pg table/index recipes tick every 5 minutes, not every 60s.
      dbmVerifyStep("full", true, "300s"),
    ],
    detect: {
      streamType: "metrics",
      match: "keyword",
      streamName: "postgresql",
      filter: "",
    },
    docUrl: "https://openobserve.ai/blog/how-to-monitor-postgresql-performance",
  };
}
