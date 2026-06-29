// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddUser.vue — the most conditional form in this module.
// The same dialog handles THREE modes, driven by component context (not form
// values): add-an-existing-user (enter an email to invite), create-a-brand-new
// user (after a 422 says the email is new), and edit-an-existing-user. Each mode
// validates a different subset of fields, so the rules live in a `superRefine`
// keyed off a context object the component supplies via this factory.
//
// Restores the pre-migration (BEFORE) rules that the earlier O-component
// migration had weakened into manual `emailError`/`roleError`/`passwordError`
// refs + toast checks:
//   • email     — required + valid-email regex (add-existing mode)
//   • role      — required (add-existing, non-self, non-member)
//   • password  — required + strong policy (create-new). The policy already
//                 enforces the BEFORE min-length-8 (and more).
//   • old/new_password — required when changing. old_password is required-only
//                 (it is an EXISTING credential that predates the strong policy,
//                 so it is never re-validated for length/strength — matches the
//                 upstream "enforce strong password policy" baseline); new keeps
//                 the current strong policy.
//   • other_organization — must start with a letter (alphanumeric, _ or -).
//
// Messages are i18n-driven (the factory takes useI18n's `t`).

import { z } from "zod";

// Password policy (mirrors src/config/src/utils/password.rs): length 8-128 AND
// lower AND upper AND digit AND special.
export const isStrongPassword = (val: string): boolean => {
  if (!val || val.length < 8 || val.length > 128) return false;
  const hasLower = /[a-z]/.test(val);
  const hasUpper = /[A-Z]/.test(val);
  const hasDigit = /[0-9]/.test(val);
  const hasSpecial = /[^A-Za-z0-9]/.test(val);
  return hasLower && hasUpper && hasDigit && hasSpecial;
};

export const userEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// other_organization must START WITH A LETTER, then alphanumeric / _ / - .
export const otherOrgRegex = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/** Non-form context that decides which rules apply (the form fields alone can't
 *  express the add-existing / add-new / edit mode split). */
export interface AddUserSchemaContext {
  existingUser: boolean;
  beingUpdated: boolean;
  userRole: string;
  loggedInUserEmail: string;
  modelEmail: string;
  organization: string;
}

// Every control inside <OForm> is form-owned (R1-strict); base fields are
// optional and the real, mode-dependent requireds are enforced in superRefine.
export const addUserBaseSchema = z.object({
  email: z.string().optional().default(""),
  password: z.string().optional().default(""),
  first_name: z.string().optional().default(""),
  last_name: z.string().optional().default(""),
  role: z.string().optional().default(""),
  custom_role: z.array(z.any()).optional().default([]),
  change_password: z.boolean().optional().default(false),
  old_password: z.string().optional().default(""),
  new_password: z.string().optional().default(""),
  other_organization: z.string().optional().default(""),
});

export type AddUserForm = z.infer<typeof addUserBaseSchema>;

export const makeAddUserSchema = (
  getCtx: () => AddUserSchemaContext,
  t: (_key: string) => string,
) =>
  addUserBaseSchema.superRefine((val, zctx) => {
    // Read the live context on every run so a single stable schema instance
    // follows mode flips (e.g. the 422 add-existing → create-new switch) WITHOUT
    // a remount — the OWNER (AddUser.vue) holds one form via useOForm. (Rule ③)
    const ctx = getCtx();
    // ── Add an existing user (enter an email to invite) ──────────────────────
    if (ctx.existingUser && !ctx.beingUpdated) {
      if (!val.email || !userEmailRegex.test(val.email)) {
        zctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["email"],
          message: t("common.invalidEmail"),
        });
      }
      // Role required when an admin assigns it to someone other than themselves.
      if (
        ctx.userRole !== "member" &&
        ctx.loggedInUserEmail !== val.email &&
        !val.role
      ) {
        zctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["role"],
          message: t("user.fieldRequired"),
        });
      }
    }

    // ── Create a brand-new user ──────────────────────────────────────────────
    if (!ctx.existingUser && !ctx.beingUpdated) {
      if (!val.password) {
        zctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["password"],
          message: t("user.passwordRequired"),
        });
      } else if (!isStrongPassword(val.password)) {
        zctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["password"],
          message: t("user.passwordPolicyHint"),
        });
      }
    }

    // ── Edit an existing user, changing the password ─────────────────────────
    if (ctx.beingUpdated && val.change_password) {
      const needsOldPwd =
        ctx.userRole === "member" || ctx.loggedInUserEmail === ctx.modelEmail;
      // old_password is required-only — never re-validated for length/strength
      // (it is an existing credential that may predate the strong policy).
      if (needsOldPwd && !val.old_password) {
        zctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["old_password"],
          message: t("user.currentPasswordRequired"),
        });
      }
      if (!val.new_password) {
        zctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["new_password"],
          message: t("user.newPasswordRequired"),
        });
      } else if (!isStrongPassword(val.new_password)) {
        zctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["new_password"],
          message: t("user.passwordPolicyHint"),
        });
      }
    }

    // ── other_organization (root assigning to "other" org) ───────────────────
    if (
      !ctx.beingUpdated &&
      ctx.userRole !== "member" &&
      ctx.organization === "other"
    ) {
      if (!otherOrgRegex.test(val.other_organization)) {
        zctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["other_organization"],
          message: t("user.otherOrgInvalid"),
        });
      }
    }
  });
