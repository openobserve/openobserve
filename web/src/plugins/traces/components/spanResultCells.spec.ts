// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import { buildSpanResultCells, EVENTS_HOVER_LIMIT, spanResultCellsFor } from "./spanResultCells";

// Span start_time is nanoseconds; event _timestamp is nanoseconds too.
const SPAN_START_NS = 1752490492843000000;
const atMs = (ms: number) => SPAN_START_NS + ms * 1_000_000;

const exceptionEvent = (ms: number, message?: string) => ({
  name: "exception",
  _timestamp: atMs(ms),
  "exception.type": "IOError",
  ...(message === undefined ? {} : { "exception.message": message }),
});
const logEvent = (ms: number, name: string) => ({ name, _timestamp: atMs(ms), level: "INFO" });

const errorRow = (fields: Record<string, unknown>) => ({
  span_status: "ERROR",
  start_time: SPAN_START_NS,
  ...fields,
});

describe("buildSpanResultCells — error text", () => {
  it("is empty on a non-error span even when every source is set", () => {
    const { error } = buildSpanResultCells({
      span_status: "OK",
      status_message: "boom",
      error_type: "Timeout",
      http_status_code: 503,
      events: JSON.stringify([exceptionEvent(1, "reset")]),
    });

    expect(error).toBeNull();
  });

  it("prefers status_message over every other source", () => {
    const { error } = buildSpanResultCells(
      errorRow({
        status_message: "upstream request failed",
        error_type: "Timeout",
        events: JSON.stringify([exceptionEvent(1, "connection reset")]),
      }),
    );

    expect(error?.message).toBe("upstream request failed");
  });

  it("falls back to the exception message from events when status_message is empty", () => {
    const { error } = buildSpanResultCells(
      errorRow({
        status_message: "",
        error_type: "Timeout",
        events: JSON.stringify([logEvent(0, "start"), exceptionEvent(2, "connection reset")]),
      }),
    );

    expect(error?.message).toBe("connection reset");
  });

  it("falls back to error_type when there is no status_message and no exception message", () => {
    const { error } = buildSpanResultCells(
      errorRow({ status_message: "", error_type: "Timeout", events: "[]" }),
    );

    expect(error?.message).toBe("Timeout");
  });

  it("skips an exception event that carries no message", () => {
    const { error } = buildSpanResultCells(
      errorRow({ events: JSON.stringify([exceptionEvent(1)]), error_type: "Timeout" }),
    );

    expect(error?.message).toBe("Timeout");
  });

  it("treats malformed events JSON as no exception message", () => {
    const { error } = buildSpanResultCells(errorRow({ events: "{not json", error_type: "Oops" }));

    expect(error?.message).toBe("Oops");
  });

  it("shows only the HTTP code when no text source exists", () => {
    const { error } = buildSpanResultCells(errorRow({ events: "[]", http_status_code: 503 }));

    expect(error).toEqual({ code: "503", message: "" });
  });

  it("shows the HTTP code next to the picked message", () => {
    const { error } = buildSpanResultCells(
      errorRow({ status_message: "upstream request failed", http_status_code: "503" }),
    );

    expect(error).toEqual({ code: "503", message: "upstream request failed" });
  });

  it("reads http_response_status_code when http_status_code is missing", () => {
    const { error } = buildSpanResultCells(errorRow({ http_response_status_code: 504 }));

    expect(error?.code).toBe("504");
  });

  it("ignores a non-error HTTP code", () => {
    const { error } = buildSpanResultCells(errorRow({ http_status_code: 200 }));

    expect(error).toBeNull();
  });

  it("is empty when the error span has none of the optional fields", () => {
    expect(buildSpanResultCells(errorRow({})).error).toBeNull();
  });

  it("ignores whitespace-only text sources", () => {
    const { error } = buildSpanResultCells(
      errorRow({ status_message: "   ", error_type: "Timeout" }),
    );

    expect(error?.message).toBe("Timeout");
  });
});

describe("buildSpanResultCells — events", () => {
  it("counts nothing when the span has no events", () => {
    const { events } = buildSpanResultCells({ events: "[]" });

    expect(events).toMatchObject({ total: 0, exceptions: 0, logs: 0, hasException: false });
    expect(events.items).toEqual([]);
  });

  it("counts nothing for a missing or malformed events field", () => {
    expect(buildSpanResultCells({}).events.total).toBe(0);
    expect(buildSpanResultCells({ events: "not-json" }).events.total).toBe(0);
  });

  it("counts exceptions and other events separately", () => {
    const { events } = buildSpanResultCells(
      errorRow({
        events: JSON.stringify([
          exceptionEvent(2, "reset"),
          logEvent(1890, "pool: closing broken connection"),
          exceptionEvent(1880, "reset (retry 1 of 1)"),
        ]),
      }),
    );

    expect(events).toMatchObject({ total: 3, exceptions: 2, logs: 1, hasException: true });
  });

  it("lists events in time order with the offset from span start", () => {
    const { events } = buildSpanResultCells(
      errorRow({
        events: JSON.stringify([
          logEvent(1890, "pool: closing broken connection"),
          exceptionEvent(2, "connection reset by peer"),
        ]),
      }),
    );

    expect(events.items.map((i) => [i.kind, i.offsetUs, i.text])).toEqual([
      ["exception", 2000, "connection reset by peer"],
      ["log", 1890000, "pool: closing broken connection"],
    ]);
  });

  it("uses the event name when an exception carries no message", () => {
    const { events } = buildSpanResultCells(
      errorRow({ events: JSON.stringify([exceptionEvent(1)]) }),
    );

    expect(events.items[0].text).toBe("exception");
  });

  it("caps the hover list and reports how many were left out", () => {
    const many = Array.from({ length: EVENTS_HOVER_LIMIT + 3 }, (_, i) => logEvent(i, `e${i}`));
    const { events } = buildSpanResultCells(errorRow({ events: JSON.stringify(many) }));

    expect(events.items).toHaveLength(EVENTS_HOVER_LIMIT);
    expect(events.moreCount).toBe(3);
    expect(events.total).toBe(EVENTS_HOVER_LIMIT + 3);
  });

  it("falls back to the row timestamp (microseconds) when start_time is missing", () => {
    const { events } = buildSpanResultCells({
      _timestamp: SPAN_START_NS / 1000,
      events: JSON.stringify([logEvent(5, "x")]),
    });

    expect(events.items[0].offsetUs).toBe(5000);
  });
});

describe("spanResultCellsFor", () => {
  it("returns the same result for the same row object", () => {
    const row = errorRow({ status_message: "boom" });

    expect(spanResultCellsFor(row)).toBe(spanResultCellsFor(row));
  });
});
