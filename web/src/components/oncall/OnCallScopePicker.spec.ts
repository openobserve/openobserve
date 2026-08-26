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

/// Selects render their options as buttons so a test can assert what was
/// offered — the point of this component — without driving a listbox.
const stubs = {
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options"],
    template: `<div :data-test="$attrs['data-test']" :data-value="modelValue"><button
        v-for="option in options"
        :key="String(option.value)"
        :data-option="String(option.value)"
        @click="$emit('update:modelValue', option.value)"
      >{{ option.label }}</button></div>`,
  },
  OButton: {
    name: "OButton",
    template: `<button :data-test="$attrs['data-test']" @click="$emit('click')"><slot /></button>`,
  },
  OIcon: { name: "OIcon", template: "<i />" },
  OText: { name: "OText", template: "<span><slot /></span>" },
};

const K8S = { id: "k8s", label: "Kubernetes", distinguish_by: ["k8s-cluster", "k8s-namespace"] };
const AWS = { id: "aws", label: "AWS", distinguish_by: ["ecs-task"] };

const CATALOGUE = {
  present: ["k8s-cluster", "k8s-namespace", "ecs-task"],
  values: {
    "k8s-cluster": { production: 48, "common-dev": 12 },
    "k8s-namespace": { payments: 6, search: 4, checkout: 3 },
    "ecs-task": { billing: 2 },
  },
};

const SERVICES = [
  { name: "payment-gateway", setId: "kubernetes", identity: { "k8s-cluster": "production" } },
  { name: "cart-svc", setId: "kubernetes", identity: {} },
];

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallScopePicker, {
    props: { sets: [K8S], catalogue: CATALOGUE, services: SERVICES, ...props },
    global: { plugins: [i18n], stubs },
  });
}

function path(wrapper: ReturnType<typeof render>) {
  return wrapper
    .findAll('[data-test^="oncall-scope-segment-"]')
    .map((node) => node.attributes("data-test")!.replace("oncall-scope-segment-", ""));
}

function pick(wrapper: ReturnType<typeof render>, dimension: string, value: string) {
  return wrapper
    .find(`[data-test="oncall-scope-segment-${dimension}"] [data-option="${value}"]`)
    .trigger("click");
}

function lastEmit(wrapper: ReturnType<typeof render>) {
  return wrapper.emitted("update:modelValue")?.at(-1)?.[0];
}

describe("OnCallScopePicker", () => {
  /// The order is the org's own `distinguish_by`, which is what keeps this row
  /// and the backend's precedence from disagreeing about which rule is narrower.
  it("draws the path coarsest first, with service last", () => {
    expect(path(render())).toEqual(["k8s-cluster", "k8s-namespace", "service"]);
  });

  /// A dimension nothing has ever carried describes a platform this deployment
  /// does not run. Offering it can only produce a path that matches nothing.
  it("leaves out a segment nothing has ever carried", () => {
    const wrapper = render({
      sets: [{ id: "k8s", label: "K8s", distinguish_by: ["k8s-cluster", "k8s-deployment"] }],
    });
    expect(path(wrapper)).toEqual(["k8s-cluster", "service"]);
  });

  it("every segment starts on Any, so a fresh rule claims nothing", () => {
    const wrapper = render();
    const values = wrapper
      .findAll('[data-test^="oncall-scope-segment-"]')
      .map((node) => node.attributes("data-value"));
    expect(values).toEqual(["", "", ""]);
    expect(wrapper.find('[data-test="oncall-scope-picker-empty"]').exists()).toBe(true);
  });

  it("claims a whole cluster from one segment", async () => {
    const wrapper = render();
    await pick(wrapper, "k8s-cluster", "production");
    expect(lastEmit(wrapper)).toEqual({ "k8s-cluster": "production" });
  });

  /// The case a path expresses and three dropdowns could not: a hole in the
  /// middle. `Any` namespace is visibly a gap the rule does not care about.
  it("writes only the segments that are pinned, leaving Any out", async () => {
    const wrapper = render({ modelValue: { "k8s-cluster": "production" } });
    await pick(wrapper, "service", "payment-gateway");
    expect(lastEmit(wrapper)).toEqual({
      "k8s-cluster": "production",
      service: "payment-gateway",
    });
  });

  it("clearing a segment back to Any removes that condition", async () => {
    const wrapper = render({
      modelValue: { "k8s-cluster": "production", "k8s-namespace": "payments" },
    });
    await pick(wrapper, "k8s-namespace", "");
    expect(lastEmit(wrapper)).toEqual({ "k8s-cluster": "production" });
  });

  /// How broad the claim is, per segment — the question a path makes askable
  /// and a row of disconnected dropdowns did not.
  it("says how much of the estate each segment takes", () => {
    const wrapper = render({ modelValue: { "k8s-cluster": "production" } });
    expect(wrapper.find('[data-test="oncall-scope-breadth-k8s-cluster"]').text()).toContain("48");
    // An Any segment reports what it is letting through, so breadth is visible
    // rather than something to infer from an empty control.
    expect(wrapper.find('[data-test="oncall-scope-breadth-k8s-namespace"]').text()).toContain("3");
  });

  it("spells out what a container claim leaves to longer paths", () => {
    const wrapper = render({ modelValue: { "k8s-cluster": "production" } });
    expect(wrapper.find('[data-test="oncall-scope-picker-consequence"]').text()).toContain(
      "unless a longer path claims it",
    );
  });

  /// A service beats any container rule in the engine's ranking, so the
  /// sentence has to say so — otherwise the reader writes it and then wonders
  /// which of two overlapping claims won.
  it("says a service claim holds against the scopes around it", () => {
    const wrapper = render({ modelValue: { service: "payment-gateway" } });
    expect(wrapper.find('[data-test="oncall-scope-picker-consequence"]').text()).toContain(
      "whoever owns the ones around it",
    );
  });

  describe("more than one platform", () => {
    /// A record is either an ECS task or a Kubernetes pod. One path mixing both
    /// would describe nothing that exists.
    it("keeps each platform's path to itself", async () => {
      const wrapper = render({ sets: [K8S, AWS] });
      expect(path(wrapper)).toEqual(["k8s-cluster", "k8s-namespace", "service"]);

      await wrapper.find('[data-test="oncall-scope-platform"] [data-option="aws"]').trigger("click");
      expect(path(wrapper)).toEqual(["ecs-task", "service"]);
    });

    it("does not ask which platform when the estate has only one", () => {
      expect(render().find('[data-test="oncall-scope-platform"]').exists()).toBe(false);
    });

    /// Values from the platform that was left behind would be saved invisibly —
    /// a condition nobody can see is a rule that matches nothing.
    it("drops the old platform's values when switching", async () => {
      const wrapper = render({ sets: [K8S, AWS], modelValue: { "k8s-cluster": "production" } });
      await wrapper.find('[data-test="oncall-scope-platform"] [data-option="aws"]').trigger("click");
      expect(lastEmit(wrapper)).toEqual({});
    });

    /// Opening an existing rule has to land on its own platform, not the first.
    it("follows the draft to the platform that owns its dimensions", () => {
      const wrapper = render({ sets: [K8S, AWS], modelValue: { "ecs-task": "billing" } });
      expect(path(wrapper)).toEqual(["ecs-task", "service"]);
    });
  });

  it("hands off to the field builder when Advanced is chosen", async () => {
    const wrapper = render();
    await wrapper.find('[data-test="oncall-scope-mode-advanced"]').trigger("click");
    expect(wrapper.emitted("advanced")).toHaveLength(1);
  });
});
