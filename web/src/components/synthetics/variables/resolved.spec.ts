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
  buildResolvedGrouped,
  coverageGaps,
  effectiveVariables,
  inheritedUnion,
  inheritedVariables,
  placeholderAtCursor,
  suggestPlaceholders,
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

describe("inheritedUnion", () => {
  const grouped = {
    environments: ["staging", "qa"],
    resolved: {
      staging: [
        v({ name: "ORG", scope: "global" }),
        v({ name: "BASE_URL", scope: "staging", example: "stage.shop.com" }),
        v({ name: "API_KEY", scope: "staging", kind: "secret" as const }),
        v({ name: "LOCAL_ONLY", scope: "check" }),
      ],
      qa: [
        v({ name: "ORG", scope: "global" }),
        v({ name: "BASE_URL", scope: "qa", example: "qa.shop.com" }),
      ],
    },
  };

  it("dedupes a name defined in several environments into one row with both sources", () => {
    const rows = inheritedUnion(grouped, new Set());
    const baseUrl = rows.find((r) => r.name === "BASE_URL")!;
    expect(baseUrl.envs).toEqual(["staging", "qa"]);
    expect(baseUrl.hints.map((h) => `${h.source}:${h.example}`)).toEqual([
      "staging:stage.shop.com",
      "qa:qa.shop.com",
    ]);
  });

  it("never lists check-tier rows, and sorts by name", () => {
    const rows = inheritedUnion(grouped, new Set());
    expect(rows.map((r) => r.name)).toEqual(["API_KEY", "BASE_URL", "ORG"]);
  });

  it("marks a global once despite appearing in every environment's set", () => {
    const org = inheritedUnion(grouped, new Set()).find((r) => r.name === "ORG")!;
    expect(org.global).toBe(true);
    expect(org.envs).toEqual([]);
    expect(org.hints).toHaveLength(1);
  });

  it("flags names a local variable shadows", () => {
    const rows = inheritedUnion(grouped, new Set(["BASE_URL"]));
    expect(rows.find((r) => r.name === "BASE_URL")!.overridden).toBe(true);
    expect(rows.find((r) => r.name === "ORG")!.overridden).toBe(false);
  });

  it("carries secrecy from any source", () => {
    expect(inheritedUnion(grouped, new Set()).find((r) => r.name === "API_KEY")!.secret).toBe(true);
  });
});

describe("inheritedUnion with an env shadowing a global", () => {
  // One name, two tiers: the union folds both sources into one row.
  const grouped = {
    environments: ["staging", "prod"],
    resolved: {
      staging: [
        v({ name: "URL", scope: "global", overridden: true, example: "example.com" }),
        v({ name: "URL", scope: "staging", example: "stage.example.com" }),
      ],
      prod: [v({ name: "URL", scope: "global", example: "example.com" })],
    },
  };

  it("folds the pair into one row carrying both sources", () => {
    const rows = inheritedUnion(grouped, new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].global).toBe(true);
    expect(rows[0].envs).toEqual(["staging"]);
    expect(rows[0].hints.map((h) => h.source)).toEqual(["global", "staging"]);
  });

  it("a shadowed global is not a coverage gap", () => {
    // The global still covers prod; staging resolves through its own row.
    expect(coverageGaps(grouped).size).toBe(0);
  });
});

describe("coverageGaps", () => {
  it("names every environment a name fails to resolve in", () => {
    const gaps = coverageGaps({
      environments: ["staging", "qa", "dev"],
      resolved: {
        staging: [v({ name: "ORG" }), v({ name: "API_KEY", scope: "staging" })],
        qa: [v({ name: "ORG" })],
        dev: [v({ name: "ORG" })],
      },
    });
    expect(gaps.get("API_KEY")).toEqual(["qa", "dev"]);
    expect(gaps.has("ORG")).toBe(false);
  });

  it("counts a check-tier variable as present everywhere", () => {
    const gaps = coverageGaps({
      environments: ["staging", "qa"],
      resolved: {
        staging: [v({ name: "TOKEN", scope: "check" })],
        qa: [v({ name: "TOKEN", scope: "check" })],
      },
    });
    expect(gaps.size).toBe(0);
  });

  it("measures the effective set, so a shadowed row still counts as its name resolving", () => {
    const gaps = coverageGaps({
      environments: ["staging", "qa"],
      resolved: {
        staging: [
          v({ name: "USER", scope: "staging", overridden: true }),
          v({ name: "USER", scope: "check" }),
        ],
        qa: [v({ name: "USER", scope: "check" })],
      },
    });
    expect(gaps.size).toBe(0);
  });

  it("has nothing to warn about below two environments", () => {
    const gaps = coverageGaps({
      environments: ["staging"],
      resolved: { staging: [v({ name: "ONLY_HERE", scope: "staging" })] },
    });
    expect(gaps.size).toBe(0);
  });
});

// ── buildResolvedGrouped ────────────────────────────────────────────────────

describe("buildResolvedGrouped", () => {
  function shared(over: Record<string, unknown> = {}) {
    return {
      id: "var-1",
      name: "ORG",
      kind: "plain" as const,
      description: "",
      example: "",
      tags: [],
      value: "acme",
      used_by_checks: 0,
      created_at: 0,
      updated_at: 0,
      ...over,
    };
  }

  function env(name: string, variables: ReturnType<typeof shared>[] = []) {
    return {
      id: `env-${name}`,
      name,
      description: "",
      checks_count: 0,
      created_at: 0,
      updated_at: 0,
      variables,
    };
  }

  const staging = env("staging", [
    shared({ id: "var-2", name: "BASE_URL", value: "https://stage" }),
  ]);
  const prod = env("prod", [
    shared({ id: "var-3", name: "PASSWORD", kind: "secret", value: undefined, has_value: true }),
  ]);
  const globals = [shared(), shared({ id: "var-4", name: "BASE_URL", value: "https://shop" })];

  it("resolves the unscoped tier when the check targets no environment", () => {
    const grouped = buildResolvedGrouped([staging], globals, [], []);
    expect(grouped.environments).toEqual([""]);
    expect(grouped.resolved[""].map((r) => [r.name, r.scope])).toEqual([
      ["BASE_URL", "global"],
      ["ORG", "global"],
    ]);
  });

  it("gives each selected environment its own set, keyed by name", () => {
    const grouped = buildResolvedGrouped([staging, prod], globals, ["env-staging", "env-prod"], []);
    expect(grouped.environments).toEqual(["staging", "prod"]);
    expect(grouped.resolved.staging.map((r) => r.scope)).toEqual(["global", "staging", "global"]);
    expect(grouped.resolved.prod.map((r) => r.name)).toEqual(["BASE_URL", "ORG", "PASSWORD"]);
  });

  it("marks a global as overridden only where an environment row shadows it", () => {
    const grouped = buildResolvedGrouped([staging, prod], globals, ["env-staging", "env-prod"], []);
    const globalIn = (key: string) =>
      grouped.resolved[key].find((r) => r.name === "BASE_URL" && r.scope === "global");
    // staging holds its own BASE_URL, prod does not.
    expect(globalIn("staging")?.overridden).toBe(true);
    expect(globalIn("prod")?.overridden).toBe(false);
  });

  it("marks every tier overridden by a check variable of the same name", () => {
    const grouped = buildResolvedGrouped(
      [staging],
      globals,
      ["env-staging"],
      [{ name: "BASE_URL", value: "https://local" }],
    );
    const rows = grouped.resolved.staging.filter((r) => r.name === "BASE_URL");
    expect(rows.map((r) => [r.scope, r.overridden])).toEqual([
      ["check", false],
      ["global", true],
      ["staging", true],
    ]);
  });

  it("reads presence from the shape each kind uses on the wire", () => {
    const grouped = buildResolvedGrouped([prod], [], ["env-prod"], []);
    const secret = grouped.resolved.prod[0];
    expect(secret.kind).toBe("secret");
    // A secret carries has_value and no value; a plain one carries the value.
    expect(secret.has_value).toBe(true);
    const empty = buildResolvedGrouped([], [shared({ value: "" })], [], []);
    expect(empty.resolved[""][0].has_value).toBe(false);
  });

  it("skips an id that resolves to nothing, as the server does", () => {
    // A deleted environment, or one this user cannot read.
    const grouped = buildResolvedGrouped([staging], globals, ["env-gone"], []);
    expect(grouped.environments).toEqual([]);
    expect(grouped.resolved).toEqual({});
  });
});
