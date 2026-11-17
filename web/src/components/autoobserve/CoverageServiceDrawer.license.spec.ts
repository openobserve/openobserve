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
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import { SIGNALS, type CoverageCell, type CoverageRow } from "./aoTypes";
import CoverageServiceDrawer from "./CoverageServiceDrawer.vue";

const watched: CoverageCell = { state: "watched" };
const row: CoverageRow = {
  service: "checkout",
  stream: "default",
  lastScanned: raw("1 min ago"),
  scannedMinutes: 1,
  cells: Object.fromEntries(SIGNALS.map((s) => [s, watched])) as CoverageRow["cells"],
  status: { state: "watched", label: raw("Watched") },
};
const stubs = {
  ODrawer: { template: "<div><slot name='header' /><slot /></div>" },
  CoverageMetricChart: true,
  CoverageSignalDetail: true,
};
const original = { ...store.state.zoConfig };

const mountDrawer = () =>
  mount(CoverageServiceDrawer, {
    props: {
      row,
      serviceStates: {},
      expanded: null,
      anchor: "",
      fix: null,
      message: "",
    },
    global: { plugins: [i18n, store, router], stubs },
  });

afterEach(() => {
  store.commit("setConfig", original);
  vi.restoreAllMocks();
});

describe("CoverageServiceDrawer — traces links", () => {
  it("opens Traces and the catalog while traces is enabled", async () => {
    const push = vi.spyOn(router, "push").mockResolvedValue(undefined);
    const wrapper = mountDrawer();
    await flushPromises();
    await wrapper.find('[data-test="autoobserve-coverage-drawer-traces"]').trigger("click");
    await wrapper.find('[data-test="autoobserve-coverage-drawer-catalog"]').trigger("click");
    expect(push).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: "traces",
        query: expect.objectContaining({ tab: "services-catalog" }),
      }),
    );
  });

  it("disables both links while traces is locked", async () => {
    store.commit("setConfig", { ...original, features: { traces: "locked" } });
    const push = vi.spyOn(router, "push").mockResolvedValue(undefined);
    const wrapper = mountDrawer();
    await flushPromises();
    for (const id of ["traces", "catalog"]) {
      const btn = wrapper.find(`[data-test="autoobserve-coverage-drawer-${id}"]`);
      expect(btn.attributes("disabled")).toBeDefined();
      await btn.trigger("click");
    }
    expect(push).not.toHaveBeenCalled();
  });
});
