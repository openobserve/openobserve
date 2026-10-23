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

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/search", () => ({ default: { search: vi.fn() } }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/utils/query/sqlDiagnostics", () => ({
  rangesFromServerError: vi.fn().mockResolvedValue([]),
}));

import searchService from "@/services/search";
import { validateSqlQuery, type AlertFormData, type ValidationContext } from "./alertValidation";

const formData = {
  stream_name: "logs",
  stream_type: "logs",
  query_condition: { sql: "SELECT * FROM logs", vrl_function: "" },
} as unknown as AlertFormData;

const makeContext = (): ValidationContext => ({
  store: { state: { selectedOrganization: { identifier: "default" } } },
  t: ((key: string) => key) as ValidationContext["t"],
  validateSqlQueryPromise: { value: undefined as Promise<unknown> | undefined },
  sqlQueryErrorMsg: { value: "" },
  vrlFunctionError: { value: "" },
  buildQueryPayload: () => ({ query: { start_time: 0, sql: "" }, aggs: {} }),
  getParser: () => true,
});

describe("validateSqlQuery rejection handling", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const runValidation = async (search: () => Promise<unknown>) => {
    vi.useFakeTimers();
    vi.mocked(searchService.search).mockImplementation(search as any);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const context = makeContext();
    const done = validateSqlQuery(formData, context);
    await vi.advanceTimersByTimeAsync(300);
    await done;
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off("unhandledRejection", unhandled);
    return { context, unhandled };
  };

  it("does not leave a rejected sql_error unhandled before save awaits it", async () => {
    const { context, unhandled } = await runValidation(() =>
      Promise.reject({ response: { data: { message: "bad sql" } } }),
    );

    expect(unhandled).not.toHaveBeenCalled();
    await expect(context.validateSqlQueryPromise.value).rejects.toBe("sql_error");
  });

  it("does not leave a rejected function_error unhandled before save awaits it", async () => {
    const { context, unhandled } = await runValidation(() =>
      Promise.resolve({ data: { function_error: "vrl failed" } }),
    );

    expect(unhandled).not.toHaveBeenCalled();
    await expect(context.validateSqlQueryPromise.value).rejects.toBe("function_error");
  });
});
