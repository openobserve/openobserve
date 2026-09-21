import { describe, it, expect } from "vitest";
import { ref } from "vue";

import { useRolePermissionRows } from "@/composables/iam/useRolePermissionRows";

const ORG = "default";

const resource = (name: string, childs: any[] = []) => ({
  name,
  resourceName: name,
  entities: [] as any[],
  childs,
  permission: {},
});

// Mirrors the component's lookup: match on resourceName, recurse into childs.
const getResourceByName = (resources: any[], resourceName: string, level = 0): any => {
  for (const item of resources) {
    if (item.resourceName === resourceName) return item;
    if (item.childs?.length) {
      const found = getResourceByName(item.childs, resourceName, level + 1);
      if (found) return found;
    }
  }
  return level ? undefined : null;
};

function setup(selected: string[] = []) {
  const permissionsState = {
    permissions: [
      resource("role"),
      resource("logs_pattern"),
      resource("logs_insights"),
      resource("logs_cache"),
      resource("stream"),
      resource("dfolder", [
        { name: "dashboard", top_level: false },
        { name: "pinned", top_level: true },
      ]),
    ],
  };
  const heavyResourceEntities = ref<{ [key: string]: any[] }>({});
  const selectedPermissionsHash = ref(new Set(selected));

  const rows = useRolePermissionRows({
    permissionsState: permissionsState as any,
    heavyResourceEntities,
    selectedPermissionsHash,
    getPermissionHash: (resourceName: string, permission: string, entity?: string) =>
      `${resourceName}:${entity || "_all_" + ORG}:${permission}`,
    getResourceByName,
    store: { state: { selectedOrganization: { identifier: ORG } } },
  });

  return { ...rows, permissionsState, heavyResourceEntities, selectedPermissionsHash };
}

const entitiesOf = (permissionsState: any, name: string) =>
  getResourceByName(permissionsState.permissions, name).entities;

describe("useRolePermissionRows - updateResourceEntities", () => {
  it("appends rather than replaces", () => {
    const { updateResourceEntities, permissionsState } = setup();

    updateResourceEntities("role", ["name"], [{ name: "one" }]);
    updateResourceEntities("role", ["name"], [{ name: "two" }]);

    expect(entitiesOf(permissionsState, "role").map((e: any) => e.name)).toEqual(["one", "two"]);
  });

  it("is a no-op for an unknown resource", () => {
    const { updateResourceEntities } = setup();

    expect(() => updateResourceEntities("nope", ["name"], [{ name: "x" }])).not.toThrow();
  });

  it("names a row from a single key and takes a plain string as-is", () => {
    const { updateResourceEntities, permissionsState } = setup();

    updateResourceEntities("role", ["name"], [{ name: "a" }, "plain"]);

    expect(entitiesOf(permissionsState, "role").map((e: any) => e.name)).toEqual(["a", "plain"]);
  });

  it("joins multiple name keys with a slash and falls back to the key", () => {
    const { updateResourceEntities, permissionsState } = setup();

    updateResourceEntities("role", ["name", "missing"], [{ name: "a" }]);

    expect(entitiesOf(permissionsState, "role")[0].name).toBe("a/missing");
  });

  it("ticks a permission already in the selected set", () => {
    const { updateResourceEntities, permissionsState } = setup(["role:sel:AllowGet"]);

    updateResourceEntities("role", ["name"], [{ name: "sel" }]);

    const row = entitiesOf(permissionsState, "role")[0];
    expect(row.permission.AllowGet.value).toBe(true);
    expect(row.permission.AllowPut.value).toBe(false);
  });

  it("carries the child name, the display name and the child's top_level", () => {
    const { updateResourceEntities, permissionsState } = setup();

    updateResourceEntities(
      "dfolder",
      ["folderId"],
      [{ folderId: "f1", name: "F1" }],
      true,
      "name",
      "dashboard",
    );
    updateResourceEntities(
      "dfolder",
      ["folderId"],
      [{ folderId: "f2", name: "F2" }],
      true,
      "name",
      "pinned",
    );

    const [dashboardRow, pinnedRow] = entitiesOf(permissionsState, "dfolder");
    expect(dashboardRow).toMatchObject({
      name: "f1",
      display_name: "F1",
      resourceName: "dfolder",
      childName: "dashboard",
      type: "Resource",
      has_entities: true,
      show: true,
      top_level: false,
    });
    expect(pinnedRow.top_level).toBe(true);
  });

  it("hides four actions on logs_pattern and logs_insights rows", () => {
    const { updateResourceEntities, permissionsState } = setup();

    updateResourceEntities("logs_pattern", ["name"], [{ name: "app" }]);
    updateResourceEntities("logs_insights", ["name"], [{ name: "app" }]);

    for (const name of ["logs_pattern", "logs_insights"]) {
      const row = entitiesOf(permissionsState, name)[0];
      expect(row.name).toBe("app");
      expect(row.permission.AllowList.show).toBe(false);
      expect(row.permission.AllowDelete.show).toBe(false);
      expect(row.permission.AllowPost.show).toBe(false);
      expect(row.permission.AllowPut.show).toBe(false);
      expect(row.permission.AllowGet.show).toBe(true);
      expect(row.permission.AllowAll.show).toBe(true);
    }
  });

  it("hides AllowGet and keeps AllowDelete on logs_cache rows", () => {
    const { updateResourceEntities, permissionsState } = setup();

    updateResourceEntities("logs_cache", ["name"], [{ name: "app" }]);

    const row = entitiesOf(permissionsState, "logs_cache")[0];
    expect(row.resourceName).toBe("logs_cache");
    expect(row.permission.AllowGet.show).toBe(false);
    expect(row.permission.AllowList.show).toBe(false);
    expect(row.permission.AllowPost.show).toBe(false);
    expect(row.permission.AllowPut.show).toBe(false);
    expect(row.permission.AllowDelete.show).toBe(true);
    expect(row.permission.AllowAll.show).toBe(true);
  });
});

describe("useRolePermissionRows - updateEntityEntities", () => {
  it("takes strings as-is and returns early without an entity", () => {
    const { updateEntityEntities } = setup();
    const entity = { name: "x", childName: "function", entities: [] as any[] };

    updateEntityEntities(entity as any, ["name"], ["plain"]);

    expect(entity.entities[0]).toMatchObject({
      name: "plain",
      display_name: "plain",
      resourceName: "function",
      type: "Resource",
      top_level: false,
    });
    expect(() => updateEntityEntities(null as any, ["name"], ["plain"])).not.toThrow();
  });

  it("appends rather than replaces", () => {
    const { updateEntityEntities } = setup();
    const entity = { name: "x", childName: "function", entities: [] as any[] };

    updateEntityEntities(entity as any, ["name"], [{ name: "one" }]);
    updateEntityEntities(entity as any, ["name"], [{ name: "two" }]);

    expect(entity.entities.map((e: any) => e.name)).toEqual(["one", "two"]);
  });

  it("joins multiple name keys with a slash and falls back to the key", () => {
    const { updateEntityEntities } = setup();
    const entity = { name: "x", childName: "function", entities: [] as any[] };

    updateEntityEntities(entity as any, ["name", "missing"], [{ name: "a" }]);

    expect(entity.entities[0].name).toBe("a/missing");
  });

  it("ticks a permission already in the selected set", () => {
    const { updateEntityEntities } = setup(["function:sel:AllowGet"]);
    const entity = { name: "x", childName: "function", entities: [] as any[] };

    updateEntityEntities(entity as any, ["name"], [{ name: "sel" }]);

    expect(entity.entities[0].permission.AllowGet.value).toBe(true);
    expect(entity.entities[0].permission.AllowPut.value).toBe(false);
  });

  it("shows AllowList and AllowPost only when hasEntities is true", () => {
    const { updateEntityEntities } = setup();
    const entity = { name: "x", childName: "function", entities: [] as any[] };
    const leaf = { name: "y", childName: "function", entities: [] as any[] };

    updateEntityEntities(entity as any, ["name"], [{ name: "a" }], true);
    updateEntityEntities(leaf as any, ["name"], [{ name: "a" }]);

    expect(entity.entities[0].permission.AllowList.show).toBe(true);
    expect(entity.entities[0].permission.AllowPost.show).toBe(true);
    expect(entity.entities[0].has_entities).toBe(true);
    expect(leaf.entities[0].permission.AllowList.show).toBe(false);
    expect(leaf.entities[0].permission.AllowPost.show).toBe(false);
  });

  // BUG pinned, not fixed: alert rows are keyed off `alert_id` while the list
  // API returns `alertId`, so every alert row's name ends in "/undefined".
  it("keys alert rows off alert_id even though the row carries alertId", () => {
    const { updateEntityEntities } = setup();
    const folder = { name: "f9", childName: "alert", entities: [] as any[] };

    updateEntityEntities(
      folder as any,
      ["alertId"],
      [{ alertId: "a1", name: "A1" }],
      false,
      "name",
    );

    expect(folder.entities[0]).toMatchObject({
      name: "f9/undefined",
      display_name: "A1",
      resourceName: "alert",
    });
  });

  it("mirrors the heavy stream types into heavyResourceEntities and nothing else", () => {
    const { updateEntityEntities, heavyResourceEntities } = setup();
    const node = (name: string) => ({ name, childName: name, entities: [] as any[] });
    const nodes = ["logs", "metrics", "traces", "index", "dfolder"].map(node);

    nodes.forEach((n) => updateEntityEntities(n as any, ["name"], [{ name: n.name + "-1" }]));

    expect(Object.keys(heavyResourceEntities.value).sort()).toEqual([
      "index",
      "logs",
      "metrics",
      "traces",
    ]);
    expect(heavyResourceEntities.value.logs.map((e: any) => e.name)).toEqual(["logs-1"]);
    expect(nodes[0].entities.map((e: any) => e.name)).toEqual(["logs-1"]);
  });
});

describe("useRolePermissionRows - updateResourceResource", () => {
  it("pushes a Type row whose checkboxes read the org wildcard", () => {
    const { updateResourceResource, permissionsState } = setup([`logs:_all_${ORG}:AllowList`]);

    updateResourceResource(
      "logs",
      "stream",
      ["stream_type"],
      [{ stream_type: "logs", name: "Logs" }],
      true,
      "name",
    );

    const row = entitiesOf(permissionsState, "stream")[0];
    expect(row).toMatchObject({
      name: "logs",
      display_name: "Logs",
      type: "Type",
      resourceName: "logs",
      childName: "logs",
      has_entities: true,
      top_level: true,
      show: true,
    });
    expect(row.permission.AllowList.value).toBe(true);
    expect(row.permission.AllowGet.value).toBe(false);
  });

  it("appends rather than replaces", () => {
    const { updateResourceResource, permissionsState } = setup();

    updateResourceResource("logs", "stream", ["stream_type"], [{ stream_type: "logs" }]);
    updateResourceResource("traces", "stream", ["stream_type"], [{ stream_type: "traces" }]);

    expect(entitiesOf(permissionsState, "stream").map((e: any) => e.name)).toEqual([
      "logs",
      "traces",
    ]);
  });

  it("is a no-op for an unknown parent", () => {
    const { updateResourceResource } = setup();

    expect(() =>
      updateResourceResource("logs", "nope", ["stream_type"], [{ stream_type: "logs" }]),
    ).not.toThrow();
  });
});
