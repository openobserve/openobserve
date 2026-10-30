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

//! Exporting an SLO as JSON or Terraform.
//!
//! `GET /slos/{id}` answers with the definition FLATTENED alongside `status`,
//! its live measurement, plus counters the server assigns. An export is a
//! definition: a burn rate or an error budget reading is the SLO's current
//! behaviour, not part of what it is, and pasting one back in describes nothing.
//! So the payload handed to the dialog has to be stripped, which is what these
//! tests hold in place.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

vi.mock("@/services/slos", () => ({
  default: {
    list: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(),
    setEnabled: vi.fn(),
  },
}));

vi.mock("@/services/alerts", () => ({
  default: { list_by_slo: vi.fn() },
}));

import SloList from "@/views/slos/SloList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import sloService from "@/services/slos";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

const listRow = {
  id: "slo-123",
  name: "checkout-availability",
  enabled: true,
  target: 99.9,
  window_secs: 30 * 86400,
  slice_interval_secs: 300,
  tags: [],
  folder_id: "default",
  status: { sli: 99.95, error_budget_remaining: 0.6, burn_rate: 0.4, coverage: 1, no_data: false },
};

/** What the detail endpoint really returns: definition, measurement, counters. */
const detailPayload = {
  id: "slo-123",
  name: "checkout-availability",
  description: "Successful checkout requests",
  sli_type: "count",
  config: {
    source: {
      mode: "single_query",
      query: { stream: "app_logs", stream_type: "logs", good_expr: "status < 500" },
    },
  },
  window_secs: 30 * 86400,
  slice_interval_secs: 300,
  target: 99.9,
  enabled: true,
  folder_id: "default",
  definition_generation: 4,
  groups_estimate: 12,
  groups_reserved: 20,
  status: { sli: 99.95, error_budget_remaining: 0.6, burn_rate: 0.4, coverage: 1, no_data: false },
};

async function mountList() {
  vi.mocked(sloService.list).mockResolvedValue({ data: { list: [listRow] } } as any);

  const wrapper = mount(SloList, {
    attachTo: node,
    global: {
      plugins: [i18n, store, router],
      stubs: {
        FolderList: { template: '<div data-test="stub-folder-list"></div>' },
        SelectFolderDropDown: true,
        ODialog: true,
        ExportResourceDialog: true,
        IacRegistryLinks: true,
      },
    },
  });
  await flushPromises();
  await new Promise((r) => setTimeout(r, 75));
  await flushPromises();
  return wrapper;
}

const exportRow = async (wrapper: any) => {
  await wrapper.find('[data-test="slos-slolist-export-checkout-availability"]').trigger("click");
  await flushPromises();
};

describe("SloList export", () => {
  beforeEach(() => {
    vi.mocked(sloService.list).mockReset();
    vi.mocked(sloService.get).mockReset();
  });

  it("hands the dialog the definition, with the live measurement stripped", async () => {
    vi.mocked(sloService.get).mockResolvedValue({ data: detailPayload } as any);
    const wrapper: any = await mountList();

    await exportRow(wrapper);

    expect(wrapper.vm.exportDialog).toBe(true);
    const [exported] = wrapper.vm.slosToExport;

    // The definition survives.
    expect(exported.name).toBe("checkout-availability");
    expect(exported.sli_type).toBe("count");
    expect(exported.target).toBe(99.9);
    expect(exported.config).toBeTruthy();

    // The measurement and everything the server assigns does not.
    for (const key of [
      "status",
      "id",
      "definition_generation",
      "groups_estimate",
      "groups_reserved",
    ]) {
      expect(exported, `${key} leaked into the export`).not.toHaveProperty(key);
    }
  });

  it("converts the stripped payload into an openobserve_slo resource", async () => {
    vi.mocked(sloService.get).mockResolvedValue({ data: detailPayload } as any);
    const wrapper: any = await mountList();

    await exportRow(wrapper);

    const { hcl, unsupported } = wrapper.vm.slosTerraform;
    expect(unsupported).toEqual([]);
    expect(hcl).toContain('resource "openobserve_slo" "checkout_availability"');
    expect(hcl).toContain("count_sli {");
    // A reading has no place in a configuration file.
    expect(hcl).not.toContain("burn_rate");
    expect(hcl).not.toContain("definition_generation");
  });

  it("does not open the dialog when the definition cannot be read", async () => {
    vi.mocked(sloService.get).mockResolvedValue({ data: {} } as any);
    const wrapper: any = await mountList();

    await exportRow(wrapper);

    expect(wrapper.vm.exportDialog).toBe(false);
    expect(wrapper.vm.slosToExport).toEqual([]);
  });
});
