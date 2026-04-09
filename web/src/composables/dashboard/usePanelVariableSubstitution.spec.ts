import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref } from "vue";
import { usePanelVariableSubstitution } from "./usePanelVariableSubstitution";

// Mock utilities that have heavy dependencies (vuex, quasar, services, async parser)
vi.mock("@/utils/query/sqlUtils", () => ({
  addLabelsToSQlQuery: vi.fn(async (query: string, _vars: any[]) => query),
  getStreamFromQuery: vi.fn(async () => "test_stream"),
}));

vi.mock("@/utils/zincutils", () => ({
  escapeSingleQuotes: vi.fn((s: string) => s.replace(/'/g, "''")),
}));

const log = vi.fn();

const makeStore = () => ({
  state: {
    organizationData: {
      organizationSettings: { scrape_interval: 15 },
    },
  },
});

const makeVariablesData = (values: any[] = []) => ref({ values });

const makePanelSchema = (queries: any[] = [{ query: "" }]) =>
  ref({ queryType: "sql", queries });

const makeChartPanelRef = (offsetWidth = 1000) =>
  ref({ offsetWidth });

const makeComposable = (overrides: {
  variablesValues?: any[];
  schemaQueries?: any[];
} = {}) => {
  const variablesData = makeVariablesData(overrides.variablesValues ?? []);
  const panelSchema = makePanelSchema(overrides.schemaQueries ?? [{ query: "" }]);
  const chartPanelRef = makeChartPanelRef();
  const store = makeStore();

  return usePanelVariableSubstitution({
    panelSchema,
    variablesData,
    chartPanelRef,
    store,
    log,
  });
};

// ─── areArraysEqual ──────────────────────────────────────────────────────────

describe("areArraysEqual", () => {
  it("returns true for two equal arrays (same order)", () => {
    const { areArraysEqual } = makeComposable();
    expect(areArraysEqual(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("returns true for equal arrays in different order", () => {
    const { areArraysEqual } = makeComposable();
    expect(areArraysEqual(["b", "a"], ["a", "b"])).toBe(true);
  });

  it("returns false when arrays have different lengths", () => {
    const { areArraysEqual } = makeComposable();
    expect(areArraysEqual(["a"], ["a", "b"])).toBe(false);
  });

  it("returns false when arrays have different values", () => {
    const { areArraysEqual } = makeComposable();
    expect(areArraysEqual(["a", "c"], ["a", "b"])).toBe(false);
  });

  it("returns true for two empty arrays", () => {
    const { areArraysEqual } = makeComposable();
    expect(areArraysEqual([], [])).toBe(true);
  });
});

// ─── snapshot getters / updaters ─────────────────────────────────────────────

describe("snapshot getters and updaters", () => {
  it("getCurrentDependentVariablesData returns initial snapshot", () => {
    const varValues = [
      {
        name: "env",
        type: "custom",
        value: "prod",
        isVariablePartialLoaded: true,
      },
    ];
    const variablesData = makeVariablesData(varValues);
    const panelSchema = makePanelSchema([{ query: "SELECT * WHERE env=$env" }]);
    const inst = usePanelVariableSubstitution({
      panelSchema,
      variablesData,
      chartPanelRef: makeChartPanelRef(),
      store: makeStore(),
      log,
    });
    const snapshot = inst.getCurrentDependentVariablesData();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].name).toBe("env");
  });

  it("updateCurrentDependentVariablesData replaces the snapshot", () => {
    const inst = makeComposable();
    inst.updateCurrentDependentVariablesData([{ name: "newVar", value: "x" }]);
    expect(inst.getCurrentDependentVariablesData()[0].name).toBe("newVar");
  });

  it("updateCurrentDynamicVariablesData replaces the dynamic snapshot", () => {
    const inst = makeComposable();
    inst.updateCurrentDynamicVariablesData([{ name: "dynVar", value: "y" }]);
    expect(inst.getCurrentDynamicVariablesData()[0].name).toBe("dynVar");
  });
});

// ─── areDynamicVariablesStillLoading ─────────────────────────────────────────

describe("areDynamicVariablesStillLoading", () => {
  it("returns false when no dynamic_filters variables exist", () => {
    const inst = makeComposable({ variablesValues: [] });
    expect(inst.areDynamicVariablesStillLoading()).toBe(false);
  });

  it("returns true when a dynamic_filters variable is loading", () => {
    const inst = makeComposable({
      variablesValues: [
        { type: "dynamic_filters", isLoading: true, value: [] },
      ],
    });
    expect(inst.areDynamicVariablesStillLoading()).toBe(true);
  });

  it("returns false when dynamic_filters variable is not loading", () => {
    const inst = makeComposable({
      variablesValues: [
        {
          type: "dynamic_filters",
          isLoading: false,
          isVariableLoadingPending: false,
          value: [{ name: "x", operator: "=", value: "y" }],
        },
      ],
    });
    expect(inst.areDynamicVariablesStillLoading()).toBe(false);
  });
});

// ─── areDependentVariablesStillLoadingWith ────────────────────────────────────

describe("areDependentVariablesStillLoadingWith", () => {
  it("returns false when all variables have been loaded (isVariablePartialLoaded=true)", () => {
    const inst = makeComposable();
    const vars = [{ name: "env", value: "prod", isVariablePartialLoaded: true }];
    expect(inst.areDependentVariablesStillLoadingWith(vars)).toBe(false);
  });

  it("blocks when value is null and variable has never been loaded", () => {
    const inst = makeComposable();
    const vars = [{ name: "env", value: null, isVariablePartialLoaded: false }];
    expect(inst.areDependentVariablesStillLoadingWith(vars)).toBe(true);
  });

  it("does not block when value is null but isVariablePartialLoaded=true", () => {
    const inst = makeComposable();
    const vars = [{ name: "env", value: null, isVariablePartialLoaded: true }];
    expect(inst.areDependentVariablesStillLoadingWith(vars)).toBe(false);
  });

  it("blocks when value is empty array and variable has never been loaded", () => {
    const inst = makeComposable();
    const vars = [{ name: "env", value: [], isVariablePartialLoaded: false }];
    expect(inst.areDependentVariablesStillLoadingWith(vars)).toBe(true);
  });
});

// ─── isAllRegularVariablesValuesSameWith ─────────────────────────────────────

describe("isAllRegularVariablesValuesSameWith", () => {
  it("returns true when scalar variable has same value as snapshot", () => {
    const inst = makeComposable();
    inst.updateCurrentDependentVariablesData([
      { name: "env", value: "prod", multiSelect: false },
    ]);
    const newData = [{ name: "env", value: "prod", multiSelect: false }];
    expect(inst.isAllRegularVariablesValuesSameWith(newData)).toBe(true);
  });

  it("returns false when scalar variable value changes", () => {
    const inst = makeComposable();
    inst.updateCurrentDependentVariablesData([
      { name: "env", value: "prod", multiSelect: false },
    ]);
    const newData = [{ name: "env", value: "staging", multiSelect: false }];
    expect(inst.isAllRegularVariablesValuesSameWith(newData)).toBe(false);
  });

  it("returns true when multiSelect variable has same values", () => {
    const inst = makeComposable();
    inst.updateCurrentDependentVariablesData([
      { name: "env", value: ["prod", "staging"], multiSelect: true },
    ]);
    const newData = [{ name: "env", value: ["staging", "prod"], multiSelect: true }];
    expect(inst.isAllRegularVariablesValuesSameWith(newData)).toBe(true);
  });

  it("returns false when multiSelect variable values differ", () => {
    const inst = makeComposable();
    inst.updateCurrentDependentVariablesData([
      { name: "env", value: ["prod"], multiSelect: true },
    ]);
    const newData = [{ name: "env", value: ["prod", "dev"], multiSelect: true }];
    expect(inst.isAllRegularVariablesValuesSameWith(newData)).toBe(false);
  });
});

// ─── isAllDynamicVariablesValuesSameWith ─────────────────────────────────────

describe("isAllDynamicVariablesValuesSameWith", () => {
  it("returns true when dynamic variables are unchanged", () => {
    const inst = makeComposable();
    inst.updateCurrentDynamicVariablesData([
      { name: "k", value: "v", operator: "=" },
    ]);
    const newData = [{ name: "k", value: "v", operator: "=" }];
    expect(inst.isAllDynamicVariablesValuesSameWith(newData)).toBe(true);
  });

  it("returns false when dynamic variable value changes", () => {
    const inst = makeComposable();
    inst.updateCurrentDynamicVariablesData([
      { name: "k", value: "v1", operator: "=" },
    ]);
    const newData = [{ name: "k", value: "v2", operator: "=" }];
    expect(inst.isAllDynamicVariablesValuesSameWith(newData)).toBe(false);
  });

  it("returns false when operator changes", () => {
    const inst = makeComposable();
    inst.updateCurrentDynamicVariablesData([
      { name: "k", value: "v", operator: "=" },
    ]);
    const newData = [{ name: "k", value: "v", operator: "!=" }];
    expect(inst.isAllDynamicVariablesValuesSameWith(newData)).toBe(false);
  });
});

// ─── replaceQueryValue ────────────────────────────────────────────────────────

describe("replaceQueryValue", () => {
  const makeInstWithVar = (varName: string, varValue: any, multiSelect = false) => {
    const varValues = [
      {
        name: varName,
        type: "custom",
        value: varValue,
        multiSelect,
        escapeSingleQuotes: false,
        isVariablePartialLoaded: true,
      },
    ];
    const schemaQueries = [{ query: `SELECT * WHERE ${varName}=$${varName}` }];
    const variablesData = makeVariablesData(varValues);
    const panelSchema = makePanelSchema(schemaQueries);
    const inst = usePanelVariableSubstitution({
      panelSchema,
      variablesData,
      chartPanelRef: makeChartPanelRef(),
      store: makeStore(),
      log,
    });
    // Initialise snapshot (it's set at construction time)
    return inst;
  };

  it("replaces fixed variable __interval in query", () => {
    const inst = makeComposable();
    const { query } = inst.replaceQueryValue(
      "rate(metric[$__interval])",
      0,
      300_000_000, // 300ms range in microseconds
      "promql",
    );
    // __interval = 300_000_000 / 1000 / 1000 = 300 (ms), formatInterval(300) → 200ms bucket
    expect(query).toContain("200ms");
  });

  it("replaces fixed variable $__interval_ms", () => {
    const inst = makeComposable();
    const { query } = inst.replaceQueryValue(
      "SELECT * WHERE ts > $__interval_ms",
      0,
      300_000_000,
      "sql",
    );
    expect(query).not.toContain("$__interval_ms");
  });

  it("includes metadata entry for substituted fixed variable", () => {
    const inst = makeComposable();
    const { metadata } = inst.replaceQueryValue(
      "SELECT * WHERE interval=$__interval",
      0,
      300_000_000,
      "sql",
    );
    const entry = metadata.find((m: any) => m.name === "__interval");
    expect(entry).toBeDefined();
    expect(entry.type).toBe("fixed");
  });

  it("replaces a scalar variable in the query", () => {
    const inst = makeInstWithVar("env", "prod");
    const { query } = inst.replaceQueryValue(
      "SELECT * WHERE env=$env",
      0,
      300_000_000,
      "sql",
    );
    expect(query).toContain("prod");
    expect(query).not.toContain("$env");
  });

  it("replaces a multi-select variable using sql mode (comma-separated quoted values)", () => {
    const inst = makeInstWithVar("env", ["prod", "staging"], true);
    const { query } = inst.replaceQueryValue(
      "SELECT * WHERE env IN ($env)",
      0,
      300_000_000,
      "sql",
    );
    expect(query).toContain("'prod'");
    expect(query).toContain("'staging'");
  });

  it("uses SELECT_ALL_VALUE (*) for null scalar variable value", () => {
    const varValues = [
      {
        name: "env",
        type: "custom",
        value: null,
        multiSelect: false,
        escapeSingleQuotes: false,
        isVariablePartialLoaded: true,
      },
    ];
    const schemaQueries = [{ query: "SELECT * WHERE env=$env" }];
    const variablesData = makeVariablesData(varValues);
    const panelSchema = makePanelSchema(schemaQueries);
    const inst = usePanelVariableSubstitution({
      panelSchema,
      variablesData,
      chartPanelRef: makeChartPanelRef(),
      store: makeStore(),
      log,
    });
    const { query } = inst.replaceQueryValue(
      "SELECT * WHERE env=$env",
      0,
      300_000_000,
      "sql",
    );
    expect(query).toContain("_o2_all_");
  });

  it("replaces ${VAR_NAME} bracket syntax", () => {
    const inst = makeInstWithVar("region", "us-east");
    const { query } = inst.replaceQueryValue(
      "SELECT * WHERE region=${region}",
      0,
      300_000_000,
      "sql",
    );
    expect(query).not.toContain("${region}");
    expect(query).toContain("us-east");
  });
});

// ─── ifPanelVariablesCompletedLoading ─────────────────────────────────────────

describe("ifPanelVariablesCompletedLoading", () => {
  it("returns true when there are no variables", () => {
    const inst = makeComposable({ variablesValues: [] });
    expect(inst.ifPanelVariablesCompletedLoading()).toBe(true);
  });

  it("returns false when a dynamic variable is still loading", () => {
    const inst = makeComposable({
      variablesValues: [
        { type: "dynamic_filters", isLoading: true, value: [] },
      ],
    });
    expect(inst.ifPanelVariablesCompletedLoading()).toBe(false);
  });

  it("returns false when a dependent variable has not finished loading", () => {
    const varValues = [
      {
        name: "env",
        type: "custom",
        value: null,
        isVariablePartialLoaded: false,
      },
    ];
    const schemaQueries = [{ query: "SELECT * WHERE $env" }];
    const variablesData = makeVariablesData(varValues);
    const panelSchema = makePanelSchema(schemaQueries);
    const inst = usePanelVariableSubstitution({
      panelSchema,
      variablesData,
      chartPanelRef: makeChartPanelRef(),
      store: makeStore(),
      log,
    });
    expect(inst.ifPanelVariablesCompletedLoading()).toBe(false);
  });
});

// ─── variablesDataUpdated ─────────────────────────────────────────────────────

describe("variablesDataUpdated", () => {
  it("returns false when dynamic variables are still loading", () => {
    const inst = makeComposable({
      variablesValues: [
        { type: "dynamic_filters", isLoading: true, value: [] },
      ],
    });
    expect(inst.variablesDataUpdated()).toBe(false);
  });

  it("returns true when no variables exist (no waiting needed)", () => {
    const inst = makeComposable({ variablesValues: [] });
    expect(inst.variablesDataUpdated()).toBe(true);
  });

  it("returns false when scalar regular variable has same value as snapshot", () => {
    const varValues = [
      {
        name: "env",
        type: "custom",
        value: "prod",
        multiSelect: false,
        isVariablePartialLoaded: true,
      },
    ];
    const schemaQueries = [{ query: "SELECT * WHERE $env" }];
    const variablesData = makeVariablesData(varValues);
    const panelSchema = makePanelSchema(schemaQueries);
    const inst = usePanelVariableSubstitution({
      panelSchema,
      variablesData,
      chartPanelRef: makeChartPanelRef(),
      store: makeStore(),
      log,
    });
    // snapshot is initialized at construction — same value → no update
    expect(inst.variablesDataUpdated()).toBe(false);
  });
});

// ─── applyDynamicVariables ────────────────────────────────────────────────────

describe("applyDynamicVariables", () => {
  it("returns unchanged query when no dynamic_filters variables exist", async () => {
    const inst = makeComposable({ variablesValues: [] });
    const { query } = await inst.applyDynamicVariables(
      "SELECT * FROM logs",
      "sql",
    );
    expect(query).toBe("SELECT * FROM logs");
  });

  it("applies promql label injection for promql query type", async () => {
    const inst = makeComposable({
      variablesValues: [
        {
          type: "dynamic_filters",
          isLoading: false,
          isVariableLoadingPending: false,
          value: [{ name: "env", operator: "=", value: "prod" }],
        },
      ],
    });
    const { query } = await inst.applyDynamicVariables(
      "rate(metric[5m])",
      "promql",
    );
    // addLabelToPromQlQuery mock appends {env="prod"}
    expect(query).toContain("env");
  });

  it("accumulates metadata entries for each dynamic variable", async () => {
    const inst = makeComposable({
      variablesValues: [
        {
          type: "dynamic_filters",
          isLoading: false,
          isVariableLoadingPending: false,
          value: [
            { name: "env", operator: "=", value: "prod" },
            { name: "region", operator: "!=", value: "us-west" },
          ],
        },
      ],
    });
    const { metadata } = await inst.applyDynamicVariables(
      "rate(metric[5m])",
      "promql",
    );
    expect(metadata).toHaveLength(2);
    expect(metadata.map((m: any) => m.name)).toContain("env");
    expect(metadata.map((m: any) => m.name)).toContain("region");
  });
});
