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
import type { SyntheticsVariable } from "@/types/synthetics";
import { environmentDeleteBlock, filterVariables, relativeTime, valueDisplay } from "./usage";

function variable(over: Partial<SyntheticsVariable> = {}): SyntheticsVariable {
  return {
    id: "v1",
    name: "BASE_URL",
    kind: "plain",
    description: "",
    example: "",
    tags: [],
    has_value: true,
    used_by_checks: 0,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

describe("valueDisplay", () => {
  it("never carries a value, for either kind", () => {
    // The guarantee the whole feature rests on: there is no value to render,
    // because the server's read DTO has no value field to send.
    const secret = valueDisplay(variable({ kind: "secret" }));
    const plain = valueDisplay(variable({ kind: "plain" }));

    expect(Object.keys(secret).sort()).toEqual(["isSet", "kind"]);
    expect(Object.keys(plain).sort()).toEqual(["isSet", "kind"]);
  });

  it("reports presence, not content", () => {
    expect(valueDisplay(variable({ has_value: false }))).toEqual({ kind: "plain", isSet: false });
    expect(valueDisplay(variable({ kind: "secret", has_value: true }))).toEqual({
      kind: "secret",
      isSet: true,
    });
  });
});

describe("relativeTime", () => {
  // Every synthetics timestamp on the wire is now_micros(). Reading one as
  // milliseconds dates the row to 1970, which is how "updated 56 years ago"
  // ends up next to a variable someone saved a minute earlier.
  const now = 1_700_000_000_000;
  const micros = (msAgo: number) => (now - msAgo) * 1000;

  it("treats the input as microseconds", () => {
    expect(relativeTime(micros(5_000), now)).toBe("just now");
    expect(relativeTime(micros(5 * 60_000), now)).toBe("5m ago");
    expect(relativeTime(micros(3 * 3_600_000), now)).toBe("3h ago");
    expect(relativeTime(micros(2 * 86_400_000), now)).toBe("2d ago");
  });

  it("renders a never-updated row as a dash, not as 1970", () => {
    expect(relativeTime(0, now)).toBe("—");
  });

  it("does not render a future timestamp as a negative age", () => {
    expect(relativeTime(micros(-60_000), now)).toBe("just now");
  });
});

describe("environmentDeleteBlock", () => {
  it("blocks on checks first — the check would outlive its environment", () => {
    expect(environmentDeleteBlock([], 2)).toBe("checks");
    expect(environmentDeleteBlock([variable({ kind: "secret" })], 2)).toBe("checks");
  });

  it("blocks outright on a secret, which no confirmation can undo", () => {
    expect(environmentDeleteBlock([variable({ kind: "secret" })], 0)).toBe("secrets");
  });

  it("lets plain variables through to a confirmation", () => {
    expect(environmentDeleteBlock([variable({ kind: "plain" })], 0)).toBeNull();
    expect(environmentDeleteBlock([], 0)).toBeNull();
  });
});

describe("filterVariables", () => {
  const rows = [
    variable({ id: "1", name: "BASE_URL", description: "the storefront" }),
    variable({ id: "2", name: "API_TOKEN", description: "auth" }),
  ];

  it("matches name or description, case-insensitively", () => {
    expect(filterVariables(rows, "base").map((v) => v.id)).toEqual(["1"]);
    expect(filterVariables(rows, "AUTH").map((v) => v.id)).toEqual(["2"]);
  });

  it("returns everything for an empty or whitespace query", () => {
    expect(filterVariables(rows, "")).toHaveLength(2);
    expect(filterVariables(rows, "   ")).toHaveLength(2);
  });
});
