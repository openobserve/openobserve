// Copyright 2026 OpenObserve Inc.

import type { RouteLocationRaw } from "vue-router";

export interface AiPlaygroundRouteOptions {
  /** Opens the sample dialog pre-set to this dataset. */
  datasetId?: string;
  /** Clones this run's task config into the first variant. */
  experimentId?: string;
  /** Loads the conversation stashed by Trace Details (see playgroundHandoff). */
  fromSpan?: boolean;
}

/**
 * The bench. Entry params are read once on mount — a link reproduces the
 * STARTING setup, not live state, because a Playground draft is never saved.
 */
export function aiPlaygroundRoute(
  orgIdentifier: string,
  options: AiPlaygroundRouteOptions = {},
): RouteLocationRaw {
  return {
    name: "aiPlayground",
    query: {
      org_identifier: orgIdentifier,
      ...(options.datasetId ? { dataset: options.datasetId } : {}),
      ...(options.experimentId ? { experiment: options.experimentId } : {}),
      ...(options.fromSpan ? { from: "span" } : {}),
    },
  };
}
