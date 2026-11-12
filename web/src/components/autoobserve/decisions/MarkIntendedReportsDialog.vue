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
    :title="t('insight.decisions.mark.title', {}, alerts.length)"
    :primary-button-label="t('insight.decisions.mark.button', { count: copy.count(chosen.length) })"
    primary-button-data-test="decision-mark-submit"
    :primary-button-disabled="!chosen.length || submitting || !current || previews.isFetching.value"
    :primary-button-loading="submitting"
    :secondary-button-label="t('common.cancel')"
    secondary-button-variant="outline"
    data-test="decision-mark-dialog"
    @update:open="emit('update:open', $event)"
    @click:primary="submit"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-3">
      <OText as="p" data-test="decision-mark-intro">
        {{ t("insight.decisions.mark.intro", {}, alerts.length) }}
        <strong>{{ t("insight.decisions.mark.keeps", {}, alerts.length) }}</strong>
        <template v-if="alerts.length > 1">{{ t("insight.decisions.mark.untick") }}</template>
      </OText>

      <OText
        v-if="previews.isPending.value"
        variant="meta"
        as="p"
        class="min-h-24"
        data-test="decision-mark-loading"
      >
        {{ t("insight.decisions.mark.loading") }}
      </OText>
      <p
        v-else-if="previews.isError.value && !previews.data.value"
        class="text-status-error-text flex min-h-24 items-start gap-1 text-sm"
        data-test="decision-mark-load-failed"
      >
        <OIcon name="error" size="xs" class="mt-0.5" />
        <span>{{ t("insight.decisions.mark.loadFailed") }}</span>
      </p>
      <ul
        v-else
        class="divide-border-default flex max-h-80 flex-col divide-y overflow-y-auto"
        data-test="decision-mark-rows"
      >
        <li
          v-for="row in rows"
          :key="row.id"
          class="flex flex-col py-1"
          :data-state="row.state"
          data-test="decision-mark-row"
        >
          <div
            class="grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,9rem)_minmax(0,9rem)]"
          >
            <div v-if="row.state === 'open'" class="min-w-0">
              <OCheckbox
                :model-value="checked.has(row.id)"
                :label="row.name"
                :disabled="submitting"
                data-test="decision-mark-row-check"
                @update:model-value="toggle(row.id, $event === true)"
              />
            </div>
            <span v-else class="flex min-w-0 items-center gap-2 text-sm">
              <OIcon
                :name="row.state === 'marked' ? 'check' : 'lock'"
                size="xs"
                :class="row.state === 'marked' ? 'text-status-success-text' : 'text-icon-locked'"
              />
              <span class="truncate">{{ row.name }}</span>
            </span>
            <OText variant="meta" as="span" class="hidden truncate sm:block">{{ row.team }}</OText>
            <OText variant="meta" as="span" class="truncate text-end">{{ row.folder }}</OText>
          </div>
          <span
            class="text-status-error-text block h-4 truncate ps-6 text-xs"
            :title="row.reason ? String(row.reason) : undefined"
            data-test="decision-mark-row-reason"
            >{{ row.reason }}</span
          >
        </li>
      </ul>

      <div class="flex h-20 flex-col gap-1 overflow-hidden" data-test="decision-mark-footer">
        <p
          class="flex items-start gap-1 text-xs"
          :class="statusIsError ? 'text-status-error-text' : 'text-text-secondary'"
          :data-severity="statusIsError ? 'error' : 'neutral'"
          data-test="decision-mark-status"
        >
          <OIcon v-if="statusIsError" name="error" size="xs" class="mt-0.5 shrink-0" />
          <span class="line-clamp-3">{{ statusLine }}</span>
        </p>
        <OText v-if="previews.isSuccess.value" variant="meta" as="p">
          {{ t("insight.decisions.mark.recorded") }}
        </OText>
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useOrgId } from "@/composables/query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { autoobserveKeys } from "@/services/autoobserve.querykeys";
import autoobserveDecisions, {
  type BatchItemResult,
  type Preview,
} from "@/services/autoobserveDecisions";
import { newRequestId, useDecisionRoute } from "@/composables/autoobserve/useDecisionRoute";
import { decisionCopy } from "@/components/autoobserve/insight/insightCopy";
import { intendedReportBodyOf } from "./decisionDismiss";

/** One alert's calibration finding to mark. */
export interface MarkTarget {
  finding_id: string;
  alert_name: string | null;
}

type RowState = "open" | "locked" | "marked";

const props = defineProps<{ open: boolean; alerts: MarkTarget[] }>();
const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t, locale } = useI18nTyped();
const orgId = useOrgId();
const route = useDecisionRoute();
const copy = computed(() => decisionCopy(t, locale.value));
const checked = ref<ReadonlySet<string>>(new Set());
const marked = ref<ReadonlySet<string>>(new Set());
// A 403 from this save locks its row even when the preview allowed it.
const refusedIds = ref<ReadonlySet<string>>(new Set());
const failed = ref<BatchItemResult[]>([]);
// True only after a preview read succeeded during this opening, so no save sends a cached revision.
const current = ref(false);
const attempted = ref(0);
const submitting = ref(false);
// One id per opening, so a retry of the same items writes each once.
const requestId = ref(newRequestId());

const ids = computed(() => props.alerts.map((a) => a.finding_id));
const nameOf = (id: string) => props.alerts.find((a) => a.finding_id === id)?.alert_name ?? null;

/** Each alert's preview says whether this reader may mark it, and its team and folder. */
const previews = useQuery(() => ({
  queryKey: autoobserveKeys.decisionPreview(orgId.value, { mark: ids.value }),
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    Promise.all(
      ids.value.map(
        async (id) =>
          (
            await autoobserveDecisions.preview(
              orgId.value,
              {
                family: "alert_finding",
                id,
                action: "dismiss",
                reason: "intended_report",
                until_reopened: true,
              },
              signal,
            )
          ).data,
      ),
    ),
  enabled: props.open && ids.value.length > 0,
  staleTime: 0,
  retry: false,
}));

const previewById = computed(
  () => new Map<string, Preview>((previews.data.value ?? []).map((p) => [p.id, p])),
);

const failedById = computed(() => new Map(failed.value.map((item) => [item.id, item])));

const stateOf = (id: string, preview: Preview | undefined): RowState => {
  if (marked.value.has(id)) return "marked";
  return preview?.may && !refusedIds.value.has(id) ? "open" : "locked";
};

const rows = computed(() =>
  ids.value.map((id) => {
    const preview = previewById.value.get(id);
    const subject = preview?.subject;
    const failure = failedById.value.get(id);
    return {
      id,
      state: stateOf(id, preview),
      reason: failure ? copy.value.itemError(failure) : "",
      name: copy.value.title(nameOf(id) ?? subject?.title),
      team: subject?.team ? t("insight.decisions.mark.team", { team: raw(subject.team) }) : "",
      folder: subject?.folder
        ? t("insight.decisions.mark.folder", { folder: raw(subject.folder) })
        : "",
    };
  }),
);

const chosen = computed(() =>
  rows.value.filter((r) => r.state === "open" && checked.value.has(r.id)),
);
const lockedRows = computed(() => rows.value.filter((r) => r.state === "locked"));

const scopeLine = computed<I18nText>(() => {
  const can = rows.value.length - lockedRows.value.length;
  const parts = [
    t("insight.decisions.mark.canMark", {
      count: copy.value.count(can),
      total: copy.value.count(rows.value.length),
    }),
  ];
  if (lockedRows.value.length) {
    const first = previewById.value.get(lockedRows.value[0].id)?.locked;
    if (first) parts.push(copy.value.refusalText(first));
    parts.push(
      t(
        "insight.decisions.mark.locked",
        { alerts: copy.value.names(lockedRows.value.map((r) => String(r.name))) },
        lockedRows.value.length,
      ),
    );
  }
  return raw(parts.map(String).join(" "));
});

const statusLine = computed<I18nText | "">(() => {
  if (failed.value.length) {
    return t("insight.decisions.mark.failed", {
      failed: copy.value.count(failed.value.length),
      total: copy.value.count(attempted.value),
      names: copy.value.names(
        failed.value.map((item) => String(copy.value.title(nameOf(item.id)))),
      ),
    });
  }
  if (refreshFailed.value) return t("insight.decisions.mark.loadFailed");
  return previews.isSuccess.value ? scopeLine.value : "";
});

// Rows shown from an earlier read, with Save held because this opening's read failed.
const refreshFailed = computed(
  () => previews.isError.value && !!previews.data.value && !previews.isFetching.value,
);
const statusIsError = computed(() => failed.value.length > 0 || refreshFailed.value);

function toggle(id: string, on: boolean) {
  const next = new Set(checked.value);
  if (on) next.add(id);
  else next.delete(id);
  checked.value = next;
}

async function submit() {
  const items = chosen.value;
  if (!items.length || submitting.value) return;
  submitting.value = true;
  try {
    const result = await route.decideBatch(
      items.map((row) =>
        intendedReportBodyOf(row.id, {
          requestId: `${requestId.value}-${row.id.slice(0, 16)}`,
          revision: previewById.value.get(row.id)?.revision ?? 0,
        }),
      ),
      nameOf,
    );
    const done = result.results.filter((item) => item.status < 400).map((item) => item.id);
    marked.value = new Set([...marked.value, ...done]);
    settle(
      result.results.filter((item) => item.status >= 400),
      result.results.length,
    );
    if (!failed.value.length) emit("update:open", false);
  } catch (error) {
    // The whole request failed, so every item reads as that one failure.
    const response = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
    settle(
      items.map((row, index) => ({
        index,
        family: "alert_finding" as const,
        id: row.id,
        status: response?.status ?? 0,
        error: response?.data as BatchItemResult["error"],
      })),
      items.length,
    );
  } finally {
    submitting.value = false;
  }
}

/** Refused rows lock; a changed or missing row re-reads its preview so a retry sends the current revision. */
function settle(failures: BatchItemResult[], total: number) {
  failed.value = failures;
  attempted.value = total;
  const refused = failures.filter((item) => item.status === 403).map((item) => item.id);
  if (refused.length) refusedIds.value = new Set([...refusedIds.value, ...refused]);
  if (failures.some((item) => item.status === 404 || item.status === 409)) reread();
}

function reread() {
  current.value = false;
  void previews.refetch();
}

// Every alert the reader may mark starts ticked; a re-read keeps the reader's choices and drops only rows now locked.
let seeded = false;
function seed(data: Preview[] | undefined) {
  if (!data) return;
  const may = new Set(data.filter((p) => p.may).map((p) => p.id));
  checked.value = seeded ? new Set([...checked.value].filter((id) => may.has(id))) : may;
  seeded = true;
}
watch(() => previews.data.value, seed, { immediate: true });
watch(
  () => previews.isFetching.value,
  (fetching, was) => {
    if (was && !fetching && props.open) current.value = previews.isSuccess.value;
  },
);
watch(
  () => props.open,
  (open, was) => {
    if (!open || was) return;
    requestId.value = newRequestId();
    marked.value = new Set();
    refusedIds.value = new Set();
    current.value = false;
    failed.value = [];
    attempted.value = 0;
    seeded = false;
    seed(previews.data.value);
  },
);
</script>
