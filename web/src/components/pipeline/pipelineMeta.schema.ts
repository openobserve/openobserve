// Copyright 2026 OpenObserve Inc.
//
// Validation schema for the pipeline editor's top-level metadata (the "name"
// input shown in the shell header on the create page). Built via a factory so
// the required message stays i18n-driven (pass useI18n's `t`).
//
// Only `name` is form-owned here — everything else about the pipeline (the node
// graph, source, edges) is authored on the drag-and-drop canvas and persisted
// through `pipelineObj.currentSelectedPipeline`, not through this form.
//
// Behavior parity: the old store-driven path required a non-empty name and
// nothing else, so this keeps `min(1)` only (no character regex). Tighten here
// deliberately if that ever becomes a product requirement.

import { z } from "zod";

export const makePipelineMetaSchema = (t: (_key: string) => string) =>
  z.object({
    name: z.string().min(1, t("pipeline.pipelineNameRequired")),
  });

export type PipelineMetaForm = z.infer<ReturnType<typeof makePipelineMetaSchema>>;

export const pipelineMetaDefaults = (): PipelineMetaForm => ({
  name: "",
});
