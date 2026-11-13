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
    :data-state="state"
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
      <div v-else ref="field" class="relative min-w-0">
        <AssistantMentionMenu
          ref="mention"
          :open="mentionAt !== null"
          :query="mentionQuery"
          :org="org"
          :listbox-id="MENTION_LISTBOX_ID"
          :sid="null"
          hide-agents
          :class="['md:z-30', mentionBelow && 'md:top-full! md:bottom-auto! md:mt-1! md:mb-0!']"
          @select="pickMention"
          @close="closeMention"
        />
        <AssistantComposerFrame
          ref="input"
          :model-value="shownText"
          :glow="layout === 'overview'"
          :state="state ?? undefined"
          :disabled="fieldLoading"
          :placeholder="placeholder"
          :input-attrs="{
            'aria-label': t('assistant.welcome.launcher.inputName', { product }),
            maxlength: MAX_LAUNCHER_CHARS,
            enterkeyhint: 'send',
            ...(mentionAt !== null && {
              role: 'combobox',
              'aria-haspopup': 'listbox',
              'aria-expanded': 'true',
              'aria-autocomplete': 'list',
              'aria-controls': MENTION_LISTBOX_ID,
              'aria-activedescendant': mention?.activeId,
            }),
          }"
          tall
          data-test="assistant-launcher-input"
          @update:model-value="onInput"
          @keydown="onKeydown"
        >
          <template v-if="trayChips.length > 0" #strip>
            <div
              class="flex h-7 min-h-7 min-w-0 items-center overflow-hidden px-0.5"
              data-test="assistant-launcher-chip-row"
            >
              <AssistantChipTray
                v-model:expanded="chipsExpanded"
                :items="shownTrayChips"
                :hidden-count="hiddenTrayChips"
                :hidden-labels="hiddenTrayLabels"
                data-test="assistant-launcher-chips"
              >
                <template #chip="{ item }">
                  <AssistantContextChip
                    :chip="item.chip"
                    compact
                    :short-label="item.chip.short"
                    :image-src="item.src"
                    :popup="false"
                    :data-test="
                      item.src ? 'assistant-launcher-image-chip' : 'assistant-launcher-mention-chip'
                    "
                    @remove="removeTrayChip(item.chip)"
                  />
                </template>
              </AssistantChipTray>
            </div>
          </template>
          <template #bar>
            <AssistantComposerBottomRow divided>
              <template #agent>
                <AssistantComposerPlusMenu
                  v-if="mentionsOn"
                  :actions="['attach', 'context']"
                  :disabled="fieldLoading"
                  @select="onPlus"
                />
                <span class="flex shrink-0 items-center gap-2">
                  <AssistantTimePrefix
                    v-model:open="timeOpen"
                    :window="window"
                    :disabled="fieldLoading"
                    fixed
                    align="start"
                    @change="timeOverride = $event"
                  />
                  <AssistantLauncherAgent v-model="agent" :disabled="fieldLoading" />
                </span>
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
                v-if="voice.mic.value !== 'none'"
                :mic="voice.mic.value"
                :pressed="voice.mine.value"
                :disabled-reason="voice.helperLine.value ?? undefined"
                @press="onMicPress"
              />
              <AssistantIconButton
                variant="primary"
                size="md"
                :label="t('assistant.welcome.launcher.ask')"
                :icon="assistantGlyph.send"
                :disabled="!canSend"
                :class="[ROUND_ACTION_CLASS, layout === 'overview' && canSend && SEND_GLOW_CLASS]"
                data-test="assistant-launcher-ask"
                @click="ask(false)"
              />
            </AssistantComposerBottomRow>
          </template>
        </AssistantComposerFrame>
        <OFile
          v-if="mentionsOn"
          ref="file"
          class="hidden"
          accept="image/png,image/jpeg"
          :type-error-toast="false"
          multiple
          :model-value="null"
          :max-file-size="MAX_IMAGE_SIZE_BYTES"
          @change="onPicked"
          @size-error="(files) => files.forEach(refuseSize)"
          @type-error="() => refuse('type', t('assistant.context.imageType'))"
        />
      </div>
      <div
        v-if="layout === 'card'"
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
          <ul v-else class="grid min-w-0 grid-cols-1 gap-2">
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

// Dictation writes here, never to a chat; the line becomes a chat only when it is sent.
const LAUNCHER_DRAFT: Sid = "assistant-launcher";

/** The launcher's line is one prompt; longer text belongs in the full view's composer. */
export const MAX_LAUNCHER_CHARS = 4_000;

/** Rows of each column (`70` §2.1). */
export const LAUNCHER_ROWS = 3;

// Home's Send lights up once there is a line to send.
const SEND_GLOW_CLASS = "bg-gradient-ai enabled:hover:shadow-md enabled:hover:shadow-ai-accent/40";

/** In-progress chats can sit below the latest ones, so Your chats looks this far down the list. */
const RECENT_LOOKUP = 20;

// G0 and G1 leave no gap on Home: the header carries the locked or muted button (DG-04 AC 3, DG-05 AC 1).
const HIDDEN_GATES: ReadonlySet<string> = new Set([
  "not_entitled",
  "not_configured",
  "off_for_org",
]);

// A Home chip is the user's @ pick or an attached image, which carries its thumbnail.
interface TrayChip {
  id: string;
  chip: ContextChip;
  src?: string;
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
import AssistantChipTray, {
  useChipCollapse,
} from "@/components/ai-assistant/context/AssistantChipTray.vue";
import AssistantContextChip from "@/components/ai-assistant/context/AssistantContextChip.vue";
import AssistantMentionMenu, {
  type MentionOption,
} from "@/components/ai-assistant/context/AssistantMentionMenu.vue";
import AssistantTimePrefix from "@/components/ai-assistant/context/AssistantTimePrefix.vue";
import AssistantGateState from "@/components/ai-assistant/gate/AssistantGateState.vue";
import {
  MAX_IMAGES,
  openAssistant,
  starterPayload,
  periodMs,
  timeWindowOf,
  useAssistantCapability,
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
import useBreakpoint from "@/composables/useBreakpoint";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OFile from "@/lib/forms/File/OFile.vue";
import type { FileValue } from "@/lib/forms/File/OFile.types";
import { trackAssistant } from "@/services/assistantAnalytics";
import { MAX_IMAGE_SIZE_BYTES, type ImageAttachment } from "@/ts/interfaces/chat";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatRelativeCompact } from "@/utils/formatters";
import { getUUIDv7 } from "@/utils/uuid";

import AssistantComposerBottomRow, {
  ROUND_ACTION_CLASS,
} from "@/components/ai-assistant/composer/AssistantComposerBottomRow.vue";
import AssistantComposerFrame from "@/components/ai-assistant/composer/AssistantComposerFrame.vue";
import AssistantComposerPlusMenu, {
  type ComposerPlusAction,
} from "@/components/ai-assistant/composer/AssistantComposerPlusMenu.vue";
import AssistantDictateButton from "@/components/ai-assistant/composer/AssistantDictateButton.vue";
import AssistantDictationWave from "@/components/ai-assistant/composer/AssistantDictationWave.vue";
import {
  attachImageFiles,
  imageChipOf,
  imageTooBigLine,
  type ImageCap,
} from "@/components/ai-assistant/composer/composerImages";
import { useAssistantVoice } from "@/components/ai-assistant/composer/useAssistantVoice";
import { useComposerWidth } from "@/components/ai-assistant/composer/useComposerWidth";

import AssistantLauncherAgent from "./AssistantLauncherAgent.vue";
import AssistantStarterRow from "./AssistantStarterRow.vue";
import { starterIcon } from "./starterIcons";

const props = withDefaults(
  defineProps<{
    /** `overview` is Home's ask field alone; `card` adds a heading, starters and recent chats. */
    layout?: "card" | "overview";
    /** The page range in ms; the time chip mirrors it and a pick moves it. */
    pageRange?: ComposerState["timeOverride"];
    /** Home's wide tab: the capability cards under the field; a pick stages its prompt in the field. */
  }>(),
  { layout: "card", pageRange: null },
);

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
// The layout is fixed per mount, and only the card lists starters and recent chats.
const isCard = props.layout === "card";
const starterList = isCard ? useAssistantStarters({ page: "home" }) : null;

const titleId = `assistant-launcher-title-${useId()}`;
const text = ref("");
// Home asks over the default window until a range is picked; a picked preset slides to the moment of sending.
const timeOverride = ref<ComposerState["timeOverride"]>(null);
function sendRange(): ComposerState["timeOverride"] {
  const range = timeOverride.value;
  if (!range?.period) return range;
  const to = Date.now();
  return { from: to - periodMs(range.period), to, period: range.period };
}
// The chip always shows the range the box asks over; Home's own page range stays out of the box.
const timeOpen = ref(false);
const window = computed<TimeWindow>(() => timeWindowOf(null, timeOverride.value));
const input = ref<InstanceType<typeof AssistantComposerFrame> | null>(null);
const mention = ref<InstanceType<typeof AssistantMentionMenu> | null>(null);
const mentionAt = ref<number | null>(null);
const mentionQuery = ref("");
const mentionBelow = ref(false);
// The launcher has no chat yet, so its @ picks wait here and go with the line it opens.
const mentionChips = ref<ContextChip[]>([]);
// Attached images wait here too, under the composer's caps, and ride with the line into the new chat.
const images = ref<ImageAttachment[]>([]);
const file = ref<InstanceType<typeof OFile> | null>(null);
const agent = ref<AgentId | null>(null);

const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const state = computed(() => {
  const gated = launcherState(capability.gate.value);
  return gated === "ready" && starterList?.loading.value ? "loading" : gated;
});
// Starters refetch when the @ menu loads the same lists; only the gate may disable the field, or it drops focus.
const fieldReady = computed(() => launcherState(capability.gate.value) === "ready");
const fieldLoading = computed(() => capability.gate.value === "loading");
const canSend = computed(
  () => !fieldLoading.value && (text.value.trim() !== "" || images.value.length > 0),
);
// The card names itself with its heading; the Home layouts draw none, so they carry the name.
const sectionName = computed(() => {
  if (isCard) return undefined;
  return t("assistant.welcome.launcher.inputName", { product });
});
// On the Overview the ask field stays with the dock open, and always starts a new chat.
const shown = computed(
  () => state.value !== null && (props.layout !== "card" || !sidebarOpen.value),
);
const creditsExhausted = computed(() => capability.value.creditMode === "exhausted");
const shownStarters = computed(() => starterList?.starters.value.slice(0, LAUNCHER_ROWS) ?? []);
// The sidebar is the assistant while it is open, so Home shows no second one beside it.
const sidebarOpen = computed(() => assistant.state.shell.placement.kind === "sidebar");
const showSuggestions = computed(() => state.value !== "gate");

// The Home field folds chips into "+N" at the composer's widths, so a phone never squashes them.
const field = ref<HTMLElement | null>(null);
const fieldWidth = useComposerWidth(field);
const chipLayout = computed(() => ({
  narrow: fieldWidth.narrow.value,
  wide: fieldWidth.wide.value,
}));
const chipsExpanded = ref(false);
const trayChips = computed<TrayChip[]>(() => [
  ...mentionChips.value.map((chip) => ({ id: chip.id, chip })),
  ...images.value.map((image) => ({
    id: image.id ?? image.filename,
    chip: imageChipOf(image),
    src: `data:${image.mimeType};base64,${image.data}`,
  })),
]);
const { shown: shownTrayChips, hiddenCount: hiddenTrayChips } = useChipCollapse(
  trayChips,
  chipLayout,
  chipsExpanded,
);

const hiddenTrayLabels = computed(() =>
  trayChips.value.slice(shownTrayChips.value.length).map((item) => String(item.chip.label)),
);

const mentionsOn = computed(() => fieldReady.value);
const placeholder = computed(() => t("assistant.composer.placeholderAt"));

const coarse = ref(!!globalThis.matchMedia?.("(pointer: coarse)")?.matches);
const voice = useAssistantVoice({
  field: () => input.value?.textarea ?? null,
  ensureSid: () => LAUNCHER_DRAFT,
  draftOf: () => text.value,
  writeDraft: (_sid, value) => (text.value = value),
  blocked: () => !shown.value || state.value !== "ready",
  tap: () => undefined,
  touch: () => !mdUp.value && coarse.value,
  say: () => undefined,
});
const shownText = computed(() => voice.shown(text.value));

function onInput(value: string): void {
  text.value = value;
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
  const chip = option.chip;
  if (!chip || mixedStream(chip)) return;
  if (!mentionChips.value.some((held) => held.id === chip.id))
    mentionChips.value = [...mentionChips.value, chip];
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

function removeTrayChip(chip: ContextChip): void {
  if (chip.kind === "image") images.value = images.value.filter((image) => image.id !== chip.id);
  else mentionChips.value = mentionChips.value.filter((held) => held.id !== chip.id);
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
  // An admin's first press turns dictation on in this browser; the next one starts it.
  if (voice.mic.value === "off") return voice.turnOn();
  voice.press("mic");
  if (event.detail > 0) input.value?.focus({ preventScroll: true });
}

function onPlus(action: ComposerPlusAction): void {
  if (action === "attach") file.value?.open();
  else if (action === "context") addContext();
}

function onPicked(value: FileValue): void {
  const files = Array.isArray(value) ? value : value ? [value] : [];
  void attachImageFiles(files, {
    t,
    add: (image) => {
      if (images.value.length >= MAX_IMAGES) return { ok: false, cap: "images" };
      images.value = [...images.value, { ...image, id: getUUIDv7() }];
      return { ok: true };
    },
    refuse,
  }).then(() => input.value?.focus());
}

// Home has no chat strip to hold the composer's refusal line, so the same line shows as a toast.
function refuse(cap: ImageCap, line: I18nText): void {
  trackAssistant("ai_composer_cap_hit", { cap });
  toast({ variant: "warning", message: line });
}

function refuseSize(picked: File): void {
  refuse("size", imageTooBigLine(t, picked));
}

// Add Context types the `@` at the caret, so it opens the same mention menu typing does.
function addContext(): void {
  const value = text.value;
  const at = input.value?.textarea?.selectionStart ?? value.length;
  const gap = at > 0 && !/\s/.test(value[at - 1]) ? " " : "";
  onInput(`${value.slice(0, at)}${gap}@${value.slice(at)}`);
  void nextTick(() => {
    input.value?.focus();
    input.value?.textarea?.setSelectionRange(at + gap.length + 1, at + gap.length + 1);
    detectMention();
  });
}

function focusField(clear: boolean): void {
  if (clear) text.value = "";
  input.value?.focus();
}

// `/` on Home lands here while the field can take a question; nothing listens while it is hidden or gated.
const askListening = computed(() => shown.value && state.value === "ready");
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
    if (!focusNow) return;
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
onMounted(() => {
  if (isCard) history.ensureLoaded();
});

// Only a waiting row with a known end counts down, so the clock runs only then.
const clock = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;
watch(
  () => isCard && recent.value.some((row) => row.status === "needs_you" && row.expiresAt !== null),
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
  if (!fieldReady.value) return;
  if (voice.mine.value) voice.stop("send");
  const line = text.value.trim();
  const attached = images.value;
  if (!line && attached.length === 0) return openFull();
  text.value = "";
  const overview = props.layout === "overview";
  const time = sendRange() ?? (overview ? props.pageRange : null);
  const chips = mentionChips.value;
  const picked = agent.value;
  mentionChips.value = [];
  images.value = [];
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
      ...(attached.length > 0 && { images: attached }),
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
      ...(timeOverride.value && { timeOverride: sendRange() }),
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

// Home's capabilities page stages its sample question here.
defineExpose({
  fill(line: string): void {
    text.value = line;
    input.value?.focus();
  },
});
</script>
