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

import type { ChatInstallView, SlackAvailability } from "@/ts/interfaces/oncall";
import { SLACK_OAUTH_MESSAGE_TYPE } from "@/utils/slackOAuth";
import { slackCallbackOf, slackPageView, type SlackPageView } from "./slack";

const ACTIVE: ChatInstallView = {
  workspace_id: "T1",
  workspace_name: "Acme Corp",
  status: "active",
  installed_by: "ana@o2.ai",
  installed_at: 1,
};
const REVOKED: ChatInstallView = { ...ACTIVE, status: "revoked" };
const LOAD_ERROR = { response: { status: 500 } };

describe("slackPageView", () => {
  type Row = [
    string,
    ChatInstallView[] | undefined,
    unknown,
    SlackAvailability | undefined,
    { connect: boolean; disconnect: boolean },
    SlackPageView,
  ];
  const none = { connect: false, disconnect: false };
  const rows: Row[] = [
    ["loading", undefined, null, "on", none, { body: "loading", install: null, block: null }],
    [
      "load failed",
      undefined,
      LOAD_ERROR,
      "on",
      none,
      { body: "failed", install: null, block: null },
    ],
    [
      "data outranks a refetch error",
      [],
      LOAD_ERROR,
      "on",
      none,
      { body: "empty", install: null, block: null },
    ],
    ["not connected", [], null, "on", none, { body: "empty", install: null, block: null }],
    [
      "needs_key",
      [],
      null,
      "needs_key",
      none,
      { body: "empty", install: null, block: "needs_key" },
    ],
    [
      "needs_key outranks a refused connect",
      [],
      null,
      "needs_key",
      { connect: true, disconnect: false },
      { body: "empty", install: null, block: "needs_key" },
    ],
    [
      "403 on install/start",
      [],
      null,
      "on",
      { connect: true, disconnect: false },
      { body: "empty", install: null, block: "not_admin" },
    ],
    ["connected", [ACTIVE], null, "on", none, { body: "connected", install: ACTIVE, block: null }],
    [
      "connected ignores a refused connect and a missing key",
      [ACTIVE],
      null,
      "needs_key",
      { connect: true, disconnect: false },
      { body: "connected", install: ACTIVE, block: null },
    ],
    [
      "403 on Disconnect",
      [ACTIVE],
      null,
      "on",
      { connect: false, disconnect: true },
      { body: "connected", install: ACTIVE, block: "not_admin" },
    ],
    ["revoked", [REVOKED], null, "on", none, { body: "revoked", install: REVOKED, block: null }],
    [
      "revoked after a refused Reconnect",
      [REVOKED],
      null,
      "on",
      { connect: true, disconnect: false },
      { body: "revoked", install: REVOKED, block: "not_admin" },
    ],
    [
      "revoked without the master key",
      [REVOKED],
      null,
      "needs_key",
      none,
      { body: "revoked", install: REVOKED, block: "needs_key" },
    ],
  ];

  it.each(rows)("%s", (_, installs, loadError, availability, denied, expected) => {
    expect(
      slackPageView({
        installs,
        loadError,
        availability,
        connectDenied: denied.connect,
        disconnectDenied: denied.disconnect,
      }),
    ).toEqual(expected);
  });
});

describe("slackCallbackOf", () => {
  const ORIGIN = "https://o2.example";
  const popup = {} as Window;
  const relayed = { type: SLACK_OAUTH_MESSAGE_TYPE, code: "c1", state: "s1" };
  const rows: [
    string,
    { origin: string; source: unknown; data: unknown },
    Window | null,
    unknown,
  ][] = [
    [
      "the relayed code and state",
      { origin: ORIGIN, source: popup, data: relayed },
      popup,
      relayed,
    ],
    [
      "a relayed Slack error",
      {
        origin: ORIGIN,
        source: popup,
        data: { type: SLACK_OAUTH_MESSAGE_TYPE, error: "access_denied" },
      },
      popup,
      { type: SLACK_OAUTH_MESSAGE_TYPE, error: "access_denied" },
    ],
    [
      "another origin",
      { origin: "https://evil.example", source: popup, data: relayed },
      popup,
      null,
    ],
    ["another window", { origin: ORIGIN, source: {}, data: relayed }, popup, null],
    ["no popup of ours open", { origin: ORIGIN, source: null, data: relayed }, null, null],
    [
      "another shape",
      { origin: ORIGIN, source: popup, data: { type: "other", code: "c" } },
      popup,
      null,
    ],
  ];

  it.each(rows)("accepts only its own flow: %s", (_, event, ours, expected) => {
    expect(slackCallbackOf(event as MessageEvent<unknown>, ours, ORIGIN)).toEqual(expected);
  });
});
