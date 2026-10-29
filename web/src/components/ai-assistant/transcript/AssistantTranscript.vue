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
  <!-- Size, layout and paint containment: the host sizes the transcript, so a part that fills never lays out the page around it (Q1) -->
  <section
    ref="root"
    role="log"
    aria-live="off"
    :aria-label="label ?? t('assistant.transcript.name', { product })"
    :aria-busy="busy ? 'true' : undefined"
    tabindex="0"
    data-test="assistant-transcript"
    data-transcript-scroll
    data-dd-privacy="mask"
    :data-readonly="readonly ? '' : undefined"
    :class="[
      'focus-visible:ring-border-strong flex min-h-0 flex-1 flex-col overflow-y-auto contain-layout contain-paint contain-size outline-none focus-visible:ring-2 focus-visible:ring-inset',
      density === 'roomy' ? 'gap-6 px-4 py-4' : 'gap-4 px-4 py-3',
    ]"
    @keydown="scroll.onKeydown"
  >
    <div
      v-if="hiddenCount > 0"
      class="flex flex-wrap items-center gap-2"
      data-test="assistant-transcript-window"
    >
      <OButton
        variant="ghost"
        size="sm"
        class="max-md:min-h-11 pointer-coarse:min-h-11"
        data-test="assistant-transcript-earlier"
        @click="showEarlier"
      >
        {{ t("assistant.transcript.showEarlier") }}
      </OButton>
      <OText variant="meta">
        {{ t("assistant.transcript.earlierCount", { count: hiddenCount }, hiddenCount) }}
      </OText>
    </div>
    <article
      v-for="turn in mounted"
      :key="turn.turnId"
      :data-test="`assistant-turn-${turn.turnId}`"
      :data-turn-id="turn.turnId"
      :aria-label="turnName(turn)"
      class="flex min-w-0 flex-col gap-2"
    >
      <div
        v-if="compactionOf(turn.user)"
        class="flex min-w-0 items-center gap-2"
        data-test="assistant-compaction-divider"
      >
        <OSeparator class="min-w-4 flex-1" />
        <OText variant="meta" as="p" class="min-w-0 text-center break-words">
          {{ compactionOf(turn.user) }}
        </OText>
        <OSeparator class="min-w-4 flex-1" />
      </div>
      <AssistantMessage
        v-if="turn.user"
        :message="turn.user"
        :turn-id="turn.turnId"
        :readonly="readonly"
        :density="density"
      >
        <template v-if="actionsFor(turn)" #actions>
          <AssistantMessageActions
            :sid="sid!"
            :message="turn.user"
            :turn-id="turn.turnId"
            :is-last="turn.isLast"
            :prompt-number="turn.userNumber"
            :density="density"
            @edit="editing = turn.turnId"
          />
        </template>
        <template v-if="editing === turn.turnId && sid" #body>
          <AssistantMessageActions
            mode="editor"
            :sid="sid"
            :message="turn.user"
            :turn-id="turn.turnId"
            :is-last="turn.isLast"
            :prompt-number="turn.userNumber"
            :density="density"
            @done="editing = null"
          />
        </template>
      </AssistantMessage>
      <div v-if="turn.live && !readonly" data-status-row>
        <AssistantTurnStatus
          variant="block"
          :turn="session!.turn"
          :meta="session!.turnMeta"
          :owned-by-this-tab="session!.turnMeta.ownedByThisTab"
          :trail-shown="stepsOf(turn.answer, session?.org ?? '').length > 0"
        />
      </div>
      <article
        v-if="turn.answer"
        :aria-label="t('assistant.transcript.answerName', { prompt: turn.firstLine })"
        tabindex="-1"
        data-answer
        :data-test="`assistant-answer-${turn.turnId}`"
        class="rounded-default focus-visible:ring-border-strong flex min-w-0 flex-col gap-2 outline-none focus-visible:ring-2"
      >
        <AssistantMessage
          :message="turn.answer"
          :turn-id="`${sid ?? 'shared'}:${turn.turnId}:v${turn.version.current}`"
          :live="turn.live"
          :readonly="readonly"
          :density="density"
          :turn="views.get(turn.turnId)"
        >
          <template v-if="turn.version.count > 1" #versions>
            <AssistantVersionPicker
              :current="turn.version.current"
              :count="turn.version.count"
              @select="(n) => selectVersion(turn.turnId, n, turn.version.count)"
            />
          </template>
          <template #after>
            <AssistantTurnOutcome
              v-for="outcome in turn.outcomes"
              :key="outcome.key"
              :kind="outcome.record.kind"
              :error="outcome.error"
              :steps="outcome.record.steps ?? 0"
              :role="isAdmin ? 'admin' : 'member'"
              :readonly="readonly"
              :retry-snapshot-available="turn.isLast && canRetry"
              :at="outcome.record.at"
              :partial="turn.partial"
              :cancel-unconfirmed="outcome.record.cancelUnconfirmed"
              :org="session?.org ?? ''"
              :sid="sid ?? undefined"
              :elapsed-ms="outcome.record.elapsedMs"
              :online="online"
              :persistence="persistence"
              :manual-route="manualRouteFor(turn) ?? undefined"
              @action="(action) => onOutcome(action, outcome.record)"
              @manual="(query: QueryRef) => onManualRoute(query, turn.turnId)"
            />
          </template>
          <template v-if="answerActionsFor(turn)" #actions>
            <AssistantMessageActions
              :sid="sid!"
              :message="turn.answer"
              :prompt="turn.user"
              :turn-id="turn.turnId"
              :is-last="turn.isLast"
              :can-regenerate="!turn.outcomes.some((o) => o.record.kind === 'failed')"
              :prompt-number="turn.userNumber"
              :density="density"
            />
          </template>
        </AssistantMessage>
      </article>
    </article>
    <slot name="cards" />
  </section>
</template>

<script lang="ts">
import type {
  AssistantError,
  AssistantSession,
  AssistantTurnView,
  QueryRef,
  Sid,
} from "@/composables/assistant/pure";
import type { ChatMessage, ContentBlock, TurnOutcomeRecord } from "@/ts/interfaces/chat";
import type { I18nText } from "@/types/i18n";

export interface AssistantTranscriptProps {
  /** Live: the session the shell shows; exactly one of `sid` and `messages`. */
  sid?: Sid;
  /** Readonly: a shared page's record, with no store behind it. */
  messages?: ChatMessage[];
  readonly?: boolean;
  /** False on a readonly page with no explorer behind it: evidence offers no Open. */
  openable?: boolean;
  density?: "compact" | "roomy";
  /** The shared page names it "Shared conversation with {product}" (IW-10 AC 11). */
  label?: I18nText;
}

export interface AssistantTranscriptEmits {
  /** The live status row scrolled in or out of view; the strip shows its text meanwhile (HT-01 AC 8). */
  (e: "status-visible", visible: boolean): void;
  /** A new outcome block mounted on the latest turn; a half sheet grows so it fits. */
  (e: "outcome-shown"): void;
}

/** One turn of the log: the user's message, the answer shown, and how the turn ended. */
export interface TranscriptTurn {
  turnId: string;
  /** 1-based position of the turn. */
  number: number;
  /** 1-based number of the user message, for "Edited from message {n}". */
  userNumber: number;
  user: ChatMessage | null;
  answer: ChatMessage | null;
  firstLine: string;
  version: { current: number; count: number };
  outcomes: { key: string; record: TurnOutcomeRecord; error?: AssistantError }[];
  live: boolean;
  isLast: boolean;
  partial: boolean;
}

/** Above this many blocks the log mounts only its latest turns (`30` §1.4). */
export const WINDOW_BLOCKS = 150;

/** Turns always mounted when windowed, and how many more each Show earlier adds. */
export const WINDOW_TURNS = 40;

const TURN_LABEL_CHARS = 60;

/** Groups a flat record into turns; a turn starts at each user message (`30` §0 decision 1). */
export function groupTurns(messages: ChatMessage[]): {
  turnId: string;
  user: ChatMessage | null;
  answers: ChatMessage[];
}[] {
  const turns: { turnId: string; user: ChatMessage | null; answers: ChatMessage[] }[] = [];
  messages.forEach((message, index) => {
    if (message.role === "user" || turns.length === 0) {
      const id = message.turnId ?? `m${index}`;
      turns.push({ turnId: id, user: message.role === "user" ? message : null, answers: [] });
      if (message.role === "user") return;
    }
    turns[turns.length - 1].answers.push(message);
  });
  return turns;
}

/** The answer of a turn as one message; a legacy record may hold several assistant messages. */
export function answerOf(answers: ChatMessage[]): ChatMessage | null {
  if (answers.length === 0) return null;
  if (answers.length === 1) return answers[0];
  const last = answers[answers.length - 1];
  return { ...last, contentBlocks: answers.flatMap((answer) => answer.contentBlocks ?? []) };
}

/** The stored ends of a turn: typed blocks, and the replay markers `record.ts` writes for old turns. */
export function outcomeRecordsOf(blocks: ContentBlock[]): TurnOutcomeRecord[] {
  return blocks.flatMap<TurnOutcomeRecord>((block) => {
    if (block.type === "turn_outcome" && block.outcome) return [block.outcome];
    if (block.type === "status" && block.turnStatus === "stopped") return [{ kind: "stopped" }];
    if (block.type === "error" && block.errorType) {
      const kind = block.errorType === "cancelled_elsewhere" ? "cancelledElsewhere" : "failed";
      return [{ kind, code: block.errorType }];
    }
    // A legacy chat wrote its failures as text; the cause is kept only for Details (constraint 12).
    if (block.type === "error")
      return [
        {
          kind: "failed",
          code: "unknown",
          ...(block.message && { serverMessage: String(block.message) }),
        },
      ];
    return [];
  });
}

export function isRunningTurn(session: AssistantSession | null): boolean {
  const state = session?.turn.state;
  return !!state && !["idle", "done", "stopped", "failed", "refused"].includes(state);
}
</script>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

import { announceComposer } from "@/components/ai-assistant/composer/composerUi";
import AssistantTurnOutcome, {
  type OutcomeAction,
} from "@/components/ai-assistant/turn/AssistantTurnOutcome.vue";
import AssistantTurnStatus from "@/components/ai-assistant/turn/AssistantTurnStatus.vue";
import {
  assistantEvidenceHostKey,
  assistantSessionSourceKey,
  assistantTranscriptHostKey,
  manualRouteOf,
  outcomeError,
  promptRange,
  stepsOf,
  turnAnnotationKey,
  useAssistantName,
} from "@/composables/assistant/pure";
import { explorerOf } from "@/utils/assistant/explorerRoutes";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped } from "@/types/i18n";

import AssistantMessage from "./AssistantMessage.vue";
import AssistantVersionPicker from "./AssistantVersionPicker.vue";
import { useTranscriptScroll } from "./useTranscriptScroll";

// The bar and the inline editor act on the store, so a readonly page never loads them (constraint 29).
const AssistantMessageActions = defineAsyncComponent(() => import("./AssistantMessageActions.vue"));

const props = withDefaults(defineProps<AssistantTranscriptProps>(), {
  sid: undefined,
  messages: undefined,
  readonly: false,
  openable: true,
  density: "compact",
  label: undefined,
});

const emit = defineEmits<AssistantTranscriptEmits>();

defineSlots<{ cards?: () => unknown }>();

const { t } = useI18nTyped();
const { product } = useAssistantName();
const source = inject(assistantSessionSourceKey, null);
const live = props.readonly || props.messages ? null : inject(assistantTranscriptHostKey, null);
const evidence = live ? inject(assistantEvidenceHostKey, null) : null;

const root = ref<HTMLElement | null>(null);
const editing = ref<string | null>(null);
const windowTurns = ref(WINDOW_TURNS);

const sourceMessages = computed(() => (props.sid && source ? source(props.sid).value : []));
const messages = computed(() => props.messages ?? sourceMessages.value);
const session = computed(() => (props.sid && live ? live.session(props.sid) : null));
const running = computed(() => !props.readonly && isRunningTurn(session.value));
const busy = computed(() => running.value);
const isAdmin = computed(() => live?.isAdmin() ?? false);
const online = computed(() => live?.online() ?? true);
const persistence = computed(() => live?.persistence() ?? false);
const canRetry = computed(() => (props.sid && live ? live.canRetry(props.sid) : false));

const turns = computed<TranscriptTurn[]>(() => {
  const groups = groupTurns(messages.value);
  let userNumber = 0;
  return groups.map((group, index) => {
    if (group.user) userNumber += 1;
    const isLast = index === groups.length - 1;
    const stored = answerOf(group.answers);
    const count = (stored?.versions?.length ?? 0) + (stored ? 1 : 0);
    const chosen = session.value?.ui.activeVersion[group.turnId] ?? count;
    const current = Math.min(Math.max(chosen, 1), Math.max(count, 1));
    const answer = !stored || current === count ? stored : stored.versions![current - 1];
    const blocks = answer?.contentBlocks ?? [];
    const records = outcomeRecordsOf(blocks);
    if (isLast && session.value?.turn.state === "done" && session.value.turn.saved === "not_saved")
      records.push({ kind: "doneNotSaved" });
    const prompt = String(group.user?.content ?? "");
    return {
      turnId: group.turnId,
      number: index + 1,
      userNumber,
      user: group.user,
      answer,
      firstLine: prompt.split("\n")[0].slice(0, TURN_LABEL_CHARS),
      version: { current, count },
      outcomes: records.map((record, i) => ({
        key: `${group.turnId}:o${i}:${record.kind}`,
        record,
        ...(record.code !== undefined && { error: outcomeError(record) }),
      })),
      live: isLast && running.value,
      isLast,
      // Only visible text backs "findings kept"; steps render from WP-08 on.
      partial: blocks.some((block) => block.type === "text" && !!block.text?.trim()),
    };
  });
});

const views = computed(() => new Map(turns.value.map((turn) => [turn.turnId, turnView(turn)])));

const blockCount = computed(() =>
  messages.value.reduce((sum, message) => sum + (message.contentBlocks?.length ?? 1), 0),
);

const windowed = computed(() => blockCount.value > WINDOW_BLOCKS);
const mounted = computed(() =>
  windowed.value ? turns.value.slice(-windowTurns.value) : turns.value,
);
// The caption counts messages, and a turn holds a prompt and its answer.
const hiddenCount = computed(() =>
  turns.value
    .slice(0, turns.value.length - mounted.value.length)
    .reduce((sum, turn) => sum + (turn.user ? 1 : 0) + (turn.answer ? 1 : 0), 0),
);

// Every committed batch changes this, so following lands in the same frame as the DOM commit (`00` §5.6).
const contentVersion = computed(() => {
  const last = messages.value[messages.value.length - 1];
  const blocks = last?.contentBlocks ?? [];
  const tail = blocks[blocks.length - 1];
  return `${messages.value.length}:${blocks.length}:${tail?.text?.length ?? 0}:${session.value?.turn.state ?? ""}`;
});

const scroll = useTranscriptScroll({
  container: root,
  follow: () => (props.readonly ? false : (session.value?.ui.follow ?? true)),
  setFollow: (follow) => props.sid && live?.setFollow(props.sid, follow),
  savedTop: () => session.value?.scroll.top ?? "bottom",
  saveTop: (top) => props.sid && live?.setScroll(props.sid, top),
  content: contentVersion,
  latestTurn: () => turns.value[turns.value.length - 1]?.turnId ?? null,
  session: () => props.sid ?? null,
  reducedMotion: () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)")?.matches === true,
});

// A reloaded turn that followed a compaction carries the line on its prompt; it reads as a divider above it.
function compactionOf(message: ChatMessage | null | undefined): string | null {
  const block = message?.contentBlocks?.find((candidate) => candidate.compactedAt !== undefined);
  return block?.message ? String(block.message) : null;
}

function turnName(turn: TranscriptTurn): I18nText {
  return t("assistant.transcript.turnLabel", { n: turn.number, prompt: turn.firstLine });
}

// The bar hides while any turn runs, and never renders on a readonly page (EB-09 AC 3, AC 7).
function actionsFor(turn: TranscriptTurn): boolean {
  return (
    !!props.sid &&
    !!live &&
    !props.readonly &&
    !running.value &&
    !!turn.user &&
    editing.value !== turn.turnId
  );
}

// An answer with no text has nothing to copy, and a failed one acts only through its outcome block (`30` §8.3).
function answerActionsFor(turn: TranscriptTurn): boolean {
  const text = turn.answer?.contentBlocks?.some(
    (block) => block.type === "text" && !!block.text?.trim(),
  );
  return !!props.sid && !!live && !props.readonly && !running.value && !!text && !turn.live;
}

// The picker's name is not re-read while focus stays inside it, so the switch is spoken (EB-09 AC 12).
function selectVersion(turnId: string, n: number, count: number): void {
  if (!props.sid || !live) return;
  live.selectVersion(props.sid, turnId, n);
  announceComposer(props.sid, t("assistant.message.versionName", { n, count }));
  trackAssistant("ai_thread_action", { action: "version_switch" });
}

// The answer's turn as its evidence blocks read it; a shared page has no session and no org of its own.
function turnView(turn: TranscriptTurn): AssistantTurnView {
  const kinds = turn.outcomes.map((outcome) => outcome.record.kind);
  const outcome: AssistantTurnView["outcome"] = turn.live
    ? "live"
    : kinds.includes("failed") || kinds.includes("cancelledElsewhere") || kinds.includes("expired")
      ? "failed"
      : kinds.includes("stopped")
        ? "stopped"
        : kinds.includes("doneNotSaved")
          ? "done_not_saved"
          : "done";
  return {
    sid: props.sid ?? null,
    turnId: turn.turnId,
    org: session.value?.org ?? "",
    prompt: turn.user,
    askedWindow: askedWindowOf(turn.turnId),
    openable: props.openable,
    outcome,
    isLast: turn.isLast,
    startedAt: turn.live ? (session.value?.turnMeta.startedAt ?? null) : null,
  };
}

function askedWindowOf(turnId: string): { from: number; to: number } | null {
  return session.value?.annotations?.[turnAnnotationKey(turnId, "window")]?.window ?? null;
}

function manualRouteFor(turn: TranscriptTurn): QueryRef | null {
  const range = promptRange(turn.user, askedWindowOf(turn.turnId));
  return manualRouteOf(turn.answer, range, session.value?.org ?? "");
}

// "Open in Logs instead" is the non-AI path; it opens through the explorer applier.
async function onManualRoute(query: QueryRef, turnId: string): Promise<void> {
  if (!props.sid || !evidence) return;
  const sid = props.sid;
  const result = await evidence.dispatch(sid, {
    kind: "open_in_explorer",
    query,
    explorer: explorerOf(query),
  });
  if (!result.ok && result.reason === "other_org")
    evidence.announce(sid, t("assistant.evidence.otherOrg", { org: raw(query.org) }));
  trackAssistant(
    "ai_turn_recovered",
    { action: "manual_route", succeeded: result.ok },
    { sid, turnId },
  );
}

function onOutcome(action: OutcomeAction, record: TurnOutcomeRecord): void {
  // Copy request comes only from the shell's 402 block, which holds the usage it copies.
  if (action === "copy_request") return;
  if (props.sid && live) live.outcomeAction(props.sid, action, record);
}

async function showEarlier(): Promise<void> {
  await scroll.preserveAnchor(() => {
    windowTurns.value += WINDOW_TURNS;
  });
  trackAssistant("ai_transcript_window", { turns_mounted: mounted.value.length });
}

/** Go to answer and `Ctrl+↑` land on the latest answer's start (`30` §1.6). */
function focusLatestAnswer(): boolean {
  const answers = root.value?.querySelectorAll<HTMLElement>("[data-answer]");
  const last = answers?.[answers.length - 1];
  if (!last) return false;
  last.focus();
  return true;
}

let observer: IntersectionObserver | null = null;

// Each running turn mounts its own row, so the observer follows the live turn, not a template ref.
const liveTurnId = computed(() =>
  props.readonly ? null : (mounted.value.find((turn) => turn.live)?.turnId ?? null),
);

// The strip shows the status text only while the row itself is out of view (HT-01 AC 8).
function observeStatusRow(): void {
  observer?.disconnect();
  observer = null;
  const el = root.value?.querySelector<HTMLElement>("[data-status-row]");
  if (!el) return emit("status-visible", false);
  if (typeof IntersectionObserver === "undefined") return emit("status-visible", true);
  observer = new IntersectionObserver(
    (entries) =>
      emit(
        "status-visible",
        entries.some((entry) => entry.isIntersecting),
      ),
    { root: root.value },
  );
  observer.observe(el);
}

watch(liveTurnId, observeStatusRow, { flush: "post" });

// Following pins the bottom, so a short viewport would show an outcome's action without its title (`30` §4.3).
watch(
  () => {
    const last = turns.value.at(-1);
    if (props.readonly || !last) return null;
    return {
      turn: `${props.sid ?? ""}:${last.turnId}`,
      keys: last.outcomes.map((o) => o.key).join("|"),
    };
  },
  async (now, before) => {
    // Only an outcome the same turn just gained counts; opening another chat is not a new outcome.
    if (!now?.keys || !before || before.turn !== now.turn || before.keys === now.keys) return;
    emit("outcome-shown");
    await nextTick();
    const article = Array.from(
      root.value?.querySelectorAll<HTMLElement>("article[data-turn-id]") ?? [],
    ).find((node) => `${props.sid ?? ""}:${node.dataset.turnId}` === now.turn);
    const blocks = article?.querySelectorAll<HTMLElement>('[data-test="assistant-turn-outcome"]');
    const block = blocks?.[blocks.length - 1];
    if (block) scroll.reveal(block);
  },
  { flush: "post" },
);

watch(
  () => props.sid,
  () => {
    editing.value = null;
    windowTurns.value = WINDOW_TURNS;
  },
);

onMounted(observeStatusRow);
onBeforeUnmount(() => observer?.disconnect());

defineExpose({ jumpToLatest: scroll.jumpToLatest, focusLatestAnswer, root });
</script>
