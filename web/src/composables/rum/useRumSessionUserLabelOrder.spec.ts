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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { createStore } from "vuex";
import { useRumSessionUserLabelOrder } from "./useRumSessionUserLabelOrder";

const mountPreference = (identifier: string, email = "viewer@example.test") => {
  const store = createStore({
    state: { selectedOrganization: { identifier }, userInfo: { email } },
  });
  let order!: ReturnType<typeof useRumSessionUserLabelOrder>;
  const wrapper = mount(
    defineComponent({
      setup() {
        order = useRumSessionUserLabelOrder();
        return () => h("div");
      },
    }),
    { global: { plugins: [store] } },
  );
  mounted.push(wrapper);
  return { order, store };
};

const mounted: { unmount: () => void }[] = [];
const KEY = "o2:rumSessionUserLabelOrder:viewer%40example.test:org-a";

beforeEach(() => localStorage.clear());
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
});

describe("RUM session user label order preference", () => {
  it("defaults to name first and ignores invalid persisted values", () => {
    localStorage.setItem(KEY, "name-name-email");
    expect(mountPreference("org-a").order.value).toBe("name-email-id");
  });

  it("shares changes, restores them on mount and isolates viewers and orgs", async () => {
    const a = mountPreference("org-a");
    const listener = mountPreference("org-a");
    a.order.value = "id-name-email";
    expect(listener.order.value).toBe("id-name-email");
    expect(localStorage.getItem(KEY)).toBe("id-name-email");
    expect(mountPreference("org-a").order.value).toBe("id-name-email");
    a.store.state.selectedOrganization.identifier = "org-b";
    await nextTick();
    expect(a.order.value).toBe("name-email-id");
    expect(mountPreference("org-a", "another@example.test").order.value).toBe("name-email-id");
  });
});
