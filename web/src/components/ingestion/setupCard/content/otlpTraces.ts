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

import config from "@/aws-exports";
import { getImageURL } from "@/utils/zincutils";
import type {
  CardSubstitutions,
  RichCardContent,
  RichCardStepVariant,
} from "../types";
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

export default function otlpTracesCard(
  subs: CardSubstitutions,
): RichCardContent {
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
      label: "Collector · OTLP HTTP",
      icon: getImageURL("images/ingestion/otlp.svg"),
      code: { ...code(HTTP_YAML), filename: "config.yaml" },
      note: "The default for the OpenTelemetry Collector — works everywhere, including behind proxies and load balancers.",
    },
    {
      id: "sdk",
      label: "SDK (No Collector)",
      icon: getImageURL("images/rum/events/terminal.png"),
      code: code(SDK_ENV, "bash"),
      note: "Standard OTEL_* environment variables — every OpenTelemetry SDK reads these, so no code change is needed.",
    },
  ];

  // gRPC is self-hosted only.
  if (!isCloud) {
    variants.splice(1, 0, {
      id: "grpc",
      label: "Collector · OTLP gRPC",
      icon: getImageURL("images/ingestion/otlp.svg"),
      code: { ...code(grpcYaml(host, insecure)), filename: "config.yaml" },
      note: "Lower overhead than HTTP for high span volumes. Port 5081 must be reachable from the collector.",
    });
  }

  return {
    provider: {
      name: "Traces (OpenTelemetry)",
      tagline:
        "Point any OpenTelemetry exporter at OpenObserve — collector or SDK, HTTP or gRPC. Your endpoint and token are filled in below.",
      logo: getImageURL("images/ingestion/otlp.svg"),
      tone: "#f5a800",
      runtime: "Any",
      setupTime: "~2 min",
      metaBadges: ["Traces"],
    },
    steps: [
      {
        id: "configure",
        title: "Point Your Exporter at OpenObserve",
        description:
          "Add this to your collector config, or set the environment variables if your app exports directly. Everything is already filled in for this organization.",
        chip: { kind: "editor", label: "Editor" },
        required: true,
        completeOn: "copy",
        variants,
      },
      {
        id: "verify",
        title: "Verify Data in OpenObserve",
        description:
          "Restart the collector (or your app), exercise a request that produces a span, then hit Test.",
        chip: { kind: "traces", label: "Traces" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: ["Spans", "Service Map", "Latency", "Errors"],
      },
    ],
    streamInput: {
      label: "Traces Stream Name",
      default: "default",
      placeholder: "default",
      help: "Written into the config above as `stream-name`, and watched by the check below.",
    },
    // Every span carries a trace id, so any row on the target stream proves the
    // exporter is wired up correctly.
    detect: {
      streamType: "traces",
      streamName: "default",
      filter: "trace_id IS NOT NULL",
    },
    extras: {
      fixTitle: "Check The Exporter Is Actually Wired Into The Pipeline",
      fixBody:
        "Defining an exporter is not enough — it has to be listed in a pipeline. This is the single most common reason a correct-looking config sends nothing:",
      fixLang: "yaml",
      fixSnippet: `service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlphttp/openobserve]   # <- must be listed here`,
      troubleshooting: [
        {
          q: "The collector logs 401 or 403",
          a: "The `Authorization` header must be `Basic <token>` using this organization's ingestion token — the value above is already correct. If it was rotated, re-copy from this page.",
        },
        {
          q: "Spans arrive but land in the wrong stream",
          a: "The `stream-name` header decides the stream. Set it to the same name as the field above, otherwise the check below watches a stream nothing is written to.",
        },
        {
          q: "gRPC connection fails with a TLS error",
          a: `The \`tls.insecure\` flag must match the endpoint's scheme — it is set to \`${insecure}\` above based on this deployment's URL. A plain-HTTP endpoint needs \`insecure: true\`; an HTTPS one needs \`false\`.`,
        },
        {
          q: "Should I use HTTP or gRPC?",
          a: "HTTP is the safe default and traverses proxies and load balancers cleanly. gRPC has lower overhead at high span volume but needs port 5081 reachable end to end.",
        },
      ],
    },
    docUrl:
      "https://openobserve.ai/docs/user-guide/data-sources-ingestion/traces/opentelemetry/",
  };
}
