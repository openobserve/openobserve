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

import type { LocationQueryRaw, RouteLocationRaw } from "vue-router";

export interface AiExperimentsRouteOptions {
  datasetId?: string;
  selectedId?: string;
  baselineId?: string;
  candidateId?: string;
  query?: LocationQueryRaw;
}

export function aiExperimentsRoute(
  orgIdentifier: string,
  options: AiExperimentsRouteOptions = {},
): RouteLocationRaw {
  return {
    name: "aiExperiments",
    query: {
      ...options.query,
      org_identifier: orgIdentifier,
      ...(options.datasetId ? { dataset: options.datasetId } : {}),
      ...(options.selectedId ? { selected: options.selectedId } : {}),
      ...(options.baselineId ? { baseline: options.baselineId } : {}),
      ...(options.candidateId ? { candidate: options.candidateId } : {}),
    },
  };
}

/** A single experiment's results page. */
export function aiExperimentDetailRoute(
  orgIdentifier: string,
  experimentId: string,
): RouteLocationRaw {
  return {
    name: "aiExperimentDetail",
    params: { id: experimentId },
    query: { org_identifier: orgIdentifier },
  };
}

/** The side-by-side comparison of two runs. The ids are path params so the
 *  comparison is a shareable, bookmarkable address. */
export function aiExperimentCompareRoute(
  orgIdentifier: string,
  baselineId: string,
  candidateId: string,
): RouteLocationRaw {
  return {
    name: "aiExperimentCompare",
    params: { baselineId, candidateId },
    query: { org_identifier: orgIdentifier },
  };
}

/**
 * The create form. `datasetId` preselects the dataset the user came from;
 * `cloneOf` opens it as an editable copy of that run, dataset already pinned.
 */
export function aiExperimentCreateRoute(
  orgIdentifier: string,
  options: Pick<AiExperimentsRouteOptions, "datasetId" | "query"> & { cloneOf?: string } = {},
): RouteLocationRaw {
  return {
    name: "aiExperimentCreate",
    query: {
      ...options.query,
      org_identifier: orgIdentifier,
      ...(options.datasetId ? { dataset: options.datasetId } : {}),
      ...(options.cloneOf ? { clone_of: options.cloneOf } : {}),
    },
  };
}
