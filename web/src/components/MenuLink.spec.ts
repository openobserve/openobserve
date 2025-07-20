// Copyright 2023 OpenObserve Inc.
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
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import MenuLink from "@/components/MenuLink.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar();

describe.skip("MenuLink", async () => {
  let wrapper: any = null;
  beforeEach(() => {
    // render the component
    wrapper = mount(MenuLink, {
      props: {
        title: "Logs",
        caption: "",
        link: "#",
        icon: "",
        mini: false,
      },
      global: {
        plugins: [i18n],
        provide: {
          store,
        },
      },
    });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("should mount MenuLink component", async () => {
    expect(wrapper).toBeTruthy();
  });

  it("should render item title", async () => {
    expect(wrapper.find('[data-test="menu-link-#-item"]').text()).toBe("Logs");
  });

  it("should render item title", async () => {
    await wrapper.setProps({ mini: true });
    expect(wrapper.find('[data-test="menu-link-#-item"]').text()).toBe("");
  });

  it("should call window.open after clicking on external url", async () => {
    const windowOpen = vi.spyOn(window, "open");
    await wrapper.setProps({ external: true });
    await wrapper.find('[data-test="menu-link-#-item"]').trigger("click");
    expect(windowOpen).toHaveBeenCalledTimes(1);
    expect(windowOpen).toBeCalledWith("#", "_blank");
  });
});
