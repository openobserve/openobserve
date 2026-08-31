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

import { raw, type TranslateFn } from "@/types/i18n";

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

export default function oracleCard(subs: CardSubstitutions, t: TranslateFn): RichCardContent {
  return {
    provider: {
      name: raw("Oracle"),
      tagline: t("ingestion.setupCard.oracleTagline"),
      logo: getImageURL("images/ingestion/oracle.svg"),
      tone: "#F80000",
      metaBadges: [t("common.metrics")],
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
      collectorInstallStep(t),
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
        // What the verify step will show, in prose. These are NOT the data-dictionary
        // view names granted above (those are V$SESSION, V$SYSSTAT,
        // DBA_TABLESPACE_USAGE_METRICS, DBA_DATA_FILES, V$RESOURCE_LIMIT) — they are a
        // plain-English summary of them, so they are translated.
        pills: [
          t("ingestion.setupCard.pillSessions"),
          t("ingestion.setupCard.pillSystemStats"),
          t("ingestion.setupCard.pillTablespaceUsage"),
          t("ingestion.setupCard.pillDataFiles"),
          t("ingestion.setupCard.pillResourceLimits"),
        ],
      },
    ],
    detect: { streamType: "metrics", match: "keyword", streamName: "oracledb", filter: "" },
    docUrl: "https://openobserve.ai/docs/integration/database/oracle/",
  };
}
