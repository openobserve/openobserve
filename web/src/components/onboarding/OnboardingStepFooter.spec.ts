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

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import OButton from "@/lib/core/Button/OButton.vue";
import { createI18n } from "vue-i18n";

import OnboardingStepFooter from "./OnboardingStepFooter.vue";
import { ONBOARDING_SKIP } from "./onboardingFlow";

const i18n = createI18n({
  locale: "en",
  messages: { en: { onboarding: { skipToApp: "Skip to app" } } },
});

const mountFooter = (skip: () => Promise<void>) =>
  mount(OnboardingStepFooter, {
    global: { plugins: [i18n], provide: { [ONBOARDING_SKIP as symbol]: skip } },
  });

describe("OnboardingStepFooter", () => {
  it("shows loading and ignores clicks while the skip is pending", async () => {
    let finish!: () => void;
    const skip = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const w = mountFooter(skip);
    const btn = w.find('[data-test="onboarding-view-skip"]');
    await btn.trigger("click");
    await btn.trigger("click");
    expect(skip).toHaveBeenCalledTimes(1);
    expect(w.findComponent(OButton).props("loading")).toBe(true);
    finish();
    await vi.waitFor(() => expect(w.findComponent(OButton).props("loading")).toBe(false));
  });
});
