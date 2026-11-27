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
  <OPageLayout
    :title="title"
    icon="bolt"
    :back="back"
    constrained
    content-size="lg"
    content-align="start"
    data-test="autoresolve-saved-page"
  >
    <template #title-trail>
      <BetaBadge stage="alpha" />
    </template>
    <template v-if="saved && !editing" #actions>
      <OButton
        variant="primary"
        size="sm-action"
        :loading="runNow.isPending.value"
        data-test="autoresolve-saved-run-now"
        @click="onRunNow"
      >
        {{ t("autoresolve.saved.runNow") }}
      </OButton>
    </template>
    <template v-if="saved && !editing" #actions-overflow>
      <OButton
        variant="outline"
        size="sm-action"
        icon-left="edit"
        data-test="autoresolve-saved-edit"
        @click="editing = true"
      >
        {{ t("common.edit") }}
      </OButton>
      <OButton
        variant="outline-destructive"
        size="sm-action"
        icon-left="delete"
        data-test="autoresolve-saved-delete"
        @click="confirmDelete = true"
      >
        {{ t("common.delete") }}
      </OButton>
    </template>

    <div class="flex flex-col gap-6 py-6">
      <OEmptyState
        v-if="loadForbidden"
        preset="no-access"
        data-test="autoresolve-saved-forbidden"
      />
      <OEmptyState
        v-else-if="loadError"
        preset="load-error"
        :title="loadError"
        :description="loadStatus === 404 ? t('autoresolve.saved.notFoundHint') : undefined"
        data-test="autoresolve-saved-load-error"
        @action="retry"
      />
      <div v-else-if="loading" class="flex flex-col gap-3" data-test="autoresolve-saved-loading">
        <OSkeleton class="h-6 w-1/2" />
        <OSkeleton class="h-24 w-full" />
        <OSkeleton class="h-40 w-full" />
      </div>

      <AutoResolveSavedForm
        v-else-if="isNew || editing"
        :saved="saved"
        :from-run="sourceRun"
        :triggers-fire-here="saved ? saved.triggers_fire_here : triggersFireHere"
        :slack-approval-available="slackApprovalAvailable"
        :max-connections="maxConnections"
        @saved="onSaved"
        @cancel="onCancel"
      />

      <template v-else-if="saved">
        <ODescriptionList label-width="narrow" data-test="autoresolve-saved-details">
          <ODescriptionItem :label="t('autoresolve.saved.field.goal')">
            <span class="wrap-anywhere whitespace-pre-wrap" data-test="autoresolve-saved-goal">{{
              saved.goal
            }}</span>
          </ODescriptionItem>
          <ODescriptionItem :label="t('autoresolve.saved.field.connections')">
            <div class="flex flex-col gap-2" data-test="autoresolve-saved-connections">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span v-if="liveConnections.length" class="wrap-anywhere">{{
                  connectionNames
                }}</span>
                <AutoResolveRemovedConnection
                  v-for="name in removedConnections"
                  :key="name"
                  :name="name"
                />
              </div>
              <OInlineNotice
                v-if="removedConnections.length"
                variant="error"
                wrap
                :text="
                  t(
                    'autoresolve.saved.connectionsRemoved',
                    { mcps: theMcpsStart(removedConnections, t) },
                    removedConnections.length,
                  )
                "
                data-test="autoresolve-saved-connections-removed"
              />
            </div>
          </ODescriptionItem>
          <ODescriptionItem :label="t('autoresolve.saved.field.runsWhen')">
            <span data-test="autoresolve-saved-runs-when">{{ runsWhen }}</span>
          </ODescriptionItem>
          <ODescriptionItem v-if="state" :label="t('autoresolve.saved.field.trigger')">
            <div class="flex flex-col gap-2" data-test="autoresolve-saved-trigger">
              <div class="flex items-center">
                <OSwitch
                  :model-value="switchValue"
                  :aria-label="t('autoresolve.saved.triggerSwitch')"
                  :disabled="
                    setTrigger.isPending.value || (!slackApprovalAvailable && !switchValue)
                  "
                  state-text
                  off-tone="neutral"
                  data-test="autoresolve-saved-trigger-switch"
                  @update:model-value="onTrigger"
                />
              </div>
              <div
                class="grid min-h-6 items-start justify-items-start"
                data-test="autoresolve-saved-trigger-status"
              >
                <OInlineNotice
                  v-if="triggerRefusal"
                  variant="error"
                  wrap
                  class="col-start-1 row-start-1"
                  :text="triggerRefusal"
                  data-test="autoresolve-saved-trigger-refusal"
                />
                <span
                  v-else-if="!slackApprovalAvailable"
                  class="text-text-secondary col-start-1 row-start-1 text-xs"
                  data-test="autoresolve-saved-trigger-slack-unavailable"
                >
                  {{ slackUnavailableText(switchValue) }}
                </span>
                <OInlineNotice
                  v-else-if="state === 'paused'"
                  variant="warning"
                  wrap
                  class="col-start-1 row-start-1"
                  :text="t('autoresolve.saved.paused')"
                  data-test="autoresolve-saved-trigger-paused"
                />
                <span
                  v-else-if="state === 'on' && approvedLine"
                  class="text-text-secondary col-start-1 row-start-1 text-xs"
                  data-test="autoresolve-saved-trigger-approved"
                >
                  {{ approvedLine }}
                </span>
                <span
                  v-if="!slackApprovalAvailable"
                  class="text-text-secondary invisible col-start-1 row-start-1 text-xs"
                  aria-hidden="true"
                >
                  {{ slackUnavailableText(true) }}
                </span>
                <div
                  v-for="reserve in reservedStatus"
                  :key="reserve.text"
                  class="invisible col-start-1 row-start-1"
                  aria-hidden="true"
                  data-test="autoresolve-saved-trigger-status-reserve"
                >
                  <OInlineNotice :variant="reserve.variant" wrap :text="reserve.text" />
                </div>
              </div>
              <OBanner
                v-if="!saved.triggers_fire_here && slackApprovalAvailable"
                variant="info"
                dense
                :content="t('autoresolve.saved.regionNotice')"
                data-test="autoresolve-saved-region-notice"
              />
            </div>
          </ODescriptionItem>
          <ODescriptionItem
            v-if="state && (slackApprovalAvailable || canApproveLine)"
            :label="t('autoresolve.saved.field.approval')"
          >
            <div class="flex flex-col gap-1" data-test="autoresolve-saved-approval">
              <span v-if="slackApprovalAvailable">{{
                t("autoresolve.saved.approval", { slack: SLACK })
              }}</span>
              <span
                v-if="canApproveLine"
                class="wrap-anywhere"
                data-test="autoresolve-saved-approvers"
              >
                {{ canApproveLine }}
              </span>
            </div>
          </ODescriptionItem>
          <ODescriptionItem :label="t('autoresolve.saved.field.savedBy')">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span class="wrap-anywhere" data-test="autoresolve-saved-by">{{ savedByLine }}</span>
              <OButton
                v-if="saved.from_run_id"
                variant="ghost-primary"
                size="sm"
                data-test="autoresolve-saved-source-run"
                @click="openRun(saved.from_run_id)"
              >
                {{ t("autoresolve.saved.openSourceRun") }}
              </OButton>
            </div>
          </ODescriptionItem>
        </ODescriptionList>

        <!-- Corrections sit above the runs, so both mount once the corrections are known. -->
        <template v-if="correctionsKnown">
          <AutoResolveSavedCorrections :org="orgId" :autoresolve-id="saved.id" />
          <AutoResolveRunsTable :org="orgId" compact :autoresolve-id="saved.id" />
        </template>
        <OSkeleton v-else class="h-40 w-full" data-test="autoresolve-saved-below-loading" />
      </template>
    </div>

    <ConfirmDialog
      v-model="confirmDelete"
      :title="t('autoresolve.saved.deleteTitle')"
      :message="t('autoresolve.saved.deleteMessage')"
      :ok-label="t('common.delete')"
      ok-variant="destructive"
      focus-cancel
      @update:ok="onDelete"
      @update:cancel="confirmDelete = false"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMutation, useQuery } from "@tanstack/vue-query";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import AutoResolveRemovedConnection from "@/components/autoresolve/AutoResolveRemovedConnection.vue";
import AutoResolveRunsTable from "@/components/autoresolve/AutoResolveRunsTable.vue";
import AutoResolveSavedCorrections from "@/components/autoresolve/AutoResolveSavedCorrections.vue";
import AutoResolveSavedForm from "@/components/autoresolve/AutoResolveSavedForm.vue";
import { useOrgId } from "@/composables/query/useOrgId";
import {
  autoresolveErrorMessage,
  autoresolveErrorStatus,
  DEFAULT_MAX_CONNECTIONS,
  type AutoResolveSaved,
} from "@/services/autoresolve";
import {
  autoresolveCorrectionsQuery,
  autoresolveRunDetailQuery,
  autoresolveSavedQuery,
  autoresolveSummaryQuery,
  deleteAutoResolveSavedMutation,
  runAutoResolveSavedMutation,
  setAutoResolveTriggerMutation,
} from "@/services/autoresolve.queries";
import productAnalytics from "@/services/product_analytics";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  approversSentence,
  autoresolveTime,
  cannotApproveTexts,
  namesSentence,
  savedRefusal,
  theMcpsStart,
  triggerState,
} from "@/utils/autoresolve/autoresolveText";

const SLACK = raw("Slack");
const DATE_TIME = "MMM d, HH:mm";

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const orgId = useOrgId();

const savedId = computed(() =>
  route.name === "autoresolveSavedNew" ? "" : String(route.params.id ?? ""),
);
const isNew = computed(() => !savedId.value);
const fromRunId = computed(() => (isNew.value ? String(route.query.from_run ?? "") : ""));
const editing = ref(false);
const deleting = ref(false);
watch(savedId, () => (editing.value = false));

const savedQuery = useQuery(() =>
  Object.assign(autoresolveSavedQuery(orgId.value, savedId.value), {
    enabled: !!orgId.value && !!savedId.value && !deleting.value,
  }),
);
const runQuery = useQuery(() =>
  Object.assign(autoresolveRunDetailQuery(orgId.value, fromRunId.value), {
    enabled: !!orgId.value && !!fromRunId.value,
  }),
);
const summary = useQuery(() =>
  Object.assign(autoresolveSummaryQuery(orgId.value), { enabled: !!orgId.value }),
);
const corrections = useQuery(() =>
  Object.assign(autoresolveCorrectionsQuery(orgId.value, savedId.value), {
    enabled: !!orgId.value && !!savedId.value && !deleting.value,
  }),
);
const correctionsKnown = computed(() => !corrections.isPending.value);

const saved = computed(() => savedQuery.data.value ?? null);
const sourceRun = computed(() => runQuery.data.value ?? null);
const triggersFireHere = computed(() => summary.data.value?.triggers_fire_here ?? true);
const slackApprovalAvailable = computed(() => summary.data.value?.slack_approval_available ?? true);
const maxConnections = computed(
  () => summary.data.value?.max_connections || DEFAULT_MAX_CONNECTIONS,
);

const activeError = computed(() =>
  isNew.value ? (runQuery.error.value ?? summary.error.value) : savedQuery.error.value,
);
const loadStatus = computed(() => autoresolveErrorStatus(activeError.value));
const loadForbidden = computed(() => !!activeError.value && loadStatus.value === 403);
const loadError = computed<I18nText | null>(() => {
  if (!activeError.value || loadForbidden.value) return null;
  const message = autoresolveErrorMessage(activeError.value);
  if (message) return raw(message);
  return isNew.value ? t("autoresolve.saved.runNotLoaded") : t("autoresolve.saved.loadFailed");
});
const loading = computed(() => {
  if (!isNew.value) return savedQuery.isPending.value || (!editing.value && detailsPending.value);
  return summary.isPending.value || (!!fromRunId.value && runQuery.isPending.value);
});

const retry = () => {
  if (isNew.value) {
    void summary.refetch();
    if (fromRunId.value) void runQuery.refetch();
  } else void savedQuery.refetch();
};

const title = computed(() => {
  if (isNew.value) return t("autoresolve.saved.newTitle");
  return saved.value ? raw(saved.value.name) : t("autoresolve.savedTitle");
});
const back = computed(() => ({
  label: t("autoresolve.saved.back"),
  to: { name: "autoresolve", query: { tab: "saved", org_identifier: orgId.value } },
}));

const liveConnections = computed(() =>
  (saved.value?.connections ?? []).filter((c) => !c.removed).map((c) => c.name),
);
const removedConnections = computed(() =>
  (saved.value?.connections ?? []).filter((c) => c.removed).map((c) => c.name),
);
const connectionNames = computed(() => namesSentence(liveConnections.value, t, 5));

// With the switch on, the line says what that trigger's runs can still do.
const slackUnavailableText = (on: boolean) =>
  on ? t("autoresolve.saved.slackUnavailableOn") : t("autoresolve.saved.slackUnavailable");

const runsWhen = computed<I18nText>(() => {
  const trigger = saved.value?.trigger;
  if (!trigger || trigger.kind === "person") return t("autoresolve.saved.kind.person");
  const alert = trigger.alert_name ? raw(trigger.alert_name) : null;
  if (trigger.kind === "incident") {
    return alert
      ? t("autoresolve.saved.runsWhenIncident", { alert })
      : t("autoresolve.saved.runsWhenIncidentGone");
  }
  return alert
    ? t("autoresolve.saved.runsWhenAlert", { alert })
    : t("autoresolve.saved.runsWhenAlertGone");
});

const state = computed(() => (saved.value ? triggerState(saved.value.trigger) : null));

const liveRefs = computed(() => (saved.value?.connections ?? []).filter((c) => !c.removed));
const approvers = computed(() => saved.value?.approvers ?? []);
const canApproveLine = computed(() =>
  approvers.value.length
    ? t("autoresolve.approval.canApprove", { names: approversSentence(approvers.value, t) })
    : null,
);
// Which refusals the trigger status slot reserves depends on the summary, so the details wait for it.
const detailsPending = computed(() => !!state.value && summary.isPending.value);

const reservedStatus = computed(() => {
  if (!saved.value || !state.value || state.value === "on" || !slackApprovalAvailable.value) {
    return [];
  }
  const approvable = new Map(
    (summary.data.value?.connections ?? []).map((c) => [c.id, c.can_approve]),
  );
  const reserves: { variant: "error" | "warning"; text: I18nText }[] = cannotApproveTexts(
    liveRefs.value,
    approvable,
    approvers.value,
    t,
  ).map((text) => ({ variant: "error", text }));
  if (state.value === "paused")
    reserves.push({ variant: "warning", text: t("autoresolve.saved.paused") });
  return reserves;
});

const approvedLine = computed(() => {
  const trigger = saved.value?.trigger;
  if (!trigger?.approved_by || !trigger.approved_at_us) return null;
  return t("autoresolve.saved.triggerApproved", {
    name: raw(trigger.approved_by),
    time: autoresolveTime(trigger.approved_at_us, DATE_TIME),
  });
});

const savedByLine = computed(() =>
  saved.value
    ? t("autoresolve.saved.savedBy", {
        name: raw(saved.value.created_by),
        time: autoresolveTime(saved.value.created_at_us, DATE_TIME),
      })
    : raw(""),
);

const setTrigger = useMutation(() => setAutoResolveTriggerMutation(orgId.value));
const pendingTrigger = ref<boolean | null>(null);
const triggerRefusal = ref<I18nText | null>(null);
const switchValue = computed(() => pendingTrigger.value ?? saved.value?.trigger.enabled ?? false);
watch(
  () => saved.value?.updated_at_us,
  () => (triggerRefusal.value = null),
);

const onTrigger = (value: unknown) => {
  const current = saved.value;
  if (!current) return;
  const enabled = value === true;
  triggerRefusal.value = null;
  pendingTrigger.value = enabled;
  setTrigger.mutate(
    { id: current.id, enabled },
    {
      onError: (err: unknown) => (triggerRefusal.value = savedRefusal(err, t)),
      onSettled: () => (pendingTrigger.value = null),
    },
  );
};

const runNow = useMutation(() => runAutoResolveSavedMutation(orgId.value));
const openRun = (id: string) =>
  void router.push({
    name: "autoresolveRun",
    params: { id },
    query: { org_identifier: orgId.value },
  });

const onRunNow = () => {
  const current = saved.value;
  if (!current) return;
  runNow.mutate(current.id, {
    onSuccess: ({ run_id }) => {
      productAnalytics.track("autoresolve_run_started", { source: "saved" });
      openRun(run_id);
    },
    onError: (err: unknown) =>
      toast({
        variant: "error",
        message: raw(autoresolveErrorMessage(err)) || t("autoresolve.saved.runFailed"),
      }),
  });
};

const onSaved = (view: AutoResolveSaved) => {
  if (isNew.value) {
    void router.replace({
      name: "autoresolveSaved",
      params: { id: view.id },
      query: { org_identifier: orgId.value },
    });
    return;
  }
  editing.value = false;
};

const onCancel = () => {
  if (!isNew.value) {
    editing.value = false;
    return;
  }
  if (fromRunId.value) openRun(fromRunId.value);
  else void router.push(back.value.to);
};

const confirmDelete = ref(false);
const remove = useMutation(() => deleteAutoResolveSavedMutation(orgId.value));

const onDelete = () => {
  const current = saved.value;
  confirmDelete.value = false;
  if (!current) return;
  deleting.value = true;
  remove.mutate(current.id, {
    onSuccess: () => {
      toast({ variant: "success", message: t("autoresolve.saved.deleted") });
      void router.push(back.value.to);
    },
    onError: (err: unknown) => {
      deleting.value = false;
      toast({
        variant: "error",
        message: raw(autoresolveErrorMessage(err)) || t("autoresolve.saved.deleteFailed"),
      });
    },
  });
};
</script>
