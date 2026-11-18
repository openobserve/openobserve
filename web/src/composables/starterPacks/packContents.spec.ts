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

import { KUBERNETES_PACK } from "./kubernetesPack";
import { buildContentRows, type ContentSources } from "./packContents";
import type { PackPreview } from "./types";

const preview = {
  items: [{ kind: "dashboard", itemId: "overview", status: "pending" }],
  names: {},
  notIncluded: [],
  bindings: [],
  questions: [],
  flavours: {},
  repairs: [],
} as unknown as PackPreview;

const sources = (over: Partial<ContentSources> = {}): ContentSources => ({
  pack: KUBERNETES_PACK,
  record: null,
  preview,
  alerts: [],
  firing: new Set(),
  muted: new Set(),
  snapshots: new Map(),
  readsOf: () => [],
  nameOf: (id) => id,
  ...over,
});

describe("buildContentRows", () => {
  it("gives a dashboard setup has not made the streams and description of the pack's JSON", () => {
    const doc = {
      description: "Cluster use",
      tabs: [],
      variables: { list: [{ query_data: { stream: "kube_pod_info" } }] },
    };
    const [row] = buildContentRows(sources({ planned: new Map([["overview", doc]]) }));
    expect(row).toMatchObject({ state: "willBeCreated", description: "Cluster use" });
    expect(row.streams).toEqual(["kube_pod_info"]);
  });

  it("leaves the streams empty while the pack's JSON is not loaded", () => {
    expect(buildContentRows(sources())[0].streams).toEqual([]);
  });
});
