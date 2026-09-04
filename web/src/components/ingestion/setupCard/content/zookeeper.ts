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

// Zookeeper data-source setup card. Follows the OpenObserve guide:
// https://openobserve.ai/blog/how-to-monitor-zookeeper-with-openteletemtry
// (zookeeper receiver). No monitoring user needed.

import { raw, type TranslateFn } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { collectorInstallStep, writeConfigVariants } from "./otelShared";

const CONFIG_YAML = `receivers:
  zookeeper:
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
      receivers: [zookeeper]
      exporters: [otlphttp/openobserve]`;

export default function zookeeperCard(subs: CardSubstitutions, t: TranslateFn): RichCardContent {
  return {
    provider: {
      name: raw("Zookeeper"),
      tagline: t("ingestion.setupCard.zookeeperTagline"),
      logo: getImageURL("images/ingestion/zookeeper.png"),
      tone: "#FF9900",
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
            labelKey: "ingestion.setupCard.zookeeperHostLabel",
            default: "localhost",
            placeholder: raw("localhost"),
          },
          {
            id: "port",
            labelKey: "ingestion.setupCard.portLabel",
            default: "2181",
            placeholder: raw("2181"),
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
        descriptionKey: "ingestion.setupCard.verifyZookeeperMetricsDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipMetrics" },
        completeOn: "detect",
        detectionAnchor: true,
        // These are Title-Cased prose, NOT the `mntr` stat names (the receiver emits
        // zookeeper.connection.active / zookeeper.request.active / zookeeper.watch.count /
        // zookeeper.znode.count), so they are translated. Shared pills reuse common keys.
        pills: [
          t("ingestion.setupCard.pillConnections"),
          t("ingestion.setupCard.pillLatency"),
          t("ingestion.setupCard.pillOutstandingRequests"),
          t("ingestion.setupCard.pillWatches"),
          t("ingestion.setupCard.pillZnodes"),
        ],
      },
    ],
    detect: { streamType: "metrics", match: "keyword", streamName: "zookeeper", filter: "" },
    docUrl: "https://openobserve.ai/blog/how-to-monitor-zookeeper-with-openteletemtry",
  };
}
