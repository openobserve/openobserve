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

import { afterEach, describe, expect, it } from "vitest";
import config from "@/aws-exports";
import { onboardingFlowOn, sampleDataFlowOn } from "./firstRunFlow";

const CLOUD = config.isCloud;

describe("first-run flow switches", () => {
  afterEach(() => {
    config.isCloud = CLOUD;
  });

  const flags = [undefined, true, false];
  const cases = ["true", "false"].flatMap((cloud) =>
    flags.flatMap((onb) =>
      flags.map((sample) => {
        const onboarding = cloud === "true" && onb !== false;
        return [cloud, onb, sample, onboarding, sample !== false && !onboarding] as const;
      }),
    ),
  );

  it.each(cases)(
    "isCloud=%s onboarding=%s sample=%s -> onboarding %s, sample %s",
    (cloud, onb, sample, onboarding, sampleOn) => {
      config.isCloud = cloud;
      const cfg = {
        version: "v0.0.0",
        onboarding_flow_enabled: onb,
        sample_data_onboarding_enabled: sample,
      };
      expect(onboardingFlowOn(cfg)).toBe(onboarding);
      expect(sampleDataFlowOn(cfg)).toBe(sampleOn);
    },
  );

  it("counts a backend without the switches as both on, once the full config has loaded", () => {
    config.isCloud = "true";
    expect([onboardingFlowOn({ version: "" }), sampleDataFlowOn({ version: "" })]).toEqual([
      true,
      false,
    ]);
    config.isCloud = "false";
    expect([onboardingFlowOn({ version: "" }), sampleDataFlowOn({ version: "" })]).toEqual([
      false,
      true,
    ]);
  });

  // the bootstrap config has no switches, so a failed full config must not read as "on"
  it.each(["true", "false"])("isCloud=%s: no flow until the full config is known", (cloud) => {
    config.isCloud = cloud;
    for (const cfg of [
      undefined,
      {},
      { onboarding_flow_enabled: true, sample_data_onboarding_enabled: true },
    ]) {
      expect([onboardingFlowOn(cfg), sampleDataFlowOn(cfg)]).toEqual([false, false]);
    }
  });
});
