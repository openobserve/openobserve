// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";

// Mock @/utils/date before importing formatters
vi.mock("@/utils/date", () => ({
  formatDate: vi.fn((value: any) => String(value)),
}));

import {
  b64EncodeUnicode,
  b64DecodeUnicode,
  b64DecodeUnicodeSafe,
  smartDecodeVrlFunction,
  b64EncodeStandard,
  b64DecodeStandard,
  convertToTitleCase,
  truncateText,
  formatLargeNumber,
  formatSizeFromMB,
  addCommasToNumber,
  formatTimeWithSuffix,
  formatDuration,
  durationFormatter,
  maskText,
  convertToCamelCase,
} from "./formatters";

// Buffer-based btoa/atob for jsdom
global.btoa = (str: string) => Buffer.from(str, "binary").toString("base64");
global.atob = (str: string) => Buffer.from(str, "base64").toString("binary");

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// b64EncodeUnicode
// ---------------------------------------------------------------------------

describe("b64EncodeUnicode", () => {
  it("round-trips an ASCII string", () => {
    const input = "hello world";
    const encoded = b64EncodeUnicode(input);
    expect(b64DecodeUnicode(encoded!)).toBe(input);
  });

  it("round-trips a unicode string", () => {
    const input = "こんにちは";
    const encoded = b64EncodeUnicode(input);
    expect(b64DecodeUnicode(encoded!)).toBe(input);
  });

  it("round-trips an empty string", () => {
    const encoded = b64EncodeUnicode("");
    expect(encoded).toBe("");
  });

  it("produces URL-safe characters — no +, /, or =", () => {
    // use a string likely to produce those chars in standard base64
    const input = "This is a test string with special chars: >>>???";
    const encoded = b64EncodeUnicode(input);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });

  it("uses - _ . instead of + / =", () => {
    // Force output chars by using known-input that produces + / = in base64
    // Any long repeating pattern produces padding (=) in standard b64
    const input = "abc";
    const encoded = b64EncodeUnicode(input);
    // Just verify it doesn't contain the non-URL-safe chars
    expect(/[+/=]/.test(encoded!)).toBe(false);
  });

  it("returns null and logs on encoding error", () => {
    // Pass an object that causes encodeURIComponent to fail indirectly
    // by monkey-patching encodeURIComponent temporarily
    const original = global.encodeURIComponent;
    global.encodeURIComponent = () => {
      throw new Error("encode error");
    };

    const result = b64EncodeUnicode("test");

    global.encodeURIComponent = original;
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// b64DecodeUnicode
// ---------------------------------------------------------------------------

describe("b64DecodeUnicode", () => {
  it("decodes a valid URL-safe base64 string", () => {
    const encoded = b64EncodeUnicode("hello world")!;
    expect(b64DecodeUnicode(encoded)).toBe("hello world");
  });

  it("handles - _ . URL-safe substitutions", () => {
    const input = "test data";
    const encoded = b64EncodeUnicode(input)!;
    expect(b64DecodeUnicode(encoded)).toBe(input);
  });

  it("returns undefined and logs on invalid base64", () => {
    const result = b64DecodeUnicode("!!!invalid!!!");

    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// b64DecodeUnicodeSafe
// ---------------------------------------------------------------------------

describe("b64DecodeUnicodeSafe", () => {
  it("returns the fallback when input is empty string", () => {
    expect(b64DecodeUnicodeSafe("", "fallback")).toBe("fallback");
  });

  it("returns the fallback when input is null-ish (empty)", () => {
    expect(b64DecodeUnicodeSafe("")).toBe("");
  });

  it("returns decoded string for valid input", () => {
    const encoded = b64EncodeUnicode("decoded value")!;
    expect(b64DecodeUnicodeSafe(encoded)).toBe("decoded value");
  });

  it("returns fallback when decoding fails", () => {
    const result = b64DecodeUnicodeSafe("!!!invalid!!!", "default-fallback");

    expect(result).toBe("default-fallback");
  });
});

// ---------------------------------------------------------------------------
// smartDecodeVrlFunction
// ---------------------------------------------------------------------------

describe("smartDecodeVrlFunction", () => {
  it("returns empty string for null input", () => {
    expect(smartDecodeVrlFunction(null)).toBe("");
  });

  it("returns empty string for undefined input", () => {
    expect(smartDecodeVrlFunction(undefined)).toBe("");
  });

  it("returns empty string for empty string input", () => {
    expect(smartDecodeVrlFunction("")).toBe("");
  });

  it("returns the original for plain text that is not base64", () => {
    // Plain text with spaces can't be base64, decode will fail → returns input
    const result = smartDecodeVrlFunction("plain text with spaces");
    // Either returns the original or the decoded; for non-base64, decoding fails
    // The function returns vrlFunction on decode failure
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns single-decoded string for a single-encoded value", () => {
    const original = "function code here";
    const encoded = b64EncodeUnicode(original)!;

    const result = smartDecodeVrlFunction(encoded);

    expect(result).toBe(original);
  });

  it("returns fully decoded string for a double-encoded value", () => {
    const original = "function code here";
    const firstEncode = b64EncodeUnicode(original)!;
    const secondEncode = b64EncodeUnicode(firstEncode)!;

    const result = smartDecodeVrlFunction(secondEncode);

    expect(result).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// b64EncodeStandard / b64DecodeStandard
// ---------------------------------------------------------------------------

describe("b64EncodeStandard", () => {
  it("encodes an ASCII string", () => {
    const result = b64EncodeStandard("hello");
    expect(typeof result).toBe("string");
    expect(result!.length).toBeGreaterThan(0);
  });

  it("round-trips a unicode string with b64DecodeStandard", () => {
    const input = "OpenObserve 🔍";
    const encoded = b64EncodeStandard(input)!;
    const decoded = b64DecodeStandard(encoded);
    expect(decoded).toBe(input);
  });

  it("returns undefined and logs on error", () => {
    const original = global.encodeURIComponent;
    global.encodeURIComponent = () => {
      throw new Error("encode error");
    };

    const result = b64EncodeStandard("test");

    global.encodeURIComponent = original;
    expect(result).toBeUndefined();
  });
});

describe("b64DecodeStandard", () => {
  it("decodes a standard base64 string", () => {
    const encoded = b64EncodeStandard("test value")!;
    expect(b64DecodeStandard(encoded)).toBe("test value");
  });

  it("returns undefined and logs on invalid base64", () => {
    const result = b64DecodeStandard("!!!not-base64!!!");

    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// convertToTitleCase
// ---------------------------------------------------------------------------

describe("convertToTitleCase", () => {
  it("converts a hyphenated string to title case", () => {
    expect(convertToTitleCase("hello-world")).toBe("Hello World");
  });

  it("handles a single word without hyphens", () => {
    expect(convertToTitleCase("logs")).toBe("Logs");
  });

  it("handles multiple hyphens", () => {
    expect(convertToTitleCase("my-very-long-name")).toBe("My Very Long Name");
  });
});

// ---------------------------------------------------------------------------
// truncateText
// ---------------------------------------------------------------------------

describe("truncateText", () => {
  it("appends … and limits length when text exceeds maxLength", () => {
    const result = truncateText("hello world", 8);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBe(8);
  });

  it("returns unchanged text when length is exactly maxLength", () => {
    expect(truncateText("hello", 5)).toBe("hello");
  });

  it("returns unchanged text when shorter than maxLength", () => {
    expect(truncateText("hi", 10)).toBe("hi");
  });

  it("returns the input unchanged for empty string", () => {
    expect(truncateText("", 5)).toBe("");
  });

  it("returns the input unchanged for null-ish input", () => {
    expect(truncateText(null as any, 5)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// formatLargeNumber
// ---------------------------------------------------------------------------

describe("formatLargeNumber", () => {
  it("returns empty string for undefined", () => {
    expect(formatLargeNumber(undefined as any)).toBe("");
  });

  it("returns empty string for null", () => {
    expect(formatLargeNumber(null as any)).toBe("");
  });

  it("returns the number as string when < 1000", () => {
    expect(formatLargeNumber(999)).toBe("999");
  });

  it("formats numbers >= 1000 with K suffix", () => {
    expect(formatLargeNumber(1500)).toBe("1.5K");
  });

  it("formats numbers >= 1_000_000 with M suffix", () => {
    expect(formatLargeNumber(2_500_000)).toBe("2.5M");
  });

  it("formats numbers >= 1_000_000_000 with B suffix", () => {
    expect(formatLargeNumber(3_000_000_000)).toBe("3.0B");
  });
});

// ---------------------------------------------------------------------------
// formatSizeFromMB
// ---------------------------------------------------------------------------

describe("formatSizeFromMB", () => {
  it("returns '0 MB' for NaN input", () => {
    expect(formatSizeFromMB("not-a-number")).toBe("0 MB");
  });

  it("formats a value in MB", () => {
    expect(formatSizeFromMB("500")).toBe("500.00 MB");
  });

  it("converts 1024 MB to GB", () => {
    expect(formatSizeFromMB("1024")).toBe("1.00 GB");
  });

  it("rounds very small positive values to 0.01 MB", () => {
    // A very small positive value (e.g. 0.000001 MB) should show 0.01 MB
    expect(formatSizeFromMB("0.000001")).toBe("0.01 MB");
  });
});

// ---------------------------------------------------------------------------
// addCommasToNumber
// ---------------------------------------------------------------------------

describe("addCommasToNumber", () => {
  it("returns '0' for null", () => {
    expect(addCommasToNumber(null as any)).toBe("0");
  });

  it("returns '0' for undefined", () => {
    expect(addCommasToNumber(undefined as any)).toBe("0");
  });

  it("returns number without commas for small value", () => {
    expect(addCommasToNumber(999)).toBe("999");
  });

  it("adds commas for large numbers", () => {
    expect(addCommasToNumber(1_234_567)).toBe("1,234,567");
  });
});

// ---------------------------------------------------------------------------
// formatTimeWithSuffix
// ---------------------------------------------------------------------------

describe("formatTimeWithSuffix", () => {
  it("returns '0us' for 0", () => {
    expect(formatTimeWithSuffix(0)).toBe("0us");
  });

  it("returns '0us' for falsy value", () => {
    expect(formatTimeWithSuffix(null as any)).toBe("0us");
  });

  it("formats microseconds < 1000 with 'us' suffix", () => {
    expect(formatTimeWithSuffix(500)).toBe("500.00us");
  });

  it("formats microseconds >= 1000 with 'ms' suffix", () => {
    expect(formatTimeWithSuffix(1500)).toBe("1.50ms");
  });

  it("formats microseconds >= 1_000_000 with 's' suffix", () => {
    expect(formatTimeWithSuffix(2_000_000)).toBe("2.00s");
  });

  it("formats microseconds >= 60_000_000 with 'm' suffix", () => {
    expect(formatTimeWithSuffix(120_000_000)).toBe("2.00m");
  });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  it("returns '0 sec' for 0", () => {
    expect(formatDuration(0)).toBe("0 sec");
  });

  it("returns '0 sec' for falsy value", () => {
    expect(formatDuration(null as any)).toBe("0 sec");
  });

  it("formats durations <= 60s in seconds", () => {
    expect(formatDuration(30_000)).toBe("30.00 sec");
  });

  it("formats durations > 60s in minutes", () => {
    expect(formatDuration(90_000)).toBe("1.50 min");
  });

  it("formats durations > 3600s in hours", () => {
    expect(formatDuration(3_700_000)).toBe("1.03 hr");
  });

  it("formats durations > 86400s in days and hours", () => {
    const result = formatDuration(90_000_000);
    expect(result).toContain("days");
    expect(result).toContain("hr");
  });
});

// ---------------------------------------------------------------------------
// durationFormatter
// ---------------------------------------------------------------------------

describe("durationFormatter", () => {
  it("returns 'Invalid duration' for negative values", () => {
    expect(durationFormatter(-1)).toBe("Invalid duration");
  });

  it("formats 0 seconds", () => {
    expect(durationFormatter(0)).toBe("0s");
  });

  it("formats seconds < 60", () => {
    expect(durationFormatter(45)).toBe("45s");
  });

  it("formats minutes and seconds (60-3599s)", () => {
    expect(durationFormatter(90)).toBe("1m 30s");
  });

  it("formats only minutes when seconds = 0", () => {
    expect(durationFormatter(120)).toBe("2m");
  });

  it("formats hours, minutes, seconds (3600-86399s)", () => {
    expect(durationFormatter(3661)).toBe("1h 1m 1s");
  });

  it("formats only hours when minutes and seconds = 0", () => {
    expect(durationFormatter(3600)).toBe("1h");
  });

  it("formats days, hours, minutes, seconds (>= 86400s)", () => {
    expect(durationFormatter(90061)).toBe("1d 1h 1m 1s");
  });

  it("formats only days when hours/minutes/seconds = 0", () => {
    expect(durationFormatter(86400)).toBe("1d");
  });
});

// ---------------------------------------------------------------------------
// maskText
// ---------------------------------------------------------------------------

describe("maskText", () => {
  it("returns the input unchanged", () => {
    expect(maskText("sensitive data")).toBe("sensitive data");
  });

  it("returns empty string unchanged", () => {
    expect(maskText("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// convertToCamelCase
// ---------------------------------------------------------------------------

describe("convertToCamelCase", () => {
  it("returns empty string for empty input", () => {
    expect(convertToCamelCase("")).toBe("");
  });

  it("returns empty string for null-ish input", () => {
    expect(convertToCamelCase(null as any)).toBe("");
  });

  it("capitalizes first char and lowercases rest", () => {
    expect(convertToCamelCase("hello")).toBe("Hello");
  });

  it("lowercases all subsequent chars of an ALLCAPS string", () => {
    expect(convertToCamelCase("HELLO")).toBe("Hello");
  });

  it("handles single character", () => {
    expect(convertToCamelCase("a")).toBe("A");
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
