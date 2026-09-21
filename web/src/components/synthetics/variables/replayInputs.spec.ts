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
  defaultReplayEnvironmentId,
  mergeReplayVariables,
  replayInputs,
  sharedPlainValues,
} from "./replayInputs";

describe("mergeReplayVariables", () => {
  it("adds shared values alongside the check's own variables", () => {
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

describe("sharedPlainValues", () => {
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
    );

    expect(url).toBe("https://prod.test/login");
    expect(Object.fromEntries(variables.map((v) => [v.name, v.value]))).toEqual({
      USER: "asha",
      BASE_URL: "https://prod.test",
    });
  });

  it("lets a check value override the shared one in the url too", () => {
    const { url } = replayInputs(
      "{{BASE_URL}}",
      [{ name: "BASE_URL", value: "https://own.test" }],
      { BASE_URL: "https://prod.test" },
    );
    expect(url).toBe("https://own.test");
  });

  it("adds the default scheme to a resolved url that has none, as the server does", () => {
    const { url } = replayInputs("{{BASE_URL}}/login", [], { BASE_URL: "prod.test" });
    expect(url).toBe("https://prod.test/login");
  });
});

describe("defaultReplayEnvironmentId", () => {
  const global = { ...env("global", []), is_global: true };

  it("uses the check's first pinned environment", () => {
    expect(defaultReplayEnvironmentId(["stg", "prod"], [env("prod", []), env("stg", [])])).toBe(
      "stg",
    );
  });

  it("falls back to the first named environment in server order when the check pins none", () => {
    expect(defaultReplayEnvironmentId([], [global, env("prod", []), env("stg", [])])).toBe("prod");
  });

  it("is undefined when the org has only the global environment", () => {
    expect(defaultReplayEnvironmentId([], [global])).toBeUndefined();
  });

  it("is undefined before the shared list loads", () => {
    expect(defaultReplayEnvironmentId([], [])).toBeUndefined();
  });
});
