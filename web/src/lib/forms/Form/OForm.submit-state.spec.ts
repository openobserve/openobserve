// The auto loading-state contract: OForm AWAITS the @submit handler, so
// TanStack's `isSubmitting` spans the whole save, re-entry is guarded, and the
// state is mirrored into the overlay-provided ref that drives the Save spinner.
import { describe, it, expect, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { z } from "zod";
import OForm from "./OForm.vue";
import { FORM_SUBMIT_STATE_KEY } from "./OForm.types";
import { useOForm } from "./useOForm";

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

describe("useOForm rejected submit", () => {
  it("calls onSubmitInvalid, not onSubmit, when the schema rejects the values", async () => {
    const onSubmit = vi.fn();
    const onSubmitInvalid = vi.fn();
    const Host = defineComponent({
      setup() {
        const form = useOForm({
          defaultValues: { name: "" },
          schema: z.object({ name: z.string().min(1) }),
          onSubmit,
          onSubmitInvalid,
        });
        return () => h(OForm, { form });
      },
    });
    const wrapper = mount(Host);

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onSubmitInvalid).toHaveBeenCalledTimes(1);
  });
});
