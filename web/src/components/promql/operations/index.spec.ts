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

import { describe, it, expect, beforeEach } from "vitest";
import { buildPromqlStepCatalog } from "./index";
import { PromqlStepId, PromqlStepGroup } from "../types";

describe("buildPromqlStepCatalog", () => {
  let definitions: ReturnType<typeof buildPromqlStepCatalog>;

  beforeEach(() => {
    definitions = buildPromqlStepCatalog();
  });

  /**
   * The enum and the catalog have to stay in lockstep.
   *
   * They drifted before: the enum carried members (`group`, `stdvar`,
   * `count_values`, `time`, `timestamp`) that no catalog entry ever defined, so
   * the picker offered nothing for them and `getStepSpec` returned undefined —
   * a step id the code believed in and the app could not render. These tests
   * make that state unrepresentable in either direction.
   */
  describe("catalog integrity", () => {
    it("defines every step the enum declares", () => {
      const defined = new Set(definitions.map((d) => d.id));
      const undefinedSteps = Object.values(PromqlStepId).filter((id) => !defined.has(id));

      expect(undefinedSteps).toEqual([]);
    });

    it("declares every step the catalog defines", () => {
      const known = new Set<string>(Object.values(PromqlStepId));
      const strays = definitions.map((d) => d.id).filter((id) => !known.has(id));

      expect(strays).toEqual([]);
    });

    it("defines each step exactly once", () => {
      const ids = definitions.map((d) => d.id);

      expect(ids).toHaveLength(new Set(ids).size);
    });

    it("never carries a retired step id", () => {
      // The catalog is keyed on CURRENT ids. A retired id belongs only in the
      // compatibility table, and reaching the catalog would mean the rename was
      // half-applied.
      const retired = definitions.filter((d) => d.id.startsWith("__"));

      expect(retired).toEqual([]);
    });

    it("gives every step a group the picker actually shows", () => {
      const groups = new Set<string>(Object.values(PromqlStepGroup));
      const orphaned = definitions.filter((d) => !groups.has(d.group));

      expect(orphaned).toEqual([]);
    });
  });

  describe("Basic Structure", () => {
    it("should return an array", () => {
      expect(Array.isArray(definitions)).toBe(true);
    });

    it("should return a non-empty array", () => {
      expect(definitions.length).toBeGreaterThan(0);
    });

    it("should have all required fields for each operation", () => {
      definitions.forEach((def) => {
        expect(def).toHaveProperty("id");
        expect(def).toHaveProperty("name");
        expect(def).toHaveProperty("params");
        expect(def).toHaveProperty("defaultParams");
        expect(def).toHaveProperty("group");
      });
    });

    it("should have unique operation ids", () => {
      const ids = definitions.map((def) => def.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("should have non-empty names for all operations", () => {
      definitions.forEach((def) => {
        expect(def.name).toBeTruthy();
        expect(typeof def.name).toBe("string");
      });
    });

    it("should have valid category for each operation", () => {
      const validGroups = Object.values(PromqlStepGroup);
      definitions.forEach((def) => {
        expect(validGroups).toContain(def.group);
      });
    });

    it("should have params as array for each operation", () => {
      definitions.forEach((def) => {
        expect(Array.isArray(def.params)).toBe(true);
        expect(Array.isArray(def.defaultParams)).toBe(true);
      });
    });
  });

  describe("Operation Counts by Category", () => {
    it("should have multiple range functions", () => {
      const rangeFunctions = definitions.filter((d) => d.group === PromqlStepGroup.RateAndRange);
      expect(rangeFunctions.length).toBeGreaterThanOrEqual(10);
    });

    it("should have multiple aggregations", () => {
      const aggregations = definitions.filter((d) => d.group === PromqlStepGroup.Aggregation);
      expect(aggregations.length).toBeGreaterThanOrEqual(8);
    });

    it("should have multiple functions", () => {
      const functions = definitions.filter((d) => d.group === PromqlStepGroup.Math);
      expect(functions.length).toBeGreaterThanOrEqual(10);
    });

    it("should have exactly 6 binary operations", () => {
      const binaryOps = definitions.filter((d) => d.group === PromqlStepGroup.ScalarMath);
      expect(binaryOps.length).toBe(6);
    });

    it("should have multiple trigonometric functions", () => {
      const trigOps = definitions.filter((d) => d.group === PromqlStepGroup.Trigonometry);
      expect(trigOps.length).toBeGreaterThanOrEqual(12);
    });

    it("should have multiple time functions", () => {
      const timeOps = definitions.filter((d) => d.group === PromqlStepGroup.TimeAndDate);
      expect(timeOps.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe("Rate & range", () => {
    it("should include Rate operation with correct config", () => {
      const rate = definitions.find((d) => d.id === PromqlStepId.Rate);
      expect(rate).toBeDefined();
      expect(rate!.name).toBe("Rate");
      expect(rate!.group).toBe(PromqlStepGroup.RateAndRange);
      expect(rate!.params).toHaveLength(1);
      expect(rate!.params[0].type).toBe("string");
      expect(rate!.defaultParams).toEqual(["$__rate_interval"]);
    });

    it("should include Irate operation", () => {
      const irate = definitions.find((d) => d.id === PromqlStepId.Irate);
      expect(irate).toBeDefined();
      expect(irate!.group).toBe(PromqlStepGroup.RateAndRange);
      expect(irate!.defaultParams).toEqual(["$__interval"]);
    });

    it("should include Increase operation", () => {
      const increase = definitions.find((d) => d.id === PromqlStepId.Increase);
      expect(increase).toBeDefined();
      expect(increase!.group).toBe(PromqlStepGroup.RateAndRange);
    });

    it("should include Delta operation", () => {
      const delta = definitions.find((d) => d.id === PromqlStepId.Delta);
      expect(delta).toBeDefined();
      expect(delta!.defaultParams).toEqual(["$__interval"]);
    });

    it("should include Idelta operation", () => {
      const idelta = definitions.find((d) => d.id === PromqlStepId.Idelta);
      expect(idelta).toBeDefined();
    });

    it("should include AvgOverTime with correct name", () => {
      const avgOverTime = definitions.find((d) => d.id === PromqlStepId.AvgOverTime);
      expect(avgOverTime).toBeDefined();
      expect(avgOverTime!.name).toBe("Avg Over Time");
    });

    it("should include MinOverTime operation", () => {
      expect(definitions.find((d) => d.id === PromqlStepId.MinOverTime)).toBeDefined();
    });

    it("should include MaxOverTime operation", () => {
      expect(definitions.find((d) => d.id === PromqlStepId.MaxOverTime)).toBeDefined();
    });

    it("should include SumOverTime operation", () => {
      expect(definitions.find((d) => d.id === PromqlStepId.SumOverTime)).toBeDefined();
    });

    it("should include CountOverTime operation", () => {
      expect(definitions.find((d) => d.id === PromqlStepId.CountOverTime)).toBeDefined();
    });

    it("should include StddevOverTime operation", () => {
      expect(definitions.find((d) => d.id === PromqlStepId.StddevOverTime)).toBeDefined();
    });

    it("should include LastOverTime operation", () => {
      expect(definitions.find((d) => d.id === PromqlStepId.LastOverTime)).toBeDefined();
    });

    it("should include QuantileOverTime with two params", () => {
      const quantileOverTime = definitions.find((d) => d.id === PromqlStepId.QuantileOverTime);
      expect(quantileOverTime).toBeDefined();
      expect(quantileOverTime!.params).toHaveLength(2);
      expect(quantileOverTime!.params[0].type).toBe("number");
      expect(quantileOverTime!.params[1].type).toBe("string");
      expect(quantileOverTime!.defaultParams).toEqual([0.95, "$__interval"]);
    });

    it("should have string type Range param for all range functions except QuantileOverTime", () => {
      const rangeFunctions = definitions.filter(
        (d) => d.group === PromqlStepGroup.RateAndRange && d.id !== PromqlStepId.QuantileOverTime,
      );
      rangeFunctions.forEach((op) => {
        expect(op.params[0].type).toBe("string");
      });
    });
  });

  describe("Aggregation", () => {
    it("should include Sum operation with select param", () => {
      const sum = definitions.find((d) => d.id === PromqlStepId.Sum);
      expect(sum).toBeDefined();
      expect(sum!.name).toBe("Sum");
      expect(sum!.group).toBe(PromqlStepGroup.Aggregation);
      expect(sum!.params[0].type).toBe("select");
      expect(sum!.defaultParams).toEqual([[]]);
    });

    it("should include Avg operation", () => {
      const avg = definitions.find((d) => d.id === PromqlStepId.Avg);
      expect(avg).toBeDefined();
      expect(avg!.name).toBe("Avg");
      expect(avg!.defaultParams).toEqual([[]]);
    });

    it("should include Max operation", () => {
      const max = definitions.find((d) => d.id === PromqlStepId.Max);
      expect(max).toBeDefined();
      expect(max!.name).toBe("Max");
    });

    it("should include Min operation", () => {
      const min = definitions.find((d) => d.id === PromqlStepId.Min);
      expect(min).toBeDefined();
      expect(min!.name).toBe("Min");
    });

    it("should include Count operation", () => {
      const count = definitions.find((d) => d.id === PromqlStepId.Count);
      expect(count).toBeDefined();
      expect(count!.name).toBe("Count");
    });

    it("should include Stddev operation", () => {
      const stddev = definitions.find((d) => d.id === PromqlStepId.Stddev);
      expect(stddev).toBeDefined();
    });

    it("should include TopK with number and select params", () => {
      const topK = definitions.find((d) => d.id === PromqlStepId.TopK);
      expect(topK).toBeDefined();
      expect(topK!.name).toBe("Top K");
      expect(topK!.params).toHaveLength(2);
      expect(topK!.params[0].type).toBe("number");
      expect(topK!.params[1].type).toBe("select");
      expect(topK!.defaultParams).toEqual([10, []]);
    });

    it("should include BottomK with correct config", () => {
      const bottomK = definitions.find((d) => d.id === PromqlStepId.BottomK);
      expect(bottomK).toBeDefined();
      expect(bottomK!.name).toBe("Bottom K");
      expect(bottomK!.defaultParams).toEqual([10, []]);
    });

    it("should include Quantile with quantile and labels params", () => {
      const quantile = definitions.find((d) => d.id === PromqlStepId.Quantile);
      expect(quantile).toBeDefined();
      expect(quantile!.params).toHaveLength(2);
      expect(quantile!.params[0].type).toBe("number");
      expect(quantile!.params[1].type).toBe("select");
      expect(quantile!.defaultParams[0]).toBe(0.95);
      expect(quantile!.defaultParams[1]).toEqual([]);
    });

    it("should have select type by-labels param for simple aggregations", () => {
      const aggregationsWithLabels = [
        PromqlStepId.Sum,
        PromqlStepId.Avg,
        PromqlStepId.Max,
        PromqlStepId.Min,
        PromqlStepId.Count,
        PromqlStepId.Stddev,
      ];
      aggregationsWithLabels.forEach((id) => {
        const op = definitions.find((d) => d.id === id);
        expect(op).toBeDefined();
        const selectParam = op!.params.find((p) => p.type === "select");
        expect(selectParam).toBeDefined();
      });
    });
  });

  describe("Math", () => {
    it("should include HistogramQuantile with quantile param", () => {
      const hq = definitions.find((d) => d.id === PromqlStepId.HistogramQuantile);
      expect(hq).toBeDefined();
      expect(hq!.name).toBe("Histogram Quantile");
      expect(hq!.group).toBe(PromqlStepGroup.Math);
      expect(hq!.params).toHaveLength(1);
      expect(hq!.defaultParams).toEqual([0.95]);
    });

    it("should include Abs with no params", () => {
      const abs = definitions.find((d) => d.id === PromqlStepId.Abs);
      expect(abs).toBeDefined();
      expect(abs!.name).toBe("Abs");
      expect(abs!.params).toHaveLength(0);
      expect(abs!.defaultParams).toHaveLength(0);
    });

    it("should include Ceil with no params", () => {
      const ceil = definitions.find((d) => d.id === PromqlStepId.Ceil);
      expect(ceil).toBeDefined();
      expect(ceil!.params).toHaveLength(0);
    });

    it("should include Floor with no params", () => {
      const floor = definitions.find((d) => d.id === PromqlStepId.Floor);
      expect(floor).toBeDefined();
      expect(floor!.params).toHaveLength(0);
    });

    it("should include Round with optional number param defaulting to 1", () => {
      const round = definitions.find((d) => d.id === PromqlStepId.Round);
      expect(round).toBeDefined();
      expect(round!.params).toHaveLength(1);
      expect(round!.params[0].type).toBe("number");
      expect(round!.params[0].optional).toBe(true);
      expect(round!.defaultParams).toEqual([1]);
    });

    it("should include Sqrt with no params", () => {
      const sqrt = definitions.find((d) => d.id === PromqlStepId.Sqrt);
      expect(sqrt).toBeDefined();
      expect(sqrt!.params).toHaveLength(0);
    });

    it("should include Exp, Ln, Log2, Log10 operations", () => {
      expect(definitions.find((d) => d.id === PromqlStepId.Exp)).toBeDefined();
      expect(definitions.find((d) => d.id === PromqlStepId.Ln)).toBeDefined();
      expect(definitions.find((d) => d.id === PromqlStepId.Log2)).toBeDefined();
      expect(definitions.find((d) => d.id === PromqlStepId.Log10)).toBeDefined();
    });

    it("should include Sort and SortDesc operations", () => {
      expect(definitions.find((d) => d.id === PromqlStepId.Sort)).toBeDefined();
      expect(definitions.find((d) => d.id === PromqlStepId.SortDesc)).toBeDefined();
    });

    it("should include Clamp with min and max params", () => {
      const clamp = definitions.find((d) => d.id === PromqlStepId.Clamp);
      expect(clamp).toBeDefined();
      expect(clamp!.params).toHaveLength(2);
      expect(clamp!.params[0].name).toBe("Min");
      expect(clamp!.params[1].name).toBe("Max");
      expect(clamp!.defaultParams).toEqual([0, 100]);
    });

    it("should include ClampMax with single max param defaulting to 100", () => {
      const clampMax = definitions.find((d) => d.id === PromqlStepId.ClampMax);
      expect(clampMax).toBeDefined();
      expect(clampMax!.params).toHaveLength(1);
      expect(clampMax!.defaultParams).toEqual([100]);
    });

    it("should include ClampMin with single min param defaulting to 0", () => {
      const clampMin = definitions.find((d) => d.id === PromqlStepId.ClampMin);
      expect(clampMin).toBeDefined();
      expect(clampMin!.params).toHaveLength(1);
      expect(clampMin!.defaultParams).toEqual([0]);
    });

    it("should include Deg and Rad conversion functions", () => {
      expect(definitions.find((d) => d.id === PromqlStepId.Deg)).toBeDefined();
      expect(definitions.find((d) => d.id === PromqlStepId.Rad)).toBeDefined();
    });

    it("should include Pi function with no params", () => {
      const pi = definitions.find((d) => d.id === PromqlStepId.Pi);
      expect(pi).toBeDefined();
      expect(pi!.params).toHaveLength(0);
    });
  });

  describe("Scalar math", () => {
    it("should include Addition with number param defaulting to 0", () => {
      const add = definitions.find((d) => d.id === PromqlStepId.Addition);
      expect(add).toBeDefined();
      expect(add!.name).toBe("Addition");
      expect(add!.group).toBe(PromqlStepGroup.ScalarMath);
      expect(add!.params[0].type).toBe("number");
      expect(add!.defaultParams).toEqual([0]);
    });

    it("should include Subtraction with default 0", () => {
      const sub = definitions.find((d) => d.id === PromqlStepId.Subtraction);
      expect(sub).toBeDefined();
      expect(sub!.defaultParams).toEqual([0]);
    });

    it("should include MultiplyBy with default 1", () => {
      const mul = definitions.find((d) => d.id === PromqlStepId.MultiplyBy);
      expect(mul).toBeDefined();
      expect(mul!.name).toBe("Multiply By");
      expect(mul!.defaultParams).toEqual([1]);
    });

    it("should include DivideBy with default 1", () => {
      const div = definitions.find((d) => d.id === PromqlStepId.DivideBy);
      expect(div).toBeDefined();
      expect(div!.name).toBe("Divide By");
      expect(div!.defaultParams).toEqual([1]);
    });

    it("should include Modulo with default 1", () => {
      const mod = definitions.find((d) => d.id === PromqlStepId.Modulo);
      expect(mod).toBeDefined();
      expect(mod!.defaultParams).toEqual([1]);
    });

    it("should include Exponent with default 2", () => {
      const exp = definitions.find((d) => d.id === PromqlStepId.Exponent);
      expect(exp).toBeDefined();
      expect(exp!.name).toBe("Exponent");
      expect(exp!.defaultParams).toEqual([2]);
    });

    it("should have exactly one number type param for all binary operations", () => {
      const binaryOps = definitions.filter((d) => d.group === PromqlStepGroup.ScalarMath);
      binaryOps.forEach((op) => {
        expect(op.params).toHaveLength(1);
        expect(op.params[0].type).toBe("number");
      });
    });
  });

  describe("Trigonometric Functions", () => {
    it("should include Sin with no params", () => {
      const sin = definitions.find((d) => d.id === PromqlStepId.Sin);
      expect(sin).toBeDefined();
      expect(sin!.name).toBe("Sin");
      expect(sin!.group).toBe(PromqlStepGroup.Trigonometry);
      expect(sin!.params).toHaveLength(0);
    });

    it("should include Cos with no params", () => {
      const cos = definitions.find((d) => d.id === PromqlStepId.Cos);
      expect(cos).toBeDefined();
      expect(cos!.params).toHaveLength(0);
    });

    it("should include Tan with no params", () => {
      const tan = definitions.find((d) => d.id === PromqlStepId.Tan);
      expect(tan).toBeDefined();
      expect(tan!.params).toHaveLength(0);
    });

    it("should include all inverse trig functions", () => {
      expect(definitions.find((d) => d.id === PromqlStepId.Asin)).toBeDefined();
      expect(definitions.find((d) => d.id === PromqlStepId.Acos)).toBeDefined();
      expect(definitions.find((d) => d.id === PromqlStepId.Atan)).toBeDefined();
    });

    it("should include all hyperbolic trig functions", () => {
      expect(definitions.find((d) => d.id === PromqlStepId.Sinh)).toBeDefined();
      expect(definitions.find((d) => d.id === PromqlStepId.Cosh)).toBeDefined();
      expect(definitions.find((d) => d.id === PromqlStepId.Tanh)).toBeDefined();
    });

    it("should include all inverse hyperbolic trig functions", () => {
      expect(definitions.find((d) => d.id === PromqlStepId.Asinh)).toBeDefined();
      expect(definitions.find((d) => d.id === PromqlStepId.Acosh)).toBeDefined();
      expect(definitions.find((d) => d.id === PromqlStepId.Atanh)).toBeDefined();
    });

    it("should have all trig functions with no params and no default params", () => {
      const trigFunctions = definitions.filter((d) => d.group === PromqlStepGroup.Trigonometry);
      trigFunctions.forEach((op) => {
        expect(op.params).toHaveLength(0);
        expect(op.defaultParams).toHaveLength(0);
      });
    });
  });

  describe("Time & date", () => {
    it("should include Hour operation", () => {
      const hour = definitions.find((d) => d.id === PromqlStepId.Hour);
      expect(hour).toBeDefined();
      expect(hour!.name).toBe("Hour");
      expect(hour!.group).toBe(PromqlStepGroup.TimeAndDate);
    });

    it("should include Minute operation", () => {
      const minute = definitions.find((d) => d.id === PromqlStepId.Minute);
      expect(minute).toBeDefined();
      expect(minute!.name).toBe("Minute");
    });

    it("should include Month operation", () => {
      const month = definitions.find((d) => d.id === PromqlStepId.Month);
      expect(month).toBeDefined();
      expect(month!.name).toBe("Month");
    });

    it("should include Year operation", () => {
      const year = definitions.find((d) => d.id === PromqlStepId.Year);
      expect(year).toBeDefined();
      expect(year!.name).toBe("Year");
    });

    it("should include DayOfMonth operation", () => {
      const dom = definitions.find((d) => d.id === PromqlStepId.DayOfMonth);
      expect(dom).toBeDefined();
      expect(dom!.name).toBe("Day of Month");
    });

    it("should include DayOfWeek operation", () => {
      const dow = definitions.find((d) => d.id === PromqlStepId.DayOfWeek);
      expect(dow).toBeDefined();
      expect(dow!.name).toBe("Day of Week");
    });

    it("should include DaysInMonth operation", () => {
      const dim = definitions.find((d) => d.id === PromqlStepId.DaysInMonth);
      expect(dim).toBeDefined();
      expect(dim!.name).toBe("Days in Month");
    });

    it("should have all time functions with no params and no default params", () => {
      const timeFunctions = definitions.filter((d) => d.group === PromqlStepGroup.TimeAndDate);
      timeFunctions.forEach((op) => {
        expect(op.params).toHaveLength(0);
        expect(op.defaultParams).toHaveLength(0);
      });
    });
  });

  describe("Documentation", () => {
    it("should have documentation for Rate", () => {
      const rate = definitions.find((d) => d.id === PromqlStepId.Rate);
      expect(rate!.documentation).toBeTruthy();
    });

    it("should have documentation for Irate", () => {
      const irate = definitions.find((d) => d.id === PromqlStepId.Irate);
      expect(irate!.documentation).toBeTruthy();
    });

    it("should have documentation for Increase", () => {
      const increase = definitions.find((d) => d.id === PromqlStepId.Increase);
      expect(increase!.documentation).toBeTruthy();
    });

    it("should have documentation for Sum", () => {
      const sum = definitions.find((d) => d.id === PromqlStepId.Sum);
      expect(sum!.documentation).toBeTruthy();
    });

    it("should have documentation for HistogramQuantile", () => {
      const hq = definitions.find((d) => d.id === PromqlStepId.HistogramQuantile);
      expect(hq!.documentation).toBeTruthy();
    });
  });

  describe("Param Placeholders", () => {
    it("should have placeholder for Rate range param", () => {
      const rate = definitions.find((d) => d.id === PromqlStepId.Rate);
      expect(rate!.params[0].placeholder).toBeTruthy();
    });

    it("should have placeholder for TopK K param", () => {
      const topK = definitions.find((d) => d.id === PromqlStepId.TopK);
      expect(topK!.params[0].placeholder).toBeTruthy();
    });

    it("should have placeholder for both Clamp params", () => {
      const clamp = definitions.find((d) => d.id === PromqlStepId.Clamp);
      expect(clamp!.params[0].placeholder).toBeTruthy();
      expect(clamp!.params[1].placeholder).toBeTruthy();
    });

    it("should have placeholder for QuantileOverTime quantile param", () => {
      const qot = definitions.find((d) => d.id === PromqlStepId.QuantileOverTime);
      expect(qot!.params[0].placeholder).toBeTruthy();
    });
  });
});
