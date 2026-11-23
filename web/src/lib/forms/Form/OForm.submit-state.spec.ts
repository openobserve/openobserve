// The auto loading-state contract: OForm AWAITS the @submit handler, so
// TanStack's `isSubmitting` spans the whole save, re-entry is guarded, and the
// state is mirrored into the overlay-provided ref that drives the Save spinner.
import { describe, it, expect, vi } from "vitest";
import { ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import OForm from "./OForm.vue";
import { FORM_DIRTY_STATE_KEY, FORM_SUBMIT_STATE_KEY } from "./OForm.types";

// A promise we resolve by hand — lets us observe the "mid-save" window without
// timers (Date.now/setTimeout are awkward in this harness).
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("OForm awaited submit state", () => {
  it("keeps isSubmitting true for the whole awaited handler", async () => {
    const d = deferred();
    const onSubmit = vi.fn(() => d.promise);
    const wrapper = mount(OForm, {
      props: { defaultValues: { name: "x" }, onSubmit },
    });
    const vm = wrapper.vm as unknown as { isSubmitting: boolean };

    expect(vm.isSubmitting).toBe(false);

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(vm.isSubmitting).toBe(true); // handler still pending → still saving

    d.resolve();
    await flushPromises();
    expect(vm.isSubmitting).toBe(false); // done
  });

  it("guards re-entry while a submit is in flight (no double-fire)", async () => {
    const d = deferred();
    const onSubmit = vi.fn(() => d.promise);
    const wrapper = mount(OForm, {
      props: { defaultValues: { name: "x" }, onSubmit },
    });

    await wrapper.find("form").trigger("submit");
    await flushPromises();
    // Second submit while the first is still pending must be ignored.
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    d.resolve();
    await flushPromises();
  });

  it("mirrors isSubmitting into the overlay-provided submit-state ref", async () => {
    const d = deferred();
    const overlayState = ref(false);
    const onSubmit = vi.fn(() => d.promise);
    const wrapper = mount(OForm, {
      props: { defaultValues: { name: "x" }, onSubmit },
      global: { provide: { [FORM_SUBMIT_STATE_KEY as symbol]: overlayState } },
    });

    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(overlayState.value).toBe(true); // overlay Save button would show spinner

    d.resolve();
    await flushPromises();
    expect(overlayState.value).toBe(false);
  });

  it("releases the overlay's submit state when unmounted mid-submit", async () => {
    const d = deferred();
    const overlayState = ref(false);
    const wrapper = mount(OForm, {
      props: { defaultValues: { name: "x" }, onSubmit: () => d.promise },
      global: { provide: { [FORM_SUBMIT_STATE_KEY as symbol]: overlayState } },
    });

    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(overlayState.value).toBe(true);

    wrapper.unmount();
    expect(overlayState.value).toBe(false);
    d.resolve();
    await flushPromises();
    expect(overlayState.value).toBe(false);
  });
});

describe("OForm unsaved edits for the overlay guard", () => {
  const mountWithDirtyRef = (onSubmit = vi.fn()) => {
    const dirty = ref(false);
    const wrapper = mount(OForm, {
      props: { defaultValues: { name: "x" }, onSubmit },
      global: { provide: { [FORM_DIRTY_STATE_KEY as symbol]: dirty } },
    });
    const form = (wrapper.vm as unknown as { form: any }).form;
    return { dirty, wrapper, form };
  };

  it("reports an edit, and clears it when the value is put back", async () => {
    const { dirty, form } = mountWithDirtyRef();
    expect(dirty.value).toBe(false);
    form.setFieldValue("name", "y");
    await flushPromises();
    expect(dirty.value).toBe(true);
    form.setFieldValue("name", "x");
    await flushPromises();
    expect(dirty.value).toBe(false);
  });

  it("treats a successfully saved value as no longer unsaved", async () => {
    const { dirty, wrapper, form } = mountWithDirtyRef();
    form.setFieldValue("name", "y");
    await flushPromises();
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(dirty.value).toBe(false);
    form.setFieldValue("name", "z");
    await flushPromises();
    expect(dirty.value).toBe(true);
  });
});
