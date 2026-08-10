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
// write-config command) comes from ./otelShared; this file holds the Postgres
// specifics. Follows the OpenObserve guide:
// https://openobserve.ai/blog/how-to-monitor-postgresql-performance

import { raw, type TranslateFn } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { collectorInstallStep, writeConfigVariants, sharedToolIcons } from "./otelShared";
import {
  PG_DBM_CONFIG_YAML,
  PG_DBM_GRANT_SQL,
  PG_DBM_LOGGING_CONF,
  PG_DBM_LOGGING_VERIFY_SQL,
  dbmVerifyStep,
} from "./dbmShared";

// Step 1 — the monitoring role. Literal name/password here and in the config (the
// config reads the password from $POSTGRESQL_PASSWORD set at run time) — edit
// inline for different credentials.
const ROLE_SQL = `CREATE ROLE myuser WITH LOGIN PASSWORD 'mypassword';`;

// The SQL runs INSIDE Postgres, not the shell — Step 1 offers runnable psql /
// Docker commands that pass it via -c, plus the raw SQL for a GUI client.
const applyRole = (connect: string) => `${connect} -c "${ROLE_SQL}"`;

// Collector config (per the guide). Only the exporter endpoint + token are
// substituted per-org; {host}/{port} fill from the configure step's inputs. The
// password is read from $POSTGRESQL_PASSWORD (set in the run step).
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
      collectorInstallStep(t),
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
        // What the verify step will show, in prose. These are NOT the pg_stat_database
        // counter names that appear in the ingested metrics — they are a plain-English
        // summary of them, so they are translated.
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
      // vantage that Traces → Databases needs for its Deadlocks and Blocked
      // queries tabs: a blocked query emits no client span while it is
      // blocked, and a deadlock's other participant may not be instrumented at
      // all, so neither can be derived from traces. Kept last and optional so
      // the metrics path stays a four-step flow.
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
            note: "pg_monitor is what lets the collector read OTHER sessions' query text. Without it the blocking page can show that something is blocking, but never what.",
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
      // The deadlock recipe tails the Postgres log, and its parser expects one
      // exact prefix shape that is NOT the Postgres default. Without this step
      // the collector below runs, reports healthy, and ingests nothing — so it
      // has to come BEFORE the config that depends on it.
      {
        id: "dbm-logging",
        titleKey: "ingestion.setupCard.dbmPgLoggingTitle",
        descriptionKey: "ingestion.setupCard.dbmPgLoggingDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        code: { lang: "ini", raw: PG_DBM_LOGGING_CONF, filename: "postgresql.conf" },
        note: "Add these to postgresql.conf, then RESTART Postgres — log_line_prefix and logging_collector are not reloadable, so a reload appears to do nothing. Managed Postgres (RDS, Cloud SQL) exposes the same settings as parameter-group values.",
      },
      {
        id: "dbm-logging-verify",
        titleKey: "ingestion.setupCard.dbmPgLoggingVerifyTitle",
        descriptionKey: "ingestion.setupCard.dbmPgLoggingVerifyDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        code: { lang: "sql", raw: PG_DBM_LOGGING_VERIFY_SQL },
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
      },
      {
        id: "dbm-run",
        titleKey: "ingestion.setupCard.dbmRunTitle",
        descriptionKey: "ingestion.setupCard.dbmRunPostgresDesc",
        chip: { kind: "run", labelKey: "ingestion.setupCard.chipRun" },
        completeOn: "copy",
        code: {
          lang: "bash",
          raw: "PGUSER='myuser' PGPASS='mypassword' \\\n  ./otelcol-contrib --config ./config.yaml --config ./dbm-config.yaml",
        },
        note: "Two --config flags merge the metrics and database-monitoring pipelines into one collector.",
      },
      dbmVerifyStep(),
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
