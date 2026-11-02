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
import { viewDenial } from "@/composables/useAccessStore";
import { tableDenials } from "@/components/access/surfaceDenials";

const keys = (denials: { resource: { key: string } }[]) => denials.map((d) => d.resource.key);

describe("tableDenials", () => {
  const alertsList = viewDenial("alert_folders", "list", ["GET /api/v2/default/alerts"]);
  const templatesList = viewDenial("templates", "list", ["GET /api/default/alerts/templates"]);
  const alertDelete = viewDenial("alerts", "delete", ["DELETE /api/v2/default/alerts/a1"]);

  it("names the table's own refused list, with its requests", () => {
    const denials = tableDenials([templatesList, alertsList], "alert_folders");
    expect(keys(denials)).toEqual(["alert_folders"]);
    expect(denials[0].requests).toEqual(["GET /api/v2/default/alerts"]);
  });

  it("names the table's resource even before the page's entry arrives", () => {
    expect(tableDenials([], "functions")).toEqual([viewDenial("functions", "list")]);
  });

  it("names nothing when the table names no resource, even with one refused list on the page", () => {
    expect(tableDenials([alertDelete, templatesList])).toEqual([]);
  });

  it("names nothing when several lists were refused and the table names no resource", () => {
    expect(tableDenials([alertsList, templatesList])).toEqual([]);
  });
});
