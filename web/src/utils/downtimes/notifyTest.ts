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

import type { DowntimeDetail, DowntimeWindow, TargetModule } from "@/services/downtimes";

export const DOWNTIME_TEMPLATE = "prebuilt_downtime";
export const DOWNTIME_EMAIL_TEMPLATE = "prebuilt_downtime_email";

const DOWNTIME_VARIABLE_PREFIX = "{downtime_";

export type TemplateEscape = "json" | "html";

export interface TestDestination {
  name: string;
  type?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  skip_tls_verify?: boolean;
  emails?: string[];
  template?: string;
}

export interface DestinationTestRequest {
  type: "http" | "email";
  url: string;
  method?: string;
  headers?: Record<string, string>;
  skip_tls_verify?: boolean;
  recipients?: string[];
  body: string;
}

// Message payload words, as the server writes them; not UI copy.
const MODULE_WORDS: Record<TargetModule, [string, string]> = {
  alerts: ["alert", "alerts"],
  anomaly_detections: ["anomaly detection", "anomaly detections"],
  synthetics: ["synthetics check", "synthetics checks"],
  slos: ["SLO", "SLOs"],
};

const MATCHED: Record<TargetModule, keyof DowntimeDetail> = {
  alerts: "matched_alerts",
  anomaly_detections: "matched_anomalies",
  synthetics: "matched_synthetics",
  slos: "matched_slos",
};

const utc = (micros: number): string => {
  const iso = new Date(Math.floor(micros / 1000)).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
};

export function downtimeVariables(
  d: DowntimeDetail,
  window: DowntimeWindow,
  url: string,
): Record<string, string> {
  const counts = d.targets.map((tg) => {
    const n = Number(d[MATCHED[tg.module]] ?? 0);
    const [one, many] = MODULE_WORDS[tg.module];
    return `${n} ${n === 1 ? one : many}`;
  });
  return {
    downtime_name: d.name,
    downtime_event: "started",
    downtime_reason: d.reason ?? "",
    downtime_starts_at: utc(window.start),
    downtime_ends_at: utc(window.end),
    downtime_targets: d.targets.map((tg) => MODULE_WORDS[tg.module][1]).join(", "),
    downtime_counts: counts.join(", "),
    downtime_url: url,
    org_name: d.org,
  };
}

const escapeValue = (value: string, escape: TemplateEscape): string => {
  if (escape === "json") return JSON.stringify(value).slice(1, -1);
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

export function renderDowntimeTemplate(
  body: string,
  vars: Record<string, string>,
  escape: TemplateEscape,
): string {
  return body.replace(/\{([a-z_]+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? escapeValue(vars[name], escape) : whole,
  );
}

export const isEmailDestination = (dest: TestDestination): boolean => dest.type === "email";

export function templateNameFor(dest: TestDestination, ownBody?: string): string {
  if (dest.template && ownBody?.includes(DOWNTIME_VARIABLE_PREFIX)) return dest.template;
  return isEmailDestination(dest) ? DOWNTIME_EMAIL_TEMPLATE : DOWNTIME_TEMPLATE;
}

export function testRequestFor(dest: TestDestination, body: string): DestinationTestRequest | null {
  if (isEmailDestination(dest)) {
    return { type: "email", url: "", recipients: [...(dest.emails ?? [])], body };
  }
  if (dest.type && dest.type !== "http") return null;
  return {
    type: "http",
    url: dest.url ?? "",
    method: dest.method,
    headers: dest.headers,
    skip_tls_verify: dest.skip_tls_verify,
    body,
  };
}
