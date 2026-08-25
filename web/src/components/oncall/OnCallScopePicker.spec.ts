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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OnCallScopePicker from "@/components/oncall/OnCallScopePicker.vue";
import i18n from "@/locales";

/// The selects are stubbed down to their options so a test can assert what was
/// offered — which is the whole point of this component — without driving a
/// listbox.
const stubs = {
  OToggleGroup: {
    name: "OToggleGroup",
    props: ["modelValue"],
    template: `<div data-test="modes"><slot /></div>`,
  },
  OToggleGroupItem: {
    name: "OToggleGroupItem",
    props: ["value"],
    template: `<button :data-value="value" @click="$parent.$emit('update:modelValue', value)"><slot name="icon-left" /><slot /></button>`,
  },
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options", "label"],
    template: `<div :data-label="label"><button
        v-for="option in options"
        :key="String(option.value)"
        :data-option="String(option.value)"
        :data-description="option.description || ''"
        @click="$emit('update:modelValue', option.value)"
      >{{ option.label }}</button></div>`,
  },
  OTooltip: { name: "OTooltip", template: "<span />" },
  OIcon: { name: "OIcon", template: "<i />" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  ODimensionChip: {
    name: "ODimensionChip",
    props: ["dimKey", "value"],
    template: `<span :data-chip="dimKey + '=' + value" />`,
  },
};

const SETS = [
  { id: "k8s", label: "Kubernetes", distinguish_by: ["k8s-cluster", "k8s-namespace"] },
];

const CATALOGUE = {
  present: ["k8s-cluster", "k8s-namespace"],
  values: {
    "k8s-cluster": { production: 48, "common-dev": 12 },
    "k8s-namespace": { payments: 6, search: 4 },
  },
};

const SERVICES = [
  { name: "payment-gateway", setId: "kubernetes", identity: { "k8s-cluster": "production" } },
  { name: "cart-svc", setId: "kubernetes", identity: {} },
];

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallScopePicker, {
    props: { sets: SETS, catalogue: CATALOGUE, services: SERVICES, ...props },
    global: { plugins: [i18n], stubs },
  });
}

function modes(wrapper: ReturnType<typeof render>) {
  return wrapper.findAll("[data-value]").map((node) => node.attributes("data-value"));
}

describe("OnCallScopePicker", () => {
  /// The ordering is not invented here — it is the org's own `distinguish_by`,
  /// which is what keeps this row and the backend's ranking from disagreeing
  /// about which of two rules is the narrower claim.
  it("offers levels coarsest first, from the identity set's own order", () => {
    const wrapper = render();

    expect(modes(wrapper)).toEqual(["k8s-cluster", "k8s-namespace", "service", "advanced"]);
  });

  /// The failure this component exists to remove. The registry files anything
  /// without a `service` dimension under its stream name, so a real estate has
  /// metric names and availability zones in it — none of which is a level
  /// anybody owns.
  it("never offers a level nothing has ever carried", () => {
    const wrapper = render({
      sets: [{ id: "k8s", label: "K8s", distinguish_by: ["k8s-cluster", "k8s-deployment"] }],
    });

    expect(modes(wrapper)).toContain("k8s-cluster");
    expect(modes(wrapper)).not.toContain("k8s-deployment");
  });

  it("claims a whole cluster as one dimension", async () => {
    const wrapper = render();

    await wrapper.find('[data-value="k8s-cluster"]').trigger("click");
    await wrapper.find('[data-option="production"]').trigger("click");

    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted?.at(-1)?.[0]).toEqual({ "k8s-cluster": "production" });
  });

  /// How broad the claim is, which is the one number somebody weighing a
  /// cluster-wide rule wants and had no way to get from a flat service list.
  it("says how much of the estate each value covers", () => {
    const wrapper = render();

    const option = wrapper.find('[data-option="production"]');
    expect(option.attributes("data-description")).toContain("48");
  });

  /// One team owns a service wherever it runs, far more often than it changes
  /// hands per cluster — so "everywhere" is the default, not a thing to find.
  it("claims a service everywhere unless narrowed", async () => {
    const wrapper = render();

    await wrapper.find('[data-value="service"]').trigger("click");
    await wrapper.find('[data-option="payment-gateway"]').trigger("click");

    expect(wrapper.emitted("update:modelValue")?.at(-1)?.[0]).toEqual({
      service: "payment-gateway",
    });
  });

  it("narrows a service to one enclosing scope when asked", async () => {
    const wrapper = render();

    await wrapper.find('[data-value="service"]').trigger("click");
    await wrapper.find('[data-option="payment-gateway"]').trigger("click");
    // The second select is the narrowing one; its "everywhere" entry is blank.
    const narrow = wrapper.findAll("[data-label]")[1];
    await narrow.find('[data-option="production"]').trigger("click");

    expect(wrapper.emitted("update:modelValue")?.at(-1)?.[0]).toEqual({
      "k8s-cluster": "production",
      service: "payment-gateway",
    });
  });

  /// A cluster name is not a namespace name. Carrying the value across would
  /// produce a rule claiming something nobody picked.
  it("drops the value when the level changes", async () => {
    const wrapper = render();

    await wrapper.find('[data-value="k8s-cluster"]').trigger("click");
    await wrapper.find('[data-option="production"]').trigger("click");
    await wrapper.find('[data-value="k8s-namespace"]').trigger("click");

    expect(wrapper.emitted("update:modelValue")?.at(-1)?.[0]).toEqual({});
  });

  it("hands off to the field builder when Advanced is chosen", async () => {
    const wrapper = render();

    await wrapper.find('[data-value="advanced"]').trigger("click");

    expect(wrapper.emitted("advanced")).toHaveLength(1);
  });

  /// Inheritance is the part of this model people get wrong, and the only
  /// honest place to state it is beside the claim being made.
  it("spells out what the claim leaves to narrower rules", async () => {
    const wrapper = render();

    await wrapper.find('[data-value="k8s-cluster"]').trigger("click");
    await wrapper.find('[data-option="production"]').trigger("click");

    const claim = wrapper.find('[data-test="oncall-scope-picker-consequence"]');
    expect(claim.text()).toContain("unless a narrower rule claims it");
  });

  /// A service beats a cluster in the engine's ranking, so the sentence beside
  /// it has to say so — otherwise the reader writes the rule and then wonders
  /// which of the two overlapping claims won.
  it("says a service claim holds against the scopes around it", async () => {
    const wrapper = render();

    await wrapper.find('[data-value="service"]').trigger("click");
    await wrapper.find('[data-option="payment-gateway"]').trigger("click");

    expect(wrapper.find('[data-test="oncall-scope-picker-consequence"]').text()).toContain(
      "whoever owns the ones around it",
    );
  });

  /// Opening an existing rule has to land on the level that rule claims, or the
  /// editor silently rewrites it to whatever the picker defaulted to.
  it("reads an existing claim back onto its own level", () => {
    const wrapper = render({ modelValue: { "k8s-namespace": "payments" } });

    const chips = wrapper.findAll("[data-chip]").map((node) => node.attributes("data-chip"));
    expect(chips).toEqual(["k8s-namespace=payments"]);
  });

  it("shows a service claim with its narrowing, coarsest chip first", () => {
    const wrapper = render({
      modelValue: { service: "payment-gateway", "k8s-cluster": "production" },
    });

    const chips = wrapper.findAll("[data-chip]").map((node) => node.attributes("data-chip"));
    expect(chips).toEqual(["k8s-cluster=production", "service=payment-gateway"]);
  });
});
