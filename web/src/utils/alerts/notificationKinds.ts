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

import type { I18nKey, useI18nTyped } from "@/types/i18n";

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
  // A token may carry a length (`{name:30}`) or modifiers (`{name|humanize}`), as the server allows.
  for (const match of body.matchAll(/\{([A-Za-z_][\w.]*)(?::\d+)?(?:\|[^}]*)?\}/g)) {
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

/** A template row as the list endpoint returns it, with the fields the resolution reads. */
export interface ResolvableTemplate {
  name: string;
  kind?: string;
  type?: string;
  isPrebuilt?: boolean;
  applies_to?: string[];
}

/** Where the effective template came from, as the resolution walk names it. */
export type TemplateSource = "explicit" | "destination" | "compiled";

const SOURCE_LABEL_KEYS: Record<string, string> = {
  explicit: "alerts.templateOverride.sourceExplicit",
  destination: "alerts.templateOverride.sourceDestination",
  // Send log rows written before the org default level was removed still carry it.
  org_default: "alerts.templateOverride.sourceOrgDefault",
  compiled: "alerts.templateOverride.sourceCompiled",
  platform_resolve: "alerts.templateOverride.sourcePlatformResolve",
  legacy: "alerts.templateOverride.sourceLegacy",
};

/** The i18n key for a send log `template_source`; undefined for a value this build does not know. */
export const templateSourceLabelKey = (source: string): string | undefined =>
  SOURCE_LABEL_KEYS[source];

/** One destination's template on a sent message, as the send log line names it. */
export interface SentTemplate {
  destination: string;
  template_name: string;
  template_source: string;
}

/** "slack: card (destination template)" per destination; the source alone when nothing rendered. */
export function sentTemplatesText(
  templates: SentTemplate[] | undefined,
  t: ReturnType<typeof useI18nTyped>["t"],
): string {
  return (templates ?? [])
    .map((tpl) => {
      const key = templateSourceLabelKey(tpl.template_source);
      const source = key ? String(t(key as I18nKey)) : tpl.template_source;
      const template = tpl.template_name
        ? String(
            t("alerts.templateOverride.templateWithSource", { name: tpl.template_name, source }),
          )
        : source;
      return `${tpl.destination}: ${template}`;
    })
    .join(", ");
}

/** A stored applies_to of [] means every kind. */
export const templateAppliesTo = (tpl: ResolvableTemplate, kind: NotificationKind) =>
  !tpl.applies_to?.length || tpl.applies_to.includes(kind);

/** The server's walk for one destination: the override, then the destination template if it applies, then the built-in message (`name` null). */
export function resolveEffectiveTemplate(input: {
  kind: NotificationKind;
  override: string | null;
  destination: { type?: string; template?: string | null };
  templates: ResolvableTemplate[];
}): { name: string | null; source: TemplateSource } {
  const { kind, override, destination, templates } = input;
  const find = (name?: string | null) =>
    name ? templates.find((t) => t.name === name) : undefined;
  const fits = (tpl: ResolvableTemplate) =>
    tpl.kind === "content" ||
    !destination.type ||
    templateFitsTransport(tpl.type, destination.type);

  const explicit = find(override);
  if (explicit && fits(explicit)) return { name: explicit.name, source: "explicit" };

  const own = find(destination.template);
  if (own && (kind === "alert" || (!own.isPrebuilt && templateAppliesTo(own, kind))) && fits(own)) {
    return { name: own.name, source: "destination" };
  }
  return { name: null, source: "compiled" };
}

const LEGACY_PAYLOAD_KINDS: readonly NotificationKind[] = [
  "anomaly",
  "synthetics",
  "on_call",
  "downtime",
];
const NAMED_RENDER_FORMATS = [
  "slack",
  "teams_adaptivecard",
  "teams_messagecard",
  "discord",
  "pagerduty",
  "opsgenie",
  "servicenow",
];
const NAMED_DESTINATION_TYPES = [
  "slack",
  "teams",
  "discord",
  "pagerduty",
  "opsgenie",
  "servicenow",
];

/** A destination as the list endpoint returns it, with the fields that pick its channel format. */
export interface PayloadDestination {
  type?: string;
  destination_type_name?: string | null;
  metadata?: Record<string, string> | null;
}

/** Mirrors the server's `derive_channel_format` falling through to the generic Webhook format. */
export function isGenericWebhook(destination: PayloadDestination): boolean {
  const name = destination.destination_type_name ?? "";
  // Jira refuses these kinds before the legacy route is reached.
  if (destination.type !== "http" || name === "jira") return false;
  const renderFormat = destination.metadata?.render_format;
  if (renderFormat === "webhook") return true;
  if (renderFormat && NAMED_RENDER_FORMATS.includes(renderFormat)) return false;
  return !NAMED_DESTINATION_TYPES.includes(name);
}

/** Mirrors the server's `legacy_body`; undefined when a redacted `payload_format` hides it. */
export function sendsLegacyPayload(input: {
  kind: NotificationKind;
  destination: PayloadDestination;
  source: TemplateSource;
}): boolean | undefined {
  const { kind, destination, source } = input;
  if (!LEGACY_PAYLOAD_KINDS.includes(kind) || !isGenericWebhook(destination)) return false;
  const metadata = destination.metadata ?? {};
  const format = metadata.payload_format;
  if (format === "legacy") return true;
  if (format === "rendered") return false;
  // The list endpoint blanks non-plain metadata for readers without PUT, so blank is unknown.
  if ("payload_format" in metadata && !format) return undefined;
  return source === "compiled";
}
