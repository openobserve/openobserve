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

import type { PasswordComplexity } from "@/services/passwordPolicy";
import type { TranslateFn } from "@/types/i18n";
import {
  buildPasswordRequirements,
  countMetRequirements,
  DEFAULT_COMPLEXITY,
  firstUnmetRequirement,
  validateAgainstComplexity,
} from "./passwordComplexity";

// Echoes the key so assertions read against stable ids rather than English copy.
const t = ((key: string) => key) as unknown as TranslateFn;

const complexity = (overrides: Partial<PasswordComplexity> = {}): PasswordComplexity => ({
  ...DEFAULT_COMPLEXITY,
  ...overrides,
});

describe("buildPasswordRequirements", () => {
  it("emits only the requirements the policy actually enforces", () => {
    const rows = buildPasswordRequirements(complexity(), t);

    expect(rows.map((r) => r.key)).toEqual(["minLength"]);
  });

  it("emits no rows at all when the policy enforces nothing", () => {
    const rows = buildPasswordRequirements(complexity({ min_length: 0 }), t);

    expect(rows).toEqual([]);
  });

  it("emits every row for a fully configured policy", () => {
    const rows = buildPasswordRequirements(
      complexity({
        min_length: 12,
        max_length: 64,
        require_uppercase: true,
        require_lowercase: true,
        require_digit: true,
        require_special: true,
      }),
      t,
    );

    expect(rows.map((r) => r.key)).toEqual([
      "minLength",
      "maxLength",
      "uppercase",
      "lowercase",
      "digit",
      "special",
    ]);
  });

  it("omits maxLength when unbounded", () => {
    const rows = buildPasswordRequirements(complexity({ max_length: 0 }), t);

    expect(rows.some((r) => r.key === "maxLength")).toBe(false);
  });
});

describe("requirement checks", () => {
  const rowFor = (key: string, policy: PasswordComplexity) =>
    buildPasswordRequirements(policy, t).find((r) => r.key === key)!;

  it("min and max length are inclusive bounds", () => {
    const policy = complexity({ min_length: 4, max_length: 6 });

    expect(rowFor("minLength", policy).isMet("abcd")).toBe(true);
    expect(rowFor("minLength", policy).isMet("abc")).toBe(false);
    expect(rowFor("maxLength", policy).isMet("abcdef")).toBe(true);
    expect(rowFor("maxLength", policy).isMet("abcdefg")).toBe(false);
  });

  it("treats any non-alphanumeric as special when the set is empty", () => {
    const row = rowFor("special", complexity({ require_special: true, special_char_set: "" }));

    expect(row.isMet("abc-def")).toBe(true);
    expect(row.isMet("abcdef1")).toBe(false);
  });

  it("honours a configured special-character set", () => {
    const row = rowFor("special", complexity({ require_special: true, special_char_set: "!@#" }));

    expect(row.isMet("abc!")).toBe(true);
    // A special character outside the configured set does not count.
    expect(row.isMet("abc-")).toBe(false);
  });

  it("checks character classes independently", () => {
    const policy = complexity({
      require_uppercase: true,
      require_lowercase: true,
      require_digit: true,
    });

    expect(rowFor("uppercase", policy).isMet("aB1")).toBe(true);
    expect(rowFor("uppercase", policy).isMet("ab1")).toBe(false);
    expect(rowFor("lowercase", policy).isMet("AB1")).toBe(false);
    expect(rowFor("digit", policy).isMet("aBc")).toBe(false);
  });
});

describe("countMetRequirements", () => {
  it("counts only satisfied rows", () => {
    const rows = buildPasswordRequirements(
      complexity({ min_length: 4, require_uppercase: true, require_digit: true }),
      t,
    );

    expect(countMetRequirements(rows, "")).toBe(0);
    expect(countMetRequirements(rows, "abcd")).toBe(1);
    expect(countMetRequirements(rows, "Abcd")).toBe(2);
    expect(countMetRequirements(rows, "Abcd1")).toBe(3);
  });
});

describe("firstUnmetRequirement / validateAgainstComplexity", () => {
  it("returns null once every requirement is satisfied", () => {
    const policy = complexity({ min_length: 4, require_digit: true });

    expect(firstUnmetRequirement(buildPasswordRequirements(policy, t), "abc1")).toBeNull();
    expect(validateAgainstComplexity("abc1", policy, t)).toBeNull();
  });

  it("names the first failure in policy order", () => {
    const policy = complexity({ min_length: 8, require_digit: true });

    expect(firstUnmetRequirement(buildPasswordRequirements(policy, t), "ab")?.key).toBe(
      "minLength",
    );
    expect(firstUnmetRequirement(buildPasswordRequirements(policy, t), "abcdefgh")?.key).toBe(
      "digit",
    );
  });

  it("accepts anything when the policy enforces nothing", () => {
    expect(validateAgainstComplexity("a", complexity({ min_length: 0 }), t)).toBeNull();
  });
});
