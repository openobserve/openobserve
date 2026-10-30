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

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import FeatureLocked from "@/components/common/FeatureLocked.vue";
import LicenseDeniedState from "@/components/common/LicenseDeniedState.vue";

vi.mock("vue-router", () => ({ useRoute: () => ({ params: { feature: "ai_assistant" } }) }));
vi.mock("vuex", () => ({
  useStore: () => ({ state: { zoConfig: { feature_names: { ai_assistant: "AI Assistant" } } } }),
}));

const openMock = vi.fn();

describe("FeatureLocked", () => {
  it("renders the shared license-denied state for the routed feature", () => {
    const w = mount(FeatureLocked, {
      global: {
        plugins: [i18n],
        stubs: { OPageLayout: { template: "<div><slot /></div>" } },
      },
    });
    expect(w.findComponent(LicenseDeniedState).props("features")).toEqual(["ai_assistant"]);
  });

  it("offers a contact-sales action below the denied state", async () => {
    vi.stubGlobal("open", openMock);
    const w = mount(FeatureLocked, {
      global: {
        plugins: [i18n],
        stubs: { OPageLayout: { template: "<div><slot /></div>" } },
      },
    });
    const cta = w.find('[data-test="feature-locked-contact-sales"]');
    expect(cta.text()).toBe("Contact sales");
    await cta.trigger("click");
    expect(openMock).toHaveBeenCalledWith(expect.any(String), "_blank", "noopener");
    vi.unstubAllGlobals();
  });
});
