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

export default function sqlServerCard(subs: CardSubstitutions): RichCardContent {
  const tool = sharedToolIcons();
  return {
    provider: {
      name: "SQL Server",
      tagline:
        "Collect SQL Server metrics with the OpenTelemetry Collector and ship them to OpenObserve.",
      logo: getImageURL("images/ingestion/sqlserver.png"),
      tone: "#cc2927",
      metaBadges: ["Metrics"],
    },
    steps: [
      {
        id: "prepare",
        title: "Prepare SQL Server",
        description: "Create the monitoring login — run it in a SQL client, **not** your shell.",
        chip: { kind: "terminal", label: "Terminal" },
        completeOn: "copy",
        variants: [
          {
            id: "sqlcmd",
            label: "sqlcmd",
            icon: tool.terminal,
            code: {
              lang: "bash",
              raw: applyGrants('sqlcmd -S localhost,1433 -U sa -P "YOUR_SA_PASSWORD" -C'),
            },
            note: "Replace YOUR_SA_PASSWORD.",
          },
          {
            id: "docker",
            label: "Docker",
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
            label: "SQL Client (GUI)",
            icon: getImageURL("images/ingestion/sqlserver.png"),
            code: { lang: "sql", raw: GRANT_SQL },
          },
        ],
      },
      collectorInstallStep(),
      {
        id: "configure",
        title: "Configure the OpenTelemetry Collector",
        description: "Writes `config.yaml` — set the host/port below.",
        chip: { kind: "terminal", label: "Terminal" },
        required: true,
        completeOn: "copy",
        // No own toggle — follow the OS picked at the install step.
        variantGroup: "os",
        variantToggle: false,
        // Host/port fields fill {server}/{port} in the config reactively.
        inputs: [
          {
            id: "server",
            label: "SQL Server Host",
            default: "localhost",
            placeholder: "localhost",
          },
          {
            id: "port",
            label: "Port",
            default: "1433",
            placeholder: "1433",
            width: "sm",
          },
        ],
        variants: writeConfigVariants(CONFIG_YAML, subs),
      },
      {
        id: "run",
        title: "Run the OpenTelemetry Collector",
        description: "Start the collector.",
        chip: { kind: "run", label: "Run" },
        completeOn: "copy",
        code: { lang: "bash", raw: "./otelcol-contrib --config ./config.yaml" },
      },
      {
        id: "verify",
        title: "Verify Data in OpenObserve",
        description: "Hit Test below, or check Streams for the `sqlserver_*` metrics.",
        chip: { kind: "traces", label: "Metrics" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: [
          "User Connections",
          "Batch Request Rate",
          "SQL Compilation Rate",
          "Lock Wait Rate",
          "Buffer Cache Hit Ratio",
        ],
      },
    ],
    // Metrics fan out into one stream per metric (sqlserver_user_connection_count,
    // …) — match by keyword: any metrics stream containing "sqlserver" = flowing.
    detect: { streamType: "metrics", match: "keyword", streamName: "sqlserver", filter: "" },
    docUrl: "https://openobserve.ai/blog/monitor-sql-server-with-otel/",
  };
}
