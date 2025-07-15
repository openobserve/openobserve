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


import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ShortUrl from "@/views/ShortUrl.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import * as zincutils from "@/utils/zincutils";

// Mock only the routeGuard function
vi.spyOn(zincutils, 'routeGuard').mockImplementation(async (to, from, next) => {
  next();
});

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({
  plugins: [Dialog, Notify],
});


describe.skip("ShortUrl", () => {
    let wrapper;
    
    beforeEach(async () => {
        // Set up the route with an ID parameter
        wrapper = mount(ShortUrl, {
            attachTo: "#app",
            global: {
              provide: {
                store: store,
              },
              plugins: [i18n, router],
            },
            props: {
                id: "test-id",
            }
        });
    });

    afterEach(() => {
        wrapper.unmount();
    });

  it("Should match snapshot", () => {
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("Should render spinner", () => {
    expect(wrapper.find('[data-test="spinner"]').exists()).toBe(true);
  });

  it("Should render message", () => {
    expect(wrapper.find('[data-test="message"]').text()).toBe("Redirecting...");
  });

  it("Should redirect to the correct page", async () => {
    // Wait for the api call to resolve
    await new Promise(resolve => setTimeout(resolve, 1000));   
    expect(wrapper.vm.$router.currentRoute.value.name).toBe("logs");
  });
});