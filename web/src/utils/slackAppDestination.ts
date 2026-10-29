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

import { isValidSlackWebhookUrl } from "@/utils/prebuilt-templates/slack";

export const SLACK_APP_TYPE = "slack_app";
export const REFIRE_REUSE_MAX_MINUTES = 240;
/** The params a refused switch's Review adds to the destination route; they turn Edit into the switch form. */
export const SLACK_APP_REVIEW_PARAMS = [
  "slack_app_installation",
  "slack_app_refusal",
  "slack_app_team",
  "slack_app_room",
] as const;

export type SlackMentionKind = "default" | "here" | "channel" | "none";
export interface SlackSubteamMention {
  subteam_id: string;
  handle: string;
}
export type SlackMentionRule = SlackMentionKind | SlackSubteamMention;
export type SlackAutoInvestigate = "off" | "critical";

/** The HTTP endpoint a switch keeps so Switch back can restore it; never sent to. */
export interface SlackPreviousWebhook {
  url: string;
  method?: string;
  skip_tls_verify?: boolean;
  headers?: Record<string, string>;
  output_format?: unknown;
  destination_type?: string;
  metadata?: Record<string, string>;
}

/** `SlackAppTarget` (config::meta::destinations), flattened onto the destination body. */
export interface SlackAppTarget {
  installation_id: string;
  channel_id: string;
  channel_name: string;
  buttons: boolean;
  mention: SlackMentionRule;
  refire_reuse_minutes: number;
  auto_investigate: SlackAutoInvestigate;
  shared_channel_confirmed: boolean;
  oncall_room_confirmed: boolean;
  previous_webhook?: SlackPreviousWebhook | null;
}

export interface SlackAppDestination extends SlackAppTarget {
  name: string;
  type: typeof SLACK_APP_TYPE;
  template?: string;
}

/** Form values: the mention is a menu value and the investigate switch a boolean. */
export type SlackAppFormValues = {
  name: string;
  installation_id: string;
  channel_id: string;
  channel_name: string;
  mention: SlackMentionKind | "subteam";
  refire_reuse_minutes: number | string;
  buttons: boolean;
  auto_investigate: boolean;
  template: string;
  shared_channel_confirmed: boolean;
  oncall_room_confirmed: boolean;
};

export interface OncallTeamRoom {
  team_id: string;
  team_name: string;
  destinations: string[];
}

export type SlackAppSaveRefusal = { code: string | null } & (
  | { kind: "version" }
  | { kind: "oncall_room"; team: string; destination: string }
  | { kind: "shared" }
  | { kind: "other"; message: string | null }
);

interface DestinationRow {
  name: string;
  type?: string;
  url?: string;
  method?: string;
  skip_tls_verify?: boolean;
  headers?: Record<string, string> | null;
  output_format?: unknown;
  destination_type_name?: string | null;
  template?: string | null;
  metadata?: string | Record<string, string> | null;
  [key: string]: unknown;
}

export const SLACK_APP_DEFAULTS = {
  buttons: true,
  mention: "default" as SlackMentionRule,
  refire_reuse_minutes: 30,
  auto_investigate: "off" as SlackAutoInvestigate,
  shared_channel_confirmed: false,
  oncall_room_confirmed: false,
};

const metadataOf = (row: DestinationRow): Record<string, string> => {
  const raw = row.metadata;
  if (!raw) return {};
  if (typeof raw !== "string") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export const isSlackAppDestination = (row: { type?: string }): boolean =>
  row.type === SLACK_APP_TYPE;

export const isSlackWebhookDestination = (row: DestinationRow): boolean => {
  if (row.type !== "http") return false;
  return metadataOf(row).prebuilt_type === "slack" || isValidSlackWebhookUrl(row.url ?? "");
};

/** The Slack team and channel Phase 1 records on a webhook made through Connect. */
export const slackWebhookTarget = (row: DestinationRow) => {
  const meta = metadataOf(row);
  return {
    teamId: meta.slack_team_id ?? "",
    channelId: meta.slack_channel_id ?? "",
    channelName: (meta.credential_channel ?? "").replace(/^#/, ""),
  };
};

const mentionRule = (
  kind: SlackAppFormValues["mention"],
  subteam?: SlackSubteamMention | null,
): SlackMentionRule => (kind === "subteam" ? (subteam ?? "default") : kind);

export function buildSlackAppDestination(
  values: SlackAppFormValues,
  extra: {
    subteam?: SlackSubteamMention | null;
    previousWebhook?: SlackPreviousWebhook | null;
  } = {},
): SlackAppDestination {
  const body: SlackAppDestination = {
    name: values.name.trim(),
    type: SLACK_APP_TYPE,
    installation_id: values.installation_id,
    channel_id: values.channel_id,
    channel_name: values.channel_name,
    buttons: values.buttons,
    mention: mentionRule(values.mention, extra.subteam),
    refire_reuse_minutes: Number(values.refire_reuse_minutes),
    auto_investigate: values.auto_investigate ? "critical" : "off",
    shared_channel_confirmed: values.shared_channel_confirmed,
    oncall_room_confirmed: values.oncall_room_confirmed,
  };
  if (values.template) body.template = values.template;
  if (extra.previousWebhook) body.previous_webhook = extra.previousWebhook;
  return body;
}

/** The body of `POST /alerts/destinations/test`, whose request struct is camelCase. */
export const buildSlackAppTest = (destination: SlackAppDestination) => ({
  type: SLACK_APP_TYPE,
  template: destination.template,
  slackApp: {
    installation_id: destination.installation_id,
    channel_id: destination.channel_id,
    channel_name: destination.channel_name,
    buttons: destination.buttons,
    mention: destination.mention,
    refire_reuse_minutes: destination.refire_reuse_minutes,
    auto_investigate: destination.auto_investigate,
    shared_channel_confirmed: destination.shared_channel_confirmed,
    oncall_room_confirmed: destination.oncall_room_confirmed,
  },
});

export const switchCandidates = <T extends DestinationRow>(rows: T[], teamId: string): T[] =>
  rows.filter((row) => {
    if (!isSlackWebhookDestination(row)) return false;
    const target = slackWebhookTarget(row);
    return !!teamId && target.teamId === teamId && !!target.channelId;
  });

/** A switch is an in-place edit, so the name, the template and the alerts using it stay. */
export function switchToSlackApp(
  row: DestinationRow,
  installationId: string,
): SlackAppDestination | null {
  const target = slackWebhookTarget(row);
  if (!target.channelId) return null;
  const previous: SlackPreviousWebhook = {
    url: row.url ?? "",
    method: row.method,
    skip_tls_verify: row.skip_tls_verify ?? false,
    metadata: metadataOf(row),
  };
  if (row.headers && Object.keys(row.headers).length) previous.headers = row.headers;
  if (row.output_format) previous.output_format = row.output_format;
  if (row.destination_type_name) previous.destination_type = row.destination_type_name;
  const body: SlackAppDestination = {
    ...SLACK_APP_DEFAULTS,
    name: row.name,
    type: SLACK_APP_TYPE,
    installation_id: installationId,
    channel_id: target.channelId,
    channel_name: target.channelName || target.channelId,
    previous_webhook: previous,
  };
  if (row.template) body.template = row.template;
  return body;
}

export function switchBackToWebhook(destination: SlackAppDestination) {
  const previous = destination.previous_webhook;
  if (!previous?.url) return null;
  const body: Record<string, unknown> = {
    name: destination.name,
    type: "http",
    url: previous.url,
    method: previous.method ?? "post",
    skip_tls_verify: previous.skip_tls_verify ?? false,
    metadata: previous.metadata ?? {},
  };
  if (destination.template) body.template = destination.template;
  if (previous.headers) body.headers = previous.headers;
  if (previous.output_format) body.output_format = previous.output_format;
  if (previous.destination_type) body.destination_type_name = previous.destination_type;
  return body;
}

export function alertRoutesByChannel(
  rows: Array<{ type?: string; installation_id?: unknown; channel_id?: unknown }>,
  installationId: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!isSlackAppDestination(row) || row.installation_id !== installationId) continue;
    const channel = String(row.channel_id ?? "");
    if (channel) counts[channel] = (counts[channel] ?? 0) + 1;
  }
  return counts;
}

/** Option (b): an on-call team pages into this channel through a Slack webhook destination. */
export function oncallRoomFor(
  channelId: string,
  destinations: DestinationRow[],
  teams: OncallTeamRoom[],
): { team: string; destination: string } | null {
  if (!channelId) return null;
  const webhooks = new Set(
    destinations
      .filter((d) => isSlackWebhookDestination(d) && slackWebhookTarget(d).channelId === channelId)
      .map((d) => d.name),
  );
  if (!webhooks.size) return null;
  for (const team of teams) {
    const destination = team.destinations.find((name) => webhooks.has(name));
    if (destination) return { team: team.team_name, destination };
  }
  return null;
}

/** Webhook rows that post to this channel; a team-room lookup is needed only when there is one. */
export const hasWebhookInChannel = (channelId: string, destinations: DestinationRow[]): boolean =>
  !!channelId &&
  destinations.some(
    (d) => isSlackWebhookDestination(d) && slackWebhookTarget(d).channelId === channelId,
  );

const VERSION_GUARD = /upgrade every node first/i;

export function slackAppSaveRefusal(error: unknown): SlackAppSaveRefusal {
  const data = (error as { response?: { data?: Record<string, unknown> } })?.response?.data ?? {};
  const message = typeof data.message === "string" ? data.message : null;
  const code = typeof data.code === "string" ? data.code : null;
  if (code === "version_mismatch" || (message && VERSION_GUARD.test(message))) {
    return { kind: "version", code };
  }
  if (code === "oncall_room_unconfirmed") {
    return {
      kind: "oncall_room",
      code,
      team: String(data.team ?? ""),
      destination: String(data.destination ?? ""),
    };
  }
  if (code === "shared_channel_unconfirmed") return { kind: "shared", code };
  return { kind: "other", code, message };
}

export const withoutSlackAppReview = <T extends Record<string, unknown>>(query: T): T =>
  Object.fromEntries(
    Object.entries(query).filter(
      ([key]) => !(SLACK_APP_REVIEW_PARAMS as readonly string[]).includes(key),
    ),
  ) as T;

/** Webhooks an on-call team pages through; a switch would stop those pages (on-call cannot post through the app). */
export const oncallRoomNames = (teams: OncallTeamRoom[]): Set<string> =>
  new Set(teams.flatMap((team) => team.destinations));
