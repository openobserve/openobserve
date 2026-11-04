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

import { computed, onBeforeUnmount, ref, watchEffect } from "vue";

const NEVER_KEY = "o2_flame_zoom_hint_hidden";
const CLOSED_KEY = "o2_flame_zoom_hint_closed";

// Bumped on every close so each mounted graph re-reads storage and drops its hint at once.
const closedTick = ref(0);
// Used only when storage cannot be written, so the hint stays closed until the page reloads.
const closedInMemory = ref(false);
// One graph holds the hint at a time, so the two graphs of Sandwich view do not show it twice.
const owner = ref<symbol | null>(null);

const readFlag = (storage: () => Storage, key: string) => {
  try {
    return storage().getItem(key) === "1";
  } catch {
    return false;
  }
};

const writeFlag = (storage: () => Storage, key: string) => {
  try {
    storage().setItem(key, "1");
    return true;
  } catch {
    return false;
  }
};

// The hint is about a mouse wheel; a device without hover has none.
const isTouchOnly = () =>
  typeof window.matchMedia === "function" && !!window.matchMedia("(hover: none)")?.matches;

export const useFlameZoomHint = (enabled: () => boolean) => {
  const id = Symbol("flame-zoom-hint");
  const touchOnly = isTouchOnly();
  const hidden = computed(() => {
    void closedTick.value;
    return (
      closedInMemory.value ||
      readFlag(() => localStorage, NEVER_KEY) ||
      readFlag(() => sessionStorage, CLOSED_KEY)
    );
  });
  const wanted = computed(() => enabled() && !touchOnly && !hidden.value);

  watchEffect(() => {
    if (wanted.value && !owner.value) owner.value = id;
    else if (!wanted.value && owner.value === id) owner.value = null;
  });
  onBeforeUnmount(() => {
    if (owner.value === id) owner.value = null;
  });

  const show = computed(() => wanted.value && owner.value === id);
  const hide = (forever: boolean) => {
    const stored = writeFlag(() => sessionStorage, CLOSED_KEY);
    if (forever) writeFlag(() => localStorage, NEVER_KEY);
    if (!stored) closedInMemory.value = true;
    closedTick.value += 1;
  };

  return { showZoomHint: show, hideZoomHint: hide };
};
