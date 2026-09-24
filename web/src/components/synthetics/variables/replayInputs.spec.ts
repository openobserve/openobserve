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
import type { BrowserStep, SyntheticsEnvironment, SyntheticsVariable } from "@/types/synthetics";
import { expandJourney, translateStepId } from "@/utils/synthetics/expandJourney";
import {
  classifyReplayNames,
  defaultReplayEnvironmentId,
  environmentStartUrls,
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

describe("environmentStartUrls", () => {
  const envs = [
    env("prod", [plain("BASE_URL", "https://prod.test")]),
    env("stg", [plain("BASE_URL", "https://stg.test")]),
  ];

  it("resolves the URL per environment", () => {
    expect(environmentStartUrls("{{BASE_URL}}/login", [], envs, [], ["prod", "stg"])).toEqual([
      { id: "prod", url: "https://prod.test/login" },
      { id: "stg", url: "https://stg.test/login" },
    ]);
  });

  it("adds the default scheme", () => {
    const bare = [env("prod", [plain("BASE_URL", "prod.test")])];
    expect(environmentStartUrls("{{BASE_URL}}/login", [], bare, [], ["prod"])).toEqual([
      { id: "prod", url: "https://prod.test/login" },
    ]);
  });

  it("leaves an unknown placeholder literal", () => {
    expect(environmentStartUrls("{{BASE_URL}}/{{PATH}}", [], envs, [], ["prod"])).toEqual([
      { id: "prod", url: "https://prod.test/{{PATH}}" },
    ]);
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

describe("classifyReplayNames", () => {
  const stateOf = (statuses: { name: string; state: string }[], name: string) =>
    statuses.find((s) => s.name === name)?.state;
  const stepsOf = (statuses: { name: string; steps: number[] }[], name: string) =>
    statuses.find((s) => s.name === name)?.steps;
  const usesPassword = [{ step: 1, texts: ["{{PASSWORD}}"] }];

  it("resolves a name the check defines, even when an environment holds a secret of that name", () => {
    const statuses = classifyReplayNames(
      usesPassword,
      [{ name: "PASSWORD", value: "own" }],
      [env("qa", [secret("PASSWORD")])],
      [],
      "qa",
      {},
    );

    expect(stateOf(statuses, "PASSWORD")).toBe("resolved");
  });

  it("marks an environment secret with a value as secret", () => {
    const statuses = classifyReplayNames(
      usesPassword,
      [],
      [env("qa", [secret("PASSWORD")])],
      [],
      "qa",
      {},
    );

    expect(stateOf(statuses, "PASSWORD")).toBe("secret");
  });

  it("treats a supplied value as resolved, even for a stored secret", () => {
    const statuses = classifyReplayNames(
      usesPassword,
      [],
      [env("qa", [secret("PASSWORD")])],
      [],
      "qa",
      { PASSWORD: "typed" },
    );

    expect(stateOf(statuses, "PASSWORD")).toBe("resolved");
  });

  it("marks a secret without a value as missing", () => {
    const statuses = classifyReplayNames(
      usesPassword,
      [],
      [env("qa", [{ ...secret("PASSWORD"), has_value: false }])],
      [],
      "qa",
      {},
    );

    expect(stateOf(statuses, "PASSWORD")).toBe("missing");
  });

  it("marks a name nobody defines as missing, listing every step that uses it", () => {
    const statuses = classifyReplayNames(
      [
        { step: 1, texts: ["#login", undefined] },
        { step: 2, texts: ["{{API_KEY}}"] },
        { step: 3, texts: ["{{BASE_URL}}/x"] },
        { step: 4, texts: ["Bearer {{API_KEY}}", "{{API_KEY}}"] },
      ],
      [],
      [env("qa", [])],
      [plain("BASE_URL", "https://global.test")],
      "qa",
      {},
    );

    expect(stateOf(statuses, "API_KEY")).toBe("missing");
    expect(stepsOf(statuses, "API_KEY")).toEqual([2, 4]);
    expect(stateOf(statuses, "BASE_URL")).toBe("resolved");
  });

  it("lets an environment row hide a global of the same name", () => {
    const statuses = classifyReplayNames(
      usesPassword,
      [],
      [env("qa", [secret("PASSWORD")])],
      [plain("PASSWORD", "global")],
      "qa",
      {},
    );

    expect(stateOf(statuses, "PASSWORD")).toBe("secret");
  });

  it("reports the Starting URL as step 0", () => {
    const statuses = classifyReplayNames(
      [
        { step: 0, texts: ["{{BASE_URL}}/login"] },
        { step: 1, texts: ["{{BASE_URL}}/home"] },
      ],
      [],
      [],
      [],
      "",
      {},
    );

    expect(stepsOf(statuses, "BASE_URL")).toEqual([0, 1]);
  });

  it("reports a name used inside a subtest under the reference row's number", () => {
    const authored: BrowserStep[] = [
      { id: "s1", action: "click", name: "Open menu" },
      { id: "s2", action: "subtest", name: "Log in", subtest: { id: "login" } },
      { id: "s3", action: "click", name: "Logs" },
    ];
    const child = {
      id: "login",
      name: "Login",
      steps: [
        { id: "c1", action: "click", name: "Focus" },
        { id: "c2", action: "type", name: "Key", value: "{{API_KEY}}" },
        { id: "c3", action: "type", name: "Key again", value: "{{API_KEY}}" },
      ] as BrowserStep[],
    };
    const { steps, map } = expandJourney(authored, new Map([["login", child]]));
    const authoredNumber = (id: string) =>
      authored.findIndex((s) => s.id === translateStepId(map, id)) + 1;

    const statuses = classifyReplayNames(
      steps.map((s) => ({ step: authoredNumber(s.id), texts: [s.value] })),
      [],
      [],
      [],
      "",
      {},
    );

    expect(stepsOf(statuses, "API_KEY")).toEqual([2]);
  });
});
