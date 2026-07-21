// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddPanel.vue. The only OForm-validated field is the
// panel `title` (rendered in the page-header `#tabs` slot) — a required+trim
// Zod rule. The deeper chart/query validation (`validatePanel`) cannot be
// expressed per-field in Zod and stays in the imperative `isValid()` guard that
// the OForm `@submit` handler still runs.
//
// `title` is entangled: it is `dashboardPanelData.data.title`, which the whole
// editor reads/mutates (save payload, width calc, query inspector). It stays a
// form-owned field (`name="title"` + schema); the owner syncs it both ways
// without a mirror — form → editor via form.useStore, editor → form via a
// guarded setFieldValue (dontUpdateMeta, so no post-submit flash). Validation
// TIMING is owned by OForm.

import { z } from "zod";

export const makeAddPanelSchema = (t: (_key: string) => string) =>
  z.object({
    title: z.string().trim().min(1, t("dashboard.nameRequired")),
  });

export type AddPanelForm = z.infer<ReturnType<typeof makeAddPanelSchema>>;
