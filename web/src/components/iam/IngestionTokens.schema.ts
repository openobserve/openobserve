// Copyright 2026 OpenObserve Inc.
//
// Validation schema for the "Create Token" dialog in IngestionTokens.vue. Built
// via a factory so the required message stays i18n-driven (pass useI18n's `t`):
// name is required + max 256; description is optional.

import { z } from "zod";

export const makeCreateTokenSchema = (
  t: (_key: string, _params?: Record<string, unknown>) => string,
) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("common.nameRequired"))
      .max(256, t("common.nameMaxLength", { max: 256 })),
    description: z.string().optional(),
  });

export type CreateTokenForm = z.infer<ReturnType<typeof makeCreateTokenSchema>>;

// Static (create-only) defaults.
export const createTokenDefaults = (): CreateTokenForm => ({
  name: "",
  description: "",
});
