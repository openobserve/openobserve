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
      tagline:
        "Collect Redis metrics with the OpenTelemetry Collector and ship them to OpenObserve.",
      logo: getImageURL("images/ingestion/redis.svg"),
      tone: "#DC382D",
      metaBadges: ["Metrics"],
    },
    steps: [
      collectorInstallStep(),
      {
        id: "configure",
        title: "Configure the OpenTelemetry Collector",
        description: "Writes `config.yaml` — set the host/port below.",
        chip: { kind: "terminal", label: "Terminal" },
        required: true,
        completeOn: "copy",
        variantGroup: "os",
        variantToggle: false,
        inputs: [
          { id: "host", label: "Redis Host", default: "localhost", placeholder: "localhost" },
          { id: "port", label: "Port", default: "6379", placeholder: "6379", width: "sm" },
        ],
        variants: writeConfigVariants(CONFIG_YAML, subs),
      },
      {
        id: "run",
        title: "Run the OpenTelemetry Collector",
        description: "Start the collector (Redis AUTH password via env var).",
        chip: { kind: "run", label: "Run" },
        completeOn: "copy",
        code: {
          lang: "bash",
          raw: "REDIS_PASSWORD='yourpassword' ./otelcol-contrib --config ./config.yaml",
        },
        note: "Use REDIS_PASSWORD='' if Redis has no auth.",
      },
      {
        id: "verify",
        title: "Verify Data in OpenObserve",
        description: "Hit Test below, or check Streams for the `redis_*` metrics.",
        chip: { kind: "traces", label: "Metrics" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: ["Commands", "Memory", "Clients", "Keyspace", "Hit Rate"],
      },
    ],
    detect: { streamType: "metrics", match: "keyword", streamName: "redis", filter: "" },
    docUrl: "https://openobserve.ai/blog/monitor-redis-metrics-otel",
  };
}
