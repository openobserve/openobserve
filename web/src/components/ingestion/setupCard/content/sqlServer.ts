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

// SQL Server data-source setup card. Shared collector scaffolding (install +
// write-config command) comes from ./otelShared; this file holds the SQL Server
// specifics (grant SQL, receiver config, detection).

import { raw, type TranslateFn } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { collectorInstallStep, writeConfigVariants, sharedToolIcons } from "./otelShared";
import {
  DBM_CONTRIB_VERSION,
  MSSQL_DBM_CONFIG_YAML,
  MSSQL_DBM_GRANT_SQL,
  dbmVerifyStep,
} from "./dbmShared";

// Step 1 — the monitoring login and the grants the receiver needs. On SQL
// Server 2019 and older, VIEW SERVER STATE replaces VIEW SERVER PERFORMANCE
// STATE. The login name/password are literals here and in the collector config
// so the two stay in lockstep.
const GRANT_SQL = `USE master;
CREATE LOGIN otel WITH PASSWORD = 'YourStrong@Passw0rd';
GRANT VIEW SERVER PERFORMANCE STATE TO otel;
GRANT VIEW ANY DATABASE TO otel;`;

const applyGrants = (connect: string) => `${connect} -Q "
${GRANT_SQL}
"`;

// Only the exporter endpoint + token are substituted per-org; {server}/{port}
// are filled live from the configure step's inputs.
const CONFIG_YAML = `receivers:
  sqlserver:
    collection_interval: 10s
    username: otel
    password: "YourStrong@Passw0rd"
    server: {server}
    port: {port}

processors:
  batch:

exporters:
  otlphttp/openobserve:
    endpoint: {url}/api/{org}
    headers:
      Authorization: Basic {token}
      stream-name: default

service:
  pipelines:
    metrics:
      receivers: [sqlserver]
      processors: [batch]
      exporters: [otlphttp/openobserve]`;

export default function sqlServerCard(subs: CardSubstitutions, t: TranslateFn): RichCardContent {
  const tool = sharedToolIcons();
  return {
    provider: {
      name: raw("SQL Server"),
      tagline: t("ingestion.setupCard.sqlServerTagline"),
      logo: getImageURL("images/ingestion/sqlserver.png"),
      tone: "#cc2927",
      // Logs too: the optional Database Monitoring steps ship blocking-chain
      // samples into the dbm_server logs stream.
      metaBadges: [t("common.metrics"), t("common.logs")],
    },
    steps: [
      {
        id: "prepare",
        titleKey: "ingestion.setupCard.prepareSqlServerTitle",
        descriptionKey: "ingestion.setupCard.prepareSqlServerDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        variants: [
          {
            id: "sqlcmd",
            label: raw("sqlcmd"),
            icon: tool.terminal,
            code: {
              lang: "bash",
              raw: applyGrants('sqlcmd -S localhost,1433 -U sa -P "YOUR_SA_PASSWORD" -C'),
            },
            note: t("ingestion.setupCard.sqlServerPasswordNote"),
          },
          {
            id: "docker",
            label: raw("Docker"),
            icon: tool.docker,
            code: {
              lang: "bash",
              raw: applyGrants(
                'docker exec -i sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "YOUR_SA_PASSWORD" -C',
              ),
            },
          },
          {
            id: "sql-client",
            labelKey: "ingestion.setupCard.sqlClientGuiVariant",
            icon: getImageURL("images/ingestion/sqlserver.png"),
            code: { lang: "sql", raw: GRANT_SQL },
          },
        ],
      },
      // Pinned so all four Tier-1 cards install the same collector.
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
        // Host/port fields fill {server}/{port} in the config reactively.
        inputs: [
          {
            id: "server",
            labelKey: "ingestion.setupCard.sqlServerHostLabel",
            default: "localhost",
            placeholder: raw("localhost"),
          },
          {
            id: "port",
            labelKey: "ingestion.setupCard.portLabel",
            default: "1433",
            placeholder: raw("1433"),
            width: "sm",
          },
        ],
        variants: writeConfigVariants(CONFIG_YAML, subs),
      },
      {
        id: "run",
        titleKey: "ingestion.setupCard.runCollectorTitle",
        descriptionKey: "ingestion.setupCard.runCollectorDesc",
        chip: { kind: "run", labelKey: "ingestion.setupCard.chipRun" },
        completeOn: "copy",
        code: { lang: "bash", raw: "./otelcol-contrib --config ./config.yaml" },
      },
      {
        id: "verify",
        titleKey: "ingestion.setupCard.verifyDataTitle",
        descriptionKey: "ingestion.setupCard.verifySqlserverMetricsDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipMetrics" },
        completeOn: "detect",
        detectionAnchor: true,
        // Plain-English summary, NOT the performance-counter names — so these
        // are translated.
        pills: [
          t("ingestion.setupCard.pillUserConnections"),
          t("ingestion.setupCard.pillBatchRequestRate"),
          t("ingestion.setupCard.pillSqlCompilationRate"),
          t("ingestion.setupCard.pillLockWaitRate"),
          t("ingestion.setupCard.pillBufferCacheHitRatio"),
        ],
      },
      // ── Database Monitoring (optional) ──────────────────────────────────
      // Every DBM tab this product has: deadlocks (shredded from the
      // system_health XML graph in T-SQL), Table health, and — from
      // sqlserverreceiver's events — Activity, Top queries AND the execution
      // plans, which ride on the same db.server.top_query event.
      {
        id: "dbm-grant",
        titleKey: "ingestion.setupCard.dbmPrepareMssqlTitle",
        descriptionKey: "ingestion.setupCard.dbmPrepareMssqlDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        variants: [
          {
            id: "sqlcmd",
            label: raw("sqlcmd"),
            icon: tool.terminal,
            code: {
              lang: "bash",
              raw: `sqlcmd -S localhost,1433 -U sa -P "YOUR_SA_PASSWORD" -C -Q "${MSSQL_DBM_GRANT_SQL}"`,
            },
            note: "VIEW SERVER STATE is what lets the collector read OTHER sessions in sys.dm_exec_requests. The metrics login's VIEW SERVER PERFORMANCE STATE is not enough — it exposes counters, not the session DMVs.",
          },
          {
            id: "docker",
            label: raw("Docker"),
            icon: tool.docker,
            code: {
              lang: "bash",
              raw: `docker exec -i sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "YOUR_SA_PASSWORD" -C -Q "${MSSQL_DBM_GRANT_SQL}"`,
            },
          },
          {
            id: "sql-client",
            labelKey: "ingestion.setupCard.sqlClientGuiVariant",
            icon: getImageURL("images/ingestion/sqlserver.png"),
            code: { lang: "sql", raw: MSSQL_DBM_GRANT_SQL },
          },
        ],
      },
      {
        id: "dbm-configure",
        titleKey: "ingestion.setupCard.dbmConfigureTitle",
        descriptionKey: "ingestion.setupCard.dbmConfigureMssqlDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        variantGroup: "os",
        variantToggle: false,
        inputs: [
          {
            id: "database",
            labelKey: "ingestion.setupCard.dbmDatabaseLabel",
            default: "master",
            placeholder: raw("master"),
          },
        ],
        variants: writeConfigVariants(MSSQL_DBM_CONFIG_YAML, subs).map((v) => ({
          ...v,
          code: {
            ...v.code,
            raw: v.code.raw.replace(/config\.yaml/g, "dbm-config.yaml"),
            masked: v.code.masked?.replace(/config\.yaml/g, "dbm-config.yaml"),
          },
        })),
        note: "Run this with the upstream OpenTelemetry Collector Contrib from the install step (verified at v0.158.0) — the OpenObserve collector build does not include the database receivers. Unlike Postgres and MySQL, every recipe here polls SQL views rather than tailing files, so they work on managed SQL Server (Amazon RDS, Azure SQL Managed Instance) — except Azure SQL Database, which does not provide sys.fn_xe_file_target_read_file, so deadlock capture degrades there while blocking still works. Activity, top queries and execution plans come from the sqlserver receiver, which reads across the whole instance rather than the one database above — the plans arrive with the top queries, on the same feed. Two honest limits on deadlock text: SQL Server records the client's whole batch, not just the statement that deadlocked, and stored-procedure workloads show up as the EXEC call rather than the statement inside the procedure. If you run the deadlock query yourself in sqlcmd, pass -I: it needs QUOTED_IDENTIFIER ON, which sqlcmd turns off by default (this config already sets it for the collector).",
      },
      {
        id: "dbm-run",
        titleKey: "ingestion.setupCard.dbmRunTitle",
        descriptionKey: "ingestion.setupCard.dbmRunMssqlDesc",
        chip: { kind: "run", labelKey: "ingestion.setupCard.chipRun" },
        completeOn: "copy",
        code: {
          lang: "bash",
          raw: "MSSQL_USER='otel' MSSQL_PASSWORD='YourStrong@Passw0rd' \\\n  ./otelcol-contrib --config ./config.yaml --config ./dbm-config.yaml",
        },
        note: "Two --config flags merge the metrics and database-monitoring pipelines into one collector.",
      },
      // "full" + table health: every tab this card's config can fill. The
      // mssql_table_stats / mssql_index_stats recipes run at
      // collection_interval: 60s, so the 60-second wording is true.
      dbmVerifyStep("full", true, "60s", "plain"),
    ],
    // Metrics fan out into one stream per metric — match by keyword: any
    // metrics stream containing "sqlserver" means data is flowing.
    detect: { streamType: "metrics", match: "keyword", streamName: "sqlserver", filter: "" },
    docUrl: "https://openobserve.ai/blog/monitor-sql-server-with-otel/",
  };
}
