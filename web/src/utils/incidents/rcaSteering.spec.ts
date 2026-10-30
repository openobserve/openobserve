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
import "@/locales";
import type { RcaSteerRecord } from "@/services/incidents";
import { RCA_T0, rcaSteerRecord, sec } from "@/test/unit/fixtures/rcaThread";
import {
  rcaHypothesisActions,
  rcaNeedSubject,
  rcaPendingHypothesisActions,
  rcaSteerOffersReanalyze,
  rcaSteerStatusLabel,
  rcaSteeredCount,
  rcaUnblockingAnswer,
} from "./rcaSteering";

describe("rcaSteerStatusLabel (04 SG38)", () => {
  it.each<[string, Partial<RcaSteerRecord>, string]>([
    ["queued", { status: "queued" }, "Queued · read after this turn"],
    ["delivered", { status: "delivered" }, "Queued · read after this turn"],
    ["read", { status: "read" }, "Read by the agent"],
    ["applied", { status: "applied" }, "Applied"],
    ["declined", { status: "declined" }, "Declined"],
    ["not_read", { status: "not_read" }, "Not read · the run ended first"],
    ["rejected without a reason", { status: "rejected" }, "Not sent"],
    [
      "rejected · finalizing",
      { status: "rejected", status_reason: "finalizing" },
      "Not sent · the agent was writing its report",
    ],
    [
      "rejected · no_active_turn",
      { status: "rejected", status_reason: "no_active_turn" },
      "Not sent · no step was running",
    ],
    [
      "rejected · agent_unreachable",
      { status: "rejected", status_reason: "agent_unreachable" },
      "Not sent · the agent could not be reached",
    ],
  ])("%s", (_name, overrides, label) => {
    expect(String(rcaSteerStatusLabel(rcaSteerRecord(overrides)))).toBe(label);
  });
});

describe("rcaSteerOffersReanalyze (04 SG40)", () => {
  it.each<[Partial<RcaSteerRecord>, boolean]>([
    [{ status: "rejected", status_reason: "finalizing" }, true],
    [{ status: "not_read" }, true],
    [{ status: "rejected", status_reason: "no_active_turn" }, false],
    [{ status: "rejected", status_reason: "run_completed" }, false],
    [{ status: "queued" }, false],
    [{ status: "read" }, false],
    [{ status: "applied" }, false],
    [{ status: "declined" }, false],
  ])("%o → %s", (overrides, offers) => {
    expect(rcaSteerOffersReanalyze(rcaSteerRecord(overrides))).toBe(offers);
  });
});

describe("rcaSteeredCount (frames F, G: steered N×)", () => {
  it("counts messages and actions that reached the agent; not answers, guidance, queued or refused rows", () => {
    const items = [
      rcaSteerRecord({ status: "delivered" }),
      rcaSteerRecord({ status: "read" }),
      rcaSteerRecord({ status: "applied" }),
      rcaSteerRecord({ status: "declined" }),
      rcaSteerRecord({ status: "queued" }),
      rcaSteerRecord({ status: "not_read" }),
      rcaSteerRecord({ status: "rejected", status_reason: "finalizing" }),
      rcaSteerRecord({ kind: "guidance", status: "read" }),
      rcaSteerRecord({ kind: "answer", status: "read" }),
      rcaSteerRecord({ kind: "hypothesis_action", action: "disprove", status: "applied" }),
    ];
    expect(rcaSteeredCount(items)).toBe(5);
  });
});

describe("rcaHypothesisActions (H16, SG31)", () => {
  it.each([
    ["untested", ["disprove", "test_first"]],
    ["testing", ["disprove", "test_first"]],
    ["likely", ["disprove", "test_first"]],
    ["confirmed", ["disprove"]],
    ["root_cause", ["disprove"]],
    ["ruled_out", ["reopen"]],
  ] as const)("%s → %o", (status, actions) => {
    expect(rcaHypothesisActions(status)).toEqual(actions);
  });
});

describe("rcaPendingHypothesisActions (H16)", () => {
  it("maps each hypothesis to the author of its oldest unread action", () => {
    const action = (
      hypothesis_id: string,
      author_email: string,
      status: RcaSteerRecord["status"],
    ) =>
      rcaSteerRecord({
        kind: "hypothesis_action",
        action: "disprove",
        hypothesis_id,
        author_email,
        status,
      });
    const pending = rcaPendingHypothesisActions([
      action("h1", "a.rao@acme.io", "queued"),
      action("h1", "j.okafor@acme.io", "delivered"),
      action("h2", "j.okafor@acme.io", "delivered"),
      action("h3", "a.rao@acme.io", "read"),
      rcaSteerRecord({ kind: "message", hypothesis_id: "h4" }),
    ]);
    expect(Object.fromEntries(pending)).toEqual({ h1: "a.rao", h2: "j.okafor" });
  });
});

describe("rcaUnblockingAnswer (SG39)", () => {
  it("returns the newest read answer; unread answers and messages do not count", () => {
    const older = rcaSteerRecord({ steer_id: "a1", kind: "answer", read_at: RCA_T0 + sec(10) });
    const newer = rcaSteerRecord({ steer_id: "a2", kind: "answer", read_at: RCA_T0 + sec(20) });
    const unread = rcaSteerRecord({ steer_id: "a3", kind: "answer", read_at: null });
    const message = rcaSteerRecord({ steer_id: "m1", read_at: RCA_T0 + sec(30) });
    expect(rcaUnblockingAnswer([older, newer, unread, message])?.steer_id).toBe("a2");
    expect(rcaUnblockingAnswer([unread, message])).toBeNull();
  });
});

describe("rcaNeedSubject (frame G, 04 §10.1)", () => {
  it.each<[string | null, string | null]>([
    ["Needs change history", "change history"],
    ["needs: deploy history ", "deploy history"],
    ["deploy time of checkout-api", "deploy time of checkout-api"],
    ["Needsless words", "Needsless words"],
    ["Needs", null],
    ["Needs:", null],
    ["  ", null],
    [null, null],
  ])("%j → %j", (need, subject) => {
    expect(rcaNeedSubject(need)).toBe(subject);
  });
});
