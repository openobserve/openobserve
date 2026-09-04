// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddDashboard.vue. `name` is required; description is
// optional. Factory keeps the required message i18n-driven.

import { z } from "zod";

export const makeAddDashboardSchema = (t: (_key: string) => string) =>
  z.object({
    name: z.string().trim().min(1, t("dashboard.nameRequired")),
    description: z.string().optional(),
  });

export type AddDashboardForm = z.infer<ReturnType<typeof makeAddDashboardSchema>>;

// Static (create-only) defaults for the form. Schema shape only — `id` is a
// display-only value, not a form field, so it is intentionally absent here.
export const addDashboardDefaults = (): AddDashboardForm => ({
  name: "",
  description: "",
});
