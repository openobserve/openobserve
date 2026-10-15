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

import type { ChatInstallView, SlackAvailability } from "@/ts/interfaces/oncall";
import type { I18nText, TranslateFn } from "@/types/i18n";
import { isSlackOAuthCallbackMessage, type SlackOAuthCallbackMessage } from "@/utils/slackOAuth";

/** Which body the Slack page shows. */
export type SlackPageBody = "loading" | "failed" | "empty" | "connected" | "revoked";

/** Why the page's one action is disabled: no master key (IN-2) or a 403 already seen (RB-12). */
export type SlackBlock = "needs_key" | "not_admin";

/** What the Slack page renders: its body, the org's install, and why its action is disabled. */
export interface SlackPageView {
  body: SlackPageBody;
  install: ChatInstallView | null;
  block: SlackBlock | null;
}

/** The facts the page decides from; the two denials are latched from 403 answers. */
export interface SlackPageInput {
  installs: ChatInstallView[] | undefined;
  loadError: unknown;
  availability: SlackAvailability | undefined;
  connectDenied: boolean;
  disconnectDenied: boolean;
}

/** What the Slack page shows; data already read outranks a later refetch error. [pure] */
export function slackPageView(input: SlackPageInput): SlackPageView {
  if (!input.installs) {
    return { body: input.loadError ? "failed" : "loading", install: null, block: null };
  }
  // IN-8: an org connects one workspace, so the first row is the only one.
  const install = input.installs[0] ?? null;
  if (install?.status === "active") {
    return { body: "connected", install, block: input.disconnectDenied ? "not_admin" : null };
  }
  return { body: install ? "revoked" : "empty", install, block: connectBlock(input) };
}

/** The one line under a disabled action. [pure] */
export function slackBlockText(t: TranslateFn, block: SlackBlock): I18nText {
  switch (block) {
    case "needs_key":
      return t("oncallSlack.needsKey");
    case "not_admin":
      return t("oncallSlack.notAdmin");
  }
}

/** The callback relay message, only when it comes from this page's own popup on this origin. [pure] */
export function slackCallbackOf(
  event: Pick<MessageEvent<unknown>, "origin" | "source" | "data">,
  popup: Window | null,
  origin: string,
): SlackOAuthCallbackMessage | null {
  if (!popup || event.origin !== origin || event.source !== popup) return null;
  return isSlackOAuthCallbackMessage(event.data) ? event.data : null;
}

/** The server's worded refusal, if the failed call carried one. [pure] */
export function serverMessageOf(err: unknown): string | undefined {
  return (err as { response?: { data?: { message?: string } } } | null)?.response?.data?.message;
}

/** Why Connect or Reconnect is disabled; the missing key outranks a refused try. [pure] */
function connectBlock(input: SlackPageInput): SlackBlock | null {
  if (input.availability === "needs_key") return "needs_key";
  return input.connectDenied ? "not_admin" : null;
}
