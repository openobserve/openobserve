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
import type { OnCallResponseEvent, ResponseEventKind } from "@/ts/interfaces/oncall";
import type { TranslateFn } from "@/types/i18n";
import {
  mergeTimelineEvents,
  testPageOutcome,
  timelineSentence,
  timelineStamp,
} from "@/utils/oncall";

const t = i18n.global.t as unknown as TranslateFn;
const TEAM = "3JLu2gX36MBdlQC54gmuy1cGHVf";
const ctx = {
  nameOf: (email: string) => (email === "ana@o2.ai" ? "Ana Ruiz" : email),
  teamNameOf: (id: string) => (id === TEAM ? "Checkout" : null),
};

const event = (kind: ResponseEventKind, body: string, over: Partial<OnCallResponseEvent> = {}) =>
  ({ kind, body, at: 0, actor: "o2-engine", ...over }) as OnCallResponseEvent;

const say = (kind: ResponseEventKind, body: string) =>
  String(timelineSentence(event(kind, body), ctx, t));

describe("timelineSentence", () => {
  // Wording taken from real pages on the pentest instance and the engine's own format strings.
  it.each([
    ["page", "paged ana@o2.ai", "Paged Ana Ruiz"],
    ["page", "paged ana@o2.ai, bo@o2.ai", "Paged Ana Ruiz, bo@o2.ai"],
    ["page", "paged ana@o2.ai (bo@o2.ai unreachable)", "Paged Ana Ruiz · couldn't reach bo@o2.ai"],
    ["page", "could not reach ana@o2.ai", "Couldn't reach Ana Ruiz"],
    ["page", "paged nobody", "Nobody was paged"],
    [
      "page",
      "nobody matched whoever is on call in Secondary",
      "Secondary seat was empty — nobody paged",
    ],
    ["page", "nobody matched the whole team", "This step had nobody to page"],
    ["ack", "ana@o2.ai acknowledged", "Acknowledged"],
    // The actor heads the line already, so a takeover starts at the verb rather than naming them twice.
    [
      "ack",
      "bo@o2.ai acknowledged, taking over from ana@o2.ai",
      "Acknowledged, taking over from Ana Ruiz",
    ],
    [
      "handoff",
      "ana@o2.ai handed off to Checkout: over to you",
      "Handed off to Checkout: over to you",
    ],
    ["state", "resolved: recovered automatically", "Alert stopped firing — resolved automatically"],
    [
      "state",
      "resolved — config_change_or_deploy: rolled back",
      "Resolved · Config change or deploy: rolled back",
    ],
    ["state", "resolved", "Resolved"],
    ["recovery", "the alert stopped firing", "Alert stopped firing"],
    [
      "exhausted",
      "escalation ladder exhausted with no acknowledgement",
      "Every step ran and nobody acknowledged",
    ],
    [
      "sys",
      "opened for alert/3KGMcsdq6K4B29SoZ1XLpyUMpmY#9: pt15090_t3_enter_key",
      "Opened · firing #9",
    ],
    [
      "sys",
      `no ownership rule covers service=test; no ownership rule matched, so it went to the default team ${TEAM}`,
      "No routing rule covers service=test — sent to the default team Checkout",
    ],
    [
      "sys",
      "triage budget expired with no verdict; paging as normal",
      "AI triage took too long — paged as usual",
    ],
    ["sys", "escalated on request by ana@o2.ai", "Ana Ruiz escalated to the next step"],
    [
      "sys",
      `routed to ${TEAM} by ownership rule service=checkout`,
      "Routed to Checkout by ownership rule service=checkout",
    ],
    [
      "sys",
      "routed to 3LMMZqmKH4Gmb1vCuuyiagLPocX by ownership rule service=sv-core-a",
      "Routed to a deleted team by ownership rule service=sv-core-a",
    ],
    [
      "sys",
      "routed to Payments by the alert's own setting",
      "Routed to Payments by the alert's own setting",
    ],
  ] as [ResponseEventKind, string, string][])("%s: %s", (kind, body, expected) => {
    expect(say(kind, body)).toBe(expected);
  });

  /// Wording the client does not know still reads as a sentence, with ids and emails swapped for names.
  it("falls back to the server's text with names swapped in", () => {
    expect(say("sys", `posted to the channel of ${TEAM} for ana@o2.ai`)).toBe(
      "Posted to the channel of Checkout for Ana Ruiz",
    );
  });
});

describe("mergeTimelineEvents", () => {
  it("drops the recovery line the automatic resolve repeats", () => {
    const merged = mergeTimelineEvents([
      event("page", "paged ana@o2.ai"),
      event("recovery", "the alert stopped firing"),
      event("state", "resolved: recovered automatically"),
    ]);
    expect(merged.map((e) => e.kind)).toEqual(["page", "state"]);
  });

  it("keeps a recovery that a person then resolved", () => {
    const merged = mergeTimelineEvents([
      event("recovery", "the alert stopped firing"),
      event("state", "resolved — config_change_or_deploy"),
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("timelineStamp", () => {
  const OPENED = Date.UTC(2026, 10, 3, 14, 37) * 1000;
  const NOW = OPENED + 3_600_000_000;

  it("says the clock time alone for the first minute", () => {
    expect(timelineStamp(OPENED + 10_000_000, OPENED, NOW, "UTC")).toBe("14:37");
  });

  it("adds the offset from when the page opened", () => {
    expect(timelineStamp(OPENED + 120_000_000, OPENED, NOW, "UTC")).toBe("14:39 · +2m");
  });

  /// The opening line already carries the date, so a later line of an old page is just its clock.
  it("drops the date from later lines of a page opened on an earlier day", () => {
    const later = NOW + 5 * 86_400_000_000;
    expect(timelineStamp(OPENED, OPENED, later, "UTC")).toBe("Nov 3, 2026, 14:37");
    expect(timelineStamp(OPENED + 120_000_000, OPENED, later, "UTC")).toBe("14:39 · +2m");
  });
});

describe("testPageOutcome", () => {
  it("is landed only when a send was delivered", () => {
    const attempt = (delivered: boolean) => ({
      channel: "email" as const,
      recipient: "a",
      reason: "",
      delivered,
    });
    expect(
      testPageOutcome({ reached_anyone: true, channels: [], attempts: [attempt(true)] }, t).landed,
    ).toBe(true);
    expect(
      testPageOutcome({ reached_anyone: false, channels: [], attempts: [attempt(false)] }, t)
        .landed,
    ).toBe(false);
    expect(
      String(
        testPageOutcome(
          { reached_anyone: false, not_sent_because: "nobody on call", channels: [], attempts: [] },
          t,
        ).message,
      ),
    ).toContain("nobody on call");
  });
});
