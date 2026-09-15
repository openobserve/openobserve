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

// Validation for the whole policy page. Only the server's four cross-field rules are mirrored;
// every other field is a plain integer bound, and no floor is enforced on purpose — the API accepts
// a weak policy, so the console must too.

import { z } from "zod";

import type { LockoutPolicy, PasswordPolicy } from "@/services/passwordPolicy";
import type { TranslateFn } from "@/types/i18n";
import { DEFAULT_COMPLEXITY } from "@/utils/passwordComplexity";

const nonNegativeInt = z.coerce.number().int().min(0);

/** The server's default policy, shown until the real one loads. */
export const INITIAL_POLICY: PasswordPolicy = {
  ...DEFAULT_COMPLEXITY,
  rotation_days: 0,
  rotation_warning_days: 7,
  history_count: 0,
  history_max_retained: 30,
  lockout: {
    threshold: 0,
    bucket_size: 0,
    start_secs: 60,
    max_secs: 3600,
    backoff: "exponential",
  },
  enforcement_mode: "hard_block",
  cookie_max_age_secs: 0,
  apply_to_root: false,
};

export const policyBaseSchema = z.object({
  min_length: z.coerce.number().int().min(1),
  max_length: nonNegativeInt,
  require_uppercase: z.boolean(),
  require_lowercase: z.boolean(),
  require_digit: z.boolean(),
  require_special: z.boolean(),
  special_char_set: z.string(),
  rotation_days: nonNegativeInt,
  rotation_warning_days: nonNegativeInt,
  history_count: nonNegativeInt,
  history_max_retained: nonNegativeInt,
  lockout: z.object({
    threshold: nonNegativeInt,
    bucket_size: nonNegativeInt,
    start_secs: nonNegativeInt,
    max_secs: nonNegativeInt,
    backoff: z.enum(["linear", "exponential"]),
  }),
  enforcement_mode: z.enum(["hard_block", "restrict_writes"]),
  cookie_max_age_secs: nonNegativeInt,
  apply_to_root: z.boolean(),
});

export type PolicyForm = z.infer<typeof policyBaseSchema>;

export const makePolicySchema = (t: TranslateFn) =>
  policyBaseSchema.superRefine((val, zctx) => {
    const issue = (path: string[], message: string) =>
      zctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    // 0 is "unbounded", anything else must leave room for the minimum.
    if (val.max_length !== 0 && val.max_length < val.min_length) {
      issue(["max_length"], t("passwordPolicy.maxLengthTooSmall"));
    }
    // Equal is valid (warn from the first sign-in); only a LONGER window describes a deadline
    // that never exists. Skipped entirely while rotation is off.
    if (val.rotation_days !== 0 && val.rotation_warning_days > val.rotation_days) {
      issue(["rotation_warning_days"], t("passwordPolicy.warningDaysTooLong"));
    }
    if (val.history_max_retained < val.history_count) {
      issue(["history_max_retained"], t("passwordPolicy.historyRetainedTooSmall"));
    }
    if (val.lockout.start_secs > val.lockout.max_secs) {
      issue(["lockout", "start_secs"], t("passwordPolicy.lockoutStartTooLong"));
    }
  });

/** The form values for a loaded policy, field for field. */
export const policyDefaults = (policy: PasswordPolicy): PolicyForm => ({
  min_length: policy.min_length,
  max_length: policy.max_length,
  require_uppercase: policy.require_uppercase,
  require_lowercase: policy.require_lowercase,
  require_digit: policy.require_digit,
  require_special: policy.require_special,
  special_char_set: policy.special_char_set,
  rotation_days: policy.rotation_days,
  rotation_warning_days: policy.rotation_warning_days,
  history_count: policy.history_count,
  history_max_retained: policy.history_max_retained,
  lockout: { ...policy.lockout },
  enforcement_mode: policy.enforcement_mode,
  cookie_max_age_secs: policy.cookie_max_age_secs,
  apply_to_root: policy.apply_to_root,
});

/**
 * The body to PUT: the loaded policy with every edited field overridden.
 *
 * Spread over the loaded object rather than built from the form alone: PUT is a full replacement
 * over a `#[serde(default)]` struct, so a field the console does not know about yet would be
 * silently reset to its default if the body omitted it.
 */
export const buildPolicyPayload = (
  loadedPolicy: PasswordPolicy,
  values: PolicyForm,
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
  rotation_days: Number(values.rotation_days),
  rotation_warning_days: Number(values.rotation_warning_days),
  history_count: Number(values.history_count),
  history_max_retained: Number(values.history_max_retained),
  lockout: {
    threshold: Number(values.lockout.threshold),
    bucket_size: Number(values.lockout.bucket_size),
    start_secs: Number(values.lockout.start_secs),
    max_secs: Number(values.lockout.max_secs),
    backoff: values.lockout.backoff,
  },
  enforcement_mode: values.enforcement_mode,
  cookie_max_age_secs: Number(values.cookie_max_age_secs),
  apply_to_root: values.apply_to_root,
});

/**
 * The lockout durations an account would serve, level by level, until the ceiling is reached.
 *
 * Five integers and an enum do not communicate a ladder; the resulting sequence does. Capped at
 * six entries so a policy whose ceiling is far away still renders as one line.
 */
export const lockoutLadder = (lockout: LockoutPolicy, maxLevels = 6): number[] => {
  const start = Number(lockout.start_secs);
  const max = Number(lockout.max_secs);
  const ladder: number[] = [];
  for (let level = 1; level <= maxLevels; level++) {
    const raw = lockout.backoff === "linear" ? start * level : start * 2 ** (level - 1);
    const secs = Math.min(raw, max);
    ladder.push(secs);
    if (secs >= max) break;
  }
  return ladder;
};
