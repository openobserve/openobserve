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
import { GLOBAL_SCOPE, duplicateNameFor, duplicateSummary, resolveScope } from "./scope";
import { ENVIRONMENT_NAME_RE } from "./SyntheticsVariableForm.schema";

function variable(over: Partial<SyntheticsVariable> = {}): SyntheticsVariable {
  return {
    id: "v1",
    name: "BASE_URL",
    kind: "plain",
    description: "",
    example: "",
    tags: [],
    used_by_checks: 0,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

function environment(name: string, variables: SyntheticsVariable[] = []): SyntheticsEnvironment {
  return {
    id: `id-${name}`,
    name,
    description: "",
    created_at: 0,
    updated_at: 0,
    checks_count: 0,
    variables,
  };
}

describe("GLOBAL_SCOPE", () => {
  it("cannot collide with an environment name", () => {
    // Environment names may not begin with `_` — that prefix is reserved
    // because names become OpenFGA object ids — so this sentinel is safe.
    expect(GLOBAL_SCOPE.startsWith("_")).toBe(true);
    expect(ENVIRONMENT_NAME_RE.test(GLOBAL_SCOPE)).toBe(false);
  });
});

describe("resolveScope", () => {
  const envs = [environment("prod", [variable({ id: "p1" })]), environment("staging")];
  const globals = [variable({ id: "g1" }), variable({ id: "g2" })];

  it("shows the globals for the global scope", () => {
    const scope = resolveScope(GLOBAL_SCOPE, envs, globals);

    expect(scope.isGlobal).toBe(true);
    expect(scope.environment).toBeNull();
    expect(scope.variables.map((v) => v.id)).toEqual(["g1", "g2"]);
  });

  it("shows one environment's own variables", () => {
    const scope = resolveScope("prod", envs, globals);

    expect(scope.isGlobal).toBe(false);
    expect(scope.environment?.name).toBe("prod");
    expect(scope.variables.map((v) => v.id)).toEqual(["p1"]);
  });

  it("falls back to global when the selection no longer exists", () => {
    // Deleted in another tab, or filtered out by permission on a refetch.
    // Rendering an empty pane would look like an environment with no variables.
    const scope = resolveScope("deleted", envs, globals);

    expect(scope.isGlobal).toBe(true);
    expect(scope.variables).toHaveLength(2);
  });

  it("treats an environment with no variables as empty, not as global", () => {
    const scope = resolveScope("staging", envs, globals);

    expect(scope.isGlobal).toBe(false);
    expect(scope.variables).toEqual([]);
  });
});

describe("duplicateNameFor", () => {
  it("offers a name that reads as a placeholder", () => {
    expect(duplicateNameFor("dev")).toBe("dev_copy");
  });

  it("offers a name the server will accept", () => {
    expect(ENVIRONMENT_NAME_RE.test(duplicateNameFor("dev"))).toBe(true);
    expect(ENVIRONMENT_NAME_RE.test(duplicateNameFor("pre-prod"))).toBe(true);
  });
});

describe("duplicateSummary", () => {
  it("counts secrets separately, because those arrive unset", () => {
    // Saying so before the click is the difference between a deliberate choice
    // and a surprise the first time a check fails.
    const summary = duplicateSummary([
      variable({ id: "1" }),
      variable({ id: "2", kind: "secret" }),
      variable({ id: "3", kind: "secret" }),
    ]);

    expect(summary).toEqual({ total: 3, secrets: 2 });
  });

  it("reports no secrets for an all-plain environment", () => {
    expect(duplicateSummary([variable()])).toEqual({ total: 1, secrets: 0 });
  });

  it("handles an empty environment", () => {
    expect(duplicateSummary([])).toEqual({ total: 0, secrets: 0 });
  });
});
