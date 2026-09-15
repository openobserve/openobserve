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
  formatContextKey,
  formatContextValue,
  formatToolCallMessage,
  getToolCallDisplayData,
  hasToolCallDetails,
  splitAroundHighlight,
  truncateQuery,
  type ToolCallBlock,
} from "@/components/O2AIChat.toolcall";
import { raw, type TranslateFn } from "@/types/i18n";

// Mirrors the interpolating shape of t(): the param value ends up inside the sentence.
const t = ((key: string, params?: Record<string, any>) =>
  raw(params ? `${key}[${Object.values(params).join("|")}]` : key)) as unknown as TranslateFn;

const block = (over: Partial<ToolCallBlock>): ToolCallBlock =>
  ({ type: "tool_call", ...over }) as ToolCallBlock;

describe("truncateQuery", () => {
  it("returns empty for falsy input", () => {
    expect(truncateQuery("")).toBe("");
  });

  it("keeps a query at exactly the limit", () => {
    expect(truncateQuery("a".repeat(100))).toBe("a".repeat(100));
  });

  it("ellipsises past the limit", () => {
    expect(truncateQuery("a".repeat(101))).toBe("a".repeat(100) + "...");
  });
});

describe("formatContextKey", () => {
  it("title-cases snake_case", () => {
    expect(formatContextKey("start_time")).toBe("Start Time");
  });
});

describe("formatContextValue", () => {
  it("truncates strings over 30 chars", () => {
    expect(formatContextValue("b".repeat(31))).toBe("b".repeat(30) + "...");
  });

  it("stringifies non-strings without truncating", () => {
    const long = Array.from({ length: 40 }, (_, i) => i);
    expect(formatContextValue(long)).toBe(long.join(","));
    expect(formatContextValue(null)).toBe("null");
  });
});

describe("getToolCallDisplayData", () => {
  it("returns null without a context", () => {
    expect(getToolCallDisplayData(null)).toBeNull();
  });

  it("returns null when nothing recognisable is present", () => {
    expect(getToolCallDisplayData({ unrelated: 1 })).toBeNull();
  });

  it("pulls the nested search query fields", () => {
    expect(
      getToolCallDisplayData({
        request_body: {
          query: {
            sql: "SELECT 1",
            start_time: 1,
            end_time: 2,
            from: 0,
            size: 10,
            query_type: "sql",
            vrl: ".a=1",
          },
        },
      }),
    ).toEqual({
      query: "SELECT 1",
      start_time: 1,
      end_time: 2,
      from: 0,
      size: 10,
      query_type: "sql",
      vrl: ".a=1",
    });
  });

  it("lets request_body.function win over context.vrl", () => {
    expect(
      getToolCallDisplayData({ vrl: "old", request_body: { function: "new" } })!.vrl,
    ).toBe("new");
  });

  it("reads the flat shapes", () => {
    expect(getToolCallDisplayData({ sql: "S", stream_name: "n", type: "logs", command: "ls" })).toEqual(
      { query: "S", stream: "n", type: "logs", command: "ls" },
    );
  });
});

describe("hasToolCallDetails", () => {
  it("is true for a failure, a summary, or a response", () => {
    expect(hasToolCallDetails(block({ success: false }))).toBe(true);
    expect(hasToolCallDetails(block({ summary: { count: 0 } as any }))).toBe(true);
    expect(hasToolCallDetails(block({ response: {} }))).toBe(true);
  });

  it("falls back to whether the context has display data", () => {
    expect(hasToolCallDetails(block({ context: { stream_name: "n" } }))).toBe(true);
    expect(hasToolCallDetails(block({ context: {} }))).toBe(false);
  });
});

describe("splitAroundHighlight", () => {
  it("splits around the highlight", () => {
    expect(splitAroundHighlight("see foo now", "foo")).toEqual({
      text: "see ",
      highlight: "foo",
      suffix: " now",
    });
  });

  it("returns the whole sentence when the highlight is absent", () => {
    expect(splitAroundHighlight("see now", "foo")).toEqual({
      text: "see now",
      highlight: null,
      suffix: "",
    });
  });
});

describe("formatToolCallMessage", () => {
  it("reports VRL validation outcomes", () => {
    expect(formatToolCallMessage(block({ tool: "testFunction", success: false }), t).text).toBe(
      "aiAssistant.aiChat.toolVrlValidationFailed",
    );
    expect(formatToolCallMessage(block({ tool: "testFunction" }), t).text).toBe(
      "aiAssistant.aiChat.toolVrlValidated",
    );
  });

  it("reports a failed SearchSQL", () => {
    expect(formatToolCallMessage(block({ tool: "SearchSQL", success: false }), t).text).toBe(
      "aiAssistant.aiChat.toolQueryFailed",
    );
  });

  it("reports SearchSQL hit counts with the stream type", () => {
    const out = formatToolCallMessage(
      block({ tool: "SearchSQL", response: { total: 7 }, context: { type: "traces" } }),
      t,
    );
    expect(out.text).toBe("aiAssistant.aiChat.toolQueriedStream[traces]");
    expect(out.highlight).toBe("aiAssistant.aiChat.toolResultsCount[7]");
  });

  it("defaults the SearchSQL stream type to logs", () => {
    expect(
      formatToolCallMessage(block({ tool: "SearchSQL", response: { total: 0 } }), t).text,
    ).toBe("aiAssistant.aiChat.toolQueriedStream[logs]");
  });

  it("highlights the id in the Get* tool sentences", () => {
    expect(
      formatToolCallMessage(block({ tool: "GetAlert", context: { alert_id: "a1" } }), t).highlight,
    ).toBe("a1");
    expect(
      formatToolCallMessage(block({ tool: "GetIncident", context: { incident_id: "i1" } }), t)
        .highlight,
    ).toBe("i1");
    expect(
      formatToolCallMessage(block({ tool: "GetDashboard", context: { dashboard_id: "d1" } }), t)
        .highlight,
    ).toBe("d1");
    expect(
      formatToolCallMessage(block({ tool: "StreamSchema", context: { stream_name: "s1" } }), t)
        .highlight,
    ).toBe("s1");
  });

  it("appends a found-count for list tools", () => {
    const out = formatToolCallMessage(
      block({ tool: "ListAlerts", message: raw("Listing"), response: { total: 3 } }),
      t,
    );
    expect(out.text).toBe("Listing ");
    expect(out.highlight).toBe("aiAssistant.aiChat.toolFoundCount[3]");
  });

  it("falls back to the tool name when a list tool has no message", () => {
    expect(
      formatToolCallMessage(block({ tool: "ListAlerts", response: { total: 3 } }), t).text,
    ).toBe("ListAlerts ");
  });

  it("truncates a long failure message", () => {
    const out = formatToolCallMessage(
      block({ success: false, resultMessage: "e".repeat(61) }),
      t,
    );
    expect(out.text).toBe("e".repeat(60) + "...");
  });

  it("appends a results count from the summary", () => {
    const out = formatToolCallMessage(
      block({ tool: "Whatever", summary: { count: 2 } as any }),
      t,
    );
    expect(out.text).toBe("Whatever ");
    expect(out.highlight).toBe("aiAssistant.aiChat.toolResultsCount[2]");
  });

  it("falls back to the block message", () => {
    expect(formatToolCallMessage(block({ message: raw("plain") }), t).text).toBe("plain");
  });
});
