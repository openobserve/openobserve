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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import DateTime from "@/components/DateTime.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/composables/useBreakpoint", () => ({
  default: () => ({ isMobile: ref(true) }),
}));

describe("DateTime compact trigger", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the whole rolling name on a phone, without the clock icon or caret", async () => {
    store.state.savedViewFlag = false;
    const wrapper = mount(DateTime, { global: { plugins: [i18n, store] } });
    await flushPromises();

    expect(wrapper.vm.triggerLabel).toBe("Last 15 minutes");
    expect(wrapper.find('[data-test="date-time-btn"]').text()).toContain("Last 15 minutes");
    wrapper.unmount();
  });

  it("names a rolling period in hours the same way", async () => {
    const wrapper = mount(DateTime, {
      props: { defaultRelativeTime: "3h" },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();

    expect(wrapper.vm.triggerLabel).toBe("Last 3 hours");
    wrapper.unmount();
  });
});
