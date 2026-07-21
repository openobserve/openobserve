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

import { describe, it, expect } from "vitest";
import {
  normalizeNodeErrorMessages,
  formatNodeErrorText,
} from "./nodeErrors";

// The two shapes that coexist on the wire. `NodeErrors.errors` went from
// HashSet<String> to HashSet<(String, Option<Value>)>, the column is untyped
// JSON, and nothing migrates or normalizes it server-side — so a single
// deployment serves BOTH, permanently.
const LEGACY = ["boom", "bang"];
const TUPLE = [
  ["boom", null],
  ["bang", { detail: 1 }],
];

describe("normalizeNodeErrorMessages", () => {
  it("reads the legacy plain-string shape", () => {
    expect(normalizeNodeErrorMessages(LEGACY)).toEqual(["boom", "bang"]);
  });

  it("reads the current [message, payload] tuple shape", () => {
    expect(normalizeNodeErrorMessages(TUPLE)).toEqual(["boom", "bang"]);
  });

  it("🔑 never leaks a stringified payload — the bug this exists to prevent", () => {
    // A bare .join() over the tuple shape produced
    // "boom,\n\nbang,[object Object]" in the node tooltip.
    const joined = normalizeNodeErrorMessages(TUPLE).join("\n\n");
    expect(joined).not.toContain("[object Object]");
    expect(joined).toBe("boom\n\nbang");
  });

  it("handles a row that mixes both shapes", () => {
    // Not expected from the server, but the column is untyped — a partially
    // rewritten row must not take the whole dialog down.
    expect(normalizeNodeErrorMessages(["boom", ["bang", null]])).toEqual([
      "boom",
      "bang",
    ]);
  });

  it("drops unusable entries rather than rendering them", () => {
    expect(
      normalizeNodeErrorMessages([null, undefined, 42, {}, [], [null], ""] as any),
    ).toEqual([]);
  });

  it("returns [] for missing / non-array input", () => {
    expect(normalizeNodeErrorMessages(undefined)).toEqual([]);
    expect(normalizeNodeErrorMessages(null)).toEqual([]);
    expect(normalizeNodeErrorMessages({} as any)).toEqual([]);
  });
});

describe("formatNodeErrorText", () => {
  it("joins messages with a blank line, for both shapes", () => {
    expect(formatNodeErrorText({ errors: LEGACY, error_count: 2 })).toBe(
      "boom\n\nbang",
    );
    expect(formatNodeErrorText({ errors: TUPLE, error_count: 2 })).toBe(
      "boom\n\nbang",
    );
  });

  it("appends the truncation tail when the server capped the list", () => {
    expect(formatNodeErrorText({ errors: TUPLE, error_count: 5 })).toBe(
      "boom\n\nbang\n\n... and 3 more errors",
    );
  });

  it("counts the tail off the NORMALIZED length, not the raw array", () => {
    // Guards the subtle bug: if a malformed entry is dropped, the tail has to
    // account for it or the user is told "and 1 more" while nothing is hidden.
    const text = formatNodeErrorText({
      errors: ["boom", 42] as any,
      error_count: 2,
    });
    expect(text).toBe("boom\n\n... and 1 more errors");
  });

  it("omits the tail when nothing is hidden", () => {
    expect(formatNodeErrorText({ errors: LEGACY, error_count: 2 })).not.toContain(
      "more errors",
    );
    // error_count lower than the list (shouldn't happen) must not produce
    // "and -1 more".
    expect(formatNodeErrorText({ errors: LEGACY, error_count: 0 })).toBe(
      "boom\n\nbang",
    );
  });

  it("takes a custom tail formatter (i18n)", () => {
    expect(
      formatNodeErrorText(
        { errors: LEGACY, error_count: 4 },
        (count) => `plus ${count} others`,
      ),
    ).toBe("boom\n\nbang\n\nplus 2 others");
  });

  it("returns null when there is nothing renderable, so callers can v-if", () => {
    expect(formatNodeErrorText(null)).toBeNull();
    expect(formatNodeErrorText({ errors: [], error_count: 0 })).toBeNull();
    expect(formatNodeErrorText({ errors: [{}] as any, error_count: 1 })).toBeNull();
  });
});
