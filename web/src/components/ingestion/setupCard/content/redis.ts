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

import { gt, raw } from "@/types/i18n";

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

export default function redisCard(subs: CardSubstitutions): RichCardContent {
  return {
    provider: {
      name: "Redis",
      tagline: gt("ingestion.setupCard.redisTagline"),
      logo: getImageURL("images/ingestion/redis.svg"),
      tone: "#DC382D",
      metaBadges: [gt("common.metrics")],
    },
    steps: [
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
        note: "Use REDIS_PASSWORD='' if Redis has no auth.",
      },
      {
        id: "verify",
        titleKey: "ingestion.setupCard.verifyDataTitle",
        descriptionKey: "ingestion.setupCard.verifyRedisMetricsDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipMetrics" },
        completeOn: "detect",
        detectionAnchor: true,
        // Redis INFO / redis-receiver stat names (redis.commands, redis.memory.used,
        // redis.clients.connected, redis.keyspace.hits …) — kept untranslated so the
        // pills match the ingested metrics.
        pills: [raw("Commands"), raw("Memory"), raw("Clients"), raw("Keyspace"), raw("Hit Rate")],
      },
    ],
    detect: { streamType: "metrics", match: "keyword", streamName: "redis", filter: "" },
    docUrl: "https://openobserve.ai/blog/monitor-redis-metrics-otel",
  };
}
