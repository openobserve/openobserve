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
import { createMultiViewDecoder, LOADED_THROUGH_TAG } from "./sessionReplayViews";

const ADD_NODE = 1;
const TEXT = 4;

const meta = (timestamp: number, href: string) => ({
  type: 4,
  timestamp,
  data: { href, width: 800, height: 600 },
});
const focus = (timestamp: number, hasFocus: boolean) => ({
  type: 6,
  timestamp,
  data: { has_focus: hasFocus },
});
// Ids: #document 0, HTML 1, BODY 2, DIV 3, #text 4 — the same ids in every view.
const snapshot = (timestamp: number, label: string) => ({
  type: 2,
  format: 1,
  timestamp,
  data: [
    [
      ADD_NODE,
      [null, "#document"],
      [1, "HTML"],
      [1, "BODY"],
      [1, "DIV", ["id", label]],
      [1, "#text", label],
    ],
  ],
});
const text = (timestamp: number, value: string) => ({
  type: 12,
  timestamp,
  data: [[TEXT, [4, value]]],
});
const interaction = (timestamp: number, kind: number) => ({
  type: 3,
  timestamp,
  data: { source: 2, type: kind, id: 3, x: 1, y: 1 },
});
const scroll = (timestamp: number) => ({
  type: 3,
  timestamp,
  data: { source: 3, id: 3, x: 0, y: 10 },
});
const input = (timestamp: number) => ({
  type: 3,
  timestamp,
  data: { source: 5, id: 3, text: "typed", isChecked: false },
});
const mouseMove = (timestamp: number) => ({
  type: 3,
  timestamp,
  data: { source: 1, positions: [{ x: 5, y: 5, id: 3, timeOffset: 0 }] },
});
const viewEnd = (timestamp: number) => ({ type: 7, timestamp });
const opening = (t: number, label: string, hasFocus = true) => [
  meta(t, `https://app.test/${label}`),
  focus(t, hasFocus),
  snapshot(t, label),
];
const segment = (viewId: string, index: number, records: any[]) => ({
  view: { id: viewId },
  index_in_view: index,
  start: records[0].timestamp,
  end: records[records.length - 1].timestamp,
  records,
});
const CLICK = 2;
const BLUR = 6;
const fullSnapshots = (events: any[]) => events.filter((e) => e.type === 2);
const textOf = (node: any): string =>
  node.type === 3 ? node.textContent : (node.childNodes ?? []).map(textOf).join("");
const withoutClock = (events: any[]) =>
  events.filter((e) => !(e.type === 5 && e.data?.tag === LOADED_THROUGH_TAG));

describe("createMultiViewDecoder", () => {
  it("decodes two views that both count ids from 0 into their own trees", () => {
    const decoder = createMultiViewDecoder();
    const { events } = decoder.push(
      [
        segment("A", 0, [...opening(1000, "A"), text(1500, "A2")]),
        segment("B", 0, [...opening(2000, "B"), text(2500, "B2")]),
        segment("A", 1, [text(3000, "A3"), interaction(4000, CLICK)]),
      ],
      Infinity,
    );

    const snaps = fullSnapshots(events);
    expect(snaps.map((s) => s.timestamp)).toEqual([1000, 2000, 4000]);
    expect(textOf(snaps[2].data.node)).toBe("A3");
    const mutationTimes = events
      .filter((e) => e.type === 3 && e.data.source === 0)
      .map((e) => e.timestamp);
    expect(mutationTimes).toEqual([1500, 2500]);
    expect(decoder.concurrent()).toBe(true);
  });

  it("does not switch to a view whose own snapshot was taken without focus", () => {
    const decoder = createMultiViewDecoder();
    decoder.push(
      [segment("A", 0, opening(1000, "A")), segment("B", 0, opening(2000, "B", false))],
      Infinity,
    );
    expect(decoder.switches().map((s) => s.viewId)).toEqual(["A"]);
  });

  it("never switches on programmatic scroll or Blur from an unfocused view", () => {
    const decoder = createMultiViewDecoder();
    decoder.push(
      [
        segment("A", 0, opening(1000, "A")),
        segment("B", 0, [...opening(2000, "B", false), scroll(2500), interaction(2600, BLUR)]),
      ],
      Infinity,
    );
    expect(decoder.switches().map((s) => s.viewId)).toEqual(["A"]);
  });

  it("switches on a click and emits Meta, rebuilt snapshot, then the last mouse position", () => {
    const decoder = createMultiViewDecoder();
    const { events } = decoder.push(
      [
        segment("A", 0, [...opening(1000, "A"), mouseMove(1100)]),
        segment("B", 0, opening(2000, "B")),
        segment("A", 1, [interaction(3000, CLICK)]),
      ],
      Infinity,
    );
    const at3000 = events.filter((e) => e.timestamp === 3000);
    expect(at3000.map((e) => e.type)).toEqual([4, 2, 3, 3]);
    expect(at3000[0].data.href).toBe("https://app.test/A");
    expect(at3000[2].data.source).toBe(1);
    expect(decoder.switches().at(-1)).toMatchObject({
      viewId: "A",
      reason: "activity",
      rebuilt: true,
      fromEnded: false,
    });
  });

  it("never switches on MouseMove alone", () => {
    const decoder = createMultiViewDecoder();
    decoder.push(
      [
        segment("A", 0, opening(1000, "A")),
        segment("B", 0, opening(2000, "B")),
        segment("A", 1, [mouseMove(3000)]),
      ],
      Infinity,
    );
    expect(decoder.switches().at(-1)?.viewId).toBe("B");
  });

  it("hands over at a ViewEnd without counting it as concurrent", () => {
    const decoder = createMultiViewDecoder();
    decoder.push(
      [
        segment("A", 0, [...opening(1000, "A"), viewEnd(3000)]),
        segment("B", 0, opening(3000, "B")),
      ],
      Infinity,
    );
    expect(decoder.switches().at(-1)).toMatchObject({ viewId: "B", fromEnded: true });
    expect(decoder.concurrent()).toBe(false);
  });

  it("hands over to the most recently used open view when the shown view ends", () => {
    const decoder = createMultiViewDecoder();
    const { events } = decoder.push(
      [
        segment("A", 0, [...opening(1000, "A"), viewEnd(2100)]),
        segment("B", 0, opening(1900, "B", false)),
      ],
      Infinity,
    );
    expect(decoder.switches().at(-1)).toMatchObject({
      viewId: "B",
      reason: "handover",
      rebuilt: true,
      fromEnded: true,
    });
    expect(fullSnapshots(events).map((e) => e.timestamp)).toEqual([1000, 2100]);
  });

  it("does not rebuild a background view when the next view of the same tab opens within the grace", () => {
    const decoder = createMultiViewDecoder();
    const { events } = decoder.push(
      [
        segment("A", 0, opening(1000, "A")),
        segment("B", 0, [...opening(2000, "B"), viewEnd(3000)]),
        segment("C", 0, opening(3001, "C")),
      ],
      Infinity,
    );
    const after = decoder.switches().filter((s) => s.at >= 3000);
    expect(after).toMatchObject([
      { viewId: "C", reason: "snapshot", rebuilt: false, fromEnded: true },
    ]);
    expect(fullSnapshots(events).filter((e) => e.timestamp === 3000)).toEqual([]);
  });

  it("hands over to the background view once the grace passes with no successor", () => {
    const decoder = createMultiViewDecoder();
    decoder.push(
      [
        segment("A", 0, opening(1000, "A")),
        segment("B", 0, [...opening(2000, "B"), viewEnd(3000)]),
      ],
      3500,
    );
    expect(decoder.switches().map((s) => s.viewId)).toEqual(["A", "B"]);
    decoder.push([segment("A", 1, [text(5000, "A2")])], Infinity);
    expect(decoder.switches().at(-1)).toMatchObject({
      at: 5000,
      viewId: "A",
      reason: "handover",
      rebuilt: true,
      fromEnded: true,
    });
  });

  it("replays views that follow each other in one tab without rebuilds", () => {
    const decoder = createMultiViewDecoder();
    decoder.push(
      [
        segment("A", 0, [...opening(1000, "A"), viewEnd(2000)]),
        segment("B", 0, [...opening(2000, "B"), viewEnd(3000)]),
        segment("C", 0, opening(3000, "C")),
      ],
      Infinity,
    );
    expect(decoder.switches().map((s) => [s.viewId, s.rebuilt])).toEqual([
      ["A", false],
      ["B", false],
      ["C", false],
    ]);
    expect(decoder.concurrent()).toBe(false);
  });

  it("re-stamps the last mouse position with a zero time offset", () => {
    const decoder = createMultiViewDecoder();
    const { events } = decoder.push(
      [
        segment("A", 0, [
          ...opening(1000, "A"),
          {
            type: 3,
            timestamp: 1100,
            data: { source: 1, positions: [{ x: 5, y: 5, id: 3, timeOffset: -40 }] },
          },
        ]),
        segment("B", 0, opening(2000, "B")),
        segment("A", 1, [interaction(3000, CLICK)]),
      ],
      Infinity,
    );
    const mouse = events.find((e) => e.timestamp === 3000 && e.data?.source === 1);
    expect(mouse.data.positions[0].timeOffset).toBe(0);
  });

  it("logs a missing tab when a view without its own snapshot is clicked, and keeps the shown view", () => {
    const decoder = createMultiViewDecoder();
    const { events } = decoder.push(
      [
        segment("A", 0, opening(1000, "A")),
        segment("B", 3, [interaction(2000, CLICK), text(2100, "x")]),
      ],
      Infinity,
    );
    expect(decoder.switches().at(-1)).toMatchObject({ viewId: "B", reason: "missing" });
    expect(withoutClock(events).filter((e) => e.timestamp >= 2000)).toEqual([]);
  });

  it("reuses an unchanged rebuild for a second return", () => {
    const decoder = createMultiViewDecoder();
    const { events } = decoder.push(
      [
        segment("A", 0, opening(1000, "A")),
        segment("B", 0, opening(2000, "B")),
        segment("A", 1, [interaction(3000, CLICK)]),
        segment("B", 1, [interaction(4000, CLICK)]),
        segment("A", 2, [interaction(5000, CLICK)]),
      ],
      Infinity,
    );
    const rebuiltA = fullSnapshots(events).filter(
      (e) => e.timestamp === 3000 || e.timestamp === 5000,
    );
    expect(rebuiltA[0].data).toBe(rebuiltA[1].data);
  });

  it("ignores records of a view after its ViewEnd", () => {
    const decoder = createMultiViewDecoder();
    let first: any[] = [];
    expect(() => {
      first = decoder.push(
        [segment("A", 0, [...opening(1000, "A"), viewEnd(2000), text(2100, "late")])],
        Infinity,
      ).events;
    }).not.toThrow();
    expect(withoutClock(first).some((e) => e.timestamp === 2100)).toBe(false);
    expect(withoutClock(decoder.push([], Infinity).events)).toEqual([]);
  });

  it("splitting the push at the watermark gives the same events as one push", () => {
    const segments = [
      segment("A", 0, [...opening(1000, "A"), text(1500, "a1"), text(2800, "a2")]),
      segment("B", 0, [...opening(2000, "B"), text(2500, "b1")]),
      segment("A", 1, [interaction(3000, CLICK), text(3500, "a3")]),
    ];
    const whole = withoutClock(createMultiViewDecoder().push(segments, Infinity).events);

    const split = createMultiViewDecoder();
    const first = split.push(segments.slice(0, 2), segments[2].start);
    const second = split.push(segments.slice(2), Infinity);
    expect(withoutClock([...first.events, ...second.events])).toEqual(whole);
  });

  it("holds records at or after the watermark until a later push releases them", () => {
    const segments = [
      segment("A", 0, [...opening(1000, "A"), text(1500, "a1"), text(2800, "a2")]),
      segment("B", 0, [...opening(2000, "B"), text(2500, "b1")]),
      segment("A", 1, [interaction(3000, CLICK), text(3500, "a3")]),
    ];
    const whole = withoutClock(createMultiViewDecoder().push(segments, Infinity).events);

    const decoder = createMultiViewDecoder();
    const first = decoder.push(segments, 3000);
    expect(withoutClock(first.events).some((e) => e.timestamp >= 3000)).toBe(false);
    expect(decoder.switches().some((sw) => sw.at === 3000)).toBe(false);

    const second = decoder.push([], Infinity);
    expect(fullSnapshots(second.events).some((e) => e.timestamp === 3000)).toBe(true);
    expect(withoutClock([...first.events, ...second.events])).toEqual(whole);
  });

  it("an idle shown view still advances the clock to the watermark", () => {
    const decoder = createMultiViewDecoder();
    const { events } = decoder.push(
      [
        segment("A", 0, opening(1000, "A")),
        segment("B", 0, [...opening(1200, "B", false), text(8000, "busy")]),
      ],
      10000,
    );
    expect(events.at(-1)).toMatchObject({
      type: 5,
      timestamp: 9999,
      data: { tag: LOADED_THROUGH_TAG },
    });
  });

  it("emits no clock record when the events already reach the loaded end", () => {
    const decoder = createMultiViewDecoder();
    const { events } = decoder.push([segment("A", 0, opening(1000, "A"))], Infinity);
    expect(events.some((e) => e.data?.tag === LOADED_THROUGH_TAG)).toBe(false);
  });

  it("single view equals the legacy single-converter output", async () => {
    const { createRecordConverter, dropChangesBeforeFirstSnapshot } =
      await import("./sessionReplayChangeFormat");
    const segments = [
      { records: [text(900, "orphan"), ...opening(1000, "A"), text(1500, "x")] },
      { records: [text(2000, "y"), interaction(2100, CLICK)] },
    ];
    const legacy = createRecordConverter();
    const expected = segments.flatMap((s, i) =>
      (i === 0 ? dropChangesBeforeFirstSnapshot(s.records) : s.records).flatMap((r: any) =>
        legacy.convert(r),
      ),
    );
    expect(withoutClock(createMultiViewDecoder().push(segments, Infinity).events)).toEqual(
      expected,
    );
  });

  it("marks a view stale from a missing index until its next snapshot", () => {
    const decoder = createMultiViewDecoder();
    const { events } = decoder.push(
      [segment("A", 0, opening(1000, "A")), segment("A", 2, [text(3000, "after-gap")])],
      Infinity,
    );
    expect(decoder.staleSpans()).toEqual([{ viewId: "A", from: 3000, to: null }]);
    expect(withoutClock(events).some((e) => e.timestamp === 3000)).toBe(false);
  });

  it("does not open a stale span for a view that already ended", () => {
    const decoder = createMultiViewDecoder();
    decoder.push(
      [
        segment("A", 0, [...opening(1000, "A"), viewEnd(2000)]),
        segment("A", 3, [text(3000, "after-end")]),
      ],
      Infinity,
    );
    expect(decoder.staleSpans()).toEqual([]);
  });

  it("a skip marker with a view id marks only that view, without one marks every view", () => {
    const one = createMultiViewDecoder();
    one.push(
      [
        segment("A", 0, opening(1000, "A")),
        segment("B", 0, opening(1100, "B")),
        { skipped: true, segmentId: "s", start: 2000, end: 2500, viewId: "A" },
      ],
      Infinity,
    );
    expect(one.staleSpans().map((s) => s.viewId)).toEqual(["A"]);

    const all = createMultiViewDecoder();
    all.push(
      [
        segment("A", 0, opening(1000, "A")),
        segment("B", 0, opening(1100, "B")),
        { skipped: true, segmentId: "s", start: 2000, end: 2500 },
      ],
      Infinity,
    );
    expect(
      all
        .staleSpans()
        .map((s) => s.viewId)
        .sort(),
    ).toEqual(["A", "B"]);
  });

  describe("implicit view ends from the manifest", () => {
    const pageLoads = () => [
      segment("A", 0, [...opening(1000, "A"), text(1300, "a-last")]),
      segment("B", 0, opening(2000, "B")),
    ];

    it("treats a view past its last manifest row as ended, so the next page load is not concurrent", () => {
      const decoder = createMultiViewDecoder();
      decoder.setViewEnds(
        new Map([
          ["A", 1300],
          ["B", 2000],
        ]),
      );
      decoder.push(pageLoads(), 2600);
      expect(decoder.switches().at(-1)).toMatchObject({
        viewId: "B",
        reason: "snapshot",
        fromEnded: true,
      });
      expect(decoder.concurrent()).toBe(false);

      const { events } = decoder.push([segment("A", 1, [interaction(2600, CLICK)])], Infinity);
      expect(decoder.switches().map((s) => s.viewId)).toEqual(["A", "B"]);
      expect(fullSnapshots(events)).toEqual([]);
    });

    it("without known ends (a live session) a page load without ViewEnd still looks concurrent", () => {
      const decoder = createMultiViewDecoder();
      decoder.push(pageLoads(), Infinity);
      expect(decoder.switches().at(-1)).toMatchObject({ viewId: "B", fromEnded: false });
      expect(decoder.concurrent()).toBe(true);
    });

    it("counts a known end equal to the next snapshot's time as ended", () => {
      const decoder = createMultiViewDecoder();
      decoder.setViewEnds(new Map([["A", 2000]]));
      decoder.push(
        [segment("A", 0, opening(1000, "A")), segment("B", 0, opening(2000, "B", false))],
        Infinity,
      );
      expect(decoder.switches().at(-1)).toMatchObject({ viewId: "B", fromEnded: true });
      expect(decoder.concurrent()).toBe(false);
    });

    it("hands over after the grace when the shown view passes its known end", () => {
      const decoder = createMultiViewDecoder();
      decoder.setViewEnds(
        new Map([
          ["A", 2000],
          ["B", 4000],
        ]),
      );
      const { events } = decoder.push(
        [
          segment("A", 0, [...opening(1000, "A"), text(2000, "a-last")]),
          segment("B", 0, [...opening(1500, "B", false), text(4000, "b-later")]),
        ],
        Infinity,
      );
      expect(decoder.switches()).toMatchObject([
        { viewId: "A" },
        { at: 4000, viewId: "B", reason: "handover", rebuilt: true, fromEnded: true },
      ]);
      expect(decoder.concurrent()).toBe(false);
      expect(fullSnapshots(events).map((e) => e.timestamp)).toEqual([1000, 4000]);
    });
  });

  it("a bfcache restore stamped before the old view's ViewEnd is not counted as concurrent", () => {
    const decoder = createMultiViewDecoder();
    decoder.push(
      [segment("A", 0, [...opening(0, "A"), viewEnd(1003)]), segment("B", 0, opening(1000, "B"))],
      Infinity,
    );
    expect(decoder.switches().at(-1)).toMatchObject({ viewId: "B", fromEnded: true });
    expect(decoder.concurrent()).toBe(false);
  });

  it("stamps an end-of-push hand-over after the clock an earlier push emitted", () => {
    const decoder = createMultiViewDecoder();
    const first = decoder.push(
      [
        segment("A", 0, [...opening(1000, "A"), viewEnd(2000)]),
        segment("B", 0, opening(1500, "B", false)),
      ],
      5000,
    );
    expect(first.events.at(-1)).toMatchObject({ type: 5, timestamp: 4999 });
    const second = decoder.push([], Infinity);
    const handOver = decoder.switches().at(-1)!;
    expect(handOver).toMatchObject({ viewId: "B", reason: "handover" });
    expect(handOver.at).toBeGreaterThan(4999);
    expect(fullSnapshots(second.events).map((e) => e.timestamp)).toEqual([handOver.at]);
  });

  it("a skip marker without a view id does not open a span on a view that already ended", () => {
    const decoder = createMultiViewDecoder();
    decoder.push(
      [
        segment("A", 0, [...opening(1000, "A"), viewEnd(1500)]),
        segment("B", 0, opening(1100, "B")),
        { skipped: true, segmentId: "s", start: 2000, end: 2500 },
      ],
      Infinity,
    );
    expect(decoder.staleSpans().map((s) => s.viewId)).toEqual(["B"]);
  });

  describe("presence signals that return to a view", () => {
    const returnOn = (trigger: any) => {
      const decoder = createMultiViewDecoder();
      decoder.push(
        [
          segment("A", 0, opening(1000, "A")),
          segment("B", 0, opening(2000, "B")),
          segment("A", 1, [trigger]),
        ],
        Infinity,
      );
      return decoder.switches().at(-1);
    };

    it("returns on Focus with has_focus true", () => {
      expect(returnOn(focus(3000, true))).toMatchObject({ viewId: "A", reason: "focus" });
    });

    it("returns on Scroll in a focused view", () => {
      expect(returnOn(scroll(3000))).toMatchObject({ viewId: "A", reason: "activity" });
    });

    it("returns on Input in a focused view", () => {
      expect(returnOn(input(3000))).toMatchObject({ viewId: "A", reason: "activity" });
    });

    it.each([1, 3, 4, 7])("returns on MouseInteraction type %i", (kind) => {
      expect(returnOn(interaction(3000, kind))).toMatchObject({ viewId: "A", reason: "activity" });
    });

    it.each([0, 5, 6, 9])("does not return on MouseInteraction type %i", (kind) => {
      expect(returnOn(interaction(3000, kind))).toMatchObject({ viewId: "B" });
    });
  });

  describe("hand-over grace", () => {
    it("keeps a pending hand-over across a finite watermark and lets the successor take it", () => {
      const decoder = createMultiViewDecoder();
      decoder.push(
        [
          segment("A", 0, opening(1000, "A")),
          segment("B", 0, [...opening(2000, "B"), viewEnd(3000)]),
        ],
        3200,
      );
      const { events } = decoder.push([segment("C", 0, opening(3300, "C"))], Infinity);
      expect(decoder.switches().filter((s) => s.at >= 3000)).toMatchObject([
        { viewId: "C", reason: "snapshot", rebuilt: false, fromEnded: true },
      ]);
      expect(fullSnapshots(events).map((e) => e.timestamp)).toEqual([3300]);
    });

    it("a presence return inside the grace cancels the pending hand-over", () => {
      const decoder = createMultiViewDecoder();
      decoder.push(
        [
          segment("A", 0, opening(1000, "A")),
          segment("B", 0, [...opening(2000, "B"), viewEnd(3000)]),
          segment("A", 1, [interaction(3500, CLICK), text(6000, "later")]),
        ],
        Infinity,
      );
      expect(decoder.switches().filter((s) => s.at >= 3000)).toMatchObject([
        { at: 3500, viewId: "A", reason: "activity", fromEnded: true },
      ]);
    });

    it("a successor snapshot after the grace takes over directly when no other view is open", () => {
      const decoder = createMultiViewDecoder();
      const { events } = decoder.push(
        [
          segment("A", 0, [...opening(1000, "A"), viewEnd(2000)]),
          segment("C", 0, opening(4000, "C")),
        ],
        Infinity,
      );
      expect(decoder.switches()).toMatchObject([
        { viewId: "A" },
        { at: 4000, viewId: "C", reason: "snapshot", rebuilt: false, fromEnded: true },
      ]);
      expect(fullSnapshots(events).map((e) => e.timestamp)).toEqual([1000, 4000]);
    });

    it("a successor snapshot after the grace follows the hand-over to an open view", () => {
      const decoder = createMultiViewDecoder();
      decoder.push(
        [
          segment("A", 0, opening(1000, "A", false)),
          segment("B", 0, [...opening(2000, "B"), viewEnd(3000)]),
          segment("C", 0, opening(4500, "C")),
        ],
        Infinity,
      );
      expect(decoder.switches().filter((s) => s.at >= 3000)).toMatchObject([
        { at: 4500, viewId: "A", reason: "handover", fromEnded: true },
        { at: 4500, viewId: "C", reason: "snapshot", fromEnded: false },
      ]);
    });
  });
});
