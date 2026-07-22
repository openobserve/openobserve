// Copyright 2026 OpenObserve Inc.
//
// Validation schema for the internal-user login form in Login.vue. Both fields
// are required; `name` is additionally validated as a well-formed email (the
// field is typed `email` and labelled "User Email"). Built via a factory so the
// messages stay i18n-driven (pass useI18n's `t`).

import { z } from "zod";

export const makeLoginSchema = (t: (_key: string) => string) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("login.emailRequired"))
      .email(t("login.emailInvalid")),
    password: z.string().min(1, t("login.passwordRequired")),
  });

export type LoginForm = z.infer<ReturnType<typeof makeLoginSchema>>;

export const loginDefaults: LoginForm = { name: "", password: "" };
