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
