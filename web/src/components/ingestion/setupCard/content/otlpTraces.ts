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

// OTLP traces setup card — the generic "point any OpenTelemetry exporter here"
// page. There is nothing to install: the user already has an SDK or collector,
// and needs the endpoint, the auth header and the stream name.
//
// The stream is a `streamInput`, so the name flows into the exporter config AND
// the live detection — they can never drift apart.

import { raw, type TranslateFn } from "@/types/i18n";

import config from "@/aws-exports";
import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent, RichCardStepVariant } from "../types";
import { applySubs, applySubsMasked } from "../subs";

// Collector exporter config. {stream} is filled live by the renderer.
const HTTP_YAML = `exporters:
  otlphttp/openobserve:
    endpoint: {url}/api/{org}
    headers:
      Authorization: Basic {token}
      stream-name: {stream}

service:
  pipelines:
    traces:
      exporters: [otlphttp/openobserve]`;

const grpcYaml = (host: string, insecure: boolean) => `exporters:
  otlp/openobserve:
    endpoint: ${host}:5081
    headers:
      Authorization: "Basic {token}"
      organization: {org}
      stream-name: {stream}
    tls:
      insecure: ${insecure}

service:
  pipelines:
    traces:
      exporters: [otlp/openobserve]`;

// Env vars for an SDK pointed straight at OpenObserve (no collector in between).
const SDK_ENV = `export OTEL_EXPORTER_OTLP_ENDPOINT="{url}/api/{org}"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic {token},stream-name={stream}"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"
export OTEL_SERVICE_NAME="my-service"`;

export default function otlpTracesCard(subs: CardSubstitutions, t: TranslateFn): RichCardContent {
  const isCloud = config.isCloud === "true";
  // The gRPC endpoint is a self-hosted port; cloud terminates HTTP only.
  const host = subs.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const insecure = !subs.url.startsWith("https://");

  const code = (tpl: string, lang = "yaml") => ({
    lang,
    raw: applySubs(tpl, subs),
    masked: applySubsMasked(tpl, subs),
  });

  const variants: RichCardStepVariant[] = [
    {
      id: "http",
      label: raw("Collector · OTLP HTTP"),
      icon: getImageURL("images/ingestion/otlp.svg"),
      code: { ...code(HTTP_YAML), filename: "config.yaml" },
      note: t("ingestion.setupCard.otlpHttpNote"),
    },
    {
      id: "sdk",
      label: raw("SDK (No Collector)"),
      icon: getImageURL("images/rum/events/terminal.png"),
      code: code(SDK_ENV, "bash"),
      note: t("ingestion.setupCard.otlpSdkEnvNote"),
    },
  ];

  // gRPC is self-hosted only.
  if (!isCloud) {
    variants.splice(1, 0, {
      id: "grpc",
      label: raw("Collector · OTLP gRPC"),
      icon: getImageURL("images/ingestion/otlp.svg"),
      code: { ...code(grpcYaml(host, insecure)), filename: "config.yaml" },
      note: t("ingestion.setupCard.otlpGrpcNote"),
    });
  }

  return {
    provider: {
      name: t("ingestion.setupCard.providerNameOtlpTraces"),
      tagline: t("ingestion.setupCard.taglineOtlpTraces"),
      logo: getImageURL("images/ingestion/otlp.svg"),
      tone: "#f5a800",
      runtime: t("ingestion.setupCard.runtimeAny"),
      setupTime: t("ingestion.setupCard.setupTime2Min"),
      metaBadges: [t("common.traces")],
    },
    steps: [
      {
        id: "configure",
        titleKey: "ingestion.setupCard.pointExporterTitle",
        descriptionKey: "ingestion.setupCard.pointExporterDesc",
        chip: { kind: "editor", labelKey: "ingestion.setupCard.chipEditor" },
        required: true,
        completeOn: "copy",
        variants,
      },
      {
        id: "verify",
        titleKey: "ingestion.setupCard.verifyDataTitle",
        descriptionKey: "ingestion.setupCard.verifyOtlpTracesDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipTraces" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: [
          t("ingestion.setupCard.pillSpans"),
          t("ingestion.setupCard.pillServiceMap"),
          t("ingestion.setupCard.pillLatency"),
          t("rum.errors"),
        ],
      },
    ],
    streamInput: {
      labelKey: "ingestion.setupCard.tracesStreamNameLabel",
      default: "default",
      placeholder: raw("default"),
      helpKey: "ingestion.setupCard.otlpTracesStreamHelp",
    },
    // Every span carries a trace id, so any row on the target stream proves the
    // exporter is wired up correctly.
    detect: {
      streamType: "traces",
      streamName: "default",
      filter: "trace_id IS NOT NULL",
    },
    extras: {
      fixTitle: t("ingestion.setupCard.otlpFixTitle"),
      fixBody: t("ingestion.setupCard.otlpFixBody"),
      fixLang: "yaml",
      fixSnippet: `service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlphttp/openobserve]   # <- must be listed here`,
      troubleshooting: [
        {
          q: t("ingestion.setupCard.otlpTrouble401Q"),
          a: t("ingestion.setupCard.otlpTrouble401A"),
        },
        {
          q: t("ingestion.setupCard.otlpTroubleStreamQ"),
          a: t("ingestion.setupCard.otlpTroubleStreamA"),
        },
        {
          q: t("ingestion.setupCard.otlpTroubleTlsQ"),
          a: t("ingestion.setupCard.otlpTroubleTlsA", { insecure }),
        },
        {
          q: t("ingestion.setupCard.otlpTroubleHttpGrpcQ"),
          a: t("ingestion.setupCard.otlpTroubleHttpGrpcA"),
        },
      ],
    },
    docUrl: "https://openobserve.ai/docs/user-guide/data-sources-ingestion/traces/opentelemetry/",
  };
}
