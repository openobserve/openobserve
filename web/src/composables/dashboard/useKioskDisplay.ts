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

import { getCurrentInstance, onBeforeUnmount, ref, watch, type Ref } from "vue";
import type { Store } from "vuex";
import { switchThemeMode } from "@/utils/theme";
import type { KioskTheme } from "@/utils/dashboard/kiosk";

const IDLE_EVENTS = ["mousemove", "pointerdown", "touchstart", "keydown"] as const;

const readSavedTheme = (): KioskTheme => {
  try {
    return localStorage.getItem("theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
};

const applyMode = (store: Store<any>, mode: KioskTheme) => {
  switchThemeMode(mode, () => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    store.dispatch("appTheme", mode);
  });
};

/** Forces a theme for this screen only; the override flag stops ThemeSwitcher from persisting it. */
export const applyKioskTheme = (store: Store<any>, theme: KioskTheme | null) => {
  if (!theme) {
    clearKioskTheme(store);
    return;
  }
  store.commit("setThemeOverride", theme);
  applyMode(store, theme);
};

export const clearKioskTheme = (store: Store<any>) => {
  if (!store.state.themeOverride) return;
  store.commit("setThemeOverride", null);
  applyMode(store, readSavedTheme());
};

/** True for `timeoutMs` after any pointer or key activity while `enabled`; hides the idle cursor on a wall screen. */
export const useIdleReveal = (enabled: Ref<boolean>, timeoutMs = 3000) => {
  const active = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const poke = () => {
    active.value = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      active.value = false;
    }, timeoutMs);
  };

  let lastX: number | null = null;
  let lastY: number | null = null;
  // Chrome fires synthetic mousemoves at a still cursor whenever the layout under it changes (panels loading).
  const onActivity = (event: Event) => {
    if (event.type === "mousemove" && event instanceof MouseEvent) {
      const moved = event.clientX !== lastX || event.clientY !== lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      if (!moved) return;
    }
    poke();
  };

  const detach = () => {
    IDLE_EVENTS.forEach((event) => window.removeEventListener(event, onActivity));
    if (timer) clearTimeout(timer);
    timer = null;
    active.value = false;
  };

  watch(
    enabled,
    (on) => {
      detach();
      if (!on) return;
      IDLE_EVENTS.forEach((event) => window.addEventListener(event, onActivity, { passive: true }));
      poke();
    },
    { immediate: true },
  );

  if (getCurrentInstance()) onBeforeUnmount(detach);

  return { active, poke, stop: detach };
};
