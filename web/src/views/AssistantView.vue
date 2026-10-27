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
    :title="t('assistant.name')"
    :icon="assistantGlyph.assistant"
    bleed
    title-data-test="assistant-view-title"
    :sidebar-width="railPx(RAIL_REM)"
    :splitter-limits="[railPx(RAIL_MIN_REM), railPx(RAIL_MAX_REM)]"
    :resizable="view === 'shell'"
  >
    <template v-if="view === 'shell'" #sidebar>
      <AssistantHistoryList
        mode="rail"
        :current-sid="store.state.shell.activeSid"
        container="full_view"
        @new="shell?.askNew()"
      />
    </template>
    <div class="flex h-full min-h-0 flex-col" data-test="assistant-view" :data-view="view">
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
      <div v-else class="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col">
        <AssistantShell ref="shell" placement="full" density="roomy" />
      </div>
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

/** The rail's default and limits; the layout's splitter works in pixels of the root font size. */
export const RAIL_REM = 18;
export const RAIL_MIN_REM = 14;
export const RAIL_MAX_REM = 24;

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
import { computed, onBeforeUnmount, provide, ref, watch } from "vue";
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
import { useAssistantCapability, useAssistantStore } from "@/composables/assistant";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped } from "@/types/i18n";
import Error404 from "@/views/Error404.vue";

const { t } = useI18nTyped();
const store = useAssistantStore();
const capability = useAssistantCapability();
const route = useRoute();
const router = useRouter();
const vuex = useStore();
const routeState = ref<ShellRouteState>("idle");
const learnOpen = ref(false);
const shell = ref<InstanceType<typeof AssistantShell> | null>(null);
// The locked sidebar's move lands here, so the hero's primary action takes the focus it left.
const arrivedFromLockedPanel = takeLockedMove();
let entered = false;
let generation = 0;

const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const view = computed(() => viewFor(capability.gate.value, capability.value.isAdmin));
const gateReason = computed<GateReason>(() => {
  const gate = capability.gate.value;
  return gate === "not_entitled" || gate === "not_configured" || gate === "off_for_org"
    ? gate
    : "no_permission";
});
const chatId = computed(() => {
  const param = route.params.chatId;
  return typeof param === "string" && param ? param : null;
});

provide(SHELL_ROUTE_CONTEXT, { state: routeState, newChat });

function newChat(): void {
  routeState.value = "idle";
  store.setActive(null);
  createSession();
  if (chatId.value) void router.replace({ name: "assistant", query: route.query });
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
  if (window.history.state?.back) router.back();
  else void router.push("/");
}

// Entering decides skeleton or welcome before the first paint; a newer entry supersedes a slow one (`70` §6.2).
async function enter(): Promise<void> {
  generation += 1;
  const asked = generation;
  const id = chatId.value;
  const target = id ? chatRef(id) : null;
  if (id) {
    routeState.value = "loading";
    let result: ShellRouteState = "not_found";
    try {
      if (target) {
        await store.openSession(target);
        result = "idle";
      }
    } catch (err) {
      result =
        (err as { code?: string } | null)?.code === "deleted_elsewhere" ? "deleted" : "not_found";
    }
    if (asked !== generation) return;
    routeState.value = result;
  } else if (!store.state.shell.activeSid) {
    createSession();
  }
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

onBeforeRouteLeave(() => leave());
onBeforeUnmount(leave);
</script>
