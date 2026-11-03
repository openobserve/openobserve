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
import type { TranslateFn } from "@/types/i18n";
import type { ActiveDowntime } from "@/services/downtimes";
import type { AlertGroup } from "@/ts/interfaces/alert";
import {
  ackEventText,
  ackShortName,
  ackSuppressedBy,
  ackedCount,
  downtimeForGroup,
  groupRefLabels,
  historyStatusOf,
  isAckEventRow,
  unackedFiringCount,
  incidentAckToast,
  incidentStatusToast,
  pageAckWords,
  refusalToast,
} from "./ackState";

const t = i18n.global.t as unknown as TranslateFn;

const downtime = (groups?: string[]): ActiveDowntime => ({
  id: "d1",
  name: "Quick mute",
  ends_at: 1,
  alert_groups: groups ? groups.map((group_key) => ({ alert_id: "a1", group_key })) : null,
});

const group = (overrides: Partial<AlertGroup>): AlertGroup => ({ group_key: "g", ...overrides });

describe("ackState", () => {
  it("shortens an email to its local part", () => {
    expect(ackShortName("bob@acme.io")).toBe("bob");
    expect(ackShortName("service-account")).toBe("service-account");
  });

  it("reads an ack-suppressed run as Acknowledged and names who suppressed it", () => {
    const run = { status: "suppressed", acked_by: "bob@acme.io" };
    expect(isAckEventRow(run)).toBe(false);
    expect(historyStatusOf(run)).toBe("acknowledged");
    expect(ackSuppressedBy(run)).toBe("bob");
  });

  it("leaves an ordinary run's status alone", () => {
    const run = { status: "firing" };
    expect(historyStatusOf(run)).toBe("firing");
    expect(ackSuppressedBy(run)).toBeNull();
  });

  it("reads an ack event row as its own row, never as a suppressed run", () => {
    const event = { status: "ack_event", acked_by: "bob@acme.io", ack_action: "ack" };
    expect(isAckEventRow(event)).toBe(true);
    expect(historyStatusOf(event)).toBe("ack_event");
    expect(ackSuppressedBy(event)).toBeNull();
  });

  it("describes ack, unack and take-over events with their source", () => {
    expect(
      ackEventText({ status: "ack_event", acked_by: "bob@acme.io", ack_source: "slack" }, t),
    ).toBe("Acknowledged by bob@acme.io from Slack");
    expect(
      ackEventText(
        { status: "ack_event", acked_by: "bob@acme.io", ack_action: "unack", ack_source: "slack" },
        t,
      ),
    ).toBe("Unacknowledged by bob@acme.io from Slack");
    expect(
      ackEventText(
        {
          status: "ack_event",
          acked_by: "carol@acme.io",
          ack_action: "take_over",
          ack_source: "ui",
          taken_over_from: "bob@acme.io",
        },
        t,
      ),
    ).toBe("Taken over by carol@acme.io from bob@acme.io (OpenObserve)");
    expect(
      ackEventText({ status: "ack_event", acked_by: "dana@acme.io", ack_source: "oncall" }, t),
    ).toBe("Acknowledged by dana@acme.io from on-call");
  });

  it("applies a whole-alert mute to every group and a group mute only to its groups", () => {
    expect(downtimeForGroup(downtime(), "g1")?.id).toBe("d1");
    expect(downtimeForGroup(downtime(["g1"]), "g1")?.id).toBe("d1");
    expect(downtimeForGroup(downtime(["g1"]), "g2")).toBeNull();
    expect(downtimeForGroup(null, "g1")).toBeNull();
  });

  it("counts the firing groups nobody acknowledged", () => {
    const ack = {
      group_key: "g2",
      firing_started_at: 1,
      acked_by: "bob@acme.io",
      acked_at: 2,
      ack_source: "ui" as const,
    };
    const groups = [
      group({ group_key: "g1", last_outcome: "firing" }),
      group({ group_key: "g2", last_outcome: "firing", ack }),
      group({ group_key: "g3", last_outcome: "ok" }),
    ];
    expect(unackedFiringCount(groups)).toBe(1);
    expect(ackedCount(groups)).toBe(1);
  });

  it("reads group labels in every shape and returns null without them", () => {
    expect(groupRefLabels({ alert_id: "a", group_key: "k" })).toBeNull();
    expect(
      groupRefLabels({ alert_id: "a", group_key: "k", group_labels: "cluster=prod-ap" } as never),
    ).toBe("cluster=prod-ap");
    expect(
      groupRefLabels({
        alert_id: "a",
        group_key: "k",
        group_labels: [{ name: "cluster", value: "prod-ap" }],
      } as never),
    ).toBe("cluster=prod-ap");
    expect(
      groupRefLabels({
        alert_id: "a",
        group_key: "k",
        group_labels: { cluster: "prod-ap", region: "eu" },
      } as never),
    ).toBe("cluster=prod-ap, region=eu");
  });

  describe("the words a page's acknowledgement uses", () => {
    it.each([
      [
        "Platform",
        "alert",
        "Stops paging Platform. Shows as acknowledged on the alert.",
        "Restarts paging Platform at step 1",
        "Acknowledged · paging stopped for Platform",
        "Unacknowledged · paging restarts for Platform",
      ],
      [
        "Platform",
        "incident",
        "Stops paging Platform. Shows as acknowledged on the incident.",
        "Restarts paging Platform at step 1",
        "Acknowledged · paging stopped for Platform",
        "Unacknowledged · paging restarts for Platform",
      ],
      [
        "",
        "alert",
        "Shows as acknowledged on the alert.",
        "Restarts paging at step 1",
        "Acknowledged",
        "Unacknowledged · paging restarts",
      ],
      [
        "",
        "incident",
        "Shows as acknowledged on the incident.",
        "Restarts paging at step 1",
        "Acknowledged",
        "Unacknowledged · paging restarts",
      ],
    ])("team %j on an %s page", (team, subject, ackHint, unackHint, acked, unacked) => {
      const words = pageAckWords(team, subject, t);
      expect(words).toEqual({ ackHint, unackHint, acked, unacked });
    });
  });

  describe("the toast after an incident acknowledge", () => {
    const view = (who: string) => ({
      group_key: "",
      firing_started_at: 1,
      acked_by: who,
      acked_at: 1,
      ack_source: "incident" as const,
    });
    it("names the incident and the teams it stopped paging", () => {
      expect(
        incidentAckToast(
          {
            changed: true,
            acks: [view("me@acme.io")],
            oncall: {
              acknowledged: ["p1"],
              still_paging: [],
              stopped: [{ response_id: "p1", team: "Payments" }],
            },
            other_groups_unacked: 0,
          },
          "Checkout down",
          "me@acme.io",
          t,
        ),
      ).toEqual({
        variant: "success",
        message: "Acknowledged incident Checkout down · paging stopped for Payments",
      });
    });

    it.each([
      [[view("me@acme.io")], "me@acme.io", "Already acknowledged by you"],
      [[], "me@acme.io", "Already acknowledged"],
      [[view("ana@acme.io")], undefined, "Already acknowledged by ana@acme.io"],
    ])("does not call an unchanged acknowledge fresh %#", (acks, me, message) => {
      expect(
        incidentAckToast({ changed: false, acks, other_groups_unacked: 0 }, "Checkout down", me, t),
      ).toEqual({ variant: "info", message });
    });

    it("says an unacknowledge of an unacknowledged incident changed nothing", () => {
      expect(
        incidentStatusToast("open", { changed: false }, "Checkout down", "me@acme.io", t),
      ).toEqual({ variant: "info", message: "Checkout down was not acknowledged" });
    });

    it("says who was faster when it changed nothing", () => {
      expect(
        incidentAckToast(
          { changed: false, acks: [view("ana@acme.io")], other_groups_unacked: 0 },
          "Checkout down",
          "me@acme.io",
          t,
        ),
      ).toEqual({ variant: "info", message: "Already acknowledged by ana@acme.io" });
    });
  });

  it.each([
    ["ack", "You can't acknowledge this."],
    ["unack", "You can't unacknowledge this."],
    ["takeOver", "You can't take this over."],
    ["mute", "You can't mute this."],
  ] as const)("titles a %s refusal with its own verb", (verb, title) => {
    expect(
      refusalToast(
        {
          code: verb === "mute" ? "mute_refused" : "ack_refused",
          message: "m",
          rule: "role",
          on_call: [{ email: "bo@acme.io", team: "sre" }],
          can_act: [],
        },
        verb,
        t,
      ),
    ).toEqual({ variant: "error", title, message: "On call: bo@acme.io" });
  });
});
