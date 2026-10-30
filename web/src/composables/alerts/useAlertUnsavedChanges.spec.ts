// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { defineComponent, h, ref, type Ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { useAlertUnsavedChanges, type AlertUnsavedChanges } from "./useAlertUnsavedChanges";

const loaded = () => ({ name: "errors", trigger_condition: { threshold: 3, period: 10 } });

const host = (values: Ref<Record<string, any>>, enabled: () => boolean) => {
  let api: AlertUnsavedChanges | null = null;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useAlertUnsavedChanges({ values, enabled, ready: Promise.resolve() });
        return () => h("div");
      },
    }),
    { attachTo: document.body },
  );
  return { wrapper, api: () => api! };
};

const setValue = (values: Ref<Record<string, any>>, path: "threshold" | "period", v: number) => {
  values.value = {
    ...values.value,
    trigger_condition: { ...values.value.trigger_condition, [path]: v },
  };
};

describe("useAlertUnsavedChanges", () => {
  let wrapper: VueWrapper | null = null;
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("takes the baseline at the first input, so a late load write is not an edit", async () => {
    const values = ref<Record<string, any>>(loaded());
    const mounted = host(values, () => true);
    wrapper = mounted.wrapper;
    await flushPromises();
    values.value = { ...values.value, description: "normalised by a load" };
    document.dispatchEvent(new Event("pointerdown"));
    expect(mounted.api().changes.value).toEqual([]);
  });

  it("counts each changed field once and names its section", async () => {
    const values = ref<Record<string, any>>(loaded());
    const mounted = host(values, () => true);
    wrapper = mounted.wrapper;
    await flushPromises();
    document.dispatchEvent(new Event("keydown"));
    setValue(values, "threshold", 4);
    setValue(values, "threshold", 7);
    setValue(values, "period", 15);
    const api = mounted.api();
    expect(api.changes.value.map((c) => c.path)).toEqual([
      "trigger_condition.threshold",
      "trigger_condition.period",
    ]);
    expect([...api.sections.value].sort()).toEqual(["condition", "schedule"]);
  });

  it("drops to zero when the values go back to the baseline (Discard)", async () => {
    const values = ref<Record<string, any>>(loaded());
    const mounted = host(values, () => true);
    wrapper = mounted.wrapper;
    await flushPromises();
    document.dispatchEvent(new Event("pointerdown"));
    setValue(values, "threshold", 9);
    const api = mounted.api();
    expect(api.changes.value).toHaveLength(1);
    values.value = structuredClone(api.baseline.value!);
    expect(api.changes.value).toEqual([]);
  });

  it("keeps the baseline independent of later writes", async () => {
    const values = ref<Record<string, any>>(loaded());
    const mounted = host(values, () => true);
    wrapper = mounted.wrapper;
    await flushPromises();
    mounted.api().takeBaseline();
    values.value.trigger_condition.threshold = 99;
    expect((mounted.api().baseline.value as any).trigger_condition.threshold).toBe(3);
  });

  it("moves the baseline for a field saved outside the form, so it is not an unsaved change", async () => {
    const values = ref<Record<string, any>>({ ...loaded(), enabled: true });
    const mounted = host(values, () => true);
    wrapper = mounted.wrapper;
    await flushPromises();
    document.dispatchEvent(new Event("pointerdown"));
    setValue(values, "threshold", 9);
    values.value = { ...values.value, enabled: false };
    mounted.api().acceptSaved("enabled", false);
    expect(mounted.api().changes.value.map((c) => c.path)).toEqual(["trigger_condition.threshold"]);
    expect((mounted.api().baseline.value as any).enabled).toBe(false);
  });

  it("reports nothing for a new alert", async () => {
    const values = ref<Record<string, any>>(loaded());
    const mounted = host(values, () => false);
    wrapper = mounted.wrapper;
    await flushPromises();
    document.dispatchEvent(new Event("pointerdown"));
    setValue(values, "threshold", 9);
    expect(mounted.api().baseline.value).toBeNull();
    expect(mounted.api().changes.value).toEqual([]);
  });
});
