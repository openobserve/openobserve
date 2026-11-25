// Copyright 2026 OpenObserve Inc.

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import { z } from "zod";

import OForm from "../../forms/Form/OForm.vue";
import OFormInput from "../../forms/Input/OFormInput.vue";

import { raw } from "@/types/i18n";

import { SETTING_ROW_BARE_KEY, SETTING_ROW_GRID_KEY } from "./OSettingRow.types";
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
  it("drops its rule and side padding inside a bare form", () => {
    const wrapper = mount(OSettingRow, {
      props: { label: raw("Name"), dataTest: "row" },
      global: { provide: { [SETTING_ROW_BARE_KEY as symbol]: true } },
    });
    const classes = wrapper.find('[data-test="row"]').classes();
    expect(classes).toContain("py-2");
    expect(classes).not.toContain("border-b");
    expect(classes).not.toContain("px-3");
  });

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
  it("shows an info icon carrying the explanation only when info is set", () => {
    const plain = mount(OSettingRow, { props: { label: raw("Look back"), dataTest: "row" } });
    expect(plain.find('[data-test="row-info"]').exists()).toBe(false);

    const wrapper = mount(OSettingRow, {
      props: {
        label: raw("Look back"),
        info: raw("How much data each run reads"),
        dataTest: "row",
      },
    });
    expect(wrapper.find('[data-test="row-info"]').attributes("aria-label")).toBe(
      "How much data each run reads",
    );
  });

  it("marks a required setting after its label", () => {
    const wrapper = mount(OSettingRow, { props: { label: raw("Check every"), required: true } });

    expect(wrapper.text()).toContain("Check every *");
  });

  it("lets a fill row's control take the rest of the row from the top", () => {
    const wrapper = mount(OSettingRow, {
      props: { label: raw("Send to"), fill: true },
      slots: { default: '<div data-test="control">wide</div>' },
    });

    expect(wrapper.classes()).toContain("items-start");
    expect(wrapper.find('[data-test="control"]').element.parentElement?.className).toContain(
      "flex-1",
    );
  });
  it("grid mode puts actions in their own end column and the note under the control", () => {
    const slots = {
      default: '<button data-test="control">pick</button>',
      note: '<span data-test="note">Needs a destination first</span>',
      actions: '<button data-test="remove">Remove</button>',
    };
    const at = (props: Record<string, unknown>, provide = {}) =>
      mount(OSettingRow, {
        props: { label: raw("Must last"), ...props },
        slots,
        global: { provide },
      });
    const cases = [
      { name: "grid prop", wrapper: at({ grid: true }), columns: 3, actionsBeside: true },
      {
        name: "provided by the card",
        wrapper: at({}, { [SETTING_ROW_GRID_KEY as symbol]: true }),
        columns: 3,
        actionsBeside: true,
      },
      {
        name: "prop opts out of the card's grid",
        wrapper: at({ grid: false }, { [SETTING_ROW_GRID_KEY as symbol]: true }),
        columns: 2,
        actionsBeside: false,
      },
      { name: "wide control", wrapper: at({ grid: true, wide: true }), columns: 2 },
      { name: "no grid", wrapper: at({}), columns: 2, actionsBeside: false },
    ];

    for (const c of cases) {
      const columns = c.wrapper.element.children;
      const control = c.wrapper.find("[data-o-setting-row-control]").element;
      const note = c.wrapper.find('[data-test="note"]').element;
      const remove = c.wrapper.find('[data-test="remove"]');
      expect(columns.length, c.name).toBe(c.columns);
      expect(control.contains(note), c.name).toBe(true);
      expect(
        control.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_CONTAINED_BY &&
          c.wrapper.find('[data-test="control"]').element.compareDocumentPosition(note) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        c.name,
      ).toBeTruthy();
      if (c.actionsBeside === undefined) continue;
      expect(remove.exists(), c.name).toBe(true);
      expect(columns[2]?.contains(remove.element) ?? false, c.name).toBe(c.actionsBeside);
      expect(control.contains(remove.element), c.name).toBe(!c.actionsBeside);
    }
  });
});
