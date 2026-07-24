// Copyright 2026 OpenObserve Inc.
//
// Validation schema for ExternalDestination.vue (the remote_stream output-node
// drawer, select-existing branch).
//
// `selectedDestination` is the only editable control on the select-existing
// branch and is required.
//
// `createNewDestination` is a bare UI mode-toggle OUTSIDE the form (it swaps
// the select-existing form for CreateDestinationForm), so it is not a field.

import { z } from "zod";

export const makeExternalDestinationSchema = (t: (_key: string) => string) =>
  z.object({
    selectedDestination: z.string().min(1, t("pipeline.selectExternalDestination")),
  });

export type ExternalDestinationForm = {
  selectedDestination: string;
};
