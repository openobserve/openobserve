// Copyright 2026 OpenObserve Inc.

import { flushPromises, mount } from "@vue/test-utils";
import { inject } from "vue";
import { describe, expect, it } from "vitest";

import OnCallAwayDialog from "@/components/oncall/OnCallAwayDialog.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { nextWeekRange } from "@/utils/oncall";

const IST = "Asia/Kolkata";

const stubs = {
  ODialog: { name: "ODialog", props: ["open"], template: "<div v-if='open'><slot /></div>" },
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: "<button @click=\"$emit('click')\"><slot /></button>",
  },
  // Reads the window through the form context, as the real picker does.
  OFormDateTimeRange: {
    name: "OFormDateTimeRange",
    props: ["name"],
    setup(props: { name: string }) {
      const form = inject<any>(FORM_CONTEXT_KEY);
      return { value: form.useStore((state: any) => state.values?.[props.name]) };
    },
    template: `<span :data-from="value?.from" :data-to="value?.to">
      <slot name="above" />
    </span>`,
  },
  OFormInput: true,
  OAvatar: true,
  OnCallZoneInfo: true,
  OnCallPersonName: {
    name: "OnCallPersonName",
    props: ["email"],
    template: "<span>{{ email }}</span>",
  },
};

function render() {
  return mount(OnCallAwayDialog, {
    props: { open: true, email: "ana@o2.ai", timezone: IST },
    global: { plugins: [i18n, store], stubs },
  });
}

describe("OnCallAwayDialog", () => {
  // U18: one line says how far an absence reaches and who picks up the shifts.
  it("says the absence holds on every team, and who takes the shifts", () => {
    expect(render().find('[data-test="oncall-members-away-consequence"]').text()).toBe(
      "Applies on every team ana@o2.ai is on. Their shifts go to the next person on each rotation, if there is one.",
    );
  });

  it("offers next week, Monday to Monday on the team's clock", async () => {
    const wrapper = render();
    await wrapper.find('[data-test="oncall-members-away-preset-next-week"]').trigger("click");
    await flushPromises();

    const expected = nextWeekRange(Date.now() * 1000, IST);
    const window = wrapper.find("[data-from]");
    expect(Number(window.attributes("data-from"))).toBe(expected.from);
    expect(Number(window.attributes("data-to"))).toBe(expected.to);
    expect(wrapper.find('[data-test="oncall-members-away-preset-next-week"]').text()).toBe(
      "Next week, Mon–Sun",
    );
  });
});
