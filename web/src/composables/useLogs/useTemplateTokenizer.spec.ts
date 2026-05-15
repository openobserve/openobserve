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
  tokenizeTemplate,
  wildcardChipColor,
  wildcardLabel,
  inferTypeFromValues,
  chipColorForLabel,
  anomalyExplanation,
} from "@/composables/useLogs/useTemplateTokenizer";

describe("tokenizeTemplate", () => {
  it("splits template into text and wildcard tokens", () => {
    const result = tokenizeTemplate("User <*> from IP <:IP>", [
      { position: 0, token: "<*>", sample_values: ["alice", "bob"] },
      { position: 1, token: "<:IP>", sample_values: ["10.0.0.1"] },
    ]);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ kind: "text", value: "User " });
    expect(result[1]).toMatchObject({
      kind: "wildcard",
      value: "<*>",
      position: 0,
      sampleValues: ["alice", "bob"],
    });
    expect(result[2]).toEqual({ kind: "text", value: " from IP " });
    expect(result[3]).toMatchObject({
      kind: "wildcard",
      value: "<:IP>",
      position: 1,
      sampleValues: ["10.0.0.1"],
    });
  });

  it("returns text-only token when template has no wildcards", () => {
    const result = tokenizeTemplate("Plain log message", []);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: "text", value: "Plain log message" });
  });

  it("falls back to array index when position match fails", () => {
    // Provide wildcardValues without position field — should fall back by index
    const result = tokenizeTemplate("A <*> B <*>", [
      { position: 999, token: "<*>", sample_values: ["x"] },
      { position: 998, token: "<*>", sample_values: ["y"] },
    ] as any);
    expect(result[1]).toMatchObject({
      kind: "wildcard",
      sampleValues: ["x"],
    });
    expect(result[3]).toMatchObject({
      kind: "wildcard",
      sampleValues: ["y"],
    });
  });

  it("handles camelCase sampleValues key from the API", () => {
    const result = tokenizeTemplate("Value <*>", [
      { position: 0, token: "<*>", sampleValues: ["v1", "v2"] },
    ]);
    expect(result[1]).toMatchObject({
      kind: "wildcard",
      sampleValues: ["v1", "v2"],
    });
  });

  it("handles top_values key as fallback", () => {
    const result = tokenizeTemplate("Value <*>", [
      { position: 0, token: "<*>", top_values: ["a", "b"] },
    ] as any);
    expect(result[1]).toMatchObject({
      kind: "wildcard",
      sampleValues: ["a", "b"],
    });
  });

  it("handles topValues key as fallback", () => {
    const result = tokenizeTemplate("Value <*>", [
      { position: 0, token: "<*>", topValues: ["c", "d"] },
    ] as any);
    expect(result[1]).toMatchObject({
      kind: "wildcard",
      sampleValues: ["c", "d"],
    });
  });

  it("handles values key as fallback", () => {
    const result = tokenizeTemplate("Value <*>", [
      { position: 0, token: "<*>", values: ["e", "f"] },
    ] as any);
    expect(result[1]).toMatchObject({
      kind: "wildcard",
      sampleValues: ["e", "f"],
    });
  });

  it("returns empty sampleValues array when no wildcardValues match", () => {
    const result = tokenizeTemplate("Value <*>", []);
    expect(result[1]).toMatchObject({ kind: "wildcard", sampleValues: [] });
  });

  it("handles empty template string", () => {
    const result = tokenizeTemplate("", []);
    expect(result).toHaveLength(0);
  });

  it("handles template with only wildcards (space between becomes text)", () => {
    const result = tokenizeTemplate("<*> <:IP>", [
      { position: 0, token: "<*>", sample_values: ["a"] },
      { position: 1, token: "<:IP>", sample_values: ["b"] },
    ]);
    expect(result).toHaveLength(3); // wildcard, text(" "), wildcard
    expect(result[0]).toMatchObject({ kind: "wildcard", value: "<*>" });
    expect(result[1]).toEqual({ kind: "text", value: " " });
    expect(result[2]).toMatchObject({ kind: "wildcard", value: "<:IP>" });
  });

  it("handles consecutive wildcards without intervening text", () => {
    const result = tokenizeTemplate("<*><*>", [
      { position: 0, token: "<*>", sample_values: ["x"] },
      { position: 1, token: "<*>", sample_values: ["y"] },
    ]);
    expect(result).toHaveLength(2);
  });

  it("recognizes <:TIMESTAMP>, <:NUM>, <:IDENTIFIERS> patterns", () => {
    const result = tokenizeTemplate("<:TIMESTAMP> <:NUM>", [
      { position: 0, token: "<:TIMESTAMP>", sample_values: ["2024-01-01"] },
      { position: 1, token: "<:NUM>", sample_values: ["42"] },
    ]);
    expect(result[0]).toMatchObject({ kind: "wildcard", value: "<:TIMESTAMP>" });
    expect(result[1]).toEqual({ kind: "text", value: " " });
    expect(result[2]).toMatchObject({ kind: "wildcard", value: "<:NUM>" });
  });
});

describe("wildcardChipColor", () => {
  it('returns blue for generic wildcard <*>', () => {
    const cls = wildcardChipColor("<*>");
    expect(cls).toContain("bg-blue-2");
    expect(cls).toContain("text-blue-9");
  });

  it('returns green for IP wildcard <:IP>', () => {
    const cls = wildcardChipColor("<:IP>");
    expect(cls).toContain("bg-green-2");
  });

  it('returns green for <:IPV4>', () => {
    expect(wildcardChipColor("<:IPV4>")).toContain("bg-green-2");
  });

  it('returns orange for numeric wildcard <:NUM>', () => {
    expect(wildcardChipColor("<:NUM>")).toContain("bg-orange-2");
  });

  it('returns orange for <:INT>', () => {
    expect(wildcardChipColor("<:INT>")).toContain("bg-orange-2");
  });

  it('returns orange for <:FLOAT>', () => {
    expect(wildcardChipColor("<:FLOAT>")).toContain("bg-orange-2");
  });

  it('returns orange for <:HEX>', () => {
    expect(wildcardChipColor("<:HEX>")).toContain("bg-orange-2");
  });

  it('returns purple for timestamp wildcard <:TIMESTAMP>', () => {
    expect(wildcardChipColor("<:TIMESTAMP>")).toContain("bg-purple-2");
  });

  it('returns purple for <:DATE>', () => {
    expect(wildcardChipColor("<:DATE>")).toContain("bg-purple-2");
  });

  it('returns purple for <:TIME>', () => {
    expect(wildcardChipColor("<:TIME>")).toContain("bg-purple-2");
  });

  it("returns grey for unknown wildcard type", () => {
    expect(wildcardChipColor("<:UUID>")).toContain("bg-grey-3");
  });

  it("returns grey for <:URL>", () => {
    expect(wildcardChipColor("<:URL>")).toContain("bg-grey-3");
  });

  it("returns inferred color for <*> with sampleValues", () => {
    const cls = wildcardChipColor("<*>", ["192.168.1.1", "10.0.0.1"]);
    expect(cls).toContain("bg-green-2");
  });

  it("returns blue for <*> without sampleValues", () => {
    const cls = wildcardChipColor("<*>");
    expect(cls).toContain("bg-blue-2");
  });

  it("returns inferred method color for <*> with HTTP method values", () => {
    const cls = wildcardChipColor("<*>", ["GET", "POST", "DELETE"]);
    expect(cls).toContain("bg-red-2");
  });
});

describe("chipColorForLabel", () => {
  it("returns green for ip", () => {
    expect(chipColorForLabel("ip")).toContain("bg-green-2");
  });

  it("returns red for method", () => {
    expect(chipColorForLabel("method")).toContain("bg-red-2");
  });

  it("returns indigo for url", () => {
    expect(chipColorForLabel("url")).toContain("bg-indigo-2");
  });

  it("returns orange for num", () => {
    expect(chipColorForLabel("num")).toContain("bg-orange-2");
  });

  it("returns orange for float", () => {
    expect(chipColorForLabel("float")).toContain("bg-orange-2");
  });

  it("returns amber for hex", () => {
    expect(chipColorForLabel("hex")).toContain("bg-amber-2");
  });

  it("returns purple for ts", () => {
    expect(chipColorForLabel("ts")).toContain("bg-purple-2");
  });

  it("returns teal for id", () => {
    expect(chipColorForLabel("id")).toContain("bg-teal-2");
  });

  it("returns pink for email", () => {
    expect(chipColorForLabel("email")).toContain("bg-pink-2");
  });

  it("returns grey for str", () => {
    expect(chipColorForLabel("str")).toContain("bg-grey-3");
  });

  it("returns blue for pattern", () => {
    expect(chipColorForLabel("pattern")).toContain("bg-blue-2");
  });

  it("returns grey for unknown label", () => {
    expect(chipColorForLabel("unknownxyz")).toContain("bg-grey-3");
  });
});

describe("wildcardLabel", () => {
  it("returns lowercase ip for <:IP>", () => {
    expect(wildcardLabel("<:IP>")).toBe("ip");
  });

  it("returns num for <:NUM>", () => {
    expect(wildcardLabel("<:NUM>")).toBe("num");
  });

  it("returns num for <:INT> (mapped to num)", () => {
    expect(wildcardLabel("<:INT>")).toBe("num");
  });

  it("returns float for <:FLOAT>", () => {
    expect(wildcardLabel("<:FLOAT>")).toBe("float");
  });

  it("returns hex for <:HEX>", () => {
    expect(wildcardLabel("<:HEX>")).toBe("hex");
  });

  it("returns ts for <:TIMESTAMP>", () => {
    expect(wildcardLabel("<:TIMESTAMP>")).toBe("ts");
  });

  it("returns date for <:DATE>", () => {
    expect(wildcardLabel("<:DATE>")).toBe("date");
  });

  it("returns time for <:TIME>", () => {
    expect(wildcardLabel("<:TIME>")).toBe("time");
  });

  it("returns str for <:STR>", () => {
    expect(wildcardLabel("<:STR>")).toBe("str");
  });

  it("returns url for <:URL>", () => {
    expect(wildcardLabel("<:URL>")).toBe("url");
  });

  it("returns method for <:METHOD>", () => {
    expect(wildcardLabel("<:METHOD>")).toBe("method");
  });

  it("returns id for <:IDENTIFIERS>", () => {
    expect(wildcardLabel("<:IDENTIFIERS>")).toBe("id");
  });

  it('returns <*> for generic wildcard without sampleValues', () => {
    expect(wildcardLabel("<*>")).toBe("<*>");
  });

  it("infers ip from sampleValues for <*>", () => {
    expect(wildcardLabel("<*>", ["192.168.1.1", "10.0.0.1"])).toBe("ip");
  });

  it("infers method from sampleValues for <*>", () => {
    expect(wildcardLabel("<*>", ["GET", "POST"])).toBe("method");
  });

  it("infers url from sampleValues for <*>", () => {
    expect(wildcardLabel("<*>", ["https://example.com", "https://test.com"])).toBe("url");
  });

  it("infers num from integer sampleValues for <*>", () => {
    expect(wildcardLabel("<*>", ["42", "123"])).toBe("num");
  });

  it("infers ts from timestamp sampleValues for <*>", () => {
    expect(wildcardLabel("<*>", ["2024-01-15T10:30:00", "2024-01-16"])).toBe("ts");
  });

  it("infers id from UUID sampleValues for <*>", () => {
    expect(
      wildcardLabel("<*>", [
        "550e8400-e29b-41d4-a716-446655440000",
        "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      ]),
    ).toBe("id");
  });

  it("infers email from sampleValues for <*>", () => {
    expect(wildcardLabel("<*>", ["user@example.com", "admin@test.com"])).toBe("email");
  });

  it("returns str when <*> values are unidentifiable strings", () => {
    expect(wildcardLabel("<*>", ["hello world", "foo bar"])).toBe("str");
  });

  it("returns pattern when <*> values contain template wildcards", () => {
    expect(wildcardLabel("<*>", ["error <*> occurred", "warning <:NUM>"])).toBe("pattern");
  });

  it("returns token as-is for unknown typed wildcards", () => {
    expect(wildcardLabel("<:UNKNOWN>")).toBe("<:UNKNOWN>");
  });
});

describe("inferTypeFromValues", () => {
  it("returns ip for IPv4 addresses", () => {
    expect(inferTypeFromValues(["192.168.1.1", "10.0.0.1", "127.0.0.1"])).toBe("ip");
  });

  it("returns ip for IPv6 addresses", () => {
    expect(inferTypeFromValues(["::1", "2001:db8::1"])).toBe("ip");
  });

  it("returns method for HTTP methods", () => {
    expect(inferTypeFromValues(["GET", "POST", "DELETE"])).toBe("method");
  });

  it("returns url for https URLs", () => {
    expect(inferTypeFromValues(["https://example.com", "https://test.com/api"])).toBe("url");
  });

  it("returns num for integers", () => {
    expect(inferTypeFromValues(["1", "42", "100"])).toBe("num");
  });

  it("returns float for float values", () => {
    expect(inferTypeFromValues(["3.14", "2.71", "1.618"])).toBe("float");
  });

  it("returns num for mixed int+float (combined threshold)", () => {
    expect(inferTypeFromValues(["42", "3.14", "100", "2.71"])).toBe("num");
  });

  it("returns hex for hex strings", () => {
    expect(inferTypeFromValues(["deadbeef", "cafebabe", "a1b2c3d4"])).toBe("hex");
  });

  it("returns ts for ISO date values", () => {
    expect(inferTypeFromValues(["2024-01-15", "2024-06-30"])).toBe("ts");
  });

  it("returns ts for time values", () => {
    expect(inferTypeFromValues(["10:30:00", "23:59:59"])).toBe("ts");
  });

  it("returns id for UUIDs", () => {
    expect(
      inferTypeFromValues([
        "550e8400-e29b-41d4-a716-446655440000",
        "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      ]),
    ).toBe("id");
  });

  it("returns email for email addresses", () => {
    expect(inferTypeFromValues(["user@example.com", "admin@test.org"])).toBe("email");
  });

  it("returns pattern when values contain template wildcards", () => {
    expect(inferTypeFromValues(["error <*> occurred", "warning <:NUM> at line"])).toBe("pattern");
  });

  it("returns str for unidentifiable strings", () => {
    expect(inferTypeFromValues(["hello", "world"])).toBe("str");
  });

  it("returns str for empty input", () => {
    expect(inferTypeFromValues([])).toBe("str");
  });

  it("handles mixed {value, count} objects", () => {
    const result = inferTypeFromValues([
      { value: "192.168.1.1", count: 5 },
      { value: "10.0.0.1", count: 3 },
    ]);
    expect(result).toBe("ip");
  });

  it("requires majority threshold for type assignment", () => {
    expect(inferTypeFromValues(["192.168.1.1", "hello", "world", "foo", "bar"])).toBe("str");
  });
});

describe("anomalyExplanation", () => {
  const t = (key: string, params?: Record<string, unknown>): string => {
    // Simple mock that interpolates params for assertion
    if (params) {
      const interp = Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      return `${key} [${interp}]`;
    }
    return key;
  };

  it("returns patternAnomalyRare key for very low percentage with freq===1", () => {
    const result = anomalyExplanation(
      { percentage: 0.05, frequency: 1 },
      t,
    );
    expect(result).toContain("search.patternAnomalyRare");
    expect(result).toContain("pct=0.05");
    expect(result).toContain("freq=1");
  });

  it("returns patternAnomalyRarePlural for very low percentage with freq>1", () => {
    const result = anomalyExplanation(
      { percentage: 0.5, frequency: 3 },
      t,
    );
    expect(result).toContain("search.patternAnomalyRarePlural");
    expect(result).toContain("freq=3");
  });

  it("returns patternAnomalyLowFreq when z_score < -1.5 and avg_frequency > 0", () => {
    const result = anomalyExplanation(
      { percentage: 5, frequency: 2, z_score: -2.0, avg_frequency: 100 },
      t,
    );
    expect(result).toContain("search.patternAnomalyLowFreq");
    expect(result).toContain("freq=2");
  });

  it("returns patternAnomalyLowFreqPlural for low-freq with freq>1", () => {
    const result = anomalyExplanation(
      { percentage: 5, frequency: 50, z_score: -2.5, avg_frequency: 500 },
      t,
    );
    expect(result).toContain("search.patternAnomalyLowFreqPlural");
  });

  it("falls back to anomaly score when no other condition matches", () => {
    const result = anomalyExplanation(
      { percentage: 50, anomaly_score: 0.1234 },
      t,
    );
    expect(result).toContain("search.patternAnomalyScore");
    expect(result).toContain("score=12"); // 0.1234 * 100 = 12.34 → "12"
  });

  it("handles missing fields gracefully", () => {
    const result = anomalyExplanation({}, t);
    expect(result).toContain("search.patternAnomalyScore");
  });
});
