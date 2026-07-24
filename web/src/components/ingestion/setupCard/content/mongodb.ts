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

// MongoDB data-source setup card. Follows the OpenObserve guide:
// https://openobserve.ai/blog/monitor-mongodb-metrics-otel (requires MongoDB 4.0+).

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { collectorInstallStep, writeConfigVariants, sharedToolIcons } from "./otelShared";

// The receiver authenticates as a user with clusterMonitor. Name/password are
// literal here and in the config so the two stay in lockstep.
const USER_JS = `db.getSiblingDB("admin").createUser({ user: "otel", pwd: "password123", roles: [{ role: "clusterMonitor", db: "admin" }] })`;

const applyUser = (connect: string) => `${connect} --eval '${USER_JS}'`;

const CONFIG_YAML = `receivers:
  mongodb:
    hosts:
      - endpoint: {host}:{port}
    username: otel
    password: password123
    collection_interval: 60s
    initial_delay: 1s
    tls:
      insecure: true
      insecure_skip_verify: true

processors:
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
      receivers: [mongodb]
      processors: [batch]
      exporters: [otlphttp/openobserve]`;

export default function mongodbCard(subs: CardSubstitutions): RichCardContent {
  const tool = sharedToolIcons();
  return {
    provider: {
      name: "MongoDB",
      tagline:
        "Collect MongoDB metrics with the OpenTelemetry Collector and ship them to OpenObserve.",
      logo: getImageURL("images/ingestion/mongodb.svg"),
      tone: "#00ED64",
      metaBadges: ["Metrics"],
    },
    steps: [
      {
        id: "prepare",
        title: "Prepare MongoDB",
        description:
          "Create a monitoring user with clusterMonitor — run it in mongosh, **not** your shell.",
        chip: { kind: "terminal", label: "Terminal" },
        completeOn: "copy",
        variants: [
          {
            id: "mongosh",
            label: "mongosh",
            icon: tool.terminal,
            code: {
              lang: "bash",
              raw: applyUser('mongosh "mongodb://localhost:27017"'),
            },
          },
          {
            id: "docker",
            label: "Docker",
            icon: tool.docker,
            code: {
              lang: "bash",
              raw: applyUser("docker exec -i mongodb mongosh"),
            },
          },
          {
            id: "shell",
            label: "Compass Shell",
            icon: getImageURL("images/ingestion/mongodb.svg"),
            code: { lang: "javascript", raw: USER_JS },
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
        variantGroup: "os",
        variantToggle: false,
        inputs: [
          { id: "host", label: "MongoDB Host", default: "localhost", placeholder: "localhost" },
          { id: "port", label: "Port", default: "27017", placeholder: "27017", width: "sm" },
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
        description: "Hit Test below, or check Streams for the `mongodb_*` metrics.",
        chip: { kind: "traces", label: "Metrics" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: ["Connections", "Operations", "Cache Hits", "Cursors", "Documents"],
      },
    ],
    detect: { streamType: "metrics", match: "keyword", streamName: "mongodb", filter: "" },
    docUrl: "https://openobserve.ai/blog/monitor-mongodb-metrics-otel",
  };
}
