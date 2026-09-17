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

import { describe, expect, it, vi } from "vitest";
import type { BrowserStep } from "@/types/synthetics";
import {
  composedStepId,
  composedStepName,
  expandJourney,
  loadChildren,
  translateStepId,
  undefinedPlaceholders,
  type ChildJourney,
} from "./expandJourney";

const nav = (id: string, name = "Open"): BrowserStep => ({
  id,
  action: "navigate",
  name,
  value: "https://example.com",
});
const click = (id: string, name: string): BrowserStep => ({
  id,
  action: "click",
  name,
  locator: { candidates: [{ kind: "css", value: "#x" }] },
});
const subtest = (id: string, child: string): BrowserStep => ({
  id,
  action: "subtest",
  name: "Log in (shared)",
  subtest: { id: child },
});
const login: ChildJourney = {
  id: "login-test",
  name: "Login",
  steps: [nav("c1", "Open login"), click("c2", "fill email"), click("c3", "submit")],
};

describe("expandJourney", () => {
  it("splices the child literally, rewriting ids and names, and records provenance", () => {
    const { steps, map } = expandJourney(
      [nav("s1"), subtest("s2", "login-test"), click("s3", "Logs")],
      new Map([["login-test", login]]),
    );
    expect(steps.map((s) => s.id)).toEqual(["s1", "s2_c1", "s2_c2", "s2_c3", "s3"]);
    expect(steps[2].name).toBe("Log in (shared) › fill email");
    expect(steps[2].locator).toEqual(login.steps[1].locator);
    expect(steps.some((s) => s.action === "subtest")).toBe(false);
    expect(map.get("s2_c2")).toEqual({
      authoredStepId: "s2",
      childIndex: 1,
      childStepName: "fill email",
      childCount: 3,
    });
    expect(map.has("s1")).toBe(false);
  });

  it("gives a twice-referenced child distinct ids per call site", () => {
    const { steps } = expandJourney(
      [nav("s1"), subtest("s2", "login-test"), subtest("s4", "login-test")],
      new Map([["login-test", login]]),
    );
    expect(steps.map((s) => s.id)).toEqual([
      "s1",
      "s2_c1",
      "s2_c2",
      "s2_c3",
      "s4_c1",
      "s4_c2",
      "s4_c3",
    ]);
  });

  it("throws when a child is missing or nests a subtest", () => {
    expect(() => expandJourney([nav("s1"), subtest("s2", "gone")], new Map())).toThrow(/gone/);
    const nested: ChildJourney = { ...login, steps: [...login.steps, subtest("c9", "other")] };
    expect(() =>
      expandJourney([nav("s1"), subtest("s2", "login-test")], new Map([["login-test", nested]])),
    ).toThrow(/one level/);
  });

  it("rewrites a spliced step's wire id and name so the extension reports under the composed id", () => {
    const withWire: ChildJourney = {
      ...login,
      steps: [
        { ...login.steps[0], wire: { id: "c1", action: "navigate", url: "https://example.com" } },
      ],
    };
    const { steps } = expandJourney(
      [nav("s1"), subtest("s2", "login-test")],
      new Map([["login-test", withWire]]),
    );
    expect(steps[1].wire?.id).toBe("s2_c1");
  });

  it("translates composed ids back to the authored row and leaves others alone", () => {
    const { map } = expandJourney(
      [nav("s1"), subtest("s2", "login-test")],
      new Map([["login-test", login]]),
    );
    expect(translateStepId(map, "s2_c3")).toBe("s2");
    expect(translateStepId(map, "s1")).toBe("s1");
  });

  it("loads each distinct child once", async () => {
    const fetchCheck = vi.fn(async (id: string) => ({ ...login, id }));
    const children = await loadChildren(
      [nav("s1"), subtest("s2", "a"), subtest("s3", "a"), subtest("s4", "b")],
      fetchCheck,
    );
    expect(fetchCheck).toHaveBeenCalledTimes(2);
    expect([...children.keys()].sort()).toEqual(["a", "b"]);
  });

  it("matches the server's id and name rules", () => {
    expect(composedStepId("s2", "c7")).toBe("s2_c7");
    expect(composedStepName(undefined, "Login", "fill")).toBe("Login › fill");
    expect(composedStepName("Log in", "Login", undefined)).toBe("Log in › step");
  });
});

// Mirrors the server's PLACEHOLDER_FIELDS scan; an undefined token otherwise fails at resolve time.
describe("undefinedPlaceholders", () => {
  const typeStep = (id: string, value: string): BrowserStep => ({
    id,
    action: "type",
    name: id,
    value,
    locator: { candidates: [{ kind: "css", value: "#x" }] },
  });

  it("lists placeholders the child uses that the parent does not define, once each, sorted", () => {
    const child: ChildJourney = {
      id: "login-test",
      name: "Login",
      steps: [
        { id: "c1", action: "navigate", name: "Open", value: "https://{{BASE_URL}}/login" },
        typeStep("c2", "{{USER}}"),
        typeStep("c3", "{{ PASSWORD }}"),
        typeStep("c4", "{{USER}}@{{DOMAIN}}"),
      ],
    };
    expect(undefinedPlaceholders(child, ["BASE_URL"])).toEqual(["DOMAIN", "PASSWORD", "USER"]);
    expect(undefinedPlaceholders(child, new Set<string>())).toEqual([
      "BASE_URL",
      "DOMAIN",
      "PASSWORD",
      "USER",
    ]);
  });

  it("ignores assert steps and defined names", () => {
    const child: ChildJourney = {
      id: "login-test",
      name: "Login",
      steps: [
        typeStep("c1", "{{USER}}"),
        // assert/select/upload `value`s map to wire `text`/`options`/`files`, which the server never scans.
        { id: "c2", action: "assert", name: "Landed", value: "{{TOKEN}}" },
        { id: "c4", action: "select", name: "Pick plan", value: "{{PLAN}}" },
        { id: "c5", action: "upload", name: "Attach", value: "{{FILE}}" },
        {
          id: "c3",
          action: "click",
          name: "Go",
          locator: { candidates: [{ kind: "css", value: "#go" }] },
        },
      ],
    };
    expect(undefinedPlaceholders(child, ["USER"])).toEqual([]);
    expect(undefinedPlaceholders(child, [])).toEqual(["USER"]);
  });

  // Regression guards for the delegation to `placeholdersIn`: same answer both ways.
  it("still reports a placeholder in a type value", () => {
    const child: ChildJourney = {
      id: "login-test",
      name: "Login",
      steps: [typeStep("c1", "{{USER}}")],
    };
    expect(undefinedPlaceholders(child, [])).toEqual(["USER"]);
    expect(undefinedPlaceholders(child, ["USER"])).toEqual([]);
  });

  it("still ignores a placeholder in an assert value", () => {
    const child: ChildJourney = {
      id: "login-test",
      name: "Login",
      steps: [{ id: "c1", action: "assert", name: "Landed", value: "{{TOKEN}}" }],
    };
    expect(undefinedPlaceholders(child, [])).toEqual([]);
  });
});
