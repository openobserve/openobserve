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

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  ISSUES_LIMIT,
  TREND_TOP_N,
  MAX_TREND_MESSAGE_LEN,
  pickUserField,
  buildIssuesSql,
  buildErrorsHistogramSql,
  buildTrendsSql,
  buildErrorKpisSql,
  buildDenominatorsSql,
  buildDeploysSql,
  pivotStackedHistogram,
  pivotTrends,
  type IssueQueryContext,
} from "./errorIssueQueries";

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: build a context with a full schema
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<IssueQueryContext> = {}): IssueQueryContext {
  return {
    streamName: "_rumdata",
    timestampColumn: "_timestamp",
    schema: {
      error_type: true,
      error_message: true,
      error_handling: true,
      error_id: true,
      error_stack: true,
      error_handling_stack: true,
      service: true,
      view_url: true,
      session_id: true,
      usr_id: true,
    },
    userQuery: "",
    service: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("ISSUES_LIMIT is 200", () => {
    expect(ISSUES_LIMIT).toBe(200);
  });

  it("TREND_TOP_N is 20", () => {
    expect(TREND_TOP_N).toBe(20);
  });

  it("MAX_TREND_MESSAGE_LEN is 4096", () => {
    expect(MAX_TREND_MESSAGE_LEN).toBe(4096);
  });
});

// ---------------------------------------------------------------------------
// pickUserField
// ---------------------------------------------------------------------------

describe("pickUserField", () => {
  it("returns usr_id when present", () => {
    expect(
      pickUserField({
        usr_id: true,
        usr_email: true,
        session_id: true,
      }),
    ).toBe("usr_id");
  });

  it("falls back to usr_email when usr_id absent", () => {
    expect(
      pickUserField({
        usr_email: true,
        session_id: true,
      }),
    ).toBe("usr_email");
  });

  it("falls back to session_id when usr_id and usr_email absent", () => {
    expect(
      pickUserField({
        session_id: true,
      }),
    ).toBe("session_id");
  });

  it("returns null when none of the identity fields are present", () => {
    expect(pickUserField({})).toBeNull();
  });

  it("returns null when fields are explicitly false", () => {
    expect(
      pickUserField({
        usr_id: false,
        usr_email: false,
        session_id: false,
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildIssuesSql
// ---------------------------------------------------------------------------

describe("buildIssuesSql", () => {
  it("includes max/min timestamp aliases zo_sql_timestamp and first_seen", () => {
    const sql = buildIssuesSql(makeCtx());

    expect(sql).toContain("max(_timestamp) AS zo_sql_timestamp");
    expect(sql).toContain("min(_timestamp) AS first_seen");
  });

  it("includes COUNT(*) AS events", () => {
    const sql = buildIssuesSql(makeCtx());

    expect(sql).toContain("COUNT(*) AS events");
  });

  it("includes COUNT(DISTINCT usr_id) AS users_affected when usr_id in schema", () => {
    const sql = buildIssuesSql(makeCtx());

    expect(sql).toContain("COUNT(DISTINCT usr_id) AS users_affected");
  });

  it("includes COUNT(DISTINCT session_id) AS sessions_affected when session_id in schema", () => {
    const sql = buildIssuesSql(makeCtx());

    expect(sql).toContain("COUNT(DISTINCT session_id) AS sessions_affected");
  });

  it("includes FIRST_VALUE(error_id ORDER BY ...) AS latest_error_id", () => {
    const sql = buildIssuesSql(makeCtx());

    expect(sql).toContain("FIRST_VALUE(error_id ORDER BY _timestamp DESC) AS latest_error_id");
  });

  it("groups by error_type, error_message, error_handling", () => {
    const sql = buildIssuesSql(makeCtx());

    expect(sql).toContain("GROUP BY error_type, error_message, error_handling");
  });

  it("orders by users_affected DESC when user field is available", () => {
    const sql = buildIssuesSql(makeCtx());

    expect(sql).toContain("ORDER BY users_affected DESC");
  });

  it("orders by events DESC when no user field in schema", () => {
    const sql = buildIssuesSql(
      makeCtx({
        schema: {
          error_type: true,
          error_message: true,
          error_handling: true,
        },
      }),
    );

    expect(sql).toContain("ORDER BY events DESC");
    expect(sql).not.toContain("users_affected");
  });

  it("includes WHERE type='error'", () => {
    const sql = buildIssuesSql(makeCtx());

    expect(sql).toContain("WHERE type='error'");
  });

  it("does not append user query when userQuery is empty", () => {
    const sql = buildIssuesSql(makeCtx({ userQuery: "" }));

    expect(sql).not.toContain("AND (");
  });

  it("does not append user query when userQuery is whitespace-only", () => {
    const sql = buildIssuesSql(makeCtx({ userQuery: "   " }));

    expect(sql).not.toContain("AND (");
  });

  it("appends user query as AND (<query>) when non-empty", () => {
    const sql = buildIssuesSql(makeCtx({ userQuery: "user_agent LIKE '%Chrome%'" }));

    expect(sql).toContain("AND (user_agent LIKE '%Chrome%')");
  });

  it("appends service filter with properly escaped single quotes", () => {
    const sql = buildIssuesSql(makeCtx({ service: "o'brien" }));

    expect(sql).toContain("AND service='o''brien'");
  });

  it("does not append service clause when service is empty", () => {
    const sql = buildIssuesSql(makeCtx({ service: "" }));

    expect(sql).not.toContain("AND service=");
  });

  it("selects from the correct stream name", () => {
    const sql = buildIssuesSql(makeCtx({ streamName: "mystream" }));

    expect(sql).toContain('FROM "mystream"');
  });

  describe("stack select variants", () => {
    it("uses CASE combining both error_stack and error_handling_stack when both present", () => {
      const sql = buildIssuesSql(
        makeCtx({
          schema: {
            error_type: true,
            error_message: true,
            error_handling: true,
            error_stack: true,
            error_handling_stack: true,
          },
        }),
      );

      expect(sql).toContain(
        "WHEN error_stack IS NOT NULL THEN error_stack WHEN error_handling_stack IS NOT NULL",
      );
    });

    it("uses only error_handling_stack CASE when only error_handling_stack present", () => {
      const sql = buildIssuesSql(
        makeCtx({
          schema: {
            error_type: true,
            error_message: true,
            error_handling: true,
            error_handling_stack: true,
          },
        }),
      );

      expect(sql).toContain("WHEN error_handling_stack IS NOT NULL THEN error_handling_stack");
      expect(sql).not.toContain("WHEN error_stack IS NOT NULL THEN error_stack");
    });

    it("uses only error_stack CASE when only error_stack present", () => {
      const sql = buildIssuesSql(
        makeCtx({
          schema: {
            error_type: true,
            error_message: true,
            error_handling: true,
            error_stack: true,
          },
        }),
      );

      expect(sql).toContain("WHEN error_stack IS NOT NULL THEN error_stack");
      expect(sql).not.toContain("error_handling_stack");
    });

    it("includes no stack select when neither stack field is present", () => {
      const sql = buildIssuesSql(
        makeCtx({
          schema: {
            error_type: true,
            error_message: true,
            error_handling: true,
          },
        }),
      );

      expect(sql).not.toContain("error_stack");
    });
  });
});

// ---------------------------------------------------------------------------
// buildErrorsHistogramSql
// ---------------------------------------------------------------------------

describe("buildErrorsHistogramSql", () => {
  it("includes histogram() call with the interval", () => {
    const sql = buildErrorsHistogramSql(makeCtx(), "5 minute");

    expect(sql).toContain("histogram(_timestamp, '5 minute') AS ts");
  });

  it("includes GROUP BY ts, error_handling", () => {
    const sql = buildErrorsHistogramSql(makeCtx(), "5 minute");

    expect(sql).toContain("GROUP BY ts, error_handling");
  });

  it("includes ORDER BY ts", () => {
    const sql = buildErrorsHistogramSql(makeCtx(), "5 minute");

    expect(sql).toContain("ORDER BY ts");
  });

  it("includes WHERE type='error'", () => {
    const sql = buildErrorsHistogramSql(makeCtx(), "5 minute");

    expect(sql).toContain("WHERE type='error'");
  });

  it("appends user query when non-empty", () => {
    const sql = buildErrorsHistogramSql(makeCtx({ userQuery: "env='prod'" }), "1 hour");

    expect(sql).toContain("AND (env='prod')");
  });

  it("appends service filter when service is set", () => {
    const sql = buildErrorsHistogramSql(makeCtx({ service: "checkout" }), "1 hour");

    expect(sql).toContain("AND service='checkout'");
  });
});

// ---------------------------------------------------------------------------
// buildTrendsSql
// ---------------------------------------------------------------------------

describe("buildTrendsSql", () => {
  it("returns null for empty messages array", () => {
    expect(buildTrendsSql(makeCtx(), "5 minute", [])).toBeNull();
  });

  it("returns null when all messages exceed MAX_TREND_MESSAGE_LEN", () => {
    const longMsg = "x".repeat(MAX_TREND_MESSAGE_LEN + 1);
    expect(buildTrendsSql(makeCtx(), "5 minute", [longMsg])).toBeNull();
  });

  it("drops messages longer than MAX_TREND_MESSAGE_LEN but keeps valid ones", () => {
    const longMsg = "x".repeat(MAX_TREND_MESSAGE_LEN + 1);
    const shortMsg = "TypeError: fail";

    const sql = buildTrendsSql(makeCtx(), "5 minute", [longMsg, shortMsg]);

    expect(sql).not.toBeNull();
    expect(sql).toContain("'TypeError: fail'");
    expect(sql).not.toContain("x".repeat(MAX_TREND_MESSAGE_LEN + 1));
  });

  it("includes AND error_message IN (...) with escaped messages", () => {
    const sql = buildTrendsSql(makeCtx(), "5 minute", ["TypeError: fail", "o'clock error"]);

    expect(sql).toContain("AND error_message IN (");
    expect(sql).toContain("'TypeError: fail'");
    expect(sql).toContain("'o''clock error'");
  });

  it("escapes single quotes in message values in the IN list", () => {
    const sql = buildTrendsSql(makeCtx(), "5 minute", ["it's broken"]);

    expect(sql).toContain("'it''s broken'");
  });

  it("includes histogram() call", () => {
    const sql = buildTrendsSql(makeCtx(), "5 minute", ["Error: fail"]);

    expect(sql).toContain("histogram(_timestamp, '5 minute') AS ts");
  });

  it("includes WHERE type='error'", () => {
    const sql = buildTrendsSql(makeCtx(), "5 minute", ["Error: fail"]);

    expect(sql).toContain("WHERE type='error'");
  });

  it("appends user query when non-empty", () => {
    const sql = buildTrendsSql(makeCtx({ userQuery: "env='prod'" }), "5 minute", ["fail"]);

    expect(sql).toContain("AND (env='prod')");
  });

  it("includes group fields in GROUP BY", () => {
    const sql = buildTrendsSql(makeCtx(), "5 minute", ["fail"]);

    expect(sql).toContain("GROUP BY ts, error_type, error_message, error_handling");
  });
});

// ---------------------------------------------------------------------------
// buildErrorKpisSql
// ---------------------------------------------------------------------------

describe("buildErrorKpisSql", () => {
  it("includes COUNT(*) AS total_errors", () => {
    const sql = buildErrorKpisSql(makeCtx());

    expect(sql).toContain("COUNT(*) AS total_errors");
  });

  it("includes COUNT(DISTINCT session_id) AS error_sessions when session_id in schema", () => {
    const sql = buildErrorKpisSql(makeCtx());

    expect(sql).toContain("COUNT(DISTINCT session_id) AS error_sessions");
  });

  it("includes COUNT(DISTINCT usr_id) AS users_affected when user field present", () => {
    const sql = buildErrorKpisSql(makeCtx());

    expect(sql).toContain("COUNT(DISTINCT usr_id) AS users_affected");
  });

  it("includes WHERE type='error'", () => {
    const sql = buildErrorKpisSql(makeCtx());

    expect(sql).toContain("WHERE type='error'");
  });

  it("appends user query when ctx.userQuery is set", () => {
    const sql = buildErrorKpisSql(makeCtx({ userQuery: "level='error'" }));

    expect(sql).toContain("AND (level='error')");
  });

  it("appends service filter", () => {
    const sql = buildErrorKpisSql(makeCtx({ service: "api" }));

    expect(sql).toContain("AND service='api'");
  });
});

// ---------------------------------------------------------------------------
// buildDenominatorsSql
// ---------------------------------------------------------------------------

describe("buildDenominatorsSql", () => {
  it("includes COUNT(DISTINCT session_id) AS total_sessions", () => {
    const sql = buildDenominatorsSql(makeCtx());

    expect(sql).toContain("COUNT(DISTINCT session_id) AS total_sessions");
  });

  it("includes COUNT(DISTINCT usr_id) AS total_users when user field present", () => {
    const sql = buildDenominatorsSql(makeCtx());

    expect(sql).toContain("COUNT(DISTINCT usr_id) AS total_users");
  });

  it("filters session_id IS NOT NULL", () => {
    const sql = buildDenominatorsSql(makeCtx());

    expect(sql).toContain("WHERE session_id IS NOT NULL");
  });

  it("does NOT contain WHERE type='error'", () => {
    const sql = buildDenominatorsSql(makeCtx());

    expect(sql).not.toContain("type='error'");
  });

  it("does NOT apply user query even when ctx.userQuery is set", () => {
    const sql = buildDenominatorsSql(makeCtx({ userQuery: "user_agent='Chrome'" }));

    expect(sql).not.toContain("AND (user_agent='Chrome')");
  });

  it("applies service filter", () => {
    const sql = buildDenominatorsSql(makeCtx({ service: "frontend" }));

    expect(sql).toContain("AND service='frontend'");
  });
});

// ---------------------------------------------------------------------------
// buildDeploysSql
// ---------------------------------------------------------------------------

describe("buildDeploysSql", () => {
  it("selects version and MIN(_timestamp) AS first_seen", () => {
    const sql = buildDeploysSql(makeCtx());

    expect(sql).toContain("SELECT version, MIN(_timestamp) AS first_seen");
  });

  it("filters version IS NOT NULL", () => {
    const sql = buildDeploysSql(makeCtx());

    expect(sql).toContain("WHERE version IS NOT NULL");
  });

  it("does NOT filter by type='error'", () => {
    const sql = buildDeploysSql(makeCtx());

    expect(sql).not.toContain("type='error'");
  });

  it("groups by version", () => {
    const sql = buildDeploysSql(makeCtx());

    expect(sql).toContain("GROUP BY version");
  });

  it("includes LIMIT 10", () => {
    const sql = buildDeploysSql(makeCtx());

    expect(sql).toContain("LIMIT 10");
  });

  it("orders by first_seen DESC", () => {
    const sql = buildDeploysSql(makeCtx());

    expect(sql).toContain("ORDER BY first_seen DESC");
  });

  it("applies service filter when service is set", () => {
    const sql = buildDeploysSql(makeCtx({ service: "worker" }));

    expect(sql).toContain("AND service='worker'");
  });

  it("does NOT apply user query even when userQuery is set", () => {
    const sql = buildDeploysSql(makeCtx({ userQuery: "region='us-east'" }));

    expect(sql).not.toContain("AND (region='us-east')");
  });
});

// ---------------------------------------------------------------------------
// pivotStackedHistogram
// ---------------------------------------------------------------------------

describe("pivotStackedHistogram", () => {
  // 1-hour window at 5-minute buckets = 12 buckets
  const windowStart = Date.UTC(2026, 0, 1, 0, 0, 0) * 1000; // µs
  const windowEnd = Date.UTC(2026, 0, 1, 1, 0, 0) * 1000; // µs
  const intervalMicros = 5 * 60 * 1_000_000; // 5 minutes in µs

  it("produces 12 buckets for a 1-hour window at 5-minute intervals", () => {
    const buckets = pivotStackedHistogram([], windowStart, windowEnd, intervalMicros);
    expect(buckets.length).toBe(12);
  });

  it("initialises all buckets with handled=0 and unhandled=0", () => {
    const buckets = pivotStackedHistogram([], windowStart, windowEnd, intervalMicros);

    for (const bucket of buckets) {
      expect(bucket.handled).toBe(0);
      expect(bucket.unhandled).toBe(0);
    }
  });

  it("puts 'handled' events into the handled counter", () => {
    const hitTs = new Date(windowStart / 1000 + 2 * 60 * 1000).toISOString(); // 2 min into window
    const hits = [{ ts: hitTs, error_handling: "handled", events: 5 }];

    const buckets = pivotStackedHistogram(hits, windowStart, windowEnd, intervalMicros);

    // 2 min → bucket index 0 (0-5 min range)
    expect(buckets[0].handled).toBe(5);
    expect(buckets[0].unhandled).toBe(0);
  });

  it("puts 'unhandled' events into the unhandled counter", () => {
    const hitTs = new Date(windowStart / 1000 + 2 * 60 * 1000).toISOString();
    const hits = [{ ts: hitTs, error_handling: "unhandled", events: 3 }];

    const buckets = pivotStackedHistogram(hits, windowStart, windowEnd, intervalMicros);

    expect(buckets[0].unhandled).toBe(3);
    expect(buckets[0].handled).toBe(0);
  });

  it("treats null error_handling as unhandled", () => {
    const hitTs = new Date(windowStart / 1000 + 2 * 60 * 1000).toISOString();
    const hits = [{ ts: hitTs, error_handling: undefined, events: 7 }];

    const buckets = pivotStackedHistogram(hits, windowStart, windowEnd, intervalMicros);

    expect(buckets[0].unhandled).toBe(7);
    expect(buckets[0].handled).toBe(0);
  });

  it("ignores hits that fall outside the window range", () => {
    // A timestamp 2 hours after windowEnd
    const outOfRangeTs = new Date(windowEnd / 1000 + 2 * 60 * 60 * 1000).toISOString();
    const hits = [{ ts: outOfRangeTs, error_handling: "handled", events: 99 }];

    const buckets = pivotStackedHistogram(hits, windowStart, windowEnd, intervalMicros);

    const totalHandled = buckets.reduce((sum, b) => sum + b.handled, 0);
    expect(totalHandled).toBe(0);
  });

  it("accumulates multiple hits in the same bucket", () => {
    // Both hits in the first 5-minute bucket
    const ts1 = new Date(windowStart / 1000 + 60 * 1000).toISOString(); // 1 min
    const ts2 = new Date(windowStart / 1000 + 2 * 60 * 1000).toISOString(); // 2 min
    const hits = [
      { ts: ts1, error_handling: "unhandled", events: 2 },
      { ts: ts2, error_handling: "unhandled", events: 3 },
    ];

    const buckets = pivotStackedHistogram(hits, windowStart, windowEnd, intervalMicros);

    expect(buckets[0].unhandled).toBe(5);
  });

  it("places hits in the correct bucket index", () => {
    // 7 minutes into window → bucket index 1 (5-10 min range)
    const sevenMinTs = new Date(windowStart / 1000 + 7 * 60 * 1000).toISOString();
    const hits = [{ ts: sevenMinTs, error_handling: "handled", events: 4 }];

    const buckets = pivotStackedHistogram(hits, windowStart, windowEnd, intervalMicros);

    expect(buckets[1].handled).toBe(4);
    expect(buckets[0].handled).toBe(0);
  });

  it("accepts numeric ts keys (microseconds)", () => {
    const numericTs = windowStart + 2 * 60 * 1_000_000; // 2 min in µs
    const hits = [{ ts: numericTs, error_handling: "handled", events: 6 }];

    const buckets = pivotStackedHistogram(hits, windowStart, windowEnd, intervalMicros);

    expect(buckets[0].handled).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// pivotTrends
// ---------------------------------------------------------------------------

describe("pivotTrends", () => {
  const windowStart = Date.UTC(2026, 0, 1, 0, 0, 0) * 1000; // µs
  const windowEnd = Date.UTC(2026, 0, 1, 1, 0, 0) * 1000; // µs
  const intervalMicros = 5 * 60 * 1_000_000; // 5 minutes

  it("returns empty object for no hits", () => {
    const result = pivotTrends([], windowStart, windowEnd, intervalMicros);
    expect(result).toEqual({});
  });

  it("creates a zero-filled array of length 12 for each issue key", () => {
    const ts = new Date(windowStart / 1000 + 2 * 60 * 1000).toISOString();
    const hits = [
      {
        ts,
        error_type: "TypeError",
        error_message: "fail",
        error_handling: "unhandled",
        events: 1,
      },
    ];

    const result = pivotTrends(hits, windowStart, windowEnd, intervalMicros);
    const key = Object.keys(result)[0];

    expect(result[key].length).toBe(12);
  });

  it("accumulates events at the correct bucket index", () => {
    // 7 min into window → bucket index 1
    const ts = new Date(windowStart / 1000 + 7 * 60 * 1000).toISOString();
    const hits = [
      {
        ts,
        error_type: "TypeError",
        error_message: "fail",
        error_handling: "unhandled",
        events: 3,
      },
    ];

    const result = pivotTrends(hits, windowStart, windowEnd, intervalMicros);
    const key = Object.keys(result)[0];

    expect(result[key][1]).toBe(3);
    expect(result[key][0]).toBe(0);
  });

  it("uses issueKey to key trends — same signature → same entry", () => {
    const ts1 = new Date(windowStart / 1000 + 1 * 60 * 1000).toISOString();
    const ts2 = new Date(windowStart / 1000 + 2 * 60 * 1000).toISOString();
    const hits = [
      {
        ts: ts1,
        error_type: "TypeError",
        error_message: "fail",
        error_handling: "unhandled",
        events: 2,
      },
      {
        ts: ts2,
        error_type: "TypeError",
        error_message: "fail",
        error_handling: "unhandled",
        events: 3,
      },
    ];

    const result = pivotTrends(hits, windowStart, windowEnd, intervalMicros);

    expect(Object.keys(result).length).toBe(1);
    expect(result[Object.keys(result)[0]][0]).toBe(5);
  });

  it("creates separate entries for different issue keys", () => {
    const ts = new Date(windowStart / 1000 + 1 * 60 * 1000).toISOString();
    const hits = [
      {
        ts,
        error_type: "TypeError",
        error_message: "fail",
        error_handling: "unhandled",
        events: 1,
      },
      {
        ts,
        error_type: "ReferenceError",
        error_message: "boom",
        error_handling: "handled",
        events: 2,
      },
    ];

    const result = pivotTrends(hits, windowStart, windowEnd, intervalMicros);

    expect(Object.keys(result).length).toBe(2);
  });

  it("ignores hits outside the window range", () => {
    const outTs = new Date(windowEnd / 1000 + 60 * 60 * 1000).toISOString();
    const hits = [
      {
        ts: outTs,
        error_type: "TypeError",
        error_message: "fail",
        error_handling: "unhandled",
        events: 99,
      },
    ];

    const result = pivotTrends(hits, windowStart, windowEnd, intervalMicros);

    expect(result).toEqual({});
  });

  it("handles numeric ts keys correctly", () => {
    // Bucket 0: 0-5 min
    const numericTs = windowStart + 1 * 60 * 1_000_000;
    const hits = [
      { ts: numericTs, error_type: "Error", error_message: "x", error_handling: null, events: 7 },
    ];

    const result = pivotTrends(hits, windowStart, windowEnd, intervalMicros);
    const key = Object.keys(result)[0];

    expect(result[key][0]).toBe(7);
  });
});
