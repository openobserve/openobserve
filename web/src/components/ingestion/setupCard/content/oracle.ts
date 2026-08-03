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

// Oracle DB data-source setup card. Follows the OpenObserve doc:
// https://openobserve.ai/docs/integration/database/oracle/ (oracledb receiver).

import { raw } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { collectorInstallStep, writeConfigVariants } from "./otelShared";

const GRANT_SQL = `CREATE USER otel IDENTIFIED BY password123;
GRANT CONNECT, RESOURCE TO otel;
GRANT SELECT ON V_$SESSION TO otel;
GRANT SELECT ON V_$SYSSTAT TO otel;
GRANT SELECT ON V_$RESOURCE_LIMIT TO otel;
GRANT SELECT ON DBA_TABLESPACES TO otel;
GRANT SELECT ON DBA_DATA_FILES TO otel;
GRANT SELECT ON DBA_TABLESPACE_USAGE_METRICS TO otel;`;

const CONFIG_YAML = `receivers:
  oracledb:
    endpoint: {host}:{port}
    username: otel
    password: password123
    service: XE
    collection_interval: 30s
    timeout: 10s

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
      receivers: [oracledb]
      processors: [batch]
      exporters: [otlphttp/openobserve]`;

export default function oracleCard(subs: CardSubstitutions): RichCardContent {
  return {
    provider: {
      name: "Oracle",
      tagline:
        "Collect Oracle DB metrics with the OpenTelemetry Collector and ship them to OpenObserve.",
      logo: getImageURL("images/ingestion/oracle.svg"),
      tone: "#F80000",
      metaBadges: ["Metrics"],
    },
    steps: [
      {
        id: "prepare",
        titleKey: "ingestion.setupCard.prepareOracleTitle",
        descriptionKey: "ingestion.setupCard.prepareOracleDesc",
        chip: { kind: "editor", label: raw("grant.sql") },
        completeOn: "copy",
        code: { lang: "sql", filename: "grant.sql", raw: GRANT_SQL },
      },
      collectorInstallStep(),
      {
        id: "configure",
        titleKey: "ingestion.setupCard.configureCollectorTitle",
        descriptionKey: "ingestion.setupCard.configureCollectorDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        required: true,
        completeOn: "copy",
        variantGroup: "os",
        variantToggle: false,
        inputs: [
          {
            id: "host",
            labelKey: "ingestion.setupCard.oracleHostLabel",
            default: "localhost",
            placeholder: raw("localhost"),
          },
          {
            id: "port",
            labelKey: "ingestion.setupCard.portLabel",
            default: "1521",
            placeholder: raw("1521"),
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
        descriptionKey: "ingestion.setupCard.verifyOracledbMetricsDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipMetrics" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: ["Sessions", "System Stats", "Tablespace Usage", "Data Files", "Resource Limits"],
      },
    ],
    detect: { streamType: "metrics", match: "keyword", streamName: "oracledb", filter: "" },
    docUrl: "https://openobserve.ai/docs/integration/database/oracle/",
  };
}
