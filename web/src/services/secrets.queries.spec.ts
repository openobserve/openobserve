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

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/secrets", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, default: { list: vi.fn(), picker: vi.fn(), usage: vi.fn() } };
});

import secrets from "@/services/secrets";
import { queryClient } from "@/composables/query/queryClient";
import { secretPickerQuery, secretsListQuery, secretUsageQuery } from "./secrets.queries";

const page = (names: string[], next?: string) =>
  ({ data: { items: names.map((name) => ({ name })), ...(next ? { next } : {}) } }) as any;

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe("store reads follow every page (T40)", () => {
  it("reads the whole list, page after page", async () => {
    vi.mocked(secrets.list)
      .mockResolvedValueOnce(page(["A"], "c1"))
      .mockResolvedValueOnce(page(["B"]));
    const rows = await queryClient.fetchQuery(secretsListQuery("o1", "secret"));
    expect(rows.map((r) => r.name)).toEqual(["A", "B"]);
    expect(vi.mocked(secrets.list).mock.calls[1][1]).toMatchObject({ cursor: "c1" });
  });

  it("reads every usage page", async () => {
    vi.mocked(secrets.usage)
      .mockResolvedValueOnce(page(["u1"], "c1"))
      .mockResolvedValueOnce(page(["u2"]));
    const rows = await queryClient.fetchQuery(secretUsageQuery("o1", "s1"));
    expect(rows).toHaveLength(2);
    expect(vi.mocked(secrets.usage).mock.calls[1][2]).toBe("c1");
  });

  it("sends the picker search to the server and follows its pages", async () => {
    vi.mocked(secrets.picker)
      .mockResolvedValueOnce(page(["API_A"], "c1"))
      .mockResolvedValueOnce(page(["API_B"]));
    const rows = await queryClient.fetchQuery(
      secretPickerQuery("o1", "synthetics_check", "", "API"),
    );
    expect(rows.map((r) => r.name)).toEqual(["API_A", "API_B"]);
    expect(vi.mocked(secrets.picker).mock.calls[0][3]).toEqual({ q: "API" });
    expect(vi.mocked(secrets.picker).mock.calls[1][3]).toEqual({ q: "API", cursor: "c1" });
  });
});
