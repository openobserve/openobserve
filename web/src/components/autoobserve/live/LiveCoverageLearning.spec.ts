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
import { gt } from "@/types/i18n";
import {
  coverageLearningText,
  learningReasonText,
  learningSummary,
  learningWaiting,
  serviceLearning,
  streamLearningList,
  type LearningStream,
} from "./LiveCoverageLearning";

const NOW = Date.UTC(2026, 10, 12, 12);
const DAY_US = 86_400_000_000;
const ZONE = { locale: "en-US", timeZone: "UTC" };
const NOV_20_US = Date.UTC(2026, 10, 20, 12) * 1000;

const stream = (name: string, over: Partial<LearningStream> = {}): LearningStream => ({
  type: "logs",
  name,
  ...over,
});
const young = (name: string, found = 6) =>
  stream(name, { reason: "young", history_days_found: found, learning_until: NOV_20_US });
const kept = stream("kept", {
  reason: "retention_short",
  history_days_found: 4,
  learning_until: NOV_20_US,
});
const VIEW = {
  streams_learning: 1,
  streams_ready: 3,
  history_days_needed: 14,
  next_ready_at: NOV_20_US,
};
const say = (text: unknown) => String(text);

describe("LiveCoverageLearning", () => {
  it.each([
    ["gathering", [young("a")], true],
    ["short retention", [stream("r", { reason: "retention_short" })], true],
    ["no usage", [stream("u", { reason: "no_usage" })], true],
    ["ready", [stream("done", { learning_until: NOW * 1000 - DAY_US })], false],
    ["no streams", [], false],
  ])("a service with %s streams is learning: %s", (_, streams, expected) => {
    expect(serviceLearning(streams as LearningStream[], NOW)).toBe(expected);
  });

  it("names the found days and first ready date, counting a stream two services list once", () => {
    const text = say(
      learningReasonText(gt, ZONE, VIEW, [young("a", 3), young("b", 9), young("b", 9)], NOW),
    );
    expect(text).toMatch(/\b2 streams\b/);
    expect(text).toMatch(/\b9 of 14\b/);
    expect(text).toContain("Nov 20");
    const org = { ...VIEW, streams_learning: 2, streams_ready: 0, history_days_found_max: 9 };
    const waiting = say(
      learningWaiting(gt, ZONE, { ...org, reasons: { young: 2 } }, [], NOW)?.desc,
    );
    expect(waiting).toMatch(/\b2 streams .*\b9 of 14\b.*Nov 20/);
  });

  const WAITING = { ...VIEW, streams_ready: 0, history_days_found_max: 4 };
  it.each([
    ["a listed stream", WAITING, [kept], /less than 14 days/],
    [
      "only the org-wide count",
      { ...WAITING, reasons: { retention_short: 1 } },
      [],
      /less than 14/,
    ],
    ["only the org-wide usage", { ...WAITING, reasons: { no_usage: 1 } }, [], /usage reporting/],
    [
      "an org-wide mix",
      { ...WAITING, streams_learning: 2, reasons: { young: 1, retention_short: 1 } },
      [],
      /gathering history\. .*less than 14/,
    ],
  ])(
    "never gives short retention or missing usage a ready date, from %s",
    (_, view, streams, why) => {
      const lines = [
        learningSummary(gt, ZONE, view, streams, NOW),
        learningWaiting(gt, ZONE, view, streams, NOW)?.desc,
      ].map(say);
      for (const line of lines) {
        expect(line).toMatch(why);
        expect(line).not.toContain("Nov 20");
      }
    },
  );

  it("explains missing usage reporting even before any stream is listed", () => {
    const off = { ...VIEW, streams_learning: 0, streams_ready: 0, next_ready_at: null };
    const view = { ...off, history_days_found_max: 0, reasons: { no_usage: 0 } };
    expect(say(learningSummary(gt, ZONE, view, [], NOW))).toMatch(/usage reporting/);
    expect(say(learningWaiting(gt, ZONE, view, [], NOW)?.desc)).toMatch(/usage reporting/);
    expect(learningWaiting(gt, ZONE, off, [], NOW)).toBeNull();
  });

  it("says what warm start learned once nothing is left to wait for", () => {
    const view = { ...VIEW, streams_learning: 0, history_days_found_max: 30 };
    expect(say(learningReasonText(gt, ZONE, view, [stream("ready")], NOW))).toMatch(/\b30 days\b/);
  });

  it("falls back to the ready-date lines on a server that sends no reasons", () => {
    const old = [stream("a", { learning_until: NOV_20_US }), stream("b")];
    expect(learningReasonText(gt, ZONE, VIEW, old, NOW)).toBeNull();
    expect(say(learningSummary(gt, ZONE, { ...VIEW, streams_learning: 9 }, [], NOW))).toMatch(
      /\b9 streams\b/,
    );
    expect(say(coverageLearningText(gt, ZONE, VIEW, old, NOW))).toMatch(/^1 stream .*Nov 20/);
    expect(coverageLearningText(gt, ZONE, VIEW, [stream("b")], NOW)).toBeNull();
  });

  it("lists a service's streams soonest first, the undated ones last, each with its own reason", () => {
    const list = streamLearningList(gt, ZONE, [kept, young("a"), stream("ready")], 14, NOW);
    expect(list?.rows.map((r) => r.stream)).toEqual(["a (logs)", "kept (logs)"]);
    expect(say(list?.rows[0].text)).toContain("Nov 20");
    expect(say(list?.rows[1].text)).not.toContain("Nov 20");
    const one = streamLearningList(gt, ZONE, [kept], 14, NOW);
    expect(one?.rows).toEqual([]);
    expect(say(one?.summary)).toContain("kept (logs)");
    const day = (d: number) => Date.UTC(2026, 10, d, 8) * 1000;
    const dated = streamLearningList(
      gt,
      ZONE,
      [21, 20].map((d) => stream(`s${d}`, { learning_until: day(d) })),
      14,
      NOW,
    );
    expect(dated?.rows.map((r) => say(r.text))).toEqual([
      expect.stringContaining("Nov 20"),
      expect.stringContaining("Nov 21"),
    ]);
  });
});
