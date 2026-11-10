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
import http from "@/services/http";
import securityCases, { MAX_LOOKUP_IDS } from "@/services/securityCases";

vi.mock("@/services/http", () => ({ default: vi.fn() }));

describe("securityCases service", () => {
  let client: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    client = {
      get: vi.fn().mockResolvedValue({ data: {} }),
      post: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn().mockResolvedValue({ data: {} }),
      patch: vi.fn().mockResolvedValue({ data: {} }),
    };
    vi.mocked(http).mockReturnValue(client as any);
  });

  it("closes a case with its verdict and reason in one update", async () => {
    await securityCases.close("acme", "c1", "false_positive", "admin script");
    expect(client.patch).toHaveBeenCalledWith("/api/v2/acme/alerts/incidents/c1/update", {
      status: "resolved",
      verdict: "false_positive",
      reason: "admin script",
    });
  });

  it("assigns and unassigns through the same field", async () => {
    await securityCases.assign("acme", "c1", "");
    expect(client.patch).toHaveBeenCalledWith("/api/v2/acme/alerts/incidents/c1/update", {
      assigned_to: "",
    });
  });

  it("caps a lookup at the ids the server accepts", async () => {
    const ids = Array.from({ length: MAX_LOOKUP_IDS + 3 }, (_, i) => `a${i}`);
    await securityCases.lookup("acme", ids);
    const params = client.get.mock.calls[0][1].params;
    expect(params.alert_ids.split(",")).toHaveLength(MAX_LOOKUP_IDS);
  });

  it("sends a case id only when attaching to an existing case", async () => {
    const firings = [{ alert_id: "a1", fired_at: 5 }];
    await securityCases.promote("acme", firings);
    expect(client.post).toHaveBeenLastCalledWith("/api/acme/security/cases", { firings });
    await securityCases.promote("acme", firings, "c1");
    expect(client.post).toHaveBeenLastCalledWith("/api/acme/security/cases", {
      firings,
      case_id: "c1",
    });
  });

  it("reads and writes the case settings", async () => {
    await securityCases.getSettings("acme");
    expect(client.get).toHaveBeenCalledWith("/api/acme/security/cases/settings");
    const settings = { auto_close_days: 30, group_window_minutes: 60 };
    await securityCases.updateSettings("acme", settings);
    expect(client.put).toHaveBeenCalledWith("/api/acme/security/cases/settings", settings);
  });
});
