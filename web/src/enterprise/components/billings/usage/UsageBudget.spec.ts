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

import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { mockMeteringResponse } from "./meteringMock";

const getSettings = vi.fn();
const post = vi.fn();
vi.mock("@/services/organizations", () => ({
  default: {
    get_organization_settings: (...args: unknown[]) => getSettings(...args),
    post_organization_settings: (...args: unknown[]) => post(...args),
  },
}));
vi.mock("./useOrgCosts", async () => {
  const { ref } = await import("vue");
  return { useOrgCosts: () => ({ costs: ref({}), loading: ref(false), failed: ref(false) }) };
});

const { default: UsageBudget } = await import("./UsageBudget.vue");
const { default: UsageSuperBudget } = await import("./UsageSuperBudget.vue");

enableAutoUnmount(afterEach);

const details = mockMeteringResponse().upcoming!;
const billingOrgs = [
  { id: "payer", name: "Payer", isSelf: true },
  { id: "member-a", name: "Member A", isSelf: false },
];
// A super org keeps its overall budget under "total"; any other org under its own id.
const stored = {
  data: {
    data: {
      budget_config: [
        { org_id: "total", total_budget_amount: 500 },
        { org_id: store.state.selectedOrganization.identifier, total_budget_amount: 500 },
      ],
    },
  },
};

const byTestId = (wrapper: VueWrapper, name: string, id: string) =>
  wrapper.findAllComponents({ name }).find((c) => c.vm.$attrs["data-test"] === id)!;

// Save sends the whole list, so a list built without the stored one would erase it.
describe.each([
  { view: "UsageBudget", component: UsageBudget, prefix: "usagebudget", props: { details } },
  {
    view: "UsageSuperBudget",
    component: UsageSuperBudget,
    prefix: "usagesuperbudget",
    props: { details, billingOrgs },
  },
])("$view when the stored budgets are not loaded", ({ component, prefix, props }) => {
  const mountView = () => mount(component as any, { props, global: { plugins: [i18n, store] } });

  beforeEach(() => {
    getSettings.mockReset();
    post.mockReset().mockResolvedValue({ data: {} });
  });

  it("says so instead of showing an empty form, and loads them on Retry", async () => {
    getSettings.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValue(stored);
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.find(`[data-test="billings-${prefix}-error"]`).exists()).toBe(true);
    expect(wrapper.find(`[data-test="billings-${prefix}-root"]`).exists()).toBe(false);

    wrapper.findComponent({ name: "OEmptyState" }).vm.$emit("action");
    await flushPromises();
    expect(wrapper.find(`[data-test="billings-${prefix}-root"]`).exists()).toBe(true);
    expect(byTestId(wrapper, "OInput", `billings-${prefix}-total`).props("modelValue")).toBe(500);
  });

  it("does not save while they are still loading", async () => {
    getSettings.mockReturnValue(new Promise(() => {}));
    const wrapper = mountView();
    await flushPromises();

    byTestId(wrapper, "OInput", `billings-${prefix}-total`).vm.$emit("update:modelValue", 50);
    await flushPromises();
    const save = byTestId(wrapper, "OButton", `billings-${prefix}-save`);
    expect(save.props("disabled")).toBe(true);
    save.vm.$emit("click");
    await flushPromises();
    expect(post).not.toHaveBeenCalled();
  });
});
