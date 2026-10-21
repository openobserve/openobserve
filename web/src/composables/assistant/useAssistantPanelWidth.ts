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

import { computed, effectScope, ref, watch, type ComputedRef, type EffectScope } from "vue";
import { useStore } from "vuex";

import useBreakpoint from "@/composables/useBreakpoint";

import type { AssistantStoreInternal } from "./assistantStore";
import type { Placement } from "./assistantStore.types";
import { isAssistantV2 } from "./flags";
import { openDockWidthRem } from "./hostAdapter";
import { ensureRuntime, runtimeHandle } from "./runtimeHandle";
import { sidebarWidthFor } from "./sidebarWidth";

/** A transition that never ends (a removed node, a cancelled change) still signals after this long. */
export const RESIZE_SIGNAL_FALLBACK_MS = 400;

const MAIN_SELECTOR = "main[data-test='main-content']";

const SIDEBAR_SELECTOR = "[data-test='assistant-sidebar-host']";

const MAIN_RETRY_FRAMES = 10;

const mainWidth = /* @__PURE__ */ ref(0);

const viewportWidth = /* @__PURE__ */ ref(0);

let viewportTracked = false;

let mainObserver: ResizeObserver | null = null;

let observed: Element | null = null;

let signalScope: EffectScope | null = null;

let pendingSignal = false;

export interface AssistantPanelWidth {
  /** 0 when hidden, floating, a sheet or the full view; floating never squeezes a page. */
  panelWidthRem: ComputedRef<number>;
  mainWidthPx: ComputedRef<number>;
  placement: ComputedRef<Placement["kind"]>;
  floating: ComputedRef<boolean>;
}

/** The width the assistant takes from the page; the legacy flag-derived width while the revamp is off. */
export function useAssistantPanelWidth(): AssistantPanelWidth {
  observeMain();
  const mainWidthPx = computed(() => mainWidth.value);
  if (!isAssistantV2()) return legacyWidth(mainWidthPx);
  const handle = runtimeHandle();
  // A width reader shown before any assistant surface builds the runtime, out of its own chunk.
  if (!handle.value) void ensureRuntime();
  const { lgUp } = useBreakpoint();
  const floating = useSidebarFloating();
  const placement = computed<Placement>(
    () => handle.value?.store.state.shell.placement ?? { kind: "hidden" },
  );
  const panelWidthRem = computed(() => {
    const current = placement.value;
    const store = handle.value?.store;
    if (!lgUp.value || !store) return 0;
    if (current.kind === "docked") return openDockWidthRem();
    if (current.kind !== "sidebar" || floating.value) return 0;
    return sidebarWidthFor(store.state.shell.sidebarWidthRem, viewportRem(), false);
  });
  const width = {
    panelWidthRem,
    mainWidthPx,
    placement: computed(() => placement.value.kind),
    floating,
  };
  watchResizeSignal(width);
  return width;
}

/** The sidebar renders as the floating card: chosen, or forced by a narrow window, unless pinned for this open. */
export function useSidebarFloating(store?: AssistantStoreInternal): ComputedRef<boolean> {
  const handle = runtimeHandle();
  const { lgUp } = useBreakpoint();
  return computed(() => {
    const current = store ?? handle.value?.store;
    if (!current) return false;
    const placement = current.state.shell.placement;
    const mode = placement.kind === "sidebar" ? placement.mode : current.state.shell.sidebarMode;
    const forced = lgUp.value && current.sidebarForcedFloating.value;
    const pinned = placement.kind === "sidebar" && current.sidebarForcedPinned.value;
    return (mode === "floating" || forced) && !pinned;
  });
}

/** Fires one window `resize` after the layout settled: on the column's `transitionend`, else the next frame. */
export function scheduleResizeSignal(column?: Element | null): void {
  if (pendingSignal || typeof window === "undefined") return;
  pendingSignal = true;
  const fire = () => {
    if (!pendingSignal) return;
    pendingSignal = false;
    window.dispatchEvent(new Event("resize"));
  };
  const el = column ?? document.querySelector(SIDEBAR_SELECTOR);
  if (!(el instanceof HTMLElement) || !el.offsetWidth || !transitions(el)) {
    requestAnimationFrame(() => requestAnimationFrame(fire));
    return;
  }
  const timer = setTimeout(fire, RESIZE_SIGNAL_FALLBACK_MS);
  el.addEventListener(
    "transitionend",
    () => {
      clearTimeout(timer);
      fire();
    },
    { once: true },
  );
}

/** Lets a spec start without the page's observer; never called by app code. */
export function resetPanelWidthForTests(): void {
  mainObserver?.disconnect();
  mainObserver = null;
  observed = null;
  mainWidth.value = 0;
  signalScope?.stop();
  signalScope = null;
  pendingSignal = false;
  viewportWidth.value = typeof window === "undefined" ? 0 : window.innerWidth;
}

// Flag off: `AlertList`, `FilterGroup` and the Logs splitter keep reading the flag's 25 % / 50 % until cutover.
function legacyWidth(mainWidthPx: ComputedRef<number>): AssistantPanelWidth {
  const vuex = useStore();
  const enabled = computed(() => !!vuex?.state.isAiChatEnabled);
  return {
    panelWidthRem: computed(() =>
      enabled.value ? viewportRem() * (vuex.state.isAiChatExpanded ? 0.5 : 0.25) : 0,
    ),
    mainWidthPx,
    placement: computed(() => (enabled.value ? "sidebar" : "hidden")),
    floating: computed(() => false),
  };
}

// One watcher per page, however many readers: a change of the panel's width signals once.
function watchResizeSignal(width: AssistantPanelWidth): void {
  if (signalScope) return;
  signalScope = effectScope(true);
  signalScope.run(() => {
    watch([width.panelWidthRem, width.placement, width.floating], () => scheduleResizeSignal(), {
      flush: "post",
    });
  });
}

function transitions(el: HTMLElement): boolean {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return false;
  const style = getComputedStyle(el);
  return (style.transitionDuration ?? "")
    .split(",")
    .some((part) => parseFloat(part) > 0 && style.transitionProperty !== "none");
}

// `<main>` mounts with the layout; a reader set up before it retries for a few frames, and the next reader tries again.
function observeMain(retries = MAIN_RETRY_FRAMES): void {
  if (typeof window === "undefined" || typeof ResizeObserver === "undefined") return;
  const main = document.querySelector(MAIN_SELECTOR);
  if (!main) {
    if (retries > 0)
      requestAnimationFrame(() => {
        if (!observed) observeMain(retries - 1);
      });
    return;
  }
  if (main === observed) return;
  mainObserver ??= new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (entry) mainWidth.value = Math.round(entry.contentRect.width);
  });
  if (observed) mainObserver.unobserve(observed);
  observed = main;
  mainObserver.observe(main);
  mainWidth.value = Math.round(main.getBoundingClientRect().width);
}

function viewportRem(): number {
  if (typeof window === "undefined") return 80;
  if (!viewportTracked) {
    viewportTracked = true;
    viewportWidth.value = window.innerWidth;
    window.addEventListener("resize", () => (viewportWidth.value = window.innerWidth), {
      passive: true,
    });
  }
  return viewportWidth.value / 16;
}
