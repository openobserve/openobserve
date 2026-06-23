// Stale-data guarantee: when a form lives inside a dialog/drawer, closing the
// overlay UNMOUNTS the <slot/> (reka-ui DialogContent has no forceMount), and
// reopening REMOUNTS a fresh OForm seeded from `defaultValues`. There is no
// watch re-syncing values, so the whole guarantee rests on unmount→remount.
//
// The subtle risk: the consumer creates `defaults` ONCE (e.g. AddStream's
// `const defaults = addStreamDefaults()`) and reuses that SAME object across
// open/close cycles. If TanStack mutated defaultValues in place, the second
// open would show the first open's typed text. It must not.
import { describe, it, expect } from "vitest";
import { defineComponent, ref, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import OForm from "./OForm.vue";
import OFormInput from "../Input/OFormInput.vue";

const Harness = defineComponent({
  components: { OForm, OFormInput },
  setup() {
    const open = ref(true);
    // Created once, reused across every "open" — mirrors AddStream.
    const defaults = { name: "" };
    return { open, defaults };
  },
  template: `
    <div>
      <OForm v-if="open" :default-values="defaults">
        <OFormInput name="name" label="Name" />
      </OForm>
    </div>
  `,
});

describe("OForm resets to defaults on dialog/drawer remount", () => {
  it("does not carry typed text from a previous open into the next", async () => {
    const w = mount(Harness);

    const input = () => w.find("input");
    expect(input().element.value).toBe("");

    // User types something then "closes" without saving.
    await input().setValue("my-unsaved-stream");
    expect(input().element.value).toBe("my-unsaved-stream");

    // Close (unmount, like reka Presence on open=false).
    w.vm.open = false;
    await nextTick();
    expect(w.find("input").exists()).toBe(false);

    // Reopen (remount). Must be fresh — NOT "my-unsaved-stream".
    w.vm.open = true;
    await nextTick();
    expect(w.find("input").element.value).toBe("");
  });
});
