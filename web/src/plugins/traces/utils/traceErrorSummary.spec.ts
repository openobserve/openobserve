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
import { errorSpansDeepestFirst, spanErrorMessage, spanErrorText } from "./traceErrorSummary";

const span = (id: string, parent: string, extra: Record<string, unknown> = {}) => ({
  span_id: id,
  reference_parent_span_id: parent,
  service_name: `svc-${id}`,
  operation_name: `op-${id}`,
  start_time: 100,
  span_status: "UNSET",
  ...extra,
});

describe("errorSpansDeepestFirst", () => {
  it("returns no entries when no span has ERROR status", () => {
    expect(errorSpansDeepestFirst([span("a", ""), span("b", "a")])).toEqual([]);
    expect(errorSpansDeepestFirst([])).toEqual([]);
  });

  it("orders error spans by tree depth, deepest first", () => {
    const spans = [
      span("root", "", { span_status: "ERROR" }),
      span("mid", "root"),
      span("leaf", "mid", { span_status: "ERROR" }),
      span("child", "root", { span_status: "ERROR" }),
    ];
    expect(errorSpansDeepestFirst(spans).map((e) => e.spanId)).toEqual(["leaf", "child", "root"]);
  });

  it("breaks a depth tie by the earliest start time", () => {
    const spans = [
      span("root", ""),
      span("late", "root", { span_status: "ERROR", start_time: 500 }),
      span("early", "root", { span_status: "ERROR", start_time: 200 }),
    ];
    expect(errorSpansDeepestFirst(spans).map((e) => e.spanId)).toEqual(["early", "late"]);
  });

  it("treats a span whose parent is not in the trace as a root", () => {
    const spans = [
      span("orphan", "missing", { span_status: "ERROR", start_time: 1 }),
      span("root", ""),
      span("child", "root", { span_status: "ERROR", start_time: 9 }),
    ];
    expect(errorSpansDeepestFirst(spans).map((e) => e.spanId)).toEqual(["child", "orphan"]);
  });

  it("does not loop on a parent cycle", () => {
    const spans = [
      span("a", "b", { span_status: "ERROR" }),
      span("b", "a", { span_status: "ERROR" }),
    ];
    expect(errorSpansDeepestFirst(spans)).toHaveLength(2);
  });

  it("carries service, operation and message for each entry", () => {
    const spans = [span("a", "", { span_status: "ERROR", status_message: "boom" })];
    expect(errorSpansDeepestFirst(spans)).toEqual([
      { spanId: "a", serviceName: "svc-a", operationName: "op-a", message: "boom" },
    ]);
  });
});

describe("spanErrorMessage", () => {
  const exceptionEvents = JSON.stringify([
    { name: "log", _timestamp: 1, message: "ignored" },
    { name: "exception", _timestamp: 2, "exception.message": "connection reset by peer" },
  ]);

  it("prefers status_message", () => {
    expect(
      spanErrorMessage({
        status_message: "deadline exceeded",
        events: exceptionEvents,
        error_type: "Timeout",
        http_status_code: 504,
      }),
    ).toBe("deadline exceeded");
  });

  it("falls back to the exception event message when status_message is empty", () => {
    expect(spanErrorMessage({ status_message: "", events: exceptionEvents, error_type: "X" })).toBe(
      "connection reset by peer",
    );
  });

  it("reads events given as an array", () => {
    expect(
      spanErrorMessage({ events: [{ name: "exception", "exception.message": "kaput" }] }),
    ).toBe("kaput");
  });

  it("falls back to error_type when there is no exception message", () => {
    expect(spanErrorMessage({ status_message: "", events: "[]", error_type: "Timeout" })).toBe(
      "Timeout",
    );
  });

  it("falls back to the HTTP status code, either field name", () => {
    expect(spanErrorMessage({ events: "not json", http_status_code: 503 })).toBe("503");
    expect(spanErrorMessage({ http_response_status_code: "502" })).toBe("502");
  });

  it("ignores a non-error HTTP code", () => {
    expect(spanErrorMessage({ http_status_code: 200 })).toBe("");
    expect(spanErrorMessage({ http_status_code: 399, http_response_status_code: 404 })).toBe("404");
  });

  it("returns an empty string when no source is present", () => {
    expect(spanErrorMessage({})).toBe("");
    expect(spanErrorMessage({ status_message: "  ", events: "[]", http_status_code: 0 })).toBe("");
  });
});

describe("spanErrorText", () => {
  it("returns the picked message and the HTTP error code separately", () => {
    expect(
      spanErrorText({ status_message: "upstream request failed", http_status_code: "503" }),
    ).toEqual({ message: "upstream request failed", code: "503" });
  });

  it("returns empty parts when no source is present", () => {
    expect(spanErrorText({ status_message: " ", events: "[]", http_status_code: 302 })).toEqual({
      message: "",
      code: "",
    });
  });
});
