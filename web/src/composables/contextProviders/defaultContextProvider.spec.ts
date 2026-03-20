import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createDefaultContextProvider } from "./defaultContextProvider";

describe("createDefaultContextProvider", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds full route and organization context", () => {
    const router = {
      currentRoute: {
        value: {
          meta: { title: "Logs" },
          name: "logs",
          path: "/logs",
          fullPath: "/logs?stream=default",
          params: { id: "1" },
          query: { stream: "default" },
        },
      },
    };

    const store = {
      state: {
        selectedOrganization: {
          identifier: "org-1",
        },
      },
    };

    const provider = createDefaultContextProvider(router, store);
    const context = provider.getContext();

    expect(context).toEqual({
      currentPage: "Logs",
      routeName: "logs",
      routePath: "/logs",
      routeFullPath: "/logs?stream=default",
      routeParams: { id: "1" },
      routeQuery: { stream: "default" },
      organization_identifier: "org-1",
      request_timestamp: 1_700_000_000_000_000,
    });
  });

  it("falls back when route/store data is missing", () => {
    const provider = createDefaultContextProvider({}, {});
    const context = provider.getContext();

    expect(context.currentPage).toBe("unknown");
    expect(context.routeName).toBe("unknown");
    expect(context.routePath).toBe("/");
    expect(context.routeFullPath).toBe("/");
    expect(context.routeParams).toEqual({});
    expect(context.routeQuery).toEqual({});
    expect(context.organization_identifier).toBe("");
    expect(context.request_timestamp).toBe(1_700_000_000_000_000);
  });
});
