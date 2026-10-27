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

import {
  annotate,
  EBPF_UPGRADE,
  LANGUAGES,
  scriptInstall,
} from "@/components/ingestion/setupCard/content/kubernetes";
import { AGENTS_REPO } from "@/components/ingestion/setupCard/content/osAgent";
import { SDK_ENV } from "@/components/ingestion/setupCard/content/otlpTraces";
import { NPM_INSTALL } from "@/components/ingestion/setupCard/content/rum";
import { applySubs } from "@/components/ingestion/setupCard/subs";
import type { SetupCardPresets } from "@/components/ingestion/setupCard/types";

export type AgentFocus = "kubernetes" | "host" | "backend" | "llm" | "frontend" | "logs";

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

type Section = (c: {
  url: string;
  org: string;
  stream: string;
  traces?: SetupCardPresets;
}) => string[];

// Backend and LLM share one exporter config, printed after the setup section.
const OTLP_TITLE = "OpenTelemetry exporter settings";

// A temp folder: `curl -O` in the project would overwrite a project file named install.sh.
const unixInstall = (dir: "linux" | "mac", url: string, org: string) =>
  `tmp=$(mktemp -d) \\
  && curl -fsSL -o "$tmp/install.sh" ${AGENTS_REPO}/${dir}/install.sh \\
  && chmod +x "$tmp/install.sh" \\
  && sudo "$tmp/install.sh" ${url}/api/${org}/ "$${KEY}"`;

// The setup card commands, with the env var in the token slot, so the agent runs what the product shows.
const SECTIONS: Record<
  AgentFocus,
  {
    title: string;
    /** The data the setup page waits for, as the setup guide does; unset when the test event counts. */
    arrives?: string;
    body: Section;
  }
> = {
  kubernetes: {
    title: "Kubernetes cluster",
    arrives: "the cluster's container logs arrive",
    body: ({ url, org, traces }) => [
      `Install the OpenObserve collector in the cluster. It sends container logs, Kubernetes events${k8sTracing(traces).length ? ", node and pod metrics, and the traces of the apps set up below" : ", and node and pod metrics"}.`,
      "",
      "1. Run `kubectl config current-context` and confirm with the user that it is the right cluster.",
      "2. The context name is not the cluster name: on EKS it is an ARN, on GKE it is `gke_<project>_<zone>_<name>`. Suggest a short name for `<cluster-name>`, for example the part after the last `/` or `_`, and confirm it with the user. Every record carries this name.",
      "3. This installs into the cluster, so ask the user before you run:",
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
    arrives: "the machine's host metrics arrive",
    body: ({ url, org }) => [
      "Install the OpenObserve agent as a service on the machine to monitor. It collects system logs and host metrics.",
      "",
      `The installer needs \`sudo\` or an Administrator PowerShell, and you cannot type a password. Do not run it yourself: show the user the command for their system and ask them to run it in their own terminal, where \`${KEY}\` is set. Then run Verify. Each command downloads the installer into a temporary folder, never into the project.`,
      "",
      "Linux:",
      "",
      ...code("bash", unixInstall("linux", url, org)),
      "",
      "macOS:",
      "",
      ...code("bash", unixInstall("mac", url, org)),
      "",
      `Windows, in PowerShell as Administrator. This is a new window, so the user sets \`$env:${KEY}\` in it first:`,
      "",
      ...code(
        "powershell",
        [
          `$installer = "$env:TEMP\\o2-install.ps1"`,
          `Invoke-WebRequest -UseBasicParsing -Uri ${AGENTS_REPO}/windows/install.ps1 -OutFile $installer`,
          `powershell -ExecutionPolicy Bypass -File $installer -URL ${url}/api/${org}/ -AUTH_KEY $env:${KEY}`,
        ].join("\n"),
      ),
    ],
  },
  backend: {
    title: "Backend service (OpenTelemetry)",
    arrives: "the service's first trace arrives",
    body: () => [
      `Add the OpenTelemetry SDK for the service's language, with automatic instrumentation where it exists. Export over OTLP HTTP with the settings in "${OTLP_TITLE}" below.`,
    ],
  },
  llm: {
    title: "LLM app",
    arrives: "the app's first trace arrives",
    body: () => [
      `Add the OpenTelemetry SDK and the OpenTelemetry instrumentation for the LLM library the project uses, so each model call becomes a span with the model, token counts and latency. Export over OTLP HTTP with the settings in "${OTLP_TITLE}" below.`,
    ],
  },
  frontend: {
    title: "Web frontend",
    arrives: "the browser SDK sends its first page view",
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
    body: ({ url, org, stream }) => [
      "If the project already runs a log shipper, add an HTTP output to it. Do not add a new agent.",
      "",
      `- URL: \`${url}/api/${org}/${stream}/_json\``,
      "- Method: `POST`, with a JSON array of records as the body",
      `- Header: \`Authorization: Basic $${KEY}\`, with the key from the environment or a secret store (see Rules)`,
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
    `- If you set the endpoint in code, or with \`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT\`, give the full URL: \`${url}/api/${org}/v1/traces\`.`,
    "- Replace `my-service` with the service's name.",
    "- Set these where the service gets its environment (its run script, compose file or deployment), with the key from the variable or a secret store (see Rules).",
  ];
}

// The tracing the user picked in onboarding, as the guide shows it; nothing when they skipped it.
function k8sTracing(traces: SetupCardPresets | undefined): string[] {
  if (traces?.traces === "ebpf") {
    return [
      "## Trace the apps in the cluster (eBPF)",
      "",
      "After the collector runs, turn on its eBPF tracing. It traces apps in any language with no code change. Ask the user which apps to trace, by port, executable path or command line. Fill at least one list, comma-separated, for example `{8080,9000-9100}`. For a list the user leaves empty, use `--set ebpf.trace.<list>=null` instead. This changes the collector, so ask the user before you run:",
      "",
      ...code(
        "bash",
        EBPF_UPGRADE.replace(
          "{flags}",
          [
            "",
            "  --set-string 'ebpf.trace.ports={<ports>}'",
            "  --set-string 'ebpf.trace.exePaths={<executable-paths>}'",
            "  --set-string 'ebpf.trace.cmdLines={<command-lines>}'",
          ].join(" \\\n"),
        ),
      ),
      "",
      "Details and limits, such as the privileged pods eBPF needs:",
      "",
      "https://github.com/openobserve/openobserve-helm-chart/blob/main/charts/openobserve-collector/docs/traces.md#ebpf-tracing",
      "",
    ];
  }
  // The languages come from the URL, so only the card's own ids may reach a shell block.
  const langs =
    traces?.traces === "library"
      ? LANGUAGES.filter((l) => traces.languages.includes(l.id)).map((l) => l.id)
      : [];
  if (langs.length) {
    return [
      "## Trace the apps in the cluster (a library per language)",
      "",
      `The user picked: ${langs.join(", ")}. Each language needs its own namespace: if two languages share one, neither is traced. Ask the user which namespace runs each language's apps. The restart restarts every Deployment in that namespace, so ask the user before you run:`,
      "",
      ...code("bash", annotate(langs.map((id) => ({ id, namespace: `<${id}-namespace>` })))),
      "",
    ];
  }
  return [];
}

/** A markdown file that tells a coding agent how to send this org's data to OpenObserve. */
export function buildAgentSetupFile(ctx: AgentSetupContext): string {
  const url = ctx.endpoint.replace(/\/+$/, "");
  const c = { url, org: ctx.org, stream: ctx.stream, traces: ctx.traces };
  const ingestUrl = `${url}/api/${ctx.org}/${ctx.stream}/_json`;
  const testEvent = `[{"level":"info","message":"OpenObserve setup test event"}]`;
  const section = SECTIONS[ctx.focus];

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
    `Never print, write or commit the value of \`${KEY}\`. Refer to it by name only, and let the shell fill it in where it must be stored (see Rules). If it is not set, stop and ask the user to set it in their terminal and restart you. Check it without printing it:`,
    "",
    ...code("bash", `test -n "$${KEY}" && echo "${KEY} is set" || echo "${KEY} is missing"`),
    "",
    "In PowerShell:",
    "",
    ...code("powershell", `if ($env:${KEY}) { "${KEY} is set" } else { "${KEY} is missing" }`),
    "",
    "## Rules",
    "",
    "- Ask the user before you change deployment files (Kubernetes manifests, Helm values, Dockerfiles, CI pipelines) or install anything.",
    "- Make the smallest change that works. Do not refactor code that the setup does not need.",
    `- Code and config read the key by name, for example \`$${KEY}\` or \`process.env.${KEY}\`.`,
    `- A service, daemon, container, Kubernetes workload or CI job does not get the \`export\` from this terminal. Store the key in that platform's secret store and read it from there, for example \`kubectl create secret generic o2-access-key --from-literal=key="$${KEY}"\`. Never put the key in a Dockerfile, an image or a committed file.`,
    `- A \`.env\` file may hold the key only when \`.env\` is in \`.gitignore\`. Check that first, then add it with \`printf '${KEY}=%s\\n' "$${KEY}" >> .env\`.`,
    "- If a command fails, show the user the error and stop.",
    "",
  ];

  lines.push(`## ${section.title}`, "", ...section.body(c), "");
  if (ctx.focus === "kubernetes") lines.push(...k8sTracing(ctx.traces));
  if (ctx.focus === "backend" || ctx.focus === "llm") {
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
        `curl -sS -X POST "${ingestUrl}" \\`,
        `  -H "Authorization: Basic $${KEY}" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '${testEvent}' \\`,
        `  -w "\\nHTTP %{http_code}\\n"`,
      ].join("\n"),
    ),
    "",
    "In PowerShell, on one line:",
    "",
    ...code(
      "powershell",
      `Invoke-RestMethod -Method Post -Uri "${ingestUrl}" -Headers @{ Authorization = "Basic $env:${KEY}" } -ContentType "application/json" -Body '${testEvent}'`,
    ),
    "",
    "Success is `HTTP 200` with a body whose `status[0].successful` is 1, for example:",
    "",
    ...code("json", `{"code":200,"status":[{"name":"${ctx.stream}","successful":1,"failed":0}]}`),
    "",
    "`Invoke-RestMethod` prints only the body, and fails on any status other than 2xx. Any other result: show the user the status and the body, and stop.",
    "",
    !section.arrives
      ? `The OpenObserve setup page the user has open watches stream \`${ctx.stream}\`, so this test event can turn it green. The project's own logs arrive in the same stream.`
      : `The test event only proves that the key and the endpoint work. The OpenObserve setup page the user has open turns green when ${section.arrives}.`,
    "",
    "This key can only send data, so do not call other OpenObserve APIs with it.",
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
