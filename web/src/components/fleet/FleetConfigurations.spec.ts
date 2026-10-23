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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fleet from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import OTable from "@/lib/core/Table/OTable.vue";
import FleetConfigurations from "./FleetConfigurations.vue";
import { takePendingImport } from "./useFleetApi";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({ default: { listConfigs: vi.fn() } }));

const config = (over: Record<string, unknown> = {}) => ({
  id: "edge-minimal",
  description: "Edge devices",
  latest_version: 3,
  live_version: null,
  collectors: 0,
  fleets: [],
  updated_at: Date.now(),
  updated_by: "ana@acme.io",
  ...over,
});

const items = [
  config(),
  config({ id: "org-baseline", description: "Baseline", latest_version: 0 }),
];

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", name: "fleet", component: { template: "<div />" } },
    { path: "/fleet/configs/:id", name: "fleetConfigEditor", component: { template: "<div />" } },
  ],
});

// OTable holds its skeleton for a minimum time after loading ends.
const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 100));
  await flushPromises();
};

async function mountList() {
  await router.push({ path: "/", query: { org_identifier: "acme" } });
  const wrapper = mount(FleetConfigurations, {
    attachTo: document.body,
    global: { plugins: [i18n, router, store] },
  });
  await settle();
  return wrapper;
}

const bodyText = (w: VueWrapper) => w.find('[data-test="o2-table-body"]').text();

describe("FleetConfigurations", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(fleet.listConfigs).mockResolvedValue({ data: { items } } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("names the fleets whose desired version each configuration is, in place of groups", async () => {
    vi.mocked(fleet.listConfigs).mockResolvedValue({
      data: {
        items: [
          config({
            fleets: [
              { id: "f1", name: "edge" },
              { id: "f2", name: null },
            ],
          }),
        ],
      },
    } as any);
    wrapper = await mountList();
    const cell = wrapper.find('[data-test="fleet-configurations-fleets-edge-minimal"]');
    expect(cell.text()).toContain("edge");
    expect(cell.text()).toContain("Deleted fleet");
    expect(wrapper.text()).not.toContain("Groups");
  });

  it("counts the referencing fleets the viewer cannot see", async () => {
    vi.mocked(fleet.listConfigs).mockResolvedValue({
      data: { items: [config({ fleets: [{ id: "f1", name: "edge" }], fleets_hidden: 2 })] },
    } as any);
    wrapper = await mountList();
    expect(
      wrapper.find('[data-test="fleet-configurations-fleets-hidden-edge-minimal"]').text(),
    ).toBe("+2 you cannot view");
    expect(wrapper.text()).toContain("Used by fleets");
  });

  it("renders the rows the API returns", async () => {
    wrapper = await mountList();
    expect(fleet.listConfigs).toHaveBeenCalledWith(store.state.selectedOrganization.identifier);
    const text = bodyText(wrapper);
    expect(text).toContain("edge-minimal");
    expect(text).toContain("org-baseline");
    expect(text).toContain("v3");
  });

  it("searches the API rows by name", async () => {
    wrapper = await mountList();
    await wrapper.find('[data-test="fleet-configurations-search"] input').setValue("edge");
    await settle();
    expect(bodyText(wrapper)).toContain("edge-minimal");
    expect(bodyText(wrapper)).not.toContain("org-baseline");
  });

  it("opens the editor on a row click", async () => {
    wrapper = await mountList();
    const push = vi.spyOn(router, "push");
    const row = (wrapper.findComponent(OTable).props("data") as any[])[0];
    wrapper.findComponent(OTable).vm.$emit("row-click", row, new MouseEvent("click"));
    expect(push).toHaveBeenCalledWith({
      name: "fleetConfigEditor",
      params: { id: "edge-minimal" },
      query: { org_identifier: "acme" },
    });
    push.mockRestore();
  });

  it("keeps the org when creating a new config", async () => {
    wrapper = await mountList();
    const push = vi.spyOn(router, "push");
    (wrapper.vm as any).create();
    expect(push).toHaveBeenCalledWith({
      name: "fleetConfigEditor",
      params: { id: "new" },
      query: { org_identifier: "acme" },
    });
    push.mockRestore();
  });

  it("shows a dash for a config that was never published", async () => {
    wrapper = await mountList();
    expect(wrapper.find('[data-test="fleet-configurations-version-org-baseline"]').text()).toBe(
      "—",
    );
    expect(wrapper.find('[data-test="fleet-configurations-version-edge-minimal"]').text()).toBe(
      "v3",
    );
  });

  it("shows an error state with a retry when the list fails to load", async () => {
    vi.mocked(fleet.listConfigs).mockRejectedValue(new Error("boom"));
    wrapper = await mountList();
    await settle();
    const error = wrapper.find('[data-test="fleet-configurations-error"]');
    expect(error.exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-configurations-empty"]').exists()).toBe(false);
    vi.mocked(fleet.listConfigs).mockResolvedValue({ data: { items } } as any);
    error.findComponent({ name: "OEmptyState" }).vm.$emit("action", "retry");
    await settle();
    expect(fleet.listConfigs).toHaveBeenCalledTimes(2);
    expect(bodyText(wrapper)).toContain("edge-minimal");
  });

  it("has no Inherits column", async () => {
    wrapper = await mountList();
    expect(wrapper.find('th[data-test="o2-table-th-parent"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Inherits from");
  });

  it("imports a YAML file unchanged into the new-config editor", async () => {
    wrapper = await mountList();
    const replace = vi.spyOn(router, "push");
    const text = "receivers:\r\n  otlp: {} # keep me\r\n";
    const input = wrapper.find('[data-test="fleet-configurations-import-input"]');
    Object.defineProperty(input.element, "files", {
      value: [new File([text], "collector.yaml", { type: "application/yaml" })],
      configurable: true,
    });
    await input.trigger("change");
    await vi.waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        name: "fleetConfigEditor",
        params: { id: "new" },
        query: { org_identifier: "acme" },
      }),
    );
    expect(takePendingImport()).toBe(text);
    replace.mockRestore();
  });
});
