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

const mockToast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...a: unknown[]) => mockToast(...a) }));

import { createScopedList } from "./scopedList";
import { raw } from "@/types/i18n";

type Item = { id: string; app: string; name: string };
type Rows = { data: { list: unknown[] } };

const parse = (r: unknown, app: string): Item | null => {
  const row = r as Partial<Item> | null;
  return row && typeof row.id === "string" && row.app === app && typeof row.name === "string"
    ? { id: row.id, app, name: row.name }
    : null;
};
const rows = (app: string, ...names: string[]): Rows => ({
  data: { list: names.map((name, i) => ({ id: `${app}${i}`, app, name })) },
});
const failure = (status: number) => ({ response: { status, data: { code: "x", message: "x" } } });

describe("createScopedList (F55)", () => {
  let list: ReturnType<typeof createScopedList<Item>>;
  let fetchList: ReturnType<typeof vi.fn<(org: string, app: string) => Promise<Rows>>>;

  beforeEach(() => {
    mockToast.mockClear();
    fetchList = vi.fn(async (_org: string, app: string) => rows(app, "b", "a"));
    list = createScopedList<Item>({
      list: fetchList,
      parse,
      loadFailed: () => raw("Loading failed"),
    });
  });

  const hold = (result: () => Rows) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fetchList.mockImplementationOnce(async () => {
      await gate;
      return result();
    });
    return () => release();
  };

  it("loads once per app, sorted by name, and joins a load already in flight", async () => {
    const release = hold(() => rows("web", "b", "a"));
    const first = list.load("org", "web");
    const joined = list.load("org", "web");
    expect(list.status("org", "web")).toBe("loading");
    expect(list.loading.value).toBe(true);
    release();
    expect(await first).toBe(true);
    expect(await joined).toBe(true);
    expect(await list.load("org", "web")).toBe(true);
    expect(fetchList).toHaveBeenCalledTimes(1);
    expect(list.items.value.map((i) => i.name)).toEqual(["a", "b"]);
    expect(list.loading.value).toBe(false);
    expect(list.status("org", "web")).toBe("ready");
    expect(await list.load("org", "")).toBe(false);
  });

  it("loadedAt is the time rows were last read, kept by a cached load and cleared by a failed switch (F7)", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      expect(list.loadedAt.value).toBeNull();
      await list.load("org", "web");
      expect(list.loadedAt.value).toBe(1000);
      now.mockReturnValue(2000);
      await list.ensure("org", "web");
      expect(list.loadedAt.value).toBe(1000);
      await list.load("org", "web", true);
      expect(list.loadedAt.value).toBe(2000);
      fetchList.mockRejectedValueOnce(failure(500));
      await list.load("org", "shop", false, true);
      expect(list.loadedAt.value).toBeNull();
    } finally {
      now.mockRestore();
    }
  });

  it("counts rows the parser rejects", async () => {
    fetchList.mockResolvedValueOnce({
      data: { list: [{ id: "1", app: "web", name: "ok" }, { id: "2", app: "shop", name: "x" }, 7] },
    });
    await list.load("org", "web");
    expect(list.items.value.map((i) => i.name)).toEqual(["ok"]);
    expect(list.invalidCount.value).toBe(2);
  });

  it("a load superseded by another app's never lands or marks its own app failed", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fetchList.mockImplementationOnce(async () => {
      await gate;
      throw failure(503);
    });
    const a = list.load("org", "a");
    await list.load("org", "b");
    release();
    expect(await a).toBe(false);
    expect(list.status("org", "a")).toBe("loading");
    expect(list.status("org", "b")).toBe("ready");
    expect(list.items.value.map((i) => i.app)).toEqual(["b", "b"]);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("a failure toasts once, reads failed until a retry, and ensure retries only when asked", async () => {
    fetchList.mockRejectedValueOnce(failure(503));
    expect(await list.ensure("org", "web")).toBe("failed");
    expect(mockToast).toHaveBeenCalledWith({ variant: "error", message: "Loading failed" });
    expect(await list.ensure("org", "web")).toBe("failed");
    expect(fetchList).toHaveBeenCalledTimes(1);
    expect(await list.ensure("org", "web", true)).toBe("ready");
    fetchList.mockRejectedValueOnce(failure(500));
    expect(await list.load("org", "web", true)).toBe(false);
    expect(list.status("org", "web")).toBe("failed");
    expect(list.items.value).toHaveLength(2);
  });

  it("a quiet retry of a failed load reads failed again without a second toast; an asked retry toasts (F62)", async () => {
    fetchList.mockRejectedValueOnce(failure(503));
    expect(await list.ensure("org", "web")).toBe("failed");
    expect(mockToast).toHaveBeenCalledTimes(1);
    fetchList.mockRejectedValueOnce(failure(503));
    expect(await list.ensure("org", "web", true, true)).toBe("failed");
    expect(fetchList).toHaveBeenCalledTimes(2);
    expect(mockToast).toHaveBeenCalledTimes(1);
    fetchList.mockRejectedValueOnce(failure(503));
    expect(await list.ensure("org", "web", true)).toBe("failed");
    expect(mockToast).toHaveBeenCalledTimes(2);
  });

  it("a failed switch to another app drops the previous app's rows and unreadable count", async () => {
    fetchList.mockResolvedValueOnce({ data: { list: [{ id: "1", app: "a", name: "x" }, 1] } });
    await list.load("org", "a");
    expect(list.invalidCount.value).toBe(1);
    fetchList.mockRejectedValueOnce(failure(503));
    await list.load("org", "b");
    expect(list.items.value).toEqual([]);
    expect(list.invalidCount.value).toBe(0);
  });

  it("a 403 is forbidden with no rows and no unreadable count; the next readable load is ready with write", async () => {
    fetchList.mockResolvedValueOnce({ data: { list: [{ id: "1", app: "web", name: "x" }, 1] } });
    await list.load("org", "web");
    list.permission.value = "read";
    fetchList.mockRejectedValueOnce(failure(403));
    expect(await list.load("org", "web", true)).toBe(true);
    expect(list.status("org", "web")).toBe("forbidden");
    expect(list.permission.value).toBe("none");
    expect(list.items.value).toEqual([]);
    expect(list.invalidCount.value).toBe(0);
    expect(mockToast).not.toHaveBeenCalled();
    await list.load("org", "web", true);
    expect(list.status("org", "web")).toBe("ready");
    expect(list.permission.value).toBe("write");
  });

  it("reset forgets everything, and a load in flight across it lands nowhere", async () => {
    const release = hold(() => rows("web", "late"));
    const pending = list.load("org", "web");
    list.reset();
    release();
    expect(await pending).toBe(false);
    expect(list.items.value).toEqual([]);
    expect(list.status("org", "web")).toBe("loading");
    expect(list.loading.value).toBe(false);
  });

  it("a write refusal in one org and app leaves another target writable, and returning restores it", async () => {
    await list.load("orgA", "web");
    list.permission.value = "read";
    await list.load("orgB", "web");
    expect(list.permission.value).toBe("write");
    await list.load("orgA", "mobile");
    expect(list.permission.value).toBe("write");
    await list.load("orgA", "web");
    expect(list.permission.value).toBe("read");
  });

  it("a list 403 in one org does not hide another org's list", async () => {
    fetchList.mockRejectedValueOnce(failure(403));
    await list.load("orgA", "web");
    expect(list.status("orgA", "web")).toBe("forbidden");
    await list.load("orgB", "web");
    expect(list.status("orgB", "web")).toBe("ready");
    expect(list.permission.value).toBe("write");
  });

  it("deny marks only the named target read-only, whichever target is on screen", async () => {
    await list.load("orgA", "web");
    await list.load("orgB", "web");
    list.deny("orgA", "web");
    expect(list.permission.value).toBe("write");
    await list.load("orgA", "web");
    expect(list.permission.value).toBe("read");
  });
});
