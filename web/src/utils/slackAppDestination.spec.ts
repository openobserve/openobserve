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
import {
  SLACK_APP_DEFAULTS,
  alertRoutesByChannel,
  buildSlackAppDestination,
  buildSlackAppTest,
  isSlackAppDestination,
  isSlackWebhookDestination,
  oncallRoomFor,
  slackAppSaveRefusal,
  switchBackToWebhook,
  switchCandidates,
  switchToSlackApp,
  type SlackAppDestination,
} from "./slackAppDestination";

const HOOK = "https://hooks.slack.com/services/T0SAMPLE01/B000/xyz";

const webhook = (name: string, team = "T0SAMPLE01", channel = "C1", extra = {}) => ({
  name,
  type: "http",
  url: HOOK,
  method: "post",
  skip_tls_verify: false,
  template: "prebuilt_slack",
  metadata: {
    prebuilt_type: "slack",
    setup_method: "oauth",
    slack_team_id: team,
    slack_team_name: "Acme Corp",
    slack_channel_id: channel,
    credential_channel: "#payments",
  },
  ...extra,
});

const app = (over: Partial<SlackAppDestination> = {}): SlackAppDestination => ({
  ...SLACK_APP_DEFAULTS,
  name: "sre-prod-slack",
  type: "slack_app",
  template: "prebuilt_slack",
  installation_id: "inst-1",
  channel_id: "C9",
  channel_name: "sre-prod",
  ...over,
});

describe("Slack app destination wire", () => {
  it("defaults to the spec 7.1 values", () => {
    expect(SLACK_APP_DEFAULTS).toEqual({
      buttons: true,
      mention: "default",
      refire_reuse_minutes: 30,
      auto_investigate: "off",
      shared_channel_confirmed: false,
      oncall_room_confirmed: false,
    });
  });

  it("builds the flat create body with type slack_app and no HTTP fields", () => {
    const body = buildSlackAppDestination({
      name: " sre-prod-slack ",
      installation_id: "inst-1",
      channel_id: "C9",
      channel_name: "sre-prod",
      mention: "here",
      refire_reuse_minutes: "45",
      buttons: false,
      auto_investigate: true,
      template: "prebuilt_slack",
      shared_channel_confirmed: true,
      oncall_room_confirmed: false,
    });
    expect(body).toEqual({
      name: "sre-prod-slack",
      type: "slack_app",
      template: "prebuilt_slack",
      installation_id: "inst-1",
      channel_id: "C9",
      channel_name: "sre-prod",
      buttons: false,
      mention: "here",
      refire_reuse_minutes: 45,
      auto_investigate: "critical",
      shared_channel_confirmed: true,
      oncall_room_confirmed: false,
    });
    expect(body).not.toHaveProperty("url");
    expect(body).not.toHaveProperty("method");
  });

  it("keeps a user-group mention and a previous webhook on edit", () => {
    const previous = { url: HOOK, method: "post", skip_tls_verify: false, metadata: {} };
    const body = buildSlackAppDestination(
      {
        name: "a",
        installation_id: "i",
        channel_id: "C",
        channel_name: "c",
        mention: "subteam",
        refire_reuse_minutes: 30,
        buttons: true,
        auto_investigate: false,
        template: "",
        shared_channel_confirmed: false,
        oncall_room_confirmed: false,
      },
      { subteam: { subteam_id: "S1", handle: "sre" }, previousWebhook: previous },
    );
    expect(body.mention).toEqual({ subteam_id: "S1", handle: "sre" });
    expect(body.previous_webhook).toEqual(previous);
    expect(body).not.toHaveProperty("template");
  });

  it("sends Send test to the test route as the slack_app type", () => {
    const target = app();
    expect(buildSlackAppTest(target)).toEqual({
      type: "slack_app",
      template: "prebuilt_slack",
      slackApp: {
        installation_id: "inst-1",
        channel_id: "C9",
        channel_name: "sre-prod",
        buttons: true,
        mention: "default",
        refire_reuse_minutes: 30,
        auto_investigate: "off",
        shared_channel_confirmed: false,
        oncall_room_confirmed: false,
      },
    });
  });
});

describe("telling destinations apart", () => {
  it("knows a Slack app row and a Slack webhook row", () => {
    expect(isSlackAppDestination(app())).toBe(true);
    expect(isSlackAppDestination(webhook("w"))).toBe(false);
    expect(isSlackWebhookDestination(webhook("w"))).toBe(true);
    expect(isSlackWebhookDestination({ name: "e", type: "email" })).toBe(false);
    expect(
      isSlackWebhookDestination({ name: "x", type: "http", url: "https://example.com/hook" }),
    ).toBe(false);
  });

  it("reads metadata that arrives as a JSON string", () => {
    const row = webhook("w");
    const asString = { ...row, metadata: JSON.stringify(row.metadata) };
    expect(switchCandidates([asString], "T0SAMPLE01").map((r) => r.name)).toEqual(["w"]);
  });
});

describe("switching (7.9)", () => {
  it("offers only webhook rows of the connected team that know their channel", () => {
    const rows = [
      webhook("payments-slack"),
      webhook("other-team", "T0OTHER"),
      webhook("no-channel", "T0SAMPLE01", ""),
      app({ name: "already-app" }),
      { name: "email", type: "email", emails: ["a@b.c"] },
    ];
    expect(switchCandidates(rows, "T0SAMPLE01").map((r) => r.name)).toEqual(["payments-slack"]);
  });

  it("switches in place: same name and template, webhook kept for Switch back", () => {
    const row = webhook("payments-slack", "T0SAMPLE01", "C1", {
      headers: { "X-A": "1" },
      template: "my-slack-template",
    });
    const body = switchToSlackApp(row, "inst-1");
    expect(body).toMatchObject({
      name: "payments-slack",
      type: "slack_app",
      template: "my-slack-template",
      installation_id: "inst-1",
      channel_id: "C1",
      channel_name: "payments",
      buttons: true,
      mention: "default",
    });
    expect(body?.previous_webhook).toEqual({
      url: HOOK,
      method: "post",
      skip_tls_verify: false,
      headers: { "X-A": "1" },
      metadata: row.metadata,
    });
  });

  it("refuses to switch a row without a channel id", () => {
    expect(switchToSlackApp(webhook("x", "T0SAMPLE01", ""), "inst-1")).toBeNull();
  });

  it("switches back to the kept webhook, and not without one", () => {
    const previous = {
      url: HOOK,
      method: "post",
      skip_tls_verify: false,
      destination_type: "slack",
      metadata: { prebuilt_type: "slack", slack_channel_id: "C1" },
    };
    expect(switchBackToWebhook(app({ previous_webhook: previous }))).toEqual({
      name: "sre-prod-slack",
      type: "http",
      template: "prebuilt_slack",
      url: HOOK,
      method: "post",
      skip_tls_verify: false,
      destination_type_name: "slack",
      metadata: { prebuilt_type: "slack", slack_channel_id: "C1" },
    });
    expect(switchBackToWebhook(app())).toBeNull();
  });
});

describe("alert routes per channel (MK-6b)", () => {
  it("counts the Slack app destinations of one installation per channel", () => {
    const rows = [
      app({ name: "a", channel_id: "C9" }),
      app({ name: "b", channel_id: "C9" }),
      app({ name: "c", channel_id: "C2" }),
      app({ name: "d", channel_id: "C9", installation_id: "inst-2" }),
      webhook("w", "T0SAMPLE01", "C9"),
    ];
    expect(alertRoutesByChannel(rows, "inst-1")).toEqual({ C9: 2, C2: 1 });
  });
});

describe("on-call room (MK-20, option b)", () => {
  const destinations = [
    webhook("payments-oncall-slack", "T0SAMPLE01", "C7"),
    webhook("search-slack", "T0SAMPLE01", "C8"),
  ];
  const teams = [
    { team_id: "t1", team_name: "payments-oncall", destinations: ["payments-oncall-slack"] },
    { team_id: "t2", team_name: "search", destinations: [] },
  ];

  it("names the team and the destination that page into the channel", () => {
    expect(oncallRoomFor("C7", destinations, teams)).toEqual({
      team: "payments-oncall",
      destination: "payments-oncall-slack",
    });
  });

  it("is null for a channel no team pages into, even with a webhook there", () => {
    expect(oncallRoomFor("C8", destinations, teams)).toBeNull();
    expect(oncallRoomFor("", destinations, teams)).toBeNull();
  });
});

describe("save refusals", () => {
  const err = (status: number, data: unknown) => ({ response: { status, data } });

  it("reads the mixed-version guard", () => {
    expect(slackAppSaveRefusal(err(409, { code: "version_mismatch", message: "x" }))).toMatchObject(
      { kind: "version" },
    );
    expect(
      slackAppSaveRefusal(
        err(400, { message: "Nodes run 0.90 and 0.91. Upgrade every node first" }),
      ),
    ).toMatchObject({ kind: "version" });
  });

  it("reads the two required ticks", () => {
    expect(
      slackAppSaveRefusal(
        err(400, { code: "oncall_room_unconfirmed", team: "payments", destination: "p-slack" }),
      ),
    ).toEqual({
      kind: "oncall_room",
      code: "oncall_room_unconfirmed",
      team: "payments",
      destination: "p-slack",
    });
    expect(slackAppSaveRefusal(err(400, { code: "shared_channel_unconfirmed" }))).toEqual({
      kind: "shared",
      code: "shared_channel_unconfirmed",
    });
  });

  it("passes any other server message through", () => {
    expect(slackAppSaveRefusal(err(400, { message: "channel is archived" }))).toEqual({
      kind: "other",
      code: null,
      message: "channel is archived",
    });
    expect(slackAppSaveRefusal(new Error("boom"))).toEqual({
      kind: "other",
      code: null,
      message: null,
    });
  });

  it.each(["used_by_oncall", "slack_target", "slack_unavailable"])(
    "keeps the %s code on any other refusal",
    (code) => {
      expect(slackAppSaveRefusal(err(400, { code, message: "refused" }))).toEqual({
        kind: "other",
        code,
        message: "refused",
      });
    },
  );

  it("keeps the version_mismatch code", () => {
    expect(slackAppSaveRefusal(err(409, { code: "version_mismatch" }))).toEqual({
      kind: "version",
      code: "version_mismatch",
    });
  });
});
