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
import securityCases, {
  MAX_BULK_IDS,
  MAX_LOOKUP_IDS,
  searchQueryOf,
} from "@/services/securityCases";

vi.mock("@/services/http", () => ({ default: vi.fn() }));

describe("securityCases service", () => {
  let client: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    client = {
      get: vi.fn().mockResolvedValue({ data: {} }),
      post: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn().mockResolvedValue({ data: {} }),
      patch: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
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

  it("searches cases with list filters comma-joined and empty filters left out", async () => {
    await securityCases.searchCases("acme", {
      status: ["open", "acknowledged"],
      priority: ["P1", "P2"],
      alert_id: ["a1", "a2"],
      entity: " 10.0.0.5 ",
      assignee: "none",
      q: "",
      limit: 50,
      offset: 100,
    });
    expect(client.get).toHaveBeenCalledWith("/api/acme/security/cases/search", {
      params: {
        status: "open,acknowledged",
        priority: "P1,P2",
        alert_id: "a1,a2",
        entity: "10.0.0.5",
        assignee: "none",
        limit: 50,
        offset: 100,
      },
    });
  });

  it("asks for every matching id only on select all", () => {
    expect(searchQueryOf({ status: [], select_all: false })).toEqual({});
    expect(searchQueryOf({ select_all: true, limit: 1 })).toEqual({ select_all: true, limit: 1 });
  });

  it("caps a bulk update at the ids the server accepts", async () => {
    const ids = Array.from({ length: MAX_BULK_IDS + 5 }, (_, i) => `c${i}`);
    await securityCases.bulkUpdate("acme", {
      ids,
      action: "close",
      verdict: "benign",
      reason: "x",
    });
    const [url, body] = client.post.mock.calls[0];
    expect(url).toBe("/api/acme/security/cases/bulk");
    expect(body).toMatchObject({ action: "close", verdict: "benign", reason: "x" });
    expect(body.ids).toHaveLength(MAX_BULK_IDS);
  });

  it("sends the high-priority opt-in and the suppression length with a bulk close", async () => {
    await securityCases.bulkUpdate("acme", {
      ids: ["c1"],
      action: "close",
      verdict: "benign",
      reason: "noise",
      include_high: true,
      suppress_minutes: 1440,
    });
    expect(client.post.mock.calls[0][1]).toMatchObject({
      include_high: true,
      suppress_minutes: 1440,
    });
  });

  it("merges sources into a target", async () => {
    const body = { target_id: "c1", source_ids: ["c2", "c3"], reason: "same host" };
    await securityCases.mergeCases("acme", body);
    expect(client.post).toHaveBeenCalledWith("/api/acme/security/cases/merge", body);
  });

  it("suppresses similar alerts from a case", async () => {
    const body = { case_id: "c1", duration_minutes: 1440, reason: "scanner", close_case: true };
    await securityCases.suppress("acme", body);
    expect(client.post).toHaveBeenCalledWith("/api/acme/security/suppressions", body);
  });

  it("lists suppressions and ends one by id", async () => {
    await securityCases.listSuppressions("acme");
    expect(client.get).toHaveBeenCalledWith("/api/acme/security/suppressions");
    await securityCases.deleteSuppression("acme", "s/1");
    expect(client.delete).toHaveBeenCalledWith("/api/acme/security/suppressions/s%2F1");
  });
});
