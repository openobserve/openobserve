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
import { isBareTracesQuery, tracesQueryKey } from "./tracesPageReturn";

describe("tracesQueryKey", () => {
  it("ignores key order and empty values", () => {
    expect(tracesQueryKey({ stream: "default", period: "15m", query: "" })).toBe(
      tracesQueryKey({ period: "15m", stream: "default" }),
    );
  });

  it("tells different views apart", () => {
    expect(tracesQueryKey({ stream: "a", period: "15m" })).not.toBe(
      tracesQueryKey({ stream: "b", period: "15m" }),
    );
  });

  it("treats a missing query like an empty one", () => {
    expect(tracesQueryKey(undefined)).toBe(tracesQueryKey({}));
  });
});

describe("isBareTracesQuery", () => {
  const shown = { stream: "default", period: "15m", org_identifier: "acme" };

  it("is bare for the menu link with no query or only the same org", () => {
    expect(isBareTracesQuery({}, shown)).toBe(true);
    expect(isBareTracesQuery({ org_identifier: "acme" }, shown)).toBe(true);
    expect(isBareTracesQuery({ org_identifier: "acme", query: "" }, shown)).toBe(true);
  });

  it("is not bare for another org or any view key", () => {
    expect(isBareTracesQuery({ org_identifier: "other" }, shown)).toBe(false);
    expect(isBareTracesQuery({ org_identifier: "acme", stream: "default" }, shown)).toBe(false);
    expect(isBareTracesQuery({ tab: "traces" }, shown)).toBe(false);
  });

  it("is bare for the menu link after the route guard stamped the default tab on it", () => {
    expect(isBareTracesQuery({ org_identifier: "acme", tab: "spans" }, shown)).toBe(true);
    expect(isBareTracesQuery({ org_identifier: "acme", tab: "spans", stream: "x" }, shown)).toBe(
      false,
    );
  });
});
