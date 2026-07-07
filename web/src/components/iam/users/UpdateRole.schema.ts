// Copyright 2026 OpenObserve Inc.
//
// Validation schema for UpdateRole.vue. `role` is required (the old imperative
// `roleError = 'Role is required'` guard, now schema-driven). `first_name` is a
// read-only display field — kept as an optional form entry per R1-strict so every
// control inside <OForm> is an OForm* component, but excluded from any rule.
//
// Built via a factory so the required message stays i18n-driven (pass useI18n's
// `t`). EDIT-prefill form: defaults (role/first_name from props.modelValue) live
// in a typed component computed, not here.

import { z } from "zod";

export const makeUpdateRoleSchema = (t: (_key: string) => string) =>
  z.object({
    role: z.string().min(1, t("user.roleRequired")),
    first_name: z.string().optional(),
  });

export type UpdateRoleForm = z.infer<ReturnType<typeof makeUpdateRoleSchema>>;
