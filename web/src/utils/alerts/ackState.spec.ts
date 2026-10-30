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
});
