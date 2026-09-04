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

// Cassandra data-source setup card. Follows the OpenObserve guide:
// https://openobserve.ai/blog/how-to-monitor-cassandra — Cassandra is scraped via
// the JMX receiver (needs the OTel JMX metrics jar + JMX enabled on Cassandra).

import { raw, type TranslateFn } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { collectorInstallStep, writeConfigVariants } from "./otelShared";

const JMX_JAR = `wget https://github.com/open-telemetry/opentelemetry-java-contrib/releases/download/v1.32.0/opentelemetry-jmx-metrics.jar -O /opt/opentelemetry-java-contrib-jmx-metrics.jar`;

const CONFIG_YAML = `receivers:
  jmx:
    jar_path: /opt/opentelemetry-java-contrib-jmx-metrics.jar
    endpoint: {host}:{port}
    target_system: cassandra,jvm
    collection_interval: 60s

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
      receivers: [jmx]
      processors: [batch]
      exporters: [otlphttp/openobserve]`;

export default function cassandraCard(subs: CardSubstitutions, t: TranslateFn): RichCardContent {
  return {
    provider: {
      name: raw("Cassandra"),
      tagline: t("ingestion.setupCard.cassandraTagline"),
      logo: getImageURL("images/ingestion/cassandra.png"),
      tone: "#1287B1",
      metaBadges: [t("common.metrics")],
    },
    steps: [
      {
        id: "jmx-jar",
        titleKey: "ingestion.setupCard.downloadJmxJarTitle",
        descriptionKey: "ingestion.setupCard.downloadJmxJarDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        code: { lang: "bash", raw: JMX_JAR },
      },
      collectorInstallStep(t),
      {
        id: "configure",
        titleKey: "ingestion.setupCard.configureCollectorTitle",
        descriptionKey: "ingestion.setupCard.configureCollectorJmxDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        required: true,
        completeOn: "copy",
        variantGroup: "os",
        variantToggle: false,
        inputs: [
          {
            id: "host",
            labelKey: "ingestion.setupCard.jmxHostLabel",
            default: "localhost",
            placeholder: raw("localhost"),
          },
          {
            id: "port",
            labelKey: "ingestion.setupCard.jmxPortLabel",
            default: "9000",
            placeholder: raw("9000"),
            width: "sm",
          },
        ],
        variants: writeConfigVariants(CONFIG_YAML, subs),
        note: t("ingestion.setupCard.cassandraJmxNote"),
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
        descriptionKey: "ingestion.setupCard.verifyCassandraMetricsDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipMetrics" },
        completeOn: "detect",
        detectionAnchor: true,
        // What the verify step will show, in prose. These are NOT the ingested metric
        // names (those are cassandra.client.request.latency, cassandra.compaction.tasks.*,
        // jvm.gc.*, jvm.memory.heap.used) — they are a plain-English summary of them,
        // so they are translated.
        pills: [
          t("ingestion.setupCard.pillReadLatency"),
          t("ingestion.setupCard.pillWriteLatency"),
          t("ingestion.setupCard.pillCompactions"),
          t("ingestion.setupCard.pillGcPauses"),
          t("ingestion.setupCard.pillHeapUsage"),
        ],
      },
    ],
    detect: { streamType: "metrics", match: "keyword", streamName: "cassandra", filter: "" },
    docUrl: "https://openobserve.ai/blog/how-to-monitor-cassandra",
  };
}
