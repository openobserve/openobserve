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
import { aiExperimentsRoute } from "./experimentRoutes";

describe("aiExperimentsRoute", () => {
  it("builds dataset, detail, and comparison deep links through one route contract", () => {
    expect(aiExperimentsRoute("acme", { datasetId: "dataset-a" })).toEqual({
      name: "aiExperiments",
      query: { org_identifier: "acme", dataset: "dataset-a" },
    });
    expect(
      aiExperimentsRoute("acme", {
        query: { experiment: "quality" },
        datasetId: "dataset-a",
        selectedId: "experiment-1",
        baselineId: "baseline-1",
        candidateId: "candidate-1",
      }),
    ).toEqual({
      name: "aiExperiments",
      query: {
        experiment: "quality",
        org_identifier: "acme",
        dataset: "dataset-a",
        selected: "experiment-1",
        baseline: "baseline-1",
        candidate: "candidate-1",
      },
    });
  });
});
