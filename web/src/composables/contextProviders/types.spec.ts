import { describe, expect, it, expectTypeOf } from "vitest";
import type { ContextProvider, PageContext } from "./types";

describe("contextProviders types", () => {
  it("accepts valid PageContext shape at runtime", () => {
    const context: PageContext = {
      currentPage: "logs",
      query: "level:error",
    };

    expect(context.currentPage).toBe("logs");
    expect(context.query).toBe("level:error");
  });

  it("enforces ContextProvider return type", () => {
    const provider: ContextProvider = {
      getContext: () => ({ currentPage: "dashboards" }),
    };

    const result = provider.getContext();
    expectTypeOf(result).toMatchTypeOf<PageContext | Promise<PageContext>>();
  });
});
