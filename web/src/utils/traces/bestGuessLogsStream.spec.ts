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

import { describe, expect, it, vi } from "vitest";
import { pickBestGuessLogsStream } from "./bestGuessLogsStream";

const streams = [
  { name: "small", storageSize: 1 },
  { name: "big", storageSize: 100 },
  { name: "mid", storageSize: 10 },
];

describe("pickBestGuessLogsStream", () => {
  it("picks the largest stream that has the field", async () => {
    const hasField = vi.fn(async (n: string) => n !== "big");
    expect(await pickBestGuessLogsStream({ streams, recent: [], hasField })).toBe("mid");
    expect(hasField.mock.calls.map((c) => c[0])).toEqual(["big", "mid", "small"]);
  });

  it("keeps priority order when a lower-ranked read answers first", async () => {
    const hasField = vi.fn(
      (n: string) => new Promise<boolean>((r) => setTimeout(() => r(true), n === "big" ? 20 : 0)),
    );
    expect(await pickBestGuessLogsStream({ streams, recent: [], hasField })).toBe("big");
  });

  it("reads at most `concurrency` schemas at once and stops at the first hit", async () => {
    let inFlight = 0;
    let peak = 0;
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, storageSize: 9 - i }));
    const hasField = vi.fn(async (n: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
      return n === "s5";
    });
    expect(await pickBestGuessLogsStream({ streams: many, recent: [], hasField })).toBe("s5");
    expect(peak).toBe(4);
    expect(hasField).toHaveBeenCalledTimes(8);
  });

  it("checks recently opened streams first", async () => {
    const hasField = vi.fn(async () => true);
    expect(await pickBestGuessLogsStream({ streams, recent: ["small"], hasField })).toBe("small");
  });

  it("ignores a recent stream that is no longer listed", async () => {
    const hasField = vi.fn(async () => true);
    expect(await pickBestGuessLogsStream({ streams, recent: ["gone"], hasField })).toBe("big");
    expect(hasField).not.toHaveBeenCalledWith("gone");
  });

  it("returns null when no stream has the field", async () => {
    expect(
      await pickBestGuessLogsStream({ streams, recent: [], hasField: async () => false }),
    ).toBeNull();
  });

  it("skips a stream whose schema read fails", async () => {
    const hasField = vi.fn(async (n: string) => {
      if (n === "big") throw new Error("403");
      return true;
    });
    expect(await pickBestGuessLogsStream({ streams, recent: [], hasField })).toBe("mid");
  });

  it("stops after maxChecks schema reads", async () => {
    const hasField = vi.fn(async () => false);
    await pickBestGuessLogsStream({ streams, recent: [], hasField, maxChecks: 2 });
    expect(hasField).toHaveBeenCalledTimes(2);
  });
});
