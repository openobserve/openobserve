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

import { beforeEach, describe, expect, it, vi } from "vitest";
import http from "@/services/http";
import analytics from "@/services/product_analytics";
import passwordPolicy, { type PasswordPolicy } from "@/services/passwordPolicy";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/http", () => ({ default: vi.fn() }));

const policy: PasswordPolicy = {
  min_length: 12,
  max_length: 0,
  require_uppercase: true,
  require_lowercase: true,
  require_digit: true,
  require_special: false,
  special_char_set: "",
  rotation_days: 90,
  rotation_warning_days: 7,
  history_count: 5,
  history_max_retained: 10,
  lockout: { threshold: 0, bucket_size: 60, start_secs: 30, max_secs: 600, backoff: "linear" },
  cookie_max_age_secs: 0,
  apply_to_root: false,
};

describe("passwordPolicy analytics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tracks a saved policy with its toggles and the flagged-user count", async () => {
    vi.mocked(http).mockReturnValue({
      put: vi.fn().mockResolvedValue({ data: { policy, users_flagged: 3 } }),
    } as any);

    await passwordPolicy.updatePolicy("_meta", policy);

    expect(analytics.track).toHaveBeenCalledWith("password_policy_updated", {
      rotation_enabled: true,
      lockout_enabled: false,
      apply_to_root: false,
      users_flagged: 3,
    });
  });

  it("does not track a rejected policy", async () => {
    vi.mocked(http).mockReturnValue({
      put: vi.fn().mockRejectedValue(new Error("invalid")),
    } as any);

    await expect(passwordPolicy.updatePolicy("_meta", policy)).rejects.toThrow("invalid");
    expect(analytics.track).not.toHaveBeenCalled();
  });
});
