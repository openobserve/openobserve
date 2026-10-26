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

export type InstallPlatform = "linux" | "macos" | "windows" | "docker" | "kubernetes";

/** What the Helm chart runs: node agents (DaemonSet) or cluster gateways (StatefulSet). */
export type KubernetesRole = "agent" | "gateway";

export const KUBERNETES_ROLES: KubernetesRole[] = ["agent", "gateway"];

/** The gateway release's name, which is also its OTLP Service. */
export const GATEWAY_RELEASE = "otel-fleet-collector-gateway";

/** Environment every install command gives the collector. */
export const INSTALL_ENV = ["O2_ENDPOINT", "O2_TOKEN"];
/** Environment only the Helm chart adds, from the pod's downward API. */
export const HELM_ENV = ["K8S_NODE_NAME", "K8S_POD_NAME", "K8S_NAMESPACE"];

export const INSTALL_PLATFORMS: InstallPlatform[] = [
  "linux",
  "macos",
  "windows",
  "docker",
  "kubernetes",
];

export const PLATFORM_LABEL: Record<InstallPlatform, string> = {
  linux: "Linux",
  macos: "macOS",
  windows: "Windows",
  docker: "Docker",
  kubernetes: "Kubernetes",
};

export interface InstallTarget {
  baseUrl: string;
  org: string;
  token: string;
  /** The collector version to install; null lets the script pick its latest supported one. */
  version: string | null;
  /** HTTP polling for proxies that cannot carry WebSocket. */
  http: boolean;
  /** Kubernetes only; agents when unset. */
  role?: KubernetesRole;
}

const SCRIPT_BASE = "https://raw.githubusercontent.com/openobserve/agents/main";
const IMAGE = "o2cr.ai/openobserve/otel-fleet-collector";

/** The OpAMP endpoint the supervisor connects to; the scheme picks the transport. */
export function opampEndpoint(target: Pick<InstallTarget, "baseUrl" | "org" | "http">): string {
  const url = new URL(target.baseUrl);
  const secure = url.protocol === "https:";
  const scheme = target.http ? url.protocol.replace(":", "") : secure ? "wss" : "ws";
  return `${scheme}://${url.host}${url.pathname.replace(/\/+$/, "")}/api/${target.org}/v1/opamp`;
}

// Single quotes keep url, org and token literal in the user's shell.
const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

// One script serves Linux and macOS; it detects the OS and the service manager itself.
function unixCommand(t: InstallTarget): string {
  const args = [
    `--url ${q(t.baseUrl)}`,
    `--org ${q(t.org)}`,
    `--token ${q(t.token)}`,
    ...(t.version ? [`--version ${q(t.version)}`] : []),
    ...(t.http ? ["--transport http"] : []),
  ];
  return [
    `curl -fsSL ${SCRIPT_BASE}/fleet/install.sh | sudo bash -s -- \\`,
    ...args.map((a, i) => `  ${a}${i < args.length - 1 ? " \\" : ""}`),
  ].join("\n");
}

function windowsCommand(t: InstallTarget): string {
  const ps = (v: string) => `'${v.replace(/'/g, "''")}'`;
  const args = [
    `-Url ${ps(t.baseUrl)}`,
    `-Org ${ps(t.org)}`,
    `-Token ${ps(t.token)}`,
    ...(t.version ? [`-Version ${ps(t.version)}`] : []),
    ...(t.http ? ["-Transport http"] : []),
  ];
  return [
    `& ([scriptblock]::Create((irm ${SCRIPT_BASE}/fleet/install.ps1))) \``,
    ...args.map((a, i) => `  ${a}${i < args.length - 1 ? " `" : ""}`),
  ].join("\n");
}

// One release runs one role: its token enrols every pod into one fleet, and a fleet shares one configuration.
function helmCommand(t: InstallTarget): string {
  const gateway = t.role === "gateway";
  const sets = [
    ...(gateway ? ["--set agent.enabled=false", "--set gateway.enabled=true"] : []),
    `--set image.repository=${IMAGE}`,
    ...(t.version ? [`--set image.tag=${q(t.version)}`] : []),
    `--set opamp.endpoint=${q(opampEndpoint(t))}`,
    `--set opamp.token=${q(t.token)}`,
  ];
  return [
    "helm repo add openobserve https://charts.openobserve.ai && helm repo update",
    `helm upgrade --install ${gateway ? GATEWAY_RELEASE : "otel-fleet-collector"} openobserve/otel-fleet-collector \\`,
    "  --namespace openobserve-collector --create-namespace \\",
    ...sets.map((s, i) => `  ${s}${i < sets.length - 1 ? " \\" : ""}`),
  ].join("\n");
}

// A container cannot reach the host's loopback, so a local test points at host.docker.internal.
const DOCKER_HOST = "host.docker.internal";
function dockerReachable(url: string): string {
  return url.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/, `//${DOCKER_HOST}`);
}

/** A supervisor.yaml written next to the user, then one container with a named state volume. */
function dockerCommand(t: InstallTarget): string {
  const reachable = { ...t, baseUrl: dockerReachable(t.baseUrl) };
  const endpoint = opampEndpoint(reachable);
  const insecure = !reachable.baseUrl.startsWith("https:");
  const yaml = [
    "server:",
    `  endpoint: ${endpoint}`,
    "  headers:",
    '    Authorization: "Basic $AUTH"',
    ...(insecure ? ["  tls:", "    insecure: true"] : []),
    "capabilities:",
    "  accepts_remote_config: true",
    "  reports_effective_config: true",
    "  reports_health: true",
    "  reports_own_metrics: true",
    "  accepts_restart_command: true",
    "  reports_available_components: true",
    "agent:",
    "  executable: /usr/local/bin/otelcol-contrib",
    "  config_apply_timeout: 30s",
    "  env:",
    `    O2_ENDPOINT: ${reachable.baseUrl.replace(/\/+$/, "")}/api/${t.org}`,
    '    O2_TOKEN: "Basic $AUTH"',
    "storage:",
    "  directory: /var/lib/opampsupervisor",
  ];
  return [
    `AUTH=$(printf 'fleet:%s' ${q(t.token)} | base64 | tr -d '\\n')`,
    "mkdir -p otel-fleet && cat > otel-fleet/supervisor.yaml <<EOF",
    ...yaml,
    "EOF",
    "docker run -d --name otel-fleet-collector --restart unless-stopped \\",
    '  --hostname "$(hostname)" \\',
    '  -v "$PWD/otel-fleet/supervisor.yaml:/etc/opampsupervisor/supervisor.yaml:ro" \\',
    "  -v otel-fleet-state:/var/lib/opampsupervisor \\",
    `  ${IMAGE}:${t.version ?? "latest"}`,
  ].join("\n");
}

/** One command per platform; re-running it upgrades or reconfigures an existing install. */
export function installCommand(platform: InstallPlatform, target: InstallTarget): string {
  if (platform === "windows") return windowsCommand(target);
  if (platform === "docker") return dockerCommand(target);
  if (platform === "kubernetes") return helmCommand(target);
  return unixCommand(target);
}

/** Absolute base URL; a relative endpoint means the app's own origin. */
export function resolveBaseUrl(endpoint: string, origin: string): string {
  let url: URL;
  try {
    url = new URL(endpoint || "/", origin);
  } catch {
    url = new URL(origin);
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}
