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
  arrivalMs,
  batchWindowUs,
  entryLookup,
  failedRequestWindowUs,
  isCompleteResponse,
  isMissingColumnError,
  isSkewed,
  missingColumnName,
  nextServerColumns,
  newestArrivalMs,
  recordFailure,
  recordSpans,
  serverAskDue,
  serverColumnSets,
  serverColumnsKey,
  serverSpansSql,
  spanStatus,
  traceAgeMs,
  widenWindowUs,
  SERVER_MAX_ATTEMPTS,
  SERVER_RETRY_BACKOFF_MS,
  type ServerStatusEntry,
} from "@/utils/rum/serverStatus";
import { TRACE_RANGE_PADDING_US } from "@/utils/rum/traceWindow";

const MIN_US = 60_000_000;
const HOUR_US = 60 * MIN_US;
const T1 = "0".repeat(31) + "1";
const T2 = "0".repeat(31) + "2";
const NOW = 1_750_000_000_000;

describe("entryLookup", () => {
  it("shows a status, then a verified miss, and everything else as unknown", () => {
    const base = { checkedAt: 0, attempts: 1 };
    expect(entryLookup(undefined)).toEqual({ lookup: "unknown" });
    expect(entryLookup({ ...base, found: true, status: "500", service: "be" })).toEqual({
      lookup: "found",
      status: "500",
      service: "be",
    });
    expect(
      entryLookup({ ...base, found: true, status: "500", service: "" }).service,
    ).toBeUndefined();
    expect(entryLookup({ ...base, found: true })).toEqual({ lookup: "unknown" });
    expect(entryLookup({ ...base, found: false, negative: true })).toEqual({
      lookup: "no_server_span",
    });
    expect(entryLookup({ ...base, found: false })).toEqual({ lookup: "unknown" });
  });
});

describe("arrival times", () => {
  it("takes the arrival time, and the device's date only when there is none", () => {
    expect(arrivalMs({ dateUs: 1_000_000, arrivalUs: 5_000_000 })).toBe(5_000);
    expect(arrivalMs({ dateUs: 1_000_000, arrivalUs: 0 })).toBe(1_000);
    expect(arrivalMs({ dateUs: 0, arrivalUs: 0 })).toBe(0);
  });

  it("finds the newest arrival of a trace's requests", () => {
    expect(
      newestArrivalMs([
        { dateUs: 0, arrivalUs: 5_000_000 },
        { dateUs: 9_000_000, arrivalUs: 0 },
        { dateUs: 0, arrivalUs: 7_000_000 },
      ]),
    ).toBe(9_000);
    expect(newestArrivalMs([])).toBe(0);
  });
});

describe("serverAskDue", () => {
  const entry = (extra: Partial<ServerStatusEntry> = {}): ServerStatusEntry => ({
    found: false,
    checkedAt: NOW,
    attempts: 1,
    ...extra,
  });
  it("asks a trace that has no entry", () => {
    expect(serverAskDue(undefined, NOW)).toEqual({ ask: true });
  });

  it("never asks again once a status was found", () => {
    expect(serverAskDue(entry({ found: true, status: "500" }), NOW + 3_600_000)).toEqual({
      ask: false,
    });
  });

  it("backs off 30 s, 2 min and 10 min after the 1st, 2nd and 3rd ask", () => {
    expect(SERVER_RETRY_BACKOFF_MS).toEqual([30_000, 120_000, 600_000]);
    for (const [attempts, gap] of [
      [1, 30_000],
      [2, 120_000],
      [3, 600_000],
    ]) {
      const e = entry({ attempts });
      expect(serverAskDue(e, NOW + gap - 1)).toEqual({ ask: false, dueAt: NOW + gap });
      expect(serverAskDue(e, NOW + gap)).toEqual({ ask: true });
    }
  });

  it("stops at the attempt cap, errors included, and at no other age", () => {
    expect(SERVER_MAX_ATTEMPTS).toBe(4);
    expect(serverAskDue(entry({ attempts: 4 }), NOW + 3_600_000)).toEqual({ ask: false });
    // A trace still under the cap is asked however late the viewer comes back (a tab hidden for a long while).
    expect(serverAskDue(entry({ attempts: 1 }), NOW + 3_600_000)).toEqual({ ask: true });
  });
});

describe("recordSpans", () => {
  const span = (traceId: string, extra: Record<string, unknown> = {}) => ({
    trace_id: traceId,
    start_time: 1_000,
    ...extra,
  });
  const arrivals = (age: number) => new Map([[T1, NOW - age]]);

  it("records the earliest span with a status, and its service, and says it changed", () => {
    const entries = new Map<string, ServerStatusEntry>();
    const changed = recordSpans(
      entries,
      [T1],
      [
        span(T1, { start_time: 3_000, http_response_status_code: "500", service_name: "late" }),
        span(T1, { start_time: 1_000, http_response_status_code: "" }),
        span(T1, { start_time: 2_000, http_status_code: "502", service_name: " be " }),
      ],
      true,
      arrivals(10_000),
      NOW,
    );
    expect(changed).toBe(true);
    expect(entries.get(T1)).toMatchObject({
      found: true,
      status: "502",
      service: "be",
      attempts: 1,
      checkedAt: NOW,
    });
  });

  it("records a span with a blank status as found without one, which shows as unknown", () => {
    const entries = new Map<string, ServerStatusEntry>();
    recordSpans(entries, [T1], [span(T1)], true, arrivals(10_000), NOW);
    expect(entries.get(T1)).toMatchObject({ found: true, status: undefined });
    expect(entryLookup(entries.get(T1)).lookup).toBe("unknown");
  });

  it("records a miss only for a complete answer about a row older than two minutes", () => {
    const entries = new Map<string, ServerStatusEntry>();
    expect(recordSpans(entries, [T1], [], true, arrivals(60_000), NOW)).toBe(false);
    expect(entries.get(T1)?.negative).toBeUndefined();

    expect(recordSpans(entries, [T1], [], false, arrivals(600_000), NOW + 1)).toBe(false);
    expect(entries.get(T1)?.negative).toBeUndefined();

    expect(recordSpans(entries, [T1], [], true, arrivals(600_000), NOW + 2)).toBe(true);
    expect(entries.get(T1)).toMatchObject({ found: false, negative: true, attempts: 3 });
  });

  it("keeps an earlier miss through a young or partial ask, and a found status through a later miss", () => {
    const entries = new Map<string, ServerStatusEntry>([
      [T1, { found: false, negative: true, checkedAt: 0, attempts: 1 }],
      [T2, { found: true, status: "500", checkedAt: 0, attempts: 1 }],
    ]);
    expect(recordSpans(entries, [T1], [], false, arrivals(600_000), NOW)).toBe(false);
    expect(entries.get(T1)?.negative).toBe(true);
    expect(recordSpans(entries, [T2], [], true, new Map([[T2, NOW - 600_000]]), NOW)).toBe(false);
    expect(entries.get(T2)).toMatchObject({ found: true, status: "500", attempts: 2 });
  });

  it("reports a change only when what a row shows changed", () => {
    const entries = new Map<string, ServerStatusEntry>();
    const ask = (rows: unknown[]) => recordSpans(entries, [T1], rows, true, arrivals(10_000), NOW);
    expect(ask([span(T1, { http_response_status_code: "500" })])).toBe(true);
    expect(ask([span(T1, { http_response_status_code: "500" })])).toBe(false);
    expect(ask([span(T1, { http_response_status_code: "503" })])).toBe(true);
  });
});

describe("recordFailure", () => {
  it("counts an attempt and leaves what was shown", () => {
    const entries = new Map<string, ServerStatusEntry>([
      [T1, { found: false, negative: true, checkedAt: 0, attempts: 2 }],
    ]);
    expect(recordFailure(entries, [T1, T2], NOW)).toBe(false);
    expect(entries.get(T1)).toEqual({ found: false, negative: true, checkedAt: NOW, attempts: 3 });
    expect(entries.get(T2)).toEqual({ found: false, checkedAt: NOW, attempts: 1 });
    expect(entryLookup(entries.get(T2)).lookup).toBe("unknown");
  });

  it("ends a trace through the attempt cap", () => {
    const entries = new Map<string, ServerStatusEntry>();
    for (let i = 0; i < SERVER_MAX_ATTEMPTS; i++) recordFailure(entries, [T1], NOW + i);
    expect(serverAskDue(entries.get(T1), NOW + 3_600_000)).toEqual({ ask: false });
  });
});

describe("spanStatus and isCompleteResponse", () => {
  it("reads the newer column first and skips blanks", () => {
    expect(spanStatus({ http_response_status_code: " 500 ", http_status_code: "502" })).toBe("500");
    expect(spanStatus({ http_response_status_code: "", http_status_code: 502 })).toBe("502");
    expect(spanStatus({})).toBe("");
  });

  it("is complete without is_partial and without any function error message", () => {
    expect(isCompleteResponse({ hits: [] })).toBe(true);
    expect(isCompleteResponse({ is_partial: false, function_error: [] })).toBe(true);
    expect(isCompleteResponse({ function_error: "" })).toBe(true);
    expect(isCompleteResponse({ is_partial: true })).toBe(false);
    expect(isCompleteResponse({ function_error: ["boom"] })).toBe(false);
    expect(isCompleteResponse(undefined)).toBe(true);
  });
});

describe("isMissingColumnError", () => {
  it.each([
    "Schema error: No field named http_response_status_code. Valid fields are traces.trace_id, traces.start_time.",
    "no such column: http_status_code",
    "column http_status_code does not exist",
    "Unknown field service_name",
  ])("is a missing column: %s", (message) => {
    expect(isMissingColumnError(new Error(message))).toBe(true);
  });

  it("reads the response body's message too", () => {
    expect(
      isMissingColumnError({ response: { data: { message: "No field named http_status_code" } } }),
    ).toBe(true);
  });

  it.each(["forbidden", "Network Error", "timeout of 30000ms exceeded", ""])(
    "is not about the columns: %s",
    (message) => {
      expect(isMissingColumnError(new Error(message))).toBe(false);
    },
  );
});

describe("serverColumnSets", () => {
  it("gives the one set a known schema allows", () => {
    expect(serverColumnSets(["trace_id", "http_status_code", "service_name"])).toEqual([
      ["http_status_code", "service_name"],
    ]);
    expect(serverColumnSets(["trace_id"])).toEqual([[]]);
  });

  it("tries both statuses with the service, then each status alone, then none, without a schema", () => {
    const ladder = [
      ["http_response_status_code", "http_status_code", "service_name"],
      ["http_response_status_code"],
      ["http_status_code"],
      [],
    ];
    expect(serverColumnSets(null)).toEqual(ladder);
    expect(serverColumnSets([])).toEqual(ladder);
  });
});

describe("serverSpansSql", () => {
  it("selects the span kind 2 rows of the trace ids, in start order", () => {
    expect(serverSpansSql("default", ["http_status_code"], [T1, T2])).toBe(
      `select trace_id, start_time, http_status_code from "default" where span_kind = '2' and trace_id IN ('${T1}','${T2}') order by start_time asc`,
    );
  });

  it("escapes the stream name and the ids", () => {
    const sql = serverSpansSql('we"ird', [], ["a'b"]);
    expect(sql).toContain('from "we""ird"');
    expect(sql).toContain("trace_id IN ('a''b')");
    expect(sql.startsWith("select trace_id, start_time from")).toBe(true);
  });
});

describe("failedRequestWindowUs", () => {
  const arrival = 1_750_000_000_000_000;

  it("covers the date and the arrival, five minutes either side, whichever is first", () => {
    expect(failedRequestWindowUs({ dateUs: arrival - 10 * MIN_US, arrivalUs: arrival })).toEqual({
      start: arrival - 15 * MIN_US,
      end: arrival + 5 * MIN_US,
    });
    // A device clock that runs fast.
    expect(failedRequestWindowUs({ dateUs: arrival + 2 * MIN_US, arrivalUs: arrival })).toEqual({
      start: arrival - 5 * MIN_US,
      end: arrival + 7 * MIN_US,
    });
    expect(failedRequestWindowUs({ dateUs: arrival, arrivalUs: arrival })).toEqual({
      start: arrival - 5 * MIN_US,
      end: arrival + 5 * MIN_US,
    });
  });

  it("trusts the date up to an hour off, and not beyond it", () => {
    expect(failedRequestWindowUs({ dateUs: arrival - HOUR_US, arrivalUs: arrival })?.start).toBe(
      arrival - HOUR_US - 5 * MIN_US,
    );
    expect(failedRequestWindowUs({ dateUs: arrival - HOUR_US - 1, arrivalUs: arrival })).toEqual({
      start: arrival - 30 * MIN_US,
      end: arrival + 5 * MIN_US,
    });
    expect(failedRequestWindowUs({ dateUs: arrival + 3 * HOUR_US, arrivalUs: arrival })).toEqual({
      start: arrival - 30 * MIN_US,
      end: arrival + 5 * MIN_US,
    });
  });

  it("uses what it has when one time is missing, and nothing when both are", () => {
    expect(failedRequestWindowUs({ dateUs: 0, arrivalUs: arrival })).toEqual({
      start: arrival - 5 * MIN_US,
      end: arrival + 5 * MIN_US,
    });
    expect(failedRequestWindowUs({ dateUs: arrival, arrivalUs: 0 })).toEqual({
      start: arrival - 5 * MIN_US,
      end: arrival + 5 * MIN_US,
    });
    expect(failedRequestWindowUs({ dateUs: 0, arrivalUs: 0 })).toBeNull();
  });
});

describe("batchWindowUs", () => {
  const arrival = 1_750_000_000_000_000;

  it("joins the windows of the batch's requests", () => {
    expect(
      batchWindowUs([
        { dateUs: arrival, arrivalUs: arrival },
        { dateUs: arrival + 20 * MIN_US, arrivalUs: arrival + 20 * MIN_US },
        { dateUs: 0, arrivalUs: 0 },
      ]),
    ).toEqual({ start: arrival - 5 * MIN_US, end: arrival + 25 * MIN_US });
  });

  it("is null when no request has a time", () => {
    expect(batchWindowUs([])).toBeNull();
    expect(batchWindowUs([{ dateUs: 0, arrivalUs: 0 }])).toBeNull();
  });
});

describe("widenWindowUs", () => {
  const window = { start: 1_000_000_000, end: 2_000_000_000 };

  it("grows to cover a trace's range, padded", () => {
    expect(
      widenWindowUs(window, [
        { start_time: 500_000_000, end_time: 600_000_000 },
        { start_time: 2_500_000_000, end_time: 3_000_000_000 },
        undefined,
      ]),
    ).toEqual({
      start: 500_000_000 - TRACE_RANGE_PADDING_US,
      end: 3_000_000_000 + TRACE_RANGE_PADDING_US,
    });
  });

  it("never shrinks, and ignores a missing range", () => {
    expect(widenWindowUs(window, [{ start_time: 1_500_000_000, end_time: 1_600_000_000 }])).toEqual(
      window,
    );
    expect(widenWindowUs(window, [])).toEqual(window);
  });
});

describe("missingColumnName", () => {
  it.each([
    [
      "Schema error: No field named http_response_status_code. Valid fields are traces.trace_id, traces.start_time.",
      "http_response_status_code",
    ],
    [
      'Schema error: No field named "http_status_code". Valid fields are traces.x.',
      "http_status_code",
    ],
    ["No field named `service_name`. Valid fields are a.", "service_name"],
    ["No field named traces.service_name. Valid fields are a.", "service_name"],
    ['No field named "traces"."service_name". Valid fields are a.', "service_name"],
    ['column "http_status_code" does not exist', "http_status_code"],
    ["no such column: http_status_code", "http_status_code"],
    ["Unknown field service_name", "service_name"],
  ])("names the column in: %s", (message, name) => {
    expect(missingColumnName(new Error(message))).toBe(name);
  });

  it("reads the response body, and gives null when no name can be read", () => {
    expect(
      missingColumnName({ response: { data: { message: "No field named http_status_code." } } }),
    ).toBe("http_status_code");
    expect(missingColumnName(new Error("Schema error: field not found"))).toBeNull();
    expect(missingColumnName(new Error("forbidden"))).toBeNull();
  });
});

describe("nextServerColumns", () => {
  const WIDEST = ["http_response_status_code", "http_status_code", "service_name"];
  const missing = (name: string) =>
    new Error(`Schema error: No field named ${name}. Valid fields are a.`);
  const attempt = (columns: string[], error: unknown, tried: Set<string>) => {
    tried.add(serverColumnsKey(columns));
    return nextServerColumns(columns, tried, error);
  };

  it("drops only the named column, so the status and the service stay", () => {
    expect(attempt(WIDEST, missing("http_response_status_code"), new Set())).toEqual([
      "http_status_code",
      "service_name",
    ]);
    expect(attempt(WIDEST, missing("service_name"), new Set())).toEqual([
      "http_response_status_code",
      "http_status_code",
    ]);
  });

  it("drops each column at most once, so the retries are bounded", () => {
    const tried = new Set<string>();
    let columns: string[] | null = WIDEST;
    let asks = 0;
    // The stream has none of the columns: every ask names the first one left.
    while (columns) {
      asks++;
      columns = attempt(columns, missing(columns[0] ?? "http_status_code"), tried);
    }
    expect(asks).toBe(WIDEST.length + 1);
  });

  it("stops when the missing column is not one of ours, or the error is not about a column", () => {
    expect(attempt(WIDEST, missing("trace_id"), new Set())).toBeNull();
    expect(attempt(WIDEST, new Error("forbidden"), new Set())).toBeNull();
  });

  it("walks the ladder when the error names no column, never repeating a set", () => {
    const tried = new Set<string>();
    const error = new Error("Schema error: field not found");
    const seen: string[][] = [];
    let columns: string[] | null = WIDEST;
    while (columns) {
      seen.push(columns);
      columns = attempt(columns, error, tried);
    }
    expect(seen).toEqual([WIDEST, ["http_response_status_code"], ["http_status_code"], []]);
  });
});

describe("traceAgeMs", () => {
  it("is the younger of the age by arrival and the age since the viewer first saw it", () => {
    expect(traceAgeMs(NOW - 600_000, NOW, NOW - 5_000)).toBe(5_000);
    expect(traceAgeMs(NOW - 5_000, NOW, NOW - 600_000)).toBe(5_000);
    expect(traceAgeMs(NOW - 600_000, NOW)).toBe(600_000);
    expect(traceAgeMs(0, NOW, NOW - 7_000)).toBe(7_000);
    expect(traceAgeMs(0, NOW)).toBe(0);
  });

  it("keeps a fast staff clock from making a new trace old", () => {
    // The server stamped the row 20 minutes ago by a staff clock that runs 20 minutes ahead.
    const arrival = NOW - 20 * 60_000;
    const entries = new Map<string, ServerStatusEntry>();
    recordSpans(entries, [T1], [], true, new Map([[T1, arrival]]), NOW, {
      firstSeen: new Map([[T1, NOW]]),
    });
    expect(entryLookup(entries.get(T1)).lookup).toBe("unknown");
    // Two minutes later the viewer has known it long enough.
    recordSpans(entries, [T1], [], true, new Map([[T1, arrival]]), NOW + 121_000, {
      firstSeen: new Map([[T1, NOW]]),
    });
    expect(entryLookup(entries.get(T1)).lookup).toBe("no_server_span");
  });
});

describe("a device clock more than an hour from the arrival time", () => {
  const HOUR = 3_600_000_000;
  it("is skewed only when both times exist and are over an hour apart", () => {
    expect(isSkewed({ dateUs: 1, arrivalUs: 1 + HOUR })).toBe(false);
    expect(isSkewed({ dateUs: 1, arrivalUs: 2 + HOUR })).toBe(true);
    expect(isSkewed({ dateUs: 0, arrivalUs: 5 * HOUR })).toBe(false);
    expect(isSkewed({ dateUs: 5 * HOUR, arrivalUs: 0 })).toBe(false);
  });

  it("records no miss for a skewed trace, which stays unknown and is asked again", () => {
    const entries = new Map<string, ServerStatusEntry>();
    const arrivals = new Map([[T1, NOW - 600_000]]);
    recordSpans(entries, [T1], [], true, arrivals, NOW, { skewed: new Set([T1]) });
    expect(entries.get(T1)).toMatchObject({ found: false, attempts: 1 });
    expect(entries.get(T1)?.negative).toBeUndefined();
    expect(entryLookup(entries.get(T1)).lookup).toBe("unknown");
    // Not skewed: the same answer is a miss.
    recordSpans(entries, [T1], [], true, arrivals, NOW + 1);
    expect(entryLookup(entries.get(T1)).lookup).toBe("no_server_span");
  });
});
