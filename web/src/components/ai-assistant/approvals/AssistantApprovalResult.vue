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
    class="rounded-surface border-border-default flex min-w-0 flex-col gap-1.5 border px-3 py-2"
    :data-state="view.state"
    :data-approval-id="card?.id"
    data-test="assistant-approval-result"
  >
    <div class="flex min-w-0 items-start gap-2">
      <OSpinner v-if="view.state === 'sending'" size="xs" class="mt-0.5 shrink-0" />
      <OIcon
        v-else
        :name="glyph"
        size="sm"
        class="text-text-secondary mt-0.5 shrink-0"
        aria-hidden="true"
      />
      <p
        class="text-text-body min-w-0 flex-1 text-sm break-words"
        data-test="assistant-approval-result-line"
      >
        {{ line }}
      </p>
    </div>
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
        <OButton
          v-if="row.href && live"
          variant="ghost-primary"
          size="xs"
          as="a"
          :href="row.href"
          target="_blank"
          rel="noopener noreferrer"
          :icon-right="assistantGlyph.newTab"
          :aria-label="t('assistant.approval.result.open', { name: row.name })"
          :class="TOUCH_TARGET_CLASS"
          :data-test="`assistant-approval-result-open-${row.key}`"
        >
          {{ t("assistant.approval.open") }}
        </OButton>
        <AssistantUndoControl
          v-if="row.entry && live && sid"
          :entry="row.entry"
          :sid="sid"
          test-id="assistant-undo"
        />
      </li>
    </ul>
    <div v-if="action && live" class="flex flex-wrap gap-2 ps-6">
      <OButton
        v-if="action.href"
        variant="outline"
        size="sm"
        as="a"
        :href="action.href"
        target="_blank"
        rel="noopener noreferrer"
        :icon-right="assistantGlyph.newTab"
        :aria-label="action.name"
        :class="TOUCH_TARGET_CLASS"
        :data-test="`assistant-approval-result-${action.id}`"
      >
        {{ action.label }}
      </OButton>
      <OButton
        v-else
        variant="outline"
        size="sm"
        :class="TOUCH_TARGET_CLASS"
        :data-test="`assistant-approval-result-${action.id}`"
        @click="action.run?.()"
      >
        {{ action.label }}
      </OButton>
    </div>
  </div>
</template>

<script lang="ts">
// A decision is spoken once wherever its record renders; the newest few are remembered.
const spoken = new Set<string>();

const MAX_SPOKEN = 200;
</script>

<script setup lang="ts">
import { computed, inject, watch } from "vue";
import { useRouter } from "vue-router";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import {
  approvalEntity,
  approvalOutcomeOf,
  approvalTargetHref,
  assistantEvidenceHostKey,
  type ApprovalBlockData,
  type ApprovalResultItem,
  type AssistantTurnView,
  type ResolvedBlockData,
  type Sid,
} from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatOrgTime } from "@/utils/formatters";

import AssistantUndoControl from "./AssistantUndoControl.vue";
import {
  assistantApprovalsHostKey,
  type ApprovalCardView,
  type ApprovalResultState,
  type ApprovalResultView,
} from "./approvals.types";

/** A record that changed this recently is a decision just made, so it is spoken; an older one is history. */
const FRESH_MS = 3_000;

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
      return t("assistant.approval.result.approved", { time });
    case "done":
      return doneLine();
    case "partial":
      return partialLine();
    case "failed":
      return t("assistant.approval.result.failed", { reason: failedReason() });
    case "declined":
    case "editing":
      return t("assistant.approval.result.declined");
    case "new_chat":
      return t("assistant.approval.result.declinedNewChat");
    case "stopped":
      return t("assistant.approval.result.stopped");
    case "replied":
      return t("assistant.approval.result.replied", { reply: raw(replyOf()) });
    case "narrowed":
      return t("assistant.approval.result.narrowed", {
        count: current.outcome?.decision?.approved
          ? (current.outcome.decision.items?.length ?? 0)
          : 0,
      });
    case "expired":
      return t("assistant.approval.result.expired");
    case "withdrawn":
      return t("assistant.approval.result.withdrawn");
    case "delivery_failed":
      return t("assistant.approval.result.deliveryFailed");
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

const glyph = computed<IconName>(() => {
  const state = view.value?.state;
  if (state === "done" || state === "approved" || state === "approved_elsewhere")
    return assistantGlyph.done;
  if (state === "partial" || state === "failed" || state === "delivery_failed")
    return assistantGlyph.failed;
  if (state === "expired") return assistantGlyph.expired;
  if (state === "waiting_elsewhere") return assistantGlyph.elsewhere;
  return assistantGlyph.interrupted;
});

const rows = computed(() => {
  const ledger = session.value?.ledger ?? [];
  return (view.value?.result?.items ?? []).map((item, index) => {
    const exists = item.status !== "done" || card.value?.kind !== "delete";
    const entry = item.ledgerId
      ? ledger.find((candidate) => candidate.id === item.ledgerId)
      : undefined;
    return {
      key: item.id ?? `${index}`,
      name: raw(item.name),
      failed: item.status !== "done",
      href: exists && item.id ? approvalTargetHref(router, org.value, item) : null,
      entry: entry?.undoable ? entry : null,
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
      label: t("assistant.approval.result.sendAgain"),
      run: () => host.sendAgain(current, id),
    };
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
): "expired" | "withdrawn" | "approved_elsewhere" | "declined_elsewhere" {
  if (block.expired) return "expired";
  if (block.withdrawn) return "withdrawn";
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

function doneLine(): I18nText {
  const current = card.value;
  if (!current) return raw("");
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
  },
  { immediate: true },
);
</script>
