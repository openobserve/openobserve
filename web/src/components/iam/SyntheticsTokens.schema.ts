// Copyright 2026 OpenObserve Inc.
//
// Validation schema for the "Create Token" dialog in SyntheticsTokens.vue. Name
// is required + max 256; "default" is reserved (the default token is replaced via
// Rotate, not created). No description field for synthetics tokens.

import { z } from "zod";

export const makeCreateTokenSchema = (
  t: (_key: string, _params?: Record<string, unknown>) => string,
) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("common.nameRequired"))
      .max(256, t("common.nameMaxLength", { max: 256 }))
      .refine((n) => n.toLowerCase() !== "default", {
        message: t("synthetics.tokens.nameReserved"),
      }),
  });

export type CreateTokenForm = z.infer<ReturnType<typeof makeCreateTokenSchema>>;

export const createTokenDefaults = (): CreateTokenForm => ({
  name: "",
});
