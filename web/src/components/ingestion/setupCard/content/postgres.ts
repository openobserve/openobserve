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

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { collectorInstallStep, writeConfigVariants, sharedToolIcons } from "./otelShared";

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

export default function postgresCard(subs: CardSubstitutions): RichCardContent {
  const tool = sharedToolIcons();
  return {
    provider: {
      name: "Postgres",
      tagline:
        "Collect PostgreSQL metrics with the OpenTelemetry Collector and ship them to OpenObserve.",
      logo: getImageURL("images/ingestion/postgres.png"),
      tone: "#336791",
      metaBadges: ["Metrics"],
    },
    steps: [
      {
        id: "prepare",
        title: "Prepare PostgreSQL",
        description: "Create the monitoring role — run it in a SQL client, **not** your shell.",
        chip: { kind: "terminal", label: "Terminal" },
        completeOn: "copy",
        variants: [
          {
            id: "psql",
            label: "psql",
            icon: tool.terminal,
            code: {
              lang: "bash",
              raw: applyRole("psql -h localhost -U postgres"),
            },
            note: "Run as a Postgres superuser (psql prompts for its password).",
          },
          {
            id: "docker",
            label: "Docker",
            icon: tool.docker,
            code: {
              lang: "bash",
              raw: applyRole("docker exec -i postgres psql -U postgres"),
            },
          },
          {
            id: "sql-client",
            label: "SQL Client (GUI)",
            icon: getImageURL("images/ingestion/postgres.png"),
            code: { lang: "sql", raw: ROLE_SQL },
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
        // Host/port fields fill {host}/{port} in the config reactively.
        inputs: [
          {
            id: "host",
            label: "PostgreSQL Host",
            default: "localhost",
            placeholder: "localhost",
          },
          {
            id: "port",
            label: "Port",
            default: "5432",
            placeholder: "5432",
            width: "sm",
          },
        ],
        variants: writeConfigVariants(CONFIG_YAML, subs),
      },
      {
        id: "run",
        title: "Run the OpenTelemetry Collector",
        description: "Start the collector (the role's password via env var).",
        chip: { kind: "run", label: "Run" },
        completeOn: "copy",
        code: {
          lang: "bash",
          raw: "POSTGRESQL_PASSWORD='mypassword' ./otelcol-contrib --config ./config.yaml",
        },
      },
      {
        id: "verify",
        title: "Verify Data in OpenObserve",
        description: "Hit Test below, or check Streams for the `postgresql_*` metrics.",
        chip: { kind: "traces", label: "Metrics" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: ["Active Backends", "Commits", "Rollbacks", "Database Size", "Blocks Read"],
      },
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
