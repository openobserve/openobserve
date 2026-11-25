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

import type { PackInstallRecord } from "./types";

const kv = vi.hoisted(() => ({ value: "" }));
vi.mock("@tanstack/vue-query", () => ({ useMutation: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("@/services/kv.queries", () => ({
  kvValueQuery: () => ({}),
  kvKeysQuery: () => ({}),
  setKvMutation: vi.fn(),
  deleteKvMutation: vi.fn(),
}));
vi.mock("@/composables/query/readQuery", () => ({ readQuery: async () => kv.value }));

import { isRunning, useInstallRecords } from "./useInstallRecords";

const MINUTE_US = 60 * 1_000_000;
const NOW = 1_900_000_000_000_000;
const installing = (stamps: Record<string, unknown>) =>
  ({
    packId: "kubernetes",
    installId: "i1",
    status: "installing",
    items: [],
    ...stamps,
  }) as PackInstallRecord;

const stored = async (stamps: Record<string, unknown>) => {
  kv.value = JSON.stringify(installing(stamps));
  return (await useInstallRecords("org").read("kubernetes", "i1"))!;
};

describe("isRunning", () => {
  it.each(["updatedAt", "installedAt"])(
    "allows %s a small clock skew ahead, and no more",
    (key) => {
      expect(isRunning(installing({ [key]: NOW + 4 * MINUTE_US }), NOW)).toBe(true);
      expect(isRunning(installing({ [key]: NOW + 10 * MINUTE_US }), NOW)).toBe(false);
    },
  );

  it("reads a quiet or unstamped run as stopped", () => {
    expect(isRunning(installing({ updatedAt: NOW - MINUTE_US }), NOW)).toBe(true);
    expect(isRunning(installing({ updatedAt: NOW - 10 * MINUTE_US }), NOW)).toBe(false);
    expect(isRunning(installing({}), NOW)).toBe(false);
  });
});

describe("a stored record's stamps", () => {
  it.each([["soon"], [null], [{}], [[]], [true]])(
    "drops %j, so it can neither lock nor sort a pack",
    async (stamp) => {
      const record = await stored({ updatedAt: stamp, installedAt: stamp });
      expect(record.updatedAt).toBeUndefined();
      expect(record.installedAt).toBeUndefined();
      expect(isRunning(record, NOW)).toBe(false);
    },
  );

  it("keeps numeric stamps", async () => {
    const record = await stored({ updatedAt: NOW, installedAt: NOW - 1 });
    expect(record).toMatchObject({ updatedAt: NOW, installedAt: NOW - 1 });
  });

  it("falls back to the start time when only the last write is not a number", async () => {
    const record = await stored({ updatedAt: "later", installedAt: NOW });
    expect(isRunning(record, NOW)).toBe(true);
  });
});
