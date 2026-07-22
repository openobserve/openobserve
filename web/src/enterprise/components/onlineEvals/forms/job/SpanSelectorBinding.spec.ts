// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, expect, it } from "vitest";
import en from "@/locales/languages/en-US.json";
import SpanSelectorBinding from "./SpanSelectorBinding.vue";

function mountBinding() {
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en } });

  return mount(SpanSelectorBinding, {
    props: {
      scorerId: "scorer-1",
      selectors: [],
      streamFields: [
        { label: "name", value: "name", type: "Utf8" },
        { label: "status", value: "status", type: "Utf8" },
      ],
    },
    global: {
      plugins: [i18n],
      stubs: {
        // Render the drawer body inline so the form fields are queryable.
        ODrawer: {
          props: ["open", "title"],
          template: '<aside v-if="open"><h2>{{ title }}</h2><slot /></aside>',
        },
        JobFilterBuilder: true,
      },
    },
  });
}

async function openEditor(wrapper: any) {
  await wrapper.get('[data-test="span-selector-create-scorer-1"]').trigger("click");
}

function maxSpansHelp(wrapper: any) {
  return wrapper.get('[data-test="span-selector-maximum-spans"]').text();
}

describe("SpanSelectorBinding", () => {
  // The hint is deliberately static: earlier versions recomputed a ceiling from
  // the field count, which put an internal character budget in front of the
  // user and changed as they edited other fields. The cap is still enforced by
  // the schema on save; it is just not explained here.
  it("describes the span cap without exposing the internal budget", async () => {
    const wrapper = mountBinding();
    await openEditor(wrapper);

    const help = maxSpansHelp(wrapper);

    expect(help).toContain("Limits how many spans are selected from the trace");
    expect(help).not.toContain("40,000");
    expect(help).not.toContain("character");
    expect(help).not.toContain("fields selected");
  });

  it("renders the standard fields as coloured, readable chips", async () => {
    const wrapper = mountBinding();
    await openEditor(wrapper);

    const chip = wrapper.get(
      '[data-test="span-selector-default-field-gen_ai_input_messages"]',
    );
    expect(chip.text()).toBe("gen_ai_input_messages");
    // All eight standard fields are listed, not just a sample.
    expect(
      wrapper.findAll('[data-test^="span-selector-default-field-"]'),
    ).toHaveLength(8);
  });
});
