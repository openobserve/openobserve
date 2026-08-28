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
import type { ResolvedVariable } from "./resolved";
import {
  applyPlaceholder,
  canOverride,
  effectiveVariables,
  inheritedVariables,
  placeholderAtCursor,
  suggestPlaceholders,
  unboundPlaceholders,
} from "./resolved";

function v(over: Partial<ResolvedVariable> = {}): ResolvedVariable {
  return {
    name: "BASE_URL",
    kind: "plain",
    scope: "global",
    overridden: false,
    example: "",
    description: "",
    has_value: true,
    ...over,
  };
}

describe("inheritedVariables", () => {
  it("excludes the check's own rows", () => {
    const rows = [v({ name: "A" }), v({ name: "B", scope: "check" })];
    expect(inheritedVariables(rows).map((r) => r.name)).toEqual(["A"]);
  });
});

describe("canOverride", () => {
  it("refuses a secret", () => {
    // A check-tier override lands in the old `secure` model, which is a display
    // hint and not a storage property — so the value would become readable
    // through get_synthetic, undoing the write-only guarantee.
    expect(canOverride(v({ kind: "secret" }))).toBe(false);
  });

  it("refuses one already overridden", () => {
    expect(canOverride(v({ overridden: true }))).toBe(false);
  });

  it("allows a plain inherited variable", () => {
    expect(canOverride(v())).toBe(true);
  });
});

describe("effectiveVariables", () => {
  it("drops a shared row the check shadows", () => {
    const rows = [
      v({ name: "BASE_URL", scope: "global" }),
      v({ name: "BASE_URL", scope: "check" }),
      v({ name: "API_TOKEN", scope: "prod" }),
    ];
    const effective = effectiveVariables(rows);

    expect(effective).toHaveLength(2);
    expect(effective.find((r) => r.name === "BASE_URL")?.scope).toBe("check");
    // Overriding one name still inherits every other.
    expect(effective.find((r) => r.name === "API_TOKEN")?.scope).toBe("prod");
  });
});

describe("placeholderAtCursor", () => {
  it("finds an open placeholder and what has been typed into it", () => {
    expect(placeholderAtCursor("go to {{BA", 10)).toEqual({ start: 6, query: "BA" });
  });

  it("offers everything immediately after the braces", () => {
    expect(placeholderAtCursor("{{", 2)).toEqual({ start: 0, query: "" });
  });

  it("is silent once the placeholder is closed", () => {
    expect(placeholderAtCursor("{{NAME}}", 8)).toBeNull();
  });

  it("is silent when the braces belong to earlier text", () => {
    expect(placeholderAtCursor("{{A}} and then some words", 25)).toBeNull();
    expect(placeholderAtCursor("{{A B", 5)).toBeNull();
  });

  it("is silent with no braces at all", () => {
    expect(placeholderAtCursor("plain text", 5)).toBeNull();
  });
});

describe("suggestPlaceholders", () => {
  const rows = [v({ name: "BASE_URL" }), v({ name: "DB_BACKUP" }), v({ name: "API_TOKEN" })];

  it("ranks prefix matches above substring matches", () => {
    // Someone typing BA wants BASE_URL, not DB_BACKUP.
    expect(suggestPlaceholders(rows, "BA").map((r) => r.name)).toEqual(["BASE_URL", "DB_BACKUP"]);
  });

  it("matches case-insensitively", () => {
    expect(suggestPlaceholders(rows, "base").map((r) => r.name)).toEqual(["BASE_URL"]);
  });

  it("offers everything for an empty query", () => {
    expect(suggestPlaceholders(rows, "")).toHaveLength(3);
  });

  it("never offers a shadowed shared row", () => {
    const shadowed = [
      v({ name: "BASE_URL", scope: "global" }),
      v({ name: "BASE_URL", scope: "check" }),
    ];
    expect(suggestPlaceholders(shadowed, "BASE")).toHaveLength(1);
  });
});

describe("applyPlaceholder", () => {
  it("completes the placeholder and leaves the cursor past it", () => {
    const context = placeholderAtCursor("go to {{BA", 10)!;
    const result = applyPlaceholder("go to {{BA", 10, context, "BASE_URL");

    expect(result.text).toBe("go to {{BASE_URL}}");
    expect(result.cursor).toBe(result.text.length);
  });

  it("inserts the stored name, not what was typed", () => {
    // Substitution is an exact key lookup, so inserting the typed case would
    // produce a placeholder that never resolves.
    const context = placeholderAtCursor("{{base", 6)!;
    expect(applyPlaceholder("{{base", 6, context, "BASE_URL").text).toBe("{{BASE_URL}}");
  });

  it("keeps text that follows the cursor", () => {
    const context = placeholderAtCursor("{{BA", 4)!;
    expect(applyPlaceholder("{{BA/login", 4, context, "BASE_URL").text).toBe("{{BASE_URL}}/login");
  });
});

describe("unboundPlaceholders", () => {
  it("names what nothing binds, deduplicated and sorted", () => {
    const bound = [v({ name: "BASE_URL" })];
    expect(unboundPlaceholders(["BASE_URL", "TYPO", "TYPO", "OTHER"], bound)).toEqual([
      "OTHER",
      "TYPO",
    ]);
  });

  it("counts a check's own variable as bound", () => {
    const bound = [v({ name: "LOCAL", scope: "check" })];
    expect(unboundPlaceholders(["LOCAL"], bound)).toEqual([]);
  });

  it("is case-sensitive, because substitution is", () => {
    const bound = [v({ name: "BASE_URL" })];
    expect(unboundPlaceholders(["base_url"], bound)).toEqual(["base_url"]);
  });
});
