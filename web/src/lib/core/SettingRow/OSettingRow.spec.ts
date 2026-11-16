// Copyright 2026 OpenObserve Inc.

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import { z } from "zod";

import OForm from "../../forms/Form/OForm.vue";
import OFormInput from "../../forms/Input/OFormInput.vue";

import { raw } from "@/types/i18n";

import OSettingRow from "./OSettingRow.vue";

const HELP = "Shortest password accepted";

const FormHost = defineComponent({
  components: { OForm, OFormInput, OSettingRow },
  props: { rowProps: { type: Object, default: () => ({}) } },
  setup: () => ({ schema: z.object({ min: z.string().min(1, "Min required") }), HELP }),
  template: `
    <OForm validate-on="leave" :schema="schema" :default-values="{ min: '8' }" @submit="() => {}">
      <OSettingRow label="Minimum length" :description="HELP" name="min" v-bind="rowProps">
        <OFormInput name="min" data-test="control" />
      </OSettingRow>
    </OForm>`,
});

async function mountWithRevealedError() {
  const wrapper = mount(FormHost, { attachTo: document.body });
  const input = wrapper.find("input");
  await input.setValue("");
  await input.trigger("blur");
  await flushPromises();
  return wrapper;
}

describe("OSettingRow", () => {
  it("renders the label and the description", () => {
    const wrapper = mount(OSettingRow, {
      props: { label: raw("Minimum length"), description: raw("Shortest password accepted") },
    });

    expect(wrapper.text()).toContain("Minimum length");
    expect(wrapper.text()).toContain("Shortest password accepted");
  });

  it("omits the description element when there is none", () => {
    const wrapper = mount(OSettingRow, { props: { label: raw("Require digit") } });

    expect(wrapper.text()).toContain("Require digit");
    expect(wrapper.find(".text-text-secondary").exists()).toBe(false);
  });

  it("renders the control in the default slot", () => {
    const wrapper = mount(OSettingRow, {
      props: { label: raw("Require digit") },
      slots: { default: '<button data-test="control">toggle</button>' },
    });

    expect(wrapper.find('[data-test="control"]').exists()).toBe(true);
  });

  it("drops its own rule on the last row, so a card needs no per-row conditionals", () => {
    const wrapper = mount(OSettingRow, { props: { label: raw("Require digit") } });

    expect(wrapper.classes()).toContain("border-b");
    expect(wrapper.classes()).toContain("last:border-b-0");
    expect(wrapper.find(".min-w-0").classes()).toContain("w-[22.5%]");
  });

  it("stacks the label above a full-width control below md", () => {
    const wrapper = mount(OSettingRow, {
      props: { label: raw("Require digit") },
      slots: { default: '<button data-test="control">toggle</button>' },
    });

    expect(wrapper.classes()).toEqual(
      expect.arrayContaining(["max-md:flex-col", "max-md:items-stretch"]),
    );
    expect(wrapper.find(".min-w-0").classes()).toContain("max-md:w-full");
    expect(wrapper.find('[data-test="control"]').element.parentElement?.classList).toContain(
      "max-md:justify-start",
    );
  });

  it("forwards data-test for addressing the row in page tests", () => {
    const wrapper = mount(OSettingRow, {
      props: { label: raw("Require digit"), dataTest: "settings-password-policy-require-digit" },
    });

    expect(wrapper.attributes("data-test")).toBe("settings-password-policy-require-digit");
  });

  it("row shows description, error or skeleton", async () => {
    const plain = (props: Record<string, unknown>, slots = {}) =>
      mount(OSettingRow, {
        props: { label: raw("Minimum length"), description: raw(HELP), dataTest: "row", ...props },
        slots: { default: '<button data-test="control">toggle</button>', ...slots },
      });
    const cases = [
      { name: "none", wrapper: plain({}), alert: undefined, help: true, control: true },
      {
        name: "rich description slot",
        wrapper: plain({ description: undefined }, { description: `<b>${HELP}</b>` }),
        alert: undefined,
        help: true,
        control: true,
      },
      {
        name: "error",
        wrapper: plain({ error: raw("Too short") }),
        alert: "Too short",
        errorAt: "row-error",
        help: false,
        control: true,
      },
      {
        name: "error with its own selector",
        wrapper: plain({ error: raw("Too short"), errorDataTest: "legacy-error" }),
        alert: "Too short",
        errorAt: "legacy-error",
        help: false,
        control: true,
      },
      { name: "loading", wrapper: plain({ loading: true }), alert: undefined, help: true },
      {
        name: "name with a revealed form error",
        wrapper: await mountWithRevealedError(),
        alert: "Min required",
        help: false,
        control: true,
      },
    ];

    for (const c of cases) {
      const alert = c.wrapper.find('[role="alert"]');
      expect(alert.exists() ? alert.text() : undefined, c.name).toBe(c.alert);
      if (c.errorAt) expect(c.wrapper.find(`[data-test="${c.errorAt}"]`).text()).toBe(c.alert);
      expect(c.wrapper.text().includes(HELP), c.name).toBe(c.help);
      expect(c.wrapper.find('[data-test="control"]').exists(), c.name).toBe(!!c.control);
      expect(c.wrapper.find('[aria-busy="true"]').exists(), c.name).toBe(!c.control);
    }
  });

  it("a wrapper inside a named row does not print a second message", async () => {
    const wrapper = await mountWithRevealedError();
    const alerts = wrapper.findAll('[role="alert"]');
    const input = wrapper.find("input");

    expect(alerts.map((a) => a.text())).toEqual(["Min required"]);
    expect(input.attributes("aria-invalid")).toBe("true");
    expect(input.attributes("aria-describedby")).toBe(alerts[0].attributes("id"));

    await input.setValue("12");
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain(HELP);
    expect(wrapper.find("input").attributes("aria-describedby")).toBeUndefined();
    expect(wrapper.find("input").element).toBe(input.element);
  });
});
