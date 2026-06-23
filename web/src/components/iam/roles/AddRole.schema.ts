// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddRole.vue. Built via a factory so the required message
// stays i18n-driven (pass useI18n's `t`).
//
// Restores the full pre-migration Quasar rule for `name`
// (`!!v ? isValidRoleName : nameRequired`) per the truthy→Zod inversion: it is
// BOTH required (min(1)) AND the alphanumeric/underscore regex — not regex-only —
// plus the maxlength(100) the current code carried.

import { z } from "zod";

export const roleNameRegex = /^[a-zA-Z0-9_]+$/;

export const makeAddRoleSchema = (t: (_key: string) => string) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("common.nameRequired"))
      .regex(
        roleNameRegex,
        "Use alphanumeric and '_' characters only, without spaces.",
      )
      .max(100, "Role name must be at most 100 characters."),
  });

export type AddRoleForm = z.infer<ReturnType<typeof makeAddRoleSchema>>;

export const addRoleDefaults = (): AddRoleForm => ({ name: "" });
