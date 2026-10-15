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

import { describe, expect, it } from "vitest";

import { isBadRequest, slackCardView, type SlackCardInput } from "./slackLink";
import type { ChatLinkView } from "@/ts/interfaces/oncall";

function link(connected: boolean): ChatLinkView {
  return {
    workspace_id: "T1",
    workspace_name: "Acme Corp",
    connected,
    slack_user_id: "U1",
    email: "ann@example.com",
    linked_at: 1,
  };
}

function input(over: Partial<SlackCardInput>): SlackCardInput {
  return { link: undefined, loadError: null, dmSent: false, startNotConnected: false, ...over };
}

describe("slackCardView", () => {
  it.each<[string, Partial<SlackCardInput>, string, boolean]>([
    ["nothing read yet", {}, "loading", false],
    ["the read failed", { loadError: new Error("x") }, "failed", false],
    ["no link", { link: null }, "unlinked", false],
    ["no link, DM sent", { link: null, dmSent: true }, "dmSent", false],
    [
      "no link, Link Slack said not connected",
      { link: null, startNotConnected: true },
      "unlinked",
      true,
    ],
    ["a link in the connected workspace", { link: link(true) }, "linked", false],
    ["a link kept from before a Disconnect", { link: link(false) }, "linked", true],
    [
      "a link read once, then a refetch failed",
      { link: link(true), loadError: new Error("x") },
      "linked",
      false,
    ],
  ])("%s", (_, over, body, notConnected) => {
    const view = slackCardView(input(over));
    expect(view.body).toBe(body);
    expect(view.notConnected).toBe(notConnected);
  });
});

describe("isBadRequest", () => {
  it.each<[unknown, boolean]>([
    [{ response: { status: 400 } }, true],
    [{ response: { status: 404 } }, false],
    [{ response: { status: 409 } }, false],
    [new Error("network"), false],
  ])("%o → %s", (err, expected) => {
    expect(isBadRequest(err)).toBe(expected);
  });
});
