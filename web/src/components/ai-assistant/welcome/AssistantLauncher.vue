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
    <component
      :is="layout === 'overview' ? 'div' : OCard"
      v-bind="layout === 'overview' ? {} : { variant: 'outlined' }"
      :class="['@container flex min-w-0 flex-col gap-3', layout === 'overview' ? '' : 'p-3']"
    >
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
      <div v-else-if="layout !== 'chats'" ref="field" class="relative min-w-0">
        <AssistantMentionMenu
          ref="mention"
          :open="mentionAt !== null"
          :query="mentionQuery"
          :org="org"
          :listbox-id="MENTION_LISTBOX_ID"
          :sid="null"
          :class="['md:z-30', mentionBelow && 'md:top-full! md:bottom-auto! md:mt-1! md:mb-0!']"
          @select="pickMention"
          @close="closeMention"
        />
        <AssistantComposerFrame
          ref="input"
          :model-value="shownText"
          :state="goToOnly ? 'go_to' : (state ?? undefined)"
          :disabled="fieldLoading && !goToOnly"
          :placeholder="placeholder"
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
            ...(mentionAt !== null && {
              role: 'combobox',
              'aria-haspopup': 'listbox',
              'aria-expanded': 'true',
              'aria-autocomplete': 'list',
              'aria-controls': MENTION_LISTBOX_ID,
              'aria-activedescendant': mention?.activeId,
            }),
          }"
          data-test="assistant-launcher-input"
          @update:model-value="onInput"
          @keydown="onKeydown"
        >
          <template v-if="!goToOnly" #strip>
            <AssistantComposerStrip :notice="null">
              <AssistantChipTray
                v-model:expanded="chipsExpanded"
                :items="shownTrayChips"
                :hidden-count="hiddenTrayChips"
                data-test="assistant-launcher-chips"
              >
                <template #leading>
                  <AssistantTimePrefix
                    :window="window"
                    :disabled="fieldLoading"
                    align="start"
                    @change="onTimeChange"
                  />
                </template>
                <template #chip="{ item }">
                  <AssistantContextChip
                    v-if="item.role === 'mention'"
                    :chip="item.chip"
                    compact
                    :short-label="item.chip.short"
                    :popup="false"
                    data-test="assistant-launcher-mention-chip"
                    @remove="removeMention(item.chip)"
                  />
                  <AssistantContextChip
                    v-else-if="item.role === 'page'"
                    :chip="item.chip"
                    compact
                    :short-label="item.chip.short"
                    :popup="false"
                    data-test="assistant-launcher-page-chip"
                    @open="showPageSection"
                    @remove="removePageKey(item.chip)"
                  />
                  <AssistantContextChip
                    v-else
                    :chip="item.chip"
                    compact
                    :short-label="item.chip.short"
                    state="ghost"
                    :popup="false"
                    data-test="assistant-launcher-page-chip"
                    @open="addBackPageKey(item.chip)"
                  />
                </template>
              </AssistantChipTray>
              <template #sees>
                <AssistantContextSeesPopover :sid="null" hide-streams>
                  <template #trigger>
                    <AssistantIconButton
                      :label="t('assistant.context.title')"
                      :icon="assistantGlyph.info"
                      data-test="assistant-launcher-sees"
                    />
                  </template>
                </AssistantContextSeesPopover>
              </template>
            </AssistantComposerStrip>
          </template>
          <template #bar>
            <AssistantComposerBottomRow>
              <template v-if="!goToOnly" #agent>
                <AssistantAgentPill :agent="agent ?? DEFAULT_AGENT" :disabled="fieldLoading" />
              </template>
              <AssistantIconButton
                v-if="text"
                :label="t('assistant.welcome.launcher.clear')"
                :icon="assistantGlyph.close"
                data-test="assistant-launcher-clear"
                @click="clear"
              />
              <AssistantDictationWave v-if="voice.mine.value" :elapsed-ms="voice.elapsedMs.value" />
              <AssistantDictateButton
                v-if="!goToOnly && voice.mic.value !== 'none' && voice.mic.value !== 'off'"
                :mic="voice.mic.value"
                :pressed="voice.mine.value"
                :disabled-reason="voice.helperLine.value ?? undefined"
                @press="onMicPress"
              />
              <AssistantIconButton
                v-if="!goToOnly"
                variant="primary"
                size="md"
                :label="t('assistant.welcome.launcher.ask')"
                :icon="assistantGlyph.send"
                :disabled="fieldLoading || !text.trim()"
                :class="ROUND_ACTION_CLASS"
                data-test="assistant-launcher-ask"
                @click="ask(false)"
              />
            </AssistantComposerBottomRow>
          </template>
        </AssistantComposerFrame>
      </div>
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
          @close="dismissGoTo"
        />
      </div>
      <slot v-if="goToOnly" name="note" />

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
          <ul
            v-else
            :class="[
              'grid min-w-0 grid-cols-1 gap-2',
              layout === 'overview' && '@[40rem]:grid-cols-3',
            ]"
          >
            <li v-for="(starter, index) in shownStarters" :key="starter.id" class="flex min-w-0">
              <AssistantStarterRow
                :label="starter.label"
                :icon="starterIcon(starter.kind)"
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
              {{ t("assistant.welcome.launcher.recentThreads") }}
            </h3>
            <OButton
              v-if="recent.length"
              variant="ghost-primary"
              size="chip"
              :class="['shrink-0', TOUCH_TARGET_CLASS]"
              data-test="assistant-launcher-all-chats"
              @click="openFull"
              >{{ t("assistant.welcome.launcher.allThreads") }}</OButton
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
            {{ t("assistant.welcome.launcher.noThreadsYet") }}
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
    </component>
  </section>
</template>

<script lang="ts">
import type { AgentId, ContextChip, Sid } from "@/composables/assistant";

// A door always starts a new chat with the default agent; the chat's own picker changes it later.
const DEFAULT_AGENT: AgentId = "o2-ai";

// Dictation writes here, never to a chat; the line becomes a chat only when it is sent.
const LAUNCHER_DRAFT: Sid = "assistant-launcher";

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

// A Home chip is the user's @ pick, a page chip, or a removed page chip offered back.
interface TrayChip {
  id: string;
  chip: ContextChip;
  role: "mention" | "page" | "ghost";
}

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
import AssistantChipTray, {
  useChipCollapse,
} from "@/components/ai-assistant/context/AssistantChipTray.vue";
import AssistantContextChip from "@/components/ai-assistant/context/AssistantContextChip.vue";
import AssistantMentionMenu, {
  type MentionOption,
} from "@/components/ai-assistant/context/AssistantMentionMenu.vue";
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
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatRelativeCompact } from "@/utils/formatters";

import AssistantAgentPill from "@/components/ai-assistant/composer/AssistantAgentPill.vue";
import AssistantComposerBottomRow, {
  ROUND_ACTION_CLASS,
} from "@/components/ai-assistant/composer/AssistantComposerBottomRow.vue";
import AssistantComposerFrame from "@/components/ai-assistant/composer/AssistantComposerFrame.vue";
import AssistantComposerStrip from "@/components/ai-assistant/composer/AssistantComposerStrip.vue";
import AssistantDictateButton from "@/components/ai-assistant/composer/AssistantDictateButton.vue";
import AssistantDictationWave from "@/components/ai-assistant/composer/AssistantDictationWave.vue";
import { useAssistantVoice } from "@/components/ai-assistant/composer/useAssistantVoice";
import { useComposerWidth } from "@/components/ai-assistant/composer/useComposerWidth";

import AssistantStarterRow from "./AssistantStarterRow.vue";
import { starterIcon } from "./starterIcons";

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
const MENTION_LISTBOX_ID = "assistant-launcher-mention-listbox";
// The menu's max height (20rem) plus the header's height.
const MENTION_ROOM_PX = 400;

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
const input = ref<InstanceType<typeof AssistantComposerFrame> | null>(null);
const mention = ref<InstanceType<typeof AssistantMentionMenu> | null>(null);
const mentionAt = ref<number | null>(null);
const mentionQuery = ref("");
const mentionBelow = ref(false);
// The launcher has no chat yet, so its @ picks wait here and go with the line it opens.
const mentionChips = ref<ContextChip[]>([]);
const agent = ref<AgentId | null>(null);

const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const state = computed(() => {
  const gated = launcherState(capability.gate.value);
  return gated === "ready" && loading.value ? "loading" : gated;
});
const goToOnly = computed(() => props.layout === "overview" && props.goToOnly);
// Starters refetch when the @ menu loads the same lists; only the gate may disable the field, or it drops focus.
const fieldReady = computed(() => launcherState(capability.gate.value) === "ready");
const fieldLoading = computed(() => capability.gate.value === "loading");
// The card names itself with its heading; the Home layouts draw none, so they carry the name.
const sectionName = computed(() => {
  if (props.layout === "card") return undefined;
  if (props.layout === "chats") return t("assistant.welcome.launcher.recentThreads");
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

// The Home field folds chips into "+N" at the composer's widths, so a phone never squashes them.
const field = ref<HTMLElement | null>(null);
const fieldWidth = useComposerWidth(field);
const chipLayout = computed(() => ({
  narrow: fieldWidth.narrow.value,
  wide: fieldWidth.wide.value,
}));
const chipsExpanded = ref(false);
const trayChips = computed<TrayChip[]>(() => [
  ...mentionChips.value.map((chip) => ({ id: chip.id, chip, role: "mention" as const })),
  ...pageChips.value.map((chip) => ({ id: chip.id, chip, role: "page" as const })),
  ...ghostChips.value.map((chip) => ({ id: chip.id, chip, role: "ghost" as const })),
]);
const { shown: shownTrayChips, hiddenCount: hiddenTrayChips } = useChipCollapse(
  trayChips,
  chipLayout,
  chipsExpanded,
);

const results = ref<InstanceType<typeof GoToResults> | null>(null);
const goToActive = ref(-1);
const { matches: goToMatches } = useGoToIndex(text, {
  canAsk: () => state.value === "ready" && !goToOnly.value,
  enabled: () => props.layout === "overview" && shown.value,
});
const goToDismissed = ref(false);
const goToShown = computed(
  () =>
    props.layout === "overview" &&
    text.value.trim() !== "" &&
    mentionAt.value === null &&
    !goToDismissed.value,
);
const mentionsOn = computed(() => fieldReady.value && !goToOnly.value);
const placeholder = computed(() =>
  goToOnly.value ? t("home.agent.goToPlaceholder") : t("assistant.composer.placeholderAt"),
);

const coarse = ref(!!globalThis.matchMedia?.("(pointer: coarse)")?.matches);
const voice = useAssistantVoice({
  field: () => input.value?.textarea ?? null,
  ensureSid: () => LAUNCHER_DRAFT,
  draftOf: () => text.value,
  writeDraft: (_sid, value) => (text.value = value),
  blocked: () => !shown.value || state.value !== "ready" || goToOnly.value,
  tap: () => undefined,
  touch: () => !mdUp.value && coarse.value,
  say: () => undefined,
});
const shownText = computed(() => voice.shown(text.value));

function onInput(value: string): void {
  text.value = value;
  goToDismissed.value = false;
  voice.noteEdit(input.value?.textarea?.selectionStart ?? value.length);
  void nextTick(detectMention);
}

// The same `@` rule as the composer: only at a word boundary, so `ops@acme.com` stays text.
function detectMention(): void {
  const target = input.value?.textarea;
  if (!target || !mentionsOn.value) return closeMention();
  const before = target.value.slice(0, target.selectionStart ?? 0);
  const start = Math.max(before.lastIndexOf(" "), before.lastIndexOf("\n")) + 1;
  const token = before.slice(start);
  if (!token.startsWith("@") || /\s/.test(token)) return closeMention();
  // The menu opens above as in the composer, unless the field sits too near the top to hold it.
  if (mentionAt.value === null)
    mentionBelow.value = target.getBoundingClientRect().top < MENTION_ROOM_PX;
  mentionAt.value = start;
  mentionQuery.value = token.slice(1);
}

function closeMention(): void {
  mentionAt.value = null;
  mentionQuery.value = "";
}

function pickMention(option: MentionOption): void {
  const at = mentionAt.value;
  closeMention();
  if (at === null || text.value[at] !== "@") return;
  if (option.agent) agent.value = option.agent;
  else if (option.chip && !mixedStream(option.chip)) {
    const chip = option.chip;
    if (!mentionChips.value.some((held) => held.id === chip.id))
      mentionChips.value = [...mentionChips.value, chip];
  } else return;
  const rest = text.value.slice(at).search(/\s/);
  const end = rest === -1 ? text.value.length : at + rest;
  text.value = text.value.slice(0, at) + text.value.slice(end);
  void nextTick(() => {
    input.value?.focus();
    input.value?.textarea?.setSelectionRange(at, at);
  });
}

// One stream type per request: a stream of another type than the one already held is refused.
function mixedStream(chip: ContextChip): boolean {
  if (chip.kind !== "stream") return false;
  const held = mentionChips.value.find((other) => other.kind === "stream");
  return !!held && (held.ref?.streamType ?? "logs") !== (chip.ref?.streamType ?? "logs");
}

function removeMention(chip: ContextChip): void {
  mentionChips.value = mentionChips.value.filter((held) => held.id !== chip.id);
}

function mentionKey(event: KeyboardEvent): boolean {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    mention.value?.move(event.key === "ArrowDown" ? 1 : -1);
    return true;
  }
  if (event.key === "Enter" || event.key === "Tab") {
    const option = mention.value?.current();
    // An unmatched `@query` stays as text and is never sent as the question.
    if (!option) {
      if (event.key === "Enter") event.preventDefault();
      return event.key === "Enter";
    }
    event.preventDefault();
    if (option.action) mention.value?.choose(option);
    else pickMention(option);
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeMention();
    return true;
  }
  return false;
}

function onMicPress(event: MouseEvent): void {
  voice.press("mic");
  if (event.detail > 0) input.value?.focus({ preventScroll: true });
}

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
  if (voice.mine.value) voice.stop("other");
});

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (mentionAt.value !== null && mentionKey(event)) return;
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

// Escape on the results closes them and leaves the field; it never clears what was typed (X-20).
function dismissGoTo(): void {
  goToDismissed.value = true;
  input.value?.textarea?.blur();
}

// With no agent to ask, Enter opens the best match, as the palette does.
function openFirstMatch(): void {
  const first = goToMatches.value.find((match) => match.kind !== "ask");
  if (first) onGoToSelect(first);
}

// The launcher is a door, not a composer: the line goes to `/assistant` and nothing stays here (`70` §5 note 6).
function ask(stage: boolean): void {
  if (!fieldReady.value || goToOnly.value) return;
  if (voice.mine.value) voice.stop("send");
  const line = text.value.trim();
  if (!line) return openFull();
  text.value = "";
  const overview = props.layout === "overview";
  const removed = overview ? removedPageKeys.value : [];
  const time = overview && props.pageRange ? props.pageRange : timeOverride.value;
  const chips = mentionChips.value;
  const picked = agent.value;
  if (overview) removedPageKeys.value = [];
  mentionChips.value = [];
  agent.value = null;
  void openAssistant({
    entryKind: "home_launcher",
    entryVerb: "ask",
    objectKind: "none",
    intent: stage ? "stage" : "send",
    thread: "new",
    container: overview && sidebarOpen.value ? "sidebar" : "full",
    ...(picked && { agent: picked }),
    payload: {
      text: line,
      chips,
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
