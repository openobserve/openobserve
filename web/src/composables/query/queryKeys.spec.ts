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
import { qk, stableFilters, GLOBAL_SCOPE } from "./queryKeys";

// Every factory takes (org, …) except the org-independent ones, which pin
// GLOBAL_SCOPE themselves. Placeholder args are enough to check the prefix.
const ORG = "test_org";
const ARG = "x";

function collectKeys(node: unknown, path: string, out: Array<[string, readonly unknown[]]>) {
  if (typeof node === "function") {
    const fn = node as (...args: unknown[]) => readonly unknown[];
    // Over-supply arguments — extra ones are ignored, missing ones would throw.
    out.push([path, fn(ORG, ARG, ARG, ARG, ARG)]);
    return;
  }
  if (node && typeof node === "object") {
    for (const [name, child] of Object.entries(node)) {
      collectKeys(child, path ? `${path}.${name}` : name, out);
    }
  }
}

describe("query key factory", () => {
  const keys: Array<[string, readonly unknown[]]> = [];
  collectKeys(qk, "", keys);

  it("should expose a non-trivial number of key builders", () => {
    expect(keys.length).toBeGreaterThan(50);
  });

  it("should root every key at [\"org\", <scope>]", () => {
    for (const [path, key] of keys) {
      expect(key[0], `${path} does not start with "org"`).toBe("org");
      expect(typeof key[1], `${path} has a non-string org segment`).toBe("string");
      expect([ORG, GLOBAL_SCOPE], `${path} used an unexpected scope`).toContain(key[1]);
    }
  });

  it("should make org-independent reads use the global scope", () => {
    expect(qk.config.get()[1]).toBe(GLOBAL_SCOPE);
    expect(qk.global()[1]).toBe(GLOBAL_SCOPE);
  });

  it("should let a root key prefix-match its own detail keys", () => {
    const root = qk.alerts.root(ORG);
    const detail = qk.alerts.detail(ORG, "alert-1");
    expect(detail.slice(0, root.length)).toEqual([...root]);
  });

  it("should separate orgs at the second segment", () => {
    expect(qk.alerts.listByFolder("org_a", "f1")).not.toEqual(
      qk.alerts.listByFolder("org_b", "f1"),
    );
    expect(qk.alerts.listByFolder("org_a", "f1")[1]).toBe("org_a");
  });
});

describe("stableFilters", () => {
  it("should sort keys so field order cannot drift between call sites", () => {
    expect(Object.keys(stableFilters({ type: "scheduled", folder: "f1", name: "n" }))).toEqual([
      "folder",
      "name",
      "type",
    ]);
  });

  it("should drop empty values so an untouched filter never forks the key", () => {
    expect(stableFilters({ name: "", type: undefined, folder: "f1", status: null })).toEqual({
      folder: "f1",
    });
  });

  it("should keep falsy values that are meaningful", () => {
    expect(stableFilters({ enabled: false, count: 0 })).toEqual({ enabled: false, count: 0 });
  });
});
