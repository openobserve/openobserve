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

export default function cassandraCard(subs: CardSubstitutions): RichCardContent {
  return {
    provider: {
      name: "Cassandra",
      tagline:
        "Collect Cassandra metrics via the OpenTelemetry Collector's JMX receiver and ship them to OpenObserve.",
      logo: getImageURL("images/ingestion/cassandra.png"),
      tone: "#1287B1",
      metaBadges: ["Metrics"],
    },
    steps: [
      {
        id: "jmx-jar",
        title: "Download the JMX Metrics Jar",
        description: "The JMX receiver runs this helper jar (requires Java on the collector host).",
        chip: { kind: "terminal", label: "Terminal" },
        completeOn: "copy",
        code: { lang: "bash", raw: JMX_JAR },
      },
      collectorInstallStep(),
      {
        id: "configure",
        title: "Configure the OpenTelemetry Collector",
        description: "Writes `config.yaml` — set the JMX host/port below.",
        chip: { kind: "terminal", label: "Terminal" },
        required: true,
        completeOn: "copy",
        variantGroup: "os",
        variantToggle: false,
        inputs: [
          { id: "host", label: "JMX Host", default: "localhost", placeholder: "localhost" },
          { id: "port", label: "JMX Port", default: "9000", placeholder: "9000", width: "sm" },
        ],
        variants: writeConfigVariants(CONFIG_YAML, subs),
        note: "Enable JMX remote access on Cassandra for the receiver to connect.",
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
        description: "Hit Test below, or check Streams for the `cassandra_*` metrics.",
        chip: { kind: "traces", label: "Metrics" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: ["Read Latency", "Write Latency", "Compactions", "GC Pauses", "Heap Usage"],
      },
    ],
    detect: { streamType: "metrics", match: "keyword", streamName: "cassandra", filter: "" },
    docUrl: "https://openobserve.ai/blog/how-to-monitor-cassandra",
  };
}
