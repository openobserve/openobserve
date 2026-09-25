import { describe, it, expect } from "vitest";
import {
  buildRoleModules,
  GROUP_ORDER,
  type CatalogResource,
} from "@/components/iam/roles/roleModules";

const catalogue: CatalogResource[] = [
  { key: "stream", has_entities: true, order: 1 },
  { key: "logs", parent: "stream", has_entities: true, order: 2 },
  { key: "metrics", parent: "stream", has_entities: true, order: 3 },
  { key: "function", has_entities: true, order: 4 },
  { key: "dfolder", has_entities: true, order: 5 },
  { key: "dashboard", parent: "dfolder", has_entities: true, order: 6 },
  { key: "settings", has_entities: false, order: 7 },
  { key: "license", has_entities: false, order: 8 },
  { key: "brand_new_thing", has_entities: true, order: 9 },
  { key: "hidden_thing", has_entities: true, visible: false, order: 10 },
];

const keysOf = () => buildRoleModules(catalogue).map((module) => module.key);
const moduleOf = (key: string) => buildRoleModules(catalogue).find((module) => module.key === key);

describe("buildRoleModules - rail rows only ever open a list", () => {
  it("lists streams as one module that its stream types open from", () => {
    expect(keysOf()).toContain("stream");
    expect(keysOf()).not.toContain("logs");
    expect(keysOf()).not.toContain("metrics");
  });

  it("reaches a folder scoped child through its folder module", () => {
    expect(keysOf()).toContain("dfolder");
    expect(keysOf()).not.toContain("dashboard");
  });

  it("drops resources the catalogue marks invisible", () => {
    expect(keysOf()).not.toContain("hidden_thing");
  });

  it("lists a stream type as its own module when the catalogue has no stream parent", () => {
    const modules = buildRoleModules([{ key: "logs", parent: "stream", has_entities: true }]);
    expect(modules.map((module) => module.key)).toEqual(["logs"]);
    expect(modules[0].group).toBe("data");
  });
});

describe("buildRoleModules - counts", () => {
  it("counts every stream type's grants on the streams module", () => {
    expect(moduleOf("stream")?.countedKeys).toEqual(["stream", "logs", "metrics"]);
  });

  it("counts a folder module's grants together with its children", () => {
    expect(moduleOf("dfolder")?.countedKeys).toEqual(["dfolder", "dashboard"]);
  });

  it("gives a plain module a single type level scope", () => {
    expect(moduleOf("function")?.scopeKeys).toEqual(["function"]);
  });
});

describe("buildRoleModules - icons", () => {
  it("reuses the navigation glyph for a module that has one", () => {
    expect(moduleOf("stream")?.icon).toBe("window");
    expect(moduleOf("dfolder")?.icon).toBe("dashboard");
  });

  it("falls back to a generic glyph for an unmapped module", () => {
    expect(moduleOf("brand_new_thing")?.icon).toBe("category");
  });
});

describe("buildRoleModules - modules without entities", () => {
  // Each one is its own module with a single type level row, not folded into an invented bucket.
  it("lists a resource without entities as its own module", () => {
    expect(keysOf()).toEqual(expect.arrayContaining(["settings", "license"]));
    expect(moduleOf("settings")).toMatchObject({ hasEntities: false, scopeKeys: ["settings"] });
  });
});

describe("buildRoleModules - grouping", () => {
  // An unmapped resource must still be reachable, or a new backend type silently vanishes.
  it("puts a resource the group map does not know under other", () => {
    expect(moduleOf("brand_new_thing")?.group).toBe("other");
  });

  // The API marks a top-level resource with `parent: ""`, and that must not read as a group or icon.
  it("keeps a real group and icon for a top-level resource sent with an empty parent", () => {
    const modules = buildRoleModules([
      { key: "function", parent: "", has_entities: true },
      { key: "brand_new_thing", parent: "", has_entities: true },
    ]);

    expect(modules.find((module) => module.key === "function")).toMatchObject({
      group: "pipelines",
      icon: "function",
    });
    expect(modules.find((module) => module.key === "brand_new_thing")).toMatchObject({
      group: "other",
      icon: "category",
    });
  });

  it("groups workflows with pipelines", () => {
    const modules = buildRoleModules([
      { key: "workflows", parent: "workflow_folder", has_entities: true },
    ]);
    expect(modules[0].group).toBe("pipelines");
    expect(modules[0].icon).toBe("schema");
  });

  // A folder type the org does not list must not strand its child under other.
  it("groups a child listed without its parent where the parent belongs", () => {
    const modules = buildRoleModules([{ key: "alert", parent: "afolder", has_entities: true }]);
    expect(modules[0].group).toBe("alerting");
    expect(modules[0].icon).toBe("notifications-active");
  });

  it("orders modules by group", () => {
    const modules = buildRoleModules(catalogue);
    const groupIndexes = modules.map((module) => GROUP_ORDER.indexOf(module.group));

    expect(groupIndexes).toEqual([...groupIndexes].sort((a, b) => a - b));
  });
});
