// Copyright 2026 OpenObserve Inc.
//
// Form schema for plugins/metrics/AddToDashboard.vue. Only `panelTitle` is an
// OForm field; folder/dashboard/tab selection are separate dropdown components.

import { z } from "zod";

export const addToDashboardSchema = z.object({
  panelTitle: z.string().trim().min(1, "Panel Title required"),
});

export type AddToDashboardForm = z.infer<typeof addToDashboardSchema>;

// Static (create-only) defaults. Typed against the inferred form type so it
// can't drift from the schema. The component binds `:default-values`.
export const addToDashboardDefaults = (): AddToDashboardForm => ({
  panelTitle: "",
});
