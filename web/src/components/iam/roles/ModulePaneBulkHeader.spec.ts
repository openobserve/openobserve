import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import ModulePaneBulkHeader from "@/components/iam/roles/ModulePaneBulkHeader.vue";

const mountHeader = (props: Record<string, unknown> = {}) =>
  mount(ModulePaneBulkHeader, {
    global: { plugins: [i18n] },
    props: { action: "AllowList", label: raw("List"), state: false, disabled: false, ...props },
  });

// OCheckbox puts data-test on its label; state, name and disabled live on the inner button.
const box = (wrapper: any, action = "AllowList") =>
  wrapper.find(`[data-test="edit-role-module-pane-bulk-${action}"] button[role="checkbox"]`);

const hintFor = (label: string) =>
  String(i18n.global.t("iam.editRole.bulkSelectColumn", { action: label }));

describe("ModulePaneBulkHeader", () => {
  it.each([
    [false, "false"],
    [true, "true"],
    ["indeterminate", "mixed"],
  ])("reads %s as aria-checked %s", (state, ariaChecked) => {
    const wrapper = mountHeader({ state });

    expect(box(wrapper).attributes("aria-checked")).toBe(ariaChecked);
  });

  it("shows the column name beside the box", () => {
    const wrapper = mountHeader();

    expect(wrapper.text()).toBe("List");
  });

  // The box has no visible text of its own, so its name must say what one click does.
  it("names the box for screen readers and on hover", () => {
    const wrapper = mountHeader();

    expect(box(wrapper).attributes("aria-label")).toBe(hintFor("List"));
    // title is not an OCheckbox prop, so it lands on the label that wraps the box.
    expect(
      wrapper.find('[data-test="edit-role-module-pane-bulk-AllowList"]').attributes("title"),
    ).toBe(hintFor("List"));
  });

  it("renames the box when the column label changes", async () => {
    const wrapper = mountHeader();

    await wrapper.setProps({ label: raw("Get") });

    expect(box(wrapper).attributes("aria-label")).toBe(hintFor("Get"));
  });

  it("keys its test hook by the column's action", () => {
    const wrapper = mountHeader({ action: "AllowDelete" });

    expect(box(wrapper, "AllowDelete").exists()).toBe(true);
  });

  // The pane decides what a click means from the rows, so the header only reports it, once, from any state.
  it.each([false, true, "indeterminate"])("emits one toggle per click from %s", async (state) => {
    const wrapper = mountHeader({ state });

    await box(wrapper).trigger("click");

    expect(wrapper.emitted("toggle")).toHaveLength(1);
  });

  it("emits a toggle for every click, not just the first", async () => {
    const wrapper = mountHeader();

    await box(wrapper).trigger("click");
    await box(wrapper).trigger("click");

    expect(wrapper.emitted("toggle")).toHaveLength(2);
  });

  it("refuses clicks while disabled", async () => {
    const wrapper = mountHeader({ disabled: true });

    await box(wrapper).trigger("click");

    expect(box(wrapper).attributes("disabled")).toBeDefined();
    expect(wrapper.emitted("toggle")).toBeUndefined();
  });

  // Side padding pushes the box off the column of row boxes below it; vertical padding only keeps the focus ring.
  it("adds no side padding, so the box lines up with the row boxes", () => {
    const wrapper = mountHeader();
    const classes = wrapper.classes();

    expect(classes).toContain("py-1");
    expect(classes.filter((name) => /^-?(p|px|ps|pe|pl|pr|m|mx|ms|me|ml|mr)-/.test(name))).toEqual(
      [],
    );
  });
});
