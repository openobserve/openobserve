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
import {
  syntheticsCreateRoute,
  syntheticsEditRoute,
  syntheticsFolderName,
  syntheticsListRoute,
  syntheticsNavContextFromRoute,
  syntheticsPrivateLocationRoute,
  syntheticsResultsRoute,
} from "./routes";

const CTX = { orgIdentifier: "acme", folderId: "f_ksuid_01" };

describe("synthetics route builders", () => {
  it("stamps org_identifier and folder on the list route", () => {
    expect(syntheticsListRoute(CTX)).toEqual({
      name: "synthetics",
      query: { org_identifier: "acme", folder: "f_ksuid_01" },
    });
  });

  it("opens the private-locations tab when asked", () => {
    expect(syntheticsListRoute(CTX, { section: "private" })).toEqual({
      name: "synthetics",
      query: { org_identifier: "acme", folder: "f_ksuid_01", section: "private" },
    });
  });

  it("carries the folder and type into the create wizard", () => {
    expect(syntheticsCreateRoute(CTX, "browser")).toEqual({
      name: "synthetics-add",
      query: { org_identifier: "acme", folder: "f_ksuid_01", type: "browser" },
    });
  });

  it("carries the RBAC folder into the edit wizard", () => {
    expect(syntheticsEditRoute(CTX, "chk1")).toEqual({
      name: "synthetics-edit",
      params: { id: "chk1" },
      query: { org_identifier: "acme", folder: "f_ksuid_01" },
    });
  });

  it("adds the display name and trigger time to the results route", () => {
    expect(
      syntheticsResultsRoute(CTX, "chk1", { name: "Checkout", lastTriggeredAt: 1700 }),
    ).toEqual({
      name: "synthetic-monitor-results",
      params: { id: "chk1" },
      query: {
        org_identifier: "acme",
        folder: "f_ksuid_01",
        name: "Checkout",
        last_triggered_at: "1700",
      },
    });
  });

  it("omits last_triggered_at when the check has never run", () => {
    const route = syntheticsResultsRoute(CTX, "chk1", { lastTriggeredAt: 0 }) as any;
    expect(route.query).not.toHaveProperty("last_triggered_at");
  });

  it("stamps the context on the private-location route", () => {
    expect(syntheticsPrivateLocationRoute(CTX, "loc1")).toEqual({
      name: "synthetic-private-location",
      params: { id: "loc1" },
      query: { org_identifier: "acme", folder: "f_ksuid_01" },
    });
  });

  // The server reads a present-but-empty `?folder=` as authoritative, so an
  // absent folder must be absent from the URL rather than serialised as "".
  it("omits empty params instead of emitting blank query values", () => {
    expect(syntheticsListRoute({})).toEqual({ name: "synthetics", query: {} });
    expect(syntheticsListRoute({ orgIdentifier: "", folderId: "" })).toEqual({
      name: "synthetics",
      query: {},
    });
  });
});

describe("syntheticsNavContextFromRoute", () => {
  it("reads both params back out of a route", () => {
    expect(
      syntheticsNavContextFromRoute({ query: { org_identifier: "acme", folder: "f1" } }),
    ).toEqual({ orgIdentifier: "acme", folderId: "f1" });
  });

  it("treats blank and repeated params as absent", () => {
    expect(
      syntheticsNavContextFromRoute({ query: { org_identifier: "", folder: ["a", "b"] } }),
    ).toEqual({ orgIdentifier: undefined, folderId: undefined });
  });
});

describe("syntheticsFolderName", () => {
  const folders = [
    { folderId: "default", name: "Default" },
    { folderId: "f_ksuid_01", name: "Production" },
  ];

  it("resolves an ID to its display name", () => {
    expect(syntheticsFolderName(folders, "f_ksuid_01")).toBe("Production");
  });

  // A folder deleted since the link was made must not blank the header.
  it("falls back to the ID when the folder is unknown", () => {
    expect(syntheticsFolderName(folders, "f_gone")).toBe("f_gone");
  });

  it("returns empty string when there is no folder", () => {
    expect(syntheticsFolderName(folders, undefined)).toBe("");
  });
});
