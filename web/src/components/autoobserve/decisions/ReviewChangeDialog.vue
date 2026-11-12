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
  <ODialog
    :open="open"
    size="md"
    :title="copy.title(alertTitle)"
    :neutral-button-label="canApplyHere ? t('insight.decisions.apply.edit') : undefined"
    neutral-button-variant="outline"
    :neutral-button-loading="opening"
    :secondary-button-label="t('common.cancel')"
    secondary-button-variant="outline"
    :primary-button-label="
      canApplyHere ? t('insight.decisions.apply.button') : t('insight.decisions.apply.edit')
    "
    :primary-button-data-test="canApplyHere ? 'review-change-apply' : 'review-change-edit'"
    :primary-button-disabled="canApplyHere && !applicable"
    :primary-button-loading="canApplyHere ? applying : opening"
    data-test="review-change-dialog"
    @update:open="emit('update:open', $event)"
    @click:neutral="openEditor"
    @click:secondary="emit('update:open', false)"
    @click:primary="canApplyHere ? apply() : openEditor()"
  >
    <div class="flex flex-col gap-3">
      <p
        v-if="topNotice"
        class="flex items-start gap-1.5 text-sm"
        :class="NOTICE_TONE[topNotice.variant]"
        :role="topNotice.variant === 'error' ? 'alert' : undefined"
        :data-severity="topNotice.variant"
        data-test="review-change-notice"
      >
        <OIcon
          :name="topNotice.variant === 'info' ? 'info-outline' : 'warning'"
          size="xs"
          class="mt-1 shrink-0"
        />
        <span>{{ topNotice.text }}</span>
      </p>
      <p v-if="where && !gone" class="text-text-secondary text-xs" data-test="review-change-where">
        {{ where }}
      </p>
      <!-- A gone finding's values are from before the alert moved on, so they are not shown as current. -->
      <div
        v-if="!gone"
        class="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-3 gap-y-1.5 max-sm:grid-cols-[auto_auto_minmax(0,1fr)]"
        data-test="review-change-fields"
      >
        <OText variant="label" as="div" class="max-sm:col-span-3">{{ copy.setting() }}</OText>
        <OText variant="label" as="div" class="max-sm:hidden">{{ copy.current() }}</OText>
        <span class="max-sm:hidden" aria-hidden="true" />
        <OText variant="label" as="div" class="max-sm:hidden">{{ copy.suggested() }}</OText>
        <div
          v-for="row in rows"
          :key="row.field"
          class="contents"
          :data-test="`review-change-row-${row.field}`"
        >
          <OTruncatedText class="text-text-body min-w-0 text-sm max-sm:col-span-3">{{
            row.label
          }}</OTruncatedText>
          <span class="text-text-secondary text-sm tabular-nums line-through">
            <span class="sr-only">{{ copy.current() }}:</span>{{ row.from }}
          </span>
          <OIcon name="arrow-forward" size="xs" class="text-text-secondary" />
          <span class="text-text-heading text-sm font-medium tabular-nums">
            <span class="sr-only">{{ copy.suggested() }}:</span>{{ row.to }}
          </span>
        </div>
      </div>
      <p
        v-if="acknowledged"
        class="text-status-warning-text flex items-start gap-1.5 text-xs"
        data-test="review-change-acknowledged"
      >
        <OIcon name="warning" size="xs" class="mt-0.5 shrink-0" />
        <span>{{ acknowledged }}</span>
      </p>
      <!-- The note promises an undoable apply, so it shows only where Apply is offered. -->
      <div v-if="canApplyHere" class="grid">
        <p
          class="text-text-secondary col-start-1 row-start-1 text-xs"
          :class="{ invisible: !!writeNotice || isLocked }"
          :aria-hidden="writeNotice || isLocked ? 'true' : undefined"
          data-test="review-change-note"
        >
          {{ t("insight.decisions.apply.note") }}
        </p>
        <p
          v-if="writeNotice"
          class="col-start-1 row-start-1 flex items-start gap-1.5 text-xs"
          :class="NOTICE_TONE[writeNotice.variant]"
          :role="writeNotice.variant === 'error' ? 'alert' : undefined"
          :data-severity="writeNotice.variant"
          data-test="review-change-notice"
        >
          <OIcon name="warning" size="xs" class="mt-0.5 shrink-0" />
          <span>{{ writeNotice.text }}</span>
        </p>
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { useOrgId } from "@/composables/query";
import {
  decisionPreviewQuery,
  newRequestId,
  useDecisionRoute,
} from "@/composables/autoobserve/useDecisionRoute";
import {
  isItemGone,
  isRouteDisabled,
  refusalOf,
  type FieldChange,
} from "@/services/autoobserveDecisions";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { writeAlertEditHandoff } from "@/utils/alerts/alertPrefillStorage";
import {
  APPLY_FIELDS,
  applyCopy,
  toEditHandoff,
  type ApplyField,
} from "@/components/alert_calibration/applySuggestion";
import { alertFolderOf, editAlertRoute } from "@/components/alert_calibration/alertEditorLink";
import { decisionCopy } from "../insight/insightCopy";
import { recordApplied, type ReviewChangeTarget } from "./appliedChanges";

type Variant = "info" | "warning" | "error";

const NOTICE_TONE: Record<Variant, string> = {
  info: "text-text-secondary",
  warning: "text-status-warning-text",
  error: "text-status-error-text",
};

const props = defineProps<{ open: boolean; target: ReviewChangeTarget }>();
const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t, locale } = useI18nTyped();
const router = useRouter();
const orgId = useOrgId();
const route = useDecisionRoute();
const copy = computed(() => applyCopy(t, locale.value));
const decisions = computed(() => decisionCopy(t, locale.value));

const applying = ref(false);
const opening = ref(false);
const writeNotice = ref<{ variant: Variant; text: I18nText } | null>(null);
let requestId = newRequestId();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    writeNotice.value = null;
    requestId = newRequestId();
  },
);

// Always read on open, so Apply sends the revision and the values the alert holds now.
const preview = useQuery(() => ({
  ...decisionPreviewQuery(orgId.value, {
    family: "alert_finding",
    id: props.target.findingId,
    action: "apply",
  }),
  enabled: props.open && route.enabled.value && !!props.target.findingId,
}));

const change = computed(() => preview.data.value?.change ?? null);
// The route answers 404 while it is switched off, so the dialog then offers the editor only.
const offline = computed(
  () =>
    route.transport.value === "compat" ||
    (preview.isError.value &&
      isRouteDisabled(preview.error.value) &&
      !isItemGone(preview.error.value)),
);
// The route runs but no longer lists this finding, so there is nothing to apply; the editor still opens the alert.
const gone = computed(() => preview.isError.value && isItemGone(preview.error.value));
const canApplyHere = computed(() => !offline.value && !gone.value);

const alertTitle = computed(() => change.value?.alert.title || props.target.alertName);

const isApplyField = (field: string): field is ApplyField => field in APPLY_FIELDS;

const fields = computed<FieldChange[]>(
  () => change.value?.fields ?? (props.target.action.patch as unknown as FieldChange[]),
);

const rows = computed(() =>
  fields.value.flatMap((f) => {
    if (!isApplyField(f.field)) return [];
    const key = APPLY_FIELDS[f.field];
    return [
      {
        field: f.field,
        label: copy.value.fieldLabel(key),
        from: copy.value.value(key, f.from),
        to: copy.value.value(key, f.to),
      },
    ];
  }),
);

const where = computed<I18nText | null>(() => {
  const alert = change.value?.alert;
  if (!alert) return null;
  const folder = raw(alert.folder ?? "default");
  if (!alert.destinations.length) {
    return alert.team
      ? t("insight.decisions.apply.whereTeamNoOne", { folder, team: raw(alert.team) })
      : t("insight.decisions.apply.whereNoOne", { folder });
  }
  const params = { folder, destinations: copy.value.value("destinations", alert.destinations) };
  return alert.team
    ? t("insight.decisions.apply.whereTeam", { ...params, team: raw(alert.team) })
    : t("insight.decisions.apply.where", params);
});

const acknowledged = computed(() => {
  const dropped = change.value?.acknowledged_firings_dropped;
  return dropped && dropped.count > 0
    ? t("insight.decisions.apply.acknowledged", { count: dropped.count, of: dropped.of })
    : null;
});

const readNotice = computed<{ variant: Variant; text: I18nText } | null>(() => {
  if (offline.value) return { variant: "info", text: t("insight.decisions.apply.offline") };
  if (gone.value) return { variant: "warning", text: t("insight.decisions.apply.gone") };
  const locked = preview.data.value?.locked;
  if (locked) return { variant: "error", text: decisions.value.refusalText(locked) };
  if (preview.isError.value) {
    const refusal = refusalOf(preview.error.value);
    return refusal
      ? { variant: "error", text: decisions.value.refusalText(refusal) }
      : { variant: "error", text: t("insight.decisions.apply.loadFailed") };
  }
  return null;
});

// The write notice lives in the note slot, which is gone once Apply is, so it then moves to the top.
const topNotice = computed(() =>
  canApplyHere.value
    ? writeNotice.value
      ? null
      : readNotice.value
    : (readNotice.value ?? writeNotice.value),
);

/** A refused reader is never promised an undoable apply. */
const isLocked = computed(() => !!preview.data.value?.locked || !!refusalOf(preview.error.value));

const applicable = computed(
  () =>
    !!preview.data.value?.change &&
    preview.data.value.may &&
    !preview.data.value.locked &&
    !preview.isFetching.value &&
    !writeNotice.value,
);

const writeNoticeOf = (error: unknown): { variant: Variant; text: I18nText } => {
  const response = (error as { response?: { status?: number; data?: { error?: unknown } } })
    ?.response;
  if (response?.status === 409 && response.data?.error === "alert_changed")
    return { variant: "warning", text: t("insight.decisions.apply.changed") };
  if (isItemGone(error)) return { variant: "warning", text: t("insight.decisions.apply.gone") };
  return decisions.value.writeError(error);
};

const statusOf = (error: unknown) =>
  (error as { response?: { status?: number } } | null)?.response?.status;

async function apply() {
  const current = preview.data.value;
  if (!current || !applicable.value || applying.value) return;
  const org = orgId.value;
  const title = String(alertTitle.value);
  applying.value = true;
  try {
    const result = await route.decide(
      {
        family: "alert_finding",
        id: props.target.findingId,
        action: "apply",
        expected_revision: current.revision,
        request_id: requestId,
      },
      title,
    );
    recordApplied({
      org,
      view: result.decision,
      title,
      fields: fields.value,
      alertId: props.target.alertId,
    });
    emit("update:open", false);
  } catch (error) {
    writeNotice.value = writeNoticeOf(error);
    // A conflict or a gone finding means the alert moved on, so the values shown are re-read.
    if (isItemGone(error) || statusOf(error) === 409) void preview.refetch();
  } finally {
    applying.value = false;
  }
}

// The editor reads the same stored change, and its Save records the apply with applied_via editor.
async function openEditor() {
  if (opening.value) return;
  opening.value = true;
  const org = orgId.value;
  try {
    const folder = await alertFolderOf(org, props.target.alertId, props.target.alertName);
    writeAlertEditHandoff(
      toEditHandoff(props.target.action, { finding_id: props.target.findingId }),
    );
    emit("update:open", false);
    void router.push(editAlertRoute(org, props.target.alertId, folder));
  } finally {
    opening.value = false;
  }
}
</script>
