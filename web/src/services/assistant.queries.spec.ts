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

import { describe, expect, it, vi } from "vitest";

import { SESSION_STALE_TIME } from "@/composables/query/cachePolicy";

import assistant from "./assistant";
import { capabilitiesQuery } from "./assistant.queries";
import { assistantKeys } from "./assistant.querykeys";

vi.mock("./assistant", () => ({ default: { capabilities: vi.fn().mockResolvedValue(null) } }));

describe("capabilitiesQuery", () => {
  it("sits on the session tier, refetches on focus and never retries", () => {
    const options = capabilitiesQuery("org1");
    expect(options.queryKey).toEqual(assistantKeys.capabilities("org1"));
    expect(options.staleTime).toBe(SESSION_STALE_TIME);
    expect(options.refetchOnWindowFocus).toBe(true);
    expect(options.retry).toBe(false);
    expect(options.enabled).toBe(true);
  });

  it("is disabled on an unentitled or unconfigured build and without an org", () => {
    expect(capabilitiesQuery("org1", false).enabled).toBe(false);
    expect(capabilitiesQuery("").enabled).toBe(false);
  });

  it("reads through the service", async () => {
    const queryFn = capabilitiesQuery("org1").queryFn as () => Promise<unknown>;
    await expect(queryFn()).resolves.toBeNull();
    expect(assistant.capabilities).toHaveBeenCalledWith("org1");
  });
});

describe("assistantKeys", () => {
  it("roots every key at the org so the org purge and logout sweep them", () => {
    const keys = [
      assistantKeys.all("o"),
      assistantKeys.chats("o"),
      assistantKeys.chat("o", "s"),
      assistantKeys.capabilities("o"),
      assistantKeys.usage("o"),
      assistantKeys.settings("o"),
    ];
    for (const key of keys) expect(key.slice(0, 3)).toEqual(["org", "o", "assistant"]);
    expect(new Set(keys.map((k) => JSON.stringify(k))).size).toBe(keys.length);
  });
});
