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
import {
  canDeleteEnvironment,
  crossTierShadow,
  duplicateNameFor,
  duplicateSummary,
  duplicatePrefill,
  duplicateVariableNameFor,
  globalEnvironment,
  namedEnvironments,
  railOrder,
  resolveScope,
} from "./scope";
import { ENVIRONMENT_NAME_RE, VARIABLE_NAME_RE } from "./SyntheticsVariableForm.schema";

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

function environment(name: string, variables: SyntheticsVariable[] = []): SyntheticsEnvironment {
  return {
    id: `id-${name}`,
    name,
    description: "",
    is_global: false,
    created_at: 0,
    updated_at: 0,
    checks_count: 0,
    variables,
  };
}

function globalEnv(variables: SyntheticsVariable[] = []): SyntheticsEnvironment {
  return { ...environment("global", variables), id: "global_acme", is_global: true };
}

describe("the global environment", () => {
  const envs = [environment("prod"), globalEnv(), environment("staging")];

  it("is found by its flag, not by its name", () => {
    expect(globalEnvironment(envs)?.id).toBe("global_acme");
    expect(globalEnvironment([environment("prod")])).toBeNull();
  });

  it("is pinned first in the rail, exactly once", () => {
    const names = railOrder(envs).map((e) => e.name);
    expect(names).toEqual(["global", "prod", "staging"]);
    expect(names.filter((n) => n === "global")).toHaveLength(1);
  });

  it("is left out of the tier that overrides it", () => {
    expect(namedEnvironments(envs).map((e) => e.name)).toEqual(["prod", "staging"]);
  });

  it("offers no delete, while every other environment does", () => {
    expect(canDeleteEnvironment(globalEnv())).toBe(false);
    expect(canDeleteEnvironment(environment("prod"))).toBe(true);
  });
});

describe("resolveScope", () => {
  const global = globalEnv([variable({ id: "inline" })]);
  const envs = [global, environment("prod", [variable({ id: "p1" })]), environment("staging")];
  const globals = [variable({ id: "g1" }), variable({ id: "g2" })];

  it("shows the globals from /variables when global is selected", () => {
    const scope = resolveScope("global", envs, globals);

    expect(scope.isGlobal).toBe(true);
    expect(scope.environment?.id).toBe("global_acme");
    expect(scope.variables.map((v) => v.id)).toEqual(["g1", "g2"]);
  });

  it("starts on global before anything is selected", () => {
    expect(resolveScope("", envs, globals).isGlobal).toBe(true);
    // Before the list loads there is no global row yet, only its variables.
    const unloaded = resolveScope("", [], globals);
    expect(unloaded.isGlobal).toBe(true);
    expect(unloaded.environment).toBeNull();
  });

  it("shows one environment's own variables", () => {
    const scope = resolveScope("prod", envs, globals);

    expect(scope.isGlobal).toBe(false);
    expect(scope.environment?.name).toBe("prod");
    expect(scope.variables.map((v) => v.id)).toEqual(["p1"]);
  });

  it("falls back to global when the selection no longer exists", () => {
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

describe("duplicateVariableNameFor", () => {
  it("suffixes in upper case, because the server normalizes the name anyway", () => {
    expect(duplicateVariableNameFor("BASE_URL")).toBe("BASE_URL_COPY");
  });

  it("offers a name the server will accept", () => {
    expect(VARIABLE_NAME_RE.test(duplicateVariableNameFor("BASE_URL"))).toBe(true);
    expect(VARIABLE_NAME_RE.test(duplicateVariableNameFor("_INTERNAL"))).toBe(true);
  });
});

describe("duplicatePrefill", () => {
  it("carries every field except the value, which no client holds", () => {
    const source = variable({
      id: "v9",
      name: "LOGIN_PASSWORD",
      kind: "secret",
      description: "the tester account",
      example: "hunter2",
      has_value: true,
    });
    const prefill = duplicatePrefill(source);

    expect(prefill.name).toBe("LOGIN_PASSWORD_COPY");
    expect(prefill.description).toBe("the tester account");
    expect(prefill.example).toBe("hunter2");
    expect(prefill.kind).toBe("secret");
  });

  it("clears has_value so the form asks for a value instead of offering Replace", () => {
    const prefill = duplicatePrefill(variable({ kind: "secret", has_value: true }));
    expect(prefill.has_value).toBe(false);
  });

  it("leaves the source untouched", () => {
    const source = variable({ name: "LOGIN_PASSWORD", kind: "secret", has_value: true });
    duplicatePrefill(source);
    expect(source.name).toBe("LOGIN_PASSWORD");
    expect(source.has_value).toBe(true);
  });
});

describe("duplicateSummary", () => {
  it("counts secrets separately, because those arrive unset", () => {
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

describe("crossTierShadow", () => {
  const envs = [
    { id: "e1", name: "staging", variables: [{ name: "URL" }, { name: "API_KEY" }] },
    { id: "e2", name: "ap1", variables: [{ name: "URL" }] },
  ] as any[];
  const globals = [{ name: "URL" }, { name: "ORG" }] as any[];

  it("an env row that also exists globally overrides the global", () => {
    expect(crossTierShadow("URL", "staging", envs, globals)).toEqual({ kind: "overrides-global" });
  });

  it("an env row with no global counterpart shadows nothing", () => {
    expect(crossTierShadow("API_KEY", "staging", envs, globals)).toBeNull();
  });

  it("a global names every environment that keeps its own value", () => {
    expect(crossTierShadow("URL", null, envs, globals)).toEqual({
      kind: "overridden-in",
      envs: ["staging", "ap1"],
    });
  });

  it("an unshadowed global reports nothing", () => {
    expect(crossTierShadow("ORG", null, envs, globals)).toBeNull();
  });
  it("never counts the global environment as overriding itself", () => {
    const withGlobal = [
      ...envs,
      { id: "g", name: "global", is_global: true, variables: [{ name: "ORG" }] },
    ];
    expect(crossTierShadow("ORG", null, withGlobal, globals)).toBeNull();
  });
});
