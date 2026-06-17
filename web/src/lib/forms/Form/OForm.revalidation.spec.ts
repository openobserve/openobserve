// Regression test for <OForm :schema> validation timing, wired via TanStack
// revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }).
//
// Spec (the submit-then-change UX):
//  • Before the first submit: NO validation — no errors while typing OR on blur.
//  • First submit: every field's error is revealed (markAllBlurred + validate).
//  • After the first submit: errors revalidate live on every change.
import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent } from "vue";
import { z } from "zod";
import OForm from "./OForm.vue";
import OFormInput from "../Input/OFormInput.vue";

const schema = z.object({
  name: z.string().trim().min(1, "Required").regex(/^[a-zA-Z0-9_:]+$/, "Bad chars"),
});

const Host = defineComponent({
  components: { OForm, OFormInput },
  setup: () => ({ schema }),
  template: `
    <OForm id="f" :schema="schema" :default-values="{ name: '' }" @submit="() => {}">
      <OFormInput name="name" label="Name" data-test="name" />
    </OForm>`,
});

const err = (w: any) =>
  w.find('[role="alert"]').exists() ? w.find('[role="alert"]').text() : "(none)";

describe("OForm schema validation timing (submit-then-change)", () => {
  it("does NOT validate while typing before the first submit", async () => {
    const w = mount(Host);
    await w.find("input").setValue("bad!"); // invalid, but no submit yet
    await flushPromises();
    expect(err(w)).toBe("(none)");
  });

  it("does NOT validate on blur before the first submit", async () => {
    const w = mount(Host);
    const input = w.find("input");
    await input.setValue("bad!");
    await input.trigger("blur"); // blur no longer triggers validation pre-submit
    await flushPromises();
    expect(err(w)).toBe("(none)");
  });

  it("first validation is triggered by submit (reveals all errors)", async () => {
    const w = mount(Host);
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(err(w)).toBe("Required");
  });

  it("after submit: error CLEARS ON CHANGE then REAPPEARS ON CHANGE", async () => {
    const w = mount(Host);
    const input = w.find("input");

    await w.find("form").trigger("submit");
    await flushPromises();
    expect(err(w)).toBe("Required");

    await input.setValue("validname"); // valid — no blur needed
    await flushPromises();
    expect(err(w)).toBe("(none)"); // clears on change

    await input.setValue("bad!"); // invalid again — no blur
    await flushPromises();
    expect(err(w)).toBe("Bad chars"); // reappears on change
  });
});
