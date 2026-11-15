// A dialog with an OForm asks "Discard changes?" only after the user changed a value (V5, O9).
import { describe, it, expect, vi, afterEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, inject, onMounted } from "vue";
import { DialogContent } from "reka-ui";
import ODialog from "./ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";

vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return { ...actual, DialogPortal: actual.DialogContent };
});

// Stands in for an edit dialog whose record arrives after it opened.
const LoadsRecord = defineComponent({
  setup() {
    const form = inject(FORM_CONTEXT_KEY);
    onMounted(() => Promise.resolve().then(() => form.setFieldValue("name", "payments-5xx")));
    return () => null;
  },
});

const EditDialog = defineComponent({
  components: { ODialog, OForm, OFormInput, LoadsRecord },
  setup: () => ({ defaults: { name: "" } }),
  template: `
    <ODialog :open="true" title="Edit" :primary="{ label: 'Save' }">
      <OForm :default-values="defaults">
        <OFormInput name="name" label="Name" />
        <LoadsRecord />
      </OForm>
    </ODialog>`,
});

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

const pressEscape = async (w: VueWrapper) => {
  const panel = w
    .findAllComponents(DialogContent)
    .find((c) => c.attributes("data-o2-dialog") !== undefined)!;
  await panel.vm.$emit("escapeKeyDown", new KeyboardEvent("keydown", { key: "Escape" }));
  await flushPromises();
};
const closed = (w: VueWrapper) =>
  w.findComponent(ODialog).emitted("update:open")?.at(-1)?.[0] === false;

describe("ODialog opened from a menu", () => {
  it("stays open when the closing menu hands focus back to its trigger outside", async () => {
    wrapper = mount(ODialog, { attachTo: document.body, props: { open: true, dirty: true } });
    const panel = wrapper
      .findAllComponents(DialogContent)
      .find((c) => c.attributes("data-o2-dialog") !== undefined)!;
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    await panel.vm.$emit(
      "interactOutside",
      new CustomEvent("dismissableLayer.focusOutside", {
        cancelable: true,
        detail: { originalEvent: { target: trigger } },
      }),
    );
    await flushPromises();

    expect(wrapper.emitted("update:open")).toBeFalsy();
    expect(wrapper.find('[data-test="o-dialog-discard-row"]').exists()).toBe(false);
    trigger.remove();
  });
});

describe("ODialog with a form whose values load after it opens", () => {
  it("closes on Escape when the user changed nothing", async () => {
    wrapper = mount(EditDialog, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.find("input").element.value).toBe("payments-5xx");

    await pressEscape(wrapper);
    expect(wrapper.find('[data-test="o-dialog-discard-row"]').exists()).toBe(false);
    expect(closed(wrapper)).toBe(true);
  });

  it("asks on Escape after a typed edit, and closes again once it is put back", async () => {
    wrapper = mount(EditDialog, { attachTo: document.body });
    await flushPromises();
    const input = wrapper.find("input");
    await input.trigger("keydown", { key: "x" });
    await input.setValue("payments-5xx-v2");
    await flushPromises();

    await pressEscape(wrapper);
    expect(wrapper.find('[data-test="o-dialog-discard-row"]').exists()).toBe(true);
    expect(closed(wrapper)).toBe(false);

    await wrapper.find('[data-test="o-dialog-keep-editing-btn"]').trigger("click");
    await input.setValue("payments-5xx");
    await flushPromises();
    await pressEscape(wrapper);
    expect(wrapper.find('[data-test="o-dialog-discard-row"]').exists()).toBe(false);
    expect(closed(wrapper)).toBe(true);
  });
});
