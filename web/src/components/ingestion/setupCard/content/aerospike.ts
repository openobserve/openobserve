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

import { raw, type TranslateFn } from "@/types/i18n";

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

export default function aerospikeCard(subs: CardSubstitutions, t: TranslateFn): RichCardContent {
  return {
    provider: {
      name: raw("Aerospike"),
      tagline: t("ingestion.setupCard.aerospikeTagline"),
      logo: getImageURL("images/ingestion/aerospike.svg"),
      tone: "#C22127",
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
            labelKey: "ingestion.setupCard.aerospikeHostLabel",
            default: "localhost",
            placeholder: raw("localhost"),
          },
          {
            id: "port",
            labelKey: "ingestion.setupCard.portLabel",
            default: "3000",
            placeholder: raw("3000"),
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
        descriptionKey: "ingestion.setupCard.verifyAerospikeMetricsDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipMetrics" },
        completeOn: "detect",
        detectionAnchor: true,
        // aerospike receiver metric groups (aerospike.namespace.*, aerospike.node.*,
        // …) — kept untranslated so the pills match the ingested metrics. "Memory" is
        // the exception: it is a plain word, and the identical pill already has a
        // shared key used by linux/macos/windows.
        pills: [
          t("ingestion.setupCard.pillNamespaces"),
          t("ingestion.setupCard.pillNodes"),
          t("ingestion.setupCard.pillMemory"),
          t("ingestion.setupCard.pillStorage"),
          t("ingestion.setupCard.pillConnections"),
        ],
      },
    ],
    detect: { streamType: "metrics", match: "keyword", streamName: "aerospike", filter: "" },
    docUrl: "https://openobserve.ai/blog/how-to-monitor-aerospike-database",
  };
}
