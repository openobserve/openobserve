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
  <Error404 v-if="view === 'not_found'" />
  <OPageLayout
    v-else
    :title="view === 'shell' ? undefined : t('assistant.name')"
    :icon="view === 'shell' ? undefined : assistantGlyph.assistant"
    bleed
    title-data-test="assistant-view-title"
    :sidebar-width="railPx(RAIL_DEFAULT_REM)"
    :splitter-limits="[railPx(RAIL_MIN_REM), railPx(RAIL_MAX_REM)]"
    :resizable="view === 'shell'"
  >
    <template v-if="view === 'shell' && lgUp && !bare" #sidebar>
      <AssistantHistoryList
        mode="rail"
        :current-sid="store.state.shell.activeSid"
        container="full_view"
        @close="shell?.focusEntry()"
        @shared-links="shell?.openSharedLinks()"
      />
    </template>
    <div class="flex h-full min-h-0 flex-col" data-test="assistant-view" :data-view="view">
      <!-- The chat bar is the page's only header, so the page name is said, not drawn -->
      <h1 v-if="view === 'shell'" class="sr-only" data-test="assistant-view-title">
        {{ t("assistant.name") }}
      </h1>
      <div
        v-if="view === 'loading'"
        class="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4"
        data-test="assistant-view-loading"
      >
        <OSkeleton type="text" class="w-40" />
        <OSkeleton type="rect" class="h-6 w-3/4" />
        <OSkeleton type="rect" class="h-16 w-full" />
        <OSkeleton type="rect" class="h-10 w-2/3" />
      </div>
      <AssistantGateState
        v-else-if="view === 'gate'"
        :reason="gateReason"
        size="hero"
        :is-admin="capability.isAdmin"
        :context="{ org }"
        :focus-on-mount="arrivedFromLockedPanel"
        @action="onGateAction"
      />
      <AssistantShell v-else ref="shell" placement="full" density="roomy" :bare="bare">
        <!-- Inside Home the page is already Home, so a bare view has no way back of its own -->
        <template v-if="!bare" #chrome-start>
          <OButton
            variant="ghost"
            size="sm"
            :icon-left="assistantGlyph.back"
            :aria-label="t('menu.home')"
            class="max-md:min-h-11 max-md:min-w-11"
            data-test="assistant-view-back-home"
            @click="backToHome"
          >
            <!-- A phone keeps the header's room for the chat title -->
            <span class="max-md:sr-only">{{ t("menu.home") }}</span>
          </OButton>
        </template>
      </AssistantShell>
    </div>
    <ODialog
      :open="learnOpen"
      size="md"
      :title="t('assistant.name')"
      data-test="assistant-view-learn-dialog"
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
  </OPageLayout>
</template>

<script lang="ts">
import type { GateCode, GateReason } from "@/composables/assistant";

export type AssistantViewState = "loading" | "gate" | "not_found" | "shell";

/** What `/assistant` renders for a gate (`10` §2; round 1 X-23): G1 members get not-found, never the setup card. */
export function viewFor(gate: GateCode, isAdmin: boolean): AssistantViewState {
  if (gate === "loading") return "loading";
  if (gate === "not_configured" && !isAdmin) return "not_found";
  if (gate === "available" || gate === "unhealthy") return "shell";
  return "gate";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The rail's opening width and limits; the splitter works in pixels of the root font size. */
export const RAIL_MIN_REM = 14;
// The layout's 230px default cuts the filter row and titles, so the rail opens at the Threads board's width.
export const RAIL_DEFAULT_REM = 22;
export const RAIL_MAX_REM = 26;

export function railPx(rem: number): number {
  const root =
    typeof document === "undefined"
      ? 16
      : parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Math.round(rem * (Number.isFinite(root) && root > 0 ? root : 16));
}

/** `chatId` is the server session id, else the local IndexedDB id. */
export function chatRef(chatId: string): { sid: string } | { chatId: number } | null {
  if (UUID.test(chatId)) return { sid: chatId };
  return /^\d+$/.test(chatId) ? { chatId: Number(chatId) } : null;
}
</script>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, provide, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import AssistantGateState, {
  type GateCta,
} from "@/components/ai-assistant/gate/AssistantGateState.vue";
import AssistantShell, {
  SHELL_ROUTE_CONTEXT,
  type ShellRouteState,
} from "@/components/ai-assistant/shell/AssistantShell.vue";
import AssistantHistoryList from "@/components/ai-assistant/history/AssistantHistoryList.vue";
import { takeLockedMove } from "@/components/ai-assistant/shell/lockedPanel";
import {
  useAssistantCapability,
  useAssistantHistory,
  useAssistantStore,
} from "@/composables/assistant";
import { fullThreadLocation, homeAskLocation, withoutThread } from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped } from "@/types/i18n";
import Error404 from "@/views/Error404.vue";

const props = withDefaults(
  defineProps<{
    chatId?: string | null;
    /** Inside Home's own layout: no rail or chat bar, and New chat goes back to Home's Ask box. */
    bare?: boolean;
  }>(),
  { chatId: null, bare: false },
);

const { t } = useI18nTyped();
const store = useAssistantStore();
const capability = useAssistantCapability();
const history = useAssistantHistory();
const route = useRoute();
const router = useRouter();
const vuex = useStore();
// Below lg the rail would squeeze the chat; All chats in the title menu lists them instead.
const { lgUp } = useBreakpoint();
const routeState = ref<ShellRouteState>("idle");
const learnOpen = ref(false);
const shell = ref<InstanceType<typeof AssistantShell> | null>(null);
// The locked sidebar's move lands here, so the hero's primary action takes the focus it left.
const arrivedFromLockedPanel = takeLockedMove();
let entered = false;
let generation = 0;
let settled = 0;
// The chat on screen when the last entry settled or New chat ran, which a superseded open must not replace.
let settledSid: string | null = null;
let lastShownSid: string | null = null;

const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const view = computed(() => viewFor(capability.gate.value, capability.value.isAdmin));
const gateReason = computed<GateReason>(() => {
  const gate = capability.gate.value;
  return gate === "not_entitled" || gate === "not_configured" || gate === "off_for_org"
    ? gate
    : "no_permission";
});
const chatId = computed(() => props.chatId || null);

provide(SHELL_ROUTE_CONTEXT, { state: routeState, newChat });

function newChat(): void {
  if (props.bare) {
    void router.push(homeAskLocation(route.query)).catch(() => undefined);
    return;
  }
  routeState.value = "idle";
  store.startNewChat({
    origin: { entryKind: "deep_link", objectKind: "none", container: "full_view" },
  });
  settledSid = store.state.shell.activeSid;
  if (chatId.value) void router.replace(fullThreadLocation(null, withoutThread(route.query)));
}

function createSession(): void {
  store.createSession({
    origin: { entryKind: "deep_link", objectKind: "none", container: "full_view" },
  });
}

// The pitch's Close leaves the page as × does; Learn what it does explains in place.
function onGateAction(cta: GateCta): void {
  if (cta === "learn_more") learnOpen.value = true;
  if (cta !== "close") return;
  backToHome();
}

function backToHome(): void {
  void router.push({ name: "home", query: withoutThread(route.query) }).catch(() => undefined);
}

// Entering decides skeleton or welcome before the first paint; a newer entry supersedes a slow one (`70` §6.2).
async function enter(): Promise<void> {
  generation += 1;
  const asked = generation;
  const id = chatId.value;
  const target = id ? chatRef(id) : null;
  // The URL catching up with the chat on screen (its first save) is not a new entry, but it ends any load it superseded.
  if (entered && isShown(target)) {
    routeState.value = "idle";
    settle(asked);
    return;
  }
  if (id) {
    routeState.value = "loading";
    let result: ShellRouteState = "not_found";
    let opened: string | null = null;
    try {
      if (target) {
        opened = await store.openSession(target);
        result = "idle";
      }
    } catch (err) {
      result =
        (err as { code?: string } | null)?.code === "deleted_elsewhere" ? "deleted" : "not_found";
    }
    if (asked !== generation) {
      restoreRouted(opened);
      return;
    }
    routeState.value = result;
    // A chat that floated out of this view comes back into it, so it never shows in both.
    if (opened && store.windowOf(opened))
      store.open({ kind: "full" }, { sid: opened, focus: "none" });
  } else if (!store.state.shell.activeSid && !deletedElsewhere()) {
    createSession();
  }
  settle(asked);
  store.open({ kind: "full" }, { focus: "composer" });
  if (!entered)
    trackAssistant("ai_container_opened", {
      from: "route",
      placement_mode: "full",
      turn_running: false,
      latency_ms: 0,
    });
  entered = true;
}

function settle(asked: number): void {
  settled = asked;
  settledSid = store.state.shell.activeSid;
}

// A superseded open still activates its chat, so the chat the URL names (or the one on screen) is brought back.
function restoreRouted(opened: string | null): void {
  if (!opened || settled !== generation || store.state.shell.activeSid !== opened) return;
  const now = chatId.value ? chatRef(chatId.value) : null;
  if (now) {
    if (!isShown(now)) void enter();
    return;
  }
  if (settledSid && settledSid !== opened && store.state.sessions[settledSid])
    store.setActive(settledSid);
}

// A chat deleted elsewhere keeps its deleted state on screen until New chat clears the notice or another chat shows.
function deletedElsewhere(): boolean {
  const notice = history.deletedNotice.value;
  return !!notice && !notice.opening && notice.sid === lastShownSid;
}

function isShown(target: ReturnType<typeof chatRef>): boolean {
  if (!target || !("sid" in target) || store.state.shell.placement.kind !== "full") return false;
  return target.sid === store.state.shell.activeSid && !!store.state.sessions[target.sid];
}

watch(
  () => store.state.shell.activeSid,
  (sid) => {
    if (sid) lastShownSid = sid;
  },
  { immediate: true },
);

watch(
  [() => view.value === "shell" && store.state.ready, chatId],
  ([ready]) => {
    if (ready) void enter();
  },
  { immediate: true },
);

// Leaving never touches the session: a running turn keeps running and the header light shows it.
function leave(): void {
  generation += 1;
  if (store.state.shell.placement.kind !== "full") return;
  trackAssistant("ai_container_closed", { reason: "route" });
  store.close("route");
}

// Home is kept alive, so coming back to a thread re-enters it instead of remounting.
onActivated(() => {
  if (entered && view.value === "shell" && store.state.ready) void enter();
});

onBeforeRouteLeave(() => leave());
onBeforeUnmount(leave);

defineExpose({ focusEntry: () => shell.value?.focusEntry() });
</script>
