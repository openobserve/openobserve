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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";

import store from "@/test/unit/helpers/store";

vi.unmock("@/composables/useCan");

const { checkMock } = vi.hoisted(() => ({ checkMock: vi.fn() }));
vi.mock("@/services/authz", () => ({
  AUTHZ_CHECK_MAX_ITEMS: 500,
  default: { check: checkMock },
}));
vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();
  return { default: { ...actual.default, isEnterprise: "true", isCloud: "false" } };
});

import {
  AUTHZ_CACHE_TTL_MS,
  flushCanQueue,
  resetCanCache,
  skippedNamesText,
  splitByPermission,
  useCan,
  type UseCan,
} from "./useCan";

function host(): { perms: UseCan; unmount: () => void } {
  let perms!: UseCan;
  const Host = defineComponent({
    setup() {
      perms = useCan();
      return () => h("div");
    },
  });
  const wrapper = mount(Host, { global: { plugins: [store] } });
  return { perms, unmount: () => wrapper.unmount() };
}

function respond(enforced: boolean, allowed: (boolean | null)[]) {
  checkMock.mockResolvedValueOnce({
    data: { enforced, results: allowed.map((a) => ({ allowed: a })) },
  });
}

async function settle(): Promise<void> {
  await flushCanQueue();
  await flushPromises();
}

describe("useCan", () => {
  beforeEach(() => {
    resetCanCache();
    sessionStorage.clear();
    checkMock.mockReset();
    store.state.selectedOrganization = { identifier: "org1" } as any;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hides a gated control while its answer is pending", () => {
    const { perms, unmount } = host();
    expect(perms.status("dashboard", "d1", "edit", "f1")).toBe("pending");
    expect(perms.can("dashboard", "d1", "edit", "f1")).toBe(false);
    expect(perms.ready.value).toBe(false);
    unmount();
  });

  it("batches every check asked in one tick into a single request", async () => {
    const { perms, unmount } = host();
    respond(true, [true, false, true]);

    perms.status("dashboard", "d1", "edit", "f1");
    perms.status("dashboard", "d1", "delete", "f1");
    perms.status("stream", "logs1", "delete", undefined, "logs");
    perms.status("dashboard", "d1", "edit", "f1");
    await settle();

    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(checkMock).toHaveBeenCalledWith("org1", [
      { resource: "dashboard", id: "d1", action: "edit", folder: "f1" },
      { resource: "dashboard", id: "d1", action: "delete", folder: "f1" },
      { resource: "stream", id: "logs1", action: "delete", stream_type: "logs" },
    ]);
    expect(perms.can("dashboard", "d1", "edit", "f1")).toBe(true);
    expect(perms.can("dashboard", "d1", "delete", "f1")).toBe(false);
    expect(perms.can("stream", "logs1", "delete", undefined, "logs")).toBe(true);
    expect(perms.enforced.value).toBe(true);
    unmount();
  });

  it("answers from cache, then revalidates in the background once the entry is stale", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { perms, unmount } = host();
    respond(true, [false]);
    perms.status("alert", "a1", "delete", "default");
    await settle();

    expect(perms.status("alert", "a1", "delete", "default")).toBe("denied");
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + AUTHZ_CACHE_TTL_MS + 1);
    respond(true, [true]);
    expect(perms.status("alert", "a1", "delete", "default")).toBe("denied");
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(2);
    expect(perms.status("alert", "a1", "delete", "default")).toBe("allowed");
    unmount();
  });

  it("stops asking once the org is known not to enforce, and remembers it for the session", async () => {
    const { perms, unmount } = host();
    respond(false, [true]);
    perms.status("pipeline", "p1", "edit");
    await settle();

    expect(perms.status("pipeline", "p2", "delete")).toBe("allowed");
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("o2.authz.enforced.org1")).toBe("0");
    unmount();

    resetCanCache();
    const again = host();
    expect(again.perms.status("function", "fn1", "edit")).toBe("allowed");
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(1);
    again.unmount();
  });

  it("treats an unknown (null) answer as allowed", async () => {
    const { perms, unmount } = host();
    respond(true, [null]);
    perms.status("function", "fn1", "delete");
    await settle();
    expect(perms.status("function", "fn1", "delete")).toBe("allowed");
    unmount();
  });

  it("falls back to allow-all on an older backend without the endpoint", async () => {
    const { perms, unmount } = host();
    checkMock.mockRejectedValueOnce({ response: { status: 404 } });
    perms.status("dashboard", "d1", "delete", "f1");
    await settle();

    expect(perms.status("dashboard", "d1", "delete", "f1")).toBe("allowed");
    expect(perms.enforced.value).toBe(false);
    expect(perms.status("dashboard", "d2", "delete", "f1")).toBe("allowed");
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("shows the control when the check itself fails", async () => {
    const { perms, unmount } = host();
    checkMock.mockRejectedValueOnce({ response: { status: 500 } });
    perms.status("alert", "a1", "edit", "f1");
    await settle();
    expect(perms.status("alert", "a1", "edit", "f1")).toBe("allowed");
    unmount();
  });

  it("latches a control closed after its write is refused", async () => {
    const { perms, unmount } = host();
    respond(false, [true]);
    perms.status("dashboard", "d1", "delete", "f1");
    await settle();
    expect(perms.status("dashboard", "d1", "delete", "f1")).toBe("allowed");

    perms.noteWriteDenied({ response: { status: 403 } }, "dashboard", "d1", "delete", "f1");
    await nextTick();

    expect(perms.status("dashboard", "d1", "delete", "f1")).toBe("denied");
    expect(perms.enforced.value).toBeUndefined();
    expect(sessionStorage.getItem("o2.authz.enforced.org1")).toBeNull();
    unmount();
  });

  it("ignores failures that are not a refusal", async () => {
    const { perms, unmount } = host();
    respond(true, [true]);
    perms.status("dashboard", "d1", "delete", "f1");
    await settle();

    perms.noteWriteDenied({ response: { status: 500 } }, "dashboard", "d1", "delete", "f1");
    expect(perms.status("dashboard", "d1", "delete", "f1")).toBe("allowed");
    unmount();
  });

  it("drops cached answers on org switch", async () => {
    const { perms, unmount } = host();
    respond(true, [false]);
    perms.status("alert", "a1", "delete", "f1");
    await settle();
    expect(perms.status("alert", "a1", "delete", "f1")).toBe("denied");

    store.state.selectedOrganization = { identifier: "org2" } as any;
    await nextTick();
    expect(perms.status("alert", "a1", "delete", "f1")).toBe("pending");
    unmount();
  });
});

describe("splitByPermission", () => {
  it("keeps only the deletable rows and reports the rest as skipped", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
    const deletable = new Set(["b", "d"]);
    const { allowed, skipped } = splitByPermission(rows, (r) => deletable.has(r.id));
    expect(allowed.map((r) => r.id)).toEqual(["b", "d"]);
    expect(skipped.map((r) => r.id)).toEqual(["a", "c", "e"]);
  });

  it("skips nothing when every row is deletable", () => {
    const { allowed, skipped } = splitByPermission([1, 2], () => true);
    expect(allowed).toEqual([1, 2]);
    expect(skipped).toEqual([]);
  });
});

describe("skippedNamesText", () => {
  const t = ((key: string, params: Record<string, unknown>) =>
    `${key}|${JSON.stringify(params)}`) as any;

  it("is empty when nothing is skipped", () => {
    expect(skippedNamesText(t, [])).toBe("");
  });

  it("lists up to five names", () => {
    expect(skippedNamesText(t, ["a", "b"])).toBe('authz.skippedNames|{"names":"a, b"}');
  });

  it("truncates after five names with a count of the rest", () => {
    expect(skippedNamesText(t, ["a", "b", "c", "d", "e", "f", "g"])).toBe(
      'authz.skippedNamesMore|{"names":"a, b, c, d, e","count":2}',
    );
  });
});
