// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddRole.vue. Built via a factory so the required message
// stays i18n-driven (pass useI18n's `t`).

import { z } from "zod";

export const roleNameRegex = /^[a-zA-Z0-9_]+$/;

export const makeAddRoleSchema = (
  t: (_key: string, _params?: Record<string, unknown>) => string,
) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("iam.role.name.required"))
      .regex(roleNameRegex, t("iam.role.name.invalidChars"))
      .max(100, t("common.nameMaxLength", { max: 100 })),
    // "Start from" preset: "custom" = empty role; "readonly" = seed read-only
    // perms once on EditRole. Defaults to "custom".
    startFrom: z.enum(["custom", "readonly"]).default("custom"),
  });

export type AddRoleForm = z.infer<ReturnType<typeof makeAddRoleSchema>>;

// Defaults live in a typed component computed in AddRole.vue (edit-prefill: the
// optional `role` prop seeds the name on open, blank otherwise) — not a static
// factory here.
