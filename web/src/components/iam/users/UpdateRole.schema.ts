// Copyright 2026 OpenObserve Inc.
//
// Validation schema for UpdateRole.vue. `role` is required (the old imperative
// `roleError = 'Role is required'` guard, now schema-driven). `first_name` is a
// read-only display field — kept as an optional form entry per R1-strict so every
// control inside <OForm> is an OForm* component, but excluded from any rule.
//
// EDIT-prefill form: defaults (role/first_name from props.modelValue) live in a
// typed component computed, not a factory here.

import { z } from "zod";

export const updateRoleSchema = z.object({
  role: z.string().min(1, "Role is required"),
  first_name: z.string().optional(),
});

export type UpdateRoleForm = z.infer<typeof updateRoleSchema>;
