// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { z } from "zod";

import type { PasswordComplexity } from "@/services/passwordPolicy";
import type { TranslateFn } from "@/types/i18n";
import { validateAgainstComplexity } from "@/utils/passwordComplexity";

export const updatePasswordBaseSchema = z.object({
  old_password: z.string().optional().default(""),
  new_password: z.string().optional().default(""),
  confirm_password: z.string().optional().default(""),
});

export type UpdatePasswordForm = z.infer<typeof updatePasswordBaseSchema>;

export const updatePasswordDefaults = (): UpdatePasswordForm => ({
  old_password: "",
  new_password: "",
  confirm_password: "",
});

/**
 * Validation for the forced password reset.
 *
 * `getComplexity` is read on every run rather than captured, so one stable schema instance follows
 * the policy landing after mount — the dialog opens before the fetch resolves.
 */
export const makeUpdatePasswordSchema = (getComplexity: () => PasswordComplexity, t: TranslateFn) =>
  updatePasswordBaseSchema.superRefine((val, zctx) => {
    // Required-only: it is an existing credential, and may predate the policy being enforced now.
    if (!val.old_password) {
      zctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["old_password"],
        message: t("passwordReset.currentPasswordRequired"),
      });
    }

    if (!val.new_password) {
      zctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["new_password"],
        message: t("passwordReset.newPasswordRequired"),
      });
    } else {
      const failure = validateAgainstComplexity(val.new_password, getComplexity(), t);
      if (failure) {
        zctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["new_password"],
          message: failure,
        });
      }
    }

    if (!val.confirm_password) {
      zctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirm_password"],
        message: t("passwordReset.confirmPasswordRequired"),
      });
    } else if (val.confirm_password !== val.new_password) {
      zctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirm_password"],
        message: t("passwordReset.mismatch"),
      });
    }
  });
