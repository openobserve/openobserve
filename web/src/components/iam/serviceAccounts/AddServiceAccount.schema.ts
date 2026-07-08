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
// message is i18n-driven (pass useI18n's `t`) — its own key (no trailing period)
// to preserve the exact pre-migration copy, distinct from the user form's
// `common.invalidEmail` ("…address.").

import { z } from "zod";

export const serviceAccountEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The form always carries both editable fields (`email` is "" in update mode);
// the type derives straight from this base shape via z.infer.
const addServiceAccountBaseSchema = z.object({
  email: z.string(),
  first_name: z.string(),
});

export type AddServiceAccountForm = z.infer<typeof addServiceAccountBaseSchema>;

// `email` is CREATE-ONLY: required + a valid-email regex in create mode (mirrors
// the pre-migration `rules.email(v) || 'Please enter a valid email address'`), and
// skipped entirely in update mode (the field is neither rendered nor submitted).
// Modelled as a conditional superRefine — like AddUser — so the base shape (and
// its z.infer type) stay stable across modes. The mode (`beingUpdated`) is
// supplied by the component; the dialog body remounts per open, so OForm always
// reads the right variant.
export const makeAddServiceAccountSchema = (
  beingUpdated: boolean,
  t: (_key: string) => string,
) =>
  addServiceAccountBaseSchema.superRefine((val, ctx) => {
    if (beingUpdated) return;
    if (val.email.length < 1 || !serviceAccountEmailRegex.test(val.email)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: t("serviceAccounts.emailInvalid"),
      });
    }
  });
