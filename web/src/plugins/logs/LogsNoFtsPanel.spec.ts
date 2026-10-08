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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import LogsNoFtsPanel from "./LogsNoFtsPanel.vue";

const mountPanel = (streams: { name: string; hasTextFields: boolean }[]) =>
  mount(LogsNoFtsPanel, {
    props: { streams },
    global: { plugins: [i18n], provide: { store } },
  });

describe("LogsNoFtsPanel (J3 with scan mode off)", () => {
  it("names the stream and offers only the configure card (AC3.1, spec 10 fallback)", async () => {
    const wrapper = mountPanel([{ name: "nofts_b", hasTextFields: true }]);
    const panel = wrapper.find('[data-test="logs-no-fts-panel"]');

    expect(panel.text()).toContain('"nofts_b" has no full-text fields');
    expect(panel.text()).toContain("Words are searched in full-text fields");
    expect(wrapper.find('[data-test="logs-no-fts-search-fields-btn"]').exists()).toBe(false);

    await wrapper.find('[data-test="logs-no-fts-configure-btn"]').trigger("click");
    expect(wrapper.emitted("configure")).toEqual([["nofts_b"]]);
  });

  it("says a stream has no text fields at all (AC3.7)", () => {
    const wrapper = mountPanel([{ name: "nofts_c", hasTextFields: false }]);
    expect(wrapper.text()).toContain("This stream has no text fields to search.");
    expect(wrapper.find('[data-test="logs-no-fts-configure-btn"]').exists()).toBe(true);
  });

  it("names streams with no text fields when several are blocked", () => {
    const wrapper = mountPanel([
      { name: "nofts_b", hasTextFields: true },
      { name: "nofts_c", hasTextFields: false },
    ]);
    expect(wrapper.text()).toContain("The selected streams have no full-text fields");
    expect(wrapper.find('[data-test="logs-no-fts-no-text-streams"]').text()).toBe(
      "Not searched: nofts_c (no text fields).",
    );
  });
});
