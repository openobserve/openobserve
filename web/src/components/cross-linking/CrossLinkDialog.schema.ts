// Copyright 2026 OpenObserve Inc.
//
// Validation schema for CrossLinkDialog.vue. Built via a factory so the
// required messages stay i18n-driven (pass useI18n's `t`).
//
// Restored from the BEFORE baseline:
//   name — `!!v || t('crossLinks.nameRequired')` → z.string().min(1, …)
//   url  — `!!v || t('crossLinks.urlRequired')`  → z.string().min(1, …)
//   (No regex on either — matching the BEFORE rows exactly.)
//
// `fields` is the chip-builder value. The chip-builder is now an authored
// OFormCombobox (R1-strict: no bare control inside the OForm) and `fields` is a
// fully form-owned, whole-array OPTIONAL field (the legacy "Fields *" asterisk
// was never enforced, so it is NOT a min(1) here).

import { z } from "zod";

export const makeCrossLinkDialogSchema = (t: (_key: string) => string) =>
  z.object({
    name: z.string().min(1, t("crossLinks.nameRequired")),
    url: z.string().min(1, t("crossLinks.urlRequired")),
    fields: z.array(z.object({ name: z.string() })).default([]),
    // Chip-builder scratch input (the OFormCombobox / OFormInput that stages a
    // field name before it's committed as a chip). NOT part of the emit
    // payload — R1-strict keeps it form-owned + optional so the bare control is
    // gone.
    newFieldName: z.string().optional(),
  });

export type CrossLinkDialogForm = z.infer<
  ReturnType<typeof makeCrossLinkDialogSchema>
>;
