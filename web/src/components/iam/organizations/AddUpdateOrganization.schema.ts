// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddUpdateOrganization.vue. Built via a factory so the
// required message stays i18n-driven (pass useI18n's `t`).
//
// Restores the full pre-migration Quasar rule for `name`
// (`!!v ? isValidOrgName : nameRequired`) per the truthy→Zod inversion: BOTH
// required (min(1)) AND the alphanumeric/space/underscore regex — not regex-only.
// `id` is a read-only display field (update mode) and `makeBilledMember` is an
// optional cloud-only checkbox; both are optional schema entries (R1-strict).

import { z } from "zod";

export const orgNameRegex = /^[a-zA-Z0-9_ ]+$/;

export const makeAddUpdateOrganizationSchema = (t: (_key: string) => string) =>
  z.object({
    id: z.string().optional(),
    name: z
      .string()
      .trim()
      .min(1, t("organization.nameRequired"))
      .regex(
        orgNameRegex,
        "Use alphanumeric characters, space and underscore only.",
      ),
    makeBilledMember: z.boolean().optional(),
  });

export type AddUpdateOrganizationForm = z.infer<
  ReturnType<typeof makeAddUpdateOrganizationSchema>
>;
