// Copyright 2026 OpenObserve Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect, beforeEach } from "vitest";
import { contextRegistry } from "./registry";
import type { ContextProvider } from "./types";

describe("ContextRegistry", () => {
  beforeEach(() => {
    // Clean up before each test
    contextRegistry.cleanup();
  });

  describe("register", () => {
    it("should register a context provider", () => {
      const mockProvider: ContextProvider = {
        getContext: () => ({ currentPage: "test" }),
      };

      contextRegistry.register("test", mockProvider);
      contextRegistry.setActive("test");

      expect(contextRegistry.getActiveContext()).resolves.toEqual({ currentPage: "test" });
    });
  });

  describe("unregister", () => {
    it("should unregister a context provider", async () => {
      const mockProvider: ContextProvider = {
        getContext: () => ({ currentPage: "test" }),
      };

      contextRegistry.register("test", mockProvider);
      contextRegistry.setActive("test");
      contextRegistry.unregister("test");

      const result = await contextRegistry.getActiveContext();
      expect(result).toBeNull();
    });

    it("should clear active provider when unregistering it", async () => {
      const mockProvider: ContextProvider = {
        getContext: () => ({ currentPage: "test" }),
      };

      contextRegistry.register("test", mockProvider);
      contextRegistry.setActive("test");
      contextRegistry.unregister("test");

      const result = await contextRegistry.getActiveContext();
      expect(result).toBeNull();
    });
  });

  describe("setActive", () => {
    it("should set active provider", async () => {
      const mockProvider: ContextProvider = {
        getContext: () => ({ currentPage: "logs" }),
      };

      contextRegistry.register("logs", mockProvider);
      contextRegistry.setActive("logs");

      const context = await contextRegistry.getActiveContext();
      expect(context).toEqual({ currentPage: "logs" });
    });

    it("should clear active provider when set to empty string", async () => {
      const mockProvider: ContextProvider = {
        getContext: () => ({ currentPage: "logs" }),
      };

      contextRegistry.register("logs", mockProvider);
      contextRegistry.setActive("logs");
      contextRegistry.setActive("");

      const context = await contextRegistry.getActiveContext();
      expect(context).toBeNull();
    });

    it("should not set active provider if key does not exist", async () => {
      contextRegistry.setActive("nonexistent");

      const context = await contextRegistry.getActiveContext();
      expect(context).toBeNull();
    });
  });

  describe("getActiveContext", () => {
    it("should return context from active provider", async () => {
      const mockProvider: ContextProvider = {
        getContext: () => ({ currentPage: "alerts", alertName: "Test" }),
      };

      contextRegistry.register("alerts", mockProvider);
      contextRegistry.setActive("alerts");

      const context = await contextRegistry.getActiveContext();
      expect(context).toEqual({ currentPage: "alerts", alertName: "Test" });
    });

    it("should fallback to default provider when no active provider", async () => {
      const defaultProvider: ContextProvider = {
        getContext: () => ({ currentPage: "default" }),
      };

      contextRegistry.register("default", defaultProvider);

      const context = await contextRegistry.getActiveContext();
      expect(context).toEqual({ currentPage: "default" });
    });

    it("should return null when no providers registered", async () => {
      const context = await contextRegistry.getActiveContext();
      expect(context).toBeNull();
    });

    it("should handle errors from active provider gracefully", async () => {
      const errorProvider: ContextProvider = {
        getContext: () => {
          throw new Error("Provider error");
        },
      };

      contextRegistry.register("error", errorProvider);
      contextRegistry.setActive("error");

      const context = await contextRegistry.getActiveContext();
      expect(context).toBeNull();
    });

    it("should fallback to default provider when active provider throws error", async () => {
      const errorProvider: ContextProvider = {
        getContext: () => {
          throw new Error("Active provider error");
        },
      };

      const defaultProvider: ContextProvider = {
        getContext: () => ({ currentPage: "default" }),
      };

      contextRegistry.register("error", errorProvider);
      contextRegistry.register("default", defaultProvider);
      contextRegistry.setActive("error");

      const context = await contextRegistry.getActiveContext();
      expect(context).toEqual({ currentPage: "default" });
    });
  });

  describe("cleanup", () => {
    it("should clear all providers and reset active provider", async () => {
      const mockProvider1: ContextProvider = {
        getContext: () => ({ currentPage: "test1" }),
      };
      const mockProvider2: ContextProvider = {
        getContext: () => ({ currentPage: "test2" }),
      };

      contextRegistry.register("test1", mockProvider1);
      contextRegistry.register("test2", mockProvider2);
      contextRegistry.setActive("test1");

      contextRegistry.cleanup();

      const context = await contextRegistry.getActiveContext();
      expect(context).toBeNull();
    });
  });
  describe("push and pop", () => {
    const provider = (page: string): ContextProvider => ({
      getContext: () => ({ currentPage: page }),
    });

    it("reads the top of the stack before the active provider", async () => {
      contextRegistry.register("pipeline", provider("pipeline"));
      contextRegistry.setActive("pipeline");
      contextRegistry.push("query_node", provider("query_node"));

      expect(await contextRegistry.getActiveContext()).toEqual({ currentPage: "query_node" });
    });

    it("pops only its own entry, so the parent survives a nested editor's unmount", async () => {
      contextRegistry.register("pipeline", provider("pipeline"));
      contextRegistry.setActive("pipeline");
      contextRegistry.push("query_node", provider("query_node"));
      contextRegistry.push("function_node", provider("function_node"));

      contextRegistry.pop("query_node");
      expect(await contextRegistry.getActiveContext()).toEqual({ currentPage: "function_node" });
      contextRegistry.pop("function_node");
      expect(await contextRegistry.getActiveContext()).toEqual({ currentPage: "pipeline" });
    });

    it("re-pushing a key moves it to the top without a second entry", async () => {
      contextRegistry.push("a", provider("a"));
      contextRegistry.push("b", provider("b"));
      contextRegistry.push("a", provider("a2"));
      expect(await contextRegistry.getActiveContext()).toEqual({ currentPage: "a2" });
      contextRegistry.pop("a");
      expect(await contextRegistry.getActiveContext()).toEqual({ currentPage: "b" });
    });

    it("falls back to the default provider once the stack is empty", async () => {
      contextRegistry.register("default", provider("default"));
      contextRegistry.push("node", provider("node"));
      contextRegistry.pop("node");
      expect(await contextRegistry.getActiveContext()).toEqual({ currentPage: "default" });
    });

    it("bumps the version on every change", () => {
      const start = contextRegistry.version.value;
      contextRegistry.register("x", provider("x"));
      contextRegistry.setActive("x");
      contextRegistry.push("y", provider("y"));
      contextRegistry.pop("y");
      contextRegistry.unregister("x");
      expect(contextRegistry.version.value).toBe(start + 5);
    });
  });
});

describe("ContextRegistry getContextBelow", () => {
  beforeEach(() => contextRegistry.cleanup());

  it("reads what a pushed provider sits on: the entries pushed before it, else the page's", async () => {
    contextRegistry.register("logs", { getContext: () => ({ currentPage: "logs" }) });
    contextRegistry.setActive("logs");
    expect(await contextRegistry.getContextBelow("dock")).toEqual({ currentPage: "logs" });
    contextRegistry.push("pipeline", { getContext: () => ({ currentPage: "pipeline" }) });
    contextRegistry.push("dock", { getContext: () => ({ currentPage: "dock" }) });
    expect(await contextRegistry.getContextBelow("dock")).toEqual({ currentPage: "pipeline" });
    expect(await contextRegistry.getActiveContext()).toEqual({ currentPage: "dock" });
  });
});
