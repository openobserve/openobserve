// Copyright 2026 OpenObserve Inc.
//
// Form schema for common/sidebar/AddFolder.vue. `name` is required; description
// is optional. Built via a factory so the required message stays i18n-driven.

import { z } from "zod";

export const makeAddFolderSchema = (t: (_key: string) => string) =>
  z.object({
    name: z.string().trim().min(1, t("dashboard.nameRequired")),
    description: z.string().optional(),
  });

export type AddFolderForm = z.infer<ReturnType<typeof makeAddFolderSchema>>;
