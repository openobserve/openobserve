// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import CompositeExpressionBuilder from "./CompositeExpressionBuilder.vue";
import i18n from "@/locales";

type SelectedChild = {
  alert_id: string;
  name?: string;
  accessible: boolean;
  level?: string | null;
};

const selectedChildren: SelectedChild[] = [
  { alert_id: "id-a", name: "High error rate", accessible: true, level: "critical" },
  { alert_id: "id-b", name: "High latency", accessible: true, level: "warning" },
  { alert_id: "id-c", name: "Database unavailable", accessible: true, level: "ok" },
];

const mountBuilder = (modelValue: string, children: SelectedChild[] = selectedChildren) =>
  mount(CompositeExpressionBuilder, {
    props: { modelValue, selectedChildren: children },
    global: { plugins: [i18n] },
  });

describe("CompositeExpressionBuilder", () => {
  it("defaults two newly selected children to an ID-backed AND expression", () => {
    const wrapper = mountBuilder("", selectedChildren.slice(0, 2));

    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toBe("{id-a} && {id-b}");
    expect(wrapper.find('[data-test="alerts-composite-expression-live"]').exists()).toBe(true);
  });

  it("renders a live pill per operand without leaking IDs or child names", () => {
    const wrapper = mountBuilder("{id-a} || ({id-b} && !{id-c})");
    const live = wrapper.find('[data-test="alerts-composite-expression-live"]');

    expect(live.text()).toContain("A");
    expect(live.text()).toContain("B");
    expect(live.text()).toContain("C");
    expect(live.text()).not.toContain("id-a");
    expect(live.text()).not.toContain("High error rate");
  });

  it("places an operand via its letter chip without disturbing a custom expression", async () => {
    const wrapper = mountBuilder("{id-a} && {id-b}", selectedChildren.slice(0, 2));
    await wrapper.find('[data-test="alerts-composite-expression-insert-id-b"]').trigger("click");

    expect(wrapper.emitted("update:modelValue")?.at(-1)?.[0]).toBe("{id-a} && {id-b} {id-b}");
  });

  it("reports invalid until the expression uses exactly the selected child set", () => {
    const wrapper = mountBuilder("{id-a} && {id-b}");
    const validation = wrapper.emitted("validation")?.at(-1)?.[0];

    expect(validation).toEqual(
      expect.objectContaining({
        valid: false,
        used_child_ids: ["id-a", "id-b"],
        unused_child_ids: ["id-c"],
      }),
    );
    expect(wrapper.find('[data-test="alerts-composite-expression-error"]').exists()).toBe(true);
  });

  it("lists unused children so they can be placed, never removing them silently", async () => {
    const wrapper = mountBuilder("{id-a} && {id-b}", selectedChildren.slice(0, 2));
    await wrapper.setProps({ selectedChildren });

    expect(wrapper.emitted("update:modelValue") ?? []).toHaveLength(0);
    expect(wrapper.find('[data-test="alerts-composite-operand-tray-id-c"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alerts-composite-expression-unused"]').text()).toContain(
      "Database unavailable",
    );
  });

  it("offers keyboard-reachable, screen-reader-labelled builder controls", () => {
    const wrapper = mountBuilder("{id-a} && {id-b}", selectedChildren.slice(0, 2));
    for (const selector of [
      "alerts-composite-expression-and",
      "alerts-composite-expression-or",
      "alerts-composite-expression-not",
      "alerts-composite-expression-open-group",
      "alerts-composite-expression-close-group",
    ]) {
      const control = wrapper.find(`[data-test="${selector}"]`);
      expect(control.attributes("aria-label")).toBeTruthy();
      expect(control.attributes("tabindex") ?? "0").not.toBe("-1");
    }
  });
});
