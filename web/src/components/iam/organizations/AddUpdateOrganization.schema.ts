// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddUpdateOrganization.vue. Built via a factory so the
// required message stays i18n-driven (pass useI18n's `t`).

import { z } from "zod";

export const orgNameRegex = /^[a-zA-Z0-9_ ]+$/;

export const makeAddUpdateOrganizationSchema = (
  t: (_key: string, _params?: Record<string, unknown>) => string,
) =>
  z.object({
    id: z.string().optional(),
    name: z
      .string()
      .trim()
      .min(1, t("organization.nameRequired"))
      .regex(orgNameRegex, t("organization.nameHelpText"))
      // Mirrors the input's maxlength=100 (defense-in-depth for non-typed values).
      .max(100, t("common.nameMaxLength", { max: 100 })),
    makeBilledMember: z.boolean().optional(),
  });

export type AddUpdateOrganizationForm = z.infer<
  ReturnType<typeof makeAddUpdateOrganizationSchema>
>;
