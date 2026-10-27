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
  <component
    :is="landmark.tag"
    ref="root"
    v-bind="landmark.attrs"
    data-assistant-root
    data-dd-privacy="mask"
    :data-placement="placement"
    :data-sheet="sheet ? '' : undefined"
    :data-state="state"
    :data-test="`assistant-shell-${placement}`"
    tabindex="-1"
    class="bg-surface-base data-[dragging]:ring-border-strong flex h-full min-h-0 flex-col outline-none data-[dragging]:ring-2 data-[dragging]:ring-inset"
    @keydown="recordKeydown"
  >
    <!-- ① chrome row; WP-11's thread header takes the title slot -->
    <div
      class="border-border-default flex h-12 shrink-0 items-center gap-2 border-b px-3"
      data-test="assistant-shell-chrome"
    >
      <OSkeleton v-if="state === 'loading'" type="text" class="w-40" />
      <template v-else-if="showTitle">
        <AssistantMark size="sm" />
        <OTruncatedText
          class="text-text-heading min-w-12 flex-1 text-sm font-medium"
          data-test="assistant-shell-title"
          >{{ title }}</OTruncatedText
        >
      </template>
      <span v-if="state === 'loading' || !showTitle" class="flex-1" />
      <div class="flex shrink-0 items-center gap-1">
        <slot name="container-actions" />
        <AssistantIconButton
          v-if="placement === 'sidebar' && (!sheet || state === 'gate')"
          :label="t('assistant.shell.openInFullView')"
          :icon="assistantGlyph.openFull"
          data-test="assistant-shell-open-in-full-view"
          @click="openInFullView"
        />
        <AssistantContainerMenu v-if="state !== 'gate'" :placement="placement" :sheet="sheet" />
        <AssistantIconButton
          v-if="placement !== 'docked'"
          :label="t('assistant.shell.close', { product })"
          :icon="assistantGlyph.close"
          data-test="assistant-shell-close"
          @click="closeContainer"
        />
      </div>
    </div>

    <!-- ①b notice row: one line at most; WP-09 signed out, WP-10 credit notice, WP-11 history unavailable -->
    <div
      v-if="notice || $slots.notice"
      class="shrink-0 px-3 pt-2"
      data-test="assistant-shell-notice-row"
    >
      <OBanner
        v-if="notice === 'unhealthy'"
        variant="info"
        dense
        :content="t('assistant.gate.unhealthy.notice', { product })"
        data-test="assistant-shell-unhealthy-notice"
      >
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            class="max-md:min-h-11"
            data-test="assistant-shell-unhealthy-notice-retry"
            @click="retry"
          >
            {{ t("assistant.gate.tryAgain") }}
          </OButton>
        </template>
      </OBanner>
      <slot v-else name="notice" />
    </div>

    <!-- The header region speaks only for sessions no container shows -->
    <AssistantStatusRegion ref="region" />

    <div
      :class="[
        'min-h-0 flex-1 max-md:min-h-20',
        state === 'conversation' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto',
      ]"
      data-test="assistant-shell-body"
    >
      <AssistantGateState
        v-if="state === 'gate'"
        :reason="gateReason"
        size="inline"
        :is-admin="capability.isAdmin"
        :context="{ org, feature: 'chat' }"
        :focus-on-mount="openedByUser"
        @action="onGateAction"
      />
      <div
        v-else-if="state === 'loading'"
        class="flex flex-col gap-3 p-4"
        data-test="assistant-shell-loading"
      >
        <span class="sr-only">{{ t("assistant.shell.loadingChat") }}</span>
        <OSkeleton type="rect" class="h-6 w-3/4" />
        <OSkeleton type="rect" class="h-16 w-full" />
        <OSkeleton type="rect" class="h-10 w-2/3" />
      </div>
      <OEmptyState
        v-else-if="state === 'not_found' || state === 'deleted_elsewhere'"
        size="block"
        :backdrop="false"
        :title="
          state === 'not_found'
            ? t('assistant.shell.notFound')
            : t('assistant.shell.deletedElsewhere')
        "
        :action-label="t('assistant.shell.newChat')"
        :data-test="state === 'not_found' ? 'assistant-shell-not-found' : 'assistant-shell-deleted'"
        @action="newChat"
      >
        <template #illustration>
          <AssistantMark size="lg" muted />
        </template>
      </OEmptyState>
      <AssistantWelcome
        v-else-if="state === 'empty' && welcome"
        :variant="density === 'roomy' ? 'roomy' : 'compact'"
        :scope="welcome.scope.value"
        :starters="welcome.starters.value"
        :loading="welcome.loading.value"
        :container="container"
        :sid="activeSid"
        @select-starter="onStarter"
        @open-chat="onOpenChat"
      />
      <slot v-else-if="state === 'conversation'" name="transcript">
        <AssistantTranscript
          ref="transcript"
          :sid="activeSid ?? undefined"
          :density="density"
          @status-visible="(shown) => (statusRowVisible = shown)"
          @outcome-shown="onOutcomeShown"
        >
          <!-- WP-10 renders the approval and consent cards at the end of the transcript -->
          <template #cards><slot name="cards" /></template>
        </AssistantTranscript>
      </slot>
    </div>

    <div
      v-if="state !== 'gate' && !isTerminalBody"
      ref="lower"
      class="flex shrink-0 flex-col max-md:min-h-0 max-md:shrink max-md:overflow-y-auto"
      data-test="assistant-shell-lower"
    >
      <slot name="status-strip">
        <div
          v-if="strip"
          class="border-border-default flex min-w-0 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t px-3 py-1"
          data-test="assistant-status-strip"
        >
          <AssistantTurnStatus
            v-if="strip.status && session"
            variant="block"
            :turn="session.turn"
            :meta="session.turnMeta"
            :owned-by-this-tab="session.turnMeta.ownedByThisTab"
            class="min-w-0 flex-1"
            data-test="assistant-sticky-status"
          />
          <span v-else class="flex-1" />
          <OButton
            v-if="strip.jump"
            variant="ghost"
            size="sm"
            :icon-left="assistantGlyph.jumpToLatest"
            :aria-label="jumpName"
            class="shrink-0 max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-scroll-latest"
            @click="jumpToLatest"
          >
            {{ jumpLabel }}
          </OButton>
          <OButton
            v-if="strip.goToAnswer"
            variant="ghost"
            size="sm"
            class="shrink-0 max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-strip-go-to-answer"
            @click="goToAnswer"
          >
            {{ t("assistant.strip.goToAnswer") }}
          </OButton>
        </div>
      </slot>
      <slot name="tray">
        <AssistantContextTray :sid="activeSid" :collapsed="trayCollapsed" :visible="visible" />
      </slot>
      <!-- A refusal stored nothing, so it sits above the composer that holds the restored prompt (`30` §4.2) -->
      <div v-if="refusal" class="shrink-0 px-3 pt-1.5">
        <AssistantTurnOutcome
          kind="refused"
          :error="refusal"
          :role="capability.isAdmin ? 'admin' : 'member'"
          :retry-snapshot-available="!!activeSid && store.canRetry(activeSid)"
          :at="refusalAt"
          :org="org"
          :online="online"
          :persistence="capability.persistence"
          :signed-in="signedIn"
          :popup-blocked="popupBlocked"
          @action="(action) => onOutcomeAction(activeSid!, action, refusalRecord!)"
          @open-here="openSignInHere"
          @retry-ready="onRetryReady"
        />
      </div>
      <p
        v-if="unknownNotice"
        class="text-text-secondary shrink-0 px-3 pb-1 text-xs"
        data-test="assistant-gate-unknown-notice"
      >
        {{ t("assistant.gate.noPermission.unknownNotice", { product }) }}
      </p>
      <!-- With B-06 reporting down, the gate replaces the composer -->
      <AssistantGateState
        v-if="composerLocked"
        reason="unhealthy"
        size="inline"
        :is-admin="capability.isAdmin"
        :context="{ org }"
      />
      <slot v-else name="composer">
        <AssistantComposer
          ref="composer"
          :sid="activeSid"
          :density="density"
          :ghost="ghost"
          :host="host"
          :visible="visible"
          :cooldown-reason="coolingDown ? t('assistant.composer.rateLimited') : undefined"
        />
      </slot>
      <slot name="disclosure">
        <div class="flex shrink-0 flex-col gap-1.5 px-3 pb-2">
          <OBanner
            v-if="disclosureBanner"
            variant="default"
            dense
            inline-actions
            :content="t('assistant.context.disclosure')"
            data-test="assistant-context-disclosure-banner"
          >
            <template #actions>
              <AssistantIconButton
                :label="t('assistant.context.disclosureDismiss')"
                :icon="assistantGlyph.close"
                data-test="assistant-context-disclosure-dismiss"
                @click="dismissDisclosure"
              />
            </template>
          </OBanner>
          <OText variant="meta" as="p" data-test="assistant-context-disclosure">
            {{ t("assistant.context.disclosureLine") }}
          </OText>
        </div>
      </slot>
    </div>

    <ODialog
      :open="learnOpen"
      size="md"
      :title="t('assistant.name')"
      data-test="assistant-shell-learn-dialog"
      @update:open="(open) => (learnOpen = open)"
    >
      <AssistantGateState
        v-if="learnOpen"
        reason="not_entitled"
        size="hero"
        learn-only
        :is-admin="capability.isAdmin"
        :context="{ org }"
        @action="(cta) => cta === 'close' && (learnOpen = false)"
      />
    </ODialog>
  </component>
</template>

<script lang="ts">
import type { InjectionKey, Ref } from "vue";

import type { AssistantHostAdapter } from "@/composables/assistant";

export interface AssistantShellProps {
  placement: "sidebar" | "full" | "docked";
  /** Rendered inside OSheet below `lg`; changes density and the menu items only. */
  sheet?: boolean;
  host?: AssistantHostAdapter;
  density?: "compact" | "roomy";
}

export type ShellState =
  "gate" | "loading" | "not_found" | "deleted_elsewhere" | "empty" | "conversation";

export type ShellRouteState = "idle" | "loading" | "not_found" | "deleted";

/** What the full view tells its shell about the chat its route asked for. */
export interface ShellRouteContext {
  state: Ref<ShellRouteState>;
  newChat(): void;
}

export const SHELL_ROUTE_CONTEXT: InjectionKey<ShellRouteContext> = Symbol("assistantShellRoute");

/** Tool-step announcements are spaced at least this far apart (`95` §2.2). */
export const STEP_ANNOUNCE_MS = 3_000;

let lastKeydownAt = 0;

/** The last keydown inside any assistant root, so a card never takes focus from a typing user (`95` §4). */
export function lastAssistantKeydownAt(): number {
  return lastKeydownAt;
}
</script>

<script setup lang="ts">
import {
  computed,
  effectScope,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onScopeDispose,
  provide,
  ref,
  shallowRef,
  toRaw,
  watch,
  type ComputedRef,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import AssistantMark from "@/components/ai-assistant/common/AssistantMark.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import AssistantComposer from "@/components/ai-assistant/composer/AssistantComposer.vue";
import { composerUi, noteDraftCleared } from "@/components/ai-assistant/composer/composerUi";
import AssistantContextTray from "@/components/ai-assistant/context/AssistantContextTray.vue";
import AssistantGateState, {
  type GateCta,
} from "@/components/ai-assistant/gate/AssistantGateState.vue";
import AssistantTranscript from "@/components/ai-assistant/transcript/AssistantTranscript.vue";
import AssistantTurnOutcome, {
  outcomeActionLabel,
  outcomeActionOf,
  type OutcomeAction,
} from "@/components/ai-assistant/turn/AssistantTurnOutcome.vue";
import AssistantTurnStatus from "@/components/ai-assistant/turn/AssistantTurnStatus.vue";
import AssistantWelcome from "@/components/ai-assistant/welcome/AssistantWelcome.vue";
import {
  isRunning,
  markHintSeen,
  readHints,
  registerAssistantFocusTarget,
  useAssistantCapability,
  useAssistantName,
  useAssistantStarters,
  useAssistantStore,
  type AssistantError,
  type Container,
  type GateReason,
  type Starter,
} from "@/composables/assistant";
import {
  assistantSessionSourceKey,
  assistantTranscriptHostKey,
  type AssistantTranscriptHost,
} from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { refreshSession } from "@/services/http";
import type { ChatMessage, TurnOutcomeRecord } from "@/ts/interfaces/chat";
import { useI18nTyped } from "@/types/i18n";

import AssistantContainerMenu from "./AssistantContainerMenu.vue";
import AssistantStatusRegion from "./AssistantStatusRegion.vue";
import { closeLockedPanel, useLockedPanel } from "./lockedPanel";

const props = withDefaults(defineProps<AssistantShellProps>(), {
  sheet: false,
  host: undefined,
  density: "compact",
});

defineSlots<{
  "container-actions"?: () => unknown;
  notice?: () => unknown;
  transcript?: () => unknown;
  cards?: () => unknown;
  "status-strip"?: () => unknown;
  tray?: () => unknown;
  composer?: () => unknown;
  disclosure?: () => unknown;
}>();

const { t, te } = useI18nTyped();
const { product } = useAssistantName();
const store = useAssistantStore();
const capability = useAssistantCapability();
const lockedPanel = useLockedPanel();
const routeContext = inject(SHELL_ROUTE_CONTEXT, null);
const route = useRoute();
const router = useRouter();
const vuex = useStore();
const { lgUp } = useBreakpoint();
const root = ref<HTMLElement | null>(null);
const lower = ref<HTMLElement | null>(null);
const region = ref<InstanceType<typeof AssistantStatusRegion> | null>(null);
const composer = ref<InstanceType<typeof AssistantComposer> | null>(null);
const transcript = ref<InstanceType<typeof AssistantTranscript> | null>(null);
const statusRowVisible = ref(true);
const online = ref(typeof navigator === "undefined" || navigator.onLine !== false);
const signedIn = ref(false);
const popupBlocked = ref(false);
const dismissedRefusal = ref<unknown>(null);
const learnOpen = ref(false);
const openedByUser = ref(false);
const disclosureDismissed = ref(false);

const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const session = computed(() => store.state.sessions[store.state.shell.activeSid ?? ""] ?? null);
const activeSid = computed(() => store.state.shell.activeSid);
const gateReason = computed<GateReason>(() =>
  capability.gate.value === "off_for_org" ? "off_for_org" : "no_permission",
);

const state = computed<ShellState>(() => {
  const gate = capability.gate.value;
  if (gate === "no_permission" || gate === "off_for_org") return "gate";
  const routed = routeContext?.state.value ?? "idle";
  if (routed === "loading") return "loading";
  if (routed === "not_found") return "not_found";
  if (routed === "deleted") return "deleted_elsewhere";
  if (!session.value) return store.state.ready ? "empty" : "loading";
  return session.value.messages.length ? "conversation" : "empty";
});

const isTerminalBody = computed(
  () => state.value === "not_found" || state.value === "deleted_elsewhere",
);
const showTitle = computed(() => state.value !== "gate" && !isTerminalBody.value);
const title = computed(() => session.value?.title ?? t("assistant.thread.newChatTitle"));
const b06 = computed(() => capability.value.source === "capabilities");
const notice = computed(() =>
  capability.gate.value === "unhealthy" && !b06.value ? ("unhealthy" as const) : null,
);
const composerLocked = computed(() => capability.gate.value === "unhealthy" && b06.value);
const unknownNotice = computed(() => capability.unknownNotice.value);

const container = computed<Container>(() => {
  if (props.placement === "full") return "full_view";
  if (props.sheet || !lgUp.value) return "sheet";
  return props.placement === "docked" && props.host ? `docked.${props.host.id}` : "sidebar";
});

const visible = computed(() => {
  if (state.value === "gate") return props.placement === "sidebar" && !!lockedPanel.value;
  const kind = store.state.shell.placement.kind;
  return kind === props.placement;
});

const landmark = computed(() => {
  const name = t("assistant.name");
  if (props.sheet) return { tag: "div", attrs: {} };
  if (props.placement === "sidebar") return { tag: "aside", attrs: { "aria-label": name } };
  return { tag: "section", attrs: { role: "region", "aria-label": name } };
});

// Docked, the sheet and a sidebar at the 24 rem default or narrower show the collapsed tray (`40` §1.2).
const trayCollapsed = computed(
  () =>
    props.sheet ||
    props.placement === "docked" ||
    (props.placement === "sidebar" && store.state.shell.sidebarWidthRem <= 24),
);

// The fuller disclosure shows once per user+org on the first attachment, and again in a shared chat (CT-04 AC 5).
const disclosureBanner = computed(() => {
  const current = session.value;
  const key = store.state.userOrgKey;
  if (!current || !key || disclosureDismissed.value) return false;
  // One notice at a time: the cleared notice wins while its Undo is offered.
  if (composerUi(current.sid).cleared) return false;
  if (!current.composer.chips.some((chip) => chip.provenance !== "page")) return false;
  return !!current.share || !readHints(key).disclosure;
});

// The welcome's data is built only once the welcome shows, so a gated container never reads it (IW-05 AC 10).
const welcomeScope = effectScope();
const welcome = shallowRef<ReturnType<typeof useAssistantStarters> | null>(null);
const page = () => (props.placement === "full" ? "assistant" : String(route.name ?? ""));
watch(
  () => state.value === "empty",
  (empty) => {
    if (!empty || welcome.value) return;
    welcome.value =
      welcomeScope.run(() => useAssistantStarters({ page, host: props.host })) ?? null;
  },
  { immediate: true },
);
onScopeDispose(() => welcomeScope.stop());

// The ghost is the first starter the welcome offers, never a recent chat (`70` §5).
const ghost = computed(() => {
  const first =
    state.value === "empty" ? welcome.value?.starters.value.find((s) => s.kind !== "recent") : null;
  return first
    ? { label: first.label, text: first.prompt, chips: first.chips, kind: first.kind }
    : null;
});

// The transcript imports no store (constraint 29); the shell hands it the session and the actions it may ask for.
const messageSources = new Map<string, ComputedRef<ChatMessage[]>>();
provide(assistantSessionSourceKey, (sid) => {
  let source = messageSources.get(sid);
  if (!source) {
    source = computed(() => store.state.sessions[sid]?.messages ?? []);
    messageSources.set(sid, source);
  }
  return source;
});

const transcriptHost: AssistantTranscriptHost = {
  session: (sid) => store.state.sessions[sid] ?? null,
  setFollow: (sid, follow) => store.setFollow(sid, follow),
  setScroll(sid, top) {
    const target = store.state.sessions[sid];
    if (target) target.scroll.top = top;
  },
  selectVersion: (sid, turnId, n) => store.selectVersion(sid, turnId, n),
  outcomeAction: (sid, action, outcome) => onOutcomeAction(sid, action, outcome),
  isAdmin: () => capability.value.isAdmin,
  persistence: () => capability.value.persistence,
  online: () => online.value,
  canRetry: (sid) => store.canRetry(sid),
  focusComposer: focusAfterAction,
};
provide(assistantTranscriptHostKey, transcriptHost);

const role = computed(() => (capability.value.isAdmin ? "admin" : "member"));

const refusal = computed<AssistantError | null>(() => {
  const turn = session.value?.turn;
  if (turn?.state !== "refused" || dismissedRefusal.value === toRaw(turn)) return null;
  return turn.error;
});

const refusalRecord = computed<TurnOutcomeRecord | null>(() =>
  refusal.value
    ? {
        kind: "failed",
        code: refusal.value.code,
        ...(refusal.value.turnId && { turnId: refusal.value.turnId }),
      }
    : null,
);

// The refusal's own end time, kept on the session, so a remounted shell shows the same deadline.
const refusalSeenAt = ref(Date.now());
const refusalAt = computed(() => session.value?.turnMeta.endedAt ?? refusalSeenAt.value);
const clock = ref(Date.now());
let cooldownTimer: ReturnType<typeof setInterval> | null = null;
const cooldownUntil = computed(() => {
  const error = refusal.value;
  return error?.code === "rate_limited" && error.retryAfterMs
    ? refusalAt.value + error.retryAfterMs
    : 0;
});
// Send waits out the same `retry_after` as the refusal's Retry, so the two paths agree (`80` §2.4).
const coolingDown = computed(() => cooldownUntil.value > clock.value);

// The strip speaks the status row's text while the row is out of view, and holds the one keyboard bridge (`30` §1.6, §3.2).
const strip = computed(() => {
  const current = session.value;
  if (!current || state.value !== "conversation") return null;
  const status = isRunning(current.turn) && !statusRowVisible.value;
  const jump = !current.ui.follow;
  // With no answer text there is nothing to go to; the outcome block is the latest content.
  const goToAnswer =
    ["done", "stopped", "failed"].includes(current.turn.state) && hasAnswerText(current.messages);
  return status || jump || goToAnswer ? { status, jump, goToAnswer } : null;
});

const unseen = computed(() => session.value?.ui.unseen ?? 0);
const jumpLabel = computed(() =>
  unseen.value > 0
    ? t("assistant.scroll.jumpToLatestCount", { count: unseen.value })
    : t("assistant.scroll.jumpToLatest"),
);
const jumpName = computed(() =>
  unseen.value > 0
    ? t("assistant.scroll.jumpToLatestName", { count: unseen.value })
    : t("assistant.scroll.jumpToLatest"),
);

function jumpToLatest(): void {
  trackAssistant("ai_scroll_jump", { unseen: unseen.value });
  transcript.value?.jumpToLatest();
}

function goToAnswer(): boolean {
  return !!transcript.value?.focusLatestAnswer();
}

// A failure or refusal says its state word and names its one action in the same sentence (`95` §2.2).
function announcementText(key: string, params: Record<string, unknown>): ReturnType<typeof t> {
  const text = t(key, params);
  const turn = session.value?.turn;
  if (
    !key.startsWith("assistant.error.") ||
    (turn?.state !== "failed" && turn?.state !== "refused")
  )
    return text;
  const state = turn.state === "failed" ? "failed" : "notSent";
  // While `retry_after` runs, Retry is unavailable, so the line names the wait, not an available action.
  const waitMs = turn.error.retryAfterMs
    ? (session.value?.turnMeta.endedAt ?? Date.now()) + turn.error.retryAfterMs - Date.now()
    : 0;
  if (waitMs > 0)
    return t(`assistant.announce.${state}RetryIn`, { title: text, s: Math.ceil(waitMs / 1000) });
  const action = outcomeActionOf(turn.state, turn.error, {
    role: role.value,
    persistence: capability.value.persistence,
    signedIn: signedIn.value,
  });
  if (!action) return t(`assistant.announce.${state}`, { title: text });
  const label = outcomeActionLabel(action, turn.error.code, role.value, t, te);
  return t(`assistant.announce.${state}WithAction`, { title: text, action: label });
}

// Tool steps are spoken at most once per STEP_ANNOUNCE_MS, the latest one winning (`95` §2.2).
function announceLine(key: string, params: Record<string, unknown>): void {
  const text = announcementText(key, params);
  if (stepTimer) clearTimeout(stepTimer);
  stepTimer = null;
  const wait = stepSpokenAt + STEP_ANNOUNCE_MS - Date.now();
  if (!key.startsWith("assistant.step.") || wait <= 0) {
    if (key.startsWith("assistant.step.")) stepSpokenAt = Date.now();
    return region.value?.announce(text);
  }
  stepTimer = setTimeout(() => {
    stepTimer = null;
    stepSpokenAt = Date.now();
    region.value?.announce(text);
  }, wait);
}

function onOutcomeAction(sid: string, action: OutcomeAction, outcome: TurnOutcomeRecord): void {
  const query = { org_identifier: org.value };
  const started = document.activeElement;
  switch (action) {
    case "retry":
    case "ask_again":
      signedIn.value = false;
      void store.retry(sid);
      return focusAfterAction();
    case "continue":
      store.continueTurn(sid);
      return focusEntry();
    case "edit_resend":
      return stagePrompt(sid, outcome.turnId);
    case "stop_it":
      void stopBusy(sid).then((stopped) => stopped && focusAfterRequest(started));
      return;
    case "sign_in":
      return signIn();
    case "retry_save":
      void store.retrySave(sid, outcome.turnId ?? store.state.sessions[sid]?.turnMeta.turnId ?? "");
      return focusAfterAction();
    case "reload_chat":
      void store.openSession({ sid }).then(
        () => focusAfterRequest(started),
        () => undefined,
      );
      return;
    case "open_iam_roles":
      return void router.push({ name: "roles", query }).catch(() => undefined);
    case "manage_usage":
    case "view_plans":
      return void router.push({ name: "plans", query }).catch(() => undefined);
    default:
      return;
  }
}

function hasAnswerText(messages: ChatMessage[]): boolean {
  const last = messages.at(-1);
  return (
    last?.role === "assistant" &&
    !!last.contentBlocks?.some((block) => block.type === "text" && !!block.text?.trim())
  );
}

// A half sheet grows so the new outcome's title and action fit; no "Expanded.", the outcome's own line is speaking (`30` §4.3).
function onOutcomeShown(): void {
  if (props.sheet && store.state.shell.sheetSnap === "half") store.setSheetSnap("full");
}

function onRetryReady(): void {
  clock.value = Date.now();
  region.value?.announce(t("assistant.outcome.canRetryNow"));
}

// After a round-trip, focus moves only if the reader is still on the control that started it (or it unmounted).
function focusAfterRequest(started: Element | null): void {
  void nextTick(() => {
    const active = document.activeElement;
    if (active === started || !active || active === document.body) focusEntry();
  });
}

// The pressed control unmounts with its block or bar, so focus goes to the composer, never to the page.
function focusAfterAction(): void {
  void nextTick(focusEntry);
}

// Edit and resend from an outcome puts the original prompt back in the composer; nothing sends (HT-02 edge).
function stagePrompt(sid: string, turnId: string | undefined): void {
  const messages = store.state.sessions[sid]?.messages ?? [];
  const prompt =
    messages.find((message) => message.role === "user" && message.turnId === turnId) ??
    [...messages].reverse().find((message) => message.role === "user");
  if (!prompt) return;
  store.stage(sid, {
    text: String(prompt.content ?? ""),
    chips: (prompt.chips ?? []).map((chip) => ({ ...toRaw(chip) })),
    mode: "replace",
  });
  focusEntry();
}

// `turn_busy`'s Stop it cancels the turn that holds the lease, never the refused one (B-03).
async function stopBusy(sid: string): Promise<boolean> {
  const turn = store.state.sessions[sid]?.turn;
  const activeTurnId = turn?.state === "refused" ? (turn.error.turnId ?? null) : null;
  const stopped = await store.cancelTurn(sid, activeTurnId);
  region.value?.announce(
    stopped ? t("assistant.outcome.stopItSent") : t("assistant.outcome.stopItFailed"),
  );
  if (stopped && turn) dismissedRefusal.value = toRaw(turn);
  return stopped;
}

let awaitingSignIn = false;
let stepTimer: ReturnType<typeof setTimeout> | null = null;
let stepSpokenAt = Number.NEGATIVE_INFINITY;

// The sign-in runs in a new tab so this one keeps its page and draft (`80` §2.3; round 1 E-01).
function signIn(): void {
  awaitingSignIn = true;
  // Without `noopener` a blocked tab shows as null; the tab is this app's own page and loses its opener at once.
  const tab = window.open(router.resolve({ name: "closeTab" }).href, "_blank");
  if (tab) tab.opener = null;
  popupBlocked.value = !tab;
}

// Signing in here reloads this page, so the sign-in returns to it and the saved draft comes back.
function openSignInHere(): void {
  store.drafts.flush();
  window.location.reload();
}

async function onVisibility(): Promise<void> {
  if (!awaitingSignIn || document.visibilityState !== "visible") return;
  awaitingSignIn = false;
  if ((await refreshSession()) !== "refreshed") return;
  signedIn.value = true;
  region.value?.announce(t("assistant.outcome.signedIn"));
}

function onOnline(): void {
  online.value = true;
  if (refusal.value?.code === "offline") region.value?.announce(t("assistant.outcome.backOnline"));
}

function onOffline(): void {
  online.value = false;
}

const offs: (() => void)[] = [];

onMounted(() => {
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisibility);
  offs.push(
    registerAssistantFocusTarget("answer", () => visible.value && goToAnswer()),
    () => window.removeEventListener("online", onOnline),
    () => window.removeEventListener("offline", onOffline),
    () => document.removeEventListener("visibilitychange", onVisibility),
  );
});

onBeforeUnmount(() => {
  offs.forEach((off) => off());
  if (stepTimer) clearTimeout(stepTimer);
  if (cooldownTimer) clearInterval(cooldownTimer);
});

watch(
  cooldownUntil,
  (until) => {
    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = null;
    clock.value = Date.now();
    if (until <= clock.value) return;
    cooldownTimer = setInterval(() => {
      clock.value = Date.now();
      if (clock.value < until || !cooldownTimer) return;
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }, 1_000);
  },
  { immediate: true },
);

let restoredText: string | null = null;

// Read after the restore lands, so the restored prompt itself never counts as an edit.
watch(
  refusal,
  (error) => {
    if (error) refusalSeenAt.value = Date.now();
    restoredText = error ? (session.value?.composer.text ?? "") : null;
  },
  { flush: "post" },
);

// A declined consent note clears on the first keystroke after it (CC-06 AC 4).
watch(
  () => session.value?.composer.text,
  (text) => {
    const turn = session.value?.turn;
    if (turn?.state !== "refused" || turn.error.code !== "consent_declined") return;
    if (restoredText !== null && text !== restoredText) dismissedRefusal.value = toRaw(turn);
  },
);

function dismissDisclosure(): void {
  disclosureDismissed.value = true;
  const key = store.state.userOrgKey;
  if (key) markHintSeen(key, "disclosure");
}

function recordKeydown(): void {
  lastKeydownAt = Date.now();
}

function focusEntry(): void {
  if (composer.value) return composer.value.focusInput("end");
  const el = root.value;
  const target =
    el?.querySelector<HTMLElement>("[data-assistant-composer]") ??
    el?.querySelector<HTMLElement>('[data-test="assistant-gate-state"] button') ??
    el;
  target?.focus();
}

function ensureSession(): string {
  return (
    store.state.shell.activeSid ??
    store.createSession({
      origin: { entryKind: "empty_state", objectKind: "none", container: container.value },
    })
  );
}

function onStarter(starter: Starter): void {
  const sid = ensureSession();
  if (composer.value) return composer.value.prefill({ text: starter.prompt, chips: starter.chips });
  const draft = store.state.sessions[sid]?.composer.text.trim() ?? "";
  store.stage(sid, {
    chips: starter.chips,
    text: starter.prompt,
    mode: draft ? "append" : "replace",
  });
  focusEntry();
}

function onOpenChat(chatId: number): void {
  void store.openSession({ chatId }, { focus: true }).catch(() => undefined);
}

// The previous chat keeps its draft; "Bring it here" moves it into the new chat (SH-03 AC 6, CT-06 AC 5, V6).
function newChat(): void {
  if (routeContext) return routeContext.newChat();
  const previous = session.value;
  const { text = "", chips = [], images = [] } = previous?.composer ?? {};
  const drafted = !!text.trim() || chips.length > 0 || images.length > 0;
  store.setActive(null);
  const sid = ensureSession();
  if (!previous || !drafted || previous.sid === sid) return;
  noteDraftCleared(sid, { token: null, from: previous.sid, at: Date.now() });
  trackAssistant("ai_composer_cleared", { reason: "new_chat", undone: false });
}

function retry(): void {
  const sid = store.state.shell.activeSid;
  if (sid) void store.retry(sid);
}

// The locked sidebar has no placement to move, so its full view is the route's hero gate.
function openInFullView(): void {
  if (state.value === "gate") {
    closeLockedPanel("move");
    void router.push({ name: "assistant" });
    return;
  }
  const sid = store.state.shell.activeSid;
  trackAssistant("ai_container_moved", {
    from: store.state.shell.sidebarMode,
    to: "full",
    turn_running: !!session.value && !isAtRest(session.value.turn.state),
  });
  store.moveTo({ kind: "full" });
  void router.push({ name: "assistant", params: sid ? { chatId: sid } : {} });
}

function closeContainer(): void {
  trackAssistant("ai_container_closed", { reason: "close" });
  closeLockedPanel();
  store.close("close");
  if (props.placement !== "full" || route.name !== "assistant") return;
  if (window.history.state?.back) router.back();
  else void router.push("/");
}

function onGateAction(cta: GateCta): void {
  if (cta === "learn_more") learnOpen.value = true;
}

function isAtRest(turn: string): boolean {
  return ["idle", "done", "failed", "refused", "stopped"].includes(turn);
}

// An explicit open focuses the composer once; the sheet keeps it mounted, so this works there too.
watch(
  () => store.focusRequest.value?.seq,
  async (seq) => {
    if (seq === undefined || !visible.value) return;
    openedByUser.value = true;
    await nextTick();
    focusEntry();
  },
);

// Only an open that asked for focus is the user's; a restore or a silent route enter says nothing.
let seqWhenHidden = store.focusRequest.value?.seq;
watch(visible, async (shown) => {
  if (!shown) {
    seqWhenHidden = store.focusRequest.value?.seq;
    openedByUser.value = false;
    return;
  }
  await nextTick();
  if (store.focusRequest.value?.seq !== seqWhenHidden || openedByUser.value)
    region.value?.announce(t("assistant.announce.opened", { product }));
});

watch(
  () => lockedPanel.value,
  async (locked) => {
    if (!locked || props.placement !== "sidebar") return;
    openedByUser.value = true;
    await nextTick();
    region.value?.announce(t("assistant.gate.announce.locked", { product }));
  },
  { immediate: true },
);

watch(
  () => store.announcement.value,
  (line) => {
    if (!line || !visible.value || line.sid !== store.state.shell.activeSid) return;
    announceLine(line.key, line.params ?? {});
  },
);

watch(
  () => state.value === "loading" && visible.value,
  (loading) => {
    if (loading) region.value?.announce(t("assistant.shell.loadingChat"));
  },
);

// A half sheet whose composer area no longer fits grows to full, so no chip, cap line or control hides in a scroll box (V5).
watch(lower, (el, _was, onCleanup) => {
  if (!el || !props.sheet || typeof ResizeObserver === "undefined") return;
  // Only content that grew moves the snap; a user who drags back to half is not bounced to full.
  let lastContent = 0;
  const grow = () => {
    // A peeked or closed sheet measures 0; that is not content shrinking, so it never makes the next show look like growth.
    if (!el.clientHeight) return;
    const grew = el.scrollHeight > lastContent + 1;
    lastContent = el.scrollHeight;
    if (!grew) return;
    const shell = root.value;
    const overflows =
      el.scrollHeight > el.clientHeight + 1 ||
      (!!shell && shell.scrollHeight > shell.clientHeight + 1);
    if (!overflows || store.state.shell.sheetSnap !== "half") return;
    store.setSheetSnap("full");
    region.value?.announce(t("assistant.announce.sheetExpanded"));
  };
  const sizes = new ResizeObserver(grow);
  const watchChildren = () => {
    sizes.disconnect();
    sizes.observe(el);
    for (const child of Array.from(el.children)) sizes.observe(child);
  };
  const children = new MutationObserver(watchChildren);
  children.observe(el, { childList: true });
  watchChildren();
  onCleanup(() => {
    sizes.disconnect();
    children.disconnect();
  });
});
</script>
