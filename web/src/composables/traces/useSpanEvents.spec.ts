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
  normalizeSpanEvents,
  toSpanEventMarkers,
  truncateEventName,
  EVENT_NAME_MAX_CHARS,
  clusterSpanEventMarkers,
  summarizeSpanEvents,
  type SpanEventSeverity,
} from "@/composables/traces/useSpanEvents";

// Mirrors the real fixtures in SpanBlock.spec.ts: trace timing is microseconds,
// event timestamps are nanoseconds.
const TRACE_START_US = 1752490492843000;
const TRACE_DURATION_US = 350372;

/** Nanosecond timestamp for an event at `fraction` through the trace window. */
const eventNsAt = (fraction: number) => (TRACE_START_US + TRACE_DURATION_US * fraction) * 1000;

describe("normalizeSpanEvents", () => {
  it("converts the stored nanosecond timestamp to microseconds", () => {
    const [event] = normalizeSpanEvents([{ name: "cache.miss", _timestamp: 1752490492930593000 }]);

    expect(event.tsUs).toBe(1752490492930593);
  });

  it("accepts the JSON string form the backend stores", () => {
    const events = normalizeSpanEvents(
      JSON.stringify([
        { name: "a", _timestamp: eventNsAt(0.1) },
        { name: "b", _timestamp: eventNsAt(0.2) },
      ]),
    );

    expect(events.map((e) => e.name)).toEqual(["a", "b"]);
  });

  it("accepts an already-parsed array", () => {
    expect(normalizeSpanEvents([{ name: "a", _timestamp: eventNsAt(0.5) }])).toHaveLength(1);
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["empty string", ""],
    ["whitespace", "   "],
    ["a JSON object rather than an array", '{"name":"a"}'],
    ["null", null],
    ["undefined", undefined],
  ])("returns no events for %s", (_label, input) => {
    expect(normalizeSpanEvents(input)).toEqual([]);
  });

  it("skips events whose timestamp is missing or non-numeric", () => {
    const events = normalizeSpanEvents([
      { name: "kept", _timestamp: eventNsAt(0.5) },
      { name: "no timestamp" },
      { name: "unparseable", _timestamp: "abc" },
    ]);

    expect(events.map((e) => e.name)).toEqual(["kept"]);
  });

  it("preserves the original array index so a marker maps onto its table row", () => {
    const events = normalizeSpanEvents([
      { name: "skipped" },
      { name: "second", _timestamp: eventNsAt(0.5) },
    ]);

    expect(events[0].index).toBe(1);
  });

  it("detects an exception by event name", () => {
    const [event] = normalizeSpanEvents([{ name: "exception", _timestamp: eventNsAt(0.5) }]);

    expect(event.severity).toBe("error");
  });

  it("detects an exception by flattened exception.* attributes", () => {
    const [event] = normalizeSpanEvents([
      { name: "error.raised", _timestamp: eventNsAt(0.5), "exception.message": "boom" },
    ]);

    expect(event.severity).toBe("error");
  });

  it("exposes exception.type, falling back to the event name", () => {
    const [withType, withoutType] = normalizeSpanEvents([
      { name: "exception", _timestamp: eventNsAt(0.2), "exception.type": "TimeoutError" },
      { name: "exception", _timestamp: eventNsAt(0.4) },
    ]);

    expect(withType.exceptionType).toBe("TimeoutError");
    expect(withoutType.exceptionType).toBe("exception");
  });

  it("treats an ordinary event as non-exception", () => {
    const [event] = normalizeSpanEvents([{ name: "cache.miss", _timestamp: eventNsAt(0.5) }]);

    expect(event.severity).toBe("info");
  });

  it("reads a configured timestamp column, falling back to _timestamp", () => {
    const configured = normalizeSpanEvents([{ name: "a", ts: eventNsAt(0.5) }], "ts");
    const fallback = normalizeSpanEvents([{ name: "a", _timestamp: eventNsAt(0.5) }], "ts");

    expect(configured).toHaveLength(1);
    expect(fallback).toHaveLength(1);
  });
});

describe("toSpanEventMarkers", () => {
  const window = { startUs: TRACE_START_US, durationUs: TRACE_DURATION_US };

  it("positions events as a percentage through the window", () => {
    const markers = toSpanEventMarkers(
      normalizeSpanEvents([
        { name: "quarter", _timestamp: eventNsAt(0.25) },
        { name: "three-quarters", _timestamp: eventNsAt(0.75) },
      ]),
      window,
    );

    expect(markers.map((m) => m.left)).toEqual([25, 75]);
  });

  // Regression test for PR #13195: it compared a nanosecond event timestamp
  // against a microsecond window, so every marker landed ~1000x outside the
  // window and was silently dropped — the feature rendered nothing.
  it("keeps nanosecond timestamps inside the microsecond window", () => {
    const markers = toSpanEventMarkers(
      normalizeSpanEvents([{ name: "mid", _timestamp: eventNsAt(0.5) }]),
      window,
    );

    expect(markers).toHaveLength(1);
    expect(markers[0].left).toBeCloseTo(50, 5);
  });

  it("drops events outside the window rather than clamping them", () => {
    const markers = toSpanEventMarkers(
      normalizeSpanEvents([
        { name: "before", _timestamp: eventNsAt(-0.1) },
        { name: "after", _timestamp: eventNsAt(1.1) },
        { name: "inside", _timestamp: eventNsAt(0.5) },
      ]),
      window,
    );

    expect(markers.map((m) => m.name)).toEqual(["inside"]);
  });

  it("keeps events exactly on the window boundaries", () => {
    const markers = toSpanEventMarkers(
      normalizeSpanEvents([
        { name: "start", _timestamp: eventNsAt(0) },
        { name: "end", _timestamp: eventNsAt(1) },
      ]),
      window,
    );

    expect(markers.map((m) => m.left)).toEqual([0, 100]);
  });

  // gen_ai.* events are built with `_timestamp: 0` in the OTel processor, which
  // is a real time far before any trace window rather than a usable offset.
  it("drops zero timestamps instead of pinning them to the window start", () => {
    const markers = toSpanEventMarkers(
      normalizeSpanEvents([{ name: "gen_ai.choice", _timestamp: 0 }]),
      window,
    );

    expect(markers).toEqual([]);
  });

  it.each([
    ["a zero duration", { startUs: TRACE_START_US, durationUs: 0 }],
    ["a negative duration", { startUs: TRACE_START_US, durationUs: -1 }],
    ["a non-numeric window", { startUs: NaN, durationUs: NaN }],
    ["an undefined window", undefined as any],
  ])("returns no markers for %s", (_label, badWindow) => {
    const events = normalizeSpanEvents([{ name: "a", _timestamp: eventNsAt(0.5) }]);

    expect(toSpanEventMarkers(events, badWindow)).toEqual([]);
  });

  it("gives co-located events distinct keys via their index", () => {
    const markers = toSpanEventMarkers(
      normalizeSpanEvents([
        { name: "a", _timestamp: eventNsAt(0.5) },
        { name: "b", _timestamp: eventNsAt(0.5) },
      ]),
      window,
    );

    expect(markers[0].key).not.toBe(markers[1].key);
  });

  it("positions the same event differently for a span window than a trace window", () => {
    const events = normalizeSpanEvents([{ name: "mid-trace", _timestamp: eventNsAt(0.5) }]);
    // A span covering the second half of the trace: the same event sits at the
    // trace's midpoint but at this span's start.
    const spanWindow = {
      startUs: TRACE_START_US + TRACE_DURATION_US * 0.5,
      durationUs: TRACE_DURATION_US * 0.5,
    };

    expect(toSpanEventMarkers(events, window)[0].left).toBeCloseTo(50, 5);
    expect(toSpanEventMarkers(events, spanWindow)[0].left).toBeCloseTo(0, 5);
  });
});

describe("severity resolution", () => {
  it("treats an OTel exception event as error", () => {
    const [event] = normalizeSpanEvents([
      { name: "exception", "exception.type": "IOError", _timestamp: eventNsAt(0.5) },
    ]);

    expect(event.severity).toBe("error");
  });

  it("treats an exception.* attribute as error even when the name differs", () => {
    const [event] = normalizeSpanEvents([
      { name: "request failed", "exception.message": "boom", _timestamp: eventNsAt(0.5) },
    ]);

    expect(event.severity).toBe("error");
  });

  // Regression: 8 events in the `default` stream are level=ERROR with no
  // exception.* attribute. Exception-only detection rendered them benign.
  it("treats level=ERROR as error even with no exception attribute", () => {
    const [event] = normalizeSpanEvents([
      { name: "search failed", level: "ERROR", _timestamp: eventNsAt(0.5) },
    ]);

    expect(event.severity).toBe("error");
  });

  it("accepts severity_text as an alias for level", () => {
    const [event] = normalizeSpanEvents([
      { name: "slow", severity_text: "WARN", _timestamp: eventNsAt(0.5) },
    ]);

    expect(event.severity).toBe("warning");
  });

  it("resolves level case-insensitively", () => {
    const [event] = normalizeSpanEvents([
      { name: "oops", level: "fatal", _timestamp: eventNsAt(0.5) },
    ]);

    expect(event.severity).toBe("error");
  });

  it("defaults to info for the overwhelmingly common INFO event", () => {
    const [event] = normalizeSpanEvents([
      { name: "cache hit", level: "INFO", _timestamp: eventNsAt(0.5) },
    ]);

    expect(event.severity).toBe("info");
  });

  it("defaults to info when no severity field is present at all", () => {
    const [event] = normalizeSpanEvents([{ name: "Sent", _timestamp: eventNsAt(0.5) }]);

    expect(event.severity).toBe("info");
  });

  it("prefers the exception signal over a contradicting level", () => {
    const [event] = normalizeSpanEvents([
      { name: "exception", level: "INFO", _timestamp: eventNsAt(0.5) },
    ]);

    expect(event.severity).toBe("error");
  });
});

describe("window edge tolerance", () => {
  // Regression: `duration` is integer microseconds, so a span's computed end is
  // up to 1us short of its true end. A `ResponseReceived` event firing at the
  // real end lands just past 100% and used to be dropped.
  const SPAN_START_US = 1752490492843000;
  const SPAN_DURATION_US = 1326;

  it("clamps an event that overshoots the window end by less than a microsecond", () => {
    const markers = toSpanEventMarkers(
      [
        {
          index: 0,
          name: "ResponseReceived",
          tsUs: SPAN_START_US + SPAN_DURATION_US + 0.256,
          severity: "info",
          exceptionType: "ResponseReceived",
        },
      ],
      { startUs: SPAN_START_US, durationUs: SPAN_DURATION_US },
    );

    expect(markers).toHaveLength(1);
    expect(markers[0].left).toBe(100);
  });

  it("clamps an event that undershoots the window start by less than a microsecond", () => {
    const markers = toSpanEventMarkers(
      [
        {
          index: 0,
          name: "Enqueued",
          tsUs: SPAN_START_US - 0.256,
          severity: "info",
          exceptionType: "Enqueued",
        },
      ],
      { startUs: SPAN_START_US, durationUs: SPAN_DURATION_US },
    );

    expect(markers).toHaveLength(1);
    expect(markers[0].left).toBe(0);
  });

  it("still drops an event that is genuinely outside the window", () => {
    const markers = toSpanEventMarkers(
      [
        {
          index: 0,
          name: "unrelated",
          tsUs: SPAN_START_US + SPAN_DURATION_US * 3,
          severity: "info",
          exceptionType: "unrelated",
        },
      ],
      { startUs: SPAN_START_US, durationUs: SPAN_DURATION_US },
    );

    expect(markers).toEqual([]);
  });

  it("drops an event carrying no meaningful time rather than pinning it to zero", () => {
    const markers = toSpanEventMarkers(
      [{ index: 0, name: "zero", tsUs: 0, severity: "info", exceptionType: "zero" }],
      { startUs: SPAN_START_US, durationUs: SPAN_DURATION_US },
    );

    expect(markers).toEqual([]);
  });
});

describe("truncateEventName", () => {
  it("leaves a short name untouched", () => {
    expect(truncateEventName("ResponseReceived")).toBe("ResponseReceived");
  });

  it("truncates a long name to the display budget with an ellipsis", () => {
    const long = "x".repeat(500);

    const result = truncateEventName(long);

    expect(result).toHaveLength(EVENT_NAME_MAX_CHARS + 1);
    expect(result.endsWith("…")).toBe(true);
  });

  // The `default` stream's median name is 119 chars and its worst is 5561.
  it("keeps a realistic OpenObserve tracing name within the budget", () => {
    const real =
      "[trace_id: 019fefa8d9227903870165fd2bf5401d-wal-system_filesystem_usage] " +
      "work_group: None, target_partitions: 7, memory_size: 8053063680";

    expect(truncateEventName(real).length).toBeLessThanOrEqual(EVENT_NAME_MAX_CHARS + 1);
  });

  it("collapses newlines so a multi-line name cannot break the tooltip", () => {
    expect(truncateEventName("first\nsecond")).toBe("first second");
  });

  it("returns an empty string unchanged", () => {
    expect(truncateEventName("")).toBe("");
  });
});

describe("clusterSpanEventMarkers", () => {
  const marker = (index: number, left: number, severity: SpanEventSeverity = "info") => ({
    index,
    name: `event-${index}`,
    tsUs: 1000 + index,
    severity,
    exceptionType: `event-${index}`,
    key: `${index}-${1000 + index}`,
    left,
  });

  it("keeps well-separated markers as single-event clusters", () => {
    const clusters = clusterSpanEventMarkers([marker(0, 10), marker(1, 50), marker(2, 90)], 900);

    expect(clusters).toHaveLength(3);
    expect(clusters.every((c) => c.events.length === 1)).toBe(true);
  });

  // Regression: at the measured 882px waterfall width, 55.1% of `default`
  // events landed within a marker's width of a neighbour and were hidden.
  it("merges markers closer together than the minimum spacing", () => {
    const clusters = clusterSpanEventMarkers([marker(0, 50), marker(1, 50.1), marker(2, 50.2)], 900);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].events).toHaveLength(3);
  });

  it("keeps every event reachable — no event is dropped by clustering", () => {
    const markers = Array.from({ length: 26 }, (_, i) => marker(i, 40 + i * 0.05));

    const clusters = clusterSpanEventMarkers(markers, 900);
    const recovered = clusters.flatMap((c) => c.events.map((e) => e.index));

    expect(recovered.sort((a, b) => a - b)).toEqual(markers.map((m) => m.index));
  });

  it("promotes a cluster to the highest severity it contains", () => {
    const clusters = clusterSpanEventMarkers(
      [marker(0, 50, "info"), marker(1, 50.1, "error"), marker(2, 50.2, "info")],
      900,
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0].severity).toBe("error");
  });

  it("prefers warning over info but yields to error", () => {
    expect(
      clusterSpanEventMarkers([marker(0, 50, "info"), marker(1, 50.1, "warning")], 900)[0].severity,
    ).toBe("warning");
  });

  it("positions a cluster at its first event", () => {
    const clusters = clusterSpanEventMarkers([marker(0, 50), marker(1, 50.2)], 900);

    expect(clusters[0].left).toBe(50);
  });

  it("orders events within a cluster by time", () => {
    const clusters = clusterSpanEventMarkers([marker(2, 50.2), marker(0, 50), marker(1, 50.1)], 900);

    expect(clusters[0].events.map((e) => e.index)).toEqual([0, 1, 2]);
  });

  it("clusters more aggressively in a narrow container", () => {
    const markers = [marker(0, 50), marker(1, 52)];

    expect(clusterSpanEventMarkers(markers, 2000)).toHaveLength(2);
    expect(clusterSpanEventMarkers(markers, 100)).toHaveLength(1);
  });

  it("falls back to no clustering when the container has not been measured yet", () => {
    const clusters = clusterSpanEventMarkers([marker(0, 50), marker(1, 50.1)], 0);

    expect(clusters).toHaveLength(2);
  });

  it("returns an empty array for no markers", () => {
    expect(clusterSpanEventMarkers([], 900)).toEqual([]);
  });
});

describe("summarizeSpanEvents", () => {
  it("counts total events and error-severity events", () => {
    const summary = summarizeSpanEvents([
      { name: "a", level: "INFO", _timestamp: eventNsAt(0.1) },
      { name: "exception", "exception.type": "IOError", _timestamp: eventNsAt(0.2) },
      { name: "c", level: "ERROR", _timestamp: eventNsAt(0.3) },
    ]);

    expect(summary).toEqual({ total: 3, errors: 2 });
  });

  it("reports zero for a span with no events", () => {
    expect(summarizeSpanEvents([])).toEqual({ total: 0, errors: 0 });
  });

  it("reports zero for a malformed payload rather than throwing", () => {
    expect(summarizeSpanEvents("{not json")).toEqual({ total: 0, errors: 0 });
  });

  it("accepts the JSON string form the backend stores", () => {
    const summary = summarizeSpanEvents(
      JSON.stringify([{ name: "a", level: "ERROR", _timestamp: eventNsAt(0.1) }]),
    );

    expect(summary).toEqual({ total: 1, errors: 1 });
  });

  // A sub-pixel span still has a truthful count even though no marker of its
  // own can be positioned — this is the whole point of the badge.
  it("counts events that no window could position", () => {
    expect(summarizeSpanEvents([{ name: "a", _timestamp: eventNsAt(0.1) }]).total).toBe(1);
  });
});
