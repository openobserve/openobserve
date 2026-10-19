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
        { org_id: "total", total_budget_amount: 500, warn_at_amount: 400, paused: false },
        {
          org_id: store.state.selectedOrganization.identifier,
          total_budget_amount: 500,
          warn_at_amount: 400,
          paused: false,
        },
        { org_id: "member-a", total_budget_amount: 100, warn_at_amount: 80, paused: false },
      ],
    },
  },
};

const byTestId = (wrapper: VueWrapper, name: string, id: string) =>
  wrapper.findAllComponents({ name }).find((c) => c.vm.$attrs["data-test"] === id)!;

// Save sends the whole list, so a list built without the stored one would erase it.
describe.each([
  {
    view: "UsageBudget",
    component: UsageBudget,
    prefix: "usagebudget",
    props: { details, projected: null },
  },
  {
    view: "UsageSuperBudget",
    component: UsageSuperBudget,
    prefix: "usagesuperbudget",
    props: { details, billingOrgs, projected: null },
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

// The budget job emails every admin each hour while spend is at or over the warn line, so $0 is never sent.
describe("an emptied Warn % field", () => {
  const savedFor = (orgId: string) =>
    post.mock.calls[0][1].budget_config.find((c: { org_id: string }) => c.org_id === orgId);

  beforeEach(() => {
    getSettings.mockReset().mockResolvedValue(stored);
    post.mockReset().mockResolvedValue({ data: {} });
  });

  it("keeps the org's warn line at its share when the budget is saved", async () => {
    const wrapper = mount(UsageBudget, {
      props: { details, projected: null },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();

    byTestId(wrapper, "OInput", "billings-usagebudget-warn-percent").vm.$emit(
      "update:modelValue",
      "",
    );
    byTestId(wrapper, "OInput", "billings-usagebudget-total").vm.$emit("update:modelValue", 600);
    await flushPromises();
    byTestId(wrapper, "OButton", "billings-usagebudget-save").vm.$emit("click");
    await flushPromises();

    expect(savedFor(store.state.selectedOrganization.identifier)).toMatchObject({
      total_budget_amount: 600,
      warn_at_amount: 480,
    });
  });

  it("keeps a member's warn line in the super org table", async () => {
    const wrapper = mount(UsageSuperBudget, {
      props: { details, billingOrgs, projected: null },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();

    byTestId(wrapper, "OInput", "billings-usagesuperbudget-warn-member-a").vm.$emit(
      "update:modelValue",
      "0",
    );
    byTestId(wrapper, "OInput", "billings-usagesuperbudget-budget-member-a").vm.$emit(
      "update:modelValue",
      200,
    );
    await flushPromises();
    byTestId(wrapper, "OButton", "billings-usagesuperbudget-save").vm.$emit("click");
    await flushPromises();

    expect(savedFor("member-a")).toMatchObject({ total_budget_amount: 200, warn_at_amount: 160 });
  });
});

describe("super org Budget saving", () => {
  beforeEach(() => {
    getSettings.mockReset().mockResolvedValue(stored);
  });

  it("keeps an edit typed while a save is running, as still unsaved", async () => {
    let finishSave!: (value: unknown) => void;
    post.mockReset().mockReturnValue(new Promise((resolve) => (finishSave = resolve)));
    const wrapper = mount(UsageSuperBudget, {
      props: { details, billingOrgs, projected: null },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();
    const budgetOf = (id: string) =>
      byTestId(wrapper, "OInput", `billings-usagesuperbudget-budget-${id}`);

    budgetOf("member-a").vm.$emit("update:modelValue", 200);
    await flushPromises();
    byTestId(wrapper, "OButton", "billings-usagesuperbudget-save").vm.$emit("click");
    await flushPromises();

    // The payer's budget changes before the save comes back.
    budgetOf("payer").vm.$emit("update:modelValue", 300);
    finishSave({ data: {} });
    await flushPromises();

    expect(budgetOf("payer").props("modelValue")).toBe(300);
    expect(budgetOf("member-a").props("modelValue")).toBe(200);
    const bar = wrapper.find('[data-test="billings-usagesuperbudget-savebar"]').text();
    expect(bar).not.toContain("All changes saved");
  });

  it("reads All changes saved after a save, with no draft left pending", async () => {
    post.mockReset().mockResolvedValue({ data: {} });
    const wrapper = mount(UsageSuperBudget, {
      props: { details, billingOrgs, projected: null },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();

    byTestId(wrapper, "OInput", "billings-usagesuperbudget-budget-member-a").vm.$emit(
      "update:modelValue",
      150,
    );
    byTestId(wrapper, "OInput", "billings-usagesuperbudget-warn-member-a").vm.$emit(
      "update:modelValue",
      "33.3",
    );
    await flushPromises();
    byTestId(wrapper, "OButton", "billings-usagesuperbudget-save").vm.$emit("click");
    await flushPromises();

    const bar = wrapper.find('[data-test="billings-usagesuperbudget-savebar"]').text();
    expect(bar).toContain("All changes saved");
  });
});

describe("Budget Save after a one-cent change", () => {
  beforeEach(() => {
    getSettings.mockReset().mockResolvedValue(stored);
  });

  it("turns Save on when the warn amount moves by one cent", async () => {
    const wrapper = mount(UsageBudget, {
      props: { details, projected: null },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();
    const save = () => byTestId(wrapper, "OButton", "billings-usagebudget-save");
    expect(save().props("disabled")).toBe(true);

    // Saved at $400.00; 400.01 - 400 is 0.00999… in floating point.
    byTestId(wrapper, "OInput", "billings-usagebudget-warn-amount").vm.$emit(
      "update:modelValue",
      "400.01",
    );
    await flushPromises();
    expect(save().props("disabled")).toBe(false);
  });
});

describe("Budget removal on the single-org tab", () => {
  beforeEach(() => {
    getSettings.mockReset().mockResolvedValue(stored);
    post.mockReset().mockResolvedValue({ data: {} });
  });

  it("saves a cleared amount as a removal, leaving every other org's budget", async () => {
    const wrapper = mount(UsageBudget, {
      props: { details, projected: null },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();

    byTestId(wrapper, "OInput", "billings-usagebudget-total").vm.$emit("update:modelValue", "");
    await flushPromises();
    const save = byTestId(wrapper, "OButton", "billings-usagebudget-save");
    expect(save.props("disabled")).toBe(false);
    save.vm.$emit("click");
    await flushPromises();

    const sent = post.mock.calls[0][1].budget_config as { org_id: string }[];
    // Gone, not stored as $0, which the hourly budget job would treat as always crossed.
    expect(sent.map((entry) => entry.org_id)).not.toContain(
      store.state.selectedOrganization.identifier,
    );
    expect(sent.map((entry) => entry.org_id)).toEqual(["total", "member-a"]);
  });
});
