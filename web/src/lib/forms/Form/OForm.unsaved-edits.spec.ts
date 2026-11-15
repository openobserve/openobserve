// The overlay discard guard asks only when the values differ from what the user first saw (V5).
import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, inject, onMounted, ref } from "vue";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import OForm from "./OForm.vue";
import OFormInput from "../Input/OFormInput.vue";
import OFormDateTimeRange from "../DateTime/OFormDateTimeRange.vue";
import { FORM_CONTEXT_KEY, FORM_DIRTY_STATE_KEY } from "./OForm.types";

const press = (key = "a") =>
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

// Mimics a field that rewrites its value once it mounts, as a select coercing "5" to 5 does.
const Normaliser = defineComponent({
  setup() {
    const form = inject(FORM_CONTEXT_KEY);
    onMounted(() => {
      form.setFieldValue("port", Number(form.state.values.port));
      form.setFieldValue("region", form.state.values.region || "us-east-1");
    });
    return () => null;
  },
});

// Like the real picker, it reports its range once on mount, before the user touches it.
const RangePickerStub = defineComponent({
  name: "ODateTimeRange",
  emits: ["on:date-change"],
  setup(_, { emit }) {
    const range = (startTime: number) => ({
      valueType: "relative",
      startTime,
      endTime: 2,
      relativeTimePeriod: "15m",
    });
    onMounted(() => emit("on:date-change", range(1)));
    return { pick: () => emit("on:date-change", { ...range(0), valueType: "absolute" }) };
  },
  template: `<button type="button" data-test="range" @click="pick">range</button>`,
});

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function mountForm(defaultValues: Record<string, unknown>, onSubmit = vi.fn()) {
  const dirty = ref(false);
  wrapper = mount(OForm, {
    attachTo: document.body,
    props: { defaultValues, onSubmit },
    slots: { default: () => [] },
    global: { provide: { [FORM_DIRTY_STATE_KEY as symbol]: dirty } },
  });
  const form = (wrapper.vm as unknown as { form: any }).form;
  return { dirty, wrapper, form };
}

describe("OForm unsaved edits for the overlay guard", () => {
  it("does not count values that arrive after mount as an edit", async () => {
    const { dirty, form } = mountForm({ name: "", roles: [] as string[] });
    await flushPromises();
    form.setFieldValue("roles", ["admin"]);
    form.setFieldValue("name", "loaded");
    await flushPromises();
    expect(dirty.value).toBe(false);
  });

  it("does not count a reset with loaded values as an edit, even after the user clicked in", async () => {
    const { dirty, form } = mountForm({ name: "" });
    press();
    form.reset({ name: "loaded" });
    await flushPromises();
    expect(dirty.value).toBe(false);
  });

  it("does not count defaults a field normalises on mount as an edit", async () => {
    const dirty = ref(false);
    wrapper = mount(
      defineComponent({
        components: { OForm, Normaliser },
        setup: () => ({ defaults: { port: "5", region: "" } }),
        template: `<OForm :default-values="defaults"><Normaliser /></OForm>`,
      }),
      { attachTo: document.body, global: { provide: { [FORM_DIRTY_STATE_KEY as symbol]: dirty } } },
    );
    await flushPromises();
    expect(dirty.value).toBe(false);
  });

  it("does not count the range a date picker reports on mount as an edit, but counts a picked one", async () => {
    const dirty = ref(false);
    wrapper = mount(
      defineComponent({
        components: { OForm, OFormDateTimeRange },
        setup: () => ({ defaults: { timerange: { type: "relative", period: "15m" } } }),
        template: `<OForm :default-values="defaults"><OFormDateTimeRange name="timerange" /></OForm>`,
      }),
      {
        attachTo: document.body,
        global: {
          stubs: { ODateTimeRange: RangePickerStub },
          provide: { [FORM_DIRTY_STATE_KEY as symbol]: dirty },
        },
      },
    );
    await flushPromises();
    expect(dirty.value).toBe(false);

    await wrapper.find('[data-test="range"]').trigger("click");
    await flushPromises();
    expect(dirty.value).toBe(true);
  });

  it("counts a typed edit, and clears it when the value is put back", async () => {
    const dirty = ref(false);
    wrapper = mount(
      defineComponent({
        components: { OForm, OFormInput },
        setup: () => ({ defaults: { name: "x" } }),
        template: `<OForm :default-values="defaults"><OFormInput name="name" label="Name" /></OForm>`,
      }),
      { attachTo: document.body, global: { provide: { [FORM_DIRTY_STATE_KEY as symbol]: dirty } } },
    );
    const input = wrapper.find("input");
    await input.trigger("keydown", { key: "y" });
    await input.setValue("xy");
    await flushPromises();
    expect(dirty.value).toBe(true);

    await input.trigger("keydown", { key: "Backspace" });
    await input.setValue("x");
    await flushPromises();
    expect(dirty.value).toBe(false);
  });

  it("treats a successfully saved value as no longer unsaved", async () => {
    const { dirty, wrapper: w, form } = mountForm({ name: "x" });
    press();
    form.setFieldValue("name", "y");
    await flushPromises();
    expect(dirty.value).toBe(true);
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(dirty.value).toBe(false);
    form.setFieldValue("name", "z");
    await flushPromises();
    expect(dirty.value).toBe(true);
    form.setFieldValue("name", "y");
    await flushPromises();
    expect(dirty.value).toBe(false);
  });

  it("keeps the overlay asking while one of two forms in it has edits", async () => {
    const dirty = ref(false);
    wrapper = mount(
      defineComponent({
        components: { OForm, OFormInput },
        setup: () => ({ showSecond: ref(false), a: { name: "a" }, b: { name: "b" } }),
        template: `<div>
          <OForm :default-values="a"><OFormInput name="name" label="A" data-test="a" /></OForm>
          <OForm v-if="showSecond" :default-values="b"><OFormInput name="name" label="B" /></OForm>
        </div>`,
      }),
      { attachTo: document.body, global: { provide: { [FORM_DIRTY_STATE_KEY as symbol]: dirty } } },
    );
    const first = wrapper.find("input");
    await first.trigger("keydown", { key: "x" });
    await first.setValue("ax");
    await flushPromises();
    expect(dirty.value).toBe(true);

    (wrapper.vm as unknown as { showSecond: boolean }).showSecond = true;
    await flushPromises();
    expect(dirty.value).toBe(true);
  });

  it("stops reporting once the form unmounts", async () => {
    const { dirty, wrapper: w, form } = mountForm({ name: "x" });
    press();
    form.setFieldValue("name", "y");
    await flushPromises();
    expect(dirty.value).toBe(true);
    w.unmount();
    wrapper = null;
    expect(dirty.value).toBe(false);
  });
});
