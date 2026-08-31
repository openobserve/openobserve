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

import http from "./http";

/** What a password must look like. Mirrors `PasswordComplexity` in the Rust API. */
export interface PasswordComplexity {
  min_length: number;
  /** `0` means unbounded. */
  max_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_digit: boolean;
  require_special: boolean;
  /** Empty means any non-alphanumeric character counts as special. */
  special_char_set: string;
}

export interface LockoutPolicy {
  threshold: number;
  bucket_size: number;
  start_secs: number;
  max_secs: number;
  backoff: "linear" | "exponential";
}

/** The whole instance policy. Mirrors `PasswordPolicy` in the Rust API. */
export interface PasswordPolicy extends PasswordComplexity {
  rotation_days: number;
  rotation_warning_days: number;
  history_count: number;
  history_max_retained: number;
  lockout: LockoutPolicy;
  enforcement_mode: "hard_block" | "restrict_writes";
}

export interface SetPasswordPolicyResponse {
  policy: PasswordPolicy;
  users_flagged: number;
}

const passwordPolicy = {
  /** Readable by any authenticated user — the only policy route a flagged user can reach. */
  getComplexity: (orgIdentifier: string) => {
    return http().get(`/api/${orgIdentifier}/password_complexity`);
  },
  getPolicy: (metaOrg: string) => {
    return http().get(`/api/${metaOrg}/settings/password_policy`);
  },
  updatePolicy: (metaOrg: string, policy: PasswordPolicy) => {
    return http().put(`/api/${metaOrg}/settings/password_policy`, policy);
  },
};

export default passwordPolicy;
