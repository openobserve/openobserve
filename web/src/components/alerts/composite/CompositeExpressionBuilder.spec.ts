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
};

const selectedChildren: SelectedChild[] = [
  { alert_id: "id-a", name: "High error rate", accessible: true },
  { alert_id: "id-b", name: "High latency", accessible: true },
  { alert_id: "id-c", name: "Database unavailable", accessible: true },
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
    expect(wrapper.find('[data-test="alerts-composite-expression-summary"]').text()).toContain(
      "High error rate",
    );
    expect(wrapper.find('[data-test="alerts-composite-expression-summary"]').text()).not.toContain(
      "id-a",
    );
  });

  it("renders operator precedence and explicit parentheses without changing meaning", () => {
    const wrapper = mountBuilder("{id-a} || ({id-b} && !{id-c})");
    const summary = wrapper.find('[data-test="alerts-composite-expression-summary"]');

    expect(summary.text()).toContain("High error rate");
    expect(summary.text()).toContain("High latency");
    expect(summary.text()).toContain("Database unavailable");
    expect(summary.text()).toMatch(/High error rate.*OR.*\(.*High latency.*AND.*NOT.*Database unavailable.*\)/s);
  });

  it("does not silently append a child to a customized expression", async () => {
    const wrapper = mountBuilder("{id-a} && {id-b}", selectedChildren.slice(0, 2));
    await wrapper.setProps({ selectedChildren });

    expect(wrapper.emitted("update:modelValue") ?? []).toHaveLength(0);
    expect(wrapper.find('[data-test="alerts-composite-operand-tray-id-c"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alerts-composite-expression-unused"]').text()).toContain(
      "Database unavailable",
    );
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
  });

  it("keeps an inaccessible operand removable while revealing no child state or name", () => {
    const wrapper = mountBuilder("{id-a} && {secret-id}", [
      selectedChildren[0],
      { alert_id: "secret-id", accessible: false },
    ]);
    const operand = wrapper.find('[data-test="alerts-composite-expression-operand-secret-id"]');

    expect(operand.text()).not.toContain("critical");
    expect(operand.attributes("aria-label")).toMatch(/inaccessible/i);
    expect(
      wrapper.find('[data-test="alerts-composite-expression-remove-secret-id"]').exists(),
    ).toBe(true);
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
