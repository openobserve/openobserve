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

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/services/http", () => ({ default: () => ({ get }) }));

import { queryClient } from "@/composables/query/queryClient";
import { alertFolderOf, editAlertRoute } from "./alertEditorLink";

const rows = (list: unknown[]) => ({ data: { list } });

describe("alertEditorLink", () => {
  beforeEach(() => {
    queryClient.clear();
    get.mockReset();
  });

  it("the folder lookup matches by id, not name", async () => {
    get.mockResolvedValue(
      rows([
        { alert_id: "a2", name: "ops_quiet", folder_id: "default" },
        { alert_id: "a1", name: "ops_quiet", folder_id: "ops" },
      ]),
    );
    expect(await alertFolderOf("demo-org", "a1", "ops_quiet")).toBe("ops");
    expect(get).toHaveBeenCalledTimes(1);
    const url = String(get.mock.calls[0][0]);
    expect(url).toContain("/api/v2/demo-org/alerts?");
    expect(url).toContain("alert_name_substring=ops_quiet");
    expect(url).not.toContain("folder=");
    expect(get.mock.calls[0][1]).toEqual({ silentForbidden: true });
  });

  it("an unreadable or missing folder is unknown, and the lookup never throws", async () => {
    get.mockRejectedValue(Object.assign(new Error("HTTP 403"), { response: { status: 403 } }));
    expect(await alertFolderOf("demo-org", "a1", "ops_quiet")).toBeUndefined();

    queryClient.clear();
    get.mockResolvedValue(rows([{ alert_id: "a2", name: "ops_quiet", folder_id: "pay" }]));
    expect(await alertFolderOf("demo-org", "a1", "ops_quiet")).toBeUndefined();

    expect(await alertFolderOf("demo-org", "a1", undefined)).toBeUndefined();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("the editor link names the folder only when it is known", () => {
    expect(editAlertRoute("demo-org", "a1", "ops")).toEqual({
      name: "editAlert",
      params: { alert_id: "a1" },
      query: { org_identifier: "demo-org", prefill: "calibration", folder: "ops" },
    });
    expect(editAlertRoute("demo-org", "a1", undefined)).toEqual({
      name: "editAlert",
      params: { alert_id: "a1" },
      query: { org_identifier: "demo-org", prefill: "calibration" },
    });
  });

  it("an AutoObserve caller names its own handoff, and calibration's default is unchanged", () => {
    expect(editAlertRoute("demo-org", "a1", "ops", "autoobserve").query).toEqual({
      org_identifier: "demo-org",
      prefill: "autoobserve",
      folder: "ops",
    });
    expect(editAlertRoute("demo-org", "a1", "ops").query.prefill).toBe("calibration");
  });
});
