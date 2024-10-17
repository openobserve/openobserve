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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises, DOMWrapper } from "@vue/test-utils";
import { installQuasar } from "../../helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import TemplateList from "@/components/alerts/TemplateList.vue";
import i18n from "@/locales";
import store from "../../helpers/store";
// @ts-ignore
import { rest } from "msw";
import templateService from "@/services/alert_templates";
import router from "../../helpers/router";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({
  plugins: [Dialog, Notify],
});

describe("Alert List", async () => {
  let wrapper: any;
  beforeEach(async () => {
    vi.useFakeTimers();
    wrapper = mount(TemplateList, {
      attachTo: "#app",
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

  it("Should render alerts title", () => {
    expect(
      wrapper.find('[data-test="alert-templates-list-title"]').text()
    ).toBe("Templates");
  });
  it("Should reder table with templates", () => {
    expect(
      wrapper.find('[data-test="alert-templates-list-table"]').exists()
    ).toBeTruthy();
  });

  it("Should display table column headers", async () => {
    await flushPromises();
    const tableData = wrapper
      .find('[data-test="alert-templates-list-table"]')
      .find("thead")
      .find("tr")
      .findAll("th");
    expect(tableData[0].text()).toBe("#");
    expect(tableData[1].text()).toContain("Name");
    expect(tableData[2].text()).toContain("Actions");
  });

  it("Should display table row data", async () => {
    await flushPromises();
    const tableData = wrapper
      .find('[data-test="alert-templates-list-table"]')
      .find("tbody")
      .find("tr")
      .findAll("td");
    expect(tableData[0].text()).toBe("01");
    expect(tableData[1].text()).toBe("Template2");
  });

  it("Should display add alert button", () => {
    expect(
      wrapper.find('[data-test="alert-template-list-add-alert-btn"]').text()
    ).toBe("Add Template");
  });

  it("Should move to add alerts page on clicking on add alert", async () => {
    const routerPush = vi.spyOn(router, "push");
    await wrapper
      .find('[data-test="alert-template-list-add-alert-btn"]')
      .trigger("click");
    expect(routerPush).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith({
      name: "alertTemplates",
      query: {
        action: "add",
        org_identifier: "default_organization_01",
      },
    });
  });

  describe("When user clicks on delete alert", () => {
    const template_name = "Template2";
    const deleteAlert = vi.spyOn(templateService, "delete");
    beforeEach(async () => {
      global.server.use(
        rest.delete(
          `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts/templates/${template_name}`,
          (req: any, res: any, ctx: any) => {
            return res(ctx.status(200), ctx.json({ code: 200 }));
          }
        )
      );
      global.server.use(
        rest.get(
          `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/templates`,
          (req: any, res: any, ctx: any) => {
            return res(
              ctx.status(200),
              ctx.json({
                list: [
                  {
                    name: "Template3",
                    body: '\r\n[\r\n  {\r\n    "labels": {\r\n        "alertname": "{alert_name}",\r\n        "stream": "{stream_name}",\r\n        "organization": "{org_name}",\r\n        "alerttype": "{alert_type}",\r\n        "severity": "critical"\r\n    },\r\n    "annotations": {\r\n        "timestamp": "{timestamp}"\r\n    }\r\n  }\r\n]',
                    isDefault: true,
                  },
                ],
              })
            );
          }
        )
      );
      await wrapper
        .find(
          `[data-test="alert-template-list-${template_name}-delete-template"]`
        )
        .trigger("click");
      const mainWrapper = new DOMWrapper(document.body);
      await mainWrapper.find('[data-test="confirm-button"]').trigger("click");
      await flushPromises();
    });

    it("Should delete alert from the list", () => {
      expect(deleteAlert).toHaveBeenCalledTimes(1);
    });
    it("Should refetch all alerts", () => {
      const tableRows = wrapper
        .find('[data-test="alert-templates-list-table"]')
        .find("thead")
        .findAll("tr");
      expect(tableRows.length).toBe(1);
      expect(tableRows[0].html()).not.toContain(template_name);
    });
  });
});
