// Copyright 2026 OpenObserve Inc.

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

/** The create form. `datasetId` preselects the dataset the user came from. */
export function aiExperimentCreateRoute(
  orgIdentifier: string,
  options: Pick<AiExperimentsRouteOptions, "datasetId" | "query"> = {},
): RouteLocationRaw {
  return {
    name: "aiExperimentCreate",
    query: {
      ...options.query,
      org_identifier: orgIdentifier,
      ...(options.datasetId ? { dataset: options.datasetId } : {}),
    },
  };
}
