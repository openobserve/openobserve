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

import { describe, expect, it } from "vitest";
import { creationRoute, resourceRoute, sanitizeResourceHit } from "./resourceRoutes";
import type { ResourceHit } from "@/ts/interfaces/resources";

describe("Command K resource destinations", () => {
  it("keeps signals on their actual query page and preserves the organization", () => {
    for (const signal of ["logs", "metrics", "traces"] as const) {
      const hit: ResourceHit = {
        type: "stream",
        id: `${signal}/payments`,
        name: "payments",
        route_ref: { stream_type: signal, stream_name: "payments" },
      };
      const route = resourceRoute(hit, "acme");
      expect(route).toMatchObject({
        name: signal,
        query: { org_identifier: "acme", [signal === "metrics" ? "metric" : "stream"]: "payments" },
      });
    }
  });
  it("opens synthetic results with its public folder ID", () => {
    expect(
      resourceRoute(
        {
          type: "synthetic",
          id: "c1",
          name: "Checkout",
          route_ref: { check_id: "c1", folder_id: "f1" },
        },
        "acme",
      ),
    ).toMatchObject({
      name: "synthetic-monitor-results",
      params: { id: "c1" },
      query: { folder: "f1", org_identifier: "acme" },
    });
  });
  it("restores saved views without a run request and gives repeated creation intents distinct nonces", () => {
    expect(
      resourceRoute(
        {
          type: "saved_view",
          id: "v1",
          name: "Errors",
          route_ref: { view_id: "v1", view_type: "traces" },
        },
        "acme",
      ),
    ).toEqual({ name: "traces", query: { org_identifier: "acme", saved_view_id: "v1" } });
    expect(creationRoute("dashboard", "acme")).not.toEqual(creationRoute("dashboard", "acme"));
  });
  it("copies only allowlisted references and rejects mismatched identities", () => {
    expect(
      sanitizeResourceHit({
        type: "function",
        id: "normalize",
        name: "Normalize",
        route_ref: { function_name: "normalize", url: "https://evil.invalid" },
        token: "never-copy",
      }),
    ).toEqual({
      type: "function",
      id: "normalize",
      name: "Normalize",
      route_ref: { function_name: "normalize" },
    });
    expect(
      sanitizeResourceHit({
        type: "dashboard",
        id: "a",
        name: "A",
        route_ref: { dashboard_id: "b", folder_id: "f" },
      }),
    ).toBeNull();
  });
});
