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

  it("titles itself with the SECTION, so the peer tabs never move", () => {
    // All four alerting pages carry this identical string: the title block
    // sizes to its content, so a per-page title would shift the tab strip
    // horizontally on every navigation. The active tab says which page it is.
    expect(wrapper.find(".app-page-header h1").text()).toBe("Alerts");
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
    const listTemplates = vi.spyOn(templateService, "list");
    let listCallsBeforeDelete = 0;
    beforeEach(async () => {
      global.server.use(
        http.delete(
          `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts/templates/${template_name}`,
          () => {
            return HttpResponse.json({ code: 200 });
          },
        ),
      );
      listCallsBeforeDelete = listTemplates.mock.calls.length;

      // Click the delete button — only visible once skeleton is cleared (done in outer beforeEach).
      await wrapper
        .find(`[data-test="alert-template-list-${template_name}-delete-template"]`)
        .trigger("click");
      await flushPromises();

      // Confirm the deletion in the dialog.
      const mainWrapper = new DOMWrapper(document.body);
      await mainWrapper.find('[data-test="o-dialog-primary-btn"]').trigger("click");
      await flushPromises();
    });

    it("Should delete alert from the list", () => {
      expect(deleteAlert).toHaveBeenCalledTimes(1);
    });

    it("drops the deleted row in place, leaving the rest of the list alone", () => {
      // No refetch: reloading the list would blank the table behind its skeleton
      // and a loading toast for a row the server already confirmed gone.
      expect(listTemplates.mock.calls.length).toBe(listCallsBeforeDelete);
      const body = wrapper
        .find('[data-test="alert-templates-list-table"]')
        .find('[data-test="o2-table-body"]');
      expect(body.findAll("tr").length).toBe(2);
      expect(body.text()).not.toContain(template_name);
      expect(body.text()).toContain("Template3");
    });
  });
});
