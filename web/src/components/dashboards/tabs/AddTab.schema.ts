// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddTab.vue. Built via a factory so the required message
// stays i18n-driven (pass useI18n's `t`), matching the old `t('dashboard.nameRequired')`.
//
// No defaults factory here: AddTab is an EDIT-prefill form. The OForm owns the
// `name` field; the component seeds it via a `defaults` computed (edit → the
// loaded tab's name, create → blank) and the non-schema fields (panels/tabId)
// come from the externally-loaded `editingTab` record — not a schema factory.

import { z } from "zod";

export const makeAddTabSchema = (t: (_key: string) => string) =>
  z.object({
    name: z.string().trim().min(1, t("dashboard.nameRequired")),
  });

export type AddTabForm = z.infer<ReturnType<typeof makeAddTabSchema>>;
