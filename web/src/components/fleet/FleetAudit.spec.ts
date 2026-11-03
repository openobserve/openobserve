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

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fleet from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import FleetAudit from "./FleetAudit.vue";
import { apiFleet } from "./fleet.fixtures";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({
  default: { listAudit: vi.fn(), listFleets: vi.fn() },
}));

const DAY_MS = 86_400_000;

const event = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  at: Date.now(),
  actor: "ana@acme.io",
  action: "fleet.audit.publishedVersion",
  target: "edge-minimal v1",
  outcome: "success",
  ...over,
});

const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 100));
  await flushPromises();
};

describe("FleetAudit", () => {
  let wrapper: VueWrapper;
  const org = () => store.state.selectedOrganization.identifier;
  const lastParams = () => vi.mocked(fleet.listAudit).mock.calls.at(-1)?.[1] as any;

  beforeEach(() => {
    queryClient.clear();
    vi.mocked(fleet.listAudit).mockResolvedValue({
      data: {
        total: 120,
        items: [
          event(),
          event({ id: "a2", action: "fleet.audit.someFutureAction", target: "tok-1" }),
        ],
      },
    } as any);
    vi.mocked(fleet.listFleets).mockResolvedValue({
      data: {
        items: [
          apiFleet({ id: "prod", name: "Production" }),
          apiFleet({ id: "hidden", name: "Hidden", state: null }),
        ],
        total: 2,
      },
    } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  async function mountAudit() {
    wrapper = mount(FleetAudit, {
      attachTo: document.body,
      global: { plugins: [i18n, store], stubs: { DateTime: true } },
    });
    await settle();
    return wrapper;
  }

  const auditText = (w: VueWrapper) => w.find('[data-test="fleet-audit-table"]').text();
  const pick = async (testId: string, value: unknown) => {
    wrapper.findComponent(`[data-test="${testId}"]`).vm.$emit("update:modelValue", value);
    await settle();
  };

  it("reads the first page of the last 30 days from the API", async () => {
    const before = Date.now();
    await mountAudit();
    const after = Date.now();
    expect(fleet.listAudit).toHaveBeenCalledTimes(1);
    const [orgId, params] = vi.mocked(fleet.listAudit).mock.calls[0] as any;
    expect(orgId).toBe(org());
    expect(params).toMatchObject({ offset: 0, limit: 50 });
    expect(params.from).toBeGreaterThanOrEqual(before - 30 * DAY_MS);
    expect(params.from).toBeLessThanOrEqual(after - 30 * DAY_MS);
    expect(params.to).toBeUndefined();
    expect(params).not.toHaveProperty("fleet");
    expect(params).not.toHaveProperty("module");
    expect(auditText(wrapper)).toContain("edge-minimal v1");
    expect(auditText(wrapper)).toContain("ana@acme.io");
  });

  it("pages on the server with the total the response reports", async () => {
    await mountAudit();
    const table = wrapper.findComponent({ name: "OTable" });
    expect(table.props("pagination")).toBe("server");
    expect(table.props("totalCount")).toBe(120);
    expect(wrapper.find('[data-test="o2-table-pagination-info"]').text()).toContain("120");
    await wrapper.find('[data-test="o2-table-next-page-btn"]').trigger("click");
    await settle();
    expect(lastParams()).toMatchObject({ offset: 50, limit: 50 });
    expect(table.props("currentPage")).toBe(2);
  });

  it("sends the module filter and goes back to the first page", async () => {
    await mountAudit();
    await wrapper.find('[data-test="o2-table-next-page-btn"]').trigger("click");
    await settle();
    expect(lastParams().offset).toBe(50);
    await pick("fleet-audit-module-filter", "configs");
    expect(lastParams()).toMatchObject({ offset: 0, module: "configs" });
    expect(wrapper.findComponent({ name: "OTable" }).props("currentPage")).toBe(1);
  });

  it("offers only the fleets the caller can read and sends the one picked", async () => {
    await mountAudit();
    const options = wrapper
      .findComponent('[data-test="fleet-audit-fleet-filter"]')
      .props("options") as { label: string; value: string }[];
    expect(options.map((o) => o.value)).toEqual(["prod"]);
    await pick("fleet-audit-fleet-filter", "prod");
    expect(lastParams()).toMatchObject({ offset: 0, fleet: "prod" });
  });

  it("searches the actor and target on the server from the first page", async () => {
    vi.mocked(fleet.listAudit).mockImplementation(async (_org, params: any) => ({
      data: { total: 120, items: [event({ target: `q:${params.q ?? "none"}` })] },
    }));
    await mountAudit();
    await wrapper.find('[data-test="o2-table-next-page-btn"]').trigger("click");
    await settle();
    await pick("fleet-audit-search", "  web-1 ");
    expect(lastParams()).toMatchObject({ offset: 0, q: "web-1" });
    expect(auditText(wrapper)).toContain("q:web-1");
    await pick("fleet-audit-search", " ");
    expect(auditText(wrapper)).toContain("q:none");
  });

  it("has no actor filter and keeps the period beside the refresh button", async () => {
    await mountAudit();
    expect(wrapper.find('[data-test="fleet-audit-actor-filter"]').exists()).toBe(false);
    const trailing = wrapper.find('[data-test="fleet-audit-toolbar-trailing"]');
    expect(trailing.find('[data-test="fleet-audit-range"]').exists()).toBe(true);
    expect(trailing.find('[data-test="fleet-audit-refresh"]').exists()).toBe(true);
  });

  it("narrows the period to a shorter preset", async () => {
    await mountAudit();
    const before = Date.now();
    await pick("fleet-audit-range", "24h");
    expect(lastParams().from).toBeGreaterThanOrEqual(before - DAY_MS);
    expect(lastParams().offset).toBe(0);
  });

  it("sends a custom period in epoch milliseconds", async () => {
    await mountAudit();
    await pick("fleet-audit-range", "custom");
    wrapper
      .findComponent('[data-test="fleet-audit-date-picker"]')
      .vm.$emit("on:date-change", { startTime: 1_000_000_000, endTime: 2_000_000_000 });
    await settle();
    expect(lastParams()).toMatchObject({ offset: 0, from: 1_000_000, to: 2_000_000 });
  });

  it("says the audit trail needs O2_AUDIT_ENABLED when the server has it off", async () => {
    vi.mocked(fleet.listAudit).mockResolvedValue({
      data: { total: 0, items: [], audit_disabled: true },
    } as any);
    await mountAudit();
    expect(auditText(wrapper)).toContain("O2_AUDIT_ENABLED");
  });

  it("says entries arrive with the audit publish interval when the trail is empty", async () => {
    vi.mocked(fleet.listAudit).mockResolvedValue({ data: { total: 0, items: [] } } as any);
    await mountAudit();
    expect(auditText(wrapper)).toContain("O2_AUDIT_PUBLISH_INTERVAL");
  });

  it("clears every filter from the filtered empty state", async () => {
    vi.mocked(fleet.listAudit).mockImplementation(async (_org, params: any) => ({
      data: { total: params.module ? 0 : 1, items: params.module ? [] : [event()] },
    }));
    await mountAudit();
    await pick("fleet-audit-module-filter", "tokens");
    expect(lastParams()).toMatchObject({ module: "tokens" });
    const empty = wrapper.findComponent({ name: "OEmptyState" });
    expect(empty.props("filtered")).toBe(true);
    empty.vm.$emit("action", "clear-filters");
    await settle();
    expect(auditText(wrapper)).toContain("edge-minimal v1");
    expect(
      wrapper.findComponent('[data-test="fleet-audit-module-filter"]').props("modelValue"),
    ).toBe(null);
  });

  it("files each row under its object", async () => {
    wrapper = await mountAudit();
    expect(wrapper.find('[data-test="fleet-audit-kind-a1"]').text()).toBe("Configuration");
    expect(wrapper.find('[data-test="fleet-audit-kind-a2"]').text()).toBe("Other");
  });

  it("translates a known action key and shows an unknown one raw", async () => {
    await mountAudit();
    expect(auditText(wrapper)).toContain("Published version");
    expect(auditText(wrapper)).toContain("fleet.audit.someFutureAction");
  });

  it("shows the audit load error with a retry when it fails", async () => {
    vi.mocked(fleet.listAudit).mockRejectedValue(new Error("boom"));
    await mountAudit();
    expect(wrapper.find('[data-test="fleet-audit-error"]').exists()).toBe(true);
    vi.mocked(fleet.listAudit).mockResolvedValue({ data: { total: 1, items: [event()] } } as any);
    wrapper
      .find('[data-test="fleet-audit-error"]')
      .findComponent({ name: "OEmptyState" })
      .vm.$emit("action", "retry");
    await settle();
    expect(fleet.listAudit).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-test="fleet-audit-error"]').exists()).toBe(false);
  });
});
