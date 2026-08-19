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

// Snowflake data-source setup card. Follows the OpenObserve guide:
// https://openobserve.ai/blog/how-to-monitor-snowflake-with-opentelemetry-receiver
// The snowflake receiver is account-based (no host/port) and the guide pins the
// collector to v0.92.0 (newer builds have a known float→int conversion bug).

import { raw, type TranslateFn } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { collectorInstallStep, writeConfigVariants } from "./otelShared";

const SNOWFLAKE_COLLECTOR_VERSION = "0.92.0";

// Angle-bracket placeholders are edited inline by the user (the {url}/{org}/{token}
// braces are substituted per-org).
const CONFIG_YAML = `receivers:
  snowflake:
    username: <SNOWFLAKE_USER>
    password: <PASSWORD>
    account: <accountName>.<accountRegion>
    warehouse: <WAREHOUSE>
    role: <ROLE_OF_SNOWFLAKE>
    schema: ACCOUNT_USAGE
    database: SNOWFLAKE
    collection_interval: 5m

exporters:
  otlphttp/openobserve:
    endpoint: {url}/api/{org}
    headers:
      Authorization: Basic {token}
      stream-name: default

service:
  pipelines:
    metrics:
      receivers: [snowflake]
      exporters: [otlphttp/openobserve]`;

export default function snowflakeCard(subs: CardSubstitutions, t: TranslateFn): RichCardContent {
  return {
    provider: {
      name: raw("Snowflake"),
      tagline: t("ingestion.setupCard.snowflakeTagline"),
      logo: getImageURL("images/ingestion/snowflake.svg"),
      tone: "#29B5E8",
      metaBadges: [t("common.metrics")],
    },
    steps: [
      collectorInstallStep(t, SNOWFLAKE_COLLECTOR_VERSION),
      {
        id: "configure",
        titleKey: "ingestion.setupCard.configureCollectorTitle",
        descriptionKey: "ingestion.setupCard.configureCollectorSnowflakeDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        required: true,
        completeOn: "copy",
        variantGroup: "os",
        variantToggle: false,
        variants: writeConfigVariants(CONFIG_YAML, subs),
        note: t("ingestion.setupCard.snowflakeCollectorVersionNote"),
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
        descriptionKey: "ingestion.setupCard.verifySnowflakeMetricsDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipMetrics" },
        completeOn: "detect",
        detectionAnchor: true,
        // What the verify step will show, in prose. These are NOT the ingested metric
        // names (those are snowflake.storage.storage_bytes.total, snowflake.billing.*,
        // snowflake.logins.total, …) — they are a plain-English summary of them, so
        // they are translated.
        pills: [
          t("ingestion.setupCard.pillStorageBytes"),
          t("ingestion.setupCard.pillQueryCount"),
          t("ingestion.setupCard.pillBillingCredits"),
          t("ingestion.setupCard.pillLogins"),
          t("ingestion.setupCard.pillWarehouseUsage"),
        ],
      },
    ],
    detect: { streamType: "metrics", match: "keyword", streamName: "snowflake", filter: "" },
    docUrl: "https://openobserve.ai/blog/how-to-monitor-snowflake-with-opentelemetry-receiver",
  };
}
