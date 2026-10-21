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

export type InstallPlatform = "linux" | "macos" | "windows" | "kubernetes";

export const INSTALL_PLATFORMS: InstallPlatform[] = ["linux", "macos", "windows", "kubernetes"];

export interface InstallTarget {
  baseUrl: string;
  org: string;
  token: string;
  /** The collector version to install; null lets the script pick its latest supported one. */
  version: string | null;
  /** HTTP polling for proxies that cannot carry WebSocket. */
  http: boolean;
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

function helmCommand(t: InstallTarget): string {
  const sets = [
    `--set image.repository=${IMAGE}`,
    ...(t.version ? [`--set image.tag=${q(t.version)}`] : []),
    `--set opamp.endpoint=${q(opampEndpoint(t))}`,
    `--set opamp.token=${q(t.token)}`,
  ];
  return [
    "helm repo add openobserve https://charts.openobserve.ai && helm repo update",
    "helm upgrade --install otel-fleet-collector openobserve/otel-fleet-collector \\",
    "  --namespace openobserve-collector --create-namespace \\",
    ...sets.map((s, i) => `  ${s}${i < sets.length - 1 ? " \\" : ""}`),
  ].join("\n");
}

/** One command per platform; re-running it upgrades or reconfigures an existing install. */
export function installCommand(platform: InstallPlatform, target: InstallTarget): string {
  if (platform === "windows") return windowsCommand(target);
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
