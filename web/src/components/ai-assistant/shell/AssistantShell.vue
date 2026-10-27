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

    <div class="min-h-0 flex-1 overflow-y-auto max-md:min-h-20" data-test="assistant-shell-body">
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
      <!-- WP-06 renders the transcript here -->
      <slot v-else-if="state === 'conversation'" name="transcript" />
      <!-- WP-10 renders the approval and consent cards at the end of the transcript -->
      <slot v-if="state === 'conversation'" name="cards" />
    </div>

    <div
      v-if="state !== 'gate' && !isTerminalBody"
      ref="lower"
      class="flex shrink-0 flex-col max-md:min-h-0 max-md:shrink max-md:overflow-y-auto"
      data-test="assistant-shell-lower"
    >
      <!-- ④ status strip with its one keyboard bridge (Review request or Go to answer); WP-06 and WP-10 -->
      <slot name="status-strip" />
      <slot name="tray">
        <AssistantContextTray :sid="activeSid" :collapsed="trayCollapsed" :visible="visible" />
      </slot>
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
  onScopeDispose,
  ref,
  shallowRef,
  watch,
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
import AssistantWelcome from "@/components/ai-assistant/welcome/AssistantWelcome.vue";
import {
  markHintSeen,
  readHints,
  useAssistantCapability,
  useAssistantName,
  useAssistantStarters,
  useAssistantStore,
  type Container,
  type GateReason,
  type Starter,
} from "@/composables/assistant";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
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

const { t } = useI18nTyped();
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
    region.value?.announce(t(line.key, line.params ?? {}));
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
