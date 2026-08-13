// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CompositeAlertForm from "./CompositeAlertForm.vue";
import alertsService from "@/services/alerts";
import i18n from "@/locales";

vi.mock("@/services/alerts", () => ({
  default: { validateComposite: vi.fn() },
}));

const children = [
  { alert_id: "id-a", name: "High error rate", accessible: true, enabled: true },
  { alert_id: "id-b", name: "High latency", accessible: true, enabled: true },
];

const draft = (overrides: Record<string, unknown> = {}) => ({
  alert_type: "composite",
  name: "Checkout degraded",
  description: "",
  enabled: true,
  destinations: ["pager"],
  trigger_condition: { silence: 15 },
  composite_condition: {
    expression: "{id-a} && {id-b}",
    warning_counts_as_firing: true,
    stale_child_policy: "use_last_state",
  },
  children,
  ...overrides,
});

const validPreview = {
  valid: true,
  canonical_expression: "({id-a} && {id-b})",
  children: [],
  warnings: [],
  errors: [],
  result: true,
  result_level: "critical",
};

const mountForm = (modelValue = draft()) =>
  mount(CompositeAlertForm, {
    props: { modelValue, folderId: "default", availableChildren: children },
    global: { plugins: [i18n] },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(alertsService.validateComposite).mockResolvedValue({ data: validPreview });
});

describe("CompositeAlertForm", () => {
  it("sends only the draft condition, update identity, and target folder for server validation", async () => {
    vi.mocked(alertsService.validateComposite).mockResolvedValue({ data: validPreview });
    const model = draft({ id: "composite-1" });
    const wrapper = mountForm(model);
    await flushPromises();

    expect(alertsService.validateComposite).toHaveBeenCalledWith("default", {
      composite_condition: model.composite_condition,
      composite_id: "composite-1",
      folder_id: "default",
    });
    expect(wrapper.emitted("validation")?.at(-1)?.[0]).toEqual(
      expect.objectContaining({ valid: true }),
    );
  });

  it("disables save for local selected-set mismatch before server validation", async () => {
    const wrapper = mountForm(
      draft({
        children: [...children, { alert_id: "id-c", name: "Database", accessible: true }],
      }),
    );
    await flushPromises();

    expect(wrapper.emitted("validation")?.at(-1)?.[0]).toEqual(
      expect.objectContaining({ valid: false }),
    );
    expect(alertsService.validateComposite).not.toHaveBeenCalled();
  });

  it.each(["composite_cycle", "composite_too_deep", "child_not_accessible", "child_not_eligible"])(
    "keeps save blocked for server error %s",
    async (code) => {
      vi.mocked(alertsService.validateComposite).mockResolvedValue({
        data: { ...validPreview, valid: false, errors: [{ code, message: code }] },
      });
      const wrapper = mountForm();
      await flushPromises();

      expect(wrapper.find(`[data-test="alerts-composite-preview-error-${code}"]`).exists()).toBe(
        true,
      );
      expect(wrapper.emitted("validation")?.at(-1)?.[0]).toEqual(
        expect.objectContaining({ valid: false }),
      );
    },
  );

  it("defaults Warning to firing and stale children to explicit use-last-state", () => {
    const wrapper = mountForm(draft());

    expect(
      wrapper
        .find('[data-test="alerts-composite-warning-counts-as-firing"]')
        .attributes("aria-checked"),
    ).toBe("true");
    expect(
      wrapper.find('[data-test="alerts-composite-stale-policy"]').attributes("data-value"),
    ).toBe("use_last_state");
    expect(wrapper.find('[data-test="alerts-composite-stale-policy-help"]').text()).toMatch(
      /last.*state/i,
    );
  });

  it("writes Warning and stale-policy control changes into the draft condition", async () => {
    const wrapper = mountForm(draft());
    type EmittingWrapper = {
      vm: { $emit: (event: string, value: unknown) => void };
    };
    const warningControl = wrapper.findComponent(
      '[data-test="alerts-composite-warning-counts-as-firing"]',
    ) as unknown as EmittingWrapper;
    const staleControl = wrapper.findComponent(
      '[data-test="alerts-composite-stale-policy"]',
    ) as unknown as EmittingWrapper;
    warningControl.vm.$emit("update:modelValue", false);
    staleControl.vm.$emit("update:modelValue", "treat_as_true");

    const updates = (wrapper.emitted("update:modelValue") ?? []) as Array<
      [
        {
          composite_condition: {
            warning_counts_as_firing: boolean;
            stale_child_policy: string;
          };
        },
      ]
    >;
    expect(
      updates.some(([value]) => value.composite_condition.warning_counts_as_firing === false),
    ).toBe(true);
    expect(updates.at(-1)?.[0].composite_condition.stale_child_policy).toBe("treat_as_true");
  });

  it("keeps an inaccessible edit child removable without revealing its state", async () => {
    const wrapper = mountForm(
      draft({
        composite_condition: {
          expression: "{id-a} && {secret-id}",
          warning_counts_as_firing: true,
          stale_child_policy: "use_last_state",
        },
        children: [children[0], { alert_id: "secret-id", accessible: false }],
      }),
    );
    const slot = wrapper.find('[data-test="alerts-composite-selected-child-secret-id"]');

    expect(slot.text()).not.toMatch(/critical|warning|ok|stale/i);
    await wrapper.find('[data-test="alerts-composite-child-remove-secret-id"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
  });
});
