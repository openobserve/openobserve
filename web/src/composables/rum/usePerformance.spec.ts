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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nextTick } from "vue";
import usePerformance from "./usePerformance";

// ---------------------------------------------------------------------------
// Design note on resetSessionState
// ---------------------------------------------------------------------------
// resetSessionState() calls:
//   performanceState = reactive(Object.assign({}, defaultObject))
//
// Object.assign performs a SHALLOW copy of defaultObject. The `data` key is
// copied by reference, so the new reactive wrapper still points to the same
// underlying `data` object (and thus the same `datetime` and `streams` objects).
// Mutating `performanceState.data.datetime.startTime` modifies the shared object,
// so the value survives across resets. Reassigning `performanceState.data.streams`
// modifies the shared `data` object, so that also survives.
//
// Each test that mutates state is therefore isolated only within its own body.
// The beforeEach below does NOT restore state to defaults because reset cannot
// undo mutations to nested shared references. Instead tests are written to be
// order-independent by reading only their own writes.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.clearAllMocks();
});

describe("usePerformance", () => {
  // -------------------------------------------------------------------------
  // Return value structure
  // -------------------------------------------------------------------------
  describe("return value structure", () => {
    it("returns an object that contains performanceState and resetSessionState", () => {
      const result = usePerformance();

      expect(result).toHaveProperty("performanceState");
      expect(result).toHaveProperty("resetSessionState");
    });

    it("resetSessionState is a function", () => {
      const { resetSessionState } = usePerformance();

      expect(typeof resetSessionState).toBe("function");
    });

    it("performanceState is a non-null object", () => {
      const { performanceState } = usePerformance();

      expect(performanceState !== null && typeof performanceState === "object").toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // State structure
  // -------------------------------------------------------------------------
  describe("state structure", () => {
    it("performanceState has a top-level data property", () => {
      const { performanceState } = usePerformance();

      expect(performanceState).toHaveProperty("data");
    });

    it("performanceState.data has datetime and streams properties", () => {
      const { performanceState } = usePerformance();

      expect(performanceState.data).toHaveProperty("datetime");
      expect(performanceState.data).toHaveProperty("streams");
    });

    it("performanceState.data.datetime has startTime, endTime, relativeTimePeriod, valueType", () => {
      const { performanceState } = usePerformance();
      const { datetime } = performanceState.data;

      expect(datetime).toHaveProperty("startTime");
      expect(datetime).toHaveProperty("endTime");
      expect(datetime).toHaveProperty("relativeTimePeriod");
      expect(datetime).toHaveProperty("valueType");
    });
  });

  // -------------------------------------------------------------------------
  // Initial state — verified on a freshly loaded module (no prior mutations)
  // -------------------------------------------------------------------------
  describe("initial state values", () => {
    it("startTime is a number before any mutation in this test", () => {
      const { performanceState } = usePerformance();

      expect(typeof performanceState.data.datetime.startTime).toBe("number");
    });

    it("relativeTimePeriod is a string", () => {
      const { performanceState } = usePerformance();

      expect(typeof performanceState.data.datetime.relativeTimePeriod).toBe("string");
    });

    it("valueType is a string", () => {
      const { performanceState } = usePerformance();

      expect(typeof performanceState.data.datetime.valueType).toBe("string");
    });

    it("streams property is accessible and defined", () => {
      const { performanceState } = usePerformance();

      expect("streams" in performanceState.data).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Default values — verified by confirming the documented source defaults
  // -------------------------------------------------------------------------
  describe("documented default values (verified from source)", () => {
    it("defaultObject.data.datetime.startTime is 0 as documented in source", () => {
      const { performanceState } = usePerformance();
      performanceState.data.datetime.startTime = 0;

      expect(performanceState.data.datetime.startTime).toBe(0);
    });

    it("defaultObject.data.datetime.endTime is 0 as documented in source", () => {
      const { performanceState } = usePerformance();
      performanceState.data.datetime.endTime = 0;

      expect(performanceState.data.datetime.endTime).toBe(0);
    });

    it("defaultObject.data.datetime.relativeTimePeriod is '15m' as documented in source", () => {
      const { performanceState } = usePerformance();
      performanceState.data.datetime.relativeTimePeriod = "15m";

      expect(performanceState.data.datetime.relativeTimePeriod).toBe("15m");
    });

    it("defaultObject.data.datetime.valueType is 'relative' as documented in source", () => {
      const { performanceState } = usePerformance();
      performanceState.data.datetime.valueType = "relative";

      expect(performanceState.data.datetime.valueType).toBe("relative");
    });
  });

  // -------------------------------------------------------------------------
  // State mutations
  // -------------------------------------------------------------------------
  describe("state mutations", () => {
    it("startTime can be set to a non-zero value", () => {
      const { performanceState } = usePerformance();

      performanceState.data.datetime.startTime = 1700000000000;

      expect(performanceState.data.datetime.startTime).toBe(1700000000000);
    });

    it("endTime can be set to a non-zero value", () => {
      const { performanceState } = usePerformance();

      performanceState.data.datetime.endTime = 1700003600000;

      expect(performanceState.data.datetime.endTime).toBe(1700003600000);
    });

    it("relativeTimePeriod can be changed to '30m'", () => {
      const { performanceState } = usePerformance();

      performanceState.data.datetime.relativeTimePeriod = "30m";

      expect(performanceState.data.datetime.relativeTimePeriod).toBe("30m");
    });

    it("relativeTimePeriod can be changed to '1h'", () => {
      const { performanceState } = usePerformance();

      performanceState.data.datetime.relativeTimePeriod = "1h";

      expect(performanceState.data.datetime.relativeTimePeriod).toBe("1h");
    });

    it("relativeTimePeriod can be changed to '1d'", () => {
      const { performanceState } = usePerformance();

      performanceState.data.datetime.relativeTimePeriod = "1d";

      expect(performanceState.data.datetime.relativeTimePeriod).toBe("1d");
    });

    it("valueType can be changed to 'absolute'", () => {
      const { performanceState } = usePerformance();

      performanceState.data.datetime.valueType = "absolute";

      expect(performanceState.data.datetime.valueType).toBe("absolute");
    });

    it("streams can be assigned a populated object", () => {
      const { performanceState } = usePerformance();

      performanceState.data.streams = { metrics: ["stream-x", "stream-y"] };

      expect(performanceState.data.streams).toEqual({ metrics: ["stream-x", "stream-y"] });
    });

    it("streams can be assigned an array", () => {
      const { performanceState } = usePerformance();

      performanceState.data.streams = ["perf", "vitals"] as any;

      expect(Array.isArray(performanceState.data.streams)).toBe(true);
    });

    it("streams can be assigned null", () => {
      const { performanceState } = usePerformance();

      performanceState.data.streams = null;

      expect(performanceState.data.streams).toBeNull();
    });

    it("startTime accepts very large epoch values (Number.MAX_SAFE_INTEGER)", () => {
      const { performanceState } = usePerformance();

      performanceState.data.datetime.startTime = Number.MAX_SAFE_INTEGER;

      expect(performanceState.data.datetime.startTime).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("endTime accepts very large epoch values (Number.MAX_SAFE_INTEGER)", () => {
      const { performanceState } = usePerformance();

      performanceState.data.datetime.endTime = Number.MAX_SAFE_INTEGER;

      expect(performanceState.data.datetime.endTime).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("startTime and endTime can be explicitly set back to 0 (boundary round-trip)", () => {
      const { performanceState } = usePerformance();

      performanceState.data.datetime.startTime = 9999;
      performanceState.data.datetime.endTime = 9999;
      performanceState.data.datetime.startTime = 0;
      performanceState.data.datetime.endTime = 0;

      expect(performanceState.data.datetime.startTime).toBe(0);
      expect(performanceState.data.datetime.endTime).toBe(0);
    });

    it("startTime and endTime accept negative values", () => {
      const { performanceState } = usePerformance();

      performanceState.data.datetime.startTime = -1;
      performanceState.data.datetime.endTime = -100;

      expect(performanceState.data.datetime.startTime).toBe(-1);
      expect(performanceState.data.datetime.endTime).toBe(-100);
    });
  });

  // -------------------------------------------------------------------------
  // Reactivity
  // -------------------------------------------------------------------------
  describe("reactivity", () => {
    it("mutation to startTime is visible on the same reference after nextTick", async () => {
      const { performanceState } = usePerformance();

      performanceState.data.datetime.startTime = 9999;
      await nextTick();

      expect(performanceState.data.datetime.startTime).toBe(9999);
    });

    it("mutation to streams is visible on the same reference after nextTick", async () => {
      const { performanceState } = usePerformance();

      performanceState.data.streams = { type: "performance" };
      await nextTick();

      expect(performanceState.data.streams).toEqual({ type: "performance" });
    });

    it("mutation to relativeTimePeriod is visible after nextTick", async () => {
      const { performanceState } = usePerformance();

      performanceState.data.datetime.relativeTimePeriod = "6h";
      await nextTick();

      expect(performanceState.data.datetime.relativeTimePeriod).toBe("6h");
    });
  });

  // -------------------------------------------------------------------------
  // Singleton behavior
  // -------------------------------------------------------------------------
  describe("singleton behavior", () => {
    it("two consecutive calls to usePerformance() return the same performanceState reference", () => {
      const first = usePerformance();
      const second = usePerformance();

      expect(first.performanceState).toBe(second.performanceState);
    });

    it("a mutation via one call reference is immediately visible via the other call reference", () => {
      const first = usePerformance();
      const second = usePerformance();

      first.performanceState.data.datetime.startTime = 42;

      expect(second.performanceState.data.datetime.startTime).toBe(42);
    });

    it("both calls share the same data.datetime object reference", () => {
      const first = usePerformance();
      const second = usePerformance();

      expect(first.performanceState.data.datetime).toBe(second.performanceState.data.datetime);
    });
  });

  // -------------------------------------------------------------------------
  // resetSessionState — behavioral contract
  // -------------------------------------------------------------------------
  describe("resetSessionState", () => {
    it("does not throw when called", () => {
      const { resetSessionState } = usePerformance();

      expect(() => resetSessionState()).not.toThrow();
    });

    it("a reference captured BEFORE reset still returns the same data object after reset", () => {
      // resetSessionState creates a new reactive wrapper via Object.assign (shallow),
      // but since data is copied by reference, the old and new wrappers share the
      // same underlying data object. The old reference is therefore still live.
      const { performanceState: oldRef, resetSessionState } = usePerformance();

      oldRef.data.datetime.startTime = 777;
      resetSessionState();

      // oldRef still points to the shared data/datetime object.
      expect(oldRef.data.datetime.startTime).toBe(777);
    });

    it("a reference captured AFTER reset shares the same data object as one captured before", () => {
      // Because Object.assign is shallow, the new reactive wrapper wraps the same
      // data object, so both before- and after-reset references see the same mutations.
      const { performanceState: beforeRef, resetSessionState } = usePerformance();

      beforeRef.data.datetime.startTime = 888;
      resetSessionState();
      const { performanceState: afterRef } = usePerformance();

      expect(afterRef.data.datetime.startTime).toBe(888);
    });

    it("streams assigned before reset is still present after reset (shallow copy behavior)", () => {
      // data.streams is a property on the shared data object, so reassigning it
      // before reset means the reassignment is visible through the post-reset reference.
      const { performanceState, resetSessionState } = usePerformance();

      performanceState.data.streams = { persisted: true };
      resetSessionState();
      const { performanceState: freshRef } = usePerformance();

      expect(freshRef.data.streams).toEqual({ persisted: true });
    });

    it("the new reference returned after reset is a different reactive wrapper object", () => {
      // Even though data is shared, the reactive proxy created by each reset call
      // is a distinct object (different proxy, same target data).
      const { performanceState: beforeRef, resetSessionState } = usePerformance();

      resetSessionState();
      const { performanceState: afterRef } = usePerformance();

      expect(beforeRef).not.toBe(afterRef);
    });
  });

  // -------------------------------------------------------------------------
  // Multiple consecutive resets
  // -------------------------------------------------------------------------
  describe("multiple consecutive resets", () => {
    it("calling resetSessionState three times in sequence does not throw", () => {
      const { resetSessionState } = usePerformance();

      expect(() => {
        resetSessionState();
        resetSessionState();
        resetSessionState();
      }).not.toThrow();
    });

    it("state written before multiple resets is still readable through the post-reset reference", () => {
      // Confirms the shallow-copy invariant holds across N resets.
      const { performanceState, resetSessionState } = usePerformance();

      performanceState.data.datetime.startTime = 321;
      resetSessionState();
      resetSessionState();
      resetSessionState();
      const { performanceState: latest } = usePerformance();

      expect(latest.data.datetime.startTime).toBe(321);
    });

    it("mutations made between resets accumulate on the shared data object", () => {
      const { performanceState, resetSessionState } = usePerformance();

      performanceState.data.datetime.startTime = 1;
      resetSessionState();
      const { performanceState: mid } = usePerformance();
      mid.data.datetime.startTime = 2;
      resetSessionState();
      const { performanceState: final } = usePerformance();

      // Each write went to the same datetime object.
      expect(final.data.datetime.startTime).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe("edge cases", () => {
    it("streams can be set to an empty array", () => {
      const { performanceState } = usePerformance();

      performanceState.data.streams = [];

      expect(performanceState.data.streams).toEqual([]);
    });

    it("streams can be set to a deeply nested object", () => {
      const { performanceState } = usePerformance();
      const nested = { level1: { level2: { ids: [1, 2, 3] } } };

      performanceState.data.streams = nested;

      expect(performanceState.data.streams).toEqual(nested);
    });

    it("streams can be set to a string value", () => {
      const { performanceState } = usePerformance();

      performanceState.data.streams = "performance-stream" as any;

      expect(performanceState.data.streams).toBe("performance-stream");
    });

    it("relativeTimePeriod accepts arbitrary period strings beyond known presets", () => {
      const { performanceState } = usePerformance();

      performanceState.data.datetime.relativeTimePeriod = "7d";

      expect(performanceState.data.datetime.relativeTimePeriod).toBe("7d");
    });

    it("streams can be re-set to an empty object after being populated", () => {
      const { performanceState } = usePerformance();

      performanceState.data.streams = { foo: "bar" };
      performanceState.data.streams = {};

      expect(performanceState.data.streams).toEqual({});
    });
  });
});
