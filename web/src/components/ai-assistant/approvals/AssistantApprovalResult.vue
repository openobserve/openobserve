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
  <div
    v-if="view"
    class="flex min-w-0 flex-col gap-1"
    :data-state="view.state"
    :data-approval-id="card?.id"
    data-test="assistant-approval-result"
  >
    <OBanner
      v-if="view.state === 'delivery_failed'"
      variant="error-soft"
      dense
      role="presentation"
      :icon="assistantGlyph.failed"
    >
      <div class="flex min-w-0 items-center gap-2">
        <p class="min-w-0 flex-1 text-xs break-words" data-test="assistant-approval-result-line">
          {{ line }}
        </p>
        <OButton
          v-if="action && live"
          variant="ghost"
          size="xs"
          :class="['shrink-0', TOUCH_TARGET_CLASS]"
          :data-test="`assistant-approval-result-${action.id}`"
          @click="action.run?.()"
        >
          {{ action.label }}
        </OButton>
      </div>
    </OBanner>
    <template v-else>
      <div
        ref="lineEl"
        tabindex="-1"
        class="focus-visible:ring-assistant-focus-ring rounded-default flex min-w-0 items-start gap-1.5 outline-none focus-visible:ring-2"
      >
        <OSpinner v-if="view.state === 'sending'" size="xs" class="mt-0.5 shrink-0" />
        <OIcon
          v-else
          :name="glyph"
          size="sm"
          class="text-text-secondary mt-0.5 shrink-0"
          aria-hidden="true"
        />
        <p
          :class="[
            'min-w-0 flex-1 text-sm break-words',
            view.state === 'expired' ? 'text-text-secondary' : 'text-text-body',
          ]"
          data-test="assistant-approval-result-line"
        >
          {{ line }}
        </p>
        <OText
          v-if="meta"
          variant="meta"
          as="span"
          class="shrink-0 pt-0.5 whitespace-nowrap"
          data-test="assistant-approval-result-meta"
        >
          {{ meta }}
        </OText>
      </div>
      <p
        v-if="replyText"
        class="text-text-secondary text-sm break-words"
        data-test="assistant-approval-result-reply"
      >
        {{ replyText }}
      </p>
      <ul
        v-if="rows.length"
        class="flex min-w-0 flex-col gap-0.5 ps-6"
        :aria-label="t('assistant.approval.result.itemsName')"
      >
        <li
          v-for="row in rows"
          :key="row.key"
          :class="[
            'flex min-w-0 flex-wrap items-center gap-x-2 text-xs',
            row.failed ? 'text-status-error-text' : 'text-text-secondary',
          ]"
          :data-test="`assistant-approval-result-item-${row.key}`"
        >
          <span class="min-w-0 break-all">{{ row.text }}</span>
        </li>
      </ul>
      <div v-if="action && live" class="flex flex-wrap gap-1">
        <OButton
          v-if="action.href"
          variant="ghost-primary"
          size="chip"
          as="a"
          :href="action.href"
          target="_blank"
          rel="noopener noreferrer"
          :aria-label="action.name"
          :class="TOUCH_TARGET_CLASS"
          :data-test="`assistant-approval-result-${action.id}`"
        >
          {{ action.label }}
        </OButton>
        <OButton
          v-else
          variant="ghost-primary"
          size="chip"
          :class="TOUCH_TARGET_CLASS"
          :data-test="`assistant-approval-result-${action.id}`"
          @click="action.run?.()"
        >
          {{ action.label }}
        </OButton>
      </div>
    </template>
    <div v-if="back" class="flex min-w-0 flex-col gap-0.5">
      <OButton
        variant="ghost"
        size="xs"
        :icon-left="assistantGlyph.back"
        :class="['self-start', TOUCH_TARGET_CLASS]"
        data-test="assistant-approval-result-back"
        @click="goBack"
      >
        {{ t("assistant.approval.backTo", { title: raw(back.title) }) }}
      </OButton>
      <OText v-if="back.org" variant="meta" as="p" class="ps-6">
        {{ t("assistant.approval.backToOrg", { org: raw(back.org) }) }}
      </OText>
    </div>
  </div>
</template>

<script lang="ts">
// A decision is spoken once wherever its record renders; the newest few are remembered.
const spoken = new Set<string>();

const MAX_SPOKEN = 200;
</script>

<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import {
  approvalEditor,
  approvalEntity,
  approvalOutcomeOf,
  approvalHeading,
  approvalName,
  approvalNoun,
  approvalObjectId,
  approvalTargetHref,
  approvalToolEntity,
  approvalUntil,
  approvalVerb,
  assistantEvidenceHostKey,
  type ApprovalBlockData,
  type ApprovalResultItem,
  type AssistantTurnView,
  type ResolvedBlockData,
  type Sid,
} from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatOrgTime } from "@/utils/formatters";

import { lowerFirst } from "./approvalText";
import {
  assistantApprovalsHostKey,
  type ApprovalCardView,
  type ApprovalResultState,
  type ApprovalResultView,
} from "./approvals.types";

/** A record that changed this recently is a decision just made, so it is spoken; an older one is history. */
const FRESH_MS = 3_000;

const TIMED_STATES: ReadonlySet<ApprovalResultState> = new Set([
  "approved",
  "done",
  "partial",
  "editing",
  "declined",
  "replied",
  "answered",
  "expired",
]);

const BY_YOU_STATES: ReadonlySet<ApprovalResultState> = new Set(["approved", "done", "partial"]);

const RECORDED_STATE = {
  approved: "approved",
  denied: "declined",
  expired: "expired",
  withdrawn: "withdrawn",
} as const satisfies Record<string, ApprovalResultState>;

const props = withDefaults(
  defineProps<{
    /** As a registered renderer: the `approval` or `approval_result` block. */
    block?: ContentBlock | null;
    message?: ChatMessage | null;
    turn?: AssistantTurnView | null;
    readonly?: boolean;
    /** As the container's own line: a state with no block, such as a card another tab holds. */
    state?: ApprovalResultState | null;
    card?: ApprovalCardView | null;
    sid?: Sid | null;
    blockId?: string;
    density?: "compact" | "roomy";
  }>(),
  {
    block: null,
    message: null,
    turn: null,
    readonly: false,
    state: null,
    card: null,
    sid: null,
    blockId: "",
    density: "compact",
  },
);

const emit = defineEmits<{ (e: "stop"): void }>();

const { t } = useI18nTyped();
const router = useRouter();
const lineEl = ref<HTMLElement | null>(null);
const host = props.readonly ? null : inject(assistantApprovalsHostKey, null);
const evidence = props.readonly ? null : inject(assistantEvidenceHostKey, null);

const sid = computed(() => props.sid ?? props.turn?.sid ?? null);
const live = computed(() => !props.readonly && !!sid.value && !!host);
const session = computed(() => (sid.value && evidence ? evidence.session(sid.value) : null));
const org = computed(() => session.value?.org ?? props.turn?.org ?? "");
const resolved = computed(() => props.block?.resolved ?? null);
const card = computed<ApprovalBlockData | null>(
  () => props.card ?? props.block?.approval ?? approvalOf(resolved.value?.id) ?? null,
);
const record = computed(() =>
  card.value ? approvalOutcomeOf(session.value, card.value.id) : { outcome: null, result: null },
);

const view = computed<ApprovalResultView | null>(() => {
  const { outcome, result } = record.value;
  if (props.state) return { state: props.state, outcome, result };
  if (resolved.value) {
    // A decision made in this tab already has its own record above.
    if (outcome) return null;
    const state = resolvedState(resolved.value);
    const at = resolved.value.at ?? Date.now();
    return {
      state,
      outcome: { state, at, ...(resolved.value.by && { by: resolved.value.by }) },
      result,
    };
  }
  if (!card.value) return null;
  if (sid.value && host?.pendingId(sid.value) === card.value.id) return null;
  if (laterResolution(card.value.id)) return null;
  if (outcome)
    return outcome.state === "expired" && expiredOutcome()
      ? null
      : { state: outcome.state, outcome, result };
  const recorded = recordedView(card.value);
  if (recorded && !(recorded.state === "expired" && expiredOutcome())) return recorded;
  // No decision kept here: a live turn still runs on it elsewhere; a replay of it expired unanswered or was answered where this browser cannot see.
  if (props.turn?.outcome === "live" || expiredOutcome()) return null;
  return { state: "unconfirmed", outcome: null, result: null };
});

const total = computed(() => card.value?.total ?? card.value?.targets?.length ?? 0);

const line = computed<I18nText>(() => {
  const current = view.value;
  if (!current) return raw("");
  const at = current.outcome?.at ?? Date.now();
  const time = raw(formatOrgTime(at));
  switch (current.state) {
    case "sending":
      return t("assistant.approval.result.sending");
    case "approved":
      // A record recovered without its decision time says only that it was approved.
      if (!current.outcome?.at) return t("assistant.approval.result.approvedNoTime");
      return approvedLine() ?? t("assistant.approval.result.approved", { time });
    case "done":
      return doneLine();
    case "answered":
      return t("assistant.question.record.answered", { choice: raw(answerOf()) });
    case "partial":
      return partialLine();
    case "failed":
      return t("assistant.approval.result.failed", { reason: failedReason() });
    case "declined":
      return t("assistant.approval.record.denied", { name: raw(lowerFirst(headingText())) });
    case "editing":
      return editingLine();
    case "new_chat":
      return t("assistant.approval.result.declinedNewChat");
    case "stopped":
      return t("assistant.approval.result.stopped");
    case "replied":
      return t("assistant.approval.record.replied");
    case "narrowed":
      return t("assistant.approval.result.narrowed", {
        count: current.outcome?.decision?.approved
          ? (current.outcome.decision.items?.length ?? 0)
          : 0,
      });
    case "expired":
      return card.value?.kind === "question"
        ? t("assistant.question.record.expired")
        : t("assistant.approval.record.expired");
    case "withdrawn":
      return t("assistant.approval.result.withdrawn");
    case "delivery_failed":
      return t("assistant.approval.deliveryFailed", { entity: entityNoun(1) });
    case "unconfirmed":
      if (current.outcome) return t("assistant.approval.result.unconfirmed");
      return card.value?.noDecision
        ? t("assistant.approval.noDecision")
        : t("assistant.approval.result.unknown");
    case "approved_elsewhere":
      return t("assistant.approval.result.approvedElsewhere", { time });
    case "declined_elsewhere":
      return t("assistant.approval.result.declinedElsewhere", { time });
    default:
      return t("assistant.approval.result.waitingElsewhere");
  }
});

// When and who, at the end of the line; a line that carries its own time keeps it there.
const meta = computed<I18nText | null>(() => {
  const current = view.value;
  const at = current?.outcome?.at;
  if (!current || !at || !TIMED_STATES.has(current.state)) return null;
  const time = raw(formatOrgTime(at));
  return BY_YOU_STATES.has(current.state) ? t("assistant.approval.record.youAt", { time }) : time;
});

const replyText = computed(() =>
  view.value?.state === "replied" && replyOf() ? raw(replyOf()) : null,
);

const back = computed(() => (sid.value ? (host?.backTarget?.(sid.value) ?? null) : null));

const glyph = computed<IconName>(() => {
  const state = view.value?.state;
  if (state === "editing") return assistantGlyph.newTab;
  if (
    state === "done" ||
    state === "approved" ||
    state === "approved_elsewhere" ||
    state === "answered"
  )
    return assistantGlyph.done;
  if (state === "partial" || state === "failed" || state === "delivery_failed")
    return assistantGlyph.failed;
  if (state === "expired") return assistantGlyph.expired;
  if (state === "waiting_elsewhere") return assistantGlyph.elsewhere;
  return assistantGlyph.interrupted;
});

// One item is the line itself; a batch lists its rows.
const rows = computed(() => {
  const items = view.value?.result?.items ?? [];
  if (items.length < 2 && items[0]?.status === "done") return [];
  return items.map((item, index) => {
    return {
      key: item.id ?? `${index}`,
      failed: item.status !== "done",
      text:
        item.status === "done"
          ? raw(item.name)
          : t("assistant.approval.result.failedItem", {
              name: raw(item.name),
              reason: itemReason(item),
            }),
    };
  });
});

const action = computed<{
  id: string;
  label: I18nText;
  name?: I18nText;
  href?: string;
  run?: () => void;
} | null>(() => {
  const state = view.value?.state;
  const id = card.value?.id;
  const current = sid.value;
  if (!host || !current) return null;
  if (state === "waiting_elsewhere")
    return { id: "stop", label: t("assistant.approval.result.stop"), run: () => emit("stop") };
  if (!id || !card.value) return null;
  if (state === "delivery_failed")
    return {
      id: "send-again",
      label: t("assistant.approval.retry"),
      run: () => host.sendAgain(current, id),
    };
  if (state === "approved" || state === "done" || state === "editing") {
    const href = targetHref();
    return href
      ? {
          id: "open",
          label: t("assistant.approval.open"),
          name: t("assistant.approval.result.open", { name: raw(targetName()) }),
          href,
        }
      : null;
  }
  if (state === "expired" && host.gated?.()) return null;
  if (state === "expired" || (state === "unconfirmed" && !card.value.destructive))
    return {
      id: "ask-again",
      label: t("assistant.approval.result.askAgain"),
      run: () => host.askAgain(current, id),
    };
  // What a destructive decision came to is read from the list itself, never asked for again.
  const listed = state === "unconfirmed" ? listHref() : null;
  return listed
    ? {
        id: "check-list",
        label: t("assistant.approval.result.checkList"),
        name: t("assistant.approval.result.checkListName"),
        href: listed,
      }
    : null;
});

function cardFacts() {
  const current = card.value;
  return current ? { ...current, targets: current.targets ?? [] } : null;
}

// A toggle card names its object in its arguments, not in `targets`.
function targetHref(): string | null {
  const facts = cardFacts();
  if (!facts || facts.kind === "delete") return null;
  const id = approvalObjectId(facts);
  const type = facts.targets[0]?.type ?? approvalToolEntity(facts);
  if (!id || !type) return null;
  return approvalTargetHref(router, org.value, { type, id, name: targetName() });
}

function targetName(): string {
  const facts = cardFacts();
  return facts ? (approvalName(facts) ?? "") : "";
}

function headingText(): I18nText {
  const current = card.value;
  return current
    ? approvalHeading(t, { ...current, targets: current.targets ?? [] }, total.value)
    : raw("");
}

function listHref(): string | null {
  const type = approvalEntity(card.value ?? { targets: [] });
  return type === "alert" || type === "dashboard"
    ? approvalTargetHref(router, org.value, { type })
    : null;
}

function approvalOf(id: string | undefined): ApprovalBlockData | null {
  if (!id) return null;
  for (const block of props.message?.contentBlocks ?? [])
    if (block.approval?.id === id) return block.approval;
  return null;
}

function resolvedState(
  block: ResolvedBlockData,
): "expired" | "withdrawn" | "approved_elsewhere" | "declined_elsewhere" | "answered" {
  if (block.expired) return "expired";
  if (block.withdrawn) return "withdrawn";
  if (block.answer !== undefined) return "answered";
  return block.approved ? "approved_elsewhere" : "declined_elsewhere";
}

// The server's approval row of a replayed card reads as a decision of this user, never as another tab's.
function recordedView(current: ApprovalBlockData): ApprovalResultView | null {
  const recorded = current.recorded;
  if (!recorded) return null;
  const state = RECORDED_STATE[recorded.status];
  return { state, outcome: { state, at: recorded.at ?? 0 }, result: null };
}

// A `confirmation_resolved` for this card renders its own line, so the card's block stays quiet.
function laterResolution(id: string): boolean {
  return !!props.message?.contentBlocks?.some((block) => block.resolved?.id === id);
}

// The turn's own expired outcome already says it, with Ask again.
function expiredOutcome(): boolean {
  return !!props.message?.contentBlocks?.some(
    (block) => block.type === "turn_outcome" && block.outcome?.kind === "expired",
  );
}

function entityNoun(n: number): I18nText {
  return t(`assistant.entity.${approvalEntity(card.value ?? { targets: [] })}`, n);
}

// "Paused alert x until 15:37": the effect the card asked for, in the past tense.
function approvedLine(): I18nText | null {
  const facts = cardFacts();
  if (!facts) return null;
  const verb = approvalVerb(facts);
  if (verb !== "pause" && verb !== "resume") return null;
  const noun = t(`assistant.entity.${approvalNoun(facts)}`, 1);
  const params = { entity: noun, name: raw(targetName()) };
  const until = approvalUntil(facts);
  if (verb === "resume") return t("assistant.approval.record.resumed", params);
  return until === null
    ? t("assistant.approval.record.paused", params)
    : t("assistant.approval.record.pausedUntil", { ...params, time: raw(formatOrgTime(until)) });
}

function doneLine(): I18nText {
  const current = card.value;
  if (!current) return raw("");
  const effect = approvedLine();
  if (effect) return effect;
  const done =
    view.value?.result?.items.filter((item) => item.status === "done").length ?? total.value;
  if (current.kind === "delete")
    return t(
      "assistant.approval.result.done.delete",
      { count: done, entity: entityNoun(done) },
      done,
    );
  if (current.kind === "update")
    return t("assistant.approval.result.done.update", {
      entity: entityNoun(1),
      name: raw(current.targets?.[0]?.name ?? ""),
    });
  if (current.kind === "create")
    return t("assistant.approval.result.done.create", { entity: entityNoun(1) });
  if (current.kind === "run_command")
    return t("assistant.approval.result.done.runCommand", {
      toolset: raw(String(current.args?.toolset ?? current.tool ?? "")),
    });
  return t("assistant.approval.result.done.permission", { tool: raw(current.tool ?? "") });
}

function partialLine(): I18nText {
  const items = view.value?.result?.items ?? [];
  const done = items.filter((item) => item.status === "done").length;
  return t("assistant.approval.result.partial", {
    done,
    total: items.length,
    failed: items.length - done,
    entity: entityNoun(items.length),
  });
}

function failedReason(): I18nText {
  const status = view.value?.outcome?.httpStatus;
  if (status === 403) return t("assistant.approval.result.failedForbidden");
  if (status === 402) return t("assistant.approval.result.failedCredits");
  if (status === 412) return t("assistant.approval.result.failedConsent");
  const first = view.value?.result?.items.find((item) => item.status !== "done");
  return first ? itemReason(first) : raw("");
}

function itemReason(item: ApprovalResultItem): I18nText {
  if (item.code === "403") return t("assistant.approval.reason.forbidden");
  if (item.code === "404") return t("assistant.approval.reason.notFound");
  if (item.code) return t("assistant.approval.reason.status", { code: raw(item.code) });
  return t("assistant.approval.reason.unknown");
}

// The editor is named from the card, so a reload says the same thing.
function editingLine(): I18nText {
  const editor = card.value ? approvalEditor(card.value, org.value) : null;
  if (!editor)
    return t("assistant.approval.record.denied", { name: raw(lowerFirst(headingText())) });
  return t("assistant.approval.record.moved", {
    editor: t(`assistant.approval.editor.${editor.type}`),
  });
}

function answerOf(): string {
  const decision = view.value?.outcome?.decision;
  if (decision && !decision.approved) return decision.answerLabel ?? decision.answer ?? "";
  return resolved.value?.answer ?? "";
}

function replyOf(): string {
  const decision = view.value?.outcome?.decision;
  return decision && !decision.approved ? (decision.reply ?? "") : "";
}

watch(
  () => [card.value?.id, view.value?.state, view.value?.outcome?.at] as const,
  ([id, state, at]) => {
    if (!live.value || !sid.value || !evidence || !id || !state || state === "sending") return;
    if (at === undefined || Date.now() - at >= FRESH_MS) return;
    const key = `${sid.value}:${id}:${state}:${at}`;
    if (spoken.has(key)) return;
    if (spoken.size >= MAX_SPOKEN) spoken.clear();
    spoken.add(key);
    evidence.announce(sid.value, line.value);
    // The card just left under the pressed button; the reader lands on what it became.
    void nextTick(() => {
      const active = document.activeElement;
      const line = lineEl.value;
      if (active && active !== document.body && !line?.parentElement?.contains(active)) return;
      line?.focus({ preventScroll: true });
    });
  },
  { immediate: true },
);

function goBack(): void {
  if (sid.value) host?.goBack?.(sid.value);
}
</script>
