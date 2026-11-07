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
    :aria-labelledby="layout === 'card' ? titleId : undefined"
    :aria-label="sectionName"
    class="w-full min-w-0"
    data-test="assistant-launcher"
    data-assistant-surface
    data-dd-privacy="mask"
    :data-state="goToOnly ? 'go_to' : state"
    :data-layout="layout"
  >
    <OCard variant="outlined" class="@container flex min-w-0 flex-col gap-3 p-3">
      <div v-if="layout === 'card'" class="flex min-h-7 min-w-0 flex-wrap items-center gap-2">
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

      <AssistantGateState
        v-if="state === 'gate' && layout === 'card'"
        reason="no_permission"
        size="inline"
        :is-admin="capability.isAdmin"
        :context="{ org, feature: 'chat' }"
      />
      <OInput
        v-else-if="layout !== 'chats'"
        ref="input"
        v-model="text"
        size="md"
        width="full"
        :disabled="state === 'loading' && !goToOnly"
        :placeholder="
          goToOnly ? t('home.agent.goToPlaceholder') : t('assistant.composer.placeholder')
        "
        :input-attrs="{
          'aria-label': goToOnly
            ? t('home.agent.goToName')
            : t('assistant.welcome.launcher.inputName', { product }),
          maxlength: MAX_LAUNCHER_CHARS,
          enterkeyhint: 'send',
          ...(goToShown && {
            role: 'combobox',
            'aria-haspopup': 'listbox',
            'aria-expanded': 'true',
            'aria-autocomplete': 'list',
            'aria-controls': GO_TO_LISTBOX_ID,
            'aria-activedescendant': results?.activeDescendant,
          }),
        }"
        class="min-w-0 max-md:[&>div]:h-11.5 pointer-coarse:[&>div]:h-11.5"
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
              v-if="!goToOnly && mdUp"
              :window="window"
              :disabled="state === 'loading'"
              align="end"
              @change="onTimeChange"
            />
            <AssistantContextSeesPopover v-if="!goToOnly && mdUp" :sid="null" hide-streams>
              <template #trigger>
                <AssistantIconButton
                  :label="t('assistant.context.title')"
                  :icon="assistantGlyph.info"
                  data-test="assistant-launcher-sees"
                />
              </template>
            </AssistantContextSeesPopover>
            <OButton
              v-if="!goToOnly"
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
        v-if="goToShown"
        class="border-border-default rounded-default bg-surface-base -mt-2 flex max-h-80 flex-col overflow-y-auto border border-[0.0625em] p-1"
        data-test="assistant-launcher-go-to"
      >
        <GoToResults
          ref="results"
          v-model:active="goToActive"
          :matches="goToMatches"
          :query="text"
          :listbox-id="GO_TO_LISTBOX_ID"
          data-test="assistant-launcher-go-to-results"
          @select="onGoToSelect"
          @close="text = ''"
        />
      </div>
      <!-- A phone keeps the field for the question, so the time and context controls sit under it -->
      <div
        v-if="!goToOnly && !mdUp && layout !== 'chats' && !(state === 'gate' && layout === 'card')"
        class="flex min-w-0 items-center gap-1"
        data-test="assistant-launcher-narrow-tools"
      >
        <AssistantTimePrefix
          :window="window"
          :disabled="state === 'loading'"
          align="start"
          @change="onTimeChange"
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
      </div>
      <slot v-if="goToOnly" name="note" />
      <div
        v-if="layout === 'overview' && !goToOnly && (pageChips.length || ghostChips.length)"
        class="flex min-w-0 flex-wrap items-center gap-1.5"
        data-test="assistant-launcher-page-chips"
      >
        <AssistantContextChip
          v-for="chip in pageChips"
          :key="chip.id"
          :chip="chip"
          :popup="false"
          @open="showPageSection"
          @remove="removePageKey(chip)"
        />
        <AssistantContextChip
          v-for="chip in ghostChips"
          :key="chip.id"
          :chip="chip"
          state="ghost"
          :popup="false"
          @open="addBackPageKey(chip)"
        />
      </div>

      <div
        :class="[
          'grid min-w-0 grid-cols-1 gap-x-6 gap-y-3',
          showSuggestions && layout === 'card' && '@[40rem]:grid-cols-2',
        ]"
      >
        <div
          v-if="showSuggestions && layout !== 'chats'"
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
          v-if="layout !== 'overview'"
          :class="['flex min-w-0 flex-col', hasInProgress && 'max-md:order-first']"
          data-test="assistant-launcher-your-chats"
        >
          <div class="flex min-h-7 min-w-0 items-center gap-2">
            <h3 class="text-text-secondary min-w-0 flex-1 ps-1.5 text-xs">
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
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
import AssistantContextChip from "@/components/ai-assistant/context/AssistantContextChip.vue";
import AssistantTimePrefix from "@/components/ai-assistant/context/AssistantTimePrefix.vue";
import GoToResults from "@/components/goto/GoToResults.vue";
import AssistantGateState from "@/components/ai-assistant/gate/AssistantGateState.vue";
import {
  openAssistant,
  starterPayload,
  timeWindowOf,
  useAssistantCapability,
  useAssistantContext,
  useAssistantHistory,
  useAssistantName,
  useAssistantRuns,
  useAssistantStarters,
  useAssistantStore,
  type ComposerState,
  type ContextChip,
  type Starter,
  type TimeWindow,
} from "@/composables/assistant";
import { onOverviewFocusRequest } from "@/composables/goto/goToRequests";
import type { HomeReturnState } from "@/composables/goto/homeReturn";
import type { GoToMatch } from "@/composables/goto/types";
import { openGoToMatch, useGoToIndex } from "@/composables/goto/useGoToIndex";
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
import { formatRelativeCompact } from "@/utils/formatters";

import AssistantStarterRow from "./AssistantStarterRow.vue";

const props = withDefaults(
  defineProps<{
    /** `overview` is the Overview's ask header (no chats), `chats` its right-column chat list. */
    layout?: "card" | "overview" | "chats";
    /** The page range in ms; the time chip mirrors it and a pick moves it. */
    pageRange?: ComposerState["timeOverride"];
    /** Set on Home when the agent cannot answer: the field is Go to only and the `note` slot says why. */
    goToOnly?: boolean;
  }>(),
  { layout: "card", pageRange: null, goToOnly: false },
);

const emit = defineEmits<{
  "update:pageRange": [range: NonNullable<ComposerState["timeOverride"]>];
}>();

const GO_TO_LISTBOX_ID = "assistant-launcher-go-to-listbox";

// Overlays opened from here are teleported to body, so they carry the assistant colour roles with them.
provideAssistantSurface();

const { t } = useI18nTyped();
const { product } = useAssistantName();
const router = useRouter();
const route = useRoute();
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
const goToOnly = computed(() => props.layout === "overview" && props.goToOnly);
// The card names itself with its heading; the Home layouts draw none, so they carry the name.
const sectionName = computed(() => {
  if (props.layout === "card") return undefined;
  if (props.layout === "chats") return t("assistant.welcome.launcher.recent");
  return goToOnly.value
    ? t("home.agent.goToName")
    : t("assistant.welcome.launcher.inputName", { product });
});
// On the Overview the ask field stays with the dock open, and always starts a new chat.
const shown = computed(
  () => goToOnly.value || (state.value !== null && (props.layout !== "card" || !sidebarOpen.value)),
);
const creditsExhausted = computed(() => capability.value.creditMode === "exhausted");
const shownStarters = computed(() => starters.value.slice(0, LAUNCHER_ROWS));
// The sidebar is the assistant while it is open, so Home shows no second one beside it.
const sidebarOpen = computed(() => assistant.state.shell.placement.kind === "sidebar");
const showSuggestions = computed(() => state.value !== "gate" && !goToOnly.value);

const window = computed<TimeWindow>(() =>
  props.pageRange ? { ...props.pageRange, source: "page" } : timeWindowOf(null, timeOverride.value),
);

// The launcher has no chat yet, so it keeps the removals itself and hands them to the new chat on send.
const context = useAssistantContext(null);
const removedPageKeys = ref<string[]>([]);
const allPageChips = computed(() =>
  props.layout === "overview"
    ? context.chips.value.filter((chip) => chip.provenance === "page" && chip.kind !== "time")
    : [],
);
const pageChips = computed(() =>
  allPageChips.value.filter((chip) => !removedPageKeys.value.includes(fieldOf(chip))),
);
const ghostChips = computed(() =>
  allPageChips.value
    .filter((chip) => removedPageKeys.value.includes(fieldOf(chip)))
    .map((chip) => ({ ...chip, id: `ghost:${fieldOf(chip)}` })),
);
watch(org, () => (removedPageKeys.value = []));

const results = ref<InstanceType<typeof GoToResults> | null>(null);
const goToActive = ref(-1);
const { matches: goToMatches } = useGoToIndex(text, {
  canAsk: () => state.value === "ready" && !goToOnly.value,
  enabled: () => props.layout === "overview" && shown.value,
});
const goToShown = computed(() => props.layout === "overview" && text.value.trim() !== "");

function onTimeChange(range: ComposerState["timeOverride"]): void {
  if (props.layout !== "overview" || !props.pageRange) {
    timeOverride.value = range;
    return;
  }
  if (range) emit("update:pageRange", range);
}

function fieldOf(chip: ContextChip): string {
  return chip.ref?.type ?? chip.id.replace(/^ghost:/, "");
}

function removePageKey(chip: ContextChip): void {
  const field = fieldOf(chip);
  if (!removedPageKeys.value.includes(field))
    removedPageKeys.value = [...removedPageKeys.value, field];
}

// The page chips summarise Home's Now list, so opening one takes the reader there.
function showPageSection(): void {
  const section = document.querySelector<HTMLElement>('[data-test="home-now"]');
  if (!section) return;
  const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  section.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  if (!section.hasAttribute("tabindex")) section.setAttribute("tabindex", "-1");
  section.focus({ preventScroll: true });
}

function addBackPageKey(chip: ContextChip): void {
  const field = fieldOf(chip);
  removedPageKeys.value = removedPageKeys.value.filter((key) => key !== field);
}

// A Go to trip from the Overview returns to its row and range with the field focused.
function homeReturnState(): HomeReturnState {
  const state: HomeReturnState = { focus: "ask" };
  const row = route.query.row;
  if (typeof row === "string") state.row = row;
  const range = props.pageRange;
  if (range?.period) state.period = range.period;
  else if (range) {
    state.from = range.from * 1000;
    state.to = range.to * 1000;
  }
  return state;
}

function onGoToSelect(match: GoToMatch): void {
  if (match.kind === "ask") {
    ask(false);
    return;
  }
  const line = text.value.trim();
  text.value = "";
  openGoToMatch(match, router, line, homeReturnState());
}

function focusField(clear: boolean): void {
  if (clear) text.value = "";
  input.value?.focus();
}

// `/` on Home lands here while the field can take a question; nothing listens while it is hidden or gated.
const askListening = computed(
  () => shown.value && (state.value === "ready" || goToOnly.value) && props.layout !== "chats",
);
let stopFocusListener: (() => void) | null = null;
watch(
  askListening,
  (listening) => {
    stopFocusListener?.();
    stopFocusListener = listening ? onOverviewFocusRequest(() => focusField(false)) : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => stopFocusListener?.());

// Back to Home with `focus=ask` clears and focuses the field once, then drops the key.
watch(
  () => route.query.focus === "ask" && shown.value && state.value === "ready",
  async (focusNow) => {
    if (!focusNow || props.layout === "chats") return;
    await nextTick();
    focusField(true);
    const query = { ...route.query };
    delete query.focus;
    void router.replace({ query }).catch(() => undefined);
  },
  { immediate: true },
);

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
      at: row.updatedAt ? raw(formatRelativeCompact(row.updatedAt)) : null,
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
  if (goToShown.value && !event.shiftKey && results.value?.onKeydown(event)) return;
  if (event.key === "Enter") {
    event.preventDefault();
    if (goToOnly.value) openFirstMatch();
    else ask(event.shiftKey);
  } else if (event.key === "Escape") {
    // Escape never clears what was typed; only the clear button does (round 1 X-20).
    (event.target as HTMLElement | null)?.blur();
  }
}

// With no agent to ask, Enter opens the best match, as the palette does.
function openFirstMatch(): void {
  const first = goToMatches.value.find((match) => match.kind !== "ask");
  if (first) onGoToSelect(first);
}

// The launcher is a door, not a composer: the line goes to `/assistant` and nothing stays here (`70` §5 note 6).
function ask(stage: boolean): void {
  if (state.value !== "ready" || goToOnly.value) return;
  const line = text.value.trim();
  if (!line) return openFull();
  text.value = "";
  const overview = props.layout === "overview";
  const removed = overview ? removedPageKeys.value : [];
  const time = overview && props.pageRange ? props.pageRange : timeOverride.value;
  if (overview) removedPageKeys.value = [];
  void openAssistant({
    entryKind: "home_launcher",
    entryVerb: "ask",
    objectKind: "none",
    intent: stage ? "stage" : "send",
    thread: "new",
    container: overview && sidebarOpen.value ? "sidebar" : "full",
    payload: {
      text: line,
      chips: [],
      ...(time && { timeOverride: time }),
      ...(removed.length > 0 && { removedPageKeys: removed }),
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
