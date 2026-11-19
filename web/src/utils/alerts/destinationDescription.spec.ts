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
import i18n from "@/locales";
import { describeDestinations } from "./destinationDescription";

const t = i18n.global.t as any;

describe("describeDestinations", () => {
  it.each([
    [
      "Slack app channel",
      { name: "a", type: "slack_app", channel_name: "k8s-alerts" },
      ["Slack app", "#k8s-alerts"],
    ],
    [
      "Slack webhook keeps its channel, never the hook URL",
      {
        name: "a",
        type: "http",
        url: "https://hooks.slack.com/services/T0/B0/secret",
        destination_type_name: "slack",
        metadata: JSON.stringify({ credential_channel: "#ops" }),
      },
      ["Slack webhook", "#ops"],
    ],
    [
      "prebuilt pager by its product name alone",
      {
        name: "a",
        type: "http",
        url: "https://events.pagerduty.com/v2/enqueue",
        destination_type_name: "pagerduty",
      },
      ["PagerDuty", null],
    ],
    [
      "plain webhook shows no address",
      { name: "a", type: "http", url: "http://127.0.0.1:18491/t/abc?token=x" },
      ["Webhook", null],
    ],
    [
      "email names the first recipient and counts the rest",
      { name: "a", type: "email", emails: ["a@x.io", "b@x.io", "c@x.io"] },
      ["Email", "a@x.io and 2 more"],
    ],
  ])("%s", (_case, destination, expected) => {
    const described = describeDestinations([destination, null], t);
    expect([described.a.type, described.a.target]).toEqual(expected);
  });
});
