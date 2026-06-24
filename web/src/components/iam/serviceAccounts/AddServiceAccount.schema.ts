// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddServiceAccount.vue.
//
// `email` is CREATE-ONLY: required + a valid-email regex in create mode (mirrors
// the pre-migration `rules.email(v) || 'Please enter a valid email address'`), but
// in update mode the field is neither rendered nor submitted, so it is optional.
// The mode is supplied by the component (which knows `beingUpdated`) via this
// factory; the dialog body remounts per open, so OForm always reads the right
// variant. `first_name` (the description) is always optional. The invalid-email
// message is i18n-driven (pass useI18n's `t`).

import { z } from "zod";

export const serviceAccountEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const makeAddServiceAccountSchema = (
  beingUpdated: boolean,
  t: (_key: string) => string,
) =>
  z.object({
    email: beingUpdated
      ? z.string().optional()
      : z
          .string()
          .min(1, t("common.invalidEmail"))
          .regex(serviceAccountEmailRegex, t("common.invalidEmail")),
    first_name: z.string().optional(),
  });

// Explicit form type (the factory's two branches differ only in whether `email`
// is required, so a hand-written type is clearer than a z.infer union). The form
// always carries both fields; `email` is "" in update mode.
export interface AddServiceAccountForm {
  email: string;
  first_name: string;
}
