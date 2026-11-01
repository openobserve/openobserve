import { describe, it, expect } from "vitest";
import {
  buildRoleModules,
  GROUP_ORDER,
  GROUP_ORDER_V2,
  matchModule,
  MODULE_COPY,
  moduleGroup,
  TASK_WORDS,
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

const destinations = { key: "destination", label: "Destinations", groupLabel: "Alerting" };

const dashboards = {
  key: "dfolder",
  label: "Dashboard Folders",
  groupLabel: "Dashboards And Reports",
};

describe("matchModule - order", () => {
  it("matches the module name, ignoring case", () => {
    expect(matchModule(destinations, "DEST")).toEqual({ via: "label" });
  });

  it("falls back to the group name", () => {
    expect(matchModule(destinations, "alerting")).toEqual({ via: "group" });
  });

  it("falls back to a task word and returns the word", () => {
    expect(matchModule(destinations, "slack")).toEqual({ via: "word" });
    expect(matchModule(dashboards, "pan")).toEqual({ via: "word" });
  });

  // "dash" is in the name and in the task word "dashboard"; the name wins, so no pill shows.
  it("prefers the name over a group or task word", () => {
    expect(matchModule(dashboards, "dash")).toEqual({ via: "label" });
    expect(matchModule(dashboards, "reports")).toEqual({ via: "group" });
  });

  it("returns no match when nothing fits", () => {
    expect(matchModule(destinations, "zzz")).toBeNull();
  });

  it("keeps every module for an empty or blank query", () => {
    expect(matchModule(destinations, "")).toEqual({ via: "label" });
    expect(matchModule(destinations, "   ")).toEqual({ via: "label" });
  });

  it("matches a module with no task words by name and group only", () => {
    const fresh = { key: "brand_new_thing", label: "Brand New", groupLabel: "Other" };

    expect(matchModule(fresh, "brand")).toEqual({ via: "label" });
    expect(matchModule(fresh, "oth")).toEqual({ via: "group" });
    expect(matchModule(fresh, "slack")).toBeNull();
  });
});

describe("matchModule - short query", () => {
  // "k" is in "slack", but one letter would keep nearly every module.
  it("skips task words for a 1-character query, but still matches names and groups", () => {
    expect(matchModule(destinations, "k")).toBeNull();
    expect(matchModule(destinations, "d")).toEqual({ via: "label" });
    expect(matchModule(destinations, "g")).toEqual({ via: "group" });
  });

  it("trims the query before matching", () => {
    expect(matchModule(destinations, "  slack  ")).toEqual({ via: "word" });
  });

  it("treats ( . * + ? [ \\ as literal characters", () => {
    expect(() => matchModule(destinations, "[\\")).not.toThrow();
    expect(matchModule(destinations, "(")).toBeNull();
  });
});

describe("task words", () => {
  // A typo in a key would silently drop that module's words, so only the known Other modules may miss the group map.
  it("keys every task-word list by a resource with a known group", () => {
    const keys = Object.keys(TASK_WORDS);

    keys.forEach((key) => expect(GROUP_ORDER).toContain(moduleGroup(key)));
    expect(keys.filter((key) => moduleGroup(key) === "other").sort()).toEqual([
      "alert_calibration",
      "query_history",
      "rum_analytics",
    ]);
  });

  it("finds RUM Product Analytics by the task word funnel", () => {
    const productAnalytics = {
      key: "rum_analytics",
      label: "RUM Product Analytics",
      groupLabel: "Other",
    };

    expect(matchModule(productAnalytics, "funnel")).toEqual({ via: "word" });
  });

  it("finds the hint examples: slack, panel and token each match a module", () => {
    expect(matchModule(destinations, "slack")?.via).toBe("word");
    expect(matchModule(dashboards, "panel")?.via).toBe("word");
    expect(
      matchModule({ key: "passcode", label: "Passcode", groupLabel: "Access" }, "token")?.via,
    ).toBe("word");
  });
});
