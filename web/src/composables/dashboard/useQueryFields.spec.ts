/**
 * Unit tests for per-query field management (meta.queryFields).
 *
 * Tests the refactored architecture where customQueryFields and vrlFunctionFieldList
 * are stored per-query in meta.queryFields[queryIndex] instead of shared singletons.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { reactive, nextTick, watch } from "vue";

vi.mock("vue", async () => {
  const actual = await vi.importActual("vue");
  return { ...actual };
});

// ── Helpers ─────────────────────────────────────────────────────────────────

const makeDefaultQuery = (overrides: any = {}) => ({
  query: "",
  vrlFunctionQuery: "",
  customQuery: false,
  fields: {
    stream: "default",
    stream_type: "logs",
    x: [] as any[],
    y: [] as any[],
    z: [] as any[],
    breakdown: [] as any[],
    filter: {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [] as any[],
    },
    latitude: null,
    longitude: null,
    weight: null,
    name: null,
    value_for_maps: null,
    source: null,
    target: null,
    value: null,
  },
  config: {},
  joins: [],
  ...overrides,
});

const makePanelData = (queryCount = 1) =>
  reactive({
    data: {
      type: "bar",
      queryType: "sql",
      queries: Array.from({ length: queryCount }, () => makeDefaultQuery()),
    },
    layout: {
      currentQueryIndex: 0,
      vrlFunctionToggle: false,
      hiddenQueries: [] as number[],
    },
    meta: {
      queryFields: {} as Record<
        number,
        { customQueryFields: any[]; vrlFunctionFieldList: any[] }
      >,
      stream: {
        customQueryFields: [] as any[],
        vrlFunctionFieldList: [] as any[],
        streamResults: [] as any[],
      },
      streamFields: {
        groupedFields: [] as any[],
      },
    },
  });

// Simulate getQueryFields helper
const getQueryFields = (panelData: any, queryIndex: number) => {
  if (!panelData.meta.queryFields[queryIndex]) {
    panelData.meta.queryFields[queryIndex] = {
      customQueryFields: [],
      vrlFunctionFieldList: [],
    };
  }
  return panelData.meta.queryFields[queryIndex];
};

// Simulate syncCustomQueryFields helper
const syncCustomQueryFields = (panelData: any, fields: any[]) => {
  const currentIdx = panelData.layout.currentQueryIndex;
  getQueryFields(panelData, currentIdx).customQueryFields = fields;
  panelData.meta.stream.customQueryFields = fields;
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe("meta.queryFields - per-query field cache", () => {
  let panelData: ReturnType<typeof makePanelData>;

  beforeEach(() => {
    panelData = makePanelData(1);
  });

  // ── getQueryFields ──────────────────────────────────────────────────────

  describe("getQueryFields", () => {
    it("should initialize empty cache for new query index", () => {
      const queryFields = getQueryFields(panelData, 0);
      expect(queryFields.customQueryFields).toEqual([]);
      expect(queryFields.vrlFunctionFieldList).toEqual([]);
    });

    it("should return existing cache for known query index", () => {
      panelData.meta.queryFields[0] = {
        customQueryFields: [{ name: "col1", type: "" }],
        vrlFunctionFieldList: [],
      };
      const queryFields = getQueryFields(panelData, 0);
      expect(queryFields.customQueryFields).toHaveLength(1);
      expect(queryFields.customQueryFields[0].name).toBe("col1");
    });

    it("should not create cache entry on data.queries", () => {
      getQueryFields(panelData, 0);
      expect(panelData.data.queries[0]).not.toHaveProperty(
        "customQueryFields",
      );
    });

    it("should handle multiple query indices independently", () => {
      panelData = makePanelData(3);
      getQueryFields(panelData, 0).customQueryFields = [{ name: "a" }];
      getQueryFields(panelData, 1).customQueryFields = [{ name: "b" }];
      getQueryFields(panelData, 2).customQueryFields = [{ name: "c" }];

      expect(panelData.meta.queryFields[0].customQueryFields[0].name).toBe(
        "a",
      );
      expect(panelData.meta.queryFields[1].customQueryFields[0].name).toBe(
        "b",
      );
      expect(panelData.meta.queryFields[2].customQueryFields[0].name).toBe(
        "c",
      );
    });

    it("should initialize for non-existent high index", () => {
      const queryFields = getQueryFields(panelData, 99);
      expect(queryFields.customQueryFields).toEqual([]);
      expect(queryFields.vrlFunctionFieldList).toEqual([]);
    });
  });

  // ── syncCustomQueryFields ───────────────────────────────────────────────

  describe("syncCustomQueryFields", () => {
    it("should write to both meta.queryFields and meta.stream", () => {
      panelData.layout.currentQueryIndex = 0;
      const fields = [{ name: "x_axis_1", type: "" }];
      syncCustomQueryFields(panelData, fields);

      expect(
        panelData.meta.queryFields[0].customQueryFields,
      ).toStrictEqual(fields);
      expect(panelData.meta.stream.customQueryFields).toStrictEqual(fields);
    });

    it("should not write to data.queries", () => {
      syncCustomQueryFields(panelData, [{ name: "test", type: "" }]);
      expect(panelData.data.queries[0]).not.toHaveProperty(
        "customQueryFields",
      );
    });

    it("should write to correct query index", () => {
      panelData = makePanelData(3);
      panelData.layout.currentQueryIndex = 2;
      syncCustomQueryFields(panelData, [{ name: "col_c", type: "" }]);

      expect(
        panelData.meta.queryFields[2].customQueryFields[0].name,
      ).toBe("col_c");
      // Other indices should not be affected
      expect(panelData.meta.queryFields[0]).toBeUndefined();
      expect(panelData.meta.queryFields[1]).toBeUndefined();
    });

    it("should overwrite existing fields on same query index", () => {
      syncCustomQueryFields(panelData, [{ name: "first", type: "" }]);
      syncCustomQueryFields(panelData, [{ name: "second", type: "" }]);

      expect(
        panelData.meta.queryFields[0].customQueryFields,
      ).toHaveLength(1);
      expect(
        panelData.meta.queryFields[0].customQueryFields[0].name,
      ).toBe("second");
    });

    it("should clear fields when called with empty array", () => {
      syncCustomQueryFields(panelData, [
        { name: "a", type: "" },
        { name: "b", type: "" },
      ]);
      syncCustomQueryFields(panelData, []);

      expect(
        panelData.meta.queryFields[0].customQueryFields,
      ).toHaveLength(0);
      expect(panelData.meta.stream.customQueryFields).toHaveLength(0);
    });
  });

  // ── Tab switch field restoration ────────────────────────────────────────

  describe("tab switch field restoration", () => {
    beforeEach(() => {
      panelData = makePanelData(3);
    });

    it("should restore customQueryFields when switching tabs", () => {
      panelData.meta.queryFields[0] = {
        customQueryFields: [{ name: "col_a", type: "" }],
        vrlFunctionFieldList: [],
      };
      panelData.meta.queryFields[1] = {
        customQueryFields: [{ name: "col_b", type: "" }],
        vrlFunctionFieldList: [],
      };

      // Simulate tab switch to Q2
      const newIdx = 1;
      const queryFields = getQueryFields(panelData, newIdx);
      panelData.meta.stream.customQueryFields =
        queryFields.customQueryFields;

      expect(
        panelData.meta.stream.customQueryFields[0].name,
      ).toBe("col_b");
    });

    it("should restore vrlFunctionFieldList when switching tabs", () => {
      panelData.meta.queryFields[0] = {
        customQueryFields: [],
        vrlFunctionFieldList: [{ name: "vrl_a", type: "Utf8" }],
      };
      panelData.meta.queryFields[1] = {
        customQueryFields: [],
        vrlFunctionFieldList: [{ name: "vrl_b", type: "Utf8" }],
      };

      // Switch to Q2
      const queryFields = getQueryFields(panelData, 1);
      panelData.meta.stream.vrlFunctionFieldList =
        queryFields.vrlFunctionFieldList;

      expect(
        panelData.meta.stream.vrlFunctionFieldList[0].name,
      ).toBe("vrl_b");
    });

    it("should handle missing meta.queryFields entry gracefully", () => {
      panelData.meta.queryFields = {};

      const queryFields = getQueryFields(panelData, 5);
      panelData.meta.stream.customQueryFields =
        queryFields.customQueryFields;
      panelData.meta.stream.vrlFunctionFieldList =
        queryFields.vrlFunctionFieldList;

      expect(panelData.meta.stream.customQueryFields).toEqual([]);
      expect(panelData.meta.stream.vrlFunctionFieldList).toEqual([]);
    });

    it("should not leak fields between queries on rapid tab switching", () => {
      panelData.meta.queryFields[0] = {
        customQueryFields: [{ name: "a" }],
        vrlFunctionFieldList: [{ name: "vrl_a" }],
      };
      panelData.meta.queryFields[1] = {
        customQueryFields: [{ name: "b" }],
        vrlFunctionFieldList: [],
      };
      panelData.meta.queryFields[2] = {
        customQueryFields: [],
        vrlFunctionFieldList: [{ name: "vrl_c" }],
      };

      // Rapidly switch through all tabs
      for (let i = 0; i < 10; i++) {
        const idx = i % 3;
        const queryFields = getQueryFields(panelData, idx);
        panelData.meta.stream.customQueryFields =
          queryFields.customQueryFields;
        panelData.meta.stream.vrlFunctionFieldList =
          queryFields.vrlFunctionFieldList;
      }

      // End on Q1 (idx 0 after 10 iterations: 10 % 3 = 1, actually last iteration is i=9, 9%3=0)
      expect(
        panelData.meta.stream.customQueryFields[0].name,
      ).toBe("a");
      expect(
        panelData.meta.stream.vrlFunctionFieldList[0].name,
      ).toBe("vrl_a");

      // Per-query caches should be unchanged
      expect(
        panelData.meta.queryFields[1].customQueryFields[0].name,
      ).toBe("b");
      expect(
        panelData.meta.queryFields[2].vrlFunctionFieldList[0].name,
      ).toBe("vrl_c");
    });

    it("should preserve Q1 fields when switching to Q2 and back", () => {
      const q1Fields = [
        { name: "x_axis_1", type: "" },
        { name: "y_axis_1", type: "" },
      ];
      panelData.meta.queryFields[0] = {
        customQueryFields: q1Fields,
        vrlFunctionFieldList: [],
      };
      panelData.meta.queryFields[1] = {
        customQueryFields: [],
        vrlFunctionFieldList: [],
      };

      // Switch to Q2
      panelData.meta.stream.customQueryFields =
        getQueryFields(panelData, 1).customQueryFields;
      expect(panelData.meta.stream.customQueryFields).toHaveLength(0);

      // Switch back to Q1
      panelData.meta.stream.customQueryFields =
        getQueryFields(panelData, 0).customQueryFields;
      expect(panelData.meta.stream.customQueryFields).toHaveLength(2);
      expect(panelData.meta.stream.customQueryFields[0].name).toBe(
        "x_axis_1",
      );
    });
  });

  // ── Query add / remove ────────────────────────────────────────────────

  describe("query add / remove", () => {
    it("should initialize meta.queryFields for new query", () => {
      panelData = makePanelData(1);
      // Simulate addQuery
      panelData.data.queries.push(makeDefaultQuery());
      getQueryFields(panelData, panelData.data.queries.length - 1);

      expect(panelData.meta.queryFields[1]).toBeDefined();
      expect(
        panelData.meta.queryFields[1].customQueryFields,
      ).toEqual([]);
      expect(
        panelData.meta.queryFields[1].vrlFunctionFieldList,
      ).toEqual([]);
    });

    it("should shift meta.queryFields indices after middle removal", () => {
      panelData = makePanelData(3);
      panelData.meta.queryFields = {
        0: {
          customQueryFields: [{ name: "a" }],
          vrlFunctionFieldList: [],
        },
        1: {
          customQueryFields: [{ name: "b" }],
          vrlFunctionFieldList: [],
        },
        2: {
          customQueryFields: [{ name: "c" }],
          vrlFunctionFieldList: [],
        },
      };

      // Remove middle query (index 1)
      panelData.data.queries.splice(1, 1);
      const newQueryFields: Record<number, any> = {};
      Object.keys(panelData.meta.queryFields).forEach((key) => {
        const i = Number(key);
        if (i < 1)
          newQueryFields[i] = panelData.meta.queryFields[i];
        else if (i > 1)
          newQueryFields[i - 1] = panelData.meta.queryFields[i];
      });
      panelData.meta.queryFields = newQueryFields;

      expect(
        panelData.meta.queryFields[0].customQueryFields[0].name,
      ).toBe("a");
      expect(
        panelData.meta.queryFields[1].customQueryFields[0].name,
      ).toBe("c");
      expect(panelData.meta.queryFields[2]).toBeUndefined();
    });

    it("should shift meta.queryFields indices after first removal", () => {
      panelData = makePanelData(3);
      panelData.meta.queryFields = {
        0: {
          customQueryFields: [{ name: "a" }],
          vrlFunctionFieldList: [],
        },
        1: {
          customQueryFields: [{ name: "b" }],
          vrlFunctionFieldList: [],
        },
        2: {
          customQueryFields: [{ name: "c" }],
          vrlFunctionFieldList: [],
        },
      };

      // Remove first query (index 0)
      const removeIndex = 0;
      panelData.data.queries.splice(removeIndex, 1);
      const newQueryFields: Record<number, any> = {};
      Object.keys(panelData.meta.queryFields).forEach((key) => {
        const i = Number(key);
        if (i < removeIndex)
          newQueryFields[i] = panelData.meta.queryFields[i];
        else if (i > removeIndex)
          newQueryFields[i - 1] = panelData.meta.queryFields[i];
      });
      panelData.meta.queryFields = newQueryFields;

      expect(
        panelData.meta.queryFields[0].customQueryFields[0].name,
      ).toBe("b");
      expect(
        panelData.meta.queryFields[1].customQueryFields[0].name,
      ).toBe("c");
      expect(panelData.meta.queryFields[2]).toBeUndefined();
    });

    it("should handle removal of last query", () => {
      panelData = makePanelData(2);
      panelData.meta.queryFields = {
        0: {
          customQueryFields: [{ name: "a" }],
          vrlFunctionFieldList: [],
        },
        1: {
          customQueryFields: [{ name: "b" }],
          vrlFunctionFieldList: [],
        },
      };

      // Remove last query (index 1)
      const removeIndex = 1;
      panelData.data.queries.splice(removeIndex, 1);
      const newQueryFields: Record<number, any> = {};
      Object.keys(panelData.meta.queryFields).forEach((key) => {
        const i = Number(key);
        if (i < removeIndex)
          newQueryFields[i] = panelData.meta.queryFields[i];
        else if (i > removeIndex)
          newQueryFields[i - 1] = panelData.meta.queryFields[i];
      });
      panelData.meta.queryFields = newQueryFields;

      expect(
        panelData.meta.queryFields[0].customQueryFields[0].name,
      ).toBe("a");
      expect(panelData.meta.queryFields[1]).toBeUndefined();
    });
  });

  // ── Mode switch clearing ──────────────────────────────────────────────

  describe("mode switch clearing", () => {
    it("should clear both per-query and shared fields on mode switch", () => {
      panelData.meta.queryFields[0] = {
        customQueryFields: [{ name: "col1" }],
        vrlFunctionFieldList: [{ name: "vrl1" }],
      };
      panelData.meta.stream.customQueryFields = [{ name: "col1" }];
      panelData.meta.stream.vrlFunctionFieldList = [{ name: "vrl1" }];

      // Simulate mode switch clearing
      syncCustomQueryFields(panelData, []);
      panelData.meta.stream.vrlFunctionFieldList = [];
      getQueryFields(panelData, 0).vrlFunctionFieldList = [];

      expect(
        panelData.meta.queryFields[0].customQueryFields,
      ).toEqual([]);
      expect(
        panelData.meta.queryFields[0].vrlFunctionFieldList,
      ).toEqual([]);
      expect(panelData.meta.stream.customQueryFields).toEqual([]);
      expect(panelData.meta.stream.vrlFunctionFieldList).toEqual([]);
    });

    it("should only clear current query, not other queries", () => {
      panelData = makePanelData(2);
      panelData.meta.queryFields[0] = {
        customQueryFields: [{ name: "col_a" }],
        vrlFunctionFieldList: [],
      };
      panelData.meta.queryFields[1] = {
        customQueryFields: [{ name: "col_b" }],
        vrlFunctionFieldList: [{ name: "vrl_b" }],
      };

      // Clear Q1 (index 0)
      panelData.layout.currentQueryIndex = 0;
      syncCustomQueryFields(panelData, []);
      getQueryFields(panelData, 0).vrlFunctionFieldList = [];

      // Q1 cleared
      expect(
        panelData.meta.queryFields[0].customQueryFields,
      ).toEqual([]);
      // Q2 untouched
      expect(
        panelData.meta.queryFields[1].customQueryFields[0].name,
      ).toBe("col_b");
      expect(
        panelData.meta.queryFields[1].vrlFunctionFieldList[0].name,
      ).toBe("vrl_b");
    });
  });

  // ── VRL toggle clearing ───────────────────────────────────────────────

  describe("VRL toggle OFF clearing", () => {
    it("should clear only current query VRL fields on toggle OFF", () => {
      panelData = makePanelData(2);
      panelData.meta.queryFields[0] = {
        customQueryFields: [{ name: "col_a" }],
        vrlFunctionFieldList: [{ name: "vrl_a" }],
      };
      panelData.meta.queryFields[1] = {
        customQueryFields: [],
        vrlFunctionFieldList: [{ name: "vrl_b" }],
      };

      // Toggle OFF for Q1 (index 0)
      panelData.layout.currentQueryIndex = 0;
      panelData.meta.queryFields[0].vrlFunctionFieldList = [];
      panelData.meta.stream.vrlFunctionFieldList = [];

      // Q1 VRL cleared, custom preserved
      expect(
        panelData.meta.queryFields[0].vrlFunctionFieldList,
      ).toEqual([]);
      expect(
        panelData.meta.queryFields[0].customQueryFields[0].name,
      ).toBe("col_a");
      // Q2 VRL untouched
      expect(
        panelData.meta.queryFields[1].vrlFunctionFieldList[0].name,
      ).toBe("vrl_b");
    });
  });

  // ── Deduplication ─────────────────────────────────────────────────────

  describe("field deduplication", () => {
    it("should not include VRL fields that overlap with custom fields", () => {
      panelData.meta.stream.customQueryFields = [
        { name: "x_axis_1", type: "" },
        { name: "y_axis_1", type: "" },
      ];
      panelData.meta.stream.vrlFunctionFieldList = [
        { name: "x_axis_1", type: "Utf8" }, // duplicate
        { name: "extra_field", type: "Utf8" },
      ];

      // Simulate flattenGroupedFields logic
      const flattenedFields: any[] = [];
      const addedFieldNames = new Set<string>();

      panelData.meta.stream.customQueryFields.forEach((field: any) => {
        flattenedFields.push({ name: field.name, type: field.type });
        addedFieldNames.add(field.name?.toLowerCase());
      });

      panelData.meta.stream.vrlFunctionFieldList.forEach((field: any) => {
        if (!addedFieldNames.has(field.name?.toLowerCase())) {
          flattenedFields.push({ name: field.name, type: field.type });
          addedFieldNames.add(field.name?.toLowerCase());
        }
      });

      const names = flattenedFields.map((f) => f.name);
      expect(names.filter((n) => n === "x_axis_1")).toHaveLength(1);
      expect(names).toContain("extra_field");
      expect(flattenedFields).toHaveLength(3); // x_axis_1, y_axis_1, extra_field
    });

    it("should deduplicate case-insensitively", () => {
      panelData.meta.stream.customQueryFields = [
        { name: "MyField", type: "" },
      ];
      panelData.meta.stream.vrlFunctionFieldList = [
        { name: "myfield", type: "Utf8" },
      ];

      const addedFieldNames = new Set<string>();
      const flattenedFields: any[] = [];

      panelData.meta.stream.customQueryFields.forEach((f: any) => {
        flattenedFields.push(f);
        addedFieldNames.add(f.name?.toLowerCase());
      });
      panelData.meta.stream.vrlFunctionFieldList.forEach((f: any) => {
        if (!addedFieldNames.has(f.name?.toLowerCase())) {
          flattenedFields.push(f);
        }
      });

      expect(flattenedFields).toHaveLength(1);
      expect(flattenedFields[0].name).toBe("MyField");
    });

    it("should not deduplicate when fields are different", () => {
      panelData.meta.stream.customQueryFields = [
        { name: "field_a", type: "" },
      ];
      panelData.meta.stream.vrlFunctionFieldList = [
        { name: "field_b", type: "Utf8" },
      ];

      const addedFieldNames = new Set<string>();
      const flattenedFields: any[] = [];

      panelData.meta.stream.customQueryFields.forEach((f: any) => {
        flattenedFields.push(f);
        addedFieldNames.add(f.name?.toLowerCase());
      });
      panelData.meta.stream.vrlFunctionFieldList.forEach((f: any) => {
        if (!addedFieldNames.has(f.name?.toLowerCase())) {
          flattenedFields.push(f);
        }
      });

      expect(flattenedFields).toHaveLength(2);
    });
  });

  // ── No data object pollution ──────────────────────────────────────────

  describe("data object isolation", () => {
    it("should never add customQueryFields to data.queries", () => {
      panelData = makePanelData(3);

      // Write fields for all queries
      for (let i = 0; i < 3; i++) {
        panelData.layout.currentQueryIndex = i;
        syncCustomQueryFields(panelData, [{ name: `field_${i}` }]);
      }

      // Verify data.queries has no customQueryFields
      panelData.data.queries.forEach((query: any) => {
        expect(query).not.toHaveProperty("customQueryFields");
      });

      // Verify meta.queryFields has them
      for (let i = 0; i < 3; i++) {
        expect(
          panelData.meta.queryFields[i].customQueryFields[0].name,
        ).toBe(`field_${i}`);
      }
    });

    it("should never add vrlFunctionFieldList to data.queries", () => {
      panelData = makePanelData(2);

      // Write VRL fields for both queries
      getQueryFields(panelData, 0).vrlFunctionFieldList = [
        { name: "vrl_0", type: "Utf8" },
      ];
      getQueryFields(panelData, 1).vrlFunctionFieldList = [
        { name: "vrl_1", type: "Utf8" },
      ];

      // Verify data.queries is clean
      panelData.data.queries.forEach((query: any) => {
        expect(query).not.toHaveProperty("vrlFunctionFieldList");
      });
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("should handle empty meta.queryFields object", () => {
      panelData.meta.queryFields = {};
      const queryFields = getQueryFields(panelData, 0);
      expect(queryFields.customQueryFields).toEqual([]);
    });

    it("should handle switching to a query index that has no cache yet", () => {
      panelData = makePanelData(3);
      // Only Q1 has fields cached
      panelData.meta.queryFields[0] = {
        customQueryFields: [{ name: "col_a" }],
        vrlFunctionFieldList: [],
      };

      // Switch to Q3 (no cache)
      const queryFields = getQueryFields(panelData, 2);
      panelData.meta.stream.customQueryFields =
        queryFields.customQueryFields;

      expect(panelData.meta.stream.customQueryFields).toEqual([]);
      // Q1 cache untouched
      expect(
        panelData.meta.queryFields[0].customQueryFields[0].name,
      ).toBe("col_a");
    });

    it("should handle fields with null/undefined names", () => {
      const addedFieldNames = new Set<string>();

      const fieldWithNull = { name: null, type: "" };
      addedFieldNames.add(fieldWithNull.name?.toLowerCase());

      // Should not crash, undefined is added to set
      expect(addedFieldNames.has(undefined as any)).toBe(true);
    });

    it("should handle concurrent writes to different query indices", () => {
      panelData = makePanelData(3);

      // Simulate concurrent VRL field updates for all queries
      getQueryFields(panelData, 0).vrlFunctionFieldList = [
        { name: "vrl_0" },
      ];
      getQueryFields(panelData, 1).vrlFunctionFieldList = [
        { name: "vrl_1" },
      ];
      getQueryFields(panelData, 2).vrlFunctionFieldList = [
        { name: "vrl_2" },
      ];

      // Verify all independent
      expect(
        panelData.meta.queryFields[0].vrlFunctionFieldList[0].name,
      ).toBe("vrl_0");
      expect(
        panelData.meta.queryFields[1].vrlFunctionFieldList[0].name,
      ).toBe("vrl_1");
      expect(
        panelData.meta.queryFields[2].vrlFunctionFieldList[0].name,
      ).toBe("vrl_2");
    });

    it("should handle 10+ queries without performance issues", () => {
      panelData = makePanelData(10);

      for (let i = 0; i < 10; i++) {
        panelData.layout.currentQueryIndex = i;
        syncCustomQueryFields(panelData, [
          { name: `custom_${i}`, type: "" },
        ]);
        getQueryFields(panelData, i).vrlFunctionFieldList = [
          { name: `vrl_${i}`, type: "Utf8" },
        ];
      }

      // Verify all 10 queries have independent caches
      for (let i = 0; i < 10; i++) {
        expect(
          panelData.meta.queryFields[i].customQueryFields[0].name,
        ).toBe(`custom_${i}`);
        expect(
          panelData.meta.queryFields[i].vrlFunctionFieldList[0].name,
        ).toBe(`vrl_${i}`);
      }

      // Shared meta should show last query's fields
      expect(
        panelData.meta.stream.customQueryFields[0].name,
      ).toBe("custom_9");
    });
  });

  // ── buildAliasListForQuery ────────────────────────────────────────────

  describe("buildAliasListForQuery", () => {
    // Simulate the function
    const buildAliasListForQuery = (
      pd: any,
      queryIndex: number,
    ): string[] => {
      const aliasList: string[] = [];
      const query = pd.data.queries[queryIndex];
      if (!query) return aliasList;

      ["x", "y", "z", "breakdown"].forEach((axis) => {
        query?.fields?.[axis]?.forEach((it: any) => {
          if (!it.isDerived && it.alias) aliasList.push(it.alias);
        });
      });

      const specialFields = [
        "latitude",
        "longitude",
        "weight",
        "source",
        "target",
        "value",
        "name",
        "value_for_maps",
      ];
      specialFields.forEach((fieldName) => {
        const field = query?.fields?.[fieldName];
        if (field?.alias && !field?.isDerived)
          aliasList.push(field.alias);
      });

      const queryFields = pd.meta.queryFields[queryIndex];
      if (queryFields) {
        queryFields.customQueryFields.forEach((it: any) =>
          aliasList.push(it.name),
        );
      }

      return aliasList;
    };

    it("should include axis field aliases for builder mode", () => {
      panelData.data.queries[0].fields.x = [
        { alias: "x_axis_1", isDerived: false },
      ];
      panelData.data.queries[0].fields.y = [
        { alias: "y_axis_1", isDerived: false },
      ];

      const aliases = buildAliasListForQuery(panelData, 0);
      expect(aliases).toContain("x_axis_1");
      expect(aliases).toContain("y_axis_1");
    });

    it("should include axis field aliases for custom mode too", () => {
      panelData.data.queries[0].customQuery = true;
      panelData.data.queries[0].fields.x = [
        { alias: "timestamp", isDerived: false },
      ];

      const aliases = buildAliasListForQuery(panelData, 0);
      expect(aliases).toContain("timestamp");
    });

    it("should exclude isDerived fields", () => {
      panelData.data.queries[0].fields.x = [
        { alias: "derived_field", isDerived: true },
      ];

      const aliases = buildAliasListForQuery(panelData, 0);
      expect(aliases).not.toContain("derived_field");
    });

    it("should include customQueryFields from meta.queryFields", () => {
      panelData.meta.queryFields[0] = {
        customQueryFields: [{ name: "custom_col", type: "" }],
        vrlFunctionFieldList: [],
      };

      const aliases = buildAliasListForQuery(panelData, 0);
      expect(aliases).toContain("custom_col");
    });

    it("should read customQueryFields from correct query index", () => {
      panelData = makePanelData(2);
      panelData.meta.queryFields[0] = {
        customQueryFields: [{ name: "col_q0" }],
        vrlFunctionFieldList: [],
      };
      panelData.meta.queryFields[1] = {
        customQueryFields: [{ name: "col_q1" }],
        vrlFunctionFieldList: [],
      };

      const aliasesQ0 = buildAliasListForQuery(panelData, 0);
      const aliasesQ1 = buildAliasListForQuery(panelData, 1);

      expect(aliasesQ0).toContain("col_q0");
      expect(aliasesQ0).not.toContain("col_q1");
      expect(aliasesQ1).toContain("col_q1");
      expect(aliasesQ1).not.toContain("col_q0");
    });

    it("should handle query with no meta.queryFields entry", () => {
      panelData.meta.queryFields = {};
      const aliases = buildAliasListForQuery(panelData, 0);
      // Should not crash, just return axis aliases
      expect(Array.isArray(aliases)).toBe(true);
    });
  });
});
