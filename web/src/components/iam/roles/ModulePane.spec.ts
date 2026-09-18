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
    props: { trail, scopes, entities, loading: false, isGranted, isPendingRemoval, ...extra },
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

    expect(wrapper.text()).toContain("1 Granted");
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
