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

/** The notification kinds a template can apply to, in the editor's chip order. */
export const NOTIFICATION_KINDS = [
  "alert",
  "incident",
  "anomaly",
  "synthetics",
  "downtime",
  "on_call",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** One group of the preview response's variable guide: `common` or a kind. */
export interface VariableGroup {
  name: string;
  variables: string[];
}

const LABEL_KEYS = {
  alert: "alerts.notificationKinds.alert",
  incident: "alerts.notificationKinds.incident",
  anomaly: "alerts.notificationKinds.anomaly",
  synthetics: "alerts.notificationKinds.synthetics",
  downtime: "alerts.notificationKinds.downtime",
  on_call: "alerts.notificationKinds.on_call",
} as const satisfies Record<NotificationKind, string>;

export const kindLabelKey = (kind: NotificationKind) => LABEL_KEYS[kind];

// Variables only one kind fills; a body that uses one is meant for that kind.
const KIND_VARIABLES: [NotificationKind, RegExp][] = [
  [
    "anomaly",
    /^(anomaly_.*|max_deviation_percent|deviation_.*|worst_.*|window_start|window_end|score|threshold)$/,
  ],
  ["incident", /^incident_.*/],
  ["synthetics", /^check_.*/],
  ["downtime", /^downtime_.*/],
  ["on_call", /^(oncall_.*|runbook_url)$/],
];

/** The kinds a body's `{variable}` tokens point at, in chip order; [] means all kinds. */
export function inferAppliesTo(body: string): NotificationKind[] {
  const found = new Set<NotificationKind>();
  for (const match of body.matchAll(/\{([A-Za-z_][\w.]*)\}/g)) {
    const name = match[1];
    for (const [kind, pattern] of KIND_VARIABLES) {
      if (pattern.test(name)) found.add(kind);
    }
  }
  return NOTIFICATION_KINDS.filter((k) => found.has(k));
}

/** A Custom template's type (http, email, sns) fits only destinations of the same transport. */
export function templateFitsTransport(templateType?: string, destinationType?: string): boolean {
  const transport = (t?: string) => (t === "email" ? "email" : t === "sns" ? "sns" : "http");
  return transport(templateType) === transport(destinationType);
}
