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
  <ODrawer
    v-if="enterprise"
    :open="state.open"
    side="right"
    size="xxl"
    :close-guard="() => !running"
    :return-focus-to="() => state.opener"
    data-test="bulk-review-drawer"
    @update:open="(open: boolean) => !open && closeBulkReview()"
  >
    <template #header>
      <div class="flex min-w-0 flex-col gap-0.5">
        <h2 class="text-text-heading text-base font-semibold" data-test="bulk-review-title">
          {{ title }}
        </h2>
        <p class="text-text-secondary text-xs text-pretty" data-test="bulk-review-rule">
          {{ rule }}
        </p>
      </div>
    </template>

    <div class="flex min-h-0 flex-col gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <div class="w-44 max-md:w-full">
          <OSelect
            size="sm"
            label-position="inside"
            :label="t('insight.bulk.groupBy')"
            :model-value="state.groupBy"
            :options="groupByOptions"
            :disabled="locked"
            data-test="bulk-review-group-by"
            @update:model-value="(v) => setGroupBy(v as GroupBy)"
          />
        </div>
        <span class="text-text-secondary text-xs">{{ t("insight.bulk.groupHint") }}</span>
      </div>

      <OBanner
        v-if="rights"
        variant="default"
        icon="lock"
        dense
        role="status"
        data-test="bulk-review-rights"
      >
        {{ rights }}
      </OBanner>

      <OBanner
        v-if="failures.length"
        ref="failureBanner"
        variant="error-soft"
        icon="error-outline"
        role="alert"
        data-test="bulk-review-failures"
      >
        <p class="font-semibold">{{ partialBanner(t, failures.length, attempted) }}</p>
        <ul class="mt-1 flex flex-col gap-0.5">
          <li
            v-for="f in failures"
            :key="f.row.key"
            :data-test="`bulk-review-failure-${f.row.key}`"
          >
            {{ failureLine(t, label(f.row), f.reason) }}
          </li>
        </ul>
        <p v-if="createdFolders.length" class="text-text-secondary mt-1">
          {{ createdLine(t, locale, createdFolders, createdCount) }}
        </p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <OButton
            v-for="f in retryable"
            :key="f.row.key"
            variant="outline"
            size="sm"
            :disabled="running"
            :data-test="`bulk-review-retry-${f.row.key}`"
            @click="retry([f.row.key])"
          >
            {{ t("insight.bulk.retryOne", { service: label(f.row) }) }}
          </OButton>
          <OButton
            v-if="retryable.length > 1"
            variant="outline"
            size="sm"
            :disabled="running"
            data-test="bulk-review-retry-all"
            @click="retry(retryable.map((f) => f.row.key))"
          >
            {{ t("insight.bulk.retryAll", { count: retryable.length }) }}
          </OButton>
          <OButton
            v-for="f in duplicates"
            :key="`open-${f.row.key}`"
            variant="ghost-primary"
            size="sm"
            :data-test="`bulk-review-open-existing-${f.row.key}`"
            @click="openExisting(f.row)"
          >
            {{ t("insight.bulk.openExisting") }}
          </OButton>
        </div>
      </OBanner>

      <OTable
        :data="tableRows"
        :columns="columns"
        :frame="false"
        :fill-height="false"
        row-key="key"
        pagination="none"
        :show-global-filter="false"
        :cell-overflow-tooltip="false"
        :row-section="(row: ReviewRow) => sectionOf.get(row.key) ?? null"
        :section-order="groups.map((g) => g.key)"
        :row-tone="(row: ReviewRow) => (isTickable(row) ? null : 'muted')"
        :row-class="(row: ReviewRow) => (hidden.has(row.key) ? 'hidden' : '')"
        data-test="bulk-review-table"
      >
        <template #group-header="{ sectionKey }">
          <BulkReviewGroupHeader
            v-if="groupOf(sectionKey)"
            :group="groupOf(sectionKey)!"
            :all="reviewRows"
            :ticked="state.ticked"
            :collapsible="collapsible"
            :collapsed="state.collapsed.has(sectionKey)"
            :folders="folderChoices"
            :destinations="state.destinations"
            :disabled="locked"
            @toggle="(on: boolean) => toggleGroup(groupOf(sectionKey)!, on)"
            @collapse="toggleCollapsed(sectionKey)"
            @change="(f: FolderRef, d: string[]) => changeGroup(groupOf(sectionKey)!, f, d)"
            @edit="loadDestinations(org()).catch(() => undefined)"
          />
        </template>
        <template #cell-tick="{ row }">
          <BulkRowMark
            :result="results[row.key]"
            :checked="state.ticked.has(row.key)"
            :disabled="locked || !isTickable(row)"
            :label="t('insight.bulk.tickRow', { service: label(row) })"
            :data-test="`bulk-review-tick-${row.key}`"
            @update="(on: boolean) => toggleRow(row.key, on)"
          />
        </template>
        <template #cell-service="{ row }">
          <div class="flex min-w-0 flex-col py-1 whitespace-normal">
            <span class="text-text-heading" :data-test="`bulk-review-service-${row.key}`">
              {{ label(row) }}
            </span>
            <span
              v-if="isMobile && row.prefill"
              class="text-text-secondary text-xs"
              :data-test="`bulk-review-compact-${row.key}`"
            >
              {{ compactLine(row) }}
            </span>
            <span
              v-if="!row.prefill || row.block"
              :class="[
                'text-xs',
                row.block?.code === 'schemaFailed'
                  ? 'text-status-error-text'
                  : 'text-text-secondary',
              ]"
              :data-test="`bulk-review-cant-${row.key}`"
            >
              {{ blockLine(t, row) }}
            </span>
            <span
              v-else-if="row.row.unsure"
              class="text-text-secondary text-xs"
              :data-test="`bulk-review-unsure-${row.key}`"
            >
              {{ `${row.row.unsure.reason} ${t("insight.bulk.unsureTail")}` }}
            </span>
          </div>
        </template>
        <template #cell-stream="{ row }">
          <span class="text-text-body">{{ row.stream.name }}</span>
        </template>
        <template #cell-firesWhen="{ row }">
          <span class="text-text-body">{{ firesWhenOf(t, kind, row) }}</span>
        </template>
        <template #cell-usually="{ row }">
          <span class="text-text-body tabular-nums">{{ usuallyOf(t, locale, row) }}</span>
        </template>
      </OTable>
    </div>

    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-text-body min-w-0 flex-1 text-xs text-pretty" data-test="bulk-review-footer">
          {{ footer }}
          <template v-if="tickedRows.length && !done">
            {{ t("insight.bulk.footerOrigin") }}
          </template>
        </p>
        <div class="flex shrink-0 items-center gap-2">
          <OButton
            variant="outline"
            size="sm-action"
            :disabled="running"
            data-test="bulk-review-cancel"
            @click="closeBulkReview()"
          >
            {{ done ? t("insight.bulk.close") : t("insight.bulk.cancel") }}
          </OButton>
          <OButton
            v-if="!done"
            variant="primary"
            size="sm-action"
            :disabled="toCreate.length === 0 || checking"
            :loading="running"
            data-test="bulk-review-create"
            @click="createTicked()"
          >
            {{ t("insight.bulk.create", { count: tickedRows.length }, tickedRows.length) }}
          </OButton>
        </div>
      </div>
    </template>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import config from "@/aws-exports";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import alertsService from "@/services/alerts";
import useBreakpoint from "@/composables/useBreakpoint";
import { raw, useI18nTyped } from "@/types/i18n";
import BulkReviewGroupHeader from "./BulkReviewGroupHeader.vue";
import BulkRowMark from "./BulkRowMark.vue";
import {
  blockLine,
  createdLine,
  failureLine,
  firesWhenOf,
  footerOf,
  partialBanner,
  rightsBanner,
  ruleOf,
  serviceLabel,
  titleOf,
  usuallyOf,
  type FailureReason,
} from "./bulkCopy";
import { useBulkCreate } from "./useBulkCreate";
import {
  DEFAULT_FOLDER,
  changeGroup,
  closeBulkReview,
  countByFolder,
  isTickable,
  loadDestinations,
  loadReviewContext,
  setGroupBy,
  toggleCollapsed,
  toggleGroup,
  toggleRow,
  useBulkReview,
  COLLAPSE_ROWS,
  type FolderRef,
  type GroupBy,
  type ReviewRow,
} from "./useBulkReview";

const { t, locale: i18nLocale } = useI18nTyped();
const store = useStore();
const router = useRouter();
const enterprise = config.isEnterprise === "true";
const { isMobile } = useBreakpoint();
const { state, reviewRows, groups, toCreate, tickedRows, checking } = useBulkReview();
const locale = computed(() => String(i18nLocale.value));
const org = () => String(store.state.selectedOrganization?.identifier ?? "");

const { results, running, create, retry, reset, expire, hideUndo, showUndo } = useBulkCreate({
  org,
  store,
  router,
  t,
  locale: () => locale.value,
  floorMinutes: () =>
    Math.max(1, Math.ceil(Number(store.state.zoConfig?.min_auto_refresh_interval ?? 0) / 60)),
});

const kind = computed(() => state.request?.kind ?? "no_data");
const done = computed(() => Object.keys(results).length > 0 && !running.value);
const locked = computed(() => running.value || done.value);

const title = computed(() =>
  state.request?.title ? raw(state.request.title) : titleOf(t, kind.value, reviewRows.value.length),
);
const rule = computed(() => ruleOf(t, kind.value, reviewRows.value));
const rights = computed(() => rightsBanner(t, locale.value, reviewRows.value));
const footer = computed(() =>
  done.value ? raw("") : footerOf(t, locale.value, countByFolder(tickedRows.value)),
);

const groupByOptions = computed(() =>
  (["team", "folder", "cluster"] as GroupBy[]).map((value) => ({
    label: t(`insight.bulk.groupByOption.${value}`),
    value,
  })),
);

const folderChoices = computed<FolderRef[]>(() => {
  const list = state.folders.length ? state.folders : [DEFAULT_FOLDER];
  return list.some((f) => f.id === DEFAULT_FOLDER.id) ? list : [DEFAULT_FOLDER, ...list];
});

const groupMap = computed(() => new Map(groups.value.map((g) => [g.key, g])));
const groupOf = (key: string) => groupMap.value.get(key);
const sectionOf = computed(
  () => new Map(groups.value.flatMap((g) => g.rows.map((r) => [r.key, g.key] as const))),
);
const tableRows = computed(() => groups.value.flatMap((g) => g.rows));
const collapsible = computed(() => reviewRows.value.length > COLLAPSE_ROWS);
const hidden = computed(
  () =>
    new Set(
      groups.value
        .filter((g) => state.collapsed.has(g.key))
        .flatMap((g) => g.rows.map((r) => r.key)),
    ),
);

const label = (row: ReviewRow) => serviceLabel(t, row, reviewRows.value);

const compactLine = (row: ReviewRow) =>
  [row.stream.name, firesWhenOf(t, kind.value, row), usuallyOf(t, locale.value, row)]
    .filter(Boolean)
    .join(" · ");

const columns = computed<OTableColumnDef<ReviewRow>[]>(() => [
  { id: "tick", header: raw(""), size: 44 },
  { id: "service", header: t("insight.bulk.column.service"), meta: { autoWidth: true } },
  ...(isMobile.value
    ? []
    : [
        { id: "stream", header: t("insight.bulk.column.stream"), size: 130 },
        { id: "firesWhen", header: t("insight.bulk.column.firesWhen"), size: 150 },
        { id: "usually", header: t("insight.bulk.column.usually"), size: 120 },
      ]),
]);

interface Failure {
  row: ReviewRow;
  reason: FailureReason;
  retryable: boolean;
}

const rowByKey = computed(() => new Map(reviewRows.value.map((r) => [r.key, r])));
const failures = computed<Failure[]>(() =>
  Object.entries(results).flatMap(([key, result]) => {
    const row = rowByKey.value.get(key);
    return result.status === "failed" && row && result.reason
      ? [{ row, reason: result.reason, retryable: !!result.retryable }]
      : [];
  }),
);
const retryable = computed(() => failures.value.filter((f) => f.retryable));
const duplicates = computed(() => failures.value.filter((f) => f.reason.code === "duplicate"));
const attempted = computed(() => Object.keys(results).length);
const createdRows = computed(() =>
  Object.entries(results).flatMap(([key, r]) =>
    r.status === "created" && rowByKey.value.has(key) ? [rowByKey.value.get(key)!] : [],
  ),
);
const createdCount = computed(() => createdRows.value.length);
const createdFolders = computed(() => countByFolder(createdRows.value).map((c) => c.folder));

const failureBanner = ref<{ $el?: HTMLElement } | null>(null);

// The banner sits above rows the user may have scrolled past while results came in.
watch(
  () => failures.value.length > 0 && !running.value,
  async (show) => {
    if (!show) return;
    await nextTick();
    failureBanner.value?.$el?.scrollIntoView?.({ block: "nearest" });
  },
);

const createTicked = () => create(kind.value, toCreate.value);

const openExisting = async (row: ReviewRow) => {
  const name = row.prefill?.name ?? "";
  let alertId = "";
  try {
    const res = await alertsService.listByFolderId(
      1,
      20,
      "name",
      false,
      "",
      org(),
      row.folder.id,
      name,
      undefined,
      false,
      { silentForbidden: true },
    );
    alertId = (res.data?.list ?? []).find((a: any) => a.name === name)?.alert_id ?? "";
  } catch {
    alertId = "";
  }
  const query: Record<string, string> = { folder: row.folder.id, org_identifier: org() };
  if (alertId) Object.assign(query, { action: "update", alert_id: alertId });
  closeBulkReview();
  router.push({ name: "alertList", query });
};

watch(
  () => state.open && state.request,
  (request) => {
    if (!request) return;
    reset();
    // On a phone the earlier batch's Undo toast sits over this review's Create button.
    hideUndo();
    void loadReviewContext(org());
  },
);

watch(
  () => state.open,
  (open) => !open && showUndo(),
);

// The review and its Undo belong to the org they were opened in.
watch(
  () => org(),
  (now, before) => {
    if (now === before) return;
    expire();
    closeBulkReview();
  },
);

onBeforeUnmount(() => {
  expire();
  closeBulkReview();
});
</script>
