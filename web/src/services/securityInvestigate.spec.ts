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
import securityInvestigate from "@/services/securityInvestigate";
import type { StreamPlan } from "@/utils/security/streamPlan";

vi.mock("@/services/http", () => ({ default: vi.fn() }));

const plan: StreamPlan = {
  stream: "auth",
  sourceLabel: "Linux auth",
  columns: { user: "user" },
  outcomeColumn: null,
  failure: { kind: "outcome", column: "outcome" },
  volume: { docNum: 10, timeMinUs: 1, timeMaxUs: 2 },
};

describe("securityInvestigate service", () => {
  let client: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    client = { post: vi.fn().mockResolvedValue({ data: {} }) };
    vi.mocked(http).mockReturnValue(client as any);
  });

  it("sends plans as the server reads them, without client-only fields", async () => {
    await securityInvestigate.entities("acme", { startTime: 1, endTime: 2, plans: [plan] });
    const [url, body] = client.post.mock.calls[0];
    expect(url).toBe("/api/acme/security/entities");
    expect(body.plans).toEqual([
      {
        stream: "auth",
        columns: { user: "user" },
        failure: { kind: "outcome", column: "outcome" },
        actionColumn: null,
        messageColumn: null,
        volume: { docNum: 10, timeMinUs: 1, timeMaxUs: 2 },
      },
    ]);
  });

  it("posts each investigation to its own route", async () => {
    const req = { startTime: 1, endTime: 2, plans: [plan] };
    await securityInvestigate.graph("acme", req);
    await securityInvestigate.detail("acme", {
      ...req,
      kind: "user",
      values: ["dave"],
      interval: "1 hour",
    });
    await securityInvestigate.ueba("acme", {
      currentStart: 2,
      currentEnd: 3,
      baselineStart: 1,
      plans: [],
    });
    await securityInvestigate.searchEvents("acme", {
      ...req,
      query: { kind: "any", value: "x" },
      sort: { column: "time", order: "desc" },
      from: 0,
      size: 50,
      count: true,
    });
    expect(client.post.mock.calls.map((c) => c[0])).toEqual([
      "/api/acme/security/entities/graph",
      "/api/acme/security/entities/detail",
      "/api/acme/security/ueba",
      "/api/acme/security/events/search",
    ]);
  });
});
