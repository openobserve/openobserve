import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { raw } from "@/types/i18n";

vi.mock("@/aws-exports", () => ({
  default: { isCloud: "false", isEnterprise: "true" },
}));

import ModulePane, { type ScopeRow } from "@/components/iam/roles/ModulePane.vue";

const ACTIONS = ["AllowAll", "AllowList", "AllowGet", "AllowPost", "AllowPut", "AllowDelete"];

const makePermission = (granted: string[] = []) =>
  Object.fromEntries(
    ACTIONS.map((action) => [action, { show: true, value: granted.includes(action) }]),
  );

const makeNode = (name: string, granted: string[] = [], resourceName = "metrics") => ({
  name,
  display_name: name,
  resourceName,
  permission: makePermission(granted),
});

const makeScope = (
  key: string,
  granted: string[] = [],
  covers: string[] = ["metrics"],
  resource = key,
): ScopeRow => ({
  key,
  node: makeNode(key, granted, resource),
  resource,
  covers,
  label: raw(key),
  hint: raw(""),
});

// Tests hold grant state on the node itself; the real page reads the grant store.
const isGranted = (node: any, action: string) => !!node.permission?.[action]?.value;

const isPendingRemoval = () => false;

async function mountPane(
  scopes: ScopeRow[],
  entities: any[],
  trail = [raw("Metrics")],
  extra: Record<string, unknown> = {},
) {
  const wrapper = mount(ModulePane, {
    global: { plugins: [i18n, store, router] },
    props: {
      trail,
      scopes,
      entities,
      loading: false,
      isGranted,
      isPendingRemoval,
      listsResources: true,
      innerGrants: () => ({ count: 0, names: [] }),
      ...extra,
    },
  });
  await flushPromises();
  return wrapper;
}

// OCheckbox puts data-test on its label; the disabled state lives on the inner button.
const entityBox = (wrapper: any, row: string, action: string) =>
  wrapper.find(
    `[data-test="edit-role-permissions-table-body-row-${row}-col-${action}-checkbox"] button[role="checkbox"]`,
  );

const scopeBox = (wrapper: any, scope: string, action: string) =>
  wrapper.find(
    `[data-test="edit-role-module-pane-scope-${scope}-${action}"] button[role="checkbox"]`,
  );

// The page header and cut-off labels carry tooltips of their own, so pick the one wrapping the badge.
const insideBadgeTooltip = (wrapper: any, folderName: string) =>
  wrapper
    .findAllComponents({ name: "OTooltip" })
    .find((tip: any) =>
      tip.find(`[data-test="edit-role-module-pane-inside-${folderName}"]`).exists(),
    );

describe("ModulePane - scope ladder", () => {
  it("renders every scope above the resource list", async () => {
    const wrapper = await mountPane([makeScope("stream"), makeScope("metrics")], [makeNode("cpu")]);

    expect(scopeBox(wrapper, "stream", "AllowGet").exists()).toBe(true);
    expect(scopeBox(wrapper, "metrics", "AllowGet").exists()).toBe(true);
    expect(entityBox(wrapper, "cpu", "AllowGet").exists()).toBe(true);
  });

  it("leaves a resource editable when no scope covers the action", async () => {
    const wrapper = await mountPane([makeScope("metrics")], [makeNode("cpu")]);

    expect(entityBox(wrapper, "cpu", "AllowGet").attributes("disabled")).toBeUndefined();
  });
});

describe("ModulePane - inheritance", () => {
  it("locks a resource action that a wider scope already grants", async () => {
    const wrapper = await mountPane([makeScope("metrics", ["AllowGet"])], [makeNode("cpu")]);

    expect(entityBox(wrapper, "cpu", "AllowGet").attributes("disabled")).toBeDefined();
    expect(entityBox(wrapper, "cpu", "AllowList").attributes("disabled")).toBeUndefined();
  });

  it("locks every resource action when a wider scope grants all", async () => {
    const wrapper = await mountPane([makeScope("metrics", ["AllowAll"])], [makeNode("cpu")]);

    ACTIONS.forEach((action) => {
      expect(entityBox(wrapper, "cpu", action).attributes("disabled")).toBeDefined();
    });
  });

  it("locks a narrower scope under a wider one", async () => {
    const wrapper = await mountPane(
      [makeScope("stream", ["AllowGet"]), makeScope("metrics")],
      [makeNode("cpu")],
    );

    expect(scopeBox(wrapper, "stream", "AllowGet").attributes("disabled")).toBeUndefined();
    expect(scopeBox(wrapper, "metrics", "AllowGet").attributes("disabled")).toBeDefined();
  });

  // Inheritance only flows downwards: a narrow grant never locks a wider scope.
  it("never locks a wider scope because of a narrower grant", async () => {
    const wrapper = await mountPane(
      [makeScope("stream"), makeScope("metrics", ["AllowAll"])],
      [makeNode("cpu")],
    );

    expect(scopeBox(wrapper, "stream", "AllowGet").attributes("disabled")).toBeUndefined();
  });
});

describe("ModulePane - resources", () => {
  it("filters the resource list by name", async () => {
    const wrapper = await mountPane([makeScope("metrics")], [makeNode("cpu"), makeNode("memory")]);

    await wrapper.find('[data-test="edit-role-module-pane-search"] input').setValue("mem");

    expect(entityBox(wrapper, "memory", "AllowGet").exists()).toBe(true);
    expect(entityBox(wrapper, "cpu", "AllowGet").exists()).toBe(false);
  });

  it("pages a long resource list instead of rendering it all", async () => {
    const entities = Array.from({ length: 60 }, (_, i) => makeNode(`stream_${i}`));
    const wrapper = await mountPane([makeScope("metrics")], entities);

    expect(entityBox(wrapper, "stream_0", "AllowGet").exists()).toBe(true);
    expect(entityBox(wrapper, "stream_59", "AllowGet").exists()).toBe(false);
  });

  it("counts the resources that hold any grant", async () => {
    const wrapper = await mountPane(
      [makeScope("metrics")],
      [makeNode("cpu", ["AllowGet"]), makeNode("memory")],
    );

    expect(wrapper.text()).toContain(
      String(i18n.global.t("iam.editRole.moduleGrantedCount", { count: 1 })),
    );
  });
});

describe("ModulePane - changes", () => {
  it("emits the row, the action and the new value", async () => {
    const node = makeNode("cpu");
    const wrapper = await mountPane([makeScope("metrics")], [node]);

    await entityBox(wrapper, "cpu", "AllowGet").trigger("click");

    const emitted = wrapper.emitted("change")?.at(-1)?.[0] as any;
    expect(emitted.row).toStrictEqual(node);
    expect(emitted.permission).toBe("AllowGet");
    expect(emitted.newValue).toBe(true);
  });
});

describe("ModulePane - coverage", () => {
  // A folder grant is not yet confirmed to reach its dashboards, so it must lock nothing.
  it("locks nothing below a scope that declares no coverage", async () => {
    const wrapper = await mountPane(
      [makeScope("folder-sre", ["AllowAll"], [], "dfolder")],
      [makeNode("sre/latency", [], "dashboard")],
    );

    expect(entityBox(wrapper, "sre/latency", "AllowGet").attributes("disabled")).toBeUndefined();
  });

  it("only locks rows of the resource types a scope covers", async () => {
    const wrapper = await mountPane(
      [makeScope("dfolder", ["AllowGet"], ["dfolder"])],
      [makeNode("sre", [], "dfolder"), makeNode("sre/latency", [], "dashboard")],
    );

    expect(entityBox(wrapper, "sre", "AllowGet").attributes("disabled")).toBeDefined();
    expect(entityBox(wrapper, "sre/latency", "AllowGet").attributes("disabled")).toBeUndefined();
  });
});

describe("ModulePane - granted filter", () => {
  it("keeps only resources that hold a grant of their own", async () => {
    const wrapper = await mountPane(
      [makeScope("metrics")],
      [makeNode("cpu", ["AllowGet"]), makeNode("memory")],
    );

    await wrapper.find('[data-test="edit-role-module-pane-filter-granted"]').trigger("click");

    expect(entityBox(wrapper, "cpu", "AllowGet").exists()).toBe(true);
    expect(entityBox(wrapper, "memory", "AllowGet").exists()).toBe(false);
  });
});

describe("ModulePane - folders", () => {
  it("offers to open a resource that has children", async () => {
    const folder = {
      ...makeNode("sre", [], "dfolder"),
      has_entities: true,
      childName: "dashboard",
    };
    const wrapper = await mountPane([makeScope("dfolder", [], ["dfolder"])], [folder]);

    await wrapper.find('[data-test="edit-role-module-pane-open-sre"]').trigger("click");

    expect(wrapper.emitted("open")?.at(-1)?.[0]).toStrictEqual(folder);
  });

  it("renders a leaf resource as plain text", async () => {
    const wrapper = await mountPane([makeScope("metrics")], [makeNode("cpu")]);

    expect(wrapper.find('[data-test="edit-role-module-pane-open-cpu"]').exists()).toBe(false);
  });

  // Drill-down follows the app's OPageHeader back pattern rather than a text breadcrumb.
  it("offers a back button to the parent level once drilled in", async () => {
    const wrapper = await mountPane(
      [makeScope("dfolder", [], ["dfolder"])],
      [],
      [raw("Dashboard Folders"), raw("SRE")],
    );

    const back = wrapper.find('[data-test="edit-role-module-pane-back"]');
    expect(back.attributes("aria-label")).toContain("Dashboard Folders");
    await back.trigger("click");

    expect(wrapper.emitted("navigate")?.at(-1)).toEqual([0]);
    expect(wrapper.find('[data-test="edit-role-module-pane-title"]').text()).toBe("SRE");
  });

  it("shows no back button at a module's top level", async () => {
    const wrapper = await mountPane([makeScope("metrics")], [], [raw("Streams")]);

    expect(wrapper.find('[data-test="edit-role-module-pane-back"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="edit-role-module-pane-title"]').text()).toBe("Streams");
  });
});

describe("ModulePane - hidden scopes", () => {
  it("does not draw a hidden scope", async () => {
    const hidden = { ...makeScope("stream", [], ["metrics"]), hidden: true };
    const wrapper = await mountPane([hidden, makeScope("metrics")], [makeNode("cpu")]);

    expect(scopeBox(wrapper, "stream", "AllowGet").exists()).toBe(false);
    expect(scopeBox(wrapper, "metrics", "AllowGet").exists()).toBe(true);
  });

  // Hiding the row must not unlock what it grants, or a revoke would look possible and do nothing.
  it("still locks the rows a hidden scope grants", async () => {
    const hidden = { ...makeScope("stream", ["AllowGet"], ["metrics"]), hidden: true };
    const wrapper = await mountPane([hidden, makeScope("metrics")], [makeNode("cpu")]);

    expect(scopeBox(wrapper, "metrics", "AllowGet").attributes("disabled")).toBeDefined();
    expect(entityBox(wrapper, "cpu", "AllowGet").attributes("disabled")).toBeDefined();
  });
});

describe("ModulePane - unsaved counts", () => {
  it("shows the exact added and removed counts the rail only marks", async () => {
    const wrapper = mount(ModulePane, {
      global: { plugins: [i18n, store, router] },
      props: {
        trail: [raw("Streams")],
        scopes: [],
        entities: [],
        loading: false,
        isGranted,
        isPendingRemoval,
        listsResources: true,
        innerGrants: () => ({ count: 0, names: [] }),
        added: 2,
        removed: 1,
      },
    });
    await flushPromises();

    expect(wrapper.find('[data-test="edit-role-module-pane-added"]').text()).toContain("2");
    expect(wrapper.find('[data-test="edit-role-module-pane-removed"]').text()).toContain("1");
  });
});

describe("ModulePane - own grant under a wider scope", () => {
  // A row with its own grant stays editable, or revoking the wider scope would leave that grant behind unseen.
  it("keeps the row editable and says both sources grant it", async () => {
    const wrapper = await mountPane(
      [makeScope("metrics", ["AllowGet"])],
      [makeNode("cpu", ["AllowGet"])],
    );
    const box = entityBox(wrapper, "cpu", "AllowGet");

    expect(box.attributes("disabled")).toBeUndefined();
    expect(box.attributes("aria-checked")).toBe("true");
  });

  // Unticking must visibly change the box; otherwise the click looks ignored and the removal is silent.
  it("reads unchecked and stays editable once its own grant is staged for removal", async () => {
    const cpu = makeNode("cpu");
    const wrapper = await mountPane([makeScope("metrics", ["AllowGet"])], [cpu], [raw("Metrics")], {
      isPendingRemoval: (node: any, action: string) => node.name === "cpu" && action === "AllowGet",
    });
    const box = entityBox(wrapper, "cpu", "AllowGet");

    expect(box.attributes("aria-checked")).toBe("false");
    expect(box.attributes("disabled")).toBeUndefined();
  });

  it("stays locked when the row holds no grant of its own", async () => {
    const wrapper = await mountPane([makeScope("metrics", ["AllowGet"])], [makeNode("cpu")]);

    expect(entityBox(wrapper, "cpu", "AllowGet").attributes("disabled")).toBeDefined();
  });
});

describe("ModulePane - effective grants", () => {
  // The count and the Granted filter must agree with the ticked boxes, including inherited ones.
  it("counts and keeps rows granted only by a wider scope", async () => {
    const wrapper = await mountPane(
      [makeScope("metrics", ["AllowAll"])],
      [makeNode("cpu"), makeNode("mem")],
    );

    expect(wrapper.text()).toContain(
      String(i18n.global.t("iam.editRole.moduleGrantedCount", { count: 2 })),
    );
    await wrapper.find('[data-test="edit-role-module-pane-filter-granted"]').trigger("click");
    expect(entityBox(wrapper, "cpu", "AllowGet").exists()).toBe(true);
    expect(entityBox(wrapper, "mem", "AllowGet").exists()).toBe(true);
  });
});

describe("ModulePane - loaded lists", () => {
  const rowOrder = (wrapper: any) =>
    wrapper
      .findAll('[data-test$="-col-AllowGet-checkbox"]')
      .map((node: any) => node.attributes("data-test"))
      .filter((test: string) => test.startsWith("edit-role-permissions-table-body-row-"))
      .map(
        (test: string) =>
          test.replace("edit-role-permissions-table-body-row-", "").split("-col-")[0],
      );

  // The page pushes loaded rows into the same array, so the ordering must not depend on its identity.
  it("lifts granted rows to the top after rows arrive in the same array", async () => {
    const entities = reactive<any[]>([]);
    const wrapper = await mountPane([], entities);

    entities.push(
      makeNode("a"),
      makeNode("b", ["AllowGet"]),
      makeNode("c"),
      makeNode("d", ["AllowGet"]),
    );
    await flushPromises();

    expect(rowOrder(wrapper).slice(0, 2)).toEqual(["b", "d"]);
  });

  // Unticking the last row of the last page shrinks the list; the page must follow instead of going empty.
  it("moves back to the last page when the list shrinks under it", async () => {
    const entities = reactive(
      Array.from({ length: 30 }, (_, i) => makeNode(`r${String(i).padStart(2, "0")}`)),
    );
    const wrapper = await mountPane([], entities);
    (wrapper.vm as any).page = 2;
    await flushPromises();

    entities.splice(25);
    await flushPromises();

    expect(rowOrder(wrapper)).toHaveLength(25);
  });

  // Nothing may be ticked before the saved grants land, or a click can stage a key that is already saved.
  it("offers no clickable box while the grants are loading", async () => {
    const wrapper = await mountPane([], [makeNode("cpu")], [raw("Metrics")], { loading: true });

    expect(wrapper.findAll('button[role="checkbox"]:not([disabled])')).toHaveLength(0);
  });
});

describe("ModulePane - empty module", () => {
  // A module with nothing to list must not offer a pager over zero rows.
  it("drops the pagination bar and explains what the scope still covers", async () => {
    const wrapper = await mountPane([makeScope("enrichment_table", [], ["enrichment_table"])], []);

    expect(wrapper.find('[data-test="o2-table-pagination-bottom"]').exists()).toBe(false);
    const note = wrapper.find('[data-test="edit-role-module-pane-no-resources"]');
    expect(note.text()).toContain(String(i18n.global.t("iam.editRole.moduleHasNoResources")));
    expect(note.text()).toContain(String(i18n.global.t("iam.editRole.moduleHasNoResourcesHint")));
  });

  it("shows no empty state for a module that never lists resources", async () => {
    const wrapper = await mountPane(
      [makeScope("search_jobs", [], ["search_jobs"])],
      [],
      undefined,
      {
        listsResources: false,
      },
    );

    expect(wrapper.find('[data-test="edit-role-module-pane-no-resources"]').exists()).toBe(false);
  });

  it("still draws the scope row so the type level grant stays editable", async () => {
    const wrapper = await mountPane([makeScope("enrichment_table", [], ["enrichment_table"])], []);

    expect(scopeBox(wrapper, "enrichment_table", "AllowGet").exists()).toBe(true);
  });

  it("keeps the pager once the module has resources", async () => {
    const wrapper = await mountPane([], [makeNode("cpu")]);

    expect(wrapper.find('[data-test="o2-table-pagination-bottom"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="edit-role-module-pane-no-resources"]').exists()).toBe(false);
  });
});

describe("ModulePane - filter matches nothing", () => {
  // A dead end is worse than an empty list: the way back must be one click.
  it("offers to clear a search that matched nothing", async () => {
    const wrapper = await mountPane([], [makeNode("cpu"), makeNode("mem")]);
    await wrapper.find('[data-test="edit-role-module-pane-search"] input').setValue("zzz");

    expect(wrapper.find('[data-test="edit-role-module-pane-no-match"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="edit-role-module-pane-no-resources"]').exists()).toBe(false);

    await wrapper.find('[data-test="edit-role-module-pane-clear-filter"]').trigger("click");

    expect(wrapper.find('[data-test="edit-role-module-pane-no-match"]').exists()).toBe(false);
    expect(entityBox(wrapper, "cpu", "AllowGet").exists()).toBe(true);
  });

  it("clears the Selected filter too, so a selected-only view is not a dead end", async () => {
    const wrapper = await mountPane([], [makeNode("cpu"), makeNode("mem")]);
    await wrapper.find('[data-test="edit-role-module-pane-filter-granted"]').trigger("click");

    expect(wrapper.find('[data-test="edit-role-module-pane-no-match"]').exists()).toBe(true);

    await wrapper.find('[data-test="edit-role-module-pane-clear-filter"]').trigger("click");

    expect(entityBox(wrapper, "cpu", "AllowGet").exists()).toBe(true);
  });
});

describe("ModulePane - search bar", () => {
  // Hiding it at one row made the same screen look different from org to org.
  it("offers search for a list with a single row", async () => {
    const wrapper = await mountPane([], [makeNode("cpu")]);

    expect(wrapper.find('[data-test="edit-role-module-pane-search"]').exists()).toBe(true);
  });

  // Search Jobs, Service Streams and the like are one org-wide grant, not a list.
  it("hides search for a module whose only row is its own grant", async () => {
    const wrapper = await mountPane([], [makeNode("search_jobs")], [raw("Search Jobs")], {
      listsResources: false,
    });

    expect(wrapper.find('[data-test="edit-role-module-pane-search"]').exists()).toBe(false);
  });

  // One row needs no pager; "Showing 1 - 1 of 1" is noise under an org-wide grant.
  it("drops the pagination footer for a module whose only row is its own grant", async () => {
    const wrapper = await mountPane([], [makeNode("search_jobs")], [raw("Search Jobs")], {
      listsResources: false,
    });

    expect(wrapper.find('[data-test^="o2-table-pagination"]').exists()).toBe(false);
  });

  it("keeps the pagination footer for a real list", async () => {
    const wrapper = await mountPane([], [makeNode("cpu")]);

    expect(wrapper.find('[data-test^="o2-table-pagination"]').exists()).toBe(true);
  });

  it("hides search when there is nothing to search", async () => {
    const wrapper = await mountPane([], []);

    expect(wrapper.find('[data-test="edit-role-module-pane-search"]').exists()).toBe(false);
  });
});

describe("ModulePane - grants one level down", () => {
  const folder = (name: string) => ({ ...makeNode(name), has_entities: true, childName: "traces" });

  // A drill-in row's own boxes cannot show a stream granted inside it, so the row flags it inline.
  it("flags a drill-in row with a count of what is granted inside it, names on hover", async () => {
    const wrapper = await mountPane([], [folder("traces"), folder("logs")], [raw("Streams")], {
      innerGrants: (node: any) =>
        node.name === "traces" ? { count: 1, names: ["_evaluator"] } : { count: 0, names: [] },
    });

    expect(wrapper.find('[data-test="edit-role-module-pane-inside-traces"]').text()).toBe(
      String(i18n.global.t("iam.editRole.grantedInsideCount", { count: 1 })),
    );
    expect(insideBadgeTooltip(wrapper, "traces").props("content")).toBe(
      String(i18n.global.t("iam.editRole.grantedInside", { names: "_evaluator" })),
    );
    expect(wrapper.find('[data-test="edit-role-module-pane-inside-logs"]').exists()).toBe(false);
  });

  it("names what it was given on hover and counts the rest", async () => {
    const names = Array.from({ length: 10 }, (_, i) => `s${i}`);
    const wrapper = await mountPane([], [folder("traces")], [raw("Streams")], {
      innerGrants: () => ({ count: 12, names }),
    });

    expect(insideBadgeTooltip(wrapper, "traces").props("content")).toBe(
      String(i18n.global.t("iam.editRole.grantedInsideMore", { names: names.join(", "), more: 2 })),
    );
  });

  // Otherwise a role granted only on a stream inside Traces would have no path to it under Selected.
  it("keeps a row under Selected when only something inside it is granted", async () => {
    const wrapper = await mountPane([], [folder("traces"), folder("logs")], [raw("Streams")], {
      innerGrants: (node: any) =>
        node.name === "traces" ? { count: 1, names: ["_evaluator"] } : { count: 0, names: [] },
    });

    await wrapper.find('[data-test="edit-role-module-pane-filter-granted"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test="edit-role-module-pane-open-traces"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="edit-role-module-pane-open-logs"]').exists()).toBe(false);
  });
});

describe("ModulePane - empty states wait for the load", () => {
  // Rows are empty until the fetch lands, so an empty note shown then would be false.
  it("shows neither empty note while the list is loading", async () => {
    const wrapper = await mountPane([], [], [raw("Metrics")], { loading: true });

    expect(wrapper.find('[data-test="edit-role-module-pane-no-resources"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="edit-role-module-pane-no-match"]').exists()).toBe(false);
  });

  it("says the module is empty once loading ends with no rows", async () => {
    const wrapper = await mountPane([], [], [raw("Metrics")], { loading: false });

    expect(wrapper.find('[data-test="edit-role-module-pane-no-resources"]').exists()).toBe(true);
  });
});

describe("ModulePane - column select all", () => {
  const ALL_MODULES = [raw("All Modules")];

  const bulkBox = (wrapper: any, action: string) =>
    wrapper.find(`[data-test="edit-role-module-pane-bulk-${action}"] button[role="checkbox"]`);

  const mountBulk = (entities: any[]) =>
    mountPane([], entities, ALL_MODULES, { listsModules: true });

  const emittedRows = (wrapper: any) =>
    (wrapper.emitted("change") ?? []).map(([change]: any) => [change.row.name, change.newValue]);

  it("reads unticked, mixed and ticked from the rows it covers", async () => {
    const none = await mountBulk([makeNode("logs"), makeNode("alert")]);
    const some = await mountBulk([makeNode("logs", ["AllowList"]), makeNode("alert")]);
    const all = await mountBulk([
      makeNode("logs", ["AllowList"]),
      makeNode("alert", ["AllowList"]),
    ]);

    expect(bulkBox(none, "AllowList").attributes("aria-checked")).toBe("false");
    expect(bulkBox(some, "AllowList").attributes("aria-checked")).toBe("mixed");
    expect(bulkBox(all, "AllowList").attributes("aria-checked")).toBe("true");
    expect(bulkBox(none, "AllowList").attributes("aria-label")).toBe(
      String(i18n.global.t("iam.editRole.bulkSelectColumn", { action: i18n.global.t("iam.list") })),
    );
  });

  // A row that hides the action has no box to show the grant, so the header must not stage one.
  it("ticks the action once on each unticked row that offers it", async () => {
    const settings = makeNode("settings");
    settings.permission.AllowList.show = false;
    const wrapper = await mountBulk([
      makeNode("logs"),
      makeNode("alert", ["AllowList"]),
      settings,
      makeNode("role"),
    ]);

    await bulkBox(wrapper, "AllowList").trigger("click");

    expect(emittedRows(wrapper)).toEqual([
      ["logs", true],
      ["role", true],
    ]);
    expect(wrapper.emitted("change")![0][0]).toMatchObject({ permission: "AllowList" });
  });

  it("unticks every row once all of them hold the action", async () => {
    const wrapper = await mountBulk([
      makeNode("logs", ["AllowGet"]),
      makeNode("alert", ["AllowGet"]),
    ]);

    await bulkBox(wrapper, "AllowGet").trigger("click");

    expect(emittedRows(wrapper)).toEqual([
      ["logs", false],
      ["alert", false],
    ]);
  });

  it("reaches only the rows the search keeps", async () => {
    const wrapper = await mountBulk([makeNode("logs"), makeNode("alert"), makeNode("logs_cache")]);

    await wrapper.find('[data-test="edit-role-module-pane-search"] input').setValue("logs");
    await bulkBox(wrapper, "AllowList").trigger("click");

    expect(emittedRows(wrapper)).toEqual([
      ["logs", true],
      ["logs_cache", true],
    ]);
  });

  it("reaches rows on later pages, not just the one on screen", async () => {
    const entities = Array.from({ length: 30 }, (_, i) => makeNode(`module_${i}`));
    const wrapper = await mountBulk(entities);

    await bulkBox(wrapper, "AllowList").trigger("click");

    expect(wrapper.emitted("change")).toHaveLength(30);
  });

  it("offers no header box outside the All Modules view", async () => {
    const wrapper = await mountPane([makeScope("metrics")], [makeNode("cpu")]);

    expect(wrapper.find('[data-test^="edit-role-module-pane-bulk-"]').exists()).toBe(false);
  });

  it("locks the header box while the role loads", async () => {
    const wrapper = await mountPane([], [makeNode("logs")], ALL_MODULES, {
      listsModules: true,
      loading: true,
    });

    expect(bulkBox(wrapper, "AllowList").attributes("disabled")).toBeDefined();
  });

  it("locks the header box once the search leaves no module", async () => {
    const wrapper = await mountBulk([makeNode("logs")]);

    await wrapper.find('[data-test="edit-role-module-pane-search"] input').setValue("nothing");

    expect(bulkBox(wrapper, "AllowList").attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-test="edit-role-module-pane-no-match"]').text()).toContain(
      String(i18n.global.t("iam.editRole.noModuleMatch")),
    );
  });

  it("words the column and the search for modules, not resources", async () => {
    const wrapper = await mountBulk([makeNode("logs")]);

    expect(wrapper.text()).toContain(String(i18n.global.t("iam.editRole.moduleColumn")));
    expect(
      wrapper.find('[data-test="edit-role-module-pane-search"] input').attributes("placeholder"),
    ).toBe(String(i18n.global.t("iam.editRole.filterModules")));
  });

  // All Modules can open before the grants load; its rows never change, so the order must follow the load.
  it("moves granted modules to the top once the load ends", async () => {
    const alert = makeNode("alert");
    const wrapper = await mountPane([], [makeNode("logs"), alert], ALL_MODULES, {
      listsModules: true,
      loading: true,
    });

    alert.permission.AllowList.value = true;
    await wrapper.setProps({ loading: false });

    // The table swaps its loading body for rows asynchronously, so wait for the rows rather than one tick.
    const order = () =>
      wrapper
        .findAll('[data-test^="edit-role-module-pane-open-"]')
        .map((row) => row.attributes("data-test"));
    await vi.waitFor(() =>
      expect(order()).toEqual([
        "edit-role-module-pane-open-alert",
        "edit-role-module-pane-open-logs",
      ]),
    );
  });

  // Every row is a module, so even one with no items (Search Jobs) opens like the rest.
  it("offers to open every module row, with or without items", async () => {
    const searchJobs = makeNode("search_jobs");
    const wrapper = await mountBulk([makeNode("logs"), searchJobs]);

    expect(wrapper.find('[data-test="edit-role-module-pane-open-logs"]').exists()).toBe(true);
    await wrapper.find('[data-test="edit-role-module-pane-open-search_jobs"]').trigger("click");

    expect(wrapper.emitted("open")?.at(-1)?.[0]).toStrictEqual(searchJobs);
  });
});
