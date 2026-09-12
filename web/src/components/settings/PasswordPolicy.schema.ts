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

// Validation for the Complexity card. Only the one server rule this page can actually break is
// mirrored: rotation, history and lockout each validate a pair of fields the page cannot edit, so
// those checks could never fire here and would only drift.

import { z } from "zod";

import type { PasswordComplexity, PasswordPolicy } from "@/services/passwordPolicy";
import type { TranslateFn } from "@/types/i18n";

export const complexityBaseSchema = z.object({
  min_length: z.coerce.number().int().min(1),
  max_length: z.coerce.number().int().min(0),
  require_uppercase: z.boolean(),
  require_lowercase: z.boolean(),
  require_digit: z.boolean(),
  require_special: z.boolean(),
  special_char_set: z.string(),
});

export type ComplexityForm = z.infer<typeof complexityBaseSchema>;

export const makeComplexitySchema = (t: TranslateFn) =>
  complexityBaseSchema.superRefine((val, zctx) => {
    // Mirrors the server: 0 is "unbounded", anything else must leave room for the minimum.
    if (val.max_length !== 0 && val.max_length < val.min_length) {
      zctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["max_length"],
        message: t("passwordPolicy.maxLengthTooSmall"),
      });
    }
  });

/** The form values for a policy — the seven complexity fields, nothing else. */
export const complexityDefaults = (complexity: PasswordComplexity): ComplexityForm => ({
  min_length: complexity.min_length,
  max_length: complexity.max_length,
  require_uppercase: complexity.require_uppercase,
  require_lowercase: complexity.require_lowercase,
  require_digit: complexity.require_digit,
  require_special: complexity.require_special,
  special_char_set: complexity.special_char_set,
});

/**
 * The body to PUT: the loaded policy with the seven edited fields overridden.
 *
 * The spread is load-bearing and is why this is not built from explicit keys. PUT is a full
 * replacement over a `#[serde(default)]` struct, so any field left out of the body is RESET to its
 * default rather than left alone — omitting rotation, reuse or lockout here would silently wipe
 * whatever an operator configured through the API, and enumerating all of them would do the same to
 * the next field the server grows.
 */
export const buildPolicyPayload = (
  loadedPolicy: PasswordPolicy,
  values: ComplexityForm,
): PasswordPolicy => ({
  ...loadedPolicy,
  min_length: Number(values.min_length),
  max_length: Number(values.max_length),
  require_uppercase: values.require_uppercase,
  require_lowercase: values.require_lowercase,
  require_digit: values.require_digit,
  require_special: values.require_special,
  // A set is meaningless with the requirement off, and keeping a stale one would resurrect it the
  // next time someone flips the switch back on.
  special_char_set: values.require_special ? values.special_char_set.trim() : "",
});
