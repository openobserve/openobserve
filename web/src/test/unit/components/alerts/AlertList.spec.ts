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
import AlertList from "@/components/alerts/AlertList.vue";
import i18n from "@/locales";
import store from "../../helpers/store";
import { rest } from "msw";
import AlertService from "@/services/alerts";
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
    wrapper = mount(AlertList, {
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
    expect(wrapper.find('[data-test="alerts-list-title"]').text()).toBe(
      "Alerts"
    );
  });
  it("Should reder table with alerts", () => {
    expect(
      wrapper.find('[data-test="alert-list-table"]').exists()
    ).toBeTruthy();
  });

  it("Should display table column headers", async () => {
    await flushPromises();
    const tableData = wrapper
      .find('[data-test="alert-list-table"]')
      .find("thead")
      .find("tr")
      .findAll("th");
    expect(tableData[0].text()).toBe("#");
    expect(tableData[1].text()).toContain("Name");
    expect(tableData[2].text()).toContain("Stream Type");
    expect(tableData[3].text()).toContain("Stream Name");
    expect(tableData[4].text()).toContain("Query");
    expect(tableData[5].text()).toContain("Condition");
    expect(tableData[6].text()).toContain("Destination");
    expect(tableData[7].text()).toContain("Actions");
  });

  it("Should display table row data", async () => {
    await flushPromises();
    const tableData = wrapper
      .find('[data-test="alert-list-table"]')
      .find("tbody")
      .find("tr")
      .findAll("td");
    expect(tableData[0].text()).toBe("01");
    expect(tableData[1].text()).toBe("alert1");
    expect(tableData[2].text()).toContain("logs");
    expect(tableData[3].text()).toBe("default");
    expect(tableData[4].text()).toBe("--");
    expect(tableData[5].text()).toBe("code EqualTo 500");
    expect(tableData[6].text()).toBe("dest1");
  });

  it("Should display add alert button", () => {
    expect(wrapper.find('[data-test="alert-list-add-alert-btn"]').text()).toBe(
      "Add alert"
    );
  });
  it("Should move to add alerts page on clicking on add alert", async () => {
    const routerPush = vi.spyOn(router, "push");
    await wrapper
      .find('[data-test="alert-list-add-alert-btn"]')
      .trigger("click");
    expect(routerPush).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith({
      name: "alertList",
      query: {
        action: "add",
        org_identifier: "default_organization_01",
      },
    });
  });

  describe("When user clicks on edit alert", () => {
    const stream_name = "default";
    const alert_name = "alert1";
    const deleteAlert = vi.spyOn(AlertService, "delete");
    beforeEach(async () => {
      global.server.use(
        rest.delete(
          `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/${stream_name}/alerts/${alert_name}`,
          (req, res, ctx) => {
            return res(ctx.status(200), ctx.json({ code: 200 }));
          }
        )
      );
      global.server.use(
        rest.get(
          `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts`,
          (req, res, ctx) => {
            return res(
              ctx.status(200),
              ctx.json({
                list: [
                  {
                    name: "alert2",
                    stream: "default",
                    query: {
                      sql: "select * from  'default'",
                      from: 0,
                      size: 100,
                      start_time: 0,
                      end_time: 0,
                      sql_mode: "full",
                      query_type: "",
                      track_total_hits: false,
                    },
                    condition: {
                      column: "code",
                      operator: "EqualTo",
                      ignoreCase: null,
                      value: 500,
                      isNumeric: null,
                    },
                    duration: 1,
                    frequency: 2,
                    time_between_alerts: 2,
                    destination: "dest1",
                    is_real_time: false,
                  },
                ],
              })
            );
          }
        )
      );
      await wrapper
        .find(`[data-test=alert-list-${alert_name}-delete-alert]`)
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
        .find('[data-test="alert-list-table"]')
        .find("thead")
        .findAll("tr");
      expect(tableRows.length).toBe(1);
      expect(tableRows[0].html()).not.toContain(alert_name);
    });
  });
});
