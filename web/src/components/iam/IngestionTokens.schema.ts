// Copyright 2026 OpenObserve Inc.
//
// Validation schema for the "Create Token" dialog in IngestionTokens.vue. Built
// via a factory so the required message stays i18n-driven (pass useI18n's `t`).
//
// Before migration the name was "required" only via a disabled-Save gate
// (`:primary-button-disabled="!newTokenName.trim()"`) plus a `maxlength=256` on
// the input — there was no Quasar `:rules`. This encodes that intent into Zod:
// name is required + max 256; description is optional.

import { z } from "zod";

export const makeCreateTokenSchema = (t: (_key: string) => string) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("common.nameRequired"))
      .max(256, "Name must be at most 256 characters."),
    description: z.string().optional(),
  });

export type CreateTokenForm = z.infer<ReturnType<typeof makeCreateTokenSchema>>;

// Static (create-only) defaults.
export const createTokenDefaults = (): CreateTokenForm => ({
  name: "",
  description: "",
});
