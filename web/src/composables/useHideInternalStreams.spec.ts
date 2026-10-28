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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { createStore, type Store } from "vuex";

type Composable = typeof import("@/composables/useHideInternalStreams");
type Setting = ReturnType<Composable["useHideInternalStreams"]>;

interface ScopeState {
  userInfo: { email: string };
  selectedOrganization: { identifier: string };
}

const KEY = "o2:hideInternalStreams:ana@example.com:org-a";

const makeStore = (email = "ana@example.com", org = "org-a") =>
  createStore<ScopeState>({
    state: { userInfo: { email }, selectedOrganization: { identifier: org } },
  });

// Fresh module state, as after a page refresh.
const loadComposable = async (): Promise<Composable> => {
  vi.resetModules();
  return import("@/composables/useHideInternalStreams");
};

const mounted: { unmount: () => void }[] = [];

const useSetting = (composable: Composable, store: Store<ScopeState>): Setting => {
  let setting!: Setting;
  const Host = defineComponent({
    setup() {
      setting = composable.useHideInternalStreams();
      return () => h("div");
    },
  });
  mounted.push(mount(Host, { global: { plugins: [store] } }));
  return setting;
};

describe("hideInternalStreamsStorageKey", () => {
  it("scopes the key to user and org", async () => {
    const { hideInternalStreamsStorageKey } = await loadComposable();
    expect(hideInternalStreamsStorageKey("ana@example.com", "org-a")).toBe(KEY);
  });

  it("has no key until both the user and the org are known", async () => {
    const { hideInternalStreamsStorageKey } = await loadComposable();
    expect(hideInternalStreamsStorageKey("", "org-a")).toBeNull();
    expect(hideInternalStreamsStorageKey("ana@example.com", undefined)).toBeNull();
  });
});

describe("useHideInternalStreams", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("defaults to off and writes nothing until changed", async () => {
    const setting = useSetting(await loadComposable(), makeStore());
    expect(setting.hideInternalStreams.value).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("persists a change and restores it after a reload", async () => {
    const first = useSetting(await loadComposable(), makeStore());
    first.hideInternalStreams.value = true;
    expect(localStorage.getItem(KEY)).toBe("true");

    const reloaded = useSetting(await loadComposable(), makeStore());
    expect(reloaded.hideInternalStreams.value).toBe(true);
  });

  it("shares one value between every caller on the page", async () => {
    const composable = await loadComposable();
    const store = makeStore();
    const a = useSetting(composable, store);
    const b = useSetting(composable, store);
    a.hideInternalStreams.value = true;
    expect(b.hideInternalStreams.value).toBe(true);
    b.showInternalStreams();
    expect(a.hideInternalStreams.value).toBe(false);
    expect(localStorage.getItem(KEY)).toBe("false");
  });

  it("keeps a separate value per org and re-reads it when the org changes", async () => {
    const store = makeStore();
    const setting = useSetting(await loadComposable(), store);
    setting.hideInternalStreams.value = true;

    store.state.selectedOrganization = { identifier: "org-b" };
    await nextTick();
    expect(setting.hideInternalStreams.value).toBe(false);

    store.state.selectedOrganization = { identifier: "org-a" };
    await nextTick();
    expect(setting.hideInternalStreams.value).toBe(true);
  });

  it("keeps a separate value per user", async () => {
    localStorage.setItem(KEY, "true");
    const other = useSetting(await loadComposable(), makeStore("ben@example.com"));
    expect(other.hideInternalStreams.value).toBe(false);
  });

  it("follows a change written by another tab", async () => {
    const setting = useSetting(await loadComposable(), makeStore());
    localStorage.setItem(KEY, "true");
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    expect(setting.hideInternalStreams.value).toBe(true);

    localStorage.removeItem(KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    expect(setting.hideInternalStreams.value).toBe(false);
  });

  it("falls back to the default when storage cannot be read", async () => {
    localStorage.setItem(KEY, "true");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const setting = useSetting(await loadComposable(), makeStore());
    expect(setting.hideInternalStreams.value).toBe(false);
  });

  it("keeps the change in memory when storage cannot be written", async () => {
    const composable = await loadComposable();
    const setting = useSetting(composable, makeStore());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(() => {
      setting.hideInternalStreams.value = true;
    }).not.toThrow();
    expect(setting.hideInternalStreams.value).toBe(true);
  });
});
