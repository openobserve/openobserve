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
import { effectScope, nextTick, ref } from "vue";
import { createStore } from "vuex";
import { applyKioskTheme, clearKioskTheme, useIdleReveal } from "./useKioskDisplay";

const makeStore = (theme: string) =>
  createStore({
    state: { theme, themeOverride: null as string | null },
    mutations: {
      appTheme(state, payload) {
        state.theme = payload;
      },
      setThemeOverride(state, payload) {
        state.themeOverride = payload;
      },
    },
    actions: {
      appTheme(context, payload) {
        context.commit("appTheme", payload);
      },
    },
  });

describe("kiosk theme override", () => {
  beforeEach(() => {
    localStorage.setItem("theme", "light");
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    localStorage.removeItem("theme");
    document.documentElement.classList.remove("dark");
  });

  it("forces the theme for this screen without touching the saved preference", () => {
    const store = makeStore("light");
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    applyKioskTheme(store, "dark");

    expect(store.state.theme).toBe("dark");
    expect(store.state.themeOverride).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(setItem).not.toHaveBeenCalledWith("theme", expect.anything());
    expect(localStorage.getItem("theme")).toBe("light");
    setItem.mockRestore();
  });

  it("restores the saved preference when the override is cleared", () => {
    const store = makeStore("light");
    applyKioskTheme(store, "dark");

    clearKioskTheme(store);

    expect(store.state.themeOverride).toBeNull();
    expect(store.state.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("leaves the theme alone when nothing was forced", () => {
    const store = makeStore("dark");
    clearKioskTheme(store);
    applyKioskTheme(store, null);
    expect(store.state.theme).toBe("dark");
  });
});

describe("useIdleReveal", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows on entry and on real movement, ignores a still cursor, then hides after the timeout", async () => {
    const enabled = ref(false);
    const scope = effectScope();
    const { active } = scope.run(() => useIdleReveal(enabled, 3000))!;
    expect(active.value).toBe(false);

    enabled.value = true;
    await nextTick();
    expect(active.value).toBe(true);

    vi.advanceTimersByTime(3000);
    expect(active.value).toBe(false);

    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10 }));
    expect(active.value).toBe(true);

    vi.advanceTimersByTime(3000);
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10 }));
    expect(active.value).toBe(false);

    enabled.value = false;
    await nextTick();
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 40, clientY: 40 }));
    expect(active.value).toBe(false);
    scope.stop();
  });
});
