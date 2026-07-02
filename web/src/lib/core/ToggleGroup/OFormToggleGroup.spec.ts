// Copyright 2026 OpenObserve Inc.
//
// Foundation tests for OFormToggleGroup — the OForm* wrapper around OToggleGroup.
// Mounts a REAL OForm and asserts the toggle binds its active value to the field
// (both directions), and that a schema error surfaces after the first submit.

import { describe, it, expect, afterEach } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { z } from "zod";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormToggleGroup from "./OFormToggleGroup.vue";
import OToggleGroupItem from "./OToggleGroupItem.vue";

const ITEMS = `
  <OToggleGroupItem value="once">Once</OToggleGroupItem>
  <OToggleGroupItem value="cron">Cron</OToggleGroupItem>
`;

function mountForm(opts: { defaultValues: Record<string, unknown>; schema?: unknown }) {
  return mount(OForm, {
    props: { defaultValues: opts.defaultValues, schema: opts.schema },
    slots: {
      default: `<OFormToggleGroup name="freq" data-test="freq-toggle">${ITEMS}</OFormToggleGroup>`,
    },
    global: {
      components: { OFormToggleGroup, OToggleGroupItem },
    },
  });
}

describe("OFormToggleGroup", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders its items inside OForm", () => {
    wrapper = mountForm({ defaultValues: { freq: "once" } });
    expect(wrapper.exists()).toBe(true);
    const buttons = wrapper.findAll("button");
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    expect(wrapper.text()).toContain("Once");
    expect(wrapper.text()).toContain("Cron");
  });

  it("reflects the field value (form → toggle): the active item is pressed", async () => {
    wrapper = mountForm({ defaultValues: { freq: "cron" } });
    await nextTick();
    const pressed = wrapper
      .findAll("button")
      .find((b) => b.attributes("data-state") === "on");
    expect(pressed?.text()).toContain("Cron");
  });

  it("updates the field when an item is clicked (toggle → form)", async () => {
    wrapper = mountForm({ defaultValues: { freq: "once" } });
    await nextTick();
    const cronBtn = wrapper.findAll("button").find((b) => b.text().includes("Cron"));
    await cronBtn!.trigger("click");
    await flushPromises();
    expect((wrapper.vm as any).form.state.values.freq).toBe("cron");
  });

  it("reflects an externally-set field value (e.g. form.reset / prefill)", async () => {
    wrapper = mountForm({ defaultValues: { freq: "once" } });
    await nextTick();
    (wrapper.vm as any).form.setFieldValue("freq", "cron");
    await nextTick();
    const pressed = wrapper
      .findAll("button")
      .find((b) => b.attributes("data-state") === "on");
    expect(pressed?.text()).toContain("Cron");
  });

  it("shows no error before submit but reveals it after (submit-then-change)", async () => {
    const schema = z.object({
      freq: z.string().refine((v) => v === "cron", "Must be cron"),
    });
    wrapper = mountForm({ defaultValues: { freq: "once" }, schema });
    await nextTick();
    expect(wrapper.text()).not.toContain("Must be cron");

    await (wrapper.vm as any).form.handleSubmit();
    await flushPromises();
    expect(wrapper.text()).toContain("Must be cron");
  });
});
