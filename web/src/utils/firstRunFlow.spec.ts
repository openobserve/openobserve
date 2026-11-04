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
import { onboardingFlowOn, sampleDataFlowOn } from "./firstRunFlow";

describe("first-run flow switches", () => {
  it.each([
    ["an older backend that sends neither switch", {}, true, false],
    ["no config at all", undefined, true, false],
    [
      "the defaults",
      { onboarding_flow_enabled: true, sample_data_onboarding_enabled: false },
      true,
      false,
    ],
    [
      "sample data on",
      { onboarding_flow_enabled: true, sample_data_onboarding_enabled: true },
      false,
      true,
    ],
    [
      "sample data on, onboarding off",
      { onboarding_flow_enabled: false, sample_data_onboarding_enabled: true },
      false,
      true,
    ],
    [
      "both off",
      { onboarding_flow_enabled: false, sample_data_onboarding_enabled: false },
      false,
      false,
    ],
  ])("%s", (_, cfg, onboarding, sample) => {
    expect(onboardingFlowOn(cfg)).toBe(onboarding);
    expect(sampleDataFlowOn(cfg)).toBe(sample);
  });
});
