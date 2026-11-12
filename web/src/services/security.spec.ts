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
import security from "./security";
import http from "./http";

vi.mock("./http", () => ({ default: vi.fn() }));

const get = vi.fn();

describe("security.getAccess", () => {
  beforeEach(() => {
    get.mockReset();
    vi.mocked(http).mockReturnValue({ get } as never);
  });

  it("returns the server's answer", async () => {
    get.mockResolvedValue({ data: { read: true, triage: false, author: false, admin: false } });
    const res = await security.getAccess("acme");
    expect(get).toHaveBeenCalledWith("/api/acme/security/access");
    expect(res.data).toEqual({ read: true, triage: false, author: false, admin: false });
  });

  it("opens Security on a backend that predates the access route", async () => {
    get.mockRejectedValue({ response: { status: 404 } });
    expect((await security.getAccess("acme")).data).toEqual({
      read: true,
      triage: true,
      author: true,
      admin: true,
    });
  });

  it("rethrows every other failure so the caller fails closed", async () => {
    get.mockRejectedValue({ response: { status: 403 } });
    await expect(security.getAccess("acme")).rejects.toEqual({ response: { status: 403 } });
  });
});

describe("security.getAudit", () => {
  beforeEach(() => {
    get.mockReset();
    vi.mocked(http).mockReturnValue({ get } as never);
  });

  it("reads one page of the org's Security audit trail", async () => {
    get.mockResolvedValue({ data: { audit_enabled: true, events: [] } });
    await security.getAudit("acme", 50);
    expect(get).toHaveBeenCalledWith("/api/acme/security/audit", { params: { size: 50 } });
  });
});
