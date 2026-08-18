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
//
// Based on a VERIFIED local run: the two grants below let the OTel `sqlserver`
// receiver connect, the single-receiver config exports, and `sqlserver_*` metric
// streams land in OpenObserve. Reference: https://openobserve.ai/blog/monitor-sql-server-with-otel/

import { raw, type TranslateFn } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { collectorInstallStep, writeConfigVariants, sharedToolIcons } from "./otelShared";

// Step 1 — the monitoring login + the grants the receiver actually needs
// (verified). On SQL Server 2019 and older, VIEW SERVER STATE replaces
// VIEW SERVER PERFORMANCE STATE. The login name/password are literals here and in
// the collector config so the two stay in lockstep — users edit them inline.
const GRANT_SQL = `USE master;
CREATE LOGIN otel WITH PASSWORD = 'YourStrong@Passw0rd';
GRANT VIEW SERVER PERFORMANCE STATE TO otel;
GRANT VIEW ANY DATABASE TO otel;`;

// The grants run INSIDE SQL Server, not the shell — Step 1 offers runnable client
// commands (sqlcmd / Docker) that pipe the SQL in via -Q (the SQL's own quotes are
// single, so they nest inside the double-quoted -Q value).
const applyGrants = (connect: string) => `${connect} -Q "
${GRANT_SQL}
"`;

// Single-receiver config. Only the exporter endpoint + token are substituted
// per-org; {server}/{port} are filled live from the configure step's inputs.
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
      metaBadges: [t("common.metrics")],
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
        // What the verify step will show, in prose. These are NOT the performance-counter
        // names that land in the streams (those are sqlserver.user.connection.count,
        // sqlserver.batch.request.rate, …) — they are a plain-English summary of them,
        // so they are translated.
        pills: [
          t("ingestion.setupCard.pillUserConnections"),
          t("ingestion.setupCard.pillBatchRequestRate"),
          t("ingestion.setupCard.pillSqlCompilationRate"),
          t("ingestion.setupCard.pillLockWaitRate"),
          t("ingestion.setupCard.pillBufferCacheHitRatio"),
        ],
      },
    ],
    // Metrics fan out into one stream per metric (sqlserver_user_connection_count,
    // …) — match by keyword: any metrics stream containing "sqlserver" = flowing.
    detect: { streamType: "metrics", match: "keyword", streamName: "sqlserver", filter: "" },
    docUrl: "https://openobserve.ai/blog/monitor-sql-server-with-otel/",
  };
}
