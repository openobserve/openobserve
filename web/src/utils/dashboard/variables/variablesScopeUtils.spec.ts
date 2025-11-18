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

import { describe, it, expect } from "vitest";
import { getScopeType } from "./variablesScopeUtils";

describe("variablesScopeUtils", () => {
  describe("getScopeType", () => {
    describe("Panels Scope", () => {
      it("should return 'panels' when variable has non-empty panels array", () => {
        const variable = {
          name: "testVar",
          panels: ["panel1", "panel2"],
        };

        expect(getScopeType(variable)).toBe("panels");
      });

      it("should return 'panels' when variable has panels array with single panel", () => {
        const variable = {
          name: "testVar",
          panels: ["panel1"],
        };

        expect(getScopeType(variable)).toBe("panels");
      });

      it("should return 'panels' when variable has both panels and tabs arrays but panels is non-empty", () => {
        const variable = {
          name: "testVar",
          panels: ["panel1"],
          tabs: ["tab1"],
        };

        expect(getScopeType(variable)).toBe("panels");
      });

      it("should return 'panels' when variable has panels with empty tabs array", () => {
        const variable = {
          name: "testVar",
          panels: ["panel1"],
          tabs: [],
        };

        expect(getScopeType(variable)).toBe("panels");
      });
    });

    describe("Tabs Scope", () => {
      it("should return 'tabs' when variable has non-empty tabs array and no panels", () => {
        const variable = {
          name: "testVar",
          tabs: ["tab1", "tab2"],
        };

        expect(getScopeType(variable)).toBe("tabs");
      });

      it("should return 'tabs' when variable has tabs array with single tab", () => {
        const variable = {
          name: "testVar",
          tabs: ["tab1"],
        };

        expect(getScopeType(variable)).toBe("tabs");
      });

      it("should return 'tabs' when variable has empty panels array and non-empty tabs array", () => {
        const variable = {
          name: "testVar",
          panels: [],
          tabs: ["tab1"],
        };

        expect(getScopeType(variable)).toBe("tabs");
      });

      it("should return 'tabs' when variable has tabs but panels is undefined", () => {
        const variable = {
          name: "testVar",
          panels: undefined,
          tabs: ["tab1"],
        };

        expect(getScopeType(variable)).toBe("tabs");
      });
    });

    describe("Global Scope", () => {
      it("should return 'global' when variable has no panels and no tabs", () => {
        const variable = {
          name: "testVar",
        };

        expect(getScopeType(variable)).toBe("global");
      });

      it("should return 'global' when variable has empty panels and empty tabs arrays", () => {
        const variable = {
          name: "testVar",
          panels: [],
          tabs: [],
        };

        expect(getScopeType(variable)).toBe("global");
      });

      it("should return 'global' when variable has undefined panels and tabs", () => {
        const variable = {
          name: "testVar",
          panels: undefined,
          tabs: undefined,
        };

        expect(getScopeType(variable)).toBe("global");
      });

      it("should return 'global' when variable has null panels and tabs", () => {
        const variable = {
          name: "testVar",
          panels: null,
          tabs: null,
        };

        expect(getScopeType(variable)).toBe("global");
      });

      it("should return 'global' when panels is empty array", () => {
        const variable = {
          name: "testVar",
          panels: [],
        };

        expect(getScopeType(variable)).toBe("global");
      });

      it("should return 'global' when tabs is empty array", () => {
        const variable = {
          name: "testVar",
          tabs: [],
        };

        expect(getScopeType(variable)).toBe("global");
      });
    });

    describe("Edge Cases", () => {
      it("should handle empty object", () => {
        const variable = {};

        expect(getScopeType(variable)).toBe("global");
      });

      it("should throw error for null input", () => {
        const variable = null;

        expect(() => getScopeType(variable)).toThrow();
      });

      it("should throw error for undefined input", () => {
        const variable = undefined;

        expect(() => getScopeType(variable)).toThrow();
      });

      it("should prioritize panels over tabs when both are empty", () => {
        const variable = {
          panels: [],
          tabs: [],
        };

        expect(getScopeType(variable)).toBe("global");
      });

      it("should handle panels with falsy values", () => {
        const variable = {
          panels: [0, false, ""],
        };

        expect(getScopeType(variable)).toBe("panels");
      });

      it("should handle tabs with falsy values", () => {
        const variable = {
          tabs: [0, false, ""],
        };

        expect(getScopeType(variable)).toBe("tabs");
      });

      it("should handle panels as string instead of array", () => {
        const variable = {
          panels: "panel1",
        };

        // String has length property, so function treats it as having panels
        expect(getScopeType(variable)).toBe("panels");
      });

      it("should handle tabs as string instead of array", () => {
        const variable = {
          tabs: "tab1",
        };

        // String has length property, so function treats it as having tabs
        expect(getScopeType(variable)).toBe("tabs");
      });

      it("should handle panels with numeric values", () => {
        const variable = {
          panels: [1, 2, 3],
        };

        expect(getScopeType(variable)).toBe("panels");
      });

      it("should handle tabs with object values", () => {
        const variable = {
          tabs: [{ id: "tab1" }, { id: "tab2" }],
        };

        expect(getScopeType(variable)).toBe("tabs");
      });

      it("should handle very large panels array", () => {
        const variable = {
          panels: Array.from({ length: 1000 }, (_, i) => `panel${i}`),
        };

        expect(getScopeType(variable)).toBe("panels");
      });

      it("should handle very large tabs array", () => {
        const variable = {
          tabs: Array.from({ length: 1000 }, (_, i) => `tab${i}`),
        };

        expect(getScopeType(variable)).toBe("tabs");
      });

      it("should handle panels array with mixed types", () => {
        const variable = {
          panels: ["panel1", 123, { id: "panel2" }, null, undefined],
        };

        expect(getScopeType(variable)).toBe("panels");
      });

      it("should handle tabs array with mixed types", () => {
        const variable = {
          tabs: ["tab1", 456, { id: "tab2" }, true],
        };

        expect(getScopeType(variable)).toBe("tabs");
      });
    });

    describe("Complex Variable Objects", () => {
      it("should correctly identify scope for variable with additional properties", () => {
        const variable = {
          name: "complexVar",
          type: "query",
          value: "default",
          panels: ["panel1"],
          description: "A complex variable",
        };

        expect(getScopeType(variable)).toBe("panels");
      });

      it("should handle variable with many properties but no scope arrays", () => {
        const variable = {
          name: "globalVar",
          type: "custom",
          value: "value1",
          options: ["opt1", "opt2"],
          description: "Global variable",
        };

        expect(getScopeType(variable)).toBe("global");
      });

      it("should handle variable with nested objects", () => {
        const variable = {
          name: "nestedVar",
          config: {
            panels: ["panel1"],
          },
        };

        // Config.panels is not at top level
        expect(getScopeType(variable)).toBe("global");
      });
    });

    describe("Boundary Conditions", () => {
      it("should handle panels array with only null/undefined values", () => {
        const variable = {
          panels: [null, undefined, null],
        };

        expect(getScopeType(variable)).toBe("panels");
      });

      it("should handle tabs array with only null/undefined values", () => {
        const variable = {
          tabs: [null, undefined, null],
        };

        expect(getScopeType(variable)).toBe("tabs");
      });

      it("should handle variable with both empty arrays and other properties", () => {
        const variable = {
          name: "emptyVar",
          panels: [],
          tabs: [],
          value: "some value",
          type: "constant",
        };

        expect(getScopeType(variable)).toBe("global");
      });
    });

    describe("Type Consistency", () => {
      it("should always return one of the three scope types for valid inputs", () => {
        const validScopes = ["panels", "tabs", "global"];

        const testCases = [
          {},
          { panels: ["p1"] },
          { tabs: ["t1"] },
          { panels: [], tabs: [] },
        ];

        testCases.forEach((variable) => {
          const result = getScopeType(variable);
          expect(validScopes).toContain(result);
        });
      });

      it("should return string type for all inputs", () => {
        const testCases = [
          { panels: ["p1"] },
          { tabs: ["t1"] },
          {},
        ];

        testCases.forEach((variable) => {
          const result = getScopeType(variable);
          expect(typeof result).toBe("string");
        });
      });
    });
  });
});
