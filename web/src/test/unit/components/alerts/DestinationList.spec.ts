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
import DestinationList from "@/components/alerts/DestinationList.vue";
import i18n from "@/locales";
import store from "../../helpers/store";
import routes from "@/router/routes";
import { createRouter, createWebHistory } from "vue-router";
import { rest } from "msw";
import destinationService from "@/services/alert_destination";

const router = createRouter({
  history: createWebHistory(),
  routes,
});

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
    wrapper = mount(DestinationList, {
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
      wrapper.find('[data-test="alert-destinations-list-title"]').text()
    ).toBe("Destinations");
  });
  it("Should reder table with templates", () => {
    expect(
      wrapper.find('[data-test="alert-destinations-list-table"]').exists()
    ).toBeTruthy();
  });

  it("Should display table column headers", async () => {
    await flushPromises();
    const tableData = wrapper
      .find('[data-test="alert-destinations-list-table"]')
      .find("thead")
      .find("tr")
      .findAll("th");
    expect(tableData[0].text()).toBe("#");
    expect(tableData[1].text()).toContain("Name");
    expect(tableData[2].text()).toContain("URL");
    expect(tableData[3].text()).toContain("Method");
    expect(tableData[4].text()).toContain("Actions");
  });

  it("Should display table row data", async () => {
    await flushPromises();
    const tableData = wrapper
      .find('[data-test="alert-destinations-list-table"]')
      .find("tbody")
      .find("tr")
      .findAll("td");
    expect(tableData[0].text()).toBe("01");
    expect(tableData[1].text()).toBe("dest1");
    expect(tableData[2].text()).toBe("abc");
    expect(tableData[3].text()).toBe("post");
  });

  it("Should display add destination button", () => {
    expect(
      wrapper.find('[data-test="alert-destination-list-add-alert-btn"]').text()
    ).toBe("Add Destination");
  });

  it("Should move to add alerts page on clicking on add alert", async () => {
    const routerPush = vi.spyOn(router, "push");
    await wrapper
      .find('[data-test="alert-destination-list-add-alert-btn"]')
      .trigger("click");
    expect(routerPush).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith({
      name: "alertDestinations",
      query: {
        action: "add",
        org_identifier: "default_organization_01",
      },
    });
  });

  describe("When user clicks on delete alert", () => {
    const destination_name = "dest1";
    const deleteDestination = vi.spyOn(destinationService, "delete");
    beforeEach(async () => {
      global.server.use(
        rest.delete(
          `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts/destinations/${destination_name}`,
          (req, res, ctx) => {
            return res(ctx.status(200), ctx.json({ code: 200 }));
          }
        )
      );
      global.server.use(
        rest.get(
          `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/destinations`,
          (req, res, ctx) => {
            return res(
              ctx.status(200),
              ctx.json({
                list: [
                  {
                    name: "dest2",
                    url: "https://join.slack.com/share/enQtNTAyMDAzNDY",
                    method: "post",
                    headers: {},
                    template: {
                      name: "Template3",
                      body: '\r\n[\r\n  {\r\n    "labels": {\r\n        "alertname": "{alert_name}",\r\n        "stream": "{stream_name}",\r\n        "organization": "{org_name}",\r\n        "alerttype": "{alert_type}",\r\n        "severity": "critical"\r\n    },\r\n    "annotations": {\r\n        "timestamp": "{timestamp}"\r\n    }\r\n  }\r\n]',
                      isDefault: true,
                    },
                  },
                ],
              })
            );
          }
        )
      );
      await wrapper
        .find(
          `[data-test="alert-destination-list-${destination_name}-delete-destination"]`
        )
        .trigger("click");
      const mainWrapper = new DOMWrapper(document.body);
      await mainWrapper.find('[data-test="confirm-button"]').trigger("click");
      await flushPromises();
    });

    it("Should delete alert from the list", () => {
      expect(deleteDestination).toHaveBeenCalledTimes(1);
    });
    it("Should refetch all alerts", () => {
      const tableRows = wrapper
        .find('[data-test="alert-destinations-list-table"]')
        .find("thead")
        .findAll("tr");
      expect(tableRows.length).toBe(1);
      expect(tableRows[0].html()).not.toContain(destination_name);
    });
  });
});
