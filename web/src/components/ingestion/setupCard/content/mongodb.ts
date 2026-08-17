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

import { raw, type TranslateFn } from "@/types/i18n";

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

export default function mongodbCard(subs: CardSubstitutions, t: TranslateFn): RichCardContent {
  const tool = sharedToolIcons();
  return {
    provider: {
      name: raw("MongoDB"),
      tagline: t("ingestion.setupCard.mongodbTagline"),
      logo: getImageURL("images/ingestion/mongodb.svg"),
      tone: "#00ED64",
      metaBadges: [t("common.metrics")],
    },
    steps: [
      {
        id: "prepare",
        titleKey: "ingestion.setupCard.prepareMongodbTitle",
        descriptionKey: "ingestion.setupCard.prepareMongodbDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        variants: [
          {
            id: "mongosh",
            label: raw("mongosh"),
            icon: tool.terminal,
            code: {
              lang: "bash",
              raw: applyUser('mongosh "mongodb://localhost:27017"'),
            },
          },
          {
            id: "docker",
            label: raw("Docker"),
            icon: tool.docker,
            code: {
              lang: "bash",
              raw: applyUser("docker exec -i mongodb mongosh"),
            },
          },
          {
            id: "shell",
            label: raw("Compass Shell"),
            icon: getImageURL("images/ingestion/mongodb.svg"),
            code: { lang: "javascript", raw: USER_JS },
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
        variantGroup: "os",
        variantToggle: false,
        inputs: [
          {
            id: "host",
            labelKey: "ingestion.setupCard.mongodbHostLabel",
            default: "localhost",
            placeholder: raw("localhost"),
          },
          {
            id: "port",
            labelKey: "ingestion.setupCard.portLabel",
            default: "27017",
            placeholder: raw("27017"),
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
        descriptionKey: "ingestion.setupCard.verifyMongodbMetricsDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipMetrics" },
        completeOn: "detect",
        detectionAnchor: true,
        // What the verify step will show, in prose. These are NOT the receiver metric
        // names (those are mongodb.connection.count, mongodb.cursor.count, …) — they are
        // a plain-English summary of them, so they are translated.
        pills: [
          t("ingestion.setupCard.pillConnections"),
          t("ingestion.setupCard.pillOperations"),
          t("ingestion.setupCard.pillCacheHits"),
          t("ingestion.setupCard.pillCursors"),
          t("ingestion.setupCard.pillDocuments"),
        ],
      },
    ],
    detect: { streamType: "metrics", match: "keyword", streamName: "mongodb", filter: "" },
    docUrl: "https://openobserve.ai/blog/monitor-mongodb-metrics-otel",
  };
}
