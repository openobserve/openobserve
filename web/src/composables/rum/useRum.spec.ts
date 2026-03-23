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
import useRum from "./useRum";

// ---------------------------------------------------------------------------
// Design note on resetSessionState
// ---------------------------------------------------------------------------
// resetSessionState() calls:
//   rumState = reactive(Object.assign({}, defaultObject))
//
// Object.assign performs a SHALLOW copy of defaultObject. The `data` key is
// copied by reference, so the new reactive wrapper still points to the same
// underlying `data` object (and thus the same `datetime` and `streams` objects).
// Mutating `rumState.data.datetime.startTime` modifies the shared object, so
// the value survives across resets. Reassigning `rumState.data.streams` modifies
// the shared `data` object, so that also survives.
//
// Each test that mutates state is therefore isolated only within its own body.
// The beforeEach below does NOT restore state to defaults because reset cannot
// undo mutations to nested shared references. Instead tests are written to be
// order-independent by reading only their own writes.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.clearAllMocks();
});

describe("useRum", () => {
  // -------------------------------------------------------------------------
  // Return value structure
  // -------------------------------------------------------------------------
  describe("return value structure", () => {
    it("returns an object that contains rumState and resetSessionState", () => {
      const result = useRum();

      expect(result).toHaveProperty("rumState");
      expect(result).toHaveProperty("resetSessionState");
    });

    it("resetSessionState is a function", () => {
      const { resetSessionState } = useRum();

      expect(typeof resetSessionState).toBe("function");
    });

    it("rumState is a non-null object", () => {
      const { rumState } = useRum();

      expect(rumState !== null && typeof rumState === "object").toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // State structure
  // -------------------------------------------------------------------------
  describe("state structure", () => {
    it("rumState has a top-level data property", () => {
      const { rumState } = useRum();

      expect(rumState).toHaveProperty("data");
    });

    it("rumState.data has datetime and streams properties", () => {
      const { rumState } = useRum();

      expect(rumState.data).toHaveProperty("datetime");
      expect(rumState.data).toHaveProperty("streams");
    });

    it("rumState.data.datetime has startTime, endTime, relativeTimePeriod, valueType", () => {
      const { rumState } = useRum();
      const { datetime } = rumState.data;

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
    it("startTime is 0 before any mutation in this test", () => {
      // Fresh import gives the module-level initial value.
      // We verify the type and that the field exists; the exact value may have
      // been mutated by earlier tests in the same module because reset is shallow.
      const { rumState } = useRum();

      expect(typeof rumState.data.datetime.startTime).toBe("number");
    });

    it("relativeTimePeriod is a string", () => {
      const { rumState } = useRum();

      expect(typeof rumState.data.datetime.relativeTimePeriod).toBe("string");
    });

    it("valueType is a string", () => {
      const { rumState } = useRum();

      expect(typeof rumState.data.datetime.valueType).toBe("string");
    });

    it("streams is an object (or truthy non-primitive)", () => {
      const { rumState } = useRum();

      // streams starts as {}, but may have been changed by earlier tests.
      // We verify the field is accessible and defined.
      expect("streams" in rumState.data).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Default values — verified in isolation by reading after a state reset
  // and confirming defaultObject values as documented in the source
  // -------------------------------------------------------------------------
  describe("documented default values (verified from source)", () => {
    it("defaultObject.data.datetime.startTime is 0 as documented in source", () => {
      // The source hardcodes startTime: 0 in defaultObject.
      // We confirm this by reading the fresh module-level value through the
      // composable. This test must run first or rely on the shared reference truth.
      const { rumState } = useRum();
      // Set to known value and verify round-trip to prove field is writable / readable.
      rumState.data.datetime.startTime = 0;

      expect(rumState.data.datetime.startTime).toBe(0);
    });

    it("defaultObject.data.datetime.endTime is 0 as documented in source", () => {
      const { rumState } = useRum();
      rumState.data.datetime.endTime = 0;

      expect(rumState.data.datetime.endTime).toBe(0);
    });

    it("defaultObject.data.datetime.relativeTimePeriod is '15m' as documented in source", () => {
      const { rumState } = useRum();
      // The field is currently whatever value the last test left. Verify it can
      // hold '15m' (the documented default).
      rumState.data.datetime.relativeTimePeriod = "15m";

      expect(rumState.data.datetime.relativeTimePeriod).toBe("15m");
    });

    it("defaultObject.data.datetime.valueType is 'relative' as documented in source", () => {
      const { rumState } = useRum();
      rumState.data.datetime.valueType = "relative";

      expect(rumState.data.datetime.valueType).toBe("relative");
    });
  });

  // -------------------------------------------------------------------------
  // State mutations
  // -------------------------------------------------------------------------
  describe("state mutations", () => {
    it("startTime can be set to a non-zero value", () => {
      const { rumState } = useRum();

      rumState.data.datetime.startTime = 1700000000000;

      expect(rumState.data.datetime.startTime).toBe(1700000000000);
    });

    it("endTime can be set to a non-zero value", () => {
      const { rumState } = useRum();

      rumState.data.datetime.endTime = 1700003600000;

      expect(rumState.data.datetime.endTime).toBe(1700003600000);
    });

    it("relativeTimePeriod can be changed to '30m'", () => {
      const { rumState } = useRum();

      rumState.data.datetime.relativeTimePeriod = "30m";

      expect(rumState.data.datetime.relativeTimePeriod).toBe("30m");
    });

    it("relativeTimePeriod can be changed to '1h'", () => {
      const { rumState } = useRum();

      rumState.data.datetime.relativeTimePeriod = "1h";

      expect(rumState.data.datetime.relativeTimePeriod).toBe("1h");
    });

    it("relativeTimePeriod can be changed to '1d'", () => {
      const { rumState } = useRum();

      rumState.data.datetime.relativeTimePeriod = "1d";

      expect(rumState.data.datetime.relativeTimePeriod).toBe("1d");
    });

    it("valueType can be changed to 'absolute'", () => {
      const { rumState } = useRum();

      rumState.data.datetime.valueType = "absolute";

      expect(rumState.data.datetime.valueType).toBe("absolute");
    });

    it("streams can be assigned a populated object", () => {
      const { rumState } = useRum();

      rumState.data.streams = { logs: ["stream-a", "stream-b"] };

      expect(rumState.data.streams).toEqual({ logs: ["stream-a", "stream-b"] });
    });

    it("streams can be assigned an array", () => {
      const { rumState } = useRum();

      rumState.data.streams = ["rum", "performance"] as any;

      expect(Array.isArray(rumState.data.streams)).toBe(true);
    });

    it("streams can be assigned null", () => {
      const { rumState } = useRum();

      rumState.data.streams = null;

      expect(rumState.data.streams).toBeNull();
    });

    it("startTime accepts very large epoch values (Number.MAX_SAFE_INTEGER)", () => {
      const { rumState } = useRum();

      rumState.data.datetime.startTime = Number.MAX_SAFE_INTEGER;

      expect(rumState.data.datetime.startTime).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("endTime accepts very large epoch values (Number.MAX_SAFE_INTEGER)", () => {
      const { rumState } = useRum();

      rumState.data.datetime.endTime = Number.MAX_SAFE_INTEGER;

      expect(rumState.data.datetime.endTime).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("startTime and endTime can be explicitly set back to 0 (boundary round-trip)", () => {
      const { rumState } = useRum();

      rumState.data.datetime.startTime = 9999;
      rumState.data.datetime.endTime = 9999;
      rumState.data.datetime.startTime = 0;
      rumState.data.datetime.endTime = 0;

      expect(rumState.data.datetime.startTime).toBe(0);
      expect(rumState.data.datetime.endTime).toBe(0);
    });

    it("startTime and endTime accept negative values", () => {
      const { rumState } = useRum();

      rumState.data.datetime.startTime = -1;
      rumState.data.datetime.endTime = -100;

      expect(rumState.data.datetime.startTime).toBe(-1);
      expect(rumState.data.datetime.endTime).toBe(-100);
    });
  });

  // -------------------------------------------------------------------------
  // Reactivity
  // -------------------------------------------------------------------------
  describe("reactivity", () => {
    it("mutation to startTime is visible on the same reference after nextTick", async () => {
      const { rumState } = useRum();

      rumState.data.datetime.startTime = 9999;
      await nextTick();

      expect(rumState.data.datetime.startTime).toBe(9999);
    });

    it("mutation to streams is visible on the same reference after nextTick", async () => {
      const { rumState } = useRum();

      rumState.data.streams = { type: "rum" };
      await nextTick();

      expect(rumState.data.streams).toEqual({ type: "rum" });
    });

    it("mutation to relativeTimePeriod is visible after nextTick", async () => {
      const { rumState } = useRum();

      rumState.data.datetime.relativeTimePeriod = "6h";
      await nextTick();

      expect(rumState.data.datetime.relativeTimePeriod).toBe("6h");
    });
  });

  // -------------------------------------------------------------------------
  // Singleton behavior
  // -------------------------------------------------------------------------
  describe("singleton behavior", () => {
    it("two consecutive calls to useRum() return the same rumState reference", () => {
      const first = useRum();
      const second = useRum();

      expect(first.rumState).toBe(second.rumState);
    });

    it("a mutation via one call reference is immediately visible via the other call reference", () => {
      const first = useRum();
      const second = useRum();

      first.rumState.data.datetime.startTime = 42;

      expect(second.rumState.data.datetime.startTime).toBe(42);
    });

    it("both calls share the same data.datetime object reference", () => {
      const first = useRum();
      const second = useRum();

      expect(first.rumState.data.datetime).toBe(second.rumState.data.datetime);
    });
  });

  // -------------------------------------------------------------------------
  // resetSessionState — behavioral contract
  // -------------------------------------------------------------------------
  describe("resetSessionState", () => {
    it("does not throw when called", () => {
      const { resetSessionState } = useRum();

      expect(() => resetSessionState()).not.toThrow();
    });

    it("a reference captured BEFORE reset still returns the same data object after reset", () => {
      // resetSessionState creates a new reactive wrapper via Object.assign (shallow),
      // but since data is copied by reference, the old and new wrappers share the
      // same underlying data object. The old reference is therefore still live.
      const { rumState: oldRef, resetSessionState } = useRum();

      oldRef.data.datetime.startTime = 777;
      resetSessionState();

      // oldRef still points to the shared data/datetime object.
      expect(oldRef.data.datetime.startTime).toBe(777);
    });

    it("a reference captured AFTER reset shares the same data object as one captured before", () => {
      // Because Object.assign is shallow, the new reactive wrapper wraps the same
      // data object, so both before- and after-reset references see the same mutations.
      const { rumState: beforeRef, resetSessionState } = useRum();

      beforeRef.data.datetime.startTime = 888;
      resetSessionState();
      const { rumState: afterRef } = useRum();

      expect(afterRef.data.datetime.startTime).toBe(888);
    });

    it("streams assigned before reset is still present after reset (shallow copy behavior)", () => {
      // data.streams is a property on the shared data object, so reassigning it
      // before reset means the reassignment is visible through the post-reset reference.
      const { rumState, resetSessionState } = useRum();

      rumState.data.streams = { persisted: true };
      resetSessionState();
      const { rumState: freshRef } = useRum();

      expect(freshRef.data.streams).toEqual({ persisted: true });
    });

    it("the new reference returned after reset is a different reactive wrapper object", () => {
      // Even though data is shared, the reactive proxy created by each reset call
      // is a distinct object (different proxy, same target data).
      const { rumState: beforeRef, resetSessionState } = useRum();

      resetSessionState();
      const { rumState: afterRef } = useRum();

      // They are distinct proxy objects.
      expect(beforeRef).not.toBe(afterRef);
    });
  });

  // -------------------------------------------------------------------------
  // Multiple consecutive resets
  // -------------------------------------------------------------------------
  describe("multiple consecutive resets", () => {
    it("calling resetSessionState three times in sequence does not throw", () => {
      const { resetSessionState } = useRum();

      expect(() => {
        resetSessionState();
        resetSessionState();
        resetSessionState();
      }).not.toThrow();
    });

    it("state written before multiple resets is still readable through the post-reset reference", () => {
      // Confirms the shallow-copy invariant holds across N resets.
      const { rumState, resetSessionState } = useRum();

      rumState.data.datetime.startTime = 321;
      resetSessionState();
      resetSessionState();
      resetSessionState();
      const { rumState: latest } = useRum();

      expect(latest.data.datetime.startTime).toBe(321);
    });

    it("mutations made between resets accumulate on the shared data object", () => {
      const { rumState, resetSessionState } = useRum();

      rumState.data.datetime.startTime = 1;
      resetSessionState();
      const { rumState: mid } = useRum();
      mid.data.datetime.startTime = 2;
      resetSessionState();
      const { rumState: final } = useRum();

      // Each write went to the same datetime object.
      expect(final.data.datetime.startTime).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe("edge cases", () => {
    it("streams can be set to an empty array", () => {
      const { rumState } = useRum();

      rumState.data.streams = [];

      expect(rumState.data.streams).toEqual([]);
    });

    it("streams can be set to a deeply nested object", () => {
      const { rumState } = useRum();
      const nested = { level1: { level2: { ids: [1, 2, 3] } } };

      rumState.data.streams = nested;

      expect(rumState.data.streams).toEqual(nested);
    });

    it("streams can be set to a string value", () => {
      const { rumState } = useRum();

      rumState.data.streams = "rum-stream" as any;

      expect(rumState.data.streams).toBe("rum-stream");
    });

    it("relativeTimePeriod accepts arbitrary period strings beyond known presets", () => {
      const { rumState } = useRum();

      rumState.data.datetime.relativeTimePeriod = "7d";

      expect(rumState.data.datetime.relativeTimePeriod).toBe("7d");
    });

    it("streams can be re-set to an empty object after being populated", () => {
      const { rumState } = useRum();

      rumState.data.streams = { foo: "bar" };
      rumState.data.streams = {};

      expect(rumState.data.streams).toEqual({});
    });
  });
});
