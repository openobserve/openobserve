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

import { onBeforeUnmount, onMounted, ref } from "vue";
import { toggleFullscreen } from "@/utils/dom";

/**
 * Fullscreen state for a page/drawer with several independently-expandable
 * content boxes, sharing ONE `fullscreenEl` ref rather than one boolean per
 * box — the Fullscreen API only ever has a single fullscreen element at a
 * time, so a per-box boolean could desync from reality (two boxes reading
 * "fullscreen" at once, or none, after an Escape-key exit browsers fire
 * outside any click handler).
 *
 *   const { fullscreenEl, toggle } = useFullscreenBox();
 *   <div ref="inputBox" :class="fullscreenEl === inputBox && '...'">
 *     <button @click="toggle(inputBox)">
 */
export function useFullscreenBox() {
  const fullscreenEl = ref<Element | null>(null);

  function sync() {
    fullscreenEl.value = document.fullscreenElement;
  }

  function toggle(element: Element | null) {
    if (!element) return;
    void toggleFullscreen(element as HTMLElement).catch(() => {
      // Fullscreen can be denied by the browser (permissions policy, an
      // exhausted user-gesture requirement) — sync() below already covers the
      // failure by leaving fullscreenEl at whatever the browser actually did.
    });
  }

  onMounted(() => document.addEventListener("fullscreenchange", sync));
  onBeforeUnmount(() => document.removeEventListener("fullscreenchange", sync));

  return { fullscreenEl, toggle };
}
