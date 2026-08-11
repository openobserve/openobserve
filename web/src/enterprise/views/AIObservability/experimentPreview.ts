// Copyright 2026 OpenObserve Inc.

import type {
  ExperimentCreatePayload,
  ExperimentPreview,
} from "@/services/llm-experiments.service";

/** Keeps only the newest preview request eligible to update the draft UI. */
export function createPreviewRequestGate() {
  let currentRequest = 0;

  return {
    start: () => ++currentRequest,
    invalidate: () => {
      currentRequest += 1;
    },
    isCurrent: (request: number) => request === currentRequest,
  };
}

/** Reuses the exact scorer versions returned by preview when creating. */
export function withPreviewScorers(
  payload: ExperimentCreatePayload,
  preview: ExperimentPreview,
): ExperimentCreatePayload {
  return {
    ...payload,
    scorers: preview.pinnedScorers.map(({ id, version }) => ({ id, version })),
  };
}
