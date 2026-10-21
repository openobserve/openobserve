import { describe, it, expect } from "vitest";
import {
  buildRoleModules,
  GROUP_ORDER,
  GROUP_ORDER_V2,
  MODULE_COPY,
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

  // Synthetic Environments arrived after the group map was written; unmapped, it would sit under Other.
  it("groups prompt protected labels with AI", () => {
    const modules = buildRoleModules([{ key: "prompt_label", parent: "", has_entities: false }]);
    expect(modules[0].group).toBe("ai");
    expect(modules[0].icon).toBe("label");
  });

  it("groups prompts with AI", () => {
    const modules = buildRoleModules([{ key: "prompt", parent: "", has_entities: false }]);
    expect(modules[0].group).toBe("ai");
    expect(modules[0].icon).toBe("edit-note");
  });

  it("groups synthetic environments with monitoring", () => {
    const modules = buildRoleModules([
      { key: "synthetic_environment", parent: "", has_entities: true },
    ]);
    expect(modules[0].group).toBe("monitoring");
    expect(modules[0].icon).toBe("layers");
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

describe("buildRoleModules - assistant v2 groups", () => {
  const ASSISTANT = ["ai", "ai_chat_share", "ai_toolsets", "mcp"];
  const LLM = [
    "provider",
    "score_config",
    "scorer",
    "eval_job",
    "annotation_queue",
    "dataset",
    "experiment",
    "playground",
    "pfolder",
    "prompt",
    "prompt_label",
    "model_pricing",
  ];
  const resources: CatalogResource[] = [...ASSISTANT, ...LLM, "alert", "role"].map(
    (key, order) => ({
      key,
      order,
    }),
  );

  it("keeps one AI group with the flag off", () => {
    const groups = new Set(buildRoleModules(resources).map((module) => module.group));
    expect(groups.has("ai")).toBe(true);
    expect(groups.has("assistant")).toBe(false);
  });

  it("splits Assistant and LLM observability, Assistant right after Alerting", () => {
    const modules = buildRoleModules(resources, { assistantV2: true });
    const groupOf = (key: string) => modules.find((module) => module.key === key)?.group;
    expect(ASSISTANT.map(groupOf)).toEqual(ASSISTANT.map(() => "assistant"));
    expect(LLM.map(groupOf)).toEqual(LLM.map(() => "llmObservability"));
    expect(GROUP_ORDER_V2.indexOf("assistant")).toBe(GROUP_ORDER_V2.indexOf("alerting") + 1);
    expect(GROUP_ORDER_V2.indexOf("assistant")).toBeLessThan(GROUP_ORDER_V2.indexOf("access"));
    expect(Object.keys(MODULE_COPY).sort()).toEqual([...ASSISTANT].sort());
  });

  it("never reuses an Assistant icon in LLM observability", () => {
    const modules = buildRoleModules(resources, { assistantV2: true });
    const icons = (group: string) =>
      new Set(modules.filter((module) => module.group === group).map((module) => module.icon));
    const shared = [...icons("assistant")].filter((icon) => icons("llmObservability").has(icon));
    expect(shared).toEqual([]);
    expect(modules.find((module) => module.key === "ai")?.icon).toBe("auto-awesome");
  });
});
