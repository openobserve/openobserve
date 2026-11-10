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
    ref="rootEl"
    class="flex min-w-0 flex-col gap-1"
    :data-state="view.state"
    :data-approval-id="card?.id"
    data-test="assistant-approval-result"
  >
    <AssistantErrorRow
      v-if="view.state === 'delivery_failed'"
      data-test="assistant-approval-result-error"
    >
      <span data-test="assistant-approval-result-line">{{ line }}</span>
      <template v-if="action && live" #actions>
        <AssistantIconButton
          :icon="assistantGlyph.regenerate"
          :label="action.label"
          :data-test="`assistant-approval-result-${action.id}`"
          @click="action.run?.()"
        />
      </template>
    </AssistantErrorRow>
    <template v-else>
      <div
        ref="lineEl"
        tabindex="-1"
        data-approval-line
        class="focus-visible:ring-assistant-focus-ring rounded-default flex min-w-0 items-start gap-1.5 outline-none focus-visible:ring-2"
      >
        <OSpinner v-if="view.state === 'sending'" size="xs" class="mt-0.5 shrink-0" />
        <OIcon
          v-else
          :name="glyph"
          size="sm"
          :class="[
            'mt-0.5 shrink-0',
            view.state === 'skipped' ? 'text-status-warning-text' : 'text-text-secondary',
          ]"
          aria-hidden="true"
          data-test="assistant-approval-result-glyph"
        />
        <p
          :class="[
            'min-w-0 flex-1 text-sm break-words',
            view.state === 'expired' ? 'text-text-secondary' : 'text-text-body',
          ]"
          data-test="assistant-approval-result-line"
        >
          {{ line }}
          <template v-if="standingAllowed">
            {{ raw("·") }}
            <span data-test="assistant-approval-result-always">{{ standingAllowed }}</span>
          </template>
        </p>
        <OBadge
          v-if="view.state === 'skipped'"
          variant="warning-soft"
          size="xs"
          shape="rounded"
          class="mt-0.5 shrink-0"
          data-test="assistant-approval-result-new"
        >
          {{ t("assistant.message.newTag") }}
        </OBadge>
        <OText
          v-if="meta"
          variant="meta"
          as="span"
          class="shrink-0 pt-0.5 whitespace-nowrap"
          data-test="assistant-approval-result-meta"
        >
          {{ meta }}
        </OText>
        <OButton
          v-if="standingAllowed && !revoked && live && revocable"
          variant="ghost-primary"
          size="chip"
          class="shrink-0"
          :loading="revoking"
          :class="TOUCH_TARGET_CLASS"
          data-test="assistant-approval-result-revoke"
          @click="revoke"
        >
          {{ t("assistant.approval.revoke") }}
        </OButton>
        <span v-if="undoEntry && sid" class="flex shrink-0 items-center gap-1.5 text-xs">
          <AssistantUndoControl
            :entry="undoEntry"
            :sid="sid"
            test-id="assistant-approval-result-undo"
          />
        </span>
      </div>
      <p
        v-if="replyText"
        class="text-text-secondary text-sm break-words"
        data-test="assistant-approval-result-reply"
      >
        {{ replyText }}
      </p>
      <AssistantApprovalDiff
        v-if="madeDiff.length"
        class="ps-6"
        :rows="madeDiff"
        data-test="assistant-approval-result-diff"
      />
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
          <span class="min-w-0 break-words">{{ row.text }}</span>
          <AssistantUndoControl
            v-if="row.undo && sid"
            :entry="row.undo"
            :sid="sid"
            test-id="assistant-approval-result-undo"
          />
        </li>
      </ul>
      <!-- C3: the object changed after the ask, so the diff is redrawn against it as it is now -->
      <p
        v-if="skippedMessage"
        class="text-text-secondary ps-6 text-xs break-words"
        data-test="assistant-approval-result-skipped-detail"
      >
        {{ skippedMessage }}
      </p>
      <AssistantApprovalDiff
        v-if="freshDiff.length"
        class="ps-6"
        :rows="freshDiff"
        data-test="assistant-approval-result-fresh-diff"
      />
      <OText
        v-if="anyUndo && sid"
        variant="meta"
        as="p"
        class="ps-6 break-words"
        data-test="assistant-approval-result-undo-limits"
      >
        {{ t("assistant.actions.undoLimits") }}
      </OText>
      <p
        v-if="madeGrantLine"
        class="text-text-secondary flex flex-wrap items-center gap-x-1.5 ps-6 text-xs"
        data-test="assistant-approval-result-always"
        :data-grant="madeGrantLine"
      >
        <OIcon :name="assistantGlyph.done" size="xs" aria-hidden="true" />
        <template v-if="madeGrantLine === 'revoked'">{{ t("assistant.grants.revoked") }}</template>
        <template v-else-if="madeGrantLine === 'not_stored'">
          {{ t("assistant.approval.grantNotStored") }}
        </template>
        <template v-else>
          {{ alwaysAllowed }}
          <template v-if="live && revocable">
            {{ raw("·") }}
            <OButton
              variant="ghost-primary"
              size="chip"
              :loading="revoking"
              :class="TOUCH_TARGET_CLASS"
              data-test="assistant-approval-result-revoke"
              @click="revoke"
            >
              {{ t("assistant.approval.revoke") }}
            </OButton>
          </template>
        </template>
      </p>
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
        data-approval-back
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
import { MutationObserver, QueryObserver } from "@tanstack/vue-query";
import { computed, inject, nextTick, onScopeDispose, ref, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";

import AssistantErrorRow from "@/components/ai-assistant/common/AssistantErrorRow.vue";
import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import { isRunning } from "@/composables/assistant";
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
  approvalVerb,
  assistantEvidenceHostKey,
  assistantTranscriptHostKey,
  type ActionLedgerEntry,
  type ApprovalBlockData,
  type ApprovalResult,
  type ApprovalResultItem,
  type AssistantTurnView,
  type ResolvedBlockData,
  type ResolvedGrant,
  type Sid,
} from "@/composables/assistant/pure";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { queryClient } from "@/composables/query/queryClient";
import type { AssistantGrant } from "@/services/assistant_settings";
import { assistantGrantsQuery, revokeGrantMutation } from "@/services/assistant_settings.queries";
import { assistantSettingsKeys } from "@/services/assistant_settings.querykeys";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatOrgTime } from "@/utils/formatters";

import AssistantApprovalDiff from "./AssistantApprovalDiff.vue";
import AssistantUndoControl from "./AssistantUndoControl.vue";
import {
  approvalActionPhrase,
  approvalDiffRows,
  lowerFirst,
  panelDashboardId,
  pauseUntil,
  readableCard,
  readableReason,
  statusReason,
} from "./approvalText";
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
  "skipped",
  "editing",
  "declined",
  "replied",
  "answered",
  "expired",
  "standing",
]);

const BY_YOU_STATES: ReadonlySet<ApprovalResultState> = new Set([
  "approved",
  "done",
  "partial",
  "skipped",
]);

// The kinds a granted write can have; a grant never covers a delete, but the wire is read as it says.
const GRANT_KINDS = ["create", "update", "delete"] as const;

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
const rootEl = ref<HTMLElement | null>(null);
const host = props.readonly ? null : inject(assistantApprovalsHostKey, null);
const evidence = props.readonly ? null : inject(assistantEvidenceHostKey, null);
const transcript = props.readonly ? null : inject(assistantTranscriptHostKey, null);

const sid = computed(() => props.sid ?? props.turn?.sid ?? null);
const live = computed(() => !props.readonly && !!sid.value && !!host);
const session = computed(() => (sid.value && evidence ? evidence.session(sid.value) : null));
const turnRunning = computed(() => (session.value?.turn ? isRunning(session.value.turn) : false));
const org = computed(() => session.value?.org ?? props.turn?.org ?? "");
const resolved = computed(() => props.block?.resolved ?? null);
const card = computed<ApprovalBlockData | null>(
  () =>
    props.card ??
    props.block?.approval ??
    cardOf(resolved.value?.id) ??
    grantedCard(resolved.value) ??
    null,
);
const record = computed(() =>
  card.value ? approvalOutcomeOf(session.value, card.value.id) : { outcome: null, result: null },
);

// A reopened chat's per-target rows come with its stored resolution.
const resolvedResult = computed<ApprovalResult | null>(() => {
  const items = resolved.value?.items;
  if (!items?.length) return null;
  const done = items.filter((item) => item.status === "done").length;
  const status =
    done === items.length
      ? "done"
      : items.every((item) => item.status === "skipped")
        ? "skipped"
        : done
          ? "partial"
          : "failed";
  return {
    status,
    items,
    resolvedBy: resolved.value?.by ?? "",
    resolvedAt: resolved.value?.at ?? 0,
  };
});

const view = computed<ApprovalResultView | null>(() => {
  const outcome = record.value.outcome;
  const result = record.value.result ?? resolvedResult.value;
  if (props.state) return { state: props.state, outcome, result };
  if (resolved.value) {
    // A decision made in this tab already has its own record above; one refused while another was deciding ends here.
    if (outcome && outcome.state !== "deciding") return null;
    const state = resolvedState(resolved.value);
    const at = resolved.value.at ?? Date.now();
    const { by, detail } = resolved.value;
    return {
      state,
      outcome: {
        // A grant is an approve the user gave once for every later call.
        state: state === "standing" ? "approved" : state,
        at,
        ...(by && { by }),
        ...(state === "failed" && detail && { reason: detail }),
      },
      result,
    };
  }
  if (!card.value) return null;
  if (sid.value && host?.pendingId(sid.value) === card.value.id) return null;
  if (session.value?.queuedApprovals?.some((queued) => queued.id === card.value?.id)) return null;
  // A decision made here keeps its own record even when its `confirmation_resolved` follows.
  if ((!outcome || outcome.state === "deciding") && laterResolution(card.value.id)) return null;
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
    case "skipped":
      return skippedCode() === "recheck_failed"
        ? t("assistant.approval.recheckFailed")
        : t("assistant.approval.changedSince");
    case "failed":
      return t("assistant.approval.result.failed", { reason: failedReason() });
    case "declined":
      return deniedLine();
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
    case "deciding":
      return t("assistant.approval.result.deciding");
    case "unconfirmed":
      if (current.outcome) return t("assistant.approval.result.unconfirmed");
      return card.value?.noDecision
        ? t("assistant.approval.noDecision")
        : t("assistant.approval.result.unknown");
    case "standing":
      if (!card.value) return t("assistant.approval.result.standing");
      return approvedLine() ?? doneLine();
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

const undoEntries = computed(() => {
  const id = card.value?.id;
  if (!live.value || !id) return [];
  return (session.value?.ledger ?? []).filter((entry) => entry.approvalId === id);
});

// A record with rows carries each target's Undo on its row; without rows its one Undo, or its Restored, sits on the line.
const undoEntry = computed(() => {
  const entries = undoEntries.value;
  if (rows.value.length || entries.length !== 1) return null;
  // A reopened chat reads an undone row as no longer undoable, yet it still says Restored.
  return entries[0].undoable || entries[0].status === "undone" ? entries[0] : null;
});

const anyUndo = computed(
  () => !!undoEntry.value?.undoable || rows.value.some((row) => row.undo?.undoable === true),
);

const replyText = computed(() =>
  view.value?.state === "replied" && replyOf() ? raw(replyOf()) : null,
);

/** C3: why the approved write was skipped, from the item or the resolution. */
function skippedCode(): string | undefined {
  return (
    view.value?.result?.items.find((item) => item.status === "skipped")?.code ??
    resolved.value?.code
  );
}

const skippedItem = computed(() =>
  view.value?.state === "skipped"
    ? (view.value.result?.items.find((item) => item.status === "skipped") ?? null)
    : null,
);

const skippedMessage = computed<I18nText | null>(() => {
  if (view.value?.state !== "skipped") return null;
  const message = skippedItem.value?.message ?? resolved.value?.detail;
  return message ? raw(message) : null;
});

const freshDiff = computed(() => {
  const item = skippedItem.value;
  if (!item || item.code !== "changed_since" || item.before === undefined || !card.value) return [];
  return approvalDiffRows(t, card.value, item.before);
});

// What an applied update changed; a pause or resume already says its effect in the line.
const madeDiff = computed(() => {
  const state = view.value?.state;
  const current = card.value;
  if (state !== "done" && state !== "approved") return [];
  if (!current || current.kind !== "update" || approvedLine()) return [];
  return approvalDiffRows(t, current);
});

/** "Always allowed: …" under a write approved for every later call of its tool. */
const alwaysAllowed = computed<I18nText | null>(() => {
  const state = view.value?.state;
  const facts = cardFacts();
  if (!facts) return null;
  if (state === "standing")
    return resolved.value?.scope === "chat"
      ? t("assistant.approval.allowedForChat", { action: approvalActionPhrase(t, facts) })
      : t("assistant.approval.alwaysAllowed", { action: approvalActionPhrase(t, facts) });
  const scope = madeGrantScope.value;
  if (!scope) return null;
  return scope === "chat"
    ? t("assistant.approval.allowedForChat", { action: approvalActionPhrase(t, facts) })
    : t("assistant.approval.alwaysAllowed", { action: approvalActionPhrase(t, facts) });
});

// The grant an approve made for later calls; a reopened chat has only the stored resolution's scope.
const madeGrantScope = computed<"chat" | "always" | null>(() => {
  const state = view.value?.state;
  if (state !== "done" && state !== "approved" && state !== "partial") return null;
  const decision = view.value?.outcome?.decision;
  if (decision) {
    if (!decision.approved) return null;
    return decision.scope === "tool" ? "always" : decision.scope === "chat" ? "chat" : null;
  }
  const scope = resolved.value?.approved === true ? resolved.value.scope : undefined;
  return scope === "always" || scope === "chat" ? scope : null;
});

// The reader's grants as the server lists them now; null until a settled read.
const grants = shallowRef<AssistantGrant[] | null>(null);
const grantsFailed = ref(false);

const madeGrant = computed(() =>
  grants.value ? (grantMadeHere(grants.value) ?? null) : undefined,
);

// Revoke is offered only for a grant the server holds, so it never claims a revoke it did not make.
const revocable = computed(() =>
  view.value?.state === "standing"
    ? !!grantOf(resolved.value)?.id
    : !!card.value?.tool && !!madeGrant.value,
);

const revoking = ref(false);
const revokedHere = ref(false);
const revoked = computed(() => revokedHere.value || madeGrantLine.value === "revoked");

// A grant this tab just asked for and the server does not list was never stored, not revoked since.
const madeGrantLine = computed<"listed" | "revoked" | "not_stored" | null>(() => {
  if (!alwaysAllowed.value || standingAllowed.value) return null;
  if (revokedHere.value) return "revoked";
  const outcome = view.value?.outcome;
  if (outcome?.grant?.stored === false || resolved.value?.grantNotStored) return "not_stored";
  if (!live.value || grantsFailed.value) return "listed";
  if (madeGrant.value === undefined) return null;
  if (madeGrant.value) return "listed";
  return outcome?.decision ? "not_stored" : "revoked";
});

let stopGrants: (() => void) | null = null;

watch(
  () => (live.value && madeGrantScope.value && card.value?.tool ? org.value : ""),
  (current) => {
    stopGrants?.();
    stopGrants = null;
    grants.value = null;
    grantsFailed.value = false;
    if (!current) return;
    // A decision made in this tab stored its grant after any earlier read, so the list is read again.
    if (view.value?.outcome?.decision)
      void queryClient.invalidateQueries({ queryKey: assistantSettingsKeys.grants(current) });
    const observer = new QueryObserver(queryClient, assistantGrantsQuery(current));
    const report = () => {
      const result = observer.getCurrentResult();
      // A refetch keeps the last settled list, so the line never blinks out under the reader.
      if (result.isFetching) return;
      grants.value = result.isSuccess ? (result.data ?? []) : null;
      grantsFailed.value = result.isError;
    };
    stopGrants = observer.subscribe(report);
    report();
  },
  { immediate: true },
);

onScopeDispose(() => stopGrants?.());

// A granted write had no card, so what allowed it shares the record's line: "Paused alert x · Always allowed: pausing alerts".
const standingAllowed = computed<I18nText | null>(() => {
  if (view.value?.state !== "standing" || !alwaysAllowed.value) return null;
  return revokedHere.value ? t("assistant.grants.revoked") : alwaysAllowed.value;
});

// A standing record revokes the grant it ran under; an approving one the grant it made.
async function revoke(): Promise<void> {
  if (!card.value?.tool || revoking.value || !org.value) return;
  revoking.value = true;
  try {
    const id =
      grantOf(resolved.value)?.id ??
      madeGrant.value?.id ??
      grantMadeHere(
        await queryClient.fetchQuery({ ...assistantGrantsQuery(org.value), staleTime: 0 }),
      )?.id;
    if (!id) throw new Error("no stored grant to revoke");
    // A record outlives any one page, so it runs the declared mutation on the app's client, not a hook.
    await new MutationObserver(queryClient, revokeGrantMutation(org.value)).mutate(id);
    revokedHere.value = true;
  } catch (error) {
    console.error("Failed to revoke the standing approval:", error);
    toast({ variant: "error", message: t("assistant.approval.revokeFailed") });
  } finally {
    revoking.value = false;
  }
}

// An admin lists every member's grants, so only the reader's own grant of this scope counts.
function grantMadeHere(
  rows: readonly AssistantGrant[] | null | undefined,
): AssistantGrant | undefined {
  const tool = card.value?.tool;
  const scope = madeGrantScope.value;
  if (!scope) return undefined;
  // The server compares emails case-insensitively, so the reader's own grant matches the same way.
  const user = host?.currentUser()?.toLowerCase();
  return rows?.find(
    (row) =>
      row.tool === tool &&
      row.scope === scope &&
      (!user || row.granted_by?.toLowerCase() === user) &&
      (scope !== "chat" || row.chat_id === sid.value),
  );
}

const back = computed(() =>
  sid.value ? (host?.backTarget?.(sid.value, card.value?.id) ?? null) : null,
);

const glyph = computed<IconName>(() => {
  const state = view.value?.state;
  if (state === "editing") return assistantGlyph.newTab;
  if (
    state === "done" ||
    state === "approved" ||
    state === "approved_elsewhere" ||
    state === "standing" ||
    state === "answered"
  )
    return assistantGlyph.done;
  if (state === "skipped") return assistantGlyph.warning;
  if (state === "partial" || state === "failed" || state === "delivery_failed")
    return assistantGlyph.failed;
  if (state === "expired") return assistantGlyph.expired;
  if (state === "waiting_elsewhere" || state === "deciding") return assistantGlyph.elsewhere;
  return assistantGlyph.interrupted;
});

// Gathered targets can share a name with no id, so the server's ledger id binds a row to its own entry first.
function undoEntryOf(item: ApprovalResultItem): ActionLedgerEntry | null {
  const entries = undoEntries.value;
  if (item.ledgerId) return entries.find((entry) => entry.id === item.ledgerId) ?? null;
  return (
    entries.find((entry) =>
      item.id ? entry.resource.id === item.id : entry.resource.name === item.name,
    ) ?? null
  );
}

// One item is the line itself; a batch lists its rows.
const rows = computed(() => {
  const items = view.value?.result?.items ?? [];
  if (items.length < 2 && (items[0]?.status === "done" || items[0]?.status === "skipped"))
    return [];
  return items.map((item, index) => {
    return {
      key: item.id ?? `${index}`,
      failed: item.status !== "done",
      undo: item.status === "done" ? undoEntryOf(item) : null,
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
  if (state === "approved" || state === "done" || state === "editing" || state === "standing") {
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
  if (state === "skipped")
    return {
      id: "ask-again",
      label: t("assistant.approval.result.askAgain"),
      run: () => host.askAgain(current, id),
    };
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
  return current ? readableCard({ ...current, targets: current.targets ?? [] }) : null;
}

// What the write answered with wins over what the card asked for; a new panel opens its dashboard.
function targetHref(): string | null {
  const facts = cardFacts();
  if (!facts || facts.kind === "delete") return null;
  if (total.value > 1) return listHref();
  const made = createdHref();
  if (made) return made;
  const dashboard = panelDashboardId(facts);
  if (dashboard) return approvalTargetHref(router, org.value, { type: "dashboard", id: dashboard });
  const id = approvalObjectId(facts);
  const type = facts.targets[0]?.type ?? approvalToolEntity(facts);
  if (!id || !type) return null;
  return approvalTargetHref(router, org.value, { type, id, name: targetName() });
}

// Only a same-origin link: the record is model-influenced, and Open never leaves the app.
function createdHref(): string | null {
  const items = view.value?.result?.items ?? [];
  const item = items.length === 1 && items[0].status === "done" ? items[0] : null;
  if (!item) return null;
  if (item.link) {
    try {
      const url = new URL(item.link, window.location.origin);
      if (url.origin === window.location.origin) return url.pathname + url.search + url.hash;
    } catch {
      // An unparsable link falls through to the id.
    }
  }
  const type = item.type || card.value?.targets?.[0]?.type;
  return item.id && type
    ? approvalTargetHref(router, org.value, { type, id: item.id, name: item.name })
    : null;
}

function targetName(): string {
  const facts = cardFacts();
  return facts ? (approvalName(facts) ?? "") : "";
}

// A record read back without its card has no heading; the server's detail is a reason, never the name of what was denied.
function deniedLine(): I18nText {
  const name = String(headingText()).trim();
  if (name) return t("assistant.approval.record.denied", { name: raw(lowerFirst(name)) });
  const detail = resolved.value?.detail?.trim();
  if (detail) return t("assistant.approval.record.deniedUnnamedReason", { reason: raw(detail) });
  return t("assistant.approval.record.deniedUnnamed");
}

function headingText(): I18nText {
  const facts = cardFacts();
  return facts ? approvalHeading(t, facts, total.value) : raw("");
}

function listHref(): string | null {
  const type = approvalEntity(card.value ?? { targets: [] });
  return type === "alert" || type === "dashboard"
    ? approvalTargetHref(router, org.value, { type })
    : null;
}

function cardOf(id: string | undefined): ApprovalBlockData | null {
  if (!id) return null;
  for (const block of props.message?.contentBlocks ?? [])
    if (block.approval?.id === id) return block.approval;
  return null;
}

// The grant a `by: "grant"` resolution carries (handoff-FX-L5 §1); absent until the reducer keeps it.
function grantOf(block: ResolvedBlockData | null | undefined): ResolvedGrant | undefined {
  return block?.by === "grant" ? block.grant : undefined;
}

// A write run under a standing grant has no card; its frame names the tool and targets.
function grantedCard(block: ResolvedBlockData | null): ApprovalBlockData | null {
  const grant = grantOf(block);
  if (!block || !grant?.tool) return null;
  const kind = GRANT_KINDS.find((known) => known === grant.operation) ?? "update";
  return {
    id: block.id,
    kind,
    destructive: kind === "delete",
    operation: grant.operation ?? "",
    tool: grant.tool,
    targets: grant.targets ?? [],
    grantable: false,
    editable: false,
    question: "",
    typed: true,
  };
}

// An approval the server could not carry out changed nothing, wherever it was given; a reopened chat's decision is its own.
function resolvedState(
  block: ResolvedBlockData,
): Exclude<ApprovalResultState, "waiting_elsewhere"> {
  if (block.expired) return "expired";
  if (block.withdrawn) return "withdrawn";
  if (block.answer !== undefined) return "answered";
  if (block.approved && (block.outcome === "failed" || block.outcome === "denied")) return "failed";
  if (block.approved && block.outcome === "skipped") return "skipped";
  if (block.approved && block.by === "grant") return "standing";
  if (block.recorded && block.approved) return block.outcome === "partial" ? "partial" : "done";
  if (block.recorded) return "declined";
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
  const until = pauseUntil(facts, view.value?.outcome?.at);
  const time = until === null ? null : raw(formatOrgTime(until));
  if (total.value > 1) return batchEffectLine(verb, facts, time);
  const noun = t(`assistant.entity.${approvalNoun(facts)}`, 1);
  const params = { entity: noun, name: raw(targetName()) };
  if (verb === "resume") return t("assistant.approval.record.resumed", params);
  return time === null
    ? t("assistant.approval.record.paused", params)
    : t("assistant.approval.record.pausedUntil", { ...params, time });
}

// "Paused 2 alerts until 15:37": a batch says how many; its rows name them.
function batchEffectLine(
  verb: "pause" | "resume",
  facts: NonNullable<ReturnType<typeof cardFacts>>,
  time: I18nText | null,
): I18nText {
  const items = view.value?.result?.items;
  const count = items?.length ? items.filter((item) => item.status === "done").length : total.value;
  const params = { count, entity: t(`assistant.entity.${approvalNoun(facts)}`, count) };
  if (verb === "resume") return t("assistant.approval.record.resumedCount", params, count);
  return time === null
    ? t("assistant.approval.record.pausedCount", params, count)
    : t("assistant.approval.record.pausedCountUntil", { ...params, time }, count);
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

// Before a reopened chat's per-target rows arrive, the stored resolution says only that part failed.
function partialLine(): I18nText {
  const items = view.value?.result?.items ?? [];
  if (!items.length) {
    const reason = resolved.value?.detail?.trim();
    return reason
      ? t("assistant.approval.result.partialUnnamed", { reason: raw(reason) })
      : t("assistant.approval.result.partialUnnamedPlain");
  }
  const done = items.filter((item) => item.status === "done").length;
  const facts = cardFacts();
  const verb = (facts && approvalVerb(facts)) ?? "change";
  return t(`assistant.approval.result.partialBy.${verb}`, {
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
  if (first) return itemReason(first);
  return view.value?.outcome?.reason ? readableReason(view.value.outcome.reason, t) : raw("");
}

function itemReason(item: ApprovalResultItem): I18nText {
  const known = item.code ? statusReason(Number(item.code), t) : null;
  if (known) return known;
  if (item.message) return readableReason(item.message, t);
  if (item.code) return t("assistant.approval.reason.status", { code: raw(item.code) });
  return t("assistant.approval.reason.unknown");
}

// The editor is named from the card, so a reload says the same thing.
function editingLine(): I18nText {
  const editor = card.value ? approvalEditor(card.value, org.value) : null;
  if (!editor) return deniedLine();
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
      // A turn that already ended (a Deny often does) has no later idle edge to hand focus back on.
      if (!turnRunning.value && transcript) transcript.focusComposer();
      else line?.focus({ preventScroll: true });
    });
  },
  { immediate: true },
);

// A record left focused when its turn ends would strand the reader above the next prompt.
watch(turnRunning, (running, wasRunning) => {
  if (running || !wasRunning) return;
  const active = document.activeElement;
  if (active && rootEl.value?.contains(active)) transcript?.focusComposer();
});

function goBack(): void {
  if (sid.value) host?.goBack?.(sid.value);
}
</script>
