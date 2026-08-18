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
      metaBadges: [t("common.metrics")],
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
