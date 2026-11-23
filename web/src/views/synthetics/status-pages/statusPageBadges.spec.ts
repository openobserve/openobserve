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
import enLocale from "@/locales/languages/en-US.json";
import { domainStateBadge } from "./statusPageBadges";

describe("domainStateBadge", () => {
  it.each([
    ["pending", "default-outline", "statusPages.domains.state.pending", "Pending"],
    ["verified", "success-outline", "statusPages.domains.state.verified", "Verified"],
    ["not_serving", "error-outline", "statusPages.domains.state.notServing", "Not serving"],
    ["expired", "warning-outline", "statusPages.domains.state.expired", "Expired"],
  ])("gives %s its own variant and label", (state, variant, labelKey, label) => {
    const badge = domainStateBadge(state);

    expect(badge).toEqual({ variant, labelKey });
    const text = labelKey
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        enLocale,
      );
    expect(text).toBe(label);
  });

  it("gives the four phase 1 states four different variants or labels", () => {
    const badges = ["pending", "verified", "not_serving", "expired"].map((state) =>
      JSON.stringify(domainStateBadge(state)),
    );

    expect(new Set(badges).size).toBe(4);
  });

  it.each([
    "waiting_for_dns",
    "setting_up",
    "ready",
    "serving",
    "delayed",
    "from_a_newer_backend",
    "",
  ])("falls back to a neutral badge with no label key for %j", (state) => {
    expect(domainStateBadge(state)).toEqual({ variant: "default-soft", labelKey: null });
  });
});
