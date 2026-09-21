// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import { ref, toRaw } from "vue";

import { useRolePermissionTree } from "@/composables/iam/useRolePermissionTree";

function setup({ metaOrg = "default", resources = [] as any[], permissions = [] as any[] } = {}) {
  const permissionsState = { resources, permissions };
  const resourceMapper = ref<Record<string, any>>({});
  const store = {
    state: {
      selectedOrganization: { identifier: "default" },
      zoConfig: { meta_org: metaOrg },
    },
  };
  const tree = useRolePermissionTree({ permissionsState, resourceMapper, store });
  return { ...tree, permissionsState, resourceMapper };
}

const makeResource = (name: string): any => ({
  resourceName: name,
  permission: {
    AllowAll: { show: true },
    AllowList: { show: true },
    AllowGet: { show: true },
    AllowDelete: { show: true },
    AllowPost: { show: true },
    AllowPut: { show: true },
  },
});

describe("useRolePermissionTree - tree builders [characterization]", () => {
  it("getDefaultResource returns a blank top-level Type with every action shown", () => {
    const { getDefaultResource } = setup();
    const resource = getDefaultResource();

    expect(resource).toEqual({
      name: "",
      permission: {
        AllowAll: { show: true, value: false },
        AllowList: { show: true, value: false },
        AllowGet: { show: true, value: false },
        AllowDelete: { show: true, value: false },
        AllowPost: { show: true, value: false },
        AllowPut: { show: true, value: false },
      },
      display_name: "",
      parent: "",
      childs: [],
      type: "Type",
      resourceName: "",
      entities: [],
      has_entities: false,
      is_loading: false,
      top_level: true,
    });
  });

  it("getDefaultResource returns top_level type", () => {
    const r = setup().getDefaultResource();
    expect(r.top_level).toBe(true);
    expect(r.type).toBe("Type");
  });

  it("getResourceByName returns null at the top level and undefined while recursing", () => {
    const { getResourceByName } = setup();
    const permissions: any[] = [
      { resourceName: "stream", childs: [{ resourceName: "logs", childs: [] }] },
    ];

    expect(getResourceByName(permissions, "logs")?.resourceName).toBe("logs");
    expect(getResourceByName(permissions, "nope")).toBe(null);
    expect(getResourceByName(permissions[0].childs, "nope", 1)).toBe(undefined);
  });

  it("getResourceByName finds nested resource", () => {
    const { getResourceByName } = setup();
    const permissions: any[] = [
      { resourceName: "stream", childs: [{ resourceName: "logs" }], entities: [], permission: {} },
    ];
    const found = getResourceByName(permissions, "logs");
    expect(found?.resourceName).toBe("logs");
  });

  // The rail filters org itself, but the JSON view and saved-grant expansion read this tree, so it must not hold org either.
  it("setPermission keeps org out of the tree outside the meta org", () => {
    const { setPermission, permissionsState } = setup({ metaOrg: "_meta" });

    setPermission(
      {
        key: "org",
        display_name: "Organizations",
        top_level: true,
        has_entities: true,
        parent: "",
      },
      new Set(),
    );

    expect(permissionsState.permissions.map((row) => row.name)).not.toContain("org");
  });

  it("setPermission adds org to the tree inside the meta org", () => {
    const { setPermission, permissionsState } = setup({ metaOrg: "default" });

    setPermission(
      {
        key: "org",
        display_name: "Organizations",
        top_level: true,
        has_entities: true,
        parent: "",
      },
      new Set(),
    );

    expect(permissionsState.permissions.map((row) => row.name)).toContain("org");
  });

  // A grandchild listed before its parent is built via the else branch, which attaches it but does not
  // return, so it also lands at the top level; only the final filter removes that duplicate.
  it("setDefaultPermissions keeps a grandchild listed before its parent out of the top level", () => {
    const { setDefaultPermissions, getResourceByName, permissionsState } = setup({
      resources: [
        { key: "grandchild", display_name: "Grandchild", parent: "child", visible: true },
        { key: "child", display_name: "Child", parent: "root", visible: true },
        { key: "root", display_name: "Root", parent: "", visible: true },
      ],
    });

    setDefaultPermissions();

    const topLevel = permissionsState.permissions.map((row) => row.name);
    expect(topLevel).toEqual(["root"]);
    const child = getResourceByName(permissionsState.permissions, "child");
    expect(child!.childs.map((row) => row.name)).toEqual(["grandchild"]);
  });

  it("setPermission copies the catalog row onto a default resource and registers it", () => {
    const { setPermission, permissionsState, resourceMapper } = setup();

    setPermission(
      { key: "alpha", display_name: "Alpha", top_level: true, has_entities: true, parent: "" },
      new Set(),
    );

    const added = permissionsState.permissions.at(-1);
    expect(added).toMatchObject({
      name: "alpha",
      resourceName: "alpha",
      display_name: "Alpha",
      top_level: true,
      has_entities: true,
      parent: "",
      type: "Type",
      childs: [],
      entities: [],
    });
    expect(toRaw(resourceMapper.value.alpha)).toBe(added);
  });

  it("setPermission attaches a child to its parent instead of pushing it to the top level", () => {
    const { setPermission, getDefaultResource, getResourceByName, permissionsState } = setup();
    const stream = { ...getDefaultResource(), name: "stream", resourceName: "stream" };
    permissionsState.permissions = [stream];

    setPermission(
      { key: "child", display_name: "Child", top_level: false, parent: "stream" },
      new Set(),
    );

    expect(permissionsState.permissions.length).toBe(1);
    expect(
      getResourceByName(permissionsState.permissions, "stream")!.childs.some(
        (c) => c.name === "child",
      ),
    ).toBe(true);
  });

  it("setPermission ignores a resource with no key and a resource already visited", () => {
    const { setPermission, permissionsState } = setup();
    const visited = new Set(["alpha"]);

    setPermission({ display_name: "No key" }, new Set());
    setPermission({ key: "alpha", display_name: "Alpha", top_level: true }, visited);

    expect(permissionsState.permissions.length).toBe(0);
  });

  it("setDefaultPermissions keeps parents at the top level and nests the children", () => {
    const { setDefaultPermissions, permissionsState } = setup({
      resources: [
        { key: "stream", display_name: "Streams", has_entities: true, top_level: true },
        {
          key: "logs",
          display_name: "Logs",
          has_entities: true,
          parent: "stream",
          top_level: false,
        },
      ],
    });

    setDefaultPermissions();

    expect(permissionsState.permissions.map((r) => r.resourceName)).toEqual(["stream"]);
    expect(permissionsState.permissions[0].childs.map((c) => c.name)).toEqual(["logs"]);
  });

  it("setDefaultPermissions organizes resources and filters children from top level", () => {
    const { setDefaultPermissions, permissionsState } = setup({
      resources: [
        { key: "stream", display_name: "Streams", has_entities: true, top_level: true },
        {
          key: "logs",
          display_name: "Logs",
          has_entities: true,
          parent: "stream",
          top_level: false,
        },
      ],
    });
    setDefaultPermissions();
    expect(permissionsState.permissions.some((r) => r.resourceName === "stream")).toBe(true);
  });

  it("modifyResourcePermissions hides actions per resource type and leaves others alone", () => {
    const { modifyResourcePermissions } = setup();
    const hidden = (r: any) =>
      Object.keys(r.permission)
        .filter((k) => !r.permission[k].show)
        .sort();

    const settings = makeResource("settings");
    const pattern = makeResource("logs_pattern");
    const cache = makeResource("logs_cache");
    const other = makeResource("pipeline");
    [settings, pattern, cache, other].forEach(modifyResourcePermissions);

    expect(hidden(settings)).toEqual(["AllowDelete", "AllowList", "AllowPost"]);
    expect(hidden(pattern)).toEqual(["AllowDelete", "AllowList", "AllowPost", "AllowPut"]);
    expect(hidden(cache)).toEqual(["AllowGet", "AllowList", "AllowPost", "AllowPut"]);
    expect(hidden(other)).toEqual([]);
  });

  it("modifyResourcePermissions hides some settings flags", () => {
    const { modifyResourcePermissions } = setup();
    const r: any = {
      resourceName: "settings",
      permission: {
        AllowList: { show: true },
        AllowDelete: { show: true },
        AllowPost: { show: true },
      },
    };
    modifyResourcePermissions(r);
    expect(r.permission.AllowList.show).toBe(false);
    expect(r.permission.AllowDelete.show).toBe(false);
    expect(r.permission.AllowPost.show).toBe(false);
  });
});

describe("useRolePermissionTree - modifyResourcePermissions new resource types", () => {
  const { modifyResourcePermissions } = setup();

  it("logs_pattern hides AllowList, AllowDelete, AllowPost, AllowPut", () => {
    const r = makeResource("logs_pattern");
    modifyResourcePermissions(r);
    expect(r.permission.AllowList.show).toBe(false);
    expect(r.permission.AllowDelete.show).toBe(false);
    expect(r.permission.AllowPost.show).toBe(false);
    expect(r.permission.AllowPut.show).toBe(false);
  });

  it("logs_pattern keeps AllowAll and AllowGet visible", () => {
    const r = makeResource("logs_pattern");
    modifyResourcePermissions(r);
    expect(r.permission.AllowAll.show).toBe(true);
    expect(r.permission.AllowGet.show).toBe(true);
  });

  it("logs_insights hides AllowList, AllowDelete, AllowPost, AllowPut", () => {
    const r = makeResource("logs_insights");
    modifyResourcePermissions(r);
    expect(r.permission.AllowList.show).toBe(false);
    expect(r.permission.AllowDelete.show).toBe(false);
    expect(r.permission.AllowPost.show).toBe(false);
    expect(r.permission.AllowPut.show).toBe(false);
  });

  it("logs_insights keeps AllowAll and AllowGet visible", () => {
    const r = makeResource("logs_insights");
    modifyResourcePermissions(r);
    expect(r.permission.AllowAll.show).toBe(true);
    expect(r.permission.AllowGet.show).toBe(true);
  });

  it("logs_cache hides AllowList, AllowGet, AllowPost, AllowPut", () => {
    const r = makeResource("logs_cache");
    modifyResourcePermissions(r);
    expect(r.permission.AllowList.show).toBe(false);
    expect(r.permission.AllowGet.show).toBe(false);
    expect(r.permission.AllowPost.show).toBe(false);
    expect(r.permission.AllowPut.show).toBe(false);
  });

  it("logs_cache keeps AllowAll and AllowDelete visible", () => {
    const r = makeResource("logs_cache");
    modifyResourcePermissions(r);
    expect(r.permission.AllowAll.show).toBe(true);
    expect(r.permission.AllowDelete.show).toBe(true);
  });

  it("logs_pattern and logs_insights have identical permission restrictions", () => {
    const r1 = makeResource("logs_pattern");
    const r2 = makeResource("logs_insights");
    modifyResourcePermissions(r1);
    modifyResourcePermissions(r2);
    expect(r1.permission.AllowList.show).toBe(r2.permission.AllowList.show);
    expect(r1.permission.AllowDelete.show).toBe(r2.permission.AllowDelete.show);
    expect(r1.permission.AllowPost.show).toBe(r2.permission.AllowPost.show);
    expect(r1.permission.AllowPut.show).toBe(r2.permission.AllowPut.show);
    expect(r1.permission.AllowGet.show).toBe(r2.permission.AllowGet.show);
  });

  it("logs_cache hides AllowGet but logs_pattern does not", () => {
    const rCache = makeResource("logs_cache");
    const rPattern = makeResource("logs_pattern");
    modifyResourcePermissions(rCache);
    modifyResourcePermissions(rPattern);
    expect(rCache.permission.AllowGet.show).toBe(false);
    expect(rPattern.permission.AllowGet.show).toBe(true);
  });

  it("logs_pattern hides AllowDelete but logs_cache does not", () => {
    const rCache = makeResource("logs_cache");
    const rPattern = makeResource("logs_pattern");
    modifyResourcePermissions(rCache);
    modifyResourcePermissions(rPattern);
    expect(rPattern.permission.AllowDelete.show).toBe(false);
    expect(rCache.permission.AllowDelete.show).toBe(true);
  });

  it("unrelated resource type is not affected by new type checks", () => {
    const r = makeResource("some_other_resource");
    modifyResourcePermissions(r);
    // No flags should be hidden for an unrelated resource type
    expect(r.permission.AllowList.show).toBe(true);
    expect(r.permission.AllowGet.show).toBe(true);
    expect(r.permission.AllowDelete.show).toBe(true);
    expect(r.permission.AllowPost.show).toBe(true);
    expect(r.permission.AllowPut.show).toBe(true);
  });
});
