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
import { normalizeVariablesForCache, panelKeyDigest } from "./panelKey";

const svc = (overrides: Record<string, unknown>) => ({
  name: "svc",
  type: "query",
  scope: "global",
  multiSelect: true,
  value: ["_o2_all_"],
  isVariablePartialLoaded: true,
  ...overrides,
});
const keyWith = (variable: Record<string, unknown>) => ({
  panelSchema: { id: "p1" },
  variablesData: [variable],
});

describe("panel cache key for query variables", () => {
  it("keys 'All' on the values it stands for", () => {
    const [entry] = normalizeVariablesForCache([svc({ options: [{ label: "a", value: "a" }] })]);
    expect(entry.value).toEqual(["a"]);
  });

  it("does not serve a result saved for an empty list once the list changes", () => {
    const saved = panelKeyDigest(keyWith(svc({ options: [] })));
    expect(panelKeyDigest(keyWith(svc({ options: [{ label: "a", value: "a" }] })))).not.toBe(saved);
    expect(panelKeyDigest(keyWith(svc({ options: [], isVariablePartialLoaded: false })))).not.toBe(
      saved,
    );
  });

  it("leaves other variable types keyed on their raw value", () => {
    const [entry] = normalizeVariablesForCache([
      svc({ type: "query_values", options: [{ label: "a", value: "a" }] }),
    ]);
    expect(entry.value).toEqual(["_o2_all_"]);
  });
});
