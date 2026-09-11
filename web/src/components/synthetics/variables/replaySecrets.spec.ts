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

import { beforeEach, describe, expect, it } from "vitest";
import type { WireStep } from "@/types/synthetics";
import type { ResolvedVariable } from "./resolved";
import {
  forgetReplaySecrets,
  mergeReplayVariables,
  partitionReplaySecrets,
  rememberReplaySecret,
  secretsNeededForReplay,
} from "./replaySecrets";

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
    // Prompting for every secret in the environment would turn replay into a
    // bulk credential-collection screen.
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
    rememberReplaySecret("PASSWORD", "hunter2");
    const { known, missing } = partitionReplaySecrets(["PASSWORD", "TOKEN"]);

    expect(known).toEqual({ PASSWORD: "hunter2" });
    expect(missing).toEqual(["TOKEN"]);
  });

  it("forgets everything on demand", () => {
    rememberReplaySecret("PASSWORD", "hunter2");
    forgetReplaySecrets();

    expect(partitionReplaySecrets(["PASSWORD"]).missing).toEqual(["PASSWORD"]);
  });

  it("never writes to localStorage or sessionStorage", () => {
    // The whole point of holding these in memory: browser storage survives a
    // reload and is readable by any script on the origin.
    rememberReplaySecret("PASSWORD", "hunter2");

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
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
    // The check's value is what it would actually run with; a supplied secret
    // only stands in for one the client cannot see.
    const merged = mergeReplayVariables([{ name: "PASSWORD", value: "own" }], {
      PASSWORD: "typed",
    });

    expect(merged).toEqual([{ name: "PASSWORD", value: "own" }]);
  });
});
