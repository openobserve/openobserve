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
import { routePendingShape } from "./routePendingShape";

const route = (name: string, path: string, parents: string[] = [], params = {}) => ({
  name,
  path,
  params,
  matched: [...parents, name].map((n) => ({ name: n })) as any,
});

describe("routePendingShape", () => {
  it("draws a plain list as a table", () => {
    expect(routePendingShape(route("logstreams", "/streams"))).toEqual({
      kind: "table",
      rail: undefined,
      tabs: false,
    });
  });

  it("gives IAM, Settings and AI pages their section rail", () => {
    expect(routePendingShape(route("roles", "/iam/roles", ["iam"])).rail).toBe("section");
    expect(routePendingShape(route("cipherKeys", "/settings/cipher_keys", ["settings"])).rail).toBe(
      "section",
    );
    expect(routePendingShape(route("aiSessions", "/ai/sessions", [""])).rail).toBe("section");
  });

  it("puts a folder rail under the header of folder lists, and a tab row where the page has one", () => {
    expect(routePendingShape(route("alertList", "/alerts"))).toEqual({
      kind: "table",
      rail: "folder",
      tabs: true,
    });
    expect(routePendingShape(route("functionList", "/pipeline/functions", ["pipeline"])).tabs).toBe(
      true,
    );
  });

  it("tells dashboards, forms and detail pages apart", () => {
    expect(routePendingShape(route("viewDashboard", "/dashboards/view")).kind).toBe("dashboard");
    expect(routePendingShape(route("addAlert", "/alerts/add")).kind).toBe("form");
    expect(routePendingShape(route("general", "/settings/general", ["settings"])).kind).toBe(
      "form",
    );
    expect(
      routePendingShape(route("alertDetail", "/alerts/detail/a1", [], { alert_id: "a1" })).kind,
    ).toBe("detail");
  });
});
