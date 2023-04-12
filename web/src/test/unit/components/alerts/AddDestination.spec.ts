// Copyright 2022 Zinc Labs Inc. and Contributors

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises, DOMWrapper } from "@vue/test-utils";
import { installQuasar } from "../../helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "../../helpers/store";
import DestinationService from "@/services/alert_destination";
import { rest } from "msw";
import { AddDestination } from "@/components/alerts";
import router from "../../helpers/router";

installQuasar({
  plugins: [Dialog, Notify],
});

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

describe("Alert List", async () => {
  let wrapper: any;
  beforeEach(async () => {
    vi.useFakeTimers();
    wrapper = mount(AddDestination, {
      attachTo: "#app",
      props: {
        templates: [],
        destination: null,
      },
      global: {
        provide: {
          store: store,
        },
        plugins: [i18n, router],
      },
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("Should render add destination title", () => {
    expect(wrapper.find('[data-test="add-destination-title"]').text()).toBe(
      "Add Destination"
    );
  });

  it("Should render name input", () => {
    expect(
      wrapper.find('[data-test="add-destination-name-input"]').exists()
    ).toBeTruthy();
  });

  it("Should render template select", () => {
    expect(
      wrapper.find('[data-test="add-destination-template-select"]').exists()
    ).toBeTruthy();
  });

  it("Should render url input", () => {
    expect(
      wrapper.find('[data-test="add-destination-url-input"]').exists()
    ).toBeTruthy();
  });

  it("Should reder method select input", () => {
    expect(
      wrapper.find('[data-test="add-destination-method-select"]').exists()
    ).toBeTruthy();
  });

  it("Should reder add headers inputs", () => {
    const headerKey = "";
    const headerValue = "";
    expect(
      wrapper
        .find(`[data-test="add-destination-header-${headerKey}-key-input"]`)
        .exists()
    ).toBeTruthy();
    expect(
      wrapper
        .find(`[data-test="add-destination-header-${headerValue}-value-input"]`)
        .exists()
    ).toBeTruthy();
  });

  describe("When user fills form and clicks submit", () => {
    const submitBtn = vi.spyOn(DestinationService, "create");
    const template_name = "template1";
    const dest_name = "dest1";
    afterEach(() => {
      vi.clearAllMocks();
    });
    beforeEach(async () => {
      global.server.use(
        rest.post(
          `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts/destinations/${dest_name}`,
          (req, res, ctx) => {
            return res(ctx.status(200), ctx.json({ code: 200 }));
          }
        )
      );
      await wrapper
        .find('[data-test="add-destination-name-input"]')
        .setValue(dest_name);
      wrapper.vm.formData.template = template_name;
      await wrapper
        .find('[data-test="add-destination-url-input"]')
        .setValue("abc");
      wrapper.vm.formData.method = "post";
      await wrapper
        .find('[data-test="add-destination-header--key-input"]')
        .setValue("key");
      await wrapper
        .find('[data-test="add-destination-header-key-value-input"]')
        .setValue("value");
    });

    it("Should create alert on clicking Submit", async () => {
      await wrapper
        .find('[data-test="add-destination-submit-btn"]')
        .trigger("click");
      await flushPromises();
      expect(submitBtn).toHaveBeenCalledTimes(1);
      expect(wrapper.emitted()["get:destinations"]).toHaveLength(1);
    });

    it("Should create alert on clicking Submit", async () => {
      await wrapper
        .find('[data-test="add-destination-cancel-btn"]')
        .trigger("click");
      expect(wrapper.emitted()["cancel:hideform"]).toHaveLength(1);
    });
  });
});
