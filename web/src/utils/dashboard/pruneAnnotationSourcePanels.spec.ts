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
import type { AnnotationSource } from "@/ts/interfaces/dashboard";
import { pruneAnnotationSourcePanels } from "./pruneAnnotationSourcePanels";

const source = (overrides: Partial<AnnotationSource> = {}): AnnotationSource => ({
  id: "s1",
  name: "Deploys",
  color: "#5b8ef0",
  enabled: true,
  mode: "builder",
  streamType: "logs",
  stream: "k8s_events",
  filters: { filterType: "group", logicalOperator: "AND", conditions: [] },
  title: "{service} deployed",
  ...overrides,
});

describe("pruneAnnotationSourcePanels", () => {
  it("drops deleted panel ids and leaves an emptied list empty, not absent", () => {
    const dashboard = {
      tabs: [{ panels: [{ id: "p1" }] }, { panels: [{ id: "p2" }] }],
      annotationSources: [
        source({ id: "a", panels: ["p1", "gone"] }),
        source({ id: "b", panels: ["gone"] }),
        source({ id: "c" }),
      ],
    };
    pruneAnnotationSourcePanels(dashboard);
    expect(dashboard.annotationSources.map((it) => it.panels)).toEqual([["p1"], [], undefined]);
  });

  it("leaves a dashboard without tabs or sources alone", () => {
    const noTabs = { annotationSources: [source({ panels: ["p1"] })] };
    expect(pruneAnnotationSourcePanels(noTabs).annotationSources[0].panels).toEqual(["p1"]);
    expect(pruneAnnotationSourcePanels({ tabs: [] })).toEqual({ tabs: [] });
  });
});
