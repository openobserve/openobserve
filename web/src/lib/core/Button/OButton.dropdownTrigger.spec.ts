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
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent } from "vue";
import OButton from "./OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const expandedAfter = async (loading: boolean, key: string) => {
  const Host = defineComponent({
    components: { OButton, ODropdown, ODropdownItem },
    setup: () => ({ loading }),
    template: `<ODropdown><template #trigger><OButton :loading="loading" data-test="trigger">Snooze</OButton></template><ODropdownItem>15 minutes</ODropdownItem></ODropdown>`,
  });
  const wrapper = mount(Host, { attachTo: document.body, global: { plugins: [i18n, store] } });
  const trigger = wrapper.get('[data-test="trigger"]');
  await trigger.trigger("keydown", { key });
  await flushPromises();
  const expanded = trigger.attributes("aria-expanded");
  wrapper.unmount();
  return expanded;
};

describe("OButton as a dropdown trigger", () => {
  it.each(["ArrowDown", "ArrowUp", "Enter", " "])(
    "keeps the menu closed on %j while loading",
    async (key) => {
      expect(await expandedAfter(true, key)).not.toBe("true");
    },
  );

  it.each(["ArrowDown", "Enter", " "])("opens the menu on %j when not loading", async (key) => {
    expect(await expandedAfter(false, key)).toBe("true");
  });
});
