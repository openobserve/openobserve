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

// Aerospike data-source setup card. Follows the OpenObserve guide:
// https://openobserve.ai/blog/how-to-monitor-aerospike-database (aerospike
// receiver). No monitoring user needed for the basic setup.

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { collectorInstallStep, writeConfigVariants } from "./otelShared";

const CONFIG_YAML = `receivers:
  aerospike:
    endpoint: "{host}:{port}"

exporters:
  otlphttp/openobserve:
    endpoint: {url}/api/{org}
    headers:
      Authorization: Basic {token}
      stream-name: default

service:
  pipelines:
    metrics:
      receivers: [aerospike]
      exporters: [otlphttp/openobserve]`;

export default function aerospikeCard(subs: CardSubstitutions): RichCardContent {
  return {
    provider: {
      name: "Aerospike",
      tagline:
        "Collect Aerospike metrics with the OpenTelemetry Collector and ship them to OpenObserve.",
      logo: getImageURL("images/ingestion/aerospike.svg"),
      tone: "#C22127",
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
          { id: "host", label: "Aerospike Host", default: "localhost", placeholder: "localhost" },
          { id: "port", label: "Port", default: "3000", placeholder: "3000", width: "sm" },
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
        description: "Hit Test below, or check Streams for the `aerospike_*` metrics.",
        chip: { kind: "traces", label: "Metrics" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: ["Namespaces", "Nodes", "Memory", "Storage", "Connections"],
      },
    ],
    detect: { streamType: "metrics", match: "keyword", streamName: "aerospike", filter: "" },
    docUrl: "https://openobserve.ai/blog/how-to-monitor-aerospike-database",
  };
}
