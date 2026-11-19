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
    :aria-label="t('assistant.welcome.launcher.inputName', { product })"
    class="@container flex w-full min-w-0 flex-col gap-3"
    data-test="assistant-launcher"
    data-assistant-surface
    data-dd-privacy="mask"
    :data-state="state"
  >
    <div ref="field" class="relative min-w-0">
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
        :state="state ?? undefined"
        :disabled="fieldLoading"
        :placeholder="placeholder"
        placeholder-tone="strong"
        :input-attrs="{
          'aria-label': t('assistant.welcome.launcher.inputName', { product }),
          'aria-describedby': notice ? noticeId : undefined,
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
        :listening="voice.listening.value"
        data-test="assistant-launcher-input"
        @update:model-value="onInput"
        @keydown="onKeydown"
      >
        <template v-if="notice || trayChips.length > 0" #strip>
          <div
            v-if="trayChips.length > 0"
            class="flex h-7 min-h-7 min-w-0 items-center overflow-hidden"
            data-test="assistant-launcher-chip-row"
          >
            <AssistantChipTray
              :items="shownTrayChips"
              :hidden="hiddenTrayChips"
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
              <template #hidden-item="{ item }">
                <AssistantHiddenChipRow
                  :chip="item.chip"
                  :image-src="item.src"
                  @remove="removeTrayChip(item.chip)"
                />
              </template>
            </AssistantChipTray>
          </div>
          <AssistantComposerStrip
            v-if="notice"
            :notice="notice"
            :sentence-id="noticeId"
            @action="onNoticeAction"
          />
        </template>
        <template #bar>
          <AssistantComposerBottomRow
            :dictating="voice.mine.value && voice.phase.value !== 'requesting'"
          >
            <template v-if="mentionsOn" #plus>
              <AssistantComposerPlusMenu
                :actions="['attach', 'connectors']"
                :disabled="fieldLoading"
                @select="onPlus"
              />
            </template>
            <template #recording>
              <AssistantDictationWave
                :elapsed-ms="voice.elapsedMs.value"
                :level="voice.level.value"
                :processing="voice.phase.value === 'processing'"
              />
            </template>
            <template #agent>
              <AssistantLauncherAgent
                v-model="agent"
                :fixed="fixedAgent"
                :disabled="fieldLoading"
              />
            </template>
            <template #mic>
              <AssistantDictateButton
                v-if="voice.mic.value !== 'none'"
                :phase="voice.phase.value"
                :disabled-reason="voice.helperLine.value ?? undefined"
                @press="onMicPress"
              />
            </template>
            <template #send>
              <AssistantIconButton
                variant="primary"
                :size="BAR_CONTROL_SIZE"
                :label="t('assistant.welcome.launcher.ask')"
                :icon="assistantGlyph.send"
                :disabled="!canSend"
                :disabled-reason="
                  fieldLoading ? undefined : (fixedOff ?? t('assistant.welcome.launcher.askEmpty'))
                "
                :class="SEND_ACTION_CLASS"
                data-test="assistant-launcher-ask"
                @click="ask()"
              />
            </template>
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
      <span role="status" aria-live="polite" class="sr-only" data-test="assistant-launcher-status">
        <span v-if="status" :key="status.seq">{{ status.text }}</span>
      </span>
    </div>
  </section>
</template>

<script lang="ts">
import type { AgentId, ContextChip, Sid } from "@/composables/assistant";

// Dictation writes here, never to a chat; the line becomes a chat only when it is sent.
const LAUNCHER_DRAFT: Sid = "assistant-launcher";

/** The launcher's line is one prompt; longer text belongs in the full view's composer. */
export const MAX_LAUNCHER_CHARS = 4_000;

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

/** What the launcher renders for a gate; `null` renders nothing. */
export function launcherState(gate: string): "loading" | "gate" | "ready" | null {
  if (gate === "loading") return "loading";
  if (HIDDEN_GATES.has(gate)) return null;
  if (gate === "no_permission") return "gate";
  return "ready";
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import { provideAssistantSurface } from "@/components/ai-assistant/common/assistantSurface";
import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import AssistantChipTray, {
  useChipCollapse,
} from "@/components/ai-assistant/context/AssistantChipTray.vue";
import AssistantHiddenChipRow from "@/components/ai-assistant/context/AssistantHiddenChipRow.vue";
import { useComposerWidth } from "@/components/ai-assistant/composer/useComposerWidth";
import AssistantContextChip from "@/components/ai-assistant/context/AssistantContextChip.vue";
import AssistantMentionMenu, {
  type MentionOption,
} from "@/components/ai-assistant/context/AssistantMentionMenu.vue";
import {
  MAX_IMAGES,
  focusWhenReady,
  openAssistant,
  openTabWithoutOpener,
  useAssistantCapability,
  useAssistantName,
  useAssistantStore,
} from "@/composables/assistant";
import { agentReason } from "@/composables/assistant/pure";
import { onOverviewFocusRequest } from "@/composables/goto/goToRequests";
import useBreakpoint from "@/composables/useBreakpoint";
import { toast } from "@/lib/feedback/Toast/useToast";
import OFile from "@/lib/forms/File/OFile.vue";
import type { FileValue } from "@/lib/forms/File/OFile.types";
import { trackAssistant } from "@/services/assistantAnalytics";
import { MAX_IMAGE_SIZE_BYTES, type ImageAttachment } from "@/ts/interfaces/chat";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { getUUIDv7 } from "@/utils/uuid";

import AssistantComposerBottomRow, {
  BAR_CONTROL_SIZE,
  SEND_ACTION_CLASS,
} from "@/components/ai-assistant/composer/AssistantComposerBottomRow.vue";
import AssistantComposerStrip from "@/components/ai-assistant/composer/AssistantComposerStrip.vue";
import {
  micHelpUrl,
  sentenceNotice,
  type ComposerNotice,
  type NoticeAction,
} from "@/components/ai-assistant/composer/composerNotice";
import AssistantComposerFrame from "@/components/ai-assistant/composer/AssistantComposerFrame.vue";
import { announceComposer, composerUi } from "@/components/ai-assistant/composer/composerUi";
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
import { helpBrand } from "@/components/ai-assistant/composer/voiceEngine";

import AssistantLauncherAgent from "./AssistantLauncherAgent.vue";

const props = defineProps<{
  /** Every line goes to this agent, and the pill offers no other. */
  fixedAgent?: AgentId;
  /** Replaces the rotating example prompts with one fixed hint. */
  askPlaceholder?: I18nText;
}>();

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
const text = ref("");
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
const state = computed(() => launcherState(capability.gate.value));
const fieldReady = computed(() => launcherState(capability.gate.value) === "ready");
const fieldLoading = computed(() => capability.gate.value === "loading");
// While dictating the words may still be interim; Send commits them, as Enter does.
const canSend = computed(
  () =>
    !fieldLoading.value &&
    !fixedOff.value &&
    (voice.mine.value || text.value.trim() !== "" || images.value.length > 0),
);
// The ask field stays with the dock open, and always starts a new chat.
const shown = computed(() => state.value !== null);
const sidebarOpen = computed(() => assistant.state.shell.placement.kind === "sidebar");

// The Home field folds chips into "+N" at the composer's widths, so a phone never squashes them.
const field = ref<HTMLElement | null>(null);
const fieldWidth = useComposerWidth(field);
const chipLayout = computed(() => ({
  narrow: fieldWidth.narrow.value,
  wide: fieldWidth.wide.value,
}));
const trayChips = computed<TrayChip[]>(() => [
  ...mentionChips.value.map((chip) => ({ id: chip.id, chip })),
  ...images.value.map((image) => ({
    id: image.id ?? image.filename,
    chip: imageChipOf(image),
    src: `data:${image.mimeType};base64,${image.data}`,
  })),
]);
const { shown: shownTrayChips, hidden: hiddenTrayChips } = useChipCollapse(trayChips, chipLayout);
// The launcher's line has no chat yet, so it speaks through its own draft's composer status.
const status = computed(() => composerUi(LAUNCHER_DRAFT).status);

const mentionsOn = computed(() => fieldReady.value);
const fixedAvailable = computed(
  () =>
    !!props.fixedAgent &&
    !!capability.value.agents?.some((row) => row.id === props.fixedAgent && row.available),
);
// A fixed agent the roster lists as off, or does not list, takes no line, so it never goes to another agent.
const fixedOff = computed<I18nText | null>(() => {
  const roster = capability.value.agents;
  if (!props.fixedAgent || !roster) return null;
  const row = roster.find((entry) => entry.id === props.fixedAgent);
  if (!row) return t("assistant.agent.unavailable.short");
  return row.available ? null : agentReason(row, null, t);
});
const placeholder = computed(() => props.askPlaceholder ?? t("assistant.composer.placeholderAt"));

const coarse = ref(!!globalThis.matchMedia?.("(pointer: coarse)")?.matches);
const voice = useAssistantVoice({
  field: () => input.value?.textarea ?? null,
  ensureSid: () => LAUNCHER_DRAFT,
  draftOf: () => text.value,
  writeDraft: (_sid, value) => (text.value = value),
  blocked: () => !shown.value || state.value !== "ready",
  tap: () => undefined,
  touch: () => !mdUp.value && coarse.value,
  say: (line) => announceComposer(LAUNCHER_DRAFT, line),
});
const shownText = computed(() => voice.shown(text.value));
const noticeId = `assistant-launcher-notice-${useId()}`;

// The same voice lines the chat composer's strip shows, so dictation reads alike in every host.
const notice = computed<ComposerNotice | null>(() => {
  if (voice.waiting.value) {
    const ask = t("assistant.voice.allowPrompt");
    const privacy = t("assistant.voice.privacy");
    return {
      id: "voice",
      tone: "info",
      title: voice.firstUse.value ? privacy : ask,
      sentence: voice.firstUse.value ? raw(`${ask} ${privacy}`) : ask,
      links: [{ action: "voiceCancel", label: t("common.cancel") }],
    };
  }
  const line = voice.helperLine.value;
  if (!line) return null;
  if (voice.action.value === "how")
    return {
      id: "voice",
      tone: "warning",
      title: t("assistant.composer.strip.micBlocked"),
      sentence: line,
      links: micHelpUrl(voice.brand() ?? helpBrand())
        ? [{ action: "micHelp", label: t("assistant.composer.strip.howToAllow") }]
        : [],
    };
  const links =
    voice.action.value === "retry"
      ? [{ action: "voiceRetry" as const, label: t("assistant.voice.tryAgain") }]
      : [];
  return sentenceNotice("voice", line, voice.failure.value ? "warning" : "info", links);
});

function onNoticeAction(action: NoticeAction): void {
  if (action === "voiceCancel") voice.stop("other");
  else if (action === "voiceRetry") voice.retry();
  else if (action === "micHelp") {
    const href = micHelpUrl(voice.brand() ?? helpBrand());
    if (href) openTabWithoutOpener(href);
  }
}

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

async function removeTrayChip(chip: ContextChip): Promise<void> {
  const order = trayChips.value.map((item) => item.chip.id);
  const next = order[order.indexOf(chip.id) + 1] ?? null;
  if (chip.kind === "image") images.value = images.value.filter((image) => image.id !== chip.id);
  else mentionChips.value = mentionChips.value.filter((held) => held.id !== chip.id);
  announceComposer(LAUNCHER_DRAFT, t("assistant.context.removed", { label: chip.label }));
  await nextTick();
  // Focus goes to the next shown chip, else the box, so a removal never strands it (CT-08 AC 4).
  const at = shownTrayChips.value.findIndex((item) => item.chip.id === next);
  const buttons = field.value?.querySelectorAll<HTMLElement>(
    '[data-test="assistant-launcher-chip-row"] [data-test="assistant-context-chip-button"]',
  );
  const target = at >= 0 ? buttons?.[at] : undefined;
  if (target) target.focus();
  else input.value?.focus();
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

function onPlus(action: ComposerPlusAction): void {
  if (action === "attach") file.value?.open();
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

onBeforeUnmount(() => {
  if (voice.mine.value) voice.stop("other");
});

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (mentionAt.value !== null && mentionKey(event)) return;
  // Shift+Enter is a new line, as in every composer.
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    ask();
  } else if (event.key === "Escape") {
    // Escape stops dictation first, keeping its words; it never clears what was typed (X-20).
    if (voice.mine.value) voice.stop("escape");
    else (event.target as HTMLElement | null)?.blur();
  }
}

// The launcher is a door, not a composer: the line goes to `/assistant` and nothing stays here (`70` §5 note 6).
function ask(): void {
  if (!fieldReady.value) return;
  if (fixedOff.value) return announceComposer(LAUNCHER_DRAFT, fixedOff.value);
  if (props.fixedAgent && !fixedAvailable.value) return;
  if (voice.mine.value) voice.stop("send");
  const line = text.value.trim();
  const attached = images.value;
  // Home's box is the assistant there, so an empty ask only says why instead of leaving the page.
  if (!line && attached.length === 0)
    return announceComposer(LAUNCHER_DRAFT, t("assistant.welcome.launcher.askEmpty"));
  text.value = "";
  const chips = mentionChips.value;
  const picked = props.fixedAgent ?? agent.value;
  mentionChips.value = [];
  images.value = [];
  agent.value = null;
  void openAssistant({
    entryKind: "home_launcher",
    entryVerb: "ask",
    objectKind: "none",
    intent: "send",
    thread: "new",
    // A fixed-agent page keeps its chats on the page, even with the sidebar open.
    container: sidebarOpen.value && !props.fixedAgent ? "sidebar" : "full",
    ...(picked && { agent: picked }),
    payload: {
      text: line,
      chips,
      ...(attached.length > 0 && { images: attached }),
    },
  });
}

defineExpose({
  /** Focus on arrival; skipped when the field is gated or the user is elsewhere. */
  focusAsk: () => focusWhenReady(() => input.value?.textarea),
  /** Puts an example prompt in the field, with the agent it is for when that one can answer, and focuses it. */
  fill: (prompt: string, forAgent?: AgentId) => {
    text.value = prompt;
    const usable = capability.value.agents?.some((row) => row.id === forAgent && row.available);
    if (forAgent && usable && !props.fixedAgent) agent.value = forAgent;
    void nextTick(() => input.value?.textarea?.focus());
  },
  /** Asks a starter prompt at once, as if typed and sent; a typed draft wins and keeps focus. */
  send: (prompt: string) => {
    if (text.value.trim() || images.value.length) return void input.value?.textarea?.focus();
    text.value = prompt;
    ask();
  },
});
</script>
