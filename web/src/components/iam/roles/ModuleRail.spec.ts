import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { raw } from "@/types/i18n";

vi.mock("@/aws-exports", () => ({
  default: { isCloud: "false", isEnterprise: "true" },
}));

import ModuleRail, { type RailModule } from "@/components/iam/roles/ModuleRail.vue";

const makeModule = (key: string, overrides: Partial<RailModule> = {}): RailModule => ({
  key,
  label: raw(key),
  icon: "window",
  groupId: "data",
  groupLabel: raw("Data"),
  granted: 0,
  added: 0,
  removed: 0,
  ...overrides,
});

async function mountRail(modules: RailModule[], modelValue = "") {
  const wrapper = mount(ModuleRail, {
    global: { plugins: [i18n, store] },
    props: { modules, modelValue },
  });
  await flushPromises();
  return wrapper;
}

const item = (wrapper: any, key: string) =>
  wrapper.find(`[data-test="edit-role-module-rail-item-${key}"]`);

describe("ModuleRail - structure", () => {
  it("always offers the summary above the modules", async () => {
    const wrapper = await mountRail([makeModule("logs")]);

    expect(item(wrapper, "summary").exists()).toBe(true);
  });

  it("renders one heading per group and one row per module", async () => {
    const wrapper = await mountRail([
      makeModule("logs"),
      makeModule("metrics"),
      makeModule("function", { groupId: "pipelines", groupLabel: raw("Pipelines") }),
    ]);

    const headings = wrapper
      .findAll('[data-test^="edit-role-module-rail-group-"]')
      .filter((node) => !node.attributes("data-test")!.includes("-toggle-"));

    expect(headings).toHaveLength(2);
    expect(item(wrapper, "logs").exists()).toBe(true);
    expect(item(wrapper, "function").exists()).toBe(true);
  });

  // A heading is navigation chrome; it must never be mistaken for a grantable row.
  it("renders group headings as plain text, not selectable tabs", async () => {
    const wrapper = await mountRail([makeModule("logs")]);
    const heading = wrapper.find('[data-test="edit-role-module-rail-group-data"]');

    expect(heading.attributes("role")).toBeUndefined();
    expect(heading.element.tagName).toBe("DIV");
  });
});

describe("ModuleRail - counts", () => {
  it("shows the granted count for a module that has grants", async () => {
    const wrapper = await mountRail([makeModule("logs", { granted: 12 })]);

    expect(item(wrapper, "logs").text()).toContain("12");
  });

  // The label is what the user navigates by, so large counts must not crowd it out.
  it("abbreviates a large granted count", async () => {
    const wrapper = await mountRail([makeModule("stream", { granted: 3506 })]);

    expect(item(wrapper, "stream").text()).toContain("3.5K");
    expect(item(wrapper, "stream").text()).not.toContain("3506");
  });

  it("shows no count badge for a module with no grants", async () => {
    const wrapper = await mountRail([makeModule("metrics")]);

    expect(item(wrapper, "metrics").text()).toBe("metrics");
  });

  it("marks unsaved changes with a dot instead of numbers", async () => {
    const wrapper = await mountRail([makeModule("logs", { granted: 4, added: 2, removed: 1 })]);

    expect(wrapper.find('[data-test="edit-role-module-rail-unsaved-logs"]').exists()).toBe(true);
    expect(item(wrapper, "logs").text()).not.toContain("+2");
    expect(item(wrapper, "logs").text()).not.toContain("-1");
  });

  it("shows no unsaved dot when nothing changed", async () => {
    const wrapper = await mountRail([makeModule("logs", { granted: 4 })]);

    expect(wrapper.find('[data-test="edit-role-module-rail-unsaved-logs"]').exists()).toBe(false);
  });

  it("keeps the exact numbers reachable in the row tooltip", async () => {
    const wrapper = await mountRail([makeModule("logs", { granted: 3506, added: 2, removed: 1 })]);

    const title = item(wrapper, "logs").attributes("title");
    expect(title).toContain("3506");
    expect(title).toContain("2");
    expect(title).toContain("1");
  });

  // Same idiom as the IAM section rail, so every module row leads with its glyph.
  it("leads each module row with its icon", async () => {
    const wrapper = await mountRail([makeModule("metrics")]);

    expect(item(wrapper, "metrics").find(".o-tab__icon").exists()).toBe(true);
  });
});

describe("ModuleRail - filter", () => {
  it("keeps only the modules whose label matches", async () => {
    const wrapper = await mountRail([
      makeModule("logs", { label: raw("Logs") }),
      makeModule("dfolder", { label: raw("Dashboard Folders") }),
    ]);

    await wrapper.find('[data-test="edit-role-module-rail-search"] input').setValue("dash");

    expect(item(wrapper, "dfolder").exists()).toBe(true);
    expect(item(wrapper, "logs").exists()).toBe(false);
  });

  it("drops a heading once none of its modules match", async () => {
    const wrapper = await mountRail([
      makeModule("logs", { label: raw("Logs") }),
      makeModule("function", {
        label: raw("Functions"),
        groupId: "pipelines",
        groupLabel: raw("Pipelines"),
      }),
    ]);

    await wrapper.find('[data-test="edit-role-module-rail-search"] input').setValue("func");

    expect(wrapper.find('[data-test="edit-role-module-rail-group-data"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="edit-role-module-rail-group-pipelines"]').exists()).toBe(true);
  });

  it("shows the empty state when nothing matches", async () => {
    const wrapper = await mountRail([makeModule("logs", { label: raw("Logs") })]);

    await wrapper.find('[data-test="edit-role-module-rail-search"] input').setValue("zzz");

    expect(wrapper.find('[data-test="edit-role-module-rail-no-match"]').exists()).toBe(true);
  });
});

describe("ModuleRail - granted scope", () => {
  const modules = [makeModule("metrics", { granted: 3 }), makeModule("templates")];

  it("keeps only the modules that hold grants once the scope is granted", async () => {
    const wrapper = await mountRail(modules);

    await wrapper.find('[data-test="edit-role-module-rail-scope-granted"]').trigger("click");

    expect(item(wrapper, "metrics").exists()).toBe(true);
    expect(item(wrapper, "templates").exists()).toBe(false);
  });

  // The whole-grid view has to stay reachable, or a filter can strand the user.
  it("keeps the summary visible under every scope", async () => {
    const wrapper = await mountRail(modules);

    await wrapper.find('[data-test="edit-role-module-rail-scope-granted"]').trigger("click");

    expect(item(wrapper, "summary").exists()).toBe(true);
  });

  it("counts the modules that hold grants on the scope control", async () => {
    const wrapper = await mountRail(modules);

    expect(wrapper.find('[data-test="edit-role-module-rail-scope-granted"]').text()).toContain("1");
  });

  it("explains an empty granted scope", async () => {
    const wrapper = await mountRail([makeModule("templates")]);

    await wrapper.find('[data-test="edit-role-module-rail-scope-granted"]').trigger("click");

    expect(wrapper.find('[data-test="edit-role-module-rail-no-match"]').exists()).toBe(true);
  });
});

describe("ModuleRail - selection", () => {
  it("emits the module key when a row is chosen", async () => {
    const wrapper = await mountRail([makeModule("logs")]);

    // Reka's TabsTrigger activates on mousedown, not click.
    await item(wrapper, "logs").trigger("mousedown");

    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["logs"]);
  });
});

describe("ModuleRail - collapsible groups", () => {
  const header = (wrapper: any, groupId: string) =>
    wrapper.find(`[data-test="edit-role-module-rail-group-${groupId}"]`);

  it("hides a group's modules when its header is clicked, and shows them again", async () => {
    const wrapper = await mountRail([makeModule("logs")]);

    await header(wrapper, "data").trigger("click");
    expect(item(wrapper, "logs").exists()).toBe(false);
    expect(header(wrapper, "data").attributes("aria-expanded")).toBe("false");

    await header(wrapper, "data").trigger("click");
    expect(item(wrapper, "logs").exists()).toBe(true);
  });

  // A folded group must not hide a match, or the search looks broken.
  it("opens every group while a search is active", async () => {
    const wrapper = await mountRail([makeModule("logs", { label: raw("Logs") })]);
    await header(wrapper, "data").trigger("click");

    await wrapper.find('[data-test="edit-role-module-rail-search"] input').setValue("log");

    expect(item(wrapper, "logs").exists()).toBe(true);
  });

  // Opening a module from a summary card must never leave the selected row folded away.
  it("unfolds the group of a module selected from outside the rail", async () => {
    const wrapper = await mountRail([makeModule("logs")]);
    await header(wrapper, "data").trigger("click");

    await wrapper.setProps({ modelValue: "logs" });

    expect(item(wrapper, "logs").exists()).toBe(true);
  });
});
