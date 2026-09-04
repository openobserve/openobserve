// Copyright 2026 OpenObserve Inc.
//
// Form schema for plugins/metrics/AddToDashboard.vue. Only `panelTitle` is an
// OForm field; folder/dashboard/tab selection are separate dropdown components.

import { z } from "zod";

import type { TranslateFn } from "@/types/i18n";

// Factory so the caller threads its own `t` — matches the makeXSchema(t)
// convention used by the other form schemas.
export const makeAddToDashboardSchema = (t: TranslateFn) =>
  z.object({
    // `error` is a thunk, not a string: the schema is module-scope, so resolving the
    // message eagerly would freeze it at the locale that happened to be active when
    // this module was imported. Zod calls it per validation instead.
    panelTitle: z
      .string()
      .trim()
      .min(1, { error: () => t("metrics.panelTitleRequired") }),
  });

export type AddToDashboardForm = z.infer<ReturnType<typeof makeAddToDashboardSchema>>;

// Static (create-only) defaults. Typed against the inferred form type so it
// can't drift from the schema. The component binds `:default-values`.
export const addToDashboardDefaults = (): AddToDashboardForm => ({
  panelTitle: "",
});
