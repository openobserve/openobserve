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

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({
  default: { listAudit: vi.fn() },
}));

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

  beforeEach(() => {
    queryClient.clear();
    vi.mocked(fleet.listAudit).mockResolvedValue({
      data: {
        items: [
          event(),
          event({ id: "a2", action: "fleet.audit.someFutureAction", target: "tok-1" }),
        ],
      },
    } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  async function mountAudit() {
    wrapper = mount(FleetAudit, { attachTo: document.body, global: { plugins: [i18n, store] } });
    await settle();
    return wrapper;
  }

  const auditText = (w: VueWrapper) => w.find('[data-test="fleet-audit-table"]').text();

  it("reads the audit rows from the API", async () => {
    await mountAudit();
    expect(fleet.listAudit).toHaveBeenCalledWith(store.state.selectedOrganization.identifier);
    expect(auditText(wrapper)).toContain("edge-minimal v1");
    expect(auditText(wrapper)).toContain("ana@acme.io");
  });
  it("says the audit trail needs O2_AUDIT_ENABLED when the server has it off", async () => {
    vi.mocked(fleet.listAudit).mockResolvedValue({
      data: { items: [], audit_disabled: true },
    } as any);
    await mountAudit();
    expect(auditText(wrapper)).toContain("O2_AUDIT_ENABLED");
  });
  it("files each row under its object and filters by it", async () => {
    wrapper = await mountAudit();
    expect(wrapper.find('[data-test="fleet-audit-kind-a1"]').text()).toBe("Configuration");
    expect(wrapper.find('[data-test="fleet-audit-kind-a2"]').text()).toBe("Other");
    wrapper
      .findComponent('[data-test="fleet-audit-kind-filter"]')
      .vm.$emit("update:modelValue", "token");
    await flushPromises();
    expect(wrapper.findAll("tbody tr").length).toBe(0);
    wrapper
      .findComponent('[data-test="fleet-audit-kind-filter"]')
      .vm.$emit("update:modelValue", "configuration");
    await flushPromises();
    expect(wrapper.findAll("tbody tr").map((tr) => tr.text())).toHaveLength(1);
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
    vi.mocked(fleet.listAudit).mockResolvedValue({ data: { items: [event()] } } as any);
    wrapper
      .find('[data-test="fleet-audit-error"]')
      .findComponent({ name: "OEmptyState" })
      .vm.$emit("action", "retry");
    await settle();
    expect(fleet.listAudit).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-test="fleet-audit-error"]').exists()).toBe(false);
  });
});
