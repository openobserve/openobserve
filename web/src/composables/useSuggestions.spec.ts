// Copyright 2023 OpenObserve Inc.
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

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks before imports ---

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: {
      zoConfig: { timestamp_column: "_timestamp" },
    },
  })),
}));

import useSuggestions from "./useSuggestions";

// ---------------------------------------------------------------------------

describe("useSuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Return value structure
  // -------------------------------------------------------------------------
  describe("return value structure", () => {
    it("returns all expected properties", () => {
      const result = useSuggestions();

      expect(result).toHaveProperty("autoCompleteData");
      expect(result).toHaveProperty("autoCompleteKeywords");
      expect(result).toHaveProperty("autoCompleteSuggestions");
      expect(result).toHaveProperty("loading");
      expect(result).toHaveProperty("getSuggestions");
      expect(result).toHaveProperty("updateFieldKeywords");
      expect(result).toHaveProperty("updateFunctionKeywords");
      expect(result).toHaveProperty("defaultSuggestions");
    });

    it("loading is a ref defaulting to false", () => {
      const { loading } = useSuggestions();
      expect(loading.value).toBe(false);
    });

    it("autoCompleteKeywords starts as an empty array", () => {
      const { autoCompleteKeywords } = useSuggestions();
      expect(autoCompleteKeywords.value).toEqual([]);
    });

    it("autoCompleteSuggestions starts as an empty array", () => {
      const { autoCompleteSuggestions } = useSuggestions();
      expect(autoCompleteSuggestions.value).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // defaultSuggestions
  // -------------------------------------------------------------------------
  describe("defaultSuggestions", () => {
    it("is a non-empty array", () => {
      const { defaultSuggestions } = useSuggestions();
      expect(Array.isArray(defaultSuggestions)).toBe(true);
      expect(defaultSuggestions.length).toBeGreaterThan(0);
    });

    it("every entry has label, kind, and insertText properties", () => {
      const { defaultSuggestions } = useSuggestions();
      defaultSuggestions.forEach((s: any) => {
        expect(s).toHaveProperty("label");
        expect(s).toHaveProperty("kind");
        expect(s).toHaveProperty("insertText");
      });
    });

    it("contains match_all suggestion", () => {
      const { defaultSuggestions } = useSuggestions();
      const hasMatchAll = defaultSuggestions.some((s: any) => {
        const label =
          typeof s.label === "function" ? s.label("test") : s.label;
        return label.includes("match_all");
      });
      expect(hasMatchAll).toBe(true);
    });

    it("contains str_match suggestion", () => {
      const { defaultSuggestions } = useSuggestions();
      const has = defaultSuggestions.some((s: any) => {
        const label =
          typeof s.label === "function" ? s.label("test") : s.label;
        return label.includes("str_match");
      });
      expect(has).toBe(true);
    });

    it("contains histogram suggestion", () => {
      const { defaultSuggestions } = useSuggestions();
      const has = defaultSuggestions.some((s: any) => {
        const label =
          typeof s.label === "function" ? s.label("field") : s.label;
        return label.includes("histogram");
      });
      expect(has).toBe(true);
    });

    it("function-label entries produce correct output when called with a keyword", () => {
      const { defaultSuggestions } = useSuggestions();
      const matchAll = defaultSuggestions.find((s: any) => {
        const label =
          typeof s.label === "function" ? s.label("") : s.label;
        return label.startsWith("match_all(");
      });
      expect(matchAll).toBeDefined();
      expect(typeof matchAll!.label).toBe("function");
      expect((matchAll!.label as Function)("hello")).toBe("match_all('hello')");
    });
  });

  // -------------------------------------------------------------------------
  // updateFieldKeywords
  // -------------------------------------------------------------------------
  describe("updateFieldKeywords", () => {
    it("populates autoCompleteKeywords with field entries", () => {
      const { updateFieldKeywords, autoCompleteKeywords } = useSuggestions();

      updateFieldKeywords([
        { name: "level" },
        { name: "service_name" },
      ]);

      const fieldLabels = autoCompleteKeywords.value
        .filter((k: any) => k.kind === "Field")
        .map((k: any) => k.label);

      expect(fieldLabels).toContain("level");
      expect(fieldLabels).toContain("service_name");
    });

    it("excludes the timestamp_column from field keywords", () => {
      const { updateFieldKeywords, autoCompleteKeywords } = useSuggestions();

      updateFieldKeywords([{ name: "_timestamp" }, { name: "level" }]);

      const fieldLabels = autoCompleteKeywords.value
        .filter((k: any) => k.kind === "Field")
        .map((k: any) => k.label);

      expect(fieldLabels).not.toContain("_timestamp");
      expect(fieldLabels).toContain("level");
    });

    it("sets kind to Field for each field entry", () => {
      const { updateFieldKeywords, autoCompleteKeywords } = useSuggestions();

      updateFieldKeywords([{ name: "host" }]);

      const fieldEntry = autoCompleteKeywords.value.find(
        (k: any) => k.label === "host",
      );
      expect(fieldEntry?.kind).toBe("Field");
    });

    it("sets insertTextRules to InsertAsSnippet for field entries", () => {
      const { updateFieldKeywords, autoCompleteKeywords } = useSuggestions();

      updateFieldKeywords([{ name: "host" }]);

      const fieldEntry = autoCompleteKeywords.value.find(
        (k: any) => k.label === "host",
      );
      expect(fieldEntry?.insertTextRules).toBe("InsertAsSnippet");
    });

    it("also appends default SQL keywords to autoCompleteKeywords", () => {
      const { updateFieldKeywords, autoCompleteKeywords } = useSuggestions();

      updateFieldKeywords([{ name: "level" }]);

      const keywordLabels = autoCompleteKeywords.value
        .filter((k: any) => k.kind === "Keyword")
        .map((k: any) => k.label);

      expect(keywordLabels).toContain("and");
      expect(keywordLabels).toContain("or");
    });

    it("handles empty fields array without error", () => {
      const { updateFieldKeywords, autoCompleteKeywords } = useSuggestions();

      expect(() => updateFieldKeywords([])).not.toThrow();
      // Only default keywords and operators present (no Field entries)
      const fieldEntries = autoCompleteKeywords.value.filter(
        (k: any) => k.kind === "Field",
      );
      expect(fieldEntries.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // updateFunctionKeywords
  // -------------------------------------------------------------------------
  describe("updateFunctionKeywords", () => {
    it("adds function entries with kind Function", () => {
      const { updateFunctionKeywords, autoCompleteKeywords } = useSuggestions();

      updateFunctionKeywords([{ name: "myFunc", args: "(x)" }]);

      const funcEntry = autoCompleteKeywords.value.find(
        (k: any) => k.kind === "Function",
      );
      expect(funcEntry?.label).toBe("myFunc");
    });

    it("concatenates name and args for insertText", () => {
      const { updateFunctionKeywords, autoCompleteKeywords } = useSuggestions();

      updateFunctionKeywords([{ name: "transform", args: "(field, value)" }]);

      const funcEntry = autoCompleteKeywords.value.find(
        (k: any) => k.label === "transform",
      );
      expect(funcEntry?.insertText).toBe("transform(field, value)");
    });

    it("handles empty functions array without error", () => {
      const { updateFunctionKeywords, autoCompleteKeywords } = useSuggestions();

      expect(() => updateFunctionKeywords([])).not.toThrow();
      const funcEntries = autoCompleteKeywords.value.filter(
        (k: any) => k.kind === "Function",
      );
      expect(funcEntries.length).toBe(0);
    });

    it("replaces previously set function keywords on second call", () => {
      const { updateFunctionKeywords, autoCompleteKeywords } = useSuggestions();

      updateFunctionKeywords([{ name: "funcA", args: "()" }]);
      updateFunctionKeywords([{ name: "funcB", args: "()" }]);

      const funcLabels = autoCompleteKeywords.value
        .filter((k: any) => k.kind === "Function")
        .map((k: any) => k.label);

      expect(funcLabels).not.toContain("funcA");
      expect(funcLabels).toContain("funcB");
    });
  });

  // -------------------------------------------------------------------------
  // getSuggestions — field-value path
  // -------------------------------------------------------------------------
  describe("getSuggestions – field-value lookup", () => {
    it("populates autoCompleteKeywords with field values when column=value pattern is detected", async () => {
      const {
        getSuggestions,
        autoCompleteData,
        autoCompleteKeywords,
      } = useSuggestions();

      // Simulate SQL like: "level = " with cursor at end
      autoCompleteData.value.query = "level = ";
      autoCompleteData.value.position.cursorIndex = 8;
      autoCompleteData.value.fieldValues = {
        level: new Set(["error", "warn", "info"]),
      };
      autoCompleteData.value.popup = {
        open: vi.fn(),
        close: vi.fn(),
      };

      await getSuggestions();

      const valueLabels = autoCompleteKeywords.value.map((k: any) => k.label);
      expect(valueLabels).toContain("error");
      expect(valueLabels).toContain("warn");
      expect(valueLabels).toContain("info");
    });

    it("wraps field values in single quotes for insertText", async () => {
      const {
        getSuggestions,
        autoCompleteData,
        autoCompleteKeywords,
      } = useSuggestions();

      autoCompleteData.value.query = "level = ";
      autoCompleteData.value.position.cursorIndex = 8;
      autoCompleteData.value.fieldValues = {
        level: new Set(["error"]),
      };
      autoCompleteData.value.popup = { open: vi.fn(), close: vi.fn() };

      await getSuggestions();

      const entry = autoCompleteKeywords.value.find(
        (k: any) => k.label === "error",
      );
      expect(entry?.insertText).toBe("'error'");
    });

    it("calls popup.open after populating field-value keywords", async () => {
      const {
        getSuggestions,
        autoCompleteData,
      } = useSuggestions();

      const mockOpen = vi.fn();
      autoCompleteData.value.query = "level = ";
      autoCompleteData.value.position.cursorIndex = 8;
      autoCompleteData.value.fieldValues = {
        level: new Set(["error"]),
      };
      autoCompleteData.value.popup = { open: mockOpen, close: vi.fn() };

      await getSuggestions();

      expect(mockOpen).toHaveBeenCalledWith("level = ");
    });

    it("clears autoCompleteSuggestions when field-value path is taken", async () => {
      const {
        getSuggestions,
        autoCompleteData,
        autoCompleteSuggestions,
      } = useSuggestions();

      autoCompleteData.value.query = "level = ";
      autoCompleteData.value.position.cursorIndex = 8;
      autoCompleteData.value.fieldValues = {
        level: new Set(["error"]),
      };
      autoCompleteData.value.popup = { open: vi.fn(), close: vi.fn() };

      await getSuggestions();

      expect(autoCompleteSuggestions.value).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getSuggestions — general / non-field-value path
  // -------------------------------------------------------------------------
  describe("getSuggestions – general path", () => {
    it("falls through to general suggestions when no field-value match", async () => {
      const {
        getSuggestions,
        autoCompleteData,
        autoCompleteKeywords,
        autoCompleteSuggestions,
      } = useSuggestions();

      autoCompleteData.value.query = "some random query";
      autoCompleteData.value.position.cursorIndex = 17;
      autoCompleteData.value.fieldValues = {};
      autoCompleteData.value.popup = { open: vi.fn(), close: vi.fn() };

      await getSuggestions();

      // Should populate with default keywords (and, or, etc.)
      const keywordLabels = autoCompleteKeywords.value
        .filter((k: any) => k.kind === "Keyword")
        .map((k: any) => k.label);
      expect(keywordLabels).toContain("and");
      // Should also populate autoCompleteSuggestions with function suggestions
      expect(autoCompleteSuggestions.value.length).toBeGreaterThan(0);
    });

    it("includes operator suggestions (<, >, =) in general path", async () => {
      const {
        getSuggestions,
        autoCompleteData,
        autoCompleteKeywords,
      } = useSuggestions();

      autoCompleteData.value.query = "query text";
      autoCompleteData.value.position.cursorIndex = 10;
      autoCompleteData.value.fieldValues = {};
      autoCompleteData.value.popup = { open: vi.fn(), close: vi.fn() };

      await getSuggestions();

      const operatorLabels = autoCompleteKeywords.value
        .filter((k: any) => k.kind === "Operator")
        .map((k: any) => k.label);
      expect(operatorLabels).toContain("=");
      expect(operatorLabels).toContain("!=");
    });
  });

  // -------------------------------------------------------------------------
  // autoCompleteData default structure
  // -------------------------------------------------------------------------
  describe("autoCompleteData default structure", () => {
    it("has correct initial fieldValues, query, and position", () => {
      const { autoCompleteData } = useSuggestions();

      expect(autoCompleteData.value.fieldValues).toEqual({});
      expect(autoCompleteData.value.query).toBe("");
      expect(autoCompleteData.value.position.cursorIndex).toBe(0);
    });

    it("popup.open and popup.close are functions by default", () => {
      const { autoCompleteData } = useSuggestions();

      expect(typeof autoCompleteData.value.popup.open).toBe("function");
      expect(typeof autoCompleteData.value.popup.close).toBe("function");
    });
  });
});
