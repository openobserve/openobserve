// Copyright 2026 OpenObserve Inc.
//
// Validation schema for Stream.vue (the input/output stream pipeline-node
// drawer, select-existing branch).
//
// Field ownership (R1-strict — every editable control inside <OForm> is
// form-owned):
//   • stream_type — required select. RESTORED from the BEFORE baseline:
//                   the original required BOTH stream_type AND stream_name, but
//                   the O-component migration only validated stream_name.
//   • stream_name — required select (creatable on output nodes).
//   • appendData  — optional switch (only relevant for enrichment_tables output).
//
// `createNewStream` stays a bare UI mode-toggle OUTSIDE the form (it swaps the
// select-existing form for the AddStream create child), so it is not a field.
//
// Validation TIMING is owned by OForm (submit-then-change); this file only
// describes WHAT is valid. Messages mirror the BEFORE baseline ('Field is
// required!').

import { z } from "zod";

export const makeStreamSchema = (t: (_key: string) => string) =>
  z.object({
    stream_type: z.string().min(1, t("pipeline.fieldRequired")),
    stream_name: z.string().min(1, t("pipeline.fieldRequired")),
    appendData: z.boolean().optional(),
  });

export type StreamForm = z.infer<ReturnType<typeof makeStreamSchema>>;
