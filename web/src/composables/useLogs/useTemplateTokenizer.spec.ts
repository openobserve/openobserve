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

  it('returns grey for unknown wildcard type', () => {
    expect(wildcardChipColor("<:UUID>")).toContain("bg-grey-3");
  });

  it('returns grey for <:URL>', () => {
    expect(wildcardChipColor("<:URL>")).toContain("bg-grey-3");
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
