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
  <section ref="root" class="flex min-w-0 flex-col gap-3" data-test="autoresolve-approval-request">
    <AutoResolveCorrectionsUsed
      v-if="run.corrections_used?.length"
      :corrections="run.corrections_used"
      :autoresolve="run.autoresolve ?? null"
      :options="optionCards"
      class="self-start"
    />
    <ORadioGroup
      v-if="options.length"
      :model-value="pickedId"
      orientation="horizontal"
      :label="t('autoresolve.approval.optionsLabel')"
      :disabled="!waiting"
      class="grid grid-cols-2 max-md:grid-cols-1"
      data-test="autoresolve-approval-options"
      @update:model-value="(value) => (pickedId = String(value))"
    >
      <ORadio
        v-for="option in options"
        :key="option.id"
        :value="option.id"
        variant="card"
        data-test="autoresolve-approval-option"
        :data-test-value="option.id"
      >
        <template #label>
          <span class="flex min-w-0 flex-col gap-1">
            <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span class="text-text-heading text-sm font-semibold wrap-anywhere">
                {{ option.title }}
              </span>
              <OTag
                v-if="option.recommended && !option.partial_fix"
                variant="success-soft"
                :label="t('autoresolve.approval.recommended')"
                data-test="autoresolve-approval-recommended"
              />
              <OTag
                v-if="option.partial_fix"
                variant="warning-soft"
                :label="t('autoresolve.approval.partialFix')"
                data-test="autoresolve-approval-partial-fix"
              />
            </span>
            <span class="text-text-secondary text-xs font-normal">{{ stepSummary(option) }}</span>
            <span
              v-if="option.partial_fix"
              class="text-text-body text-xs font-normal wrap-anywhere"
              data-test="autoresolve-approval-partial-fix-text"
              >{{
                t("autoresolve.approval.partialFixLeaves", { text: raw(option.partial_fix) })
              }}</span
            >
            <span
              v-if="removedIn(option).length"
              class="flex flex-wrap gap-1"
              data-test="autoresolve-approval-option-removed"
            >
              <AutoResolveRemovedConnection
                v-for="name in removedIn(option)"
                :key="name"
                :name="name"
                size="xs"
              />
            </span>
            <AutoResolveModelText
              v-if="option.tradeoffs"
              :text="option.tradeoffs"
              class="text-compact font-normal"
            />
          </span>
        </template>
      </ORadio>
    </ORadioGroup>

    <ODescriptionList v-if="recommended?.reason" dense label-width="narrow">
      <ODescriptionItem :label="t('autoresolve.step.reason')" data-test="autoresolve-approval-why">
        <AutoResolveModelText :text="recommended.reason" class="text-compact" />
      </ODescriptionItem>
    </ODescriptionList>

    <p
      v-if="omittedCount > 0"
      class="text-text-secondary m-0 text-xs wrap-anywhere"
      data-test="autoresolve-approval-omitted"
    >
      {{ omittedText }}
    </p>

    <OInlineNotice
      v-if="heldWhilePlanning.length"
      variant="warning"
      :text="heldText"
      data-test="autoresolve-approval-held-while-planning"
      class="self-start"
    />

    <OInlineNotice
      v-if="plan?.missing_capability && !plan.missing_connection"
      variant="warning"
      :text="missingCapabilityText"
      data-test="autoresolve-approval-missing-capability"
      class="self-start"
    />

    <div
      v-if="picked"
      class="rounded-surface border-border-default bg-surface-base flex min-w-0 flex-col overflow-hidden border"
      data-test="autoresolve-approval-steps"
    >
      <div class="border-border-default bg-surface-subtle grid min-w-0 border-b px-4 py-2">
        <div
          v-for="option in options"
          :key="option.id"
          class="col-start-1 row-start-1 flex min-w-0 items-baseline gap-2"
          :class="option.id === pickedId ? '' : 'invisible'"
          :aria-hidden="option.id === pickedId ? undefined : 'true'"
        >
          <h3
            class="text-text-heading m-0 min-w-0 text-sm font-semibold wrap-anywhere"
            :data-test="option.id === pickedId ? 'autoresolve-approval-in-full' : undefined"
          >
            {{ t("autoresolve.approval.inFull", { title: raw(option.title) }) }}
          </h3>
          <span class="text-text-secondary shrink-0 text-xs">
            {{
              t("autoresolve.run.stepCount", { count: option.steps.length }, option.steps.length)
            }}
          </span>
        </div>
      </div>
      <div class="grid min-w-0">
        <ol
          v-for="option in options"
          :key="option.id"
          class="divide-border-subtle col-start-1 row-start-1 m-0 flex min-w-0 list-none flex-col divide-y p-0"
          :class="option.id === pickedId ? '' : 'invisible'"
          :aria-hidden="option.id === pickedId ? undefined : 'true'"
          :data-test="option.id === pickedId ? 'autoresolve-approval-picked-steps' : undefined"
        >
          <AutoResolveStepCard
            v-for="step in option.steps"
            :key="step.id"
            :step="withRemovedMark(step)"
          />
        </ol>
      </div>
    </div>

    <div v-if="anyChanges" class="grid min-w-0" data-test="autoresolve-approval-changes">
      <p
        v-for="option in options"
        :key="option.id"
        class="text-text-body col-start-1 row-start-1 m-0 min-w-0 text-xs wrap-anywhere"
        :class="option.id === pickedId ? '' : 'invisible'"
        :aria-hidden="option.id === pickedId ? undefined : 'true'"
        :data-test="option.id === pickedId ? 'autoresolve-approval-changes-line' : undefined"
      >
        {{ approvingChangesText(option.changes, t) }}
      </p>
    </div>

    <AutoResolveCorrectionPanel
      v-if="waiting && asking === 'correct'"
      :run="run"
      :option="picked ? { id: picked.id, title: picked.title } : null"
      :submitting="submitting"
      :notice="notice"
      @send="(body) => emit('replan', body)"
      @cancel="asking = null"
    />

    <div
      v-else-if="waiting && asking === 'removed'"
      class="flex flex-col gap-2"
      data-test="autoresolve-approval-replan"
    >
      <OTextarea
        v-model="note"
        autogrow
        :min-rows="WRITING_ROWS_REST"
        :max-rows="WRITING_ROWS_MAX"
        :label="t('autoresolve.approval.noteLabel')"
        :placeholder="t('autoresolve.approval.notePlaceholder')"
        :disabled="submitting"
        autofocus
        data-test="autoresolve-approval-replan-note"
      />
      <div class="flex flex-wrap items-center justify-end gap-2">
        <OInlineNotice
          v-if="notice"
          :variant="notice.variant"
          wrap
          :text="notice.text"
          class="min-w-0 flex-1"
          data-test="autoresolve-approval-action-notice"
        />
        <OButton
          variant="outline"
          size="sm-action"
          :disabled="submitting"
          data-test="autoresolve-approval-replan-cancel"
          @click="asking = null"
        >
          {{ t("common.cancel") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :disabled="!note.trim()"
          :loading="submitting"
          data-test="autoresolve-approval-replan-send"
          @click="emit('replan', { note: note.trim() })"
        >
          {{ t("autoresolve.approval.sendNote") }}
        </OButton>
      </div>
    </div>

    <div
      v-else-if="waiting && pickedBlocked"
      class="flex min-w-0 flex-wrap items-center justify-between gap-3"
      data-test="autoresolve-approval-removed"
    >
      <OInlineNotice
        :variant="notice?.variant ?? 'error'"
        wrap
        :text="notice?.text ?? removedText"
        data-test="autoresolve-approval-connection-removed"
        class="min-w-0 flex-1"
      />
      <div v-if="canReplan" class="flex flex-wrap items-center gap-2">
        <OButton
          variant="ghost"
          size="sm-action"
          :disabled="submitting"
          data-test="autoresolve-approval-decline"
          @click="emit('decline')"
        >
          {{ t("autoresolve.approval.decline") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :disabled="submitting"
          data-test="autoresolve-approval-ask"
          @click="askWithoutRemoved"
        >
          {{ t("autoresolve.approval.askDifferent") }}
        </OButton>
      </div>
    </div>

    <div
      v-else-if="waiting && !denied"
      class="flex flex-col gap-2"
      data-test="autoresolve-approval-actions"
    >
      <!-- The caption slot is one notice tall, so a failed request does not push the buttons. -->
      <div class="grid justify-items-end">
        <OInlineNotice
          v-if="notice"
          :variant="notice.variant"
          wrap
          :text="notice.text"
          class="col-start-1 row-start-1"
          data-test="autoresolve-approval-action-notice"
        />
        <p
          v-else
          class="text-text-secondary col-start-1 row-start-1 m-0 flex min-w-0 flex-wrap justify-end gap-x-3 gap-y-0.5 self-center text-xs"
          data-test="autoresolve-approval-caption"
        >
          <span class="wrap-anywhere">{{
            t("autoresolve.approval.canApprove", { names: approvers })
          }}</span>
          <span v-if="run.approval_deadline_us">
            {{ deadlineText(run.approval_deadline_us, LAPSES_KEYS, t) }}
          </span>
        </p>
        <OInlineNotice
          variant="error"
          :text="t('autoresolve.run.approveFailed')"
          class="invisible col-start-1 row-start-1"
          aria-hidden="true"
        />
      </div>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <OButton
          variant="ghost"
          size="sm-action"
          :disabled="submitting"
          data-test="autoresolve-approval-decline"
          @click="emit('decline')"
        >
          {{ t("autoresolve.approval.decline") }}
        </OButton>
        <OButton
          variant="outline"
          size="sm-action"
          :disabled="submitting"
          data-test="autoresolve-approval-correct"
          @click="asking = 'correct'"
        >
          {{ t("autoresolve.approval.correctPlan") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :loading="submitting"
          :disabled="!picked"
          data-test="autoresolve-approval-approve"
          @click="picked && emit('approve', picked.id)"
        >
          {{ t("autoresolve.approval.approve") }}
        </OButton>
      </div>
    </div>

    <div
      v-else-if="waiting"
      class="flex min-w-0 flex-wrap items-center justify-between gap-3"
      data-test="autoresolve-approval-denied"
    >
      <OInlineNotice
        :variant="notice?.variant ?? 'error'"
        wrap
        :text="notice?.text ?? cannotApproveText"
        data-test="autoresolve-approval-cannot-approve"
        class="min-w-0 flex-1"
      />
      <OButton
        v-if="isRequester"
        variant="ghost"
        size="sm-action"
        :disabled="submitting"
        data-test="autoresolve-approval-decline"
        @click="emit('decline')"
      >
        {{ t("autoresolve.approval.decline") }}
      </OButton>
    </div>

    <div v-else-if="run.state === 'lapsed'" class="flex flex-col gap-2">
      <OBanner variant="warning" inline-actions data-test="autoresolve-approval-lapsed">
        <span class="font-semibold">{{ lapsedTitle }}</span>
        {{ t("autoresolve.approval.lapsedBody") }}
        <template #actions>
          <span
            v-if="allConnectionsRemoved"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
            data-test="autoresolve-approval-start-again-removed"
          >
            <span class="text-text-secondary">{{
              t("autoresolve.approval.connectionsGone", usedCount)
            }}</span>
            <router-link
              :to="chooseConnections"
              class="text-text-link font-semibold hover:underline"
              data-test="autoresolve-approval-choose-connections"
            >
              {{ t("autoresolve.approval.chooseConnections") }}
            </router-link>
          </span>
          <OButton
            v-else
            variant="primary"
            size="sm-action"
            :loading="startAgain.isPending.value"
            data-test="autoresolve-approval-start-again"
            @click="onStartAgain"
          >
            {{ t("autoresolve.approval.startAgain") }}
          </OButton>
        </template>
      </OBanner>
      <span
        v-if="startAgainError"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
        data-test="autoresolve-approval-start-again-refused"
      >
        <OInlineNotice
          variant="error"
          wrap
          :text="startAgainError"
          data-test="autoresolve-approval-start-again-error"
        />
        <router-link
          v-if="startAgainRefused"
          :to="chooseConnections"
          class="text-text-link font-semibold hover:underline"
          data-test="autoresolve-approval-choose-connections"
        >
          {{ t("autoresolve.approval.chooseConnections") }}
        </router-link>
      </span>
    </div>

    <p
      v-else-if="run.state === 'declined'"
      class="text-text-secondary m-0 text-sm"
      data-test="autoresolve-approval-declined"
    >
      {{ t("autoresolve.approval.declined") }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useMutation } from "@tanstack/vue-query";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import type { InlineNoticeVariant } from "@/lib/feedback/InlineNotice/OInlineNotice.types";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import AutoResolveCorrectionPanel from "@/components/autoresolve/AutoResolveCorrectionPanel.vue";
import AutoResolveModelText from "@/components/autoresolve/AutoResolveModelText.vue";
import AutoResolveCorrectionsUsed from "@/components/autoresolve/AutoResolveCorrectionsUsed.vue";
import AutoResolveRemovedConnection from "@/components/autoresolve/AutoResolveRemovedConnection.vue";
import AutoResolveStepCard from "@/components/autoresolve/AutoResolveStepCard.vue";
import { useOrgId } from "@/composables/query/useOrgId";
import {
  autoresolveErrorMessage,
  autoresolveErrorStatus,
  usesRemovedConnection,
  type AutoResolveApprover,
  type AutoResolveOption,
  type AutoResolveReplanInput,
  type AutoResolveRun,
  type AutoResolveStep,
} from "@/services/autoresolve";
import { startAutoResolveRunMutation } from "@/services/autoresolve.queries";
import productAnalytics from "@/services/product_analytics";
import store from "@/stores";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  approversSentence,
  approvingChangesText,
  deadlineText,
  investigationSummary,
  isRunRequester,
  namesSentence,
  needsText,
  runConnections,
  theMcps,
  theMcpsStart,
  WRITING_ROWS_MAX,
  WRITING_ROWS_REST,
} from "@/utils/autoresolve/autoresolveText";

const LAPSES_KEYS = ["autoresolve.approval.lapsesAt", "autoresolve.approval.lapsesOn"] as const;
const LAPSED_KEYS = ["autoresolve.approval.lapsedAt", "autoresolve.approval.lapsedOn"] as const;

const props = defineProps<{
  run: AutoResolveRun;
  /** An approve, decline or replan request is in flight. */
  submitting: boolean;
  /** The server refused approving this option, naming who may; the run alone can't say so. */
  refused?: { optionId: string; approvers: AutoResolveApprover[] } | null;
  /** Connections a refused approval said were removed, before the run says so itself. */
  removedIds?: readonly string[];
  /** Why the last approve, decline or replan request failed; it takes the button row's caption. */
  notice?: { variant: InlineNoticeVariant; text: I18nText } | null;
  /** Counts the replans the server accepted; each one closes an open note. */
  replansSent?: number;
}>();

const emit = defineEmits<{
  approve: [optionId: string];
  replan: [body: AutoResolveReplanInput];
  decline: [];
}>();

const { t } = useI18nTyped();

const plan = computed(() => props.run.plan);
const waiting = computed(() => props.run.state === "waiting_approval");

// Stable sort: the recommended option leads, the rest keep the plan's order.
const options = computed<AutoResolveOption[]>(() =>
  [...(plan.value?.options ?? [])].sort((a, b) => Number(b.recommended) - Number(a.recommended)),
);
const recommended = computed(() => options.value.find((o) => o.recommended) ?? options.value[0]);

const pickedId = ref("");
// Separate sources: a getter returning a fresh array would reset the pick on every snapshot.
watch(
  [() => plan.value?.fingerprint, () => props.run.chosen_option_id],
  ([, chosen]) => {
    // A choice from an earlier revision may name an option this plan no longer has.
    pickedId.value = options.value.find((o) => o.id === chosen)?.id ?? options.value[0]?.id ?? "";
  },
  { immediate: true },
);
const picked = computed(() => options.value.find((o) => o.id === pickedId.value));
const anyChanges = computed(() => options.value.some((o) => o.changes.length));

// "removed" asks for a plan without a removed connection; "correct" says what is wrong with this one.
const asking = ref<"correct" | "removed" | null>(null);
const note = ref("");
// A fast replan can go from one waiting plan to the next without a snapshot in between.
watch(
  [waiting, () => props.run.revision, () => plan.value?.fingerprint, () => props.replansSent],
  () => (asking.value = null),
);

const root = ref<HTMLElement | null>(null);
// ORadio puts the data-test on the radio circle; the card is its label.
const optionCards = () =>
  Array.from(
    root.value?.querySelectorAll('[data-test="autoresolve-approval-option"]') ?? [],
    (radio) => radio.closest("label") ?? radio,
  );

const missingCapabilityText = computed(() => {
  const text = plan.value?.missing_capability;
  return (
    needsText(text, t) ??
    t("autoresolve.approval.missingCapability", { capability: raw(text ?? "") })
  );
});

const omittedCount = computed(() => plan.value?.omitted_count ?? 0);
const omittedText = computed(() =>
  plan.value?.omitted_reason
    ? t(
        "autoresolve.approval.omitted",
        { count: omittedCount.value, reason: raw(plan.value.omitted_reason) },
        omittedCount.value,
      )
    : t("autoresolve.approval.omittedNoReason", { count: omittedCount.value }, omittedCount.value),
);

// A removed connection is named once, by its red chip under this line.
const stepSummary = (option: AutoResolveOption) => {
  const all = [...new Set(option.steps.map((s) => s.connection.name))];
  const removed = new Set(removedIn(option));
  const live = all.filter((name) => !removed.has(name));
  const connections = live.length ? live : all;
  return t(
    "autoresolve.approval.stepSummary",
    { count: option.steps.length, mcps: theMcps(connections, t) },
    option.steps.length,
  );
};

const approvers = computed(() => approversSentence(props.run.approvers, t));

const learnedRemoved = computed(() => new Set(props.removedIds ?? []));
const withRemovedMark = (step: AutoResolveStep): AutoResolveStep =>
  learnedRemoved.value.has(step.connection.id)
    ? { ...step, connection: { ...step.connection, removed: true } }
    : step;

/** The removed connections an option's steps go through, by last known name. */
const removedIn = (option: AutoResolveOption): string[] => {
  const steps = option.steps.filter(
    (s) => s.connection.removed === true || learnedRemoved.value.has(s.connection.id),
  );
  return [...new Set(steps.map((s) => s.connection.name))];
};
const blocked = (option: AutoResolveOption) =>
  usesRemovedConnection(option) || removedIn(option).length > 0;
const pickedBlocked = computed(() => !!picked.value && blocked(picked.value));
// The server's option flag can come without a mark on its steps, so the sentence needs a subject.
const removedText = computed(() => {
  const names = picked.value ? removedIn(picked.value) : [];
  const mcps = names.length ? theMcpsStart(names, t) : t("autoresolve.approval.aRemovedConnection");
  const another =
    props.run.can_approve && options.value.some((o) => o.id !== pickedId.value && !blocked(o));
  return t(
    another
      ? "autoresolve.approval.connectionRemovedOther"
      : "autoresolve.approval.connectionRemoved",
    { mcps },
    Math.max(names.length, 1),
  );
});
const askWithoutRemoved = () => {
  const names = picked.value ? removedIn(picked.value) : [];
  if (names.length && !note.value.trim()) {
    note.value = t(
      "autoresolve.approval.removedNote",
      { mcps: theMcps(names, t, names.length) },
      names.length,
    );
  }
  asking.value = "removed";
};

const refusal = computed(() =>
  picked.value && props.refused?.optionId === picked.value.id ? props.refused : null,
);
const denied = computed(() => !props.run.can_approve || !!refusal.value);

const cannotApproveText = computed(() => {
  const connections = [...new Set((picked.value?.steps ?? []).map((s) => s.connection.name))];
  const named = refusal.value?.approvers.length ? refusal.value.approvers : props.run.approvers;
  return t("autoresolve.approval.cannotApprove", {
    mcps: theMcps(connections, t),
    approvers: approversSentence(named, t),
  });
});

const isRequester = computed(() =>
  isRunRequester(props.run, (store.state.userInfo as { email?: string } | null)?.email),
);
// The server lets only the requester, an approver or an admin decline or replan.
const canReplan = computed(() => props.run.can_approve || isRequester.value);

const heldWhilePlanning = computed(() => investigationSummary(props.run).held);
const heldText = computed(() => {
  const calls = heldWhilePlanning.value.map((c) =>
    c.connection
      ? t("autoresolve.approval.heldCall", { tool: raw(c.tool), mcp: theMcps([c.connection], t) })
      : raw(c.tool),
  );
  return t(
    "autoresolve.approval.heldWhilePlanning",
    { count: calls.length, tools: namesSentence(calls, t) },
    calls.length,
  );
});

const lapsedTitle = computed(() =>
  props.run.approval_deadline_us
    ? deadlineText(props.run.approval_deadline_us, LAPSED_KEYS, t)
    : t("autoresolve.approval.lapsed"),
);

const router = useRouter();
const orgId = useOrgId();
const startAgain = useMutation(() => startAutoResolveRunMutation(orgId.value));
const startAgainError = ref<I18nText | null>(null);
// A 400 refuses the chosen connections, so the person picks new ones on the home page.
const startAgainRefused = ref(false);

const liveConnectionIds = computed(() =>
  runConnections(props.run, learnedRemoved.value)
    .filter((c) => !c.removed)
    .map((c) => c.id),
);
const usedCount = computed(() => runConnections(props.run).length);
const allConnectionsRemoved = computed(
  () => usedCount.value > 0 && !liveConnectionIds.value.length,
);
const chooseConnections = computed(() => ({
  name: "autoresolve",
  query: { org_identifier: orgId.value, goal: props.run.goal },
}));

const onStartAgain = () => {
  startAgainError.value = null;
  startAgainRefused.value = false;
  startAgain.mutate(
    { goal: props.run.goal, connection_ids: liveConnectionIds.value },
    {
      onSuccess: ({ run_id }) => {
        productAnalytics.track("autoresolve_run_started", { source: "start_again" });
        void router.push({
          name: "autoresolveRun",
          params: { id: run_id },
          query: { org_identifier: orgId.value },
        });
      },
      onError: (err: unknown) => {
        startAgainError.value =
          raw(autoresolveErrorMessage(err)) || t("autoresolve.approval.startAgainFailed");
        startAgainRefused.value = autoresolveErrorStatus(err) === 400;
      },
    },
  );
};
</script>
