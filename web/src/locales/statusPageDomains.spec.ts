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

// The custom domains dialog no longer says a verified domain serves the page, so the strings
// that said so (and the numeric failure map that `serving_state` replaced) leave every locale.

import { describe, it, expect } from "vitest";
import { localeStems, readLocaleMessages } from "@/test/unit/helpers/localeFiles";

const REMOVED_DOMAIN_KEYS = ["serving", "nextStepCname", "deleteBody", "failureReason"];

interface DomainsMessages extends Record<string, unknown> {
  state: Record<string, string>;
}

const domainsOf = (stem: string) =>
  (readLocaleMessages(stem) as { statusPages: { domains: DomainsMessages } }).statusPages.domains;

describe("statusPages.domains in the locale files", () => {
  it("covers all 17 locales", () => {
    expect(localeStems()).toHaveLength(17);
  });

  describe.each(localeStems())("%s", (stem) => {
    it.each(REMOVED_DOMAIN_KEYS)("has no %s", (key) => {
      expect(Object.keys(domainsOf(stem))).not.toContain(key);
    });

    it("has no failed state label", () => {
      expect(Object.keys(domainsOf(stem).state)).not.toContain("failed");
    });
  });

  it("keeps a label for each phase 1 state in en-US", () => {
    expect(Object.keys(domainsOf("en-US").state).sort()).toEqual([
      "expired",
      "notServing",
      "pending",
      "verified",
    ]);
  });
});
