// Copyright 2026 OpenObserve Inc.
//
// Validation schema for CrossLinkDialog.vue. Built via a factory so the
// required messages stay i18n-driven (pass useI18n's `t`).
//
// `fields` is the chip-builder value: a fully form-owned, whole-array OPTIONAL
// field (not a min(1)).

import { z } from "zod";

import { isSafeNavigableUrl } from "@/utils/safeUrl";

/**
 * A cross-link URL is a TEMPLATE containing `${field.__value}` placeholders,
 * so it is validated with the placeholders stripped to a harmless token — the
 * shape around them still has to be a real http(s) URL.
 *
 * Previously the only rule was `min(1)`, so `javascript:alert(1)` saved
 * cleanly and was handed to `window.open` for every viewer of the stream.
 */
export function crossLinkUrlIsValid(url: string): boolean {
  const withoutPlaceholders = url.replace(/\$\{[^}]*\}/g, "x");
  return isSafeNavigableUrl(withoutPlaceholders);
}

export const makeCrossLinkDialogSchema = (t: (_key: string) => string) =>
  z.object({
    name: z.string().min(1, t("crossLinks.nameRequired")),
    url: z
      .string()
      .min(1, t("crossLinks.urlRequired"))
      .refine(crossLinkUrlIsValid, { message: t("crossLinks.urlInvalid") }),
    fields: z.array(z.object({ name: z.string() })).default([]),
    // Chip-builder scratch input that stages a field name before it's committed
    // as a chip. NOT part of the emit payload; form-owned + optional.
    newFieldName: z.string().optional(),
  });

export type CrossLinkDialogForm = z.infer<ReturnType<typeof makeCrossLinkDialogSchema>>;
