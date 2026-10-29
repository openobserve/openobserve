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
  <template v-if="mountable">
    <!-- Outside the hidden column, so "closed" is still spoken after the column hides -->
    <AssistantStatusRegion ref="region" data-test="assistant-container-status" />
    <div
      v-if="lgUp"
      v-show="visible"
      ref="column"
      data-test="assistant-sidebar-host"
      :[DRAWER_INSET_ATTR]="''"
      :data-mode="floating ? 'floating' : 'pinned'"
      :data-dragging="liveWidth !== null ? '' : undefined"
      :class="[floating ? FLOATING_CLASSES : PINNED_CLASSES, liveWidth === null ? MOTION : '']"
    >
      <AssistantResizeHandle
        :width-rem="shownWidthRem"
        :min-rem="SIDEBAR_MIN_REM"
        :max-rem="maxWidthRem"
        :edge="floating ? 'inside' : 'straddle'"
        @resize="(rem) => (liveWidth = rem)"
        @commit="commitWidth"
        @reset="resetWidth"
      />
      <AssistantShell placement="sidebar" />
    </div>
    <OSheet
      v-else
      :open="visible"
      :snap="store.state.shell.sheetSnap"
      v-bind="{ ariaLabel: t('assistant.name') }"
      :expand-label="t('assistant.shell.sheetExpand')"
      :collapse-label="t('assistant.shell.sheetPeek')"
      data-test="assistant-shell-sheet"
      keep-mounted
      :close-on-escape="false"
      @update:snap="onSnap"
      @update:open="(open) => !open && close('close')"
    >
      <template #peek>
        <span
          class="flex min-w-0 flex-1 items-center gap-2 text-start"
          data-test="assistant-shell-sheet-status"
        >
          <AssistantMark size="sm" />
          <OTruncatedText class="text-text-heading min-w-0 flex-1 text-sm font-medium">{{
            peekTitle
          }}</OTruncatedText>
          <AssistantStatusDot v-if="peekSignal" :state="peekSignal" />
        </span>
      </template>
      <AssistantShell placement="sidebar" sheet />
    </OSheet>
  </template>
  <AssistantLifecycleDialogs />
  <Teleport v-if="deepLink.blocked.value" defer to="main[data-test='main-content']">
    <div class="order-first mb-2 max-md:mx-2" data-test="assistant-deep-link-gate">
      <AssistantGateState
        :reason="deepLink.blocked.value"
        size="inline"
        :is-admin="capability.isAdmin"
        :context="{ org: deepLinkOrg }"
      />
    </div>
  </Teleport>
</template>

<script lang="ts">
// The column reads its width from a unitless rem variable, so no inline width is ever written.
const WIDTH = "w-[calc(var(--o-assistant-sidebar-width,24)*1rem)] max-w-[50vw] min-w-80";

const PINNED_CLASSES = [
  "bg-surface-base border-border-default relative h-full shrink-0 border-s",
  WIDTH,
].join(" ");

// Off while dragging, so the column follows the pointer instead of easing after it.
const MOTION = "motion-safe:transition-[width] motion-safe:duration-150";

/** A burst of key steps or a drag reports its width once it settles. */
export const RESIZE_REPORT_MS = 600;

const SOURCE_CLASSES = ["ring-2", "ring-inset", "ring-focus-ring-accent"];

const FLOATING_CLASSES = [
  "bg-surface-base border-border-default rounded-surface fixed end-2 bottom-2 z-5000 border shadow-lg",
  "top-[calc(var(--navbar-height,2.25rem)+0.5rem)] overflow-hidden",
  WIDTH,
].join(" ");

const LANDSCAPE_PHONE_REM = 30;

/** True when any part of the focused rect lies under the floating card, so a focused control is never even partly hidden. */
export function coveredBy(target: DOMRect, card: DOMRect): boolean {
  return (
    target.left < card.right &&
    target.right > card.left &&
    target.top < card.bottom &&
    target.bottom > card.top
  );
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";

import AssistantMark from "@/components/ai-assistant/common/AssistantMark.vue";
import AssistantStatusDot from "@/components/ai-assistant/common/AssistantStatusDot.vue";
import AssistantGateState from "@/components/ai-assistant/gate/AssistantGateState.vue";
import type { AssistantSignal } from "@/components/ai-assistant/common/AssistantStatusDot.types";
import {
  SIDEBAR_MIN_REM,
  readSidebar,
  registerContainerCloser,
  sidebarWidthFor,
  useAssistantCapability,
  useAssistantName,
  useAssistantPlacement,
  useAssistantShortcuts,
  useAssistantStore,
  useDeepLinkDoor,
  useSidebarFloating,
} from "@/composables/assistant";
import useBreakpoint from "@/composables/useBreakpoint";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { DRAWER_INSET_ATTR, setDrawerInsetEnd } from "@/lib/overlay/Drawer/drawerInset";
import OSheet from "@/lib/overlay/Sheet/OSheet.vue";
import type { SheetSnap } from "@/lib/overlay/Sheet/OSheet.types";
import { trackAssistant, type AiEventProps } from "@/services/assistantAnalytics";
import { useI18nTyped } from "@/types/i18n";

import { defaultWidthRem } from "./AssistantContainerMenu.vue";
import AssistantLifecycleDialogs from "./AssistantLifecycleDialogs.vue";
import AssistantResizeHandle from "./AssistantResizeHandle.vue";
import AssistantShell from "./AssistantShell.vue";
import AssistantStatusRegion from "./AssistantStatusRegion.vue";
import { closeLockedPanel, lockedPanelMoved, useLockedPanel } from "./lockedPanel";

const INSET_END = "--o-assistant-inset-end";

const SNAP_ORDER: SheetSnap[] = ["peek", "half", "full"];

const UNMOUNTED_GATES: ReadonlySet<string> = new Set(["loading", "not_entitled", "not_configured"]);

const LOCKED_GATES: ReadonlySet<string> = new Set(["no_permission", "off_for_org"]);

const AT_REST: ReadonlySet<string> = new Set(["idle", "done", "failed", "refused", "stopped"]);

const ENTRY_FROM: Partial<Record<string, AiEventProps["ai_container_opened"]["from"]>> = {
  header_button: "header",
  shortcut: "shortcut",
  toast: "toast",
  home_launcher: "launcher",
};

const { t } = useI18nTyped();
const { product } = useAssistantName();
const store = useAssistantStore();
const capability = useAssistantCapability();
// A deep link's keys are read once per visit; a blocked gate shows as a banner over the page.
const deepLink = useDeepLinkDoor();
const vuex = useStore();
const deepLinkOrg = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const placement = useAssistantPlacement(store);
const lockedPanel = useLockedPanel();
const route = useRoute();
const { lgUp } = useBreakpoint();
const column = ref<HTMLElement | null>(null);
const region = ref<InstanceType<typeof AssistantStatusRegion> | null>(null);
const liveWidth = ref<number | null>(null);
const viewportRem = ref(window.innerWidth / 16);
let reportTimer: ReturnType<typeof setTimeout> | null = null;
let marked: HTMLElement | null = null;
let returnFocusTo: HTMLElement | null = null;
let main: HTMLElement | null = null;

useAssistantShortcuts();

// G0 and G1 mount no container at all, so the page holds nothing of the assistant (SH-01 AC 8).
const mountable = computed(() => !UNMOUNTED_GATES.has(capability.gate.value));
const onAssistantRoute = computed(() => route.name === "assistant");
const visible = computed(
  () =>
    !onAssistantRoute.value &&
    (placement.placement.value.kind === "sidebar" || !!lockedPanel.value),
);
const floating = useSidebarFloating(store);

const activeSession = computed(
  () => store.state.sessions[store.state.shell.activeSid ?? ""] ?? null,
);
const peekTitle = computed(() => activeSession.value?.title ?? t("assistant.thread.newChatTitle"));
const peekSignal = computed<AssistantSignal | null>(() => {
  const session = activeSession.value;
  if (!session) return null;
  if (session.pendingApproval || session.pendingConsent) return "attention";
  if (["awaiting_approval", "awaiting_consent"].includes(session.turn.state)) return "attention";
  return AT_REST.has(session.turn.state) ? null : "working";
});

const unregisterCloser = registerContainerCloser(() => close("escape"));

function close(reason: "close" | "escape"): void {
  trackAssistant("ai_container_closed", { reason });
  if (lockedPanel.value) closeLockedPanel();
  else store.close(reason);
}

function onSnap(snap: SheetSnap): void {
  const grew = SNAP_ORDER.indexOf(snap) > SNAP_ORDER.indexOf(store.state.shell.sheetSnap);
  store.setSheetSnap(snap);
  trackAssistant("ai_sheet_snap", { snap });
  region.value?.announce(
    t(grew ? "assistant.announce.sheetExpanded" : "assistant.announce.sheetCollapsed"),
  );
}

function activeRunning(): boolean {
  const turn = activeSession.value?.turn.state;
  return !!turn && !AT_REST.has(turn);
}

function onOpen(): void {
  returnFocusTo = lockedPanel.value?.invoker ?? (document.activeElement as HTMLElement | null);
  if (!lgUp.value)
    store.setSheetSnap(window.innerHeight < LANDSCAPE_PHONE_REM * 16 ? "full" : "half");
  const sid = store.state.shell.activeSid;
  const origin = sid ? store.state.sessions[sid]?.origin.entryKind : undefined;
  trackAssistant("ai_container_opened", {
    from: store.focusRequest.value ? (ENTRY_FROM[origin ?? ""] ?? "door") : "restore",
    placement_mode: lgUp.value ? (floating.value ? "floating" : "pinned") : "sheet",
    turn_running: activeRunning(),
    latency_ms: 0,
  });
}

// Focus goes back to the invoker, else the element focused before the open, else `main` (IW-09 AC 3).
async function onClose(): Promise<void> {
  region.value?.announce(
    t(activeRunning() ? "assistant.announce.closedRunning" : "assistant.announce.closed", {
      product,
    }),
  );
  await nextTick();
  const invoker = store.state.shell.invoker?.el.deref();
  const target = [invoker, returnFocusTo].find((el) => el?.isConnected);
  (target ?? document.querySelector<HTMLElement>("main"))?.focus();
  returnFocusTo = null;
}

// The drawn width, which the handle also reports: a stored width too wide for this window is held, never floated.
const shownWidthRem = computed(() =>
  sidebarWidthFor(
    liveWidth.value ?? store.state.shell.sidebarWidthRem,
    viewportRem.value,
    floating.value,
  ),
);

// Pinned, the page keeps 32 rem beside the panel, so a drag never pushes the panel into forced floating.
const maxWidthRem = computed(() =>
  sidebarWidthFor(Number.POSITIVE_INFINITY, viewportRem.value, floating.value),
);

function writeWidth(): void {
  column.value?.style.setProperty("--o-assistant-sidebar-width", String(shownWidthRem.value));
}

function commitWidth(rem: number): void {
  liveWidth.value = null;
  store.setSidebarWidth(rem);
  if (reportTimer) clearTimeout(reportTimer);
  reportTimer = setTimeout(() => {
    reportTimer = null;
    trackAssistant("ai_panel_resized", {
      width_rem: store.state.shell.sidebarWidthRem,
      viewport: "desktop",
    });
  }, RESIZE_REPORT_MS);
}

function resetWidth(): void {
  commitWidth(defaultWidthRem(viewportRem.value));
}

function onViewport(): void {
  viewportRem.value = window.innerWidth / 16;
}

// The legacy expanded chat was half the window; the first v2 open keeps that width once.
function adoptLegacyWidth(): void {
  const key = store.state.userOrgKey;
  if (!key || vuex.state.isAiChatExpanded !== true) return;
  if (typeof readSidebar(key).widthRem === "number") return;
  store.setSidebarWidth(viewportRem.value / 2);
}

// The page element the chat was asked about keeps a ring while the pinned card stays beside it.
function markSource(): void {
  const invoker = store.state.shell.invoker;
  const el = invoker?.el.deref() ?? null;
  const active =
    visible.value &&
    placement.sidebarForcedPinned.value &&
    !!el?.isConnected &&
    invoker?.sid === store.state.shell.activeSid &&
    !el.closest("[data-assistant-root]");
  // A door inside a panel's toolbar rings the whole panel, which is what the chat explains.
  const next = active ? (el.closest<HTMLElement>("[data-assistant-source-scope]") ?? el) : null;
  if (marked === next) return;
  marked?.removeAttribute("data-assistant-source");
  marked?.classList.remove(...SOURCE_CLASSES);
  marked = next;
  marked?.setAttribute("data-assistant-source", "");
  marked?.classList.add(...SOURCE_CLASSES);
}

function writeInsetEnd(): void {
  const el = column.value;
  if (el && visible.value && floating.value)
    document.documentElement.style.setProperty(INSET_END, String(Math.round(el.offsetWidth)));
  else document.documentElement.style.removeProperty(INSET_END);
  // A pinned panel keeps a page drawer beside it, so a door that opens both leaves both usable.
  setDrawerInsetEnd(
    el && visible.value && !floating.value ? el.offsetWidth : 0,
    el && visible.value ? el : null,
  );
}

// A focused page control even partly under the floating card pins the card for this open.
function onMainFocus(event: FocusEvent): void {
  const card = column.value;
  const target = event.target;
  if (!card || !visible.value || !floating.value || !(target instanceof Element)) return;
  if (!coveredBy(target.getBoundingClientRect(), card.getBoundingClientRect())) return;
  const current = placement.placement.value;
  if (current.kind !== "sidebar") return;
  store.open(current, { focus: "none", forcePinned: true });
}

// A move to the full view or a dock is not a close: the new container announces and takes focus.
watch(visible, (shown, was) => {
  if (shown && !was) onOpen();
  const closed =
    !lockedPanel.value && !lockedPanelMoved() && placement.placement.value.kind === "hidden";
  if (!shown && was && closed) void onClose();
  void nextTick(writeInsetEnd);
});

watch(capability.gate, (gate) => {
  if (!LOCKED_GATES.has(gate)) closeLockedPanel();
});

watch([column, shownWidthRem], writeWidth, {
  immediate: true,
  flush: "post",
});
// The column mounts late after a reload or a gate change, so its own arrival rewrites the inset.
watch([column, visible, floating, () => store.state.shell.sidebarWidthRem, lgUp], writeInsetEnd, {
  immediate: true,
  flush: "post",
});
const columnSize =
  typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => writeInsetEnd());
watch(column, (el, old) => {
  if (old) columnSize?.unobserve(old);
  if (el) columnSize?.observe(el);
});
watch(
  [
    visible,
    () => placement.sidebarForcedPinned.value,
    () => store.state.shell.activeSid,
    () => store.state.shell.invoker,
  ],
  markSource,
  { flush: "post" },
);
watch(
  () => store.state.userOrgKey,
  () => adoptLegacyWidth(),
  { immediate: true },
);

onMounted(() => {
  main = document.querySelector("main");
  main?.addEventListener("focusin", onMainFocus);
  window.addEventListener("resize", onViewport, { passive: true });
});

onBeforeUnmount(() => {
  unregisterCloser();
  main?.removeEventListener("focusin", onMainFocus);
  window.removeEventListener("resize", onViewport);
  document.documentElement.style.removeProperty(INSET_END);
  columnSize?.disconnect();
  setDrawerInsetEnd(0);
  if (reportTimer) clearTimeout(reportTimer);
  marked?.removeAttribute("data-assistant-source");
  marked?.classList.remove(...SOURCE_CLASSES);
  marked = null;
});
</script>
