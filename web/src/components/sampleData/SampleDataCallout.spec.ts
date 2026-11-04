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
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import enLocale from "@/locales/languages/en-US.json";
import SampleDataCallout from "./SampleDataCallout.vue";

const session = vi.hoisted(() => ({
  status: { value: "idle" },
  loadingOrg: { value: "" },
  loadInDialog: vi.fn(),
}));
vi.mock("@/composables/sampleData/useSampleDataSession", () => ({
  useSampleDataSession: () => session,
}));

describe("SampleDataCallout", () => {
  it("starts the load in one click, with its progress on screen", async () => {
    const wrapper = mount(SampleDataCallout, {
      global: {
        plugins: [
          createI18n({ legacy: false, locale: "en", messages: { en: enLocale } }),
          createStore({ state: { selectedOrganization: { identifier: "test-org" } } }),
        ],
      },
    });
    expect(wrapper.findAll("button")).toHaveLength(1);
    await wrapper.find('[data-test="sample-data-callout-load"]').trigger("click");
    expect(session.loadInDialog).toHaveBeenCalledWith("test-org", undefined);
  });
});
