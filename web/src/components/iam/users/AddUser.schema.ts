// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddUser.vue — the most conditional form in this module.
// The same dialog handles THREE modes, driven by component context (not form
// values): add-an-existing-user (enter an email to invite), create-a-brand-new
// user (after a 422 says the email is new), and edit-an-existing-user. Each mode
// validates a different subset of fields, so the rules live in a `superRefine`
// keyed off a context object the component supplies via this factory.
//
// Messages are i18n-driven (the factory takes useI18n's `t`).

import { z } from "zod";

import type { PasswordComplexity } from "@/services/passwordPolicy";
import type { TranslateFn } from "@/types/i18n";
import { validateAgainstComplexity } from "@/utils/passwordComplexity";

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
  /** The instance policy the server will hold this password to. */
  complexity: PasswordComplexity;
}

// Base fields are optional; the real, mode-dependent requireds are enforced in
// superRefine.
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

export const makeAddUserSchema = (getCtx: () => AddUserSchemaContext, t: TranslateFn) =>
  addUserBaseSchema.superRefine((val, zctx) => {
    // Read the live context on every run so a single stable schema instance
    // follows mode flips (e.g. the 422 add-existing → create-new switch) without
    // a remount.
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
      if (ctx.userRole !== "member" && ctx.loggedInUserEmail !== val.email && !val.role) {
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
      } else {
        const failure = validateAgainstComplexity(val.password, ctx.complexity, t);
        if (failure) {
          zctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["password"],
            message: failure,
          });
        }
      }
    }

    // ── Edit an existing user, changing the password ─────────────────────────
    if (ctx.beingUpdated && val.change_password) {
      const needsOldPwd = ctx.userRole === "member" || ctx.loggedInUserEmail === ctx.modelEmail;
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
      } else {
        const failure = validateAgainstComplexity(val.new_password, ctx.complexity, t);
        if (failure) {
          zctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["new_password"],
            message: failure,
          });
        }
      }
    }

    // ── other_organization (root assigning to "other" org) ───────────────────
    if (!ctx.beingUpdated && ctx.userRole !== "member" && ctx.organization === "other") {
      if (!otherOrgRegex.test(val.other_organization)) {
        zctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["other_organization"],
          message: t("user.otherOrgInvalid"),
        });
      }
    }
  });
