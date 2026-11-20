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
    :title="copy.title(alertName)"
    :primary="{ label: primary?.label, loading: opening, dataTest: primary?.dataTest }"
    :secondary="{ label: copy.cancel(), variant: 'secondary' }"
    data-test="alert-calibration-apply-dialog"
    @update:open="emit('update:open', $event)"
    @click:primary="primary?.run()"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-4">
      <OInlineNotice
        v-if="notice"
        :tone="notice.tone"
        :data-severity="notice.tone"
        :data-test="`alert-calibration-apply-${state}`"
      >
        {{ notice.text }}
        <template v-if="state === 'failed'" #actions>
          <OButton
            variant="secondary"
            data-test="alert-calibration-apply-retry"
            @click="alertQuery.refetch()"
          >
            {{ copy.retry() }}
          </OButton>
        </template>
      </OInlineNotice>

      <div
        class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-6 gap-y-1.5"
        data-test="alert-calibration-apply-changes"
      >
        <OText variant="label" as="div">{{ copy.setting() }}</OText>
        <OText variant="label" as="div">{{ copy.current() }}</OText>
        <OText variant="label" as="div">{{ copy.suggested() }}</OText>
        <div
          v-for="row in rows"
          :key="row.key"
          class="contents"
          :data-test="`alert-calibration-apply-row-${row.key}`"
        >
          <OTruncatedText class="text-text-body min-w-0 text-sm">{{ row.label }}</OTruncatedText>
          <OSkeleton
            v-if="state === 'loading'"
            class="h-5 w-16"
            data-test="alert-calibration-apply-current-loading"
          />
          <span v-else class="text-text-body text-sm tabular-nums">{{ row.current }}</span>
          <span class="text-text-heading text-sm font-medium tabular-nums">{{
            row.suggested
          }}</span>
        </div>
      </div>

      <div class="flex flex-col gap-1" data-test="alert-calibration-apply-consequences">
        <OText v-for="row in rows" :key="row.key" variant="meta" as="p">{{
          row.consequence
        }}</OText>
      </div>

      <div
        v-if="limitations.length"
        class="flex flex-col gap-0.5"
        data-test="alert-calibration-apply-limitations"
      >
        <OText variant="label" as="div">{{ t("alertCalibration.detail.limitations") }}</OText>
        <OText v-for="(line, index) in limitations" :key="index" variant="meta" as="div">{{
          line
        }}</OText>
      </div>

      <OText variant="body" as="p" data-test="alert-calibration-apply-note">{{
        copy.note()
      }}</OText>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { useOrgId } from "@/composables/query";
import { alertDetailQuery } from "@/services/alerts.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { AlertEditHandoff } from "@/ts/interfaces/alertPrefill";
import { writeAlertEditHandoff } from "@/utils/alerts/alertPrefillStorage";
import { isStaleField, isSupportedAlert, plannedFields } from "@/utils/alerts/alertEditHandoff";
import {
  applyCopy,
  patchOf,
  toEditHandoff,
  toReviewHandoff,
  type ApplySuggestion,
} from "./applySuggestion";
import { limitationsOf, type FindingRecord } from "./digests";
import { alertFolderOf, editAlertRoute } from "./alertEditorLink";

type PromptState = "loading" | "fresh" | "stale" | "deleted" | "denied" | "failed" | "unsupported";

const props = defineProps<{ open: boolean; action: ApplySuggestion; finding: FindingRecord }>();
const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t, locale } = useI18nTyped();
const router = useRouter();
const orgId = useOrgId();
const copy = computed(() => applyCopy(t, locale.value));

// Always refetched on open, so the check runs against the alert as it is now, not a cached copy.
const alertQuery = useQuery(() =>
  Object.assign(
    alertDetailQuery(orgId.value, props.action.alert_id, undefined, { silentForbidden: true }),
    {
      enabled: props.open && !!orgId.value,
      staleTime: 0,
    },
  ),
);

const liveAlert = computed(() => (alertQuery.data.value ?? null) as Record<string, unknown> | null);
const fields = computed(() => plannedFields(patchOf(props.action), liveAlert.value ?? {}));

const state = computed<PromptState>(() => {
  if (alertQuery.isFetching.value) return "loading";
  if (alertQuery.isError.value) {
    const status = (alertQuery.error.value as { response?: { status?: number } } | null)?.response
      ?.status;
    if (status === 403) return "denied";
    return status === 404 ? "deleted" : "failed";
  }
  if (!liveAlert.value) return "loading";
  if (!isSupportedAlert(liveAlert.value)) return "unsupported";
  return fields.value.some(isStaleField) ? "stale" : "fresh";
});

const alertName = computed(() =>
  String(props.finding.alert_name ?? liveAlert.value?.name ?? props.action.alert_id),
);

const limitations = computed(() => limitationsOf(t, props.finding));

const rows = computed(() =>
  fields.value.map((field) => ({
    key: field.key,
    label: copy.value.fieldLabel(field.key),
    current: liveAlert.value ? copy.value.value(field.key, field.live) : raw("—"),
    suggested: copy.value.value(field.key, field.to),
    consequence: copy.value.consequence(field.key, field.to),
  })),
);

/** Red for a refusal or a failure, amber for a moved value, neutral for a gone or unsupported alert. */
const notice = computed<{ tone: "err" | "warn" | "neutral"; text: I18nText } | null>(() => {
  const stale = fields.value.find(isStaleField);
  switch (state.value) {
    case "stale":
      return stale ? { tone: "warn", text: copy.value.stale(stale) } : null;
    case "denied":
      return { tone: "err", text: copy.value.denied() };
    case "failed":
      return { tone: "err", text: copy.value.failed() };
    case "deleted":
      return { tone: "neutral", text: copy.value.deleted() };
    case "unsupported":
      return { tone: "neutral", text: copy.value.unsupported() };
    default:
      return null;
  }
});

interface FolderLookup {
  promise: Promise<string | undefined>;
  settled: boolean;
  folder: string | undefined;
}

let folderLookup: FolderLookup | null = null;
const opening = ref(false);
// Bumped on every open, close and unmount, so a Continue that was waiting cannot outlive its prompt.
let promptSession = 0;
onBeforeUnmount(() => {
  promptSession += 1;
});
watch(
  () => props.open,
  () => {
    promptSession += 1;
    opening.value = false;
  },
);

const startFolderLookup = (): FolderLookup => {
  const live = liveAlert.value?.name;
  const name = typeof live === "string" && live ? live : props.finding.alert_name;
  const lookup: FolderLookup = {
    promise: alertFolderOf(orgId.value, props.action.alert_id, name),
    settled: false,
    folder: undefined,
  };
  void lookup.promise.then((folder) => {
    lookup.folder = folder;
    lookup.settled = true;
  });
  return lookup;
};

// Started once the live alert names it, so Continue usually finds the folder already known.
watch(
  () => [props.open, !!liveAlert.value] as const,
  ([open, loaded]) => {
    if (!open) folderLookup = null;
    else if (loaded && !folderLookup) folderLookup = startFolderLookup();
  },
  { immediate: true },
);

const openEditor = async (handoff: AlertEditHandoff) => {
  if (opening.value) return;
  const lookup = folderLookup ?? (folderLookup = startFolderLookup());
  if (!lookup.settled) {
    const session = promptSession;
    opening.value = true;
    await lookup.promise;
    if (session !== promptSession) return;
    opening.value = false;
  }
  writeAlertEditHandoff(handoff);
  emit("update:open", false);
  void router.push(editAlertRoute(orgId.value, props.action.alert_id, lookup.folder));
};

/** Continue only on a fresh alert; a stale or unsupported one can still be opened for review. */
const primary = computed(() => {
  if (state.value === "fresh") {
    return {
      label: copy.value.continueLabel(),
      dataTest: "alert-calibration-apply-continue",
      run: () => void openEditor(toEditHandoff(props.action, props.finding)),
    };
  }
  if (state.value === "stale" || state.value === "unsupported") {
    return {
      label: copy.value.reviewInstead(),
      dataTest: "alert-calibration-apply-review",
      run: () => void openEditor(toReviewHandoff(props.action, props.finding)),
    };
  }
  return null;
});
</script>
