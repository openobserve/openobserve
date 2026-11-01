<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div
    v-if="mountable && shown"
    data-test="assistant-window-layer"
    :inert="modalOpen || undefined"
    class="contents"
  >
    <AssistantWindow
      v-for="win in openWindows"
      :key="win.sid"
      :win="win"
      :area="area"
      :band-rem="bandRem"
      :focused="focusedSid === win.sid"
      :obscured="obscured[win.sid] ?? null"
      :tear-off="tearOffRequest?.sid === win.sid ? tearOffRequest : null"
      @minimise="(reason) => minimise(win.sid, reason)"
      @close="close(win.sid)"
      @pin="pin(win.sid)"
      @drop-target="(target) => (dropTarget = target)"
      @announce="(key) => speak(t(`assistant.announce.${key}`))"
      @mode-started="(mode) => modeStarted(win.sid, mode)"
    />
    <AssistantTray
      v-show="!trayHidden"
      ref="tray"
      :order="shell.trayOrder"
      :visible-bars="trayBars"
      @restore="restore"
      @close="close"
    />
    <div
      v-if="dropTarget === 'sidebar'"
      class="border-border-strong text-text-secondary fixed end-[calc(var(--o-tray-end)*1rem)] top-[calc(var(--o-drop-top)*1rem)] bottom-2 z-5000 flex w-48 items-center justify-center border-2 border-dashed text-sm"
      data-test="assistant-drop-sidebar"
    >
      {{ t("assistant.window.dropSidebar") }}
    </div>
    <div
      v-else-if="dropTarget === 'tray'"
      class="border-border-strong text-text-secondary fixed end-[calc(var(--o-tray-end)*1rem)] bottom-2 z-5000 flex h-10 w-60 items-center justify-center border-2 border-dashed text-sm"
      data-test="assistant-drop-tray"
    >
      {{ t("assistant.window.dropTray") }}
    </div>
  </div>
  <AssistantStatusRegion ref="region" data-test="assistant-window-status" />
</template>

<script lang="ts">
const MAIN_SELECTOR = "main[data-test='main-content']";

const UNMOUNTED_GATES: ReadonlySet<string> = new Set(["loading", "not_entitled", "not_configured"]);

const BAND_VAR = "--o-assistant-inset-bottom";

// Only the assistant's own surfaces stay out of the focus-not-obscured check.
const OWN_SURFACES = "[data-assistant-window], [data-test='assistant-tray'], [data-assistant-root]";

const FULL_TRAY_BARS = 4;

const NARROW_TRAY_BARS = 2;

const WIDE_VIEWPORT_REM = 80;
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";

import {
  TRAY_FOOTPRINT_REM,
  coversFully,
  intersects,
  isRunning,
  openWindowsOf,
  registerEscapeRung,
  useAssistantCapability,
  useAssistantRuns,
  useAssistantStore,
  type DropTarget,
  type MinimiseReason,
  type PageArea,
  type Sid,
} from "@/composables/assistant";
import useBreakpoint from "@/composables/useBreakpoint";
import { toast } from "@/lib/feedback/Toast/useToast";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import AssistantStatusRegion from "./AssistantStatusRegion.vue";
import AssistantTray from "./AssistantTray.vue";
import AssistantWindow from "./AssistantWindow.vue";
import { tearOffRequest, type WindowKeyboardMode } from "./assistantWindowHost";

const { t } = useI18nTyped();
const store = useAssistantStore();
const runs = useAssistantRuns();
const capability = useAssistantCapability();
const route = useRoute();
const { lgUp } = useBreakpoint();
const region = ref<InstanceType<typeof AssistantStatusRegion> | null>(null);
const tray = ref<InstanceType<typeof AssistantTray> | null>(null);
const dropTarget = ref<DropTarget>(null);
const modalOpen = ref(false);
const trayHidden = ref(false);
const obscured = reactive<Record<Sid, "collapsed" | "hidden">>({});
const area = ref<PageArea>(readArea());
const viewportRem = ref(window.innerWidth / 16);
let pageFocus: HTMLElement | null = null;
let mainSizes: ResizeObserver | null = null;
let modalWatch: MutationObserver | null = null;

const shell = computed(() => store.state.shell);
const mountable = computed(() => !UNMOUNTED_GATES.has(capability.gate.value));
const shown = computed(() => lgUp.value && route.name !== "assistant");
const openWindows = computed(() => openWindowsOf(shell.value));
const focusedSid = computed(() => {
  const focused = shell.value.lastFocusedContainer;
  return focused && focused !== "sidebar" ? focused.window : null;
});
const trayShown = computed(() => shown.value && shell.value.trayOrder.length > 0);
const bandRem = computed(() => (trayShown.value ? TRAY_FOOTPRINT_REM : 0));
const trayBars = computed(() =>
  viewportRem.value >= WIDE_VIEWPORT_REM ? FULL_TRAY_BARS : NARROW_TRAY_BARS,
);

function readArea(): PageArea {
  const viewport = window.innerWidth / 16;
  const main = document.querySelector(MAIN_SELECTOR)?.getBoundingClientRect();
  if (!main) return { start: 0, end: viewport, top: 0, bottom: window.innerHeight / 16, viewport };
  const rtl = getComputedStyle(document.documentElement).direction === "rtl";
  const start = (rtl ? window.innerWidth - main.right : main.left) / 16;
  const end = (rtl ? window.innerWidth - main.left : main.right) / 16;
  return { start, end, top: main.top / 16, bottom: main.bottom / 16, viewport };
}

function writeAnchors(): void {
  const { end, top, viewport } = area.value;
  const el = document.documentElement;
  el.style.setProperty("--o-tray-end", String(viewport - end));
  el.style.setProperty("--o-drop-top", String(top));
}

function measure(): void {
  area.value = readArea();
  viewportRem.value = window.innerWidth / 16;
  writeAnchors();
  store.fitWindowsToViewport();
}

function speak(text: I18nText): void {
  region.value?.announce(text);
}

function titleOf(title: I18nText | null | undefined): ReturnType<typeof raw> {
  return raw(String(title ?? t("assistant.thread.newChatTitle")));
}

// Focus goes to the previous container's composer, else back to the page element it came from.
function leaveWindow(): void {
  if (store.focusNextContainer()) return;
  const target = pageFocus?.isConnected ? pageFocus : document.querySelector<HTMLElement>("main");
  target?.focus();
}

function minimise(sid: Sid, reason: MinimiseReason): void {
  store.minimiseWindow(sid, reason);
  trackAssistant("ai_window_minimised", { reason });
  leaveWindow();
}

function close(sid: Sid): void {
  const session = store.state.sessions[sid];
  const answering = !!session && isRunning(session.turn) && !session.pendingApproval;
  const title = titleOf(session?.title);
  store.closeWindow(sid);
  trackAssistant("ai_window_closed", {});
  leaveWindow();
  if (answering) stillAnswering(sid, title);
}

// The status region says the same; the toast is the sighted feedback and its Stop (D1 decision 6).
function stillAnswering(sid: Sid, title: ReturnType<typeof raw>): void {
  toast({
    variant: "default",
    message: t("assistant.window.stillAnswering", { title }),
    mask: true,
    live: "off",
    action: {
      label: t("assistant.runs.stop"),
      dataTest: "assistant-window-toast-stop",
      handler: () => {
        const row = runs.rows.value.find((candidate) => candidate.sid === sid);
        if (row) void runs.stop(row);
      },
    },
  });
}

function pin(sid: Sid): void {
  store.pinChat(sid);
  trackAssistant("ai_container_moved", { from: "window", to: "sidebar", turn_running: false });
}

function restore(sid: Sid): void {
  store.restoreWindow(sid);
  trackAssistant("ai_window_restored", {});
}

function modeStarted(sid: Sid, mode: WindowKeyboardMode): void {
  const title = titleOf(store.state.sessions[sid]?.title);
  speak(
    t(mode === "move" ? "assistant.announce.moveStarted" : "assistant.announce.resizeStarted", {
      title,
    }),
  );
}

function clearObscured(): void {
  for (const sid of Object.keys(obscured)) delete obscured[sid];
  trayHidden.value = false;
}

function windowEl(sid: Sid): HTMLElement | null {
  return document.querySelector(`[data-assistant-window="${CSS.escape(sid)}"]`);
}

// A window covering the focused control collapses to its title bar, and hides if the bar still covers it (SC 2.4.11).
async function giveWay(target: Element): Promise<void> {
  const rect = target.getBoundingClientRect();
  for (const { sid } of openWindows.value) {
    const el = windowEl(sid);
    if (!el || !coversFully(el.getBoundingClientRect(), rect)) continue;
    obscured[sid] = "collapsed";
    await Promise.resolve();
    const bar = el.querySelector("[data-assistant-chrome]")?.getBoundingClientRect();
    if (bar && coversFully(bar, rect)) obscured[sid] = "hidden";
  }
}

// The tray never covers a focused control: the page scrolls it clear, or the tray steps aside.
function clearTray(target: Element): void {
  const el = tray.value?.el;
  if (!el) return;
  if (!intersects(el.getBoundingClientRect(), target.getBoundingClientRect())) return;
  target.scrollIntoView?.({ block: "nearest" });
  trayHidden.value = intersects(el.getBoundingClientRect(), target.getBoundingClientRect());
}

function onFocusIn(event: FocusEvent): void {
  clearObscured();
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.closest(OWN_SURFACES)) return;
  pageFocus = target;
  if (!safeMatchesFocusVisible(target)) return;
  void giveWay(target);
  clearTray(target);
}

function safeMatchesFocusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return false;
  }
}

function syncModal(): void {
  modalOpen.value = document.body.style.pointerEvents === "none";
}

const unregisterRung = registerEscapeRung("g", (event) => {
  const from = event.target instanceof Element ? event.target : document.activeElement;
  const root = from?.closest<HTMLElement>("[data-assistant-window]");
  const sid = root?.dataset.assistantWindow;
  if (!sid) return false;
  minimise(sid, "escape");
  return true;
});

watch(
  () => store.windowAnnouncement.value,
  (line) => {
    if (!line) return;
    const params = { title: titleOf(line.title), other: titleOf(line.other) };
    speak(t(line.key, params));
  },
);

watch(
  bandRem,
  (rem) => {
    const el = document.documentElement;
    if (rem > 0) el.style.setProperty(BAND_VAR, String((rem + 0.5) * 16));
    else el.style.removeProperty(BAND_VAR);
  },
  { flush: "post" },
);

watch(openWindows, (windows) => {
  for (const sid of Object.keys(obscured))
    if (!windows.some((w) => w.sid === sid)) delete obscured[sid];
});

onMounted(() => {
  measure();
  window.addEventListener("resize", measure, { passive: true });
  document.addEventListener("focusin", onFocusIn);
  const main = document.querySelector(MAIN_SELECTOR);
  if (main && typeof ResizeObserver !== "undefined") {
    mainSizes = new ResizeObserver(measure);
    mainSizes.observe(main);
  }
  modalWatch = new MutationObserver(syncModal);
  modalWatch.observe(document.body, { attributes: true, attributeFilter: ["style"] });
  syncModal();
});

onBeforeUnmount(() => {
  unregisterRung();
  window.removeEventListener("resize", measure);
  document.removeEventListener("focusin", onFocusIn);
  mainSizes?.disconnect();
  modalWatch?.disconnect();
  document.documentElement.style.removeProperty(BAND_VAR);
});
</script>
