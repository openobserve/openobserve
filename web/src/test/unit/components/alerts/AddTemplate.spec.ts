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
import routes from "@/router/routes";
import { createRouter, createWebHistory } from "vue-router";
import TemplateService from "@/services/alert_templates";
import { rest } from "msw";
import { AddTemplate } from "@/components/alerts";

const router = createRouter({
  history: createWebHistory(),
  routes,
});

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
    wrapper = mount(AddTemplate, {
      attachTo: "#app",
      props: {
        template: null,
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

  it("Should render add template title", () => {
    expect(wrapper.find('[data-test="add-template-title"]').text()).toBe(
      "Add Template"
    );
  });

  it("Should render name input", () => {
    expect(
      wrapper.find('[data-test="add-template-name-input"]').exists()
    ).toBeTruthy();
  });

  it("Should render template body input", () => {
    expect(
      wrapper.find('[data-test="add-template-body-input-title"]').text()
    ).toBe("Body");
    expect(
      wrapper.find('[data-test="add-template-body-input"]').exists()
    ).toBeTruthy();
  });

  describe("When user fills form and clicks submit", () => {
    const submitBtn = vi.spyOn(TemplateService, "create");
    const template_name = "template1";
    afterEach(() => {
      vi.clearAllMocks();
    });
    beforeEach(async () => {
      global.server.use(
        rest.post(
          `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts/templates/${template_name}`,
          (req, res, ctx) => {
            return res(ctx.status(200), ctx.json({ code: 200 }));
          }
        )
      );
      await wrapper
        .find('[data-test="add-template-name-input"]')
        .setValue(template_name);
      wrapper.vm.formData.body = JSON.stringify("This is alert.");
    });

    it("Should create alert on clicking Submit", async () => {
      await wrapper
        .find('[data-test="add-template-submit-btn"]')
        .trigger("click");
      await flushPromises();
      expect(submitBtn).toHaveBeenCalledTimes(1);
      expect(wrapper.emitted()["get:templates"]).toHaveLength(1);
    });

    it("Should create alert on clicking Submit", async () => {
      await wrapper
        .find('[data-test="add-template-cancel-btn"]')
        .trigger("click");
      expect(wrapper.emitted()["cancel:hideform"]).toHaveLength(1);
    });
  });
});
