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
import { createStore } from "vuex";
import logsModule from "@/stores/logs";

describe("logs store", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      modules: {
        logs: logsModule,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------
  describe("initial state", () => {
    it("should initialise logs as an empty object", () => {
      expect(store.state.logs.logs).toEqual({});
    });

    it("should initialise isInitialized as false", () => {
      expect(store.state.logs.isInitialized).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  describe("mutations", () => {
    describe("setLogs", () => {
      it("should set logs to a plain object payload", () => {
        const payload = { key: "value", count: 42 };
        store.commit("logs/setLogs", payload);
        expect(store.state.logs.logs).toEqual(payload);
      });

      it("should overwrite previously stored logs", () => {
        store.commit("logs/setLogs", { first: true });
        store.commit("logs/setLogs", { second: true });
        expect(store.state.logs.logs).toEqual({ second: true });
      });

      it("should accept an array payload", () => {
        const payload = [{ id: 1 }, { id: 2 }];
        store.commit("logs/setLogs", payload);
        expect(store.state.logs.logs).toEqual(payload);
      });

      it("should accept null as payload", () => {
        store.commit("logs/setLogs", null);
        expect(store.state.logs.logs).toBeNull();
      });
    });

    describe("setIsInitialized", () => {
      it("should set isInitialized to true", () => {
        store.commit("logs/setIsInitialized", true);
        expect(store.state.logs.isInitialized).toBe(true);
      });

      it("should set isInitialized to false", () => {
        store.commit("logs/setIsInitialized", true);
        store.commit("logs/setIsInitialized", false);
        expect(store.state.logs.isInitialized).toBe(false);
      });
    });

    describe("resetLogs", () => {
      it("should reset logs to an empty object", () => {
        store.commit("logs/setLogs", { some: "data" });
        store.commit("logs/resetLogs");
        expect(store.state.logs.logs).toEqual({});
      });

      it("should reset isInitialized to false", () => {
        store.commit("logs/setIsInitialized", true);
        store.commit("logs/resetLogs");
        expect(store.state.logs.isInitialized).toBe(false);
      });

      it("should reset both logs and isInitialized simultaneously", () => {
        store.commit("logs/setLogs", { data: "present" });
        store.commit("logs/setIsInitialized", true);
        store.commit("logs/resetLogs");
        expect(store.state.logs.logs).toEqual({});
        expect(store.state.logs.isInitialized).toBe(false);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------
  describe("getters", () => {
    describe("getLogs", () => {
      it("should return the initial empty logs object", () => {
        expect(store.getters["logs/getLogs"]).toEqual({});
      });

      it("should return the logs after a setLogs mutation", () => {
        const data = { stream: "default", hits: 100 };
        store.commit("logs/setLogs", data);
        expect(store.getters["logs/getLogs"]).toEqual(data);
      });

      it("should return an empty object after resetLogs is committed", () => {
        store.commit("logs/setLogs", { something: true });
        store.commit("logs/resetLogs");
        expect(store.getters["logs/getLogs"]).toEqual({});
      });
    });

    describe("getIsInitialized", () => {
      it("should return false for the initial state", () => {
        expect(store.getters["logs/getIsInitialized"]).toBe(false);
      });

      it("should return true after setIsInitialized(true)", () => {
        store.commit("logs/setIsInitialized", true);
        expect(store.getters["logs/getIsInitialized"]).toBe(true);
      });

      it("should return false after resetLogs is called", () => {
        store.commit("logs/setIsInitialized", true);
        store.commit("logs/resetLogs");
        expect(store.getters["logs/getIsInitialized"]).toBe(false);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  describe("actions", () => {
    describe("setLogs", () => {
      it("should commit setLogs with the given payload", async () => {
        const payload = { result: "data" };
        await store.dispatch("logs/setLogs", payload);
        expect(store.state.logs.logs).toEqual(payload);
      });

      it("should update the logs getter after dispatch", async () => {
        const payload = { entries: [1, 2, 3] };
        await store.dispatch("logs/setLogs", payload);
        expect(store.getters["logs/getLogs"]).toEqual(payload);
      });
    });

    describe("setIsInitialized", () => {
      it("should commit setIsInitialized with true", async () => {
        await store.dispatch("logs/setIsInitialized", true);
        expect(store.state.logs.isInitialized).toBe(true);
      });

      it("should commit setIsInitialized with false", async () => {
        await store.dispatch("logs/setIsInitialized", true);
        await store.dispatch("logs/setIsInitialized", false);
        expect(store.state.logs.isInitialized).toBe(false);
      });
    });

    describe("resetLogs", () => {
      it("should reset the logs state via action", async () => {
        store.commit("logs/setLogs", { data: "present" });
        store.commit("logs/setIsInitialized", true);
        await store.dispatch("logs/resetLogs");
        expect(store.state.logs.logs).toEqual({});
        expect(store.state.logs.isInitialized).toBe(false);
      });

      it("should be idempotent when called on an already-reset store", async () => {
        await store.dispatch("logs/resetLogs");
        expect(store.state.logs.logs).toEqual({});
        expect(store.state.logs.isInitialized).toBe(false);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Module configuration
  // ---------------------------------------------------------------------------
  describe("module configuration", () => {
    it("should be namespaced", () => {
      expect(logsModule.namespaced).toBe(true);
    });
  });
});
