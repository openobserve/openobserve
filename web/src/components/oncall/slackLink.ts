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

import type { ChatLinkView } from "@/ts/interfaces/oncall";

/** Which body the Slack card on My on-call shows. */
export type SlackCardBody = "loading" | "failed" | "unlinked" | "dmSent" | "linked";

/** What the Slack card renders: its body, the caller's link, and whether the org's Slack is down. */
export interface SlackCardView {
  body: SlackCardBody;
  link: ChatLinkView | null;
  notConnected: boolean;
}

/** The facts the card decides from; the last two are latched from Link Slack's answers. */
export interface SlackCardInput {
  link: ChatLinkView | null | undefined;
  loadError: unknown;
  dmSent: boolean;
  startNotConnected: boolean;
}

/** What the Slack card shows; a link already read outranks a later refetch error. [pure] */
export function slackCardView(input: SlackCardInput): SlackCardView {
  if (input.link === undefined) {
    return { body: input.loadError ? "failed" : "loading", link: null, notConnected: false };
  }
  if (input.link) {
    return { body: "linked", link: input.link, notConnected: !input.link.connected };
  }
  return {
    body: input.dmSent ? "dmSent" : "unlinked",
    link: null,
    notConnected: input.startNotConnected,
  };
}

/** Both link routes answer 400 for exactly one case: start when Slack is not connected, Confirm when refused. [pure] */
export function isBadRequest(err: unknown): boolean {
  return (err as { response?: { status?: number } } | null)?.response?.status === 400;
}
