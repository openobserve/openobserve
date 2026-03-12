// Copyright 2025 OpenObserve Inc.
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
import { createStore } from "vuex";
import incidentsModule from "@/stores/incidents";

describe("incidents store", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      modules: {
        incidents: incidentsModule,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------
  describe("initial state", () => {
    it("should initialise incidents as an empty object", () => {
      expect(store.state.incidents.incidents).toEqual({});
    });

    it("should initialise cachedData as an empty array", () => {
      expect(store.state.incidents.cachedData).toEqual([]);
    });

    it("should initialise pageBeforeSearch as 1", () => {
      expect(store.state.incidents.pageBeforeSearch).toBe(1);
    });

    it("should initialise isInitialized as false", () => {
      expect(store.state.incidents.isInitialized).toBe(false);
    });

    it("should initialise shouldRefresh as false", () => {
      expect(store.state.incidents.shouldRefresh).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  describe("mutations", () => {
    describe("setIncidents", () => {
      it("should set incidents to the given object payload", () => {
        const payload = { total: 5, list: [{ id: "inc-1" }] };
        store.commit("incidents/setIncidents", payload);
        expect(store.state.incidents.incidents).toEqual(payload);
      });

      it("should overwrite the previous incidents value", () => {
        store.commit("incidents/setIncidents", { old: true });
        const fresh = { new: true };
        store.commit("incidents/setIncidents", fresh);
        expect(store.state.incidents.incidents).toEqual(fresh);
      });

      it("should accept null as a payload", () => {
        store.commit("incidents/setIncidents", null);
        expect(store.state.incidents.incidents).toBeNull();
      });
    });

    describe("setCachedData", () => {
      it("should set cachedData to the given array", () => {
        const data = [{ id: 1 }, { id: 2 }];
        store.commit("incidents/setCachedData", data);
        expect(store.state.incidents.cachedData).toEqual(data);
      });

      it("should replace the existing cachedData", () => {
        store.commit("incidents/setCachedData", [{ id: 1 }]);
        store.commit("incidents/setCachedData", [{ id: 99 }]);
        expect(store.state.incidents.cachedData).toEqual([{ id: 99 }]);
      });

      it("should accept an empty array to clear the cache", () => {
        store.commit("incidents/setCachedData", [{ id: 1 }]);
        store.commit("incidents/setCachedData", []);
        expect(store.state.incidents.cachedData).toEqual([]);
      });
    });

    describe("setPageBeforeSearch", () => {
      it("should update pageBeforeSearch to the given page number", () => {
        store.commit("incidents/setPageBeforeSearch", 5);
        expect(store.state.incidents.pageBeforeSearch).toBe(5);
      });

      it("should allow resetting pageBeforeSearch to 1", () => {
        store.commit("incidents/setPageBeforeSearch", 7);
        store.commit("incidents/setPageBeforeSearch", 1);
        expect(store.state.incidents.pageBeforeSearch).toBe(1);
      });

      it("should accept page 0", () => {
        store.commit("incidents/setPageBeforeSearch", 0);
        expect(store.state.incidents.pageBeforeSearch).toBe(0);
      });
    });

    describe("setIsInitialized", () => {
      it("should set isInitialized to true", () => {
        store.commit("incidents/setIsInitialized", true);
        expect(store.state.incidents.isInitialized).toBe(true);
      });

      it("should set isInitialized back to false", () => {
        store.commit("incidents/setIsInitialized", true);
        store.commit("incidents/setIsInitialized", false);
        expect(store.state.incidents.isInitialized).toBe(false);
      });
    });

    describe("setShouldRefresh", () => {
      it("should set shouldRefresh to true", () => {
        store.commit("incidents/setShouldRefresh", true);
        expect(store.state.incidents.shouldRefresh).toBe(true);
      });

      it("should set shouldRefresh back to false", () => {
        store.commit("incidents/setShouldRefresh", true);
        store.commit("incidents/setShouldRefresh", false);
        expect(store.state.incidents.shouldRefresh).toBe(false);
      });
    });

    describe("resetIncidents", () => {
      it("should reset incidents to an empty object", () => {
        store.commit("incidents/setIncidents", { data: "present" });
        store.commit("incidents/resetIncidents");
        expect(store.state.incidents.incidents).toEqual({});
      });

      it("should reset cachedData to an empty array", () => {
        store.commit("incidents/setCachedData", [{ id: 1 }]);
        store.commit("incidents/resetIncidents");
        expect(store.state.incidents.cachedData).toEqual([]);
      });

      it("should reset pageBeforeSearch to 1", () => {
        store.commit("incidents/setPageBeforeSearch", 10);
        store.commit("incidents/resetIncidents");
        expect(store.state.incidents.pageBeforeSearch).toBe(1);
      });

      it("should reset isInitialized to false", () => {
        store.commit("incidents/setIsInitialized", true);
        store.commit("incidents/resetIncidents");
        expect(store.state.incidents.isInitialized).toBe(false);
      });

      it("should reset shouldRefresh to false", () => {
        store.commit("incidents/setShouldRefresh", true);
        store.commit("incidents/resetIncidents");
        expect(store.state.incidents.shouldRefresh).toBe(false);
      });

      it("should reset all fields simultaneously", () => {
        store.commit("incidents/setIncidents", { x: 1 });
        store.commit("incidents/setCachedData", [{ id: 5 }]);
        store.commit("incidents/setPageBeforeSearch", 3);
        store.commit("incidents/setIsInitialized", true);
        store.commit("incidents/setShouldRefresh", true);

        store.commit("incidents/resetIncidents");

        expect(store.state.incidents.incidents).toEqual({});
        expect(store.state.incidents.cachedData).toEqual([]);
        expect(store.state.incidents.pageBeforeSearch).toBe(1);
        expect(store.state.incidents.isInitialized).toBe(false);
        expect(store.state.incidents.shouldRefresh).toBe(false);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------
  describe("getters", () => {
    describe("getIncidents", () => {
      it("should return the initial empty incidents object", () => {
        expect(store.getters["incidents/getIncidents"]).toEqual({});
      });

      it("should return the updated incidents after a setIncidents mutation", () => {
        const data = { total: 2, list: [{ id: "a" }, { id: "b" }] };
        store.commit("incidents/setIncidents", data);
        expect(store.getters["incidents/getIncidents"]).toEqual(data);
      });

      it("should return an empty object after resetIncidents", () => {
        store.commit("incidents/setIncidents", { x: 1 });
        store.commit("incidents/resetIncidents");
        expect(store.getters["incidents/getIncidents"]).toEqual({});
      });
    });

    describe("getCachedData", () => {
      it("should return an empty array in the initial state", () => {
        expect(store.getters["incidents/getCachedData"]).toEqual([]);
      });

      it("should return the stored cache after setCachedData", () => {
        const cache = [{ id: 42, title: "Incident 42" }];
        store.commit("incidents/setCachedData", cache);
        expect(store.getters["incidents/getCachedData"]).toEqual(cache);
      });

      it("should return an empty array after resetIncidents", () => {
        store.commit("incidents/setCachedData", [{ id: 1 }]);
        store.commit("incidents/resetIncidents");
        expect(store.getters["incidents/getCachedData"]).toEqual([]);
      });
    });

    describe("getPageBeforeSearch", () => {
      it("should return 1 in the initial state", () => {
        expect(store.getters["incidents/getPageBeforeSearch"]).toBe(1);
      });

      it("should return the updated page number after setPageBeforeSearch", () => {
        store.commit("incidents/setPageBeforeSearch", 4);
        expect(store.getters["incidents/getPageBeforeSearch"]).toBe(4);
      });

      it("should return 1 after resetIncidents", () => {
        store.commit("incidents/setPageBeforeSearch", 8);
        store.commit("incidents/resetIncidents");
        expect(store.getters["incidents/getPageBeforeSearch"]).toBe(1);
      });
    });

    describe("getIsInitialized", () => {
      it("should return false in the initial state", () => {
        expect(store.getters["incidents/getIsInitialized"]).toBe(false);
      });

      it("should return true after setIsInitialized(true)", () => {
        store.commit("incidents/setIsInitialized", true);
        expect(store.getters["incidents/getIsInitialized"]).toBe(true);
      });

      it("should return false after resetIncidents", () => {
        store.commit("incidents/setIsInitialized", true);
        store.commit("incidents/resetIncidents");
        expect(store.getters["incidents/getIsInitialized"]).toBe(false);
      });
    });

    describe("getShouldRefresh", () => {
      it("should return false in the initial state", () => {
        expect(store.getters["incidents/getShouldRefresh"]).toBe(false);
      });

      it("should return true after setShouldRefresh(true)", () => {
        store.commit("incidents/setShouldRefresh", true);
        expect(store.getters["incidents/getShouldRefresh"]).toBe(true);
      });

      it("should return false after resetIncidents", () => {
        store.commit("incidents/setShouldRefresh", true);
        store.commit("incidents/resetIncidents");
        expect(store.getters["incidents/getShouldRefresh"]).toBe(false);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  describe("actions", () => {
    describe("setIncidents", () => {
      it("should commit setIncidents with the given payload", async () => {
        const payload = { total: 3, list: [] };
        await store.dispatch("incidents/setIncidents", payload);
        expect(store.state.incidents.incidents).toEqual(payload);
      });
    });

    describe("setCachedData", () => {
      it("should commit setCachedData with the given array", async () => {
        const data = [{ id: 1 }, { id: 2 }];
        await store.dispatch("incidents/setCachedData", data);
        expect(store.state.incidents.cachedData).toEqual(data);
      });
    });

    describe("setPageBeforeSearch", () => {
      it("should commit setPageBeforeSearch with the given page number", async () => {
        await store.dispatch("incidents/setPageBeforeSearch", 6);
        expect(store.state.incidents.pageBeforeSearch).toBe(6);
      });
    });

    describe("setIsInitialized", () => {
      it("should commit setIsInitialized with true", async () => {
        await store.dispatch("incidents/setIsInitialized", true);
        expect(store.state.incidents.isInitialized).toBe(true);
      });

      it("should commit setIsInitialized with false", async () => {
        await store.dispatch("incidents/setIsInitialized", true);
        await store.dispatch("incidents/setIsInitialized", false);
        expect(store.state.incidents.isInitialized).toBe(false);
      });
    });

    describe("setShouldRefresh", () => {
      it("should commit setShouldRefresh with true", async () => {
        await store.dispatch("incidents/setShouldRefresh", true);
        expect(store.state.incidents.shouldRefresh).toBe(true);
      });

      it("should commit setShouldRefresh with false", async () => {
        await store.dispatch("incidents/setShouldRefresh", true);
        await store.dispatch("incidents/setShouldRefresh", false);
        expect(store.state.incidents.shouldRefresh).toBe(false);
      });
    });

    describe("resetIncidents", () => {
      it("should reset all fields via action", async () => {
        store.commit("incidents/setIncidents", { a: 1 });
        store.commit("incidents/setCachedData", [{ id: 7 }]);
        store.commit("incidents/setPageBeforeSearch", 9);
        store.commit("incidents/setIsInitialized", true);
        store.commit("incidents/setShouldRefresh", true);

        await store.dispatch("incidents/resetIncidents");

        expect(store.state.incidents.incidents).toEqual({});
        expect(store.state.incidents.cachedData).toEqual([]);
        expect(store.state.incidents.pageBeforeSearch).toBe(1);
        expect(store.state.incidents.isInitialized).toBe(false);
        expect(store.state.incidents.shouldRefresh).toBe(false);
      });

      it("should be idempotent when called on an already-reset store", async () => {
        await store.dispatch("incidents/resetIncidents");
        expect(store.state.incidents.incidents).toEqual({});
        expect(store.state.incidents.pageBeforeSearch).toBe(1);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Module configuration
  // ---------------------------------------------------------------------------
  describe("module configuration", () => {
    it("should be namespaced", () => {
      expect(incidentsModule.namespaced).toBe(true);
    });
  });
});
