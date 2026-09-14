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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hashKey, queryOptions } from "@tanstack/vue-query";
import {
  dropPersistedCopies,
  localPersister,
  localStoragePersister,
  LS_BUSTER,
  LS_PREFIX,
} from "./persisters";
import { queryClient } from "./queryClient";
import { orgKey } from "./keys";

const storageKey = (key: readonly unknown[]) => `${LS_PREFIX}-${hashKey(key)}`;

// Exactly what the persister writes after a successful fetch, so a cold read restores it.
const seed = (key: readonly unknown[], data: unknown) => {
  window.localStorage.setItem(
    storageKey(key),
    JSON.stringify({
      queryKey: key,
      queryHash: hashKey(key),
      buster: LS_BUSTER,
      state: { data, dataUpdatedAt: Date.now(), errorUpdatedAt: 0 },
    }),
  );
};

const persisted = (key: readonly unknown[]) =>
  window.localStorage.getItem(storageKey(key)) !== null;

// The macrotask the persister schedules its disk write on.
const flushPersist = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("dropPersistedCopies", () => {
  beforeEach(() => {
    queryClient.clear();
    window.localStorage.clear();
  });

  it("removes every entry under a prefix and nothing beside it", async () => {
    seed(orgKey("acme", "streams", "nameList", "logs"), ["a"]);
    seed(orgKey("acme", "streams", "nameList", "metrics"), ["b"]);
    seed(orgKey("acme", "streamsX", "nameList", "logs"), ["c"]);
    seed(orgKey("other", "streams", "nameList", "logs"), ["d"]);
    window.localStorage.setItem("theme", "dark");

    await dropPersistedCopies(orgKey("acme", "streams"));

    expect(persisted(orgKey("acme", "streams", "nameList", "logs"))).toBe(false);
    expect(persisted(orgKey("acme", "streams", "nameList", "metrics"))).toBe(false);
    expect(persisted(orgKey("acme", "streamsX", "nameList", "logs"))).toBe(true);
    expect(persisted(orgKey("other", "streams", "nameList", "logs"))).toBe(true);
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });

  it("removes only the one entry when exact", async () => {
    seed(orgKey("acme", "streams", "nameList", "logs"), ["a"]);
    seed(orgKey("acme", "streams", "nameList", "metrics"), ["b"]);

    await dropPersistedCopies(orgKey("acme", "streams", "nameList", "logs"), true);

    expect(persisted(orgKey("acme", "streams", "nameList", "logs"))).toBe(false);
    expect(persisted(orgKey("acme", "streams", "nameList", "metrics"))).toBe(true);
  });

  it("removes nothing for an empty key", async () => {
    seed(orgKey("acme", "streams", "nameList", "logs"), ["a"]);

    await dropPersistedCopies([]);

    expect(persisted(orgKey("acme", "streams", "nameList", "logs"))).toBe(true);
  });

  it("does not throw when the persister rejects", async () => {
    seed(orgKey("acme", "streams", "nameList", "logs"), ["a"]);
    // The storage wrapper already swallows its own errors, so the helper's catch is reached only through the persister.
    const spy = vi.spyOn(localPersister, "removeQueries").mockRejectedValue(new Error("blocked"));
    try {
      await expect(dropPersistedCopies(orgKey("acme", "streams"))).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("a write drops the persisted copies it invalidates", () => {
  const key = orgKey("acme", "streams", "nameList", "logs");
  let queryFn: ReturnType<typeof vi.fn>;
  const options = () =>
    queryOptions({
      queryKey: key,
      queryFn,
      staleTime: 5 * 60_000,
      persister: localStoragePersister,
    });

  const runMutation = (meta: Record<string, unknown>, mutationFn = async () => "ok") =>
    queryClient.getMutationCache().build(queryClient, { mutationFn, meta }).execute(undefined);

  beforeEach(() => {
    queryClient.clear();
    window.localStorage.clear();
    queryFn = vi.fn(async () => ["fresh"]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("W1: after a reload the list is fetched, not restored from disk", async () => {
    // A real fetch persists the list, as the alert form's first read does.
    await queryClient.fetchQuery(options());
    await flushPersist();
    expect(persisted(key)).toBe(true);

    // Creating a stream invalidates the whole scope, with nobody watching the list.
    await runMutation({ invalidates: [orgKey("acme", "streams")] });
    expect(persisted(key)).toBe(false);

    // Ctrl+Shift+R: memory is gone; the read must reach the server.
    queryClient.clear();
    await queryClient.fetchQuery(options());
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("deletes the disk copy before invalidating memory", async () => {
    seed(key, ["stale"]);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    let onDiskWhenInvalidated: boolean | null = null;
    invalidate.mockImplementation(async () => {
      onDiskWhenInvalidated = persisted(key);
    });

    await runMutation({ invalidates: [orgKey("acme", "streams")] });

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(onDiskWhenInvalidated).toBe(false);
  });

  it("keeps the disk copy when the write fails", async () => {
    seed(key, ["stale"]);

    await expect(
      runMutation({ invalidates: [orgKey("acme", "streams")] }, async () => {
        throw new Error("500");
      }),
    ).rejects.toThrow("500");

    expect(persisted(key)).toBe(true);
  });

  it("never fails the write because of storage", async () => {
    seed(key, ["stale"]);
    const spy = vi.spyOn(localPersister, "removeQueries").mockRejectedValue(new Error("blocked"));
    try {
      await expect(runMutation({ invalidates: [orgKey("acme", "streams")] })).resolves.toBe("ok");
    } finally {
      spy.mockRestore();
    }
  });

  it("`removes` scopes drop their disk copies too", async () => {
    seed(key, ["stale"]);

    await runMutation({ removes: [orgKey("acme", "streams")] });

    expect(persisted(key)).toBe(false);
  });
});
