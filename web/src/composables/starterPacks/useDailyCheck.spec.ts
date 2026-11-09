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

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

import { queryClient } from "@/composables/query/queryClient";
import store from "@/test/unit/helpers/store";

const fake = vi.hoisted(() => {
  const kv = new Map<string, string>();
  const httpError = (status: number) => Object.assign(new Error("http"), { response: { status } });
  const request = async (method: string, url: string, body?: unknown) => {
    const match = url.match(/\/kv\/(.+)$/);
    if (!match) throw new Error(`unrouted ${method} ${url}`);
    const key = decodeURIComponent(match[1]);
    if (method === "post") kv.set(key, body as string);
    if (method === "delete") kv.delete(key);
    if (method === "get" && !kv.has(key)) throw httpError(404);
    return { status: 200, data: method === "get" ? kv.get(key) : "OK" };
  };
  const client = {
    get: (url: string) => request("get", url),
    post: (url: string, body: unknown) => request("post", url, body),
    put: (url: string, body: unknown) => request("put", url, body),
    delete: (url: string) => request("delete", url),
  };
  const check = vi.fn(async () => ({
    checkedAt: Date.now() * 1000,
    sources: [{ id: "nginx", label: "nginx", streams: [], items: [], queriesPerDay: 0 }],
    dismissed: 0,
  }));
  return { kv, client, check };
});

vi.mock("@/services/http", () => ({ default: () => fake.client }));
vi.mock("./useFindMore", async () => {
  const actual = await vi.importActual<typeof import("./useFindMore")>("./useFindMore");
  return {
    ...actual,
    useFindMoreCheck: (org: string) => ({ ...actual.useFindMoreCheck(org), check: fake.check }),
  };
});

import { DAILY_ON_KEY, LAST_CHECK_KEY } from "./findMore";
import { DAILY_CHECK_US, useDailyCheck } from "./useDailyCheck";

// Each user is a fresh browser: its own query cache, the org's KV store shared.
const openAppAs = () => {
  queryClient.clear();
  let api!: ReturnType<typeof useDailyCheck>;
  mount(
    defineComponent({
      setup() {
        api = useDailyCheck("org");
        return () => null;
      },
    }),
    { global: { plugins: [store] } },
  );
  return api;
};

describe("useDailyCheck", () => {
  beforeEach(() => {
    fake.kv.clear();
    fake.check.mockClear();
  });

  it("is off by default and checks nothing", async () => {
    expect(await openAppAs().runIfDue()).toBe(false);
    expect(fake.check).not.toHaveBeenCalled();
    expect(fake.kv.has(LAST_CHECK_KEY)).toBe(false);
  });

  it("runs once a day across two users of the org", async () => {
    await openAppAs().setEnabled(true);
    expect(await openAppAs().runIfDue()).toBe(true);
    const second = openAppAs();
    expect(await second.runIfDue()).toBe(false);
    expect(fake.check).toHaveBeenCalledTimes(1);
    expect(second.last.value?.sources).toHaveLength(1);
  });

  it("skips a second user who opens the app while the first check runs", async () => {
    await openAppAs().setEnabled(true);
    let release!: () => void;
    fake.check.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ checkedAt: Date.now() * 1000, sources: [], dismissed: 0 });
        }),
    );
    const first = openAppAs().runIfDue();
    await vi.waitFor(() => expect(fake.check).toHaveBeenCalledTimes(1));
    const claim = JSON.parse(fake.kv.get(LAST_CHECK_KEY)!);
    expect(Date.now() * 1000 - claim.checkedAt).toBeLessThan(DAILY_CHECK_US);
    expect(await openAppAs().runIfDue()).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(fake.check).toHaveBeenCalledTimes(1);
  });

  it("runs again once the last check is a day old", async () => {
    fake.kv.set(DAILY_ON_KEY, "1");
    const old = { checkedAt: Date.now() * 1000 - DAILY_CHECK_US - 1, sources: [], dismissed: 0 };
    fake.kv.set(LAST_CHECK_KEY, JSON.stringify(old));
    expect(await openAppAs().runIfDue()).toBe(true);
    expect(fake.check).toHaveBeenCalledTimes(1);
  });

  it("releases the claim when the check fails, so the next app open retries", async () => {
    fake.kv.set(DAILY_ON_KEY, "1");
    const old = { checkedAt: Date.now() * 1000 - DAILY_CHECK_US - 1, sources: [], dismissed: 0 };
    fake.kv.set(LAST_CHECK_KEY, JSON.stringify(old));
    fake.check.mockRejectedValueOnce(new Error("manifest down"));
    expect(await openAppAs().runIfDue()).toBe(false);
    expect(JSON.parse(fake.kv.get(LAST_CHECK_KEY)!).checkedAt).toBe(old.checkedAt);
    expect(await openAppAs().runIfDue()).toBe(true);
  });

  it("removes a first claim whose check failed", async () => {
    fake.kv.set(DAILY_ON_KEY, "1");
    fake.check.mockRejectedValueOnce(new Error("down"));
    expect(await openAppAs().runIfDue()).toBe(false);
    expect(fake.kv.has(LAST_CHECK_KEY)).toBe(false);
  });

  it("stops after turning off", async () => {
    const admin = openAppAs();
    await admin.setEnabled(true);
    await admin.setEnabled(false);
    expect(fake.kv.has(DAILY_ON_KEY)).toBe(false);
    expect(await openAppAs().runIfDue()).toBe(false);
  });
});
