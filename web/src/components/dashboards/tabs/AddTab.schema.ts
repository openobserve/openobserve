// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddTab.vue. Built via a factory so the required message
// stays i18n-driven (pass useI18n's `t`).

import { z } from "zod";

export const makeAddTabSchema = (t: (_key: string) => string) =>
  z.object({
    name: z.string().trim().min(1, t("dashboard.nameRequired")),
  });

export type AddTabForm = z.infer<ReturnType<typeof makeAddTabSchema>>;
