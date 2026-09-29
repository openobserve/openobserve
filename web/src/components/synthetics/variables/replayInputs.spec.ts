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
  GLOBAL_ONLY,
  mergeReplayVariables,
  replayEnvironmentOptions,
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

  it("applies only global values for Global only", () => {
    const globals = [plain("BASE_URL", "https://global.test")];
    const envs = [env("prod", [plain("BASE_URL", "https://prod.test"), plain("ORG", "acme")])];

    expect(sharedPlainValues(envs, globals, GLOBAL_ONLY)).toEqual({
      BASE_URL: "https://global.test",
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

  it("returns Global only when the check pins no environment", () => {
    expect(GLOBAL_ONLY).toBe("");
    expect(defaultReplayEnvironmentId([], [global, env("prod", []), env("stg", [])])).toBe(
      GLOBAL_ONLY,
    );
  });

  it("skips a pinned environment the user cannot read", () => {
    expect(defaultReplayEnvironmentId(["hidden", "stg"], [env("stg", [])])).toBe("stg");
  });

  it("returns Global only when no pinned environment is readable", () => {
    expect(defaultReplayEnvironmentId(["hidden"], [env("prod", [])])).toBe(GLOBAL_ONLY);
  });

  it("returns Global only when the org has only the global environment", () => {
    expect(defaultReplayEnvironmentId([], [global])).toBe(GLOBAL_ONLY);
  });

  it("returns Global only before the shared list loads", () => {
    expect(defaultReplayEnvironmentId([], [])).toBe(GLOBAL_ONLY);
  });
});

describe("replayEnvironmentOptions", () => {
  const global = { ...env("global", []), is_global: true };
  const envs = [
    global,
    env("prod", [plain("BASE_URL", "https://prod.test")]),
    env("stg", [plain("BASE_URL", "https://stg.test")]),
    env("qa", [plain("BASE_URL", "https://qa.test")]),
  ];
  const globals = [plain("BASE_URL", "https://global.test")];

  it("lists the test's environments first, then the others as not in this test", () => {
    const options = replayEnvironmentOptions("{{BASE_URL}}/login", [], envs, globals, [
      "stg",
      "hidden",
      "prod",
    ]);

    expect(options.map(({ id, inTest }) => ({ id, inTest }))).toEqual([
      { id: "stg", inTest: true },
      { id: "prod", inTest: true },
      { id: "qa", inTest: false },
    ]);
    expect(options.map((o) => o.name)).toEqual(["stg", "prod", "qa"]);
  });

  it("offers Global first when the test pins no readable environment", () => {
    const options = replayEnvironmentOptions("{{BASE_URL}}/login", [], envs, globals, ["hidden"]);

    expect(options.map(({ id, inTest }) => ({ id, inTest }))).toEqual([
      { id: GLOBAL_ONLY, inTest: true },
      { id: "prod", inTest: false },
      { id: "stg", inTest: false },
      { id: "qa", inTest: false },
    ]);
    expect(options[0].host).toBe("global.test");
  });

  it("reads the host from each environment's resolved Starting URL", () => {
    const withPort = [
      env("prod", [plain("BASE_URL", "https://prod.test:8443")]),
      env("bare", [plain("BASE_URL", "stg.test")]),
      env("broken", [plain("BASE_URL", "bad host")]),
    ];

    const options = replayEnvironmentOptions(
      "{{BASE_URL}}/login",
      [],
      withPort,
      [],
      ["prod", "bare", "broken"],
    );

    expect(options.map((o) => o.host)).toEqual([
      "prod.test:8443",
      "stg.test",
      "https://bad host/login",
    ]);
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
