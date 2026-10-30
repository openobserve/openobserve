// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { beforeEach, describe, expect, it, vi } from "vitest";

const getIdentityConfigMock = vi.fn();
vi.mock("@/services/service_streams", () => ({
  default: { getIdentityConfig: (org: string) => getIdentityConfigMock(org) },
}));

import { clearAllIdentityConfigCache, loadIdentityConfig } from "./identityConfig";
import { queryClient } from "@/composables/query/queryClient";
import { serviceStreamKeys } from "@/services/service_streams.querykeys";

describe("identityConfig — the fresh-hit fast path", () => {
  const config = { sets: [], tracked_alias_ids: ["service"] };

  beforeEach(() => {
    clearAllIdentityConfigCache();
    getIdentityConfigMock.mockReset();
    getIdentityConfigMock.mockResolvedValue({ data: config });
  });

  it("serves a fresh entry without a request", async () => {
    await loadIdentityConfig("org-a");
    const second = await loadIdentityConfig("org-a");
    expect(second).toEqual(config);
    expect(getIdentityConfigMock).toHaveBeenCalledTimes(1);
  });

  // A config save invalidates rather than removes, so a fresh-by-age entry must still be re-read.
  it("re-reads an invalidated entry however young it is", async () => {
    await loadIdentityConfig("org-b");
    await queryClient.invalidateQueries({
      queryKey: serviceStreamKeys.all("org-b"),
      refetchType: "none",
    });
    await loadIdentityConfig("org-b");
    expect(getIdentityConfigMock).toHaveBeenCalledTimes(2);
  });
});
