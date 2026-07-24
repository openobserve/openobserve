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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises, DOMWrapper } from "@vue/test-utils";
import TemplateList from "./TemplateList.vue";
import { http, HttpResponse } from "msw";
import templateService from "@/services/alert_templates";
import router from "@/test/unit/helpers/router";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// OTable holds the skeleton visible for MIN_SKELETON_MS = 2000ms via setTimeout.
// Use fake timers so we can advance past that hold without real waits.
const SKELETON_HOLD_MS = 2100;

describe("Alert List", async () => {
  let wrapper: any;
  beforeEach(async () => {
    // Install fake timers before mounting so OTable's skeleton-hold setTimeout
    // is registered as a fake timer. Only fake setTimeout/clearTimeout/Date to
    // keep MSW's fetch/http machinery on real timers.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });

    wrapper = mount(TemplateList, {
      attachTo: "#app",
      global: {
        provide: {
          store: store,
        },
        plugins: [i18n, router],
      },
    });

    // Let MSW respond and the component finish its initial data fetch.
    await flushPromises();
    // Advance past OTable's 2-second skeleton hold timer so real rows are visible.
    vi.advanceTimersByTime(SKELETON_HOLD_MS);
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("Should render alerts title", () => {
    // Title now lives in the standard OPageHeader (row 1).
    expect(wrapper.find(".app-page-header h1").text()).toBe("Templates");
  });

  it("Should reder table with templates", () => {
    expect(wrapper.find('[data-test="alert-templates-list-table"]').exists()).toBeTruthy();
  });

  it("Should display table column headers", async () => {
    const tableData = wrapper
      .find('[data-test="alert-templates-list-table"]')
      .find("thead")
      .find("tr")
      .findAll("th");
    // Index 0 is the checkbox column, so actual columns start at index 1
    expect(tableData[1].text()).toBe("#");
    expect(tableData[2].text()).toContain("Name");
    // Action column headers are rendered empty by OTable for isAction columns
    expect(tableData[3].exists()).toBe(true);
  });

  it("Should display table row data", async () => {
    // Target the real data tbody (not the skeleton tbody).
    const tableData = wrapper
      .find('[data-test="alert-templates-list-table"]')
      .find('[data-test="o2-table-body"]')
      .find("tr")
      .findAll("td");
    // Index 0 is the checkbox cell; actual data cells start at index 1.
    expect(tableData[1].text()).toBe("01");
    // The Name cell now includes a Prebuilt/Custom badge next to the name,
    // so concat'd text() ends with the badge label (e.g. "Template2Custom").
    expect(tableData[2].text()).toContain("Template2");
  });

  describe("When user clicks on delete alert", () => {
    const template_name = "Template2";
    const deleteAlert = vi.spyOn(templateService, "delete");
    beforeEach(async () => {
      global.server.use(
        http.delete(
          `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts/templates/${template_name}`,
          () => {
            return HttpResponse.json({ code: 200 });
          },
        ),
      );
      // Override the templates list to return only Template3 after deletion.
      // The service returns res.data which axios maps to the raw response body,
      // so the array must be returned directly (not wrapped in { list: [...] }).
      global.server.use(
        http.get(
          `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts/templates`,
          () => {
            return HttpResponse.json([
              {
                name: "Template3",
                body: '\r\n[\r\n  {\r\n    "labels": {\r\n        "alertname": "{alert_name}",\r\n        "stream": "{stream_name}",\r\n        "organization": "{org_name}",\r\n        "alerttype": "{alert_type}",\r\n        "severity": "critical"\r\n    },\r\n    "annotations": {\r\n        "timestamp": "{timestamp}"\r\n    }\r\n  }\r\n]',
                isDefault: true,
              },
            ]);
          },
        ),
      );

      // Click the delete button — only visible once skeleton is cleared (done in outer beforeEach).
      await wrapper
        .find(`[data-test="alert-template-list-${template_name}-delete-template"]`)
        .trigger("click");
      await flushPromises();

      // Confirm the deletion in the dialog.
      const mainWrapper = new DOMWrapper(document.body);
      await mainWrapper.find('[data-test="o-dialog-primary-btn"]').trigger("click");
      await flushPromises();

      // Advance past the skeleton hold timer triggered by the refetch.
      vi.advanceTimersByTime(SKELETON_HOLD_MS);
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
