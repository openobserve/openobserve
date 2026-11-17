// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { defineComponent } from "vue";
import { z } from "zod";
import OForm from "./OForm.vue";
import OFormInput from "../Input/OFormInput.vue";
import OFormCheckboxGroup from "../Checkbox/OFormCheckboxGroup.vue";
import OCheckbox from "../Checkbox/OCheckbox.vue";
import OFormCombobox from "../Combobox/OFormCombobox.vue";
import OFormDateTimeRange from "../DateTime/OFormDateTimeRange.vue";
import OFormTagInput from "../TagInput/OFormTagInput.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";

const RANGE = "Minimum must not exceed maximum";

const schema = z
  .object({
    name: z.string().min(1, "Name required"),
    email: z.string().min(1, "Email required"),
    min: z.coerce.number().min(1, "Min too small").max(100, "Min too large"),
    max: z.coerce.number(),
  })
  .superRefine((v, ctx) => {
    if (v.min > v.max) {
      ctx.addIssue({ code: "custom", message: RANGE, path: ["min"] });
      ctx.addIssue({ code: "custom", message: RANGE, path: ["max"] });
    }
  });

const Host = defineComponent({
  components: { OForm, OFormInput },
  setup: () => ({ schema, coupled: [["min", "max"]] }),
  template: `
    <OForm
      validate-on="leave"
      :coupled="coupled"
      :schema="schema"
      :default-values="{ name: '', email: '', min: '1', max: '5' }"
      @submit="() => {}"
    >
      <div v-for="f in ['name', 'email', 'min', 'max']" :key="f" :data-row="f">
        <OFormInput :name="f" :label="f" />
      </div>
    </OForm>`,
});

const input = (w: VueWrapper, f: string) => w.find(`[data-row="${f}"] input`);
const message = (w: VueWrapper, f: string) => {
  const alert = w.find(`[data-row="${f}"] [role="alert"]`);
  return alert.exists() ? alert.text() : undefined;
};
const invalid = (w: VueWrapper, f: string) => input(w, f).attributes("aria-invalid") === "true";

async function type(w: VueWrapper, f: string, value: string) {
  await input(w, f).setValue(value);
  await flushPromises();
}

async function leave(w: VueWrapper, f: string) {
  await input(w, f).trigger("blur");
  await flushPromises();
}

describe("OForm validate-on-leave", () => {
  it("an untouched invalid field stays quiet when another field is left", async () => {
    const w = mount(Host);
    await type(w, "name", "a");
    await type(w, "name", "");
    expect(message(w, "name")).toBeUndefined();

    await leave(w, "name");
    await vi.waitFor(() => expect(message(w, "name")).toBe("Name required"));
    // The schema has already put an error on the untouched field; only its display is held back.
    expect((w.findComponent(OForm).vm as any).form.getFieldMeta("email").errors).toHaveLength(1);
    expect(message(w, "email")).toBeUndefined();
    expect(invalid(w, "email")).toBe(false);

    await leave(w, "email");
    expect(message(w, "email")).toBeUndefined();
  });

  it("a changed field shows its error on leave, then updates on every change until fixed, then waits for the next leave", async () => {
    const w = mount(Host);
    await type(w, "min", "0");
    expect(message(w, "min")).toBeUndefined();
    await leave(w, "min");
    await vi.waitFor(() => expect(message(w, "min")).toBe("Min too small"));

    await type(w, "min", "200");
    await vi.waitFor(() => expect(message(w, "min")).toBe("Min too large"));

    await type(w, "min", "2");
    await vi.waitFor(() => expect(invalid(w, "min")).toBe(false));

    await type(w, "min", "0");
    expect(invalid(w, "min")).toBe(false);
    await leave(w, "min");
    await vi.waitFor(() => expect(message(w, "min")).toBe("Min too small"));
  });

  it("a coupled pair reveals together and prints the shared message once, on the anchor", async () => {
    const w = mount(Host);
    await type(w, "min", "9");
    expect(invalid(w, "max")).toBe(false);
    await leave(w, "min");

    await vi.waitFor(() => expect(message(w, "max")).toBe(RANGE));
    expect(message(w, "min")).toBeUndefined();
    expect(invalid(w, "min")).toBe(true);
    expect(invalid(w, "max")).toBe(true);

    await type(w, "min", "0");
    await vi.waitFor(() => expect(message(w, "min")).toBe("Min too small"));
    expect(invalid(w, "max")).toBe(false);
  });

  it("Save reveals every error", async () => {
    const w = mount(Host);
    await w.find("form").trigger("submit");
    await flushPromises();
    await vi.waitFor(() => expect(message(w, "name")).toBe("Name required"));
    expect(message(w, "email")).toBe("Email required");
  });

  it("a caller's own validate shows what it found", async () => {
    const w = mount(Host);
    const form = w.findComponent(OForm).vm as unknown as { validate: () => Promise<boolean> };

    expect(await form.validate()).toBe(false);
    await flushPromises();
    expect(invalid(w, "name")).toBe(true);
    expect(message(w, "name")).toBe("Name required");

    await type(w, "name", "a");
    expect(invalid(w, "name")).toBe(false);
  });

  it("a tag input whose row prints the error is still marked invalid", async () => {
    const tags = z.object({ v: z.array(z.string()).min(1, "Pick a tag") });
    const w = mount(
      defineComponent({
        components: { OForm, OFormTagInput, OSettingRow },
        setup: () => ({ tags }),
        template: `
          <OForm validate-on="leave" :schema="tags" :default-values="{ v: [] }" @submit="() => {}">
            <OSettingRow name="v" label="Tags"><OFormTagInput name="v" /></OSettingRow>
          </OForm>`,
      }),
    );
    await w.find("form").trigger("submit");
    await flushPromises();
    await vi.waitFor(() => expect(w.text()).toContain("Pick a tag"));
    expect(w.findAll('[aria-invalid="true"]')).toHaveLength(1);
    expect(w.text().split("Pick a tag")).toHaveLength(2);
  });

  it("leaving a composite control reveals its error", async () => {
    const cases = [
      {
        name: "checkbox group",
        components: { OFormCheckboxGroup, OCheckbox },
        field: `<OFormCheckboxGroup name="v"><OCheckbox value="a" label="A" /></OFormCheckboxGroup>`,
        defaultValue: ["a"],
        invalidValue: [],
        leave: (w: VueWrapper) => w.find('[data-row="v"] > div').trigger("focusout"),
      },
      {
        name: "tag input",
        components: { OFormTagInput },
        field: `<OFormTagInput name="v" label="Tags" />`,
        defaultValue: ["a"],
        invalidValue: [],
        leave: (w: VueWrapper) => w.find('[data-test="tag-input-container"]').trigger("focusout"),
      },
      {
        name: "combobox",
        components: { OFormCombobox },
        field: `<OFormCombobox name="v" label="Pick" :items="[]" data-test="combo" />`,
        defaultValue: "a",
        invalidValue: "",
        leave: (w: VueWrapper) => w.find('[data-test="combo"]').trigger("focusout"),
      },
      {
        name: "date time range",
        components: { OFormDateTimeRange },
        field: `<OFormDateTimeRange name="v" show-error />`,
        defaultValue: { type: "relative", period: "15m" },
        invalidValue: null,
        leave: (w: VueWrapper) => w.findComponent({ name: "DateTime" }).vm.$emit("hide"),
      },
    ];
    const anyValue = z.object({
      v: z.any().refine((v) => v != null && v.length !== 0, "Pick one"),
    });

    for (const c of cases) {
      const w = mount(
        defineComponent({
          components: { OForm, ...c.components },
          setup: () => ({ anyValue, defaults: { v: c.defaultValue } }),
          template: `
            <OForm validate-on="leave" :schema="anyValue" :default-values="defaults">
              <div data-row="v">${c.field}</div>
            </OForm>`,
        }),
        { global: { stubs: { DateTime: { name: "DateTime", template: "<div />" } } } },
      );
      const form = (w.findComponent(OForm).vm as any).form;
      form.setFieldValue("v", c.invalidValue);
      await flushPromises();
      expect(w.text(), c.name).not.toContain("Pick one");

      await c.leave(w);
      await flushPromises();
      await vi.waitFor(() => expect(w.text(), c.name).toContain("Pick one"));
      w.unmount();
    }
  });
});
