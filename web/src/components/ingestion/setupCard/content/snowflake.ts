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

export default function snowflakeCard(subs: CardSubstitutions): RichCardContent {
  return {
    provider: {
      name: "Snowflake",
      tagline:
        "Collect Snowflake account metrics with the OpenTelemetry Collector and ship them to OpenObserve.",
      logo: getImageURL("images/ingestion/snowflake.svg"),
      tone: "#29B5E8",
      metaBadges: ["Metrics"],
    },
    steps: [
      collectorInstallStep(SNOWFLAKE_COLLECTOR_VERSION),
      {
        id: "configure",
        title: "Configure the OpenTelemetry Collector",
        description: "Writes `config.yaml` — replace the `<…>` values inline.",
        chip: { kind: "terminal", label: "Terminal" },
        required: true,
        completeOn: "copy",
        variantGroup: "os",
        variantToggle: false,
        variants: writeConfigVariants(CONFIG_YAML, subs),
        note: "Snowflake needs collector v0.92.0 — newer builds have a known bug.",
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
        description: "Hit Test below, or check Streams for the `snowflake_*` metrics.",
        chip: { kind: "traces", label: "Metrics" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: ["Storage Bytes", "Query Count", "Billing Credits", "Logins", "Warehouse Usage"],
      },
    ],
    detect: { streamType: "metrics", match: "keyword", streamName: "snowflake", filter: "" },
    docUrl: "https://openobserve.ai/blog/how-to-monitor-snowflake-with-opentelemetry-receiver",
  };
}
