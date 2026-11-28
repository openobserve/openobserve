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
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import { envChips, pinBadges, privateLocationBadges } from "./secretBadges";

const t = i18n.global.t as unknown as TranslateFn;
const base = {
  kind: "secret" as const,
  state: "active" as const,
  pin_mode: "hosts" as const,
  private_locations: "off" as const,
};

describe("secret badges", () => {
  it("is quiet for a pinned secret with private locations off", () => {
    expect(pinBadges(t, base)).toEqual([]);
    expect(privateLocationBadges(t, base)).toEqual([]);
  });

  it.each([
    ["none", "not-pinned", "warning-soft"],
    ["legacy", "legacy", "warning-soft"],
    ["any", "any-host", "error-soft"],
  ] as const)("pin_mode %s shows %s", (pin_mode, id, variant) => {
    expect(pinBadges(t, { ...base, pin_mode })).toMatchObject([{ id, variant }]);
  });

  it("carries the override reason on the any-host badge", () => {
    const [badge] = pinBadges(t, { ...base, pin_mode: "any", pin_override_reason: "rotating" });
    expect(badge.title).toBe("Reason: rotating");
  });

  it("gives variables no pin badge", () => {
    expect(pinBadges(t, { ...base, kind: "variable", pin_mode: "none" })).toEqual([]);
  });

  it.each([
    ["on", "private-locations"],
    ["legacy", "private-locations-legacy"],
  ] as const)("private_locations %s shows %s", (private_locations, id) => {
    expect(privateLocationBadges(t, { ...base, private_locations })).toMatchObject([
      { id, variant: "amber-soft" },
    ]);
  });

  it("puts the org value first and flags unset environments", () => {
    const chips = envChips(t, [
      { env: "staging", state: "unset", value_version: 0 },
      { env: "prod", state: "set", value_version: 2 },
      { env: "_org", state: "set", value_version: 3 },
      { env: "dev", state: "inherit", value_version: 0 },
    ]);
    expect(chips.map((c) => c.label)).toEqual(["Org", "prod", "staging unset"]);
  });
});
