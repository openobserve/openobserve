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

export const makeAddGroupSchema = (t: (_key: string) => string) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("common.nameRequired"))
      .regex(
        groupNameRegex,
        "Use alphanumeric and '_' characters only, without spaces.",
      )
      // Mirrors the input's maxlength=100 (defense-in-depth for non-typed values).
      .max(100, "Name must be at most 100 characters."),
  });

export type AddGroupForm = z.infer<ReturnType<typeof makeAddGroupSchema>>;

// Static (create-only) defaults. AppGroups always opens this dialog in create
// mode; the optional `group` prop only seeds the name when present (handled by a
// typed component computed in the .vue).
export const addGroupDefaults = (): AddGroupForm => ({ name: "" });
