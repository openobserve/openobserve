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
