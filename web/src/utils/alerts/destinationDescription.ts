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

import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { PREBUILT_DESTINATION_TYPES, detectPrebuiltType } from "@/utils/prebuilt-templates";
import {
  isSlackAppDestination,
  isSlackWebhookDestination,
  slackWebhookTarget,
} from "@/utils/slackAppDestination";
import { joinListMore } from "@/utils/alerts/alertCopy";

/** What a destination is and where it delivers, for pickers and the read-back. */
export interface DestinationDescription {
  type: I18nText;
  target: I18nText | null;
}

interface DestinationLike {
  name: string;
  type?: string;
  url?: string;
  emails?: string[];
  channel_name?: string;
  destination_type_name?: string | null;
  template?: string | null;
  metadata?: string | Record<string, string> | null;
  [key: string]: unknown;
}

const SLACK = raw("Slack");

// Only the host: a webhook path or query often carries its token.
const hostOf = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
};

const channel = (name: string | undefined): I18nText | null =>
  name ? raw(`#${name.replace(/^#/, "")}`) : null;

function typeOf(destination: DestinationLike, t: TranslateFn): I18nText {
  if (isSlackAppDestination(destination))
    return t("slackApp.destination.appTile", { product: SLACK });
  const prebuilt = detectPrebuiltType(destination);
  const known = PREBUILT_DESTINATION_TYPES.find((type) => type.id === prebuilt);
  if (known) return raw(known.name);
  if (isSlackWebhookDestination(destination))
    return t("slackApp.destination.webhookTile", { product: SLACK });
  if (destination.type === "email") return t("components.badge.destinationType.email");
  if (destination.type === "sns") return raw("SNS");
  return t("components.badge.destinationType.webhook");
}

function targetOf(destination: DestinationLike, t: TranslateFn): I18nText | null {
  if (isSlackAppDestination(destination)) return channel(destination.channel_name);
  if (destination.type === "email") {
    const emails = (destination.emails ?? []).filter(Boolean);
    return emails.length ? joinListMore(emails, t, 1) : null;
  }
  if (isSlackWebhookDestination(destination))
    return channel(slackWebhookTarget(destination).channelName);
  const host = hostOf(destination.url);
  return host ? raw(host) : null;
}

export function describeDestination(
  destination: DestinationLike,
  t: TranslateFn,
): DestinationDescription {
  return { type: typeOf(destination, t), target: targetOf(destination, t) };
}

/** Descriptions keyed by destination name; entries without a name are skipped. */
export function describeDestinations(
  destinations: readonly (DestinationLike | null | undefined)[],
  t: TranslateFn,
): Record<string, DestinationDescription> {
  const out: Record<string, DestinationDescription> = {};
  for (const destination of destinations ?? []) {
    if (destination?.name) out[destination.name] = describeDestination(destination, t);
  }
  return out;
}
