// Copyright 2026 OpenObserve Inc.
//
// Validation schema for dashboards/AddFolder.vue. `name` is required; description
// is optional. Factory keeps the required message i18n-driven.

import { z } from "zod";

export const makeAddFolderSchema = (t: (_key: string) => string) =>
  z.object({
    name: z.string().trim().min(1, t("dashboard.nameRequired")),
    description: z.string().optional(),
  });

export type AddFolderForm = z.infer<ReturnType<typeof makeAddFolderSchema>>;
