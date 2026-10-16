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

// Shared bits for the OTel Collector exporter snippets shown across the plain
// (non-rich-card) ingestion pages — Logs/Traces "OTEL Collector" tabs, the
// Metrics OTel Collector page, and the Recommended tab.

/**
 * OpenObserve Cloud's primary (US) region — the only one whose public gRPC
 * gateway (grpc.openobserve.ai) is live. Other cloud regions fall back to the
 * self-hosted-only gRPC guidance until their own gateway ships.
 */
export const PRIMARY_CLOUD_WEB_URL = "https://cloud.openobserve.ai";

/**
 * There is no backend flag for "this region has a public gRPC gateway" today
 * (zoConfig carries no such field) — this string match against web_url is the
 * whole mechanism, so normalize away the variance that would otherwise flip a
 * real primary-cloud org silently off: case, surrounding whitespace, and a
 * trailing slash the config API is free to add or drop.
 */
export function isPrimaryCloudWebUrl(webUrl?: string | null): boolean {
  if (!webUrl) return false;
  return webUrl.trim().toLowerCase().replace(/\/+$/, "") === PRIMARY_CLOUD_WEB_URL;
}

/**
 * The `exporters:` YAML shown under the "OTLP gRPC" heading: OpenObserve
 * Cloud's public gateway on the primary region, or the self-hosted collector
 * port everywhere else.
 */
export function getOtelCollectorGrpcYaml(params: {
  orgIdentifier?: string;
  selfHostedHost: string;
  isPrimaryCloud: boolean;
}): string {
  const { orgIdentifier, selfHostedHost, isPrimaryCloud } = params;

  if (isPrimaryCloud) {
    return `exporters:
  otlp/openobserve:
    endpoint: grpc.openobserve.ai:443
    headers:
      Authorization: "Basic [BASIC_PASSCODE]"
      organization: ${orgIdentifier}
      stream-name: default
    tls:
      insecure: false

service:
  telemetry:
    logs:
      level: warn`;
  }

  return `exporters:
  otlp/openobserve:
      endpoint: ${selfHostedHost}:5081
      headers:
        Authorization: "Basic [BASIC_PASSCODE]"
        organization: ${orgIdentifier}
        stream-name: default
      tls:
        insecure: true

service:
  telemetry:
    logs:
      level: warn`;
}
