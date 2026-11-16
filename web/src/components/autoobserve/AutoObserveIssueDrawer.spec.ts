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

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import AutoObserveIssueDrawer from "./AutoObserveIssueDrawer.vue";

describe("AutoObserveIssueDrawer for a live incident", () => {
  const liveItem = {
    finding: {
      id: "f1",
      kind: "stream_silence",
      stream_type: "logs",
      stream_name: "pay_api",
      first_seen_at: Date.UTC(2026, 10, 10, 16, 45) * 1000,
    },
    incident: {
      id: "V5wPnqa6c0qfMLxGTdrwcF68Xq8",
      status: "open" as const,
      severity: "P2" as const,
      title: "pay_api (logs) stopped sending data",
      created_at: Date.UTC(2026, 10, 10, 16, 46) * 1000,
    },
    investigation: {
      run_id: null,
      state: null,
      outcome: null,
      summary: null,
      not_run_reason: null,
    },
  };

  it("opens the live body, titles it in words and keeps the incident page one click away", async () => {
    const push = vi.spyOn(router, "push").mockResolvedValue(undefined);
    const wrapper = mount(AutoObserveIssueDrawer, {
      props: { open: true, liveItem, liveTab: "analysis" },
      global: {
        plugins: [i18n, store, router],
        stubs: {
          ODrawer: {
            props: ["title", "subTitle"],
            template:
              "<div><h1 data-test='t'>{{ title }}</h1><p data-test='s'>{{ subTitle }}</p><slot name='header-right' /><slot /></div>",
          },
          LiveIssueBody: {
            name: "LiveIssueBody",
            props: ["item", "initialTab"],
            template: "<div data-test='body' />",
          },
        },
      },
    });
    await flushPromises();
    expect(wrapper.get("[data-test='t']").text()).toBe("pay_api (logs) stopped sending data");
    expect(wrapper.get("[data-test='s']").text()).toMatch(/^V5wPnqa6 · /);
    const body = wrapper.findComponent({ name: "LiveIssueBody" });
    expect(body.props("initialTab")).toBe("analysis");
    await wrapper.get("[data-test='autoobserve-issue-open-incident']").trigger("click");
    expect(push).toHaveBeenCalledWith({
      name: "incidentDetail",
      params: { id: "V5wPnqa6c0qfMLxGTdrwcF68Xq8" },
      query: { org_identifier: store.state.selectedOrganization.identifier },
    });
    push.mockRestore();
    wrapper.unmount();
  });
});
