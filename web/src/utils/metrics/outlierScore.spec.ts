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
import { OUTLIER_SCORE, outlierScores, seriesPointsByValue } from "./outlierScore";

const series = (entries: Record<string, (number | null)[]>) =>
  new Map(
    Object.entries(entries).map(([name, values]) => [
      name,
      new Map(values.flatMap((v, i) => (v === null ? [] : [[i, v] as [number, number]]))),
    ]),
  );

const ranked = (scores: Map<string, number>) =>
  [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);

describe("outlierScores", () => {
  it("scores identical series all ~0", () => {
    const scores = outlierScores(series({ a: [1, 2, 3], b: [1, 2, 3], c: [1, 2, 3] }));
    for (const score of scores.values()) expect(score).toBeCloseTo(0, 9);
  });

  it("ranks a spiking series first, and past the outlier threshold", () => {
    const scores = outlierScores(
      series({
        a: [10, 11, 10, 9],
        b: [11, 10, 9, 10],
        c: [9, 10, 11, 10],
        d: [10, 9, 10, 11],
        spike: [10, 10, 90, 10],
      }),
    );
    expect(ranked(scores)[0]).toBe("spike");
    expect(scores.get("spike")!).toBeGreaterThanOrEqual(OUTLIER_SCORE);
    expect(scores.get("a")!).toBeLessThan(OUTLIER_SCORE);
  });

  it("averages only over a series' own points, so gaps neither help nor hurt", () => {
    const scores = outlierScores(
      series({
        a: [5, 5, 5, 5],
        b: [5, 5, 5, 5],
        gappy: [null, 50, null, null],
      }),
    );
    expect(ranked(scores)[0]).toBe("gappy");
    expect(scores.get("a")!).toBeCloseTo(0, 9);
  });

  it("skips timestamps only one series has, and scores a lone series 0", () => {
    expect(outlierScores(series({ only: [1, 100, 5] })).get("only")).toBe(0);
    const scores = outlierScores(series({ a: [1, null], b: [null, 9] }));
    expect(scores.get("a")).toBe(0);
    expect(scores.get("b")).toBe(0);
  });

  it("keeps near-identical series well under the threshold", () => {
    const level = 725.81;
    const scores = outlierScores(
      series({
        "api-gateway": [level * (1 + 1e-6), level * (1 + 2e-6), level * (1 - 1e-6)],
        "stream-ingest-service": [level * (1 - 1e-6), level * (1 - 2e-6), level * (1 + 1e-6)],
        a: [level, level, level],
        b: [level, level, level],
        c: [level, level, level],
      }),
    );
    for (const score of scores.values()) expect(score).toBeLessThan(0.01);
  });

  it("still ranks a real spike first and past the threshold among near-identical series", () => {
    const level = 725.81;
    const scores = outlierScores(
      series({
        a: [level, level * (1 + 1e-6), level],
        b: [level, level, level * (1 - 1e-6)],
        c: [level * (1 + 1e-6), level, level],
        spike: [level, level * 3, level],
      }),
    );
    expect(ranked(scores)[0]).toBe("spike");
    expect(scores.get("spike")!).toBeGreaterThanOrEqual(OUTLIER_SCORE);
    expect(scores.get("a")!).toBeLessThan(0.01);
  });

  it("scores finitely around a median of 0 and still ranks the departure first", () => {
    const scores = outlierScores(
      series({
        a: [0, 0, 0],
        b: [0, 0, 0],
        c: [0.001, -0.001, 0],
        jump: [0, 5, 0],
      }),
    );
    for (const score of scores.values()) expect(Number.isFinite(score)).toBe(true);
    expect(ranked(scores)[0]).toBe("jump");
    expect(scores.get("jump")!).toBeGreaterThanOrEqual(OUTLIER_SCORE);
  });

  it("returns an empty map for no series", () => {
    expect(outlierScores(new Map()).size).toBe(0);
  });
});

describe("seriesPointsByValue", () => {
  it("keys points by timestamp, dropping NaN, null and empty samples", () => {
    const points = seriesPointsByValue(
      [
        {
          result: [
            {
              metric: { code: "200" },
              values: [
                [1, "4"],
                [2, "NaN"],
                [3, null],
                [4, ""],
                [5, "7"],
              ],
            },
            { metric: { other: "x" }, values: [[1, "1"]] },
          ],
        },
      ],
      "code",
    );
    expect([...points.keys()]).toEqual(["200"]);
    expect([...points.get("200")!.entries()]).toEqual([
      [1, 4],
      [5, 7],
    ]);
  });

  it("tolerates missing responses", () => {
    expect(seriesPointsByValue(undefined as any, "code").size).toBe(0);
    expect(seriesPointsByValue([null, { result: null }], "code").size).toBe(0);
  });
});
