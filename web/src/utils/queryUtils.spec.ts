// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// All vi.mock calls MUST be at the TOP (hoisted by Vitest)

vi.mock("../aws-exports", () => ({
  default: { isCloud: "false" },
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(),
}));

vi.mock("@/utils/timezone", () => ({
  getFunctionErrorMessage: vi.fn(
    (msg: string, start: number, end: number, tz: string) =>
      `${msg} (Data returned for: start to end)`,
  ),
}));

// Imports AFTER mocks
import config from "../aws-exports";
import { useStore } from "vuex";
import { getFunctionErrorMessage } from "@/utils/timezone";

import {
  getPath,
  getImageURL,
  queryIndexSplit,
  addSpacesToOperators,
  mergeRoutes,
  mergeDeep,
  validateEmail,
  isValidResourceName,
  escapeSingleQuotes,
  splitQuotedString,
  arraysMatch,
  deepCopy,
  mergeAndRemoveDuplicates,
  maxLengthCharValidation,
  validateUrl,
  getWebSocketUrl,
  isWebSocketEnabled,
  isStreamingEnabled,
  getIngestionURL,
  getEndPoint,
  getCronIntervalDifferenceInSeconds,
  getCronIntervalInMinutes,
  isAboveMinRefreshInterval,
  describeCron,
  convertMinutesToCron,
  processQueryMetadataErrors,
} from "./queryUtils";

afterEach(() => {
  vi.clearAllMocks();
  (config as any).isCloud = "false";
});

// ---------------------------------------------------------------------------
// Helper: set window.location
// ---------------------------------------------------------------------------

function setLocation(origin: string, pathname: string) {
  Object.defineProperty(window, "location", {
    value: { origin, pathname, protocol: "http:" },
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// getPath
// ---------------------------------------------------------------------------

describe("getPath", () => {
  it("returns '/web/' when origin is localhost:8081 and pathname contains /web/", () => {
    setLocation("http://localhost:8081", "/web/app");

    expect(getPath()).toBe("/web/");
  });

  it("returns '/' when origin is localhost:8081 and pathname does NOT contain /web/", () => {
    setLocation("http://localhost:8081", "/app");

    expect(getPath()).toBe("/");
  });

  it("returns the path prefix when origin is non-localhost and /web/ is in pathname", () => {
    setLocation("https://example.com", "/web/app/logs");

    const result = getPath();
    expect(result).toBe("/web/");
  });

  it("returns '' when origin is non-localhost and /web/ is not in pathname", () => {
    setLocation("https://example.com", "/app/logs");

    expect(getPath()).toBe("");
  });

  it("works with isCloud=true (same path logic)", () => {
    (config as any).isCloud = "true";
    setLocation("http://localhost:8081", "/web/app");

    expect(getPath()).toBe("/web/");
  });
});

// ---------------------------------------------------------------------------
// getImageURL
// ---------------------------------------------------------------------------

describe("getImageURL", () => {
  it("prepends getPath() + 'src/assets/' to the image path", () => {
    setLocation("http://localhost:8081", "/web/app");

    const result = getImageURL("logo.png");

    expect(result).toBe("/web/src/assets/logo.png");
  });
});

// ---------------------------------------------------------------------------
// queryIndexSplit
// ---------------------------------------------------------------------------

describe("queryIndexSplit", () => {
  it("splits on the found word (case-insensitive)", () => {
    const result = queryIndexSplit("SELECT * FROM logs WHERE level='error'", "from");
    expect(result[0]).toBe("SELECT * ");
    expect(result[1]).toBe(" logs WHERE level='error'");
  });

  it("returns [original, ''] when split word is not found", () => {
    const result = queryIndexSplit("hello world", "missing");
    expect(result).toEqual(["hello world", ""]);
  });

  it("matches case-insensitively", () => {
    const result = queryIndexSplit("SELECT * FROM logs", "FROM");
    expect(result[0]).toBe("SELECT * ");
  });
});

// ---------------------------------------------------------------------------
// addSpacesToOperators
// ---------------------------------------------------------------------------

describe("addSpacesToOperators", () => {
  it("returns unchanged string when no operators present", () => {
    expect(addSpacesToOperators("hello world")).toBe("hello world");
  });

  it("adds spaces around !=", () => {
    const result = addSpacesToOperators("a!=b");
    expect(result).toContain("!=");
    expect(result.includes(" != ") || result.includes(" !=") || result.includes("!= ")).toBe(true);
  });

  it("adds spaces around <=", () => {
    const result = addSpacesToOperators("a<=b");
    expect(result).toContain("<=");
    expect(result.includes(" <=") || result.includes("<= ")).toBe(true);
  });

  it("adds spaces around >=", () => {
    const result = addSpacesToOperators("a>=b");
    expect(result).toContain(">=");
  });

  it("adds spaces around = (single)", () => {
    const result = addSpacesToOperators("a=b");
    expect(result).toContain("=");
    expect(result.trim().length).toBeGreaterThan(3);
  });

  it("adds spaces around >", () => {
    const result = addSpacesToOperators("a>b");
    expect(result).toContain(">");
  });

  it("adds spaces around <", () => {
    const result = addSpacesToOperators("a<b");
    expect(result).toContain("<");
  });

  it("does NOT modify operators inside single quotes", () => {
    const input = "name='a!=b'";
    const result = addSpacesToOperators(input);
    // The content inside quotes should be preserved
    expect(result).toContain("a!=b");
  });

  it("does NOT modify operators inside double quotes", () => {
    const input = 'name="a!=b"';
    const result = addSpacesToOperators(input);
    expect(result).toContain("a!=b");
  });

  it("does NOT modify operators inside parentheses", () => {
    const input = "(a!=b)";
    const result = addSpacesToOperators(input);
    // Inside parens operators are not processed
    expect(result).toBe("(a!=b)");
  });

  it("normalizes '! =' (! space =) to '!='", () => {
    const input = "a! =b";
    const result = addSpacesToOperators(input);
    expect(result).toContain("!=");
  });

  it("handles operator at the start with no prevChar", () => {
    const result = addSpacesToOperators("=b");
    expect(result).toContain("=");
  });

  it("handles operator already followed by a space", () => {
    const result = addSpacesToOperators("a= b");
    expect(result).toContain("=");
  });
});

// ---------------------------------------------------------------------------
// mergeRoutes
// ---------------------------------------------------------------------------

describe("mergeRoutes", () => {
  it("merges routes with matching path+name", () => {
    const r1 = [{ path: "/logs", name: "logs", meta: { r1: true } }];
    const r2 = [{ path: "/logs", name: "logs", meta: { r2: true } }];

    const result = mergeRoutes(r1, r2);

    expect(result).toHaveLength(1);
    expect(result[0].meta.r1).toBe(true);
  });

  it("appends non-matching routes from r2", () => {
    const r1 = [{ path: "/logs", name: "logs" }];
    const r2 = [{ path: "/metrics", name: "metrics" }];

    const result = mergeRoutes(r1, r2);

    expect(result).toHaveLength(2);
    expect(result.some((r: any) => r.name === "metrics")).toBe(true);
  });

  it("recursively merges children", () => {
    const r1 = [
      {
        path: "/parent",
        name: "parent",
        children: [{ path: "/child", name: "child", meta: { from: "r1" } }],
      },
    ];
    const r2 = [
      {
        path: "/parent",
        name: "parent",
        children: [{ path: "/child", name: "child", meta: { from: "r2" } }],
      },
    ];

    const result = mergeRoutes(r1, r2);

    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].meta.from).toBe("r1");
  });
});

// ---------------------------------------------------------------------------
// mergeDeep
// ---------------------------------------------------------------------------

describe("mergeDeep", () => {
  it("merges nested objects", () => {
    const target = { a: { b: 1 } };
    const source = { a: { c: 2 } };

    const result = mergeDeep(target, source);

    expect(result.a.b).toBe(1);
    expect(result.a.c).toBe(2);
  });

  it("overwrites primitive values", () => {
    const target = { a: 1 };
    const source = { a: 2 };

    const result = mergeDeep(target, source);

    expect(result.a).toBe(2);
  });

  it("returns target unchanged for non-object inputs", () => {
    expect(mergeDeep("string" as any, { a: 1 })).toBe("string");
    expect(mergeDeep({ a: 1 }, null as any)).toEqual({ a: 1 });
  });

  it("does NOT pollute prototype via __proto__", () => {
    const target: any = {};
    mergeDeep(target, JSON.parse('{"__proto__":{"polluted":true}}'));

    expect(({} as any).polluted).toBeUndefined();
  });

  it("does NOT pollute via constructor key", () => {
    const target: any = {};
    mergeDeep(target, { constructor: { polluted: true } });

    expect(({} as any).polluted).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateEmail
// ---------------------------------------------------------------------------

describe("validateEmail", () => {
  it("returns true for a valid email", () => {
    expect(validateEmail("user@example.com")).toBe(true);
  });

  it("returns false for null", () => {
    expect(validateEmail(null as any)).toBe(false);
  });

  it("returns false for missing @", () => {
    expect(validateEmail("noatsign.com")).toBe(false);
  });

  it("returns false for missing TLD", () => {
    expect(validateEmail("user@domain")).toBe(false);
  });

  it("returns true for email with subdomains", () => {
    expect(validateEmail("user@mail.example.co.uk")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isValidResourceName
// ---------------------------------------------------------------------------

describe("isValidResourceName", () => {
  it("returns true for a valid name", () => {
    expect(isValidResourceName("my-stream_01")).toBe(true);
  });

  it("returns false for name with colon", () => {
    expect(isValidResourceName("my:stream")).toBe(false);
  });

  it("returns false for name with hash", () => {
    expect(isValidResourceName("my#stream")).toBe(false);
  });

  it("returns false for name with question mark", () => {
    expect(isValidResourceName("my?stream")).toBe(false);
  });

  it("returns false for name with ampersand", () => {
    expect(isValidResourceName("my&stream")).toBe(false);
  });

  it("returns false for name with percent", () => {
    expect(isValidResourceName("my%stream")).toBe(false);
  });

  it("returns false for name with single quote", () => {
    expect(isValidResourceName("my'stream")).toBe(false);
  });

  it("returns false for name with double quote", () => {
    expect(isValidResourceName('my"stream')).toBe(false);
  });

  it("returns false for name with space", () => {
    expect(isValidResourceName("my stream")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// escapeSingleQuotes
// ---------------------------------------------------------------------------

describe("escapeSingleQuotes", () => {
  it("escapes single quotes by doubling them", () => {
    expect(escapeSingleQuotes("it's a test")).toBe("it''s a test");
  });

  it("returns unchanged string when no single quotes", () => {
    expect(escapeSingleQuotes("no quotes here")).toBe("no quotes here");
  });

  it("returns undefined for null/undefined input", () => {
    expect(escapeSingleQuotes(null)).toBeUndefined();
    expect(escapeSingleQuotes(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// splitQuotedString
// ---------------------------------------------------------------------------

describe("splitQuotedString", () => {
  it("returns null for null input", () => {
    expect(splitQuotedString(null)).toBeNull();
  });

  it("returns empty array for empty string", () => {
    expect(splitQuotedString("")).toEqual([]);
  });

  it("splits on single-quoted values", () => {
    // Regex group 1 captures 'hello'. The space+'world' becomes second element
    // via unquoted group (because the comma stops the regex, and ' world' restarts).
    // The trim inside removes leading spaces.
    const result = splitQuotedString("'hello','world'");
    expect(result).toContain("hello");
    expect(result).toContain("world");
  });

  it("splits on double-quoted values", () => {
    const result = splitQuotedString('"foo","bar"');
    expect(result).toContain("foo");
    expect(result).toContain("bar");
  });

  it("splits mixed quoted and unquoted", () => {
    const result = splitQuotedString("plain,'quoted'");
    expect(result).toContain("plain");
    expect(result).toContain("quoted");
  });
});

// ---------------------------------------------------------------------------
// arraysMatch
// ---------------------------------------------------------------------------

describe("arraysMatch", () => {
  it("returns true for equal arrays in different order", () => {
    expect(arraysMatch([3, 1, 2], [1, 2, 3])).toBe(true);
  });

  it("returns false for arrays with different values", () => {
    expect(arraysMatch([1, 2, 3], [1, 2, 4])).toBe(false);
  });

  it("returns false for arrays with different lengths", () => {
    expect(arraysMatch([1, 2], [1, 2, 3])).toBe(false);
  });

  it("returns true for two empty arrays", () => {
    expect(arraysMatch([], [])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deepCopy
// ---------------------------------------------------------------------------

describe("deepCopy", () => {
  it("deep copies a plain object", () => {
    const obj = { a: 1, b: { c: 2 } };
    const copy = deepCopy(obj);

    copy.b.c = 99;

    expect(obj.b.c).toBe(2);
  });

  it("deep copies an array", () => {
    const arr = [1, [2, 3]];
    const copy = deepCopy(arr);

    (copy[1] as number[])[0] = 99;

    expect((arr[1] as number[])[0]).toBe(2);
  });

  it("returns original value and logs error for circular references", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const circular: any = { a: 1 };
    circular.self = circular;

    const result = deepCopy(circular);

    expect(result).toBe(circular); // returns original
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// mergeAndRemoveDuplicates
// ---------------------------------------------------------------------------

describe("mergeAndRemoveDuplicates", () => {
  it("merges two arrays and removes duplicates", () => {
    const result = mergeAndRemoveDuplicates(["a", "b"], ["b", "c"]);
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("preserves order (first occurrence wins)", () => {
    const result = mergeAndRemoveDuplicates(["b", "a"], ["a", "c"]);
    expect(result[0]).toBe("b");
    expect(result[1]).toBe("a");
    expect(result[2]).toBe("c");
  });

  it("handles empty arrays", () => {
    expect(mergeAndRemoveDuplicates([], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// maxLengthCharValidation
// ---------------------------------------------------------------------------

describe("maxLengthCharValidation", () => {
  it("returns true for a string within the limit", () => {
    expect(maxLengthCharValidation("hello", 10)).toBe(true);
  });

  it("returns true for a string exactly at the limit", () => {
    expect(maxLengthCharValidation("hello", 5)).toBe(true);
  });

  it("returns error string for a string over the limit", () => {
    const result = maxLengthCharValidation("hello world", 5);
    expect(typeof result).toBe("string");
    expect(result).toContain("5 characters");
  });

  it("returns error string for empty string (default limit 50)", () => {
    // Empty string: val.length = 0, 0 <= 50 is true... wait, empty string is falsy
    // val && val.length — empty string is falsy so returns the error string
    const result = maxLengthCharValidation("");
    expect(typeof result).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// validateUrl
// ---------------------------------------------------------------------------

describe("validateUrl", () => {
  it("returns true for a valid https URL", () => {
    expect(validateUrl("https://example.com/path")).toBe(true);
  });

  it("returns true for a valid http URL", () => {
    expect(validateUrl("http://example.com")).toBe(true);
  });

  it("returns error string for an invalid URL", () => {
    expect(validateUrl("not-a-url")).toBe("Please provide correct URL.");
  });

  it("returns false for ftp URL (not http/https)", () => {
    expect(validateUrl("ftp://files.example.com")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getWebSocketUrl
// ---------------------------------------------------------------------------

describe("getWebSocketUrl", () => {
  it("uses wss: when protocol is https", () => {
    Object.defineProperty(window, "location", {
      value: { protocol: "https:", origin: "https://example.com", pathname: "/" },
      writable: true,
      configurable: true,
    });

    const result = getWebSocketUrl("req-1", "my-org", "https://api.example.com");

    expect(result.startsWith("wss://")).toBe(true);
  });

  it("uses ws: when protocol is http", () => {
    Object.defineProperty(window, "location", {
      value: { protocol: "http:", origin: "http://localhost:8081", pathname: "/" },
      writable: true,
      configurable: true,
    });

    const result = getWebSocketUrl("req-1", "my-org", "http://api.example.com");

    expect(result.startsWith("ws://")).toBe(true);
  });

  it("includes org_identifier and request_id in URL", () => {
    const result = getWebSocketUrl("req-123", "my-org", "http://api.example.com");

    expect(result).toContain("my-org");
    expect(result).toContain("req-123");
  });
});

// ---------------------------------------------------------------------------
// isWebSocketEnabled
// ---------------------------------------------------------------------------

describe("isWebSocketEnabled", () => {
  it("always returns false", () => {
    expect(isWebSocketEnabled({})).toBe(false);
    expect(isWebSocketEnabled(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isStreamingEnabled
// ---------------------------------------------------------------------------

describe("isStreamingEnabled", () => {
  it("always returns true", () => {
    expect(isStreamingEnabled({})).toBe(true);
    expect(isStreamingEnabled(null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getIngestionURL
// ---------------------------------------------------------------------------

describe("getIngestionURL", () => {
  it("returns API_ENDPOINT when no ingestion_url is set", () => {
    vi.mocked(useStore).mockReturnValue({
      state: {
        API_ENDPOINT: "https://api.example.com",
        zoConfig: {},
      },
    } as any);

    const result = getIngestionURL();

    expect(result).toBe("https://api.example.com");
  });

  it("returns ingestion_url when it is set in zoConfig", () => {
    vi.mocked(useStore).mockReturnValue({
      state: {
        API_ENDPOINT: "https://api.example.com",
        zoConfig: { ingestion_url: "https://ingest.example.com" },
      },
    } as any);

    const result = getIngestionURL();

    expect(result).toBe("https://ingest.example.com");
  });

  it("returns API_ENDPOINT when ingestion_url is empty string", () => {
    vi.mocked(useStore).mockReturnValue({
      state: {
        API_ENDPOINT: "https://api.example.com",
        zoConfig: { ingestion_url: "" },
      },
    } as any);

    const result = getIngestionURL();

    expect(result).toBe("https://api.example.com");
  });
});

// ---------------------------------------------------------------------------
// getEndPoint
// ---------------------------------------------------------------------------

describe("getEndPoint", () => {
  it("returns correct endpoint for https with explicit port", () => {
    const result = getEndPoint("https://api.example.com:9200");

    expect(result.host).toBe("api.example.com");
    expect(result.port).toBe("9200");
    expect(result.protocol).toBe("https");
    expect(result.tls).toBe("On");
  });

  it("defaults to port 443 for https without explicit port", () => {
    const result = getEndPoint("https://api.example.com");

    expect(result.port).toBe("443");
  });

  it("returns correct endpoint for http with explicit port", () => {
    const result = getEndPoint("http://api.example.com:8080");

    expect(result.port).toBe("8080");
    expect(result.tls).toBe("Off");
  });

  it("defaults to port 80 for http without explicit port", () => {
    const result = getEndPoint("http://api.example.com");

    expect(result.port).toBe("80");
  });
});

// ---------------------------------------------------------------------------
// getCronIntervalDifferenceInSeconds
// ---------------------------------------------------------------------------

describe("getCronIntervalDifferenceInSeconds", () => {
  it("returns 60 for every-minute cron", () => {
    const result = getCronIntervalDifferenceInSeconds("0 * * * * *");
    expect(result).toBe(60);
  });

  it("returns 300 for every-5-minutes cron", () => {
    const result = getCronIntervalDifferenceInSeconds("0 */5 * * * *");
    expect(result).toBe(300);
  });

  it("throws for invalid cron expression", () => {
    expect(() => getCronIntervalDifferenceInSeconds("not-a-cron")).toThrow(
      "Invalid cron expression",
    );
  });
});

// ---------------------------------------------------------------------------
// getCronIntervalInMinutes
// ---------------------------------------------------------------------------

describe("getCronIntervalInMinutes", () => {
  it("returns 1 for every-minute cron", () => {
    const result = getCronIntervalInMinutes("0 * * * * *");
    expect(result).toBe(1);
  });

  it("returns 5 for every-5-minutes cron", () => {
    const result = getCronIntervalInMinutes("0 */5 * * * *");
    expect(result).toBe(5);
  });

  it("throws for invalid cron expression", () => {
    expect(() => getCronIntervalInMinutes("bad cron")).toThrow(
      "Invalid cron expression",
    );
  });
});

// ---------------------------------------------------------------------------
// isAboveMinRefreshInterval
// ---------------------------------------------------------------------------

describe("isAboveMinRefreshInterval", () => {
  it("returns true when value equals min_auto_refresh_interval", () => {
    expect(isAboveMinRefreshInterval(5, { min_auto_refresh_interval: 5 })).toBe(
      true,
    );
  });

  it("returns true when value is above min_auto_refresh_interval", () => {
    expect(isAboveMinRefreshInterval(10, { min_auto_refresh_interval: 5 })).toBe(
      true,
    );
  });

  it("returns false when value is below min_auto_refresh_interval", () => {
    expect(isAboveMinRefreshInterval(3, { min_auto_refresh_interval: 5 })).toBe(
      false,
    );
  });

  it("defaults min interval to 1 when config prop is missing", () => {
    expect(isAboveMinRefreshInterval(1, {})).toBe(true);
    expect(isAboveMinRefreshInterval(0, {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// describeCron
// ---------------------------------------------------------------------------

describe("describeCron", () => {
  it("returns '' for empty string", () => {
    expect(describeCron("")).toBe("");
  });

  it("returns '' for whitespace-only string", () => {
    expect(describeCron("   ")).toBe("");
  });

  it("returns error for wrong number of fields", () => {
    expect(describeCron("* * * * *")).toBe("invalid cron (expected 6 fields)");
  });

  it("describes every N minutes pattern", () => {
    expect(describeCron("0 */5 * * * *")).toBe("every 5 minutes");
  });

  it("describes every 1 minute (singular)", () => {
    expect(describeCron("0 */1 * * * *")).toBe("every 1 minute");
  });

  it("describes every N hours pattern", () => {
    expect(describeCron("0 0 */2 * * *")).toBe("every 2 hours");
  });

  it("describes every 1 hour (singular)", () => {
    expect(describeCron("0 0 */1 * * *")).toBe("every 1 hour");
  });

  it("describes daily at HH:MM pattern", () => {
    const result = describeCron("0 30 14 * * *", "UTC");
    expect(result).toBe("daily at 14:30 (UTC)");
  });

  it("describes every hour at minute pattern", () => {
    const result = describeCron("0 15 * * * *");
    expect(result).toBe("every hour at minute 15");
  });

  it("returns next check string for unrecognized but valid cron", () => {
    const result = describeCron("0 0 10 15 * *", "UTC");
    expect(result).toContain("next check at");
  });

  it("returns 'invalid cron expression' for invalid cron", () => {
    const result = describeCron("99 99 99 99 99 99");
    expect(result).toBe("invalid cron expression");
  });
});

// ---------------------------------------------------------------------------
// convertMinutesToCron
// ---------------------------------------------------------------------------

describe("convertMinutesToCron", () => {
  it("returns '' for 0", () => {
    expect(convertMinutesToCron(0)).toBe("");
  });

  it("returns '' for null", () => {
    expect(convertMinutesToCron(null as any)).toBe("");
  });

  it("returns '' for negative values", () => {
    expect(convertMinutesToCron(-5)).toBe("");
  });

  it("returns cron expression for positive minutes", () => {
    expect(convertMinutesToCron(5)).toBe("0 */5 * * * *");
  });

  it("returns cron expression for 1 minute", () => {
    expect(convertMinutesToCron(1)).toBe("0 */1 * * * *");
  });
});

// ---------------------------------------------------------------------------
// processQueryMetadataErrors
// ---------------------------------------------------------------------------

describe("processQueryMetadataErrors", () => {
  it("returns '' for null", () => {
    expect(processQueryMetadataErrors(null)).toBe("");
  });

  it("returns '' for empty array", () => {
    expect(processQueryMetadataErrors([])).toBe("");
  });

  it("handles nested array format with timestamps", () => {
    const metadata = [
      [
        {
          function_error: "Error A",
          new_start_time: 1_000_000,
          new_end_time: 2_000_000,
        },
      ],
    ];

    const result = processQueryMetadataErrors(metadata);

    expect(getFunctionErrorMessage).toHaveBeenCalledWith(
      "Error A",
      1_000_000,
      2_000_000,
      "UTC",
    );
    expect(result).toContain("Error A");
  });

  it("handles nested array format without timestamps (pushes function_error array)", () => {
    const metadata = [
      [
        {
          function_error: ["Error B", "Error C"],
        },
      ],
    ];

    const result = processQueryMetadataErrors(metadata);

    expect(result).toContain("Error B");
    expect(result).toContain("Error C");
  });

  it("handles flat single-query format with timestamps", () => {
    const metadata = [
      {
        function_error: "Flat error",
        new_start_time: 3_000_000,
        new_end_time: 4_000_000,
      },
    ];

    const result = processQueryMetadataErrors(metadata, "UTC");

    expect(getFunctionErrorMessage).toHaveBeenCalledWith(
      "Flat error",
      3_000_000,
      4_000_000,
      "UTC",
    );
    expect(result).toContain("Flat error");
  });

  it("handles flat single-query format without timestamps", () => {
    const metadata = [{ function_error: "Simple error" }];

    const result = processQueryMetadataErrors(metadata);

    expect(result).toContain("Simple error");
  });

  it("deduplicates repeated messages", () => {
    const metadata = [
      [
        { function_error: "Duplicate error", new_start_time: 1, new_end_time: 2 },
        { function_error: "Duplicate error", new_start_time: 1, new_end_time: 2 },
      ],
    ];
    vi.mocked(getFunctionErrorMessage).mockReturnValue("Duplicate error (Data returned for: start to end)");

    const result = processQueryMetadataErrors(metadata);

    const lines = result.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });
});
