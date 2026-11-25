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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, reactive } from "vue";

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: vi.fn(),
  useDashboardPanelData: vi.fn(),
}));

import ConfigPanel from "@/components/dashboards/addPanel/ConfigPanel.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { getDefaultDashboardPanelData } from "@/composables/dashboard/useDashboardPanelDefaults";
import { applyPanelConfigDefaults } from "@/utils/dashboard/panelConfigDefaults";

vi.setConfig({ testTimeout: 20000 });

// The server drops null fields, so a panel made in the UI comes back without them.
const withoutNulls = (value: any): any => {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, withoutNulls(v)]),
    );
  }
  return value;
};

const clone = (value: any) => JSON.parse(JSON.stringify(value));

describe("ConfigPanel mount-time defaults (#7454)", () => {
  let wrapper: any;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it.each(["line", "bar", "table", "custom_chart"])(
    "writes on open exactly what the editor's unsaved check fills in (%s)",
    async (type) => {
      const panel = getDefaultDashboardPanelData(store);
      panel.data = withoutNulls({ ...panel.data, id: "p1", type, title: "Saved" });
      const state = reactive(panel);
      vi.mocked(useDashboardPanelData).mockReturnValue({
        dashboardPanelData: state,
        promqlMode: false,
        isPivotMode: computed(() => false),
        selectedStreamFields: [],
      } as any);
      const beforeOpen = clone(state.data);

      wrapper = mount(ConfigPanel, {
        props: { variablesData: { values: [] }, panelData: {} },
        global: { plugins: [i18n, store], provide: { dashboardPanelDataPageKey: "dashboard" } },
      });
      await flushPromises();

      const afterOpen = clone(state.data);
      // Opening Config does write: this is what raised the leave dialog.
      expect(afterOpen).not.toEqual(beforeOpen);
      expect(afterOpen.config.legends_position).toBeNull();
      // Normalising the pre-open snapshot the same way leaves nothing to call an edit.
      const normalised = clone(beforeOpen);
      applyPanelConfigDefaults(normalised, store);
      expect(afterOpen).toEqual(normalised);
    },
  );
});
