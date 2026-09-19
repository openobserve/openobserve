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

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyntheticsEnvironment, SyntheticsVariable, WireStep } from "@/types/synthetics";
import type { ResolvedVariable } from "./resolved";
import {
  forgetReplaySecrets,
  mergeReplayVariables,
  partitionReplaySecrets,
  rememberReplaySecret,
  replayInputs,
  secretsNeededForReplay,
  sharedPlainValues,
} from "./replaySecrets";

const scope = { org: "acme", checkId: "c1", environment: "prod" };

function v(over: Partial<ResolvedVariable> = {}): ResolvedVariable {
  return {
    name: "PASSWORD",
    kind: "secret",
    scope: "prod",
    overridden: false,
    example: "",
    description: "",
    has_value: true,
    ...over,
  };
}

const step = (over: Partial<WireStep>): WireStep => ({ action: "fill", ...over }) as WireStep;

beforeEach(forgetReplaySecrets);

describe("secretsNeededForReplay", () => {
  it("asks only for secrets the steps actually reference", () => {
    const resolved = [v({ name: "PASSWORD" }), v({ name: "UNUSED_TOKEN" })];
    const steps = [step({ value: "{{PASSWORD}}" })];

    expect(secretsNeededForReplay(steps, resolved)).toEqual(["PASSWORD"]);
  });

  it("ignores plain variables, which replay can already substitute", () => {
    const resolved = [v({ name: "BASE_URL", kind: "plain" })];
    expect(secretsNeededForReplay([step({ url: "{{BASE_URL}}" })], resolved)).toEqual([]);
  });

  it("looks in every substituted field", () => {
    const resolved = [v({ name: "A" }), v({ name: "B" }), v({ name: "C" })];
    const steps = [step({ value: "{{A}}" }), step({ url: "{{B}}" }), step({ key: "{{C}}" })];

    expect(secretsNeededForReplay(steps, resolved)).toEqual(["A", "B", "C"]);
  });

  it("does not ask for a secret the check overrides", () => {
    const resolved = [
      v({ name: "PASSWORD", scope: "prod" }),
      v({ name: "PASSWORD", scope: "check", kind: "plain" }),
    ];
    expect(secretsNeededForReplay([step({ value: "{{PASSWORD}}" })], resolved)).toEqual([]);
  });
});

describe("session memory", () => {
  it("remembers a value for the session and reports what is still missing", () => {
    rememberReplaySecret(scope, "PASSWORD", "hunter2");
    const { known, missing } = partitionReplaySecrets(scope, ["PASSWORD", "TOKEN"]);

    expect(known).toEqual({ PASSWORD: "hunter2" });
    expect(missing).toEqual(["TOKEN"]);
  });

  it("keeps a value to the org, check and environment it was typed for", () => {
    rememberReplaySecret(scope, "PASSWORD", "hunter2");

    for (const other of [
      { ...scope, org: "zeta" },
      { ...scope, checkId: "c2" },
      { ...scope, environment: "staging" },
    ]) {
      expect(partitionReplaySecrets(other, ["PASSWORD"]).missing).toEqual(["PASSWORD"]);
    }
  });

  it("forgets everything on demand", () => {
    rememberReplaySecret(scope, "PASSWORD", "hunter2");
    forgetReplaySecrets();

    expect(partitionReplaySecrets(scope, ["PASSWORD"]).missing).toEqual(["PASSWORD"]);
  });

  it("never writes to localStorage or sessionStorage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    rememberReplaySecret(scope, "PASSWORD", "hunter2");

    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});

describe("mergeReplayVariables", () => {
  it("adds supplied secrets alongside the check's own variables", () => {
    const merged = mergeReplayVariables([{ name: "BASE_URL", value: "x" }], { PASSWORD: "p" });

    expect(merged).toEqual([
      { name: "BASE_URL", value: "x" },
      { name: "PASSWORD", value: "p" },
    ]);
  });

  it("lets the check's own value win", () => {
    const merged = mergeReplayVariables([{ name: "PASSWORD", value: "own" }], {
      PASSWORD: "typed",
    });

    expect(merged).toEqual([{ name: "PASSWORD", value: "own" }]);
  });
});

describe("sharedPlainValues", () => {
  const plain = (name: string, value: string): SyntheticsVariable => ({
    id: name,
    name,
    kind: "plain",
    value,
    has_value: true,
    description: "",
    example: "",
    tags: [],
    used_by_checks: 0,
    created_at: 0,
    updated_at: 0,
  });
  const secret = (name: string): SyntheticsVariable => ({
    ...plain(name, ""),
    kind: "secret",
    value: undefined,
  });
  const env = (id: string, variables: SyntheticsVariable[]): SyntheticsEnvironment => ({
    id,
    name: id,
    description: "",
    is_global: false,
    created_at: 0,
    updated_at: 0,
    checks_count: 0,
    variables,
  });

  it("layers the chosen environment's plain values over the global ones", () => {
    const globals = [plain("BASE_URL", "https://global.test"), plain("ORG", "acme")];
    const envs = [
      env("prod", [plain("BASE_URL", "https://prod.test")]),
      env("stg", [plain("BASE_URL", "https://stg.test")]),
    ];

    expect(sharedPlainValues(envs, globals, "prod")).toEqual({
      BASE_URL: "https://prod.test",
      ORG: "acme",
    });
    expect(sharedPlainValues(envs, globals, undefined)).toEqual({
      BASE_URL: "https://global.test",
      ORG: "acme",
    });
  });

  it("drops a global value that an environment secret shadows", () => {
    const globals = [plain("PASSWORD", "not-it")];
    expect(sharedPlainValues([env("prod", [secret("PASSWORD")])], globals, "prod")).toEqual({});
  });
});

describe("replayInputs", () => {
  it("replays with shared plain values under the check's own and resolves the url", () => {
    const { url, variables } = replayInputs(
      "{{BASE_URL}}/login",
      [{ name: "USER", value: "asha" }],
      { BASE_URL: "https://prod.test", USER: "shared-user" },
      { PASSWORD: "typed" },
    );

    expect(url).toBe("https://prod.test/login");
    expect(Object.fromEntries(variables.map((v) => [v.name, v.value]))).toEqual({
      USER: "asha",
      BASE_URL: "https://prod.test",
      PASSWORD: "typed",
    });
  });

  it("lets a check value override the shared one in the url too", () => {
    const { url } = replayInputs(
      "{{BASE_URL}}",
      [{ name: "BASE_URL", value: "https://own.test" }],
      { BASE_URL: "https://prod.test" },
      {},
    );
    expect(url).toBe("https://own.test");
  });
});
