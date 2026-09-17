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
import type { BrowserStep } from "@/types/synthetics";
import { extractEligibility, type ExtractEligibilityInput } from "./extractEligibility";

const nav = (id: string, value = "https://example.com/login"): BrowserStep => ({
  id,
  action: "navigate",
  name: `Open ${id}`,
  value,
});
const click = (id: string): BrowserStep => ({
  id,
  action: "click",
  name: `Click ${id}`,
  locator: { candidates: [{ kind: "css", value: `#${id}` }] },
});
const typeStep = (id: string, value: string): BrowserStep => ({
  id,
  action: "type",
  name: `Type ${id}`,
  value,
  locator: { candidates: [{ kind: "css", value: `#${id}` }] },
});
const press = (id: string, value: string): BrowserStep => ({
  id,
  action: "press",
  name: `Press ${id}`,
  value,
  locator: { candidates: [{ kind: "css", value: `#${id}` }] },
});
const subtest = (id: string): BrowserStep => ({
  id,
  action: "subtest",
  name: "Shared login",
  subtest: { id: "login-test", name: "Login" },
});

const journey: BrowserStep[] = [nav("s1"), click("s2"), typeStep("s3", "alice"), click("s4")];

function input(overrides: Partial<ExtractEligibilityInput> = {}): ExtractEligibilityInput {
  return {
    steps: journey,
    selectedIds: new Set(["s1", "s2"]),
    filterActive: false,
    referencedBy: "none",
    definedNames: new Set<string>(),
    ...overrides,
  };
}

describe("extractEligibility", () => {
  it("treats an empty selection as not-contiguous", () => {
    expect(extractEligibility(input({ selectedIds: new Set() }))).toEqual({
      ok: false,
      reason: "not-contiguous",
    });
  });

  it("refuses a selection whose model indices are not consecutive", () => {
    expect(extractEligibility(input({ selectedIds: new Set(["s1", "s3"]) }))).toEqual({
      ok: false,
      reason: "not-contiguous",
    });
  });

  it("names the filter when a gap may be hidden by it", () => {
    expect(
      extractEligibility(input({ selectedIds: new Set(["s1", "s3"]), filterActive: true })),
    ).toEqual({ ok: false, reason: "not-contiguous-filtered" });
  });

  it("refuses a range that does not start with a navigate step", () => {
    expect(extractEligibility(input({ selectedIds: new Set(["s2", "s3"]) }))).toEqual({
      ok: false,
      reason: "no-navigate-first",
    });
  });

  it("refuses a range containing a subtest step", () => {
    const steps = [nav("s1"), subtest("s2"), click("s3")];
    expect(extractEligibility(input({ steps, selectedIds: new Set(["s1", "s2"]) }))).toEqual({
      ok: false,
      reason: "contains-subtest",
    });
  });

  it("refuses when other tests already reference this one", () => {
    expect(extractEligibility(input({ referencedBy: "some" }))).toEqual({
      ok: false,
      reason: "referenced",
    });
  });

  it("refuses while the referenced-by lookup is pending", () => {
    expect(extractEligibility(input({ referencedBy: "pending" }))).toEqual({
      ok: false,
      reason: "referenced-pending",
    });
  });

  it("refuses when the referenced-by lookup failed", () => {
    expect(extractEligibility(input({ referencedBy: "unknown" }))).toEqual({
      ok: false,
      reason: "referenced-unknown",
    });
  });

  it("refuses a placeholder the test does not define, naming the first missing one", () => {
    const steps = [nav("s1"), typeStep("s2", "{{USER}}@{{DOMAIN}}"), click("s3")];
    expect(
      extractEligibility(
        input({ steps, selectedIds: new Set(["s1", "s2"]), definedNames: new Set(["DOMAIN"]) }),
      ),
    ).toEqual({ ok: false, reason: "undefined-placeholder", placeholder: "USER" });
  });

  it("accepts the whole journey as a range", () => {
    // Selection order is click order; the range must still come back in model order.
    const result = extractEligibility(input({ selectedIds: new Set(["s3", "s1", "s4", "s2"]) }));
    expect(result).toEqual({ ok: true, range: journey, anchor: 0 });
  });

  it("accepts a range anchored at index 0", () => {
    expect(extractEligibility(input({ selectedIds: new Set(["s1"]) }))).toEqual({
      ok: true,
      range: [journey[0]],
      anchor: 0,
    });
  });

  it("ignores optional and alwaysRun flags", () => {
    const steps = [
      { ...nav("s1"), optional: true },
      { ...click("s2"), alwaysRun: true },
      click("s3"),
    ];
    expect(extractEligibility(input({ steps, selectedIds: new Set(["s1", "s2"]) }))).toEqual({
      ok: true,
      range: [steps[0], steps[1]],
      anchor: 0,
    });
  });

  it("catches a placeholder in a navigate step's value", () => {
    const steps = [nav("s1", "{{BASE_URL}}/login"), click("s2")];
    expect(extractEligibility(input({ steps, selectedIds: new Set(["s1", "s2"]) }))).toEqual({
      ok: false,
      reason: "undefined-placeholder",
      placeholder: "BASE_URL",
    });
  });

  it("catches a placeholder in a press step's value", () => {
    const steps = [nav("s1"), press("s2", "{{HOTKEY}}")];
    expect(extractEligibility(input({ steps, selectedIds: new Set(["s1", "s2"]) }))).toEqual({
      ok: false,
      reason: "undefined-placeholder",
      placeholder: "HOTKEY",
    });
  });

  it("does not report a placeholder in an assert, select or upload value", () => {
    const steps: BrowserStep[] = [
      nav("s1"),
      { id: "s2", action: "assert", name: "Landed", value: "{{TOKEN}}" },
      { id: "s3", action: "select", name: "Pick plan", value: "{{PLAN}}" },
      { id: "s4", action: "upload", name: "Attach", value: "{{FILE}}" },
    ];
    expect(
      extractEligibility(input({ steps, selectedIds: new Set(["s1", "s2", "s3", "s4"]) })),
    ).toEqual({ ok: true, range: steps, anchor: 0 });
  });

  it("reports the earlier rule when two rules fail", () => {
    // navigate-first, contains-subtest and referenced all fail; precedence says the earliest wins.
    const steps = [nav("s1"), click("s2"), subtest("s3")];
    expect(
      extractEligibility(
        input({ steps, selectedIds: new Set(["s2", "s3"]), referencedBy: "some" }),
      ),
    ).toEqual({ ok: false, reason: "no-navigate-first" });
  });
});
