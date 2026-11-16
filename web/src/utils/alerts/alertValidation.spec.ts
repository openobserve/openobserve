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
  sqlQueryErrorMsg: { value: "" },
  vrlFunctionError: { value: "" },
  buildQueryPayload: () => ({ query: { start_time: 0, sql: "" }, aggs: {} }),
  getParser: () => true,
});

describe("validateSqlQuery verdicts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const runValidation = async (search: () => Promise<unknown>) => {
    vi.useFakeTimers();
    vi.mocked(searchService.search).mockImplementation(search as typeof searchService.search);
    const context = makeContext();
    const done = validateSqlQuery(formData, context);
    await vi.advanceTimersByTimeAsync(300);
    return { context, verdict: await done };
  };

  it("reports a 400 with a message as a SQL error and shows it", async () => {
    const { context, verdict } = await runValidation(() =>
      Promise.reject({ response: { status: 400, data: { message: "bad sql" } } }),
    );

    expect(verdict).toBe("sql_error");
    expect(context.sqlQueryErrorMsg.value).toBe("bad sql");
  });

  it("reports a VRL failure as a function error", async () => {
    const { context, verdict } = await runValidation(() =>
      Promise.resolve({ data: { function_error: "vrl failed" } }),
    );

    expect(verdict).toBe("function_error");
    expect(context.vrlFunctionError.value).toBe("vrl failed");
  });

  it.each([
    ["a 403", { response: { status: 403, data: { message: "Unauthorized Access" } } }],
    ["a 500 without a message", { response: { status: 500, data: {} } }],
    ["a network error", new Error("Network Error")],
  ])("treats %s as a failed check, not a SQL error", async (_, failure) => {
    const { context, verdict } = await runValidation(() => Promise.reject(failure));

    expect(verdict).toBe("request_failed");
    expect(context.sqlQueryErrorMsg.value).toBe("");
  });

  it("lets only the newest check write the inline error", async () => {
    vi.useFakeTimers();
    let failOlder: (reason: unknown) => void = () => {};
    vi.mocked(searchService.search)
      .mockImplementationOnce(() => new Promise((_, reject) => (failOlder = reject)) as never)
      .mockImplementationOnce(() => Promise.resolve({ data: {} }) as never);
    const context = makeContext();
    const older = validateSqlQuery(formData, context);
    await vi.advanceTimersByTimeAsync(100);
    const newer = validateSqlQuery(formData, context);
    await vi.advanceTimersByTimeAsync(300);
    expect(await newer).toBe("valid");

    failOlder({ response: { status: 400, data: { message: "old sql" } } });

    expect(await older).toBe("sql_error");
    expect(context.sqlQueryErrorMsg.value).toBe("");
  });

  it("reports a passing query as valid", async () => {
    const { verdict } = await runValidation(() => Promise.resolve({ data: {} }));

    expect(verdict).toBe("valid");
  });
});
