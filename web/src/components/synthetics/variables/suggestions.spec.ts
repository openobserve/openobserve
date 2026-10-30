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
import type { SyntheticsEnvironment, SyntheticsVariable } from "@/types/synthetics";
import { buildResolvedGrouped, knownVariableNames } from "./resolved";
import { buildVariableSuggestions } from "./suggestions";

function shared(over: Partial<SyntheticsVariable> = {}): SyntheticsVariable {
  return {
    id: "var-1",
    name: "ORG",
    kind: "plain",
    description: "",
    example: "",
    tags: [],
    value: "acme",
    has_value: true,
    used_by_checks: 0,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

function env(name: string, variables: SyntheticsVariable[] = []): SyntheticsEnvironment {
  return {
    id: `env-${name}`,
    name,
    description: "",
    is_global: false,
    checks_count: 0,
    created_at: 0,
    updated_at: 0,
    variables,
  };
}

const staging = env("staging", [
  shared({ id: "var-2", name: "BASE_URL", value: "https://stage" }),
  shared({ id: "var-3", name: "API_KEY", kind: "secret", value: undefined }),
]);
const prod = env("prod", [shared({ id: "var-4", name: "BASE_URL", value: "https://prod" })]);
const globals = [shared({ name: "ORG" }), shared({ id: "var-5", name: "TIMEOUT", value: "30" })];
const checkVariables = [
  { name: "TIMEOUT", value: "5" },
  { name: "PASSWORD", value: "", secure: true },
];

function build() {
  const grouped = buildResolvedGrouped(
    [staging, prod],
    globals,
    [staging.id, prod.id],
    checkVariables,
  );
  return { grouped, rows: buildVariableSuggestions(grouped, checkVariables) };
}

describe("buildVariableSuggestions", () => {
  it("lists check-tier rows first, alphabetical, then the inherited union", () => {
    const { rows } = build();
    expect(rows.map((r) => r.name)).toEqual(["PASSWORD", "TIMEOUT", "API_KEY", "BASE_URL", "ORG"]);
  });

  it("marks a secure check row as secret even though the resolved rows drop the flag", () => {
    const { rows } = build();
    expect(rows.find((r) => r.name === "PASSWORD")).toMatchObject({
      secret: true,
      global: false,
      envs: [],
      gap: [],
    });
    expect(rows.find((r) => r.name === "API_KEY")?.secret).toBe(true);
  });

  it("offers the check-tier row and not the shared row of an overridden name", () => {
    const { rows } = build();
    expect(rows.filter((r) => r.name === "TIMEOUT")).toEqual([
      { name: "TIMEOUT", envs: [], global: false, secret: false, gap: [] },
    ]);
  });

  it("keeps the stored spelling of a check-tier name", () => {
    const grouped = buildResolvedGrouped([], [], [], [{ name: " padded " }]);
    expect(buildVariableSuggestions(grouped, [{ name: " padded " }])[0].name).toBe(" padded ");
  });

  it("fills gap with the environments the name does not resolve in", () => {
    const { rows } = build();
    expect(rows.find((r) => r.name === "API_KEY")?.gap).toEqual(["prod"]);
    expect(rows.find((r) => r.name === "BASE_URL")).toMatchObject({
      envs: ["staging", "prod"],
      global: false,
      gap: [],
    });
    expect(rows.find((r) => r.name === "ORG")).toMatchObject({ envs: [], global: true });
  });

  it("never offers a name the unbound banner would warn about", () => {
    const { grouped, rows } = build();
    const known = knownVariableNames(grouped);
    for (const row of rows) expect(known.has(row.name)).toBe(true);
  });
});
