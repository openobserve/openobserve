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

// Redis data-source setup card. Follows the OpenObserve guide:
// https://openobserve.ai/blog/monitor-redis-metrics-otel
// Redis needs no monitoring user — the receiver connects with an optional AUTH
// password — so there is no "prepare" step.

import { raw, type TranslateFn } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { collectorInstallStep, writeConfigVariants } from "./otelShared";

const CONFIG_YAML = `receivers:
  redis:
    endpoint: "{host}:{port}"
    collection_interval: 10s
    password: \${env:REDIS_PASSWORD}

processors:
  batch:
    send_batch_size: 10000
    send_batch_max_size: 11000
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
      receivers: [redis]
      processors: [batch]
      exporters: [otlphttp/openobserve]`;

export default function redisCard(subs: CardSubstitutions, t: TranslateFn): RichCardContent {
  return {
    provider: {
      name: raw("Redis"),
      tagline: t("ingestion.setupCard.redisTagline"),
      logo: getImageURL("images/ingestion/redis.svg"),
      tone: "#DC382D",
      metaBadges: [t("common.metrics")],
    },
    steps: [
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
            labelKey: "ingestion.setupCard.redisHostLabel",
            default: "localhost",
            placeholder: raw("localhost"),
          },
          {
            id: "port",
            labelKey: "ingestion.setupCard.portLabel",
            default: "6379",
            placeholder: raw("6379"),
            width: "sm",
          },
        ],
        variants: writeConfigVariants(CONFIG_YAML, subs),
      },
      {
        id: "run",
        titleKey: "ingestion.setupCard.runCollectorTitle",
        descriptionKey: "ingestion.setupCard.runCollectorRedisDesc",
        chip: { kind: "run", labelKey: "ingestion.setupCard.chipRun" },
        completeOn: "copy",
        code: {
          lang: "bash",
          raw: "REDIS_PASSWORD='yourpassword' ./otelcol-contrib --config ./config.yaml",
        },
        note: t("ingestion.setupCard.redisNoAuthNote"),
      },
      {
        id: "verify",
        titleKey: "ingestion.setupCard.verifyDataTitle",
        descriptionKey: "ingestion.setupCard.verifyRedisMetricsDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipMetrics" },
        completeOn: "detect",
        detectionAnchor: true,
        // These are Title-Cased prose, NOT the ingested metric names (the receiver emits
        // redis.commands / redis.clients.connected / redis.keyspace.hits), so they are
        // translated. Shared pills like "Memory" reuse the key linux/macos/windows use.
        pills: [
          t("ingestion.setupCard.pillCommands"),
          t("ingestion.setupCard.pillMemory"),
          t("ingestion.setupCard.pillClients"),
          t("ingestion.setupCard.pillKeyspace"),
          t("ingestion.setupCard.pillHitRate"),
        ],
      },
    ],
    detect: { streamType: "metrics", match: "keyword", streamName: "redis", filter: "" },
    docUrl: "https://openobserve.ai/blog/monitor-redis-metrics-otel",
  };
}
