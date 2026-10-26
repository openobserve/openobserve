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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { purgeAllQueries, purgeOrgQueries } from "@/composables/query/queryClient";
import {
  clearHeldTokenSecrets,
  heldTokenSecret,
  holdTokenSecret,
  newestHeldToken,
  secretsEpoch,
} from "./fleetTokenSecrets";

describe("held token secrets", () => {
  beforeEach(() => clearHeldTokenSecrets());

  it("returns a plaintext only for a token created in this session", () => {
    expect(heldTokenSecret("org-a", "never-created")).toBeNull();
    holdTokenSecret("org-a", "t1", "o2ft_secret", secretsEpoch());
    expect(heldTokenSecret("org-a", "t1")).toBe("o2ft_secret");
  });

  it("never resolves another org's token id", () => {
    holdTokenSecret("org-a", "t1", "o2ft_a", secretsEpoch());
    expect(heldTokenSecret("org-b", "t1")).toBeNull();
    expect(newestHeldToken("org-b", ["t1"])).toBeNull();
  });

  it("picks the most recently held token of the org among the given ids", () => {
    holdTokenSecret("org-a", "n1", "a", secretsEpoch());
    holdTokenSecret("org-a", "n2", "b", secretsEpoch());
    holdTokenSecret("org-b", "n3", "c", secretsEpoch());
    expect(newestHeldToken("org-a", ["n1", "n2", "n3"])).toBe("n2");
    expect(newestHeldToken("org-a", ["n1", "x"])).toBe("n1");
    expect(newestHeldToken("org-a", ["x"])).toBeNull();
  });

  it("forgets every plaintext when the selected org changes", async () => {
    holdTokenSecret("org-a", "t1", "o2ft_a", secretsEpoch());
    purgeOrgQueries("org-a", "org-b");
    await vi.waitFor(() => expect(heldTokenSecret("org-a", "t1")).toBeNull());
  });

  it("forgets every plaintext on logout", async () => {
    holdTokenSecret("org-a", "t1", "o2ft_a", secretsEpoch());
    purgeAllQueries();
    await vi.waitFor(() => expect(heldTokenSecret("org-a", "t1")).toBeNull());
  });

  it("refuses a plaintext from a request that started before a clear", () => {
    const epoch = secretsEpoch();
    clearHeldTokenSecrets();
    expect(holdTokenSecret("org-a", "t1", "o2ft_late", epoch)).toBe(false);
    expect(heldTokenSecret("org-a", "t1")).toBeNull();
  });

  it("holds a plaintext when nothing was cleared since the request started", () => {
    const epoch = secretsEpoch();
    expect(holdTokenSecret("org-a", "t1", "o2ft_ok", epoch)).toBe(true);
    expect(heldTokenSecret("org-a", "t1")).toBe("o2ft_ok");
  });

  it("is cleared synchronously by the purges, with no window for a late hold", () => {
    holdTokenSecret("org-a", "t1", "o2ft_a", secretsEpoch());
    const epoch = secretsEpoch();
    purgeAllQueries();
    expect(heldTokenSecret("org-a", "t1")).toBeNull();
    expect(holdTokenSecret("org-a", "t2", "o2ft_late", epoch)).toBe(false);
    const again = secretsEpoch();
    purgeOrgQueries("org-a", "org-b");
    expect(secretsEpoch()).toBeGreaterThan(again);
  });
});
