// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddGroup.vue. Built via a factory so the required
// message stays i18n-driven (pass useI18n's `t`).
//
// Restores the full pre-migration Quasar rule for `name`
// (`!!v ? isValidGroupName : nameRequired`) per the truthy→Zod inversion: it is
// BOTH required (min(1)) AND the alphanumeric/underscore regex — not regex-only.

import { z } from "zod";

export const groupNameRegex = /^[a-zA-Z0-9_]+$/;

export const makeAddGroupSchema = (
  t: (_key: string, _params?: Record<string, unknown>) => string,
) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("common.nameRequired"))
      .regex(groupNameRegex, t("iam.nameHelpText"))
      // Mirrors the input's maxlength=100 (defense-in-depth for non-typed values).
      .max(100, t("common.nameMaxLength", { max: 100 })),
  });

export type AddGroupForm = z.infer<ReturnType<typeof makeAddGroupSchema>>;

// Defaults live in a typed component computed in AddGroup.vue (edit-prefill: the
// optional `group` prop seeds the name on open, blank otherwise) — not a static
// factory here.
