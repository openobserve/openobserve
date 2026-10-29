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

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import AnalyticsSessionsTable from "./AnalyticsSessionsTable.vue";

const ROW = {
  sid: "s1",
  step_t: 1790000000000,
  errors: 0,
  frustrations: 0,
  has_replay: 1,
  started: 1789999990000,
  ended: 1790000372000,
  user_label: "a@x.com",
  total: 1,
};

describe("AnalyticsSessionsTable", () => {
  let wrapper: VueWrapper | null = null;

  const mountTable = async (features: Record<string, string>) => {
    wrapper = mount(AnalyticsSessionsTable, {
      props: {
        rows: [ROW],
        total: 1,
        stepLabel: "/home",
        stepIndex: null,
        loadingMore: false,
        dataTestPrefix: "t",
      },
      global: {
        plugins: [
          i18n,
          createStore({ state: { zoConfig: { features }, timezone: "UTC", theme: "light" } }),
        ],
      },
      attachTo: document.body,
    });
    await flushPromises();
  };

  const clickRow = async () => {
    const row = wrapper!.find('[data-test="t-row-0"]').element.closest("tr");
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
  };

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("shows a lock instead of the open chevron and opens no session when rum is locked", async () => {
    await mountTable({ rum: "locked" });

    expect(wrapper!.find('[data-test="t-row-0-locked"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="t-row-0-open"]').exists()).toBe(false);
    await clickRow();
    expect(wrapper!.emitted("open")).toBeUndefined();
  });

  it("opens the session on row click when rum is enabled", async () => {
    await mountTable({ rum: "enabled" });

    expect(wrapper!.find('[data-test="t-row-0-open"]').exists()).toBe(true);
    await clickRow();
    expect(wrapper!.emitted("open")?.[0]).toEqual([ROW]);
  });
});
