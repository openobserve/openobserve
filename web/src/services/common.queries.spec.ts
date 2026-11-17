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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestQueryClient } from "@/test/unit/helpers/queryClient";

vi.mock("./common", () => ({ default: { list_Folders: vi.fn() } }));

import common from "./common";
import { optionalFoldersQuery } from "./common.queries";

const listFolders = vi.mocked(common.list_Folders);

const fetchOptional = (type: string) =>
  createTestQueryClient().fetchQuery(optionalFoldersQuery("org", type));

describe("optionalFoldersQuery", () => {
  beforeEach(() => {
    listFolders.mockReset();
  });

  it("lists the folders with default first and asks the interceptor not to toast a 403", async () => {
    const ops = { folderId: "ops", name: "Ops" };
    const listed = { folderId: "default", name: "default" };
    // Synthetics gets no injected default: its server lists one only to callers who may list it.
    const cases: [string, object[], string[]][] = [
      ["alerts", [ops], ["default", "ops"]],
      ["synthetics", [ops], ["ops"]],
      ["synthetics", [ops, listed], ["default", "ops"]],
    ];
    for (const [type, list, want] of cases) {
      listFolders.mockResolvedValue({ data: { list } } as any);
      const result = await fetchOptional(type);
      expect(result.forbidden).toBe(false);
      expect(result.folders.map((f) => f.folderId)).toEqual(want);
      expect(listFolders).toHaveBeenCalledWith("org", type, { skipAccessToast: true });
    }
  });

  it("answers a 403 as no access to the module instead of an error", async () => {
    listFolders.mockRejectedValue({ response: { status: 403 } });
    await expect(fetchOptional("synthetics")).resolves.toEqual({ folders: [], forbidden: true });
  });

  it("keeps any other failure an error", async () => {
    const error = { response: { status: 500 } };
    listFolders.mockRejectedValue(error);
    await expect(fetchOptional("alerts")).rejects.toBe(error);
  });
});
