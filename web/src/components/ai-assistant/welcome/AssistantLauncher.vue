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
  <section
    v-if="shown"
    :aria-labelledby="titleId"
    class="w-full min-w-0"
    data-test="assistant-launcher"
    data-assistant-surface
    data-dd-privacy="mask"
    :data-state="state"
  >
    <OCard variant="outlined" class="@container flex min-w-0 flex-col gap-3 p-3">
      <div class="flex min-h-7 min-w-0 flex-wrap items-center gap-2">
        <OIcon :name="assistantGlyph.assistant" size="sm" class="text-text-secondary shrink-0" />
        <h2 :id="titleId" class="text-text-heading text-sm font-medium">
          {{ t("assistant.name") }}
        </h2>
        <OTag
          v-if="creditsExhausted"
          :label="t('assistant.credits.exhaustedTag')"
          clickable
          data-test="assistant-launcher-credits"
          @click="openBilling"
        />
        <span class="flex-1" />
        <OButton
          v-if="mdUp"
          variant="ghost-primary"
          size="chip"
          :icon-right="assistantGlyph.goTo"
          :class="TOUCH_TARGET_CLASS"
          data-test="assistant-launcher-open"
          @click="openFull"
        >
          {{ t("assistant.welcome.launcher.openFull") }}
        </OButton>
      </div>

      <template v-if="folded" />
      <AssistantGateState
        v-else-if="state === 'gate'"
        reason="no_permission"
        size="inline"
        :is-admin="capability.isAdmin"
        :context="{ org, feature: 'chat' }"
      />
      <OInput
        v-else
        ref="input"
        v-model="text"
        size="md"
        width="full"
        :disabled="state === 'loading'"
        :placeholder="t('assistant.composer.placeholder')"
        :input-attrs="{
          'aria-label': t('assistant.welcome.launcher.inputName', { product }),
          maxlength: MAX_LAUNCHER_CHARS,
          enterkeyhint: 'send',
        }"
        class="min-w-0"
        data-test="assistant-launcher-input"
        @keydown="onKeydown"
      >
        <template #icon-right>
          <span class="flex shrink-0 items-center gap-0.5">
            <AssistantIconButton
              v-if="text"
              :label="t('assistant.welcome.launcher.clear')"
              :icon="assistantGlyph.close"
              data-test="assistant-launcher-clear"
              @click="clear"
            />
            <AssistantTimePrefix
              :window="window"
              :disabled="state === 'loading'"
              align="end"
              @change="(range) => (timeOverride = range)"
            />
            <AssistantContextSeesPopover :sid="null" hide-streams>
              <template #trigger>
                <AssistantIconButton
                  :label="t('assistant.context.title')"
                  :icon="assistantGlyph.info"
                  data-test="assistant-launcher-sees"
                />
              </template>
            </AssistantContextSeesPopover>
            <OButton
              variant="primary"
              size="xs"
              :icon-left="mdUp ? undefined : assistantGlyph.send"
              :disabled="state === 'loading' || !text.trim()"
              class="shrink-0 max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11"
              data-test="assistant-launcher-ask"
              @click="ask(false)"
            >
              <span :class="mdUp ? '' : 'sr-only'">{{ t("assistant.welcome.launcher.ask") }}</span>
            </OButton>
          </span>
        </template>
      </OInput>

      <div
        v-if="!folded"
        :class="[
          'grid min-w-0 grid-cols-1 gap-x-6 gap-y-3',
          showSuggestions && '@[40rem]:grid-cols-2',
        ]"
      >
        <div
          v-if="showSuggestions"
          class="flex min-w-0 flex-col"
          data-test="assistant-launcher-suggestions"
        >
          <ul
            v-if="state === 'loading'"
            class="flex flex-col gap-2"
            data-test="assistant-launcher-loading"
          >
            <li v-for="n in 3" :key="n"><OSkeleton type="text" class="h-5 w-3/5" /></li>
          </ul>
          <ul v-else class="flex flex-col items-start">
            <li v-for="(starter, index) in shownStarters" :key="starter.id" class="max-w-full">
              <AssistantStarterRow
                :label="starter.label"
                :data-test="`assistant-launcher-starter-${index}`"
                @click="pickStarter(starter, index)"
              />
            </li>
          </ul>
        </div>
        <!-- A chat that answers or waits outranks suggestions on a phone (PO A21). -->
        <div
          :class="['flex min-w-0 flex-col', hasInProgress && 'max-md:order-first']"
          data-test="assistant-launcher-your-chats"
        >
          <div class="flex min-h-7 min-w-0 items-center gap-2">
            <h3 class="text-text-secondary min-w-0 flex-1 text-xs">
              {{ t("assistant.welcome.launcher.recent") }}
            </h3>
            <OButton
              v-if="recent.length"
              variant="ghost-primary"
              size="chip"
              :class="['shrink-0', TOUCH_TARGET_CLASS]"
              data-test="assistant-launcher-all-chats"
              @click="openFull"
              >{{ t("assistant.welcome.launcher.allChats") }}</OButton
            >
          </div>
          <ul v-if="state === 'loading'" class="flex flex-col gap-3 pt-2">
            <li v-for="n in 2" :key="n"><OSkeleton type="text" class="h-5 w-2/3" /></li>
          </ul>
          <OBanner
            v-else-if="recentFailed"
            variant="error-soft"
            bar
            dense
            icon="error-outline"
            :content="t('assistant.history.serverError')"
            class="rounded-default min-h-9"
            data-test="assistant-launcher-recent-failed"
          >
            <template #actions>
              <OButton
                variant="ghost"
                size="xs"
                :class="TOUCH_TARGET_CLASS"
                data-test="assistant-launcher-recent-retry"
                @click="history.retry()"
              >
                {{ t("common.retry") }}
              </OButton>
            </template>
          </OBanner>
          <OText
            v-else-if="recent.length === 0"
            variant="meta"
            as="p"
            class="flex min-h-7 items-center"
            data-test="assistant-launcher-recent-empty"
          >
            {{ t("assistant.welcome.launcher.noRecent") }}
          </OText>
          <ul v-else class="flex flex-col">
            <li v-for="(row, index) in recent" :key="row.sid" class="min-w-0">
              <OButton
                variant="ghost"
                size="sm"
                block
                class="group h-8! justify-start! gap-2 px-1.5! text-start font-normal max-md:h-11! pointer-coarse:h-11!"
                :data-test="`assistant-launcher-recent-${index}`"
                :data-status="row.status ?? undefined"
                @click="openChat(row.sid)"
              >
                <OTruncatedText class="text-text-heading min-w-0 flex-1">{{
                  row.title
                }}</OTruncatedText>
                <span v-if="row.status || row.at" class="sr-only">, </span>
                <OText
                  v-if="row.status"
                  variant="meta"
                  :class="[
                    chatStatusClass(row.status, false),
                    'group-hover:text-text-body shrink-0',
                  ]"
                  data-test="assistant-launcher-recent-status"
                >
                  {{ chatStatusWord(row.status, row.expiresAt, clock, t) }}
                </OText>
                <OText
                  v-else-if="row.at"
                  variant="meta"
                  class="group-hover:text-text-body shrink-0"
                  >{{ row.at }}</OText
                >
              </OButton>
            </li>
          </ul>
        </div>
      </div>
    </OCard>
  </section>
</template>

<script lang="ts">
/** The launcher's line is one prompt; longer text belongs in the full view's composer. */
export const MAX_LAUNCHER_CHARS = 4_000;

/** Rows of each column (`70` §2.1). */
export const LAUNCHER_ROWS = 3;

/** In-progress chats can sit below the latest ones, so Your chats looks this far down the list. */
const RECENT_LOOKUP = 20;

// G0 and G1 leave no gap on Home: the header carries the locked or muted button (DG-04 AC 3, DG-05 AC 1).
const HIDDEN_GATES: ReadonlySet<string> = new Set([
  "not_entitled",
  "not_configured",
  "off_for_org",
]);

/** What the card renders for a gate; `null` renders nothing. */
export function launcherState(gate: string): "loading" | "gate" | "ready" | null {
  if (gate === "loading") return "loading";
  if (HIDDEN_GATES.has(gate)) return null;
  if (gate === "no_permission") return "gate";
  return "ready";
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import { provideAssistantSurface } from "@/components/ai-assistant/common/assistantSurface";
import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import {
  chatStatusClass,
  chatStatusOf,
  chatStatusWord,
  inProgressFirst,
  isInProgress,
} from "@/components/ai-assistant/history/chatStatus";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import AssistantContextSeesPopover from "@/components/ai-assistant/context/AssistantContextSeesPopover.vue";
import AssistantTimePrefix from "@/components/ai-assistant/context/AssistantTimePrefix.vue";
import AssistantGateState from "@/components/ai-assistant/gate/AssistantGateState.vue";
import {
  openAssistant,
  starterPayload,
  timeWindowOf,
  useAssistantCapability,
  useAssistantHistory,
  useAssistantName,
  useAssistantRuns,
  useAssistantStarters,
  useAssistantStore,
  type ComposerState,
  type Starter,
} from "@/composables/assistant";
import useBreakpoint from "@/composables/useBreakpoint";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatRelative } from "@/utils/formatters";

import AssistantStarterRow from "./AssistantStarterRow.vue";

// Overlays opened from here are teleported to body, so they carry the assistant colour roles with them.
provideAssistantSurface();

const { t } = useI18nTyped();
const { product } = useAssistantName();
const router = useRouter();
const vuex = useStore();
const capability = useAssistantCapability();
const assistant = useAssistantStore();
const { mdUp } = useBreakpoint();
const { starters, loading } = useAssistantStarters({ page: "home" });

const titleId = `assistant-launcher-title-${useId()}`;
const text = ref("");
const timeOverride = ref<ComposerState["timeOverride"]>(null);
const input = ref<InstanceType<typeof OInput> | null>(null);

const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const state = computed(() => {
  const gated = launcherState(capability.gate.value);
  return gated === "ready" && loading.value ? "loading" : gated;
});
const shown = computed(() => state.value !== null);
const creditsExhausted = computed(() => capability.value.creditMode === "exhausted");
const shownStarters = computed(() => starters.value.slice(0, LAUNCHER_ROWS));
// The sidebar is the composer while it is open, so the card folds to its header (D5 decision 10).
const folded = computed(() => assistant.state.shell.placement.kind === "sidebar");
const showSuggestions = computed(() => state.value !== "gate");

const window = computed(() => timeWindowOf(null, timeOverride.value));

const history = useAssistantHistory();
const recentRows = history.recent(RECENT_LOOKUP);
const runs = useAssistantRuns();
const runBySid = computed(() => new Map(runs.rows.value.map((row) => [row.sid, row])));
const recent = computed(() =>
  inProgressFirst(
    recentRows.value.map((row) => ({
      sid: row.sid,
      expiresAt: runBySid.value.get(row.sid)?.expiresAt ?? null,
      title: row.title,
      status: chatStatusOf(row, assistant.state.sessions[row.sid]?.turn.state),
      at: row.updatedAt ? raw(formatRelative(row.updatedAt)) : null,
    })),
    (row) => row.status,
  ).slice(0, LAUNCHER_ROWS),
);
const recentFailed = computed(() => history.listState.value.status === "error");
const hasInProgress = computed(() => recent.value.some((row) => isInProgress(row.status)));
onMounted(() => history.ensureLoaded());

// Only a waiting row with a known end counts down, so the clock runs only then.
const clock = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;
watch(
  () => recent.value.some((row) => row.status === "needs_you" && row.expiresAt !== null),
  (counting) => {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = counting ? setInterval(() => (clock.value = Date.now()), 1_000) : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer);
});

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter") {
    event.preventDefault();
    ask(event.shiftKey);
  } else if (event.key === "Escape") {
    // Escape never clears what was typed; only the clear button does (round 1 X-20).
    (event.target as HTMLElement | null)?.blur();
  }
}

// The launcher is a door, not a composer: the line goes to `/assistant` and nothing stays here (`70` §5 note 6).
function ask(stage: boolean): void {
  if (state.value !== "ready") return;
  const line = text.value.trim();
  if (!line) return openFull();
  text.value = "";
  void openAssistant({
    entryKind: "home_launcher",
    entryVerb: "ask",
    objectKind: "none",
    intent: stage ? "stage" : "send",
    thread: "new",
    container: "full",
    payload: {
      text: line,
      chips: [],
      ...(timeOverride.value && { timeOverride: timeOverride.value }),
    },
  });
}

function pickStarter(starter: Starter, index: number): void {
  trackAssistant("ai_welcome_starter", { starter_kind: starter.kind, index, via: "click" });
  // The full view's route opens the chat and shows its own not-found or deleted state.
  if (starter.kind === "recent" && (starter.sid || starter.chatId !== undefined)) {
    openChat(starter.sid ?? String(starter.chatId));
    return;
  }
  void openAssistant({
    entryKind: "home_launcher",
    entryVerb: "ask",
    objectKind: "none",
    intent: "stage",
    thread: "new",
    container: "full",
    payload: {
      ...starterPayload(starter, org.value),
      ...(timeOverride.value && { timeOverride: timeOverride.value }),
    },
  });
}

function clear(): void {
  text.value = "";
  input.value?.focus();
}

function openFull(): void {
  void router.push({ name: "assistant" }).catch(() => undefined);
}

function openChat(sid: string): void {
  void router.push({ name: "assistant", params: { chatId: sid } }).catch(() => undefined);
}

function openBilling(): void {
  void router.push({ name: "plans", query: { org_identifier: org.value } }).catch(() => undefined);
}
</script>
