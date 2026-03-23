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

import { describe, expect, it, vi, beforeEach } from "vitest";

const watchMock = vi.fn();

vi.mock("vue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue")>();
  return { ...actual, watch: (...args: any[]) => watchMock(...args) };
});

import { useVariablesWatcher, variableLog } from "./useVariableDebugger";

describe("useVariableDebugger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a deep watcher on variablesData.values", () => {
    const variablesData = {
      values: [{ name: "region", value: "us-east" }],
    };

    useVariablesWatcher(variablesData);

    expect(watchMock).toHaveBeenCalledTimes(1);
    const [getter, callback, options] = watchMock.mock.calls[0];

    expect(getter()).toBe(variablesData.values);
    expect(options).toEqual({ deep: true });

    // callback currently has an early return and should be a no-op
    expect(callback([{ name: "region", value: "eu-west" }])).toBeUndefined();
  });

  it("keeps variableLog as a no-op", () => {
    expect(() => variableLog("service", "changed")).not.toThrow();
  });
});
