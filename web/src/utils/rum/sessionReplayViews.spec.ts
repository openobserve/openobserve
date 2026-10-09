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
    expect(() =>
      decoder.push(
        [segment("A", 0, [...opening(1000, "A"), viewEnd(2000), text(2100, "late")])],
        Infinity,
      ),
    ).not.toThrow();
    expect(withoutClock(decoder.push([], Infinity).events)).toEqual([]);
  });
});
