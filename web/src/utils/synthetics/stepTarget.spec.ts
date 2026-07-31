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
import { stepIsMissingTarget } from "./stepTarget";

function step(partial: Partial<BrowserStep>): BrowserStep {
  return { id: "s1", action: "click", ...partial } as BrowserStep;
}

describe("stepIsMissingTarget", () => {
  it("should accept a v1 step that carries a selector", () => {
    expect(stepIsMissingTarget(step({ selector: "#login" }))).toBe(false);
  });

  it("should reject a selector-requiring step with neither selector nor locator", () => {
    expect(stepIsMissingTarget(step({}))).toBe(true);
    expect(stepIsMissingTarget(step({ selector: "   " }))).toBe(true);
  });

  it("should accept a v2 step whose target lives in the locator bundle", () => {
    expect(
      stepIsMissingTarget(
        step({
          locator: {
            candidates: [{ kind: "test_attribute", value: 'internal:testid=[data-test="login"]' }],
            user_override: null,
          },
        }),
      ),
    ).toBe(false);
  });

  it("should accept a v2 step whose only target is a pinned override", () => {
    expect(
      stepIsMissingTarget(
        step({
          locator: { candidates: [], user_override: { kind: "css", value: "#login" } },
        }),
      ),
    ).toBe(false);
  });

  it("should reject a v2 step whose bundle is empty", () => {
    expect(stepIsMissingTarget(step({ locator: { candidates: [], user_override: null } }))).toBe(
      true,
    );
  });

  it("should not require a target for actions that carry no element", () => {
    expect(stepIsMissingTarget(step({ action: "navigate", value: "https://app.test" }))).toBe(
      false,
    );
    expect(stepIsMissingTarget(step({ action: "press", value: "Enter" }))).toBe(false);
  });

  it("should not require a target for a page-level assertion", () => {
    expect(
      stepIsMissingTarget(
        step({ action: "assert", assertion: { kind: "url_matches", expected: "/home" } }),
      ),
    ).toBe(false);
    expect(stepIsMissingTarget(step({ action: "assert", assertion: { kind: "page_title" } }))).toBe(
      false,
    );
  });

  it("should still require a target for an element-level assertion", () => {
    expect(
      stepIsMissingTarget(step({ action: "assert", assertion: { kind: "element_visible" } })),
    ).toBe(true);
  });
});
