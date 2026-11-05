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

import { describe, it, expect } from "vitest";
import { errorHeadline } from "./format";

describe("errorHeadline", () => {
  it("cuts dead-letter messages before their open '(phase' group", () => {
    expect(
      errorHeadline(
        "probe did not respond after 3 dispatch attempts (phase: claimed, no result before the lease ran out); the probe may be unable to reach the callback endpoint http://localhost:5080",
      ),
    ).toBe("probe did not respond after 3 dispatch attempts");
    expect(
      errorHeadline(
        "probe held the check but did not respond before its schedule window closed (phase: claimed, lease expired without a result; after 1 dispatch attempt(s)); the probe may be unable to reach the callback endpoint http://localhost:5080; the next scheduled run will retry",
      ),
    ).toBe("probe held the check but did not respond before its schedule window closed");
    expect(
      errorHeadline(
        "no probe claimed the check for this location before its schedule window closed (phase: never claimed; 0 dispatch attempt(s)); a probe may be unable to reach the callback endpoint http://localhost:5080",
      ),
    ).toBe("no probe claimed the check for this location before its schedule window closed");
  });

  it("trims trailing punctuation left before the cut", () => {
    expect(errorHeadline("lease lost, (phase: claimed)")).toBe("lease lost");
  });

  it("keeps the text before the first colon for every other shape", () => {
    const messages = [
      "TimeoutError: page.waitForSelector: Timeout 30000ms exceeded.",
      "page.goto: net::ERR_NAME_NOT_RESOLVED at https://app.test/",
      "locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Sign in' })",
      "config: this check needs up to 4 per run, which is over the 3 check budget.",
      "Error: expect(locator).toBeVisible() failed",
      "waiting for locator('a:visible') to be attached",
      "navigation failed (net error) after retry",
      "the organization's included synthetics steps are exhausted, so this run was skipped",
      "(phase: claimed)",
    ];
    for (const m of messages) expect(errorHeadline(m)).toBe(m.split(":")[0]);
  });
});
