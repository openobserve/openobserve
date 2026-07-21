// Copyright 2026 OpenObserve Inc.
//
// Validation schema for CrossLinkDialog.vue. Built via a factory so the
// required messages stay i18n-driven (pass useI18n's `t`).
//
// `fields` is the chip-builder value: a fully form-owned, whole-array OPTIONAL
// field (not a min(1)).

import { z } from "zod";

export const makeCrossLinkDialogSchema = (t: (_key: string) => string) =>
  z.object({
    name: z.string().min(1, t("crossLinks.nameRequired")),
    url: z.string().min(1, t("crossLinks.urlRequired")),
    fields: z.array(z.object({ name: z.string() })).default([]),
    // Chip-builder scratch input that stages a field name before it's committed
    // as a chip. NOT part of the emit payload; form-owned + optional.
    newFieldName: z.string().optional(),
  });

export type CrossLinkDialogForm = z.infer<
  ReturnType<typeof makeCrossLinkDialogSchema>
>;
