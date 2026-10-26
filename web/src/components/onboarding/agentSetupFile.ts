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

// The setup file a user hands to a coding agent. It is a file, like a code snippet, so it stays
// English. It never holds the token: every credential slot reads the O2_ACCESS_KEY variable.

import { scriptInstall } from "@/components/ingestion/setupCard/content/kubernetes";
import { install as linuxInstall } from "@/components/ingestion/setupCard/content/linux";
import { install as macosInstall } from "@/components/ingestion/setupCard/content/macos";
import { SDK_ENV } from "@/components/ingestion/setupCard/content/otlpTraces";
import { NPM_INSTALL } from "@/components/ingestion/setupCard/content/rum";
import { install as windowsInstall } from "@/components/ingestion/setupCard/content/windows";
import { applySubs } from "@/components/ingestion/setupCard/subs";
import type { SetupCardPresets } from "@/components/ingestion/setupCard/types";

export type AgentFocus = "auto" | "kubernetes" | "host" | "backend" | "llm" | "frontend" | "logs";

export interface AgentSetupContext {
  endpoint: string;
  org: string;
  stream: string;
  focus: AgentFocus;
  /** The tracing picked in onboarding, for a Kubernetes guide. */
  traces?: SetupCardPresets;
}

const KEY = "O2_ACCESS_KEY";
const FENCE = "```";

const code = (lang: string, body: string) => [`${FENCE}${lang}`, body, FENCE];

type Section = (c: { url: string; org: string; stream: string }) => string[];

// Backend and LLM share one exporter config, printed once after the setup sections.
const OTLP_TITLE = "OpenTelemetry exporter settings";

// The setup card commands, with the env var in the token slot, so the agent runs what the product shows.
const SECTIONS: Record<
  Exclude<AgentFocus, "auto">,
  { title: string; detect: string; body: Section }
> = {
  kubernetes: {
    title: "Kubernetes cluster",
    detect: "Kubernetes manifests, Helm charts or a kubectl context",
    body: ({ url, org }) => [
      "Install the OpenObserve collector in the cluster. It sends container logs, Kubernetes events, node and pod metrics, and traces.",
      "",
      "1. Find the cluster with `kubectl config current-context` and confirm with the user that it is the right one.",
      "2. Use that name for `<cluster-name>`. This installs into the cluster, so ask the user before you run:",
      "",
      ...code(
        "bash",
        applySubs(scriptInstall("--o2-url={url}"), { url, org, token: `"$${KEY}"` }).replaceAll(
          "{cluster}",
          "<cluster-name>",
        ),
      ),
    ],
  },
  host: {
    title: "Linux, macOS or Windows host",
    detect: "a server or VM the user wants to monitor, with no Kubernetes",
    body: ({ url, org }) => [
      "Install the OpenObserve agent as a service on the machine to monitor. It collects system logs and host metrics. It needs administrator rights, so ask the user before you run it.",
      "",
      "Linux:",
      "",
      ...code("bash", applySubs(linuxInstall, { url, org, token: `"$${KEY}"` })),
      "",
      "macOS:",
      "",
      ...code("bash", applySubs(macosInstall, { url, org, token: `"$${KEY}"` })),
      "",
      "Windows, in PowerShell as Administrator:",
      "",
      ...code("powershell", applySubs(windowsInstall, { url, org, token: `$env:${KEY}` })),
    ],
  },
  backend: {
    title: "Backend service (OpenTelemetry)",
    detect:
      "backend service code, such as package.json, requirements.txt, go.mod, pom.xml or a .csproj file",
    body: () => [
      `Add the OpenTelemetry SDK for the service's language, with automatic instrumentation where it exists. Export over OTLP HTTP with the settings in "${OTLP_TITLE}" below.`,
    ],
  },
  llm: {
    title: "LLM app",
    detect: "calls to an LLM SDK or framework",
    body: () => [
      `Add the OpenTelemetry SDK and the OpenTelemetry instrumentation for the LLM library the project uses, so each model call becomes a span with the model, token counts and latency. Export over OTLP HTTP with the settings in "${OTLP_TITLE}" below.`,
    ],
  },
  frontend: {
    title: "Web frontend",
    detect: "a web app that runs in the browser",
    body: ({ url, org }) => [
      `- Never put \`${KEY}\` in browser code. Anything sent to a browser is public.`,
      "- The browser SDK uses a separate RUM client token. Ask the user for it: OpenObserve shows it on its Real User Monitoring setup page.",
      "",
      ...code("bash", NPM_INSTALL),
      "",
      "Initialize `openobserveRum` and `openobserveLogs` when the app starts, with:",
      "",
      "- `clientToken`: the RUM client token from the user",
      "- `applicationId`: any string that names the app, for example `'web-application-id'`",
      `- \`site\`: \`${url.replace(/^https?:\/\//, "")}\``,
      `- \`organizationIdentifier\`: \`${org}\``,
      "- `apiVersion`: `'v1'`",
      `- \`insecureHTTP\`: \`${!url.startsWith("https://")}\``,
      "- `service`, `env` and `version`: the app's name, environment and version",
    ],
  },
  logs: {
    title: "Logs only",
    detect: "a log shipper config (for example Fluent Bit, Vector or an OpenTelemetry Collector)",
    body: ({ url, org, stream }) => [
      "If the project already runs a log shipper, add an HTTP output to it. Do not add a new agent.",
      "",
      `- URL: \`${url}/api/${org}/${stream}/_json\``,
      "- Method: `POST`, with a JSON array of records as the body",
      `- Header: \`Authorization: Basic $${KEY}\`, read from the environment`,
      "",
      "If no shipper runs, ask the user which files or services to collect from before you add one.",
    ],
  },
};

function otlpEnv({ url, org, stream }: { url: string; org: string; stream: string }): string[] {
  return [
    "Configure the exporter with these environment variables:",
    "",
    ...code(
      "bash",
      applySubs(SDK_ENV, { url, org, token: `$${KEY}` }).replaceAll("{stream}", stream),
    ),
    "",
    "- Set `OTEL_EXPORTER_OTLP_ENDPOINT` with no trailing slash. The SDK adds `/v1/traces` (and `/v1/metrics`, `/v1/logs`) itself.",
    "- Replace `my-service` with the service's name.",
    "- Set these where the service gets its environment (its run script, compose file or deployment), reading the key from the variable.",
  ];
}

// The tracing the user picked in onboarding, as the guide shows it; nothing when they skipped it.
function k8sTracing(traces: SetupCardPresets | undefined): string[] {
  if (traces?.traces === "ebpf") {
    return [
      "## Trace the apps in the cluster (eBPF)",
      "",
      "After the collector runs, turn on its eBPF tracing. It traces apps in any language with no code change. Ask the user which apps to trace (ports, executable paths or command lines) and follow:",
      "",
      "https://github.com/openobserve/openobserve-helm-chart/blob/main/charts/openobserve-collector/docs/traces.md#ebpf-tracing",
      "",
    ];
  }
  if (traces?.traces === "library" && traces.languages.length) {
    return [
      "## Trace the apps in the cluster (a library per language)",
      "",
      `The user picked: ${traces.languages.join(", ")}. For each language, ask the user which namespace runs those apps, annotate it, then restart the apps there once:`,
      "",
      ...code(
        "bash",
        traces.languages
          .map(
            (lang) =>
              `kubectl annotate namespace <${lang}-namespace> \\\n  instrumentation.opentelemetry.io/inject-${lang}="openobserve-collector/openobserve-${lang}"`,
          )
          .join("\n\n"),
      ),
      "",
    ];
  }
  return [];
}

/** A markdown file that tells a coding agent how to send this org's data to OpenObserve. */
export function buildAgentSetupFile(ctx: AgentSetupContext): string {
  const url = ctx.endpoint.replace(/\/+$/, "");
  const c = { url, org: ctx.org, stream: ctx.stream };
  const focuses = (Object.keys(SECTIONS) as Exclude<AgentFocus, "auto">[]).filter(
    (f) => ctx.focus === "auto" || f === ctx.focus,
  );

  const lines = [
    "# Set up OpenObserve for this project",
    "",
    "Send this project's telemetry to OpenObserve. Make the smallest change that works, then check that data arrives.",
    "",
    "## Connection",
    "",
    `- Endpoint: ${url}`,
    `- Organization: ${ctx.org}`,
    `- Stream: ${ctx.stream}`,
    `- Credential: the environment variable \`${KEY}\`. Send it as the header \`Authorization: Basic $${KEY}\`.`,
    "",
    `Never print, write or commit the value of \`${KEY}\`. Refer to it by name only. If it is not set, stop and ask the user to set it in their terminal and restart you. Check it without printing it:`,
    "",
    ...code("bash", `test -n "$${KEY}" && echo "${KEY} is set" || echo "${KEY} is missing"`),
    "",
    "## Rules",
    "",
    "- Ask the user before you change deployment files (Kubernetes manifests, Helm values, Dockerfiles, CI pipelines) or install anything.",
    "- Make the smallest change that works. Do not refactor code that the setup does not need.",
    `- Keep the key in the environment. Code and config read it by name, for example \`$${KEY}\` or \`process.env.${KEY}\`.`,
    "- If the project loads settings from a `.env` file, check that `.env` is in `.gitignore` before you add anything to it.",
    "- If a command fails, show the user the error and stop.",
    "",
  ];

  if (ctx.focus === "auto") {
    lines.push(
      "## What to set up",
      "",
      "Look at the project and pick the sections below that match:",
      "",
      ...focuses.map((f) => `- ${SECTIONS[f].detect}: "${SECTIONS[f].title}"`),
      "",
      "If more than one matches, tell the user what you found and ask which to set up first.",
      "",
    );
  }

  for (const f of focuses) {
    lines.push(`## ${SECTIONS[f].title}`, "", ...SECTIONS[f].body(c), "");
  }
  if (focuses.includes("kubernetes")) lines.push(...k8sTracing(ctx.traces));
  if (focuses.includes("backend") || focuses.includes("llm")) {
    lines.push(`## ${OTLP_TITLE}`, "", ...otlpEnv(c), "");
  }

  lines.push(
    "## Verify",
    "",
    "Send one test event:",
    "",
    ...code(
      "bash",
      [
        `curl -sS -X POST "${url}/api/${ctx.org}/${ctx.stream}/_json" \\`,
        `  -H "Authorization: Basic $${KEY}" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '[{"level":"info","message":"OpenObserve setup test event"}]' \\`,
        `  -w "\\nHTTP %{http_code}\\n"`,
      ].join("\n"),
    ),
    "",
    "Success is `HTTP 200` with a body whose `status[0].successful` is 1, for example:",
    "",
    ...code("json", `{"code":200,"status":[{"name":"${ctx.stream}","successful":1,"failed":0}]}`),
    "",
    "Any other result: show the user the status and the body, and stop.",
    "",
    "The OpenObserve setup page the user has open turns green by itself when the event arrives. This key can only send data, so do not call other OpenObserve APIs with it.",
    "",
    "## Report back",
    "",
    "Tell the user:",
    "",
    "- which files you changed,",
    "- which signals (logs, metrics, traces) are now sent, and to which stream,",
    "- how to turn it off again.",
  );

  return lines.join("\n");
}

/** One instruction line, then the file, to paste into any coding agent. */
export function buildAgentPrompt(ctx: AgentSetupContext): string {
  return `Set up OpenObserve for the project in this folder by following these instructions.\n\n${buildAgentSetupFile(ctx)}`;
}
