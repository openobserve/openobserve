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
  <OSkeleton
    v-if="view.state === 'loading'"
    type="rect"
    class="size-7.5 shrink-0 max-md:size-11 pointer-coarse:size-11"
    data-test="assistant-header-skeleton"
  />
  <template v-else-if="view.state !== 'hidden'">
    <OButton
      ref="button"
      variant="ghost"
      size="icon-toolbar"
      data-test="menu-link-ai-item"
      data-entry="ai-entry-header-ask"
      :data-state="view.state"
      :aria-label="view.name"
      :class="[
        'relative max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11',
        view.state === 'open' ? 'border-border-strong border' : '',
      ]"
      @click="onClick"
    >
      <span class="relative inline-flex">
        <OIcon
          :name="assistantGlyph.assistant"
          size="sm"
          :class="view.state === 'off' ? 'text-text-muted' : ''"
        />
        <span v-if="view.signal" class="absolute -end-1 -top-1 inline-flex">
          <AssistantStatusDot
            :state="view.signal"
            :count="view.count"
            data-test="assistant-header-status-light"
          />
        </span>
        <span
          v-else-if="view.badge"
          aria-hidden="true"
          class="rounded-default bg-surface-base text-text-secondary absolute -end-1.5 -top-1.5 inline-flex size-3.5 items-center justify-center"
        >
          <OIcon :name="assistantGlyph[view.badge]" size="xs" />
        </span>
      </span>
      <OTooltip side="bottom" :content="view.tooltip" :shortcut-id="shortcutId" />
    </OButton>
    <AssistantStatusRegion
      v-if="shortcutId"
      ref="region"
      data-test="assistant-header-status-region"
    />
    <ODialog
      v-if="lgUp"
      :open="!!dialogGate"
      size="md"
      :title="t('assistant.name')"
      data-test="assistant-header-gate-dialog"
      @update:open="(open) => !open && closeDialog()"
    >
      <AssistantGateState
        v-if="dialogGate"
        :reason="dialogGate"
        size="hero"
        :is-admin="capability.isAdmin"
        :context="{ org }"
        @action="onGateAction"
      />
    </ODialog>
    <OSheet
      v-else
      :open="!!dialogGate"
      :snap="sheetSnap"
      :snap-points="['half', 'full']"
      v-bind="{ ariaLabel: t('assistant.name') }"
      :expand-label="t('assistant.shell.sheetExpand')"
      :collapse-label="t('assistant.shell.sheetPeek')"
      data-test="assistant-header-gate-sheet"
      @update:snap="(snap) => (sheetSnap = snap)"
      @update:open="(open) => !open && closeDialog()"
    >
      <template #header>
        <div class="flex justify-end px-2">
          <AssistantIconButton
            :label="t('assistant.gate.close')"
            :icon="assistantGlyph.close"
            data-test="assistant-header-gate-sheet-close"
            @click="closeDialog"
          />
        </div>
      </template>
      <AssistantGateState
        v-if="dialogGate"
        :reason="dialogGate"
        size="hero"
        :is-admin="capability.isAdmin"
        :context="{ org }"
        focus-on-mount
        @action="onGateAction"
      />
    </OSheet>
  </template>
</template>

<script lang="ts">
import type { AssistantSession, GateReason } from "@/composables/assistant";
import type { I18nText } from "@/types/i18n";
import type { AssistantSignal } from "@/components/ai-assistant/common/AssistantStatusDot.types";

export type HeaderButtonState =
  "loading" | "hidden" | "idle" | "open" | "working" | "needs_you" | "unread" | "locked" | "off";

/** Hidden turns raise one quiet toast; the header region is the one speaker, so the toast is silent. */
export const HEADER_TOAST_MS = 6_000;

const AT_REST: ReadonlySet<string> = new Set(["idle", "done", "failed", "refused", "stopped"]);

interface HeaderView {
  state: HeaderButtonState;
  name: I18nText;
  tooltip: I18nText;
  signal: AssistantSignal | null;
  count?: number;
  badge: "locked" | "notSetUp" | null;
  /** The pitch or setup card a click opens instead of the container. */
  dialog: GateReason | null;
}

function needsYou(session: AssistantSession): boolean {
  const state = session.turn.state;
  return (
    state === "awaiting_approval" ||
    state === "awaiting_consent" ||
    !!session.pendingApproval ||
    !!session.pendingConsent
  );
}

function isRunning(session: AssistantSession): boolean {
  return !AT_REST.has(session.turn.state);
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import AssistantStatusDot from "@/components/ai-assistant/common/AssistantStatusDot.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import AssistantGateState, {
  type GateCta,
} from "@/components/ai-assistant/gate/AssistantGateState.vue";
import {
  openAssistant,
  useAssistantCapability,
  useAssistantHistory,
  useAssistantName,
  useAssistantOpenChord,
  useAssistantPlacement,
  useAssistantStore,
} from "@/composables/assistant";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSheet from "@/lib/overlay/Sheet/OSheet.vue";
import type { SheetSnap } from "@/lib/overlay/Sheet/OSheet.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { trackAssistant, type AiEventProps } from "@/services/assistantAnalytics";
import { raw, useI18nTyped } from "@/types/i18n";

import AssistantStatusRegion from "./AssistantStatusRegion.vue";
import { openLockedPanel, useLockedPanel } from "./lockedPanel";

const { t } = useI18nTyped();
const { product } = useAssistantName();
const store = useAssistantStore();
const history = useAssistantHistory();
const capability = useAssistantCapability();
const placement = useAssistantPlacement(store);
const lockedPanel = useLockedPanel();
// The open chord lives here, not in the async host, so it works from the moment the button does.
useAssistantOpenChord({ gate: capability.gate, assistantCanChat: capability.assistantCanChat });
const route = useRoute();
const vuex = useStore();
const { lgUp } = useBreakpoint();
const button = ref<InstanceType<typeof OButton> | null>(null);
const region = ref<InstanceType<typeof AssistantStatusRegion> | null>(null);
const dialogGate = ref<GateReason | null>(null);
const sheetSnap = ref<SheetSnap>("half");
const toasted = new Set<string>();

const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const visible = computed(() => placement.isVisible.value || !!lockedPanel.value);
const shortcutId = computed(() =>
  capability.assistantCanChat.value ? "assistantOpen" : undefined,
);
// Ephemeral turns answer in their own surface, so they never toast or light the header.
const mine = computed(() =>
  Object.values(store.state.sessions).filter(
    (s) => s.userOrgKey === store.state.userOrgKey && !s.record.ephemeral,
  ),
);

const view = computed<HeaderView>(() => gateView() ?? lightView());

// A chat another tab or device lights may be known only by its history row; else no title is claimed.
function knownTitle(sid: string | null): I18nText | null {
  if (!sid) return null;
  const session = store.state.sessions[sid];
  if (session) return session.title ?? t("assistant.thread.newChatTitle");
  return history.rows.value.find((row) => row.sid === sid)?.title ?? null;
}

function titleOf(sid: string | null): I18nText {
  return knownTitle(sid) ?? t("assistant.thread.newChatTitle");
}

function plain(state: HeaderButtonState, name: I18nText, tooltip: I18nText): HeaderView {
  return { state, name, tooltip, signal: null, badge: null, dialog: null };
}

function gateView(): HeaderView | null {
  const gate = capability.gate.value;
  const p = { product };
  if (gate === "loading") return plain("loading", raw(""), raw(""));
  if (gate === "not_entitled")
    return {
      ...plain(
        "locked",
        t("assistant.header.enterpriseName", p),
        t("assistant.gate.notEntitled.tooltip", p),
      ),
      badge: "locked",
      dialog: "not_entitled",
    };
  if (gate === "not_configured") {
    if (!capability.value.isAdmin) return plain("hidden", raw(""), raw(""));
    return {
      ...plain("off", t("assistant.header.offName", p), t("assistant.gate.notConfigured.title", p)),
      badge: "notSetUp",
      dialog: "not_configured",
    };
  }
  if (gate === "no_permission" || gate === "off_for_org")
    return {
      ...plain(
        "locked",
        t("assistant.header.lockedName", p),
        t("assistant.gate.noPermission.tooltip"),
      ),
      badge: "locked",
    };
  const light = store.headerLight.value.state;
  if (gate === "unhealthy" && (light === "idle" || light === "open"))
    return {
      ...plain(
        "off",
        t("assistant.header.unavailableName", p),
        t("assistant.gate.unhealthy.tooltip", p),
      ),
      dialog: capability.value.source === "capabilities" ? "unhealthy" : null,
    };
  return null;
}

function lightView(): HeaderView {
  const light = store.headerLight.value;
  const p = { product };
  const open = visible.value;
  if (light.state === "needs_you") {
    const waiting = mine.value.filter(needsYou).length;
    const session = light.sid ? store.state.sessions[light.sid] : undefined;
    const consent = session?.turn.state === "awaiting_consent" || !!session?.pendingConsent;
    return {
      ...plain(
        "needs_you",
        waiting > 0
          ? t(
              open
                ? "assistant.header.needsYouCountNameOpen"
                : "assistant.header.needsYouCountName",
              { ...p, count: waiting },
            )
          : t(open ? "assistant.header.needsYouNameOpen" : "assistant.header.needsYouName", p),
        consent ? t("assistant.turn.waitingConsent") : t("assistant.header.stateNeedsApproval"),
      ),
      signal: "attention",
      ...(waiting > 0 && { count: waiting }),
    };
  }
  if (light.state === "working") {
    const running = mine.value.filter(isRunning).length;
    const name = t(
      open ? "assistant.header.answeringNameOpen" : "assistant.header.answeringName",
      p,
    );
    const title = knownTitle(light.sid);
    return {
      ...plain(
        "working",
        name,
        running > 1
          ? t("assistant.header.stateRunningCount", { count: running }, running)
          : title
            ? t("assistant.header.stateWorking", { title })
            : name,
      ),
      signal: "working",
    };
  }
  if (light.state === "unread") {
    const title = { title: titleOf(light.sid) };
    return light.failed
      ? {
          ...plain(
            "unread",
            t("assistant.header.failedName", p),
            t("assistant.header.stateFailed", title),
          ),
          signal: "failed",
        }
      : {
          ...plain(
            "unread",
            t("assistant.header.readyName", p),
            t("assistant.header.stateDone", title),
          ),
          signal: "unread",
        };
  }
  if (light.state === "open" || open)
    return plain("open", t("assistant.header.nameOpen", p), t("assistant.header.stateOpen", p));
  return plain("idle", t("assistant.header.tooltip", p), t("assistant.header.tooltip", p));
}

function buttonEl(): HTMLElement | null {
  return (button.value?.$el as HTMLElement | undefined) ?? null;
}

function onClick(): void {
  const current = view.value;
  if (current.dialog) {
    dialogGate.value = current.dialog;
    sheetSnap.value = "half";
    return;
  }
  if (current.state === "locked") {
    if (route.name !== "assistant") openLockedPanel(buttonEl());
    return;
  }
  openOnLitSession(buttonEl());
}

// A lit session is the one the click is about, so the container opens on it (SH-07 AC 4–5).
function openOnLitSession(invoker: HTMLElement | null, sid?: string): void {
  const light = store.headerLight.value;
  const target = sid ?? (light.state !== "open" && light.state !== "idle" ? light.sid : null);
  if (target && store.state.sessions[target]) store.setActive(target);
  void openAssistant({
    entryKind: sid ? "toast" : "header_button",
    entryVerb: "ask",
    objectKind: "none",
    intent: "open",
    thread: "current",
    invoker,
  });
}

function closeDialog(): void {
  dialogGate.value = null;
  buttonEl()?.focus();
}

function onGateAction(cta: GateCta): void {
  if (cta === "close" || cta === "see_plans") closeDialog();
}

function lightName(): AiEventProps["ai_status_light"]["state"] {
  const light = store.headerLight.value;
  return light.state === "unread" && light.failed ? "failed" : light.state;
}

function isShown(sid: string): boolean {
  return placement.isVisible.value && store.state.shell.activeSid === sid;
}

function announceLight(): void {
  const light = store.headerLight.value;
  const session = light.sid ? store.state.sessions[light.sid] : undefined;
  if (!session || isShown(session.sid)) return;
  const params = { product, title: titleOf(session.sid) };
  if (light.state === "needs_you")
    region.value?.announce(t("assistant.header.announceNeedsYou", params));
  else if (light.state === "unread")
    region.value?.announce(
      t(
        light.failed ? "assistant.header.announceFailed" : "assistant.header.announceReady",
        params,
      ),
    );
  else if (light.state === "working" && !session.turnMeta.ownedByThisTab)
    region.value?.announce(t("assistant.header.announceWorkingElsewhere", params));
}

// One quiet toast per hidden turn: done answers and decisions waiting on the user.
function toastHidden(): void {
  for (const session of mine.value) {
    const turnId = session.turnMeta.turnId;
    if (!turnId || isShown(session.sid)) continue;
    const kind = needsYou(session)
      ? "needs_you"
      : session.unread && session.turn.state === "done"
        ? "ready"
        : null;
    if (!kind || toasted.has(`${turnId}:${kind}`)) continue;
    toasted.add(`${turnId}:${kind}`);
    showToast(session.sid, kind);
  }
}

function showToast(sid: string, kind: "ready" | "needs_you"): void {
  let opened = false;
  const title = { title: titleOf(sid) };
  toast({
    variant: "default",
    message:
      kind === "ready"
        ? t("assistant.header.toastReady", title)
        : t("assistant.header.toastNeedsYou", title),
    timeout: HEADER_TOAST_MS,
    mask: true,
    live: "off",
    action: {
      label: t("assistant.header.open"),
      handler: () => {
        opened = true;
        trackAssistant("ai_toast", { kind, action: "open" });
        openOnLitSession(null, sid);
      },
    },
    onDismiss: () => {
      if (!opened) trackAssistant("ai_toast", { kind, action: "dismiss" });
    },
  });
}

watch(lightName, (state) => trackAssistant("ai_status_light", { state }));
watch(
  () => [
    store.headerLight.value.state,
    store.headerLight.value.sid,
    store.headerLight.value.failed,
  ],
  announceLight,
);
watch(
  () =>
    mine.value.map((s) => [s.turnMeta.turnId, s.turn.state, s.unread, needsYou(s), isShown(s.sid)]),
  toastHidden,
  { deep: true },
);
</script>
