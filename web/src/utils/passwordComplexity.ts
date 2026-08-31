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

// Turns the instance password policy into the two things every password form
// needs: the requirement rows it shows, and the validation it runs. Pure — no
// Vue, no fetching — so both are testable without mounting anything, and the
// reset dialog and the user forms cannot drift apart.

import type { PasswordComplexity } from "@/services/passwordPolicy";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";

export type PasswordRequirementKey =
  "minLength" | "maxLength" | "uppercase" | "lowercase" | "digit" | "special";

export interface PasswordRequirement {
  key: PasswordRequirementKey;
  label: I18nText;
  isMet: (_password: string) => boolean;
}

/** What an instance that has never configured a policy enforces. */
export const DEFAULT_COMPLEXITY: PasswordComplexity = {
  min_length: 8,
  max_length: 0,
  require_uppercase: false,
  require_lowercase: false,
  require_digit: false,
  require_special: false,
  special_char_set: "",
};

const isSpecialChar = (char: string, specialCharSet: string): boolean => {
  if (specialCharSet) return specialCharSet.includes(char);
  return !/[a-zA-Z0-9]/.test(char);
};

const hasSpecialChar = (password: string, specialCharSet: string): boolean =>
  password.split("").some((char) => isSpecialChar(char, specialCharSet));

/**
 * The requirement rows for a policy — only the ones it actually enforces.
 *
 * Generated rather than hardcoded so the console can never state a rule the server does not check,
 * nor miss one it does.
 */
export const buildPasswordRequirements = (
  complexity: PasswordComplexity,
  t: TranslateFn,
): PasswordRequirement[] => {
  const requirements: PasswordRequirement[] = [];

  if (complexity.min_length > 0) {
    requirements.push({
      key: "minLength",
      label: t("passwordReset.req.minLength", { count: complexity.min_length }),
      isMet: (password) => password.length >= complexity.min_length,
    });
  }

  if (complexity.max_length > 0) {
    requirements.push({
      key: "maxLength",
      label: t("passwordReset.req.maxLength", { count: complexity.max_length }),
      isMet: (password) => password.length <= complexity.max_length,
    });
  }

  if (complexity.require_uppercase) {
    requirements.push({
      key: "uppercase",
      label: t("passwordReset.req.uppercase"),
      isMet: (password) => /[A-Z]/.test(password),
    });
  }

  if (complexity.require_lowercase) {
    requirements.push({
      key: "lowercase",
      label: t("passwordReset.req.lowercase"),
      isMet: (password) => /[a-z]/.test(password),
    });
  }

  if (complexity.require_digit) {
    requirements.push({
      key: "digit",
      label: t("passwordReset.req.digit"),
      isMet: (password) => /[0-9]/.test(password),
    });
  }

  if (complexity.require_special) {
    requirements.push({
      key: "special",
      label: complexity.special_char_set
        ? t("passwordReset.req.specialFromSet", { set: raw(complexity.special_char_set) })
        : t("passwordReset.req.special"),
      isMet: (password) => hasSpecialChar(password, complexity.special_char_set),
    });
  }

  return requirements;
};

/** How many requirements a password currently satisfies. Drives the strength indicator. */
export const countMetRequirements = (
  requirements: PasswordRequirement[],
  password: string,
): number => requirements.filter((requirement) => requirement.isMet(password)).length;

/**
 * The first requirement a password fails, or `null` when it satisfies all of them.
 *
 * One message rather than a list: the requirement rows are already on screen, so an inline error
 * only has to name the next thing to fix.
 */
export const firstUnmetRequirement = (
  requirements: PasswordRequirement[],
  password: string,
): PasswordRequirement | null =>
  requirements.find((requirement) => !requirement.isMet(password)) ?? null;

/**
 * Validate a password against the policy, returning the message for the first failure.
 *
 * The server is still authoritative — this only saves a round trip for something the user can see
 * spelled out above the field.
 */
export const validateAgainstComplexity = (
  password: string,
  complexity: PasswordComplexity,
  t: TranslateFn,
): I18nText | null => {
  const unmet = firstUnmetRequirement(buildPasswordRequirements(complexity, t), password);
  return unmet ? t("passwordReset.req.unmet", { requirement: unmet.label }) : null;
};
